// ============================================
// R2 Video Cache — Supabase Edge Function
// ============================================
// Multi-bucket R2 ক্যাশিং সিস্টেম
// - check: ভিডিও ক্যাশে আছে কিনা চেক করে
// - upload: সোর্স থেকে ডাউনলোড করে R2-তে আপলোড করে
// - delete: ক্যাশ থেকে ফাইল মুছে ফেলে
// - cleanup: পুরনো ক্যাশ ক্লিন করে
// - list: ক্যাশে থাকা ফাইলগুলো দেখায়
// ============================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface R2Bucket {
  id: string;
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  publicUrl: string;
  s3Endpoint: string;
}

function normalizeBucket(bucket: R2Bucket): R2Bucket {
  const accessKeyId = bucket.accessKeyId?.trim() || "";
  const secretAccessKey = bucket.secretAccessKey?.trim() || "";

  if (accessKeyId.length >= 48 && secretAccessKey.length > 0 && secretAccessKey.length <= 40) {
    return {
      ...bucket,
      accessKeyId: secretAccessKey,
      secretAccessKey: accessKeyId,
    };
  }

  return {
    ...bucket,
    accessKeyId,
    secretAccessKey,
  };
}

// ---- S3-compatible signing (AWS Signature V4) ----
async function hmacSHA256(key: Uint8Array, message: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
  return new Uint8Array(sig);
}

async function sha256hex(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function toHex(arr: Uint8Array): string {
  return [...arr].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function getSignatureKey(key: string, dateStamp: string, region: string, service: string): Promise<Uint8Array> {
  const kDate = await hmacSHA256(new TextEncoder().encode("AWS4" + key), dateStamp);
  const kRegion = await hmacSHA256(kDate, region);
  const kService = await hmacSHA256(kRegion, service);
  return await hmacSHA256(kService, "aws4_request");
}

// Properly encode URI component for S3 (encode everything except unreserved chars)
function uriEncode(str: string, encodeSlash = true): string {
  let encoded = "";
  for (const ch of str) {
    if ((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') ||
        (ch >= '0' && ch <= '9') || ch === '_' || ch === '-' || ch === '~' || ch === '.') {
      encoded += ch;
    } else if (ch === '/' && !encodeSlash) {
      encoded += ch;
    } else {
      const bytes = new TextEncoder().encode(ch);
      for (const b of bytes) {
        encoded += '%' + b.toString(16).toUpperCase().padStart(2, '0');
      }
    }
  }
  return encoded;
}

async function signedS3Request(
  bucket: R2Bucket,
  method: string,
  objectKey: string,
  body?: Uint8Array,
  queryParams?: Record<string, string>,
  extraHeaders?: Record<string, string>
): Promise<Response> {
  const now = new Date();
  const dateStamp = now.toISOString().replace(/[-:]/g, "").split(".")[0].replace("T", "").slice(0, 8);
  const amzDate = now.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const region = "auto";
  const service = "s3";

  // Build URL properly — endpoint already includes bucket name
  const endpoint = bucket.s3Endpoint.replace(/\/$/, "");
  const path = objectKey ? `/${objectKey}` : "/";
  const baseUrl = `${endpoint}${path}`;
  
  // Build query string
  const qsParts: string[] = [];
  if (queryParams) {
    const sortedKeys = Object.keys(queryParams).sort();
    for (const k of sortedKeys) {
      qsParts.push(`${uriEncode(k)}=${uriEncode(queryParams[k])}`);
    }
  }
  const queryString = qsParts.join("&");
  const fullUrl = queryString ? `${baseUrl}?${queryString}` : baseUrl;
  const parsedUrl = new URL(fullUrl);

  const payloadHash = body ? await sha256hex(body) : await sha256hex(new Uint8Array(0));

  const headers: Record<string, string> = {
    "Host": parsedUrl.host,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
    ...(extraHeaders || {}),
  };
  if (body) {
    headers["Content-Length"] = body.length.toString();
  }

  const signedHeaderKeys = Object.keys(headers).map(k => k.toLowerCase()).sort();
  const signedHeadersStr = signedHeaderKeys.join(";");
  const canonicalHeaders = signedHeaderKeys.map(k => {
    const origKey = Object.keys(headers).find(h => h.toLowerCase() === k)!;
    return `${k}:${headers[origKey].trim()}`;
  }).join("\n") + "\n";

  // Canonical URI — must be URI-encoded path (don't encode slashes)
  const canonicalUri = uriEncode(parsedUrl.pathname, false) || "/";

  const canonicalRequest = [
    method,
    canonicalUri,
    queryString, // already sorted & encoded
    canonicalHeaders,
    signedHeadersStr,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256hex(new TextEncoder().encode(canonicalRequest)),
  ].join("\n");

  const signingKey = await getSignatureKey(bucket.secretAccessKey, dateStamp, region, service);
  const signature = toHex(await hmacSHA256(signingKey, stringToSign));

  const authHeader = `AWS4-HMAC-SHA256 Credential=${bucket.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeadersStr}, Signature=${signature}`;

  return fetch(fullUrl, {
    method,
    headers: { ...headers, Authorization: authHeader },
    body: body || undefined,
  });
}

// ---- Helper: generate cache key from video URL ----
function cacheKey(videoUrl: string): string {
  let hash = 0;
  for (let i = 0; i < videoUrl.length; i++) {
    hash = ((hash << 5) - hash) + videoUrl.charCodeAt(i);
    hash |= 0;
  }
  const urlParts = videoUrl.split("/");
  const fileName = urlParts[urlParts.length - 1]?.split("?")[0] || "video";
  return `cache/${Math.abs(hash).toString(36)}_${fileName}`;
}

// ---- Pick bucket with hash-based load balancing ----
function pickBucket(buckets: R2Bucket[], videoUrl: string): R2Bucket {
  if (buckets.length === 1) return buckets[0];
  let hash = 0;
  for (let i = 0; i < videoUrl.length; i++) {
    hash = ((hash << 5) - hash) + videoUrl.charCodeAt(i);
    hash |= 0;
  }
  return buckets[Math.abs(hash) % buckets.length];
}

function getBucketCandidates(buckets: R2Bucket[], videoUrl: string): R2Bucket[] {
  if (buckets.length <= 1) return buckets;

  const startBucket = pickBucket(buckets, videoUrl);
  const startIndex = buckets.findIndex((bucket) => bucket.id === startBucket.id);

  return buckets.map((_, index) => buckets[(startIndex + index) % buckets.length]);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function uploadToR2InBackground(
  videoUrl: string,
  sourceUrl: string | undefined,
  buckets: R2Bucket[],
  maxSizeMB: number,
): Promise<Response> {
  const candidateBuckets = getBucketCandidates(buckets, videoUrl);
  const key = cacheKey(videoUrl);

  for (const bucket of candidateBuckets) {
    try {
      const headRes = await signedS3Request(bucket, "HEAD", key);
      if (headRes.ok) {
        const publicUrl = `${bucket.publicUrl.replace(/\/$/, "")}/${key}`;
        return jsonResponse({
          success: true,
          url: publicUrl,
          alreadyCached: true,
          bucketId: bucket.id,
        });
      }
      await headRes.text();
    } catch {}
  }

  const fetchUrl = sourceUrl || videoUrl;
  const sourceRes = await fetch(fetchUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept": "*/*",
    },
  });

  if (!sourceRes.ok) {
    return jsonResponse({ error: `Source fetch failed: ${sourceRes.status}`, sourceUrl: fetchUrl }, 502);
  }

  const contentLength = parseInt(sourceRes.headers.get("Content-Length") || "0");
  const maxBytes = maxSizeMB * 1024 * 1024;
  if (contentLength > maxBytes) {
    await sourceRes.body?.cancel();
    return jsonResponse({ error: "File too large", size: contentLength, maxSize: maxBytes, skipped: true }, 413);
  }

  const videoData = new Uint8Array(await sourceRes.arrayBuffer());
  if (videoData.length > maxBytes) {
    return jsonResponse({ error: "File too large after download", size: videoData.length, maxSize: maxBytes, skipped: true }, 413);
  }

  const contentType = sourceRes.headers.get("Content-Type") || "video/mp4";
  const failedBuckets: { bucketId: string; error: string }[] = [];

  for (const bucket of candidateBuckets) {
    try {
      const uploadRes = await signedS3Request(bucket, "PUT", key, videoData, undefined, {
        "Content-Type": contentType,
      });

      if (!uploadRes.ok) {
        const errText = await uploadRes.text();
        failedBuckets.push({ bucketId: bucket.id, error: `PUT ${uploadRes.status}: ${errText}` });
        continue;
      }
      await uploadRes.text();

      let metaSaved = false;
      try {
        const metaKey = `${key}.meta.json`;
        const meta = JSON.stringify({
          originalUrl: videoUrl,
          sourceUrl: fetchUrl,
          cachedAt: Date.now(),
          size: videoData.length,
          contentType,
        });
        const metaRes = await signedS3Request(bucket, "PUT", metaKey, new TextEncoder().encode(meta), undefined, {
          "Content-Type": "application/json",
        });
        metaSaved = metaRes.ok;
        await metaRes.text();
      } catch {
        metaSaved = false;
      }

      const publicUrl = `${bucket.publicUrl.replace(/\/$/, "")}/${key}`;
      return jsonResponse({ success: true, url: publicUrl, size: videoData.length, bucketId: bucket.id, metaSaved });
    } catch (error) {
      failedBuckets.push({
        bucketId: bucket.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return jsonResponse({ error: "R2 upload failed for all buckets", failedBuckets }, 500);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { action, videoUrl, sourceUrl, buckets, maxSizeMB = 300 } = await req.json();
    const bucketList = Array.isArray(buckets) ? (buckets as R2Bucket[]).map(normalizeBucket) : [];

    if (bucketList.length === 0) {
      return jsonResponse({ error: "No R2 buckets configured" }, 400);
    }

    // ---- CHECK ----
    if (action === "check") {
      const key = cacheKey(videoUrl);
      for (const bucket of bucketList) {
        try {
          const res = await signedS3Request(bucket, "HEAD", key);
          if (res.ok) {
            const publicUrl = `${bucket.publicUrl.replace(/\/$/, "")}/${key}`;
            return new Response(JSON.stringify({
              cached: true, url: publicUrl, bucketId: bucket.id,
              size: res.headers.get("Content-Length"),
            }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
          // Consume body to prevent leak
          await res.text();
        } catch {}
      }
      return jsonResponse({ cached: false });
    }

    // ---- UPLOAD ----
    if (action === "upload") {
      const uploadTask = uploadToR2InBackground(videoUrl, sourceUrl, bucketList, maxSizeMB);
      const edgeRuntime = (globalThis as typeof globalThis & {
        EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void };
      }).EdgeRuntime;

      if (edgeRuntime?.waitUntil) {
        edgeRuntime.waitUntil(uploadTask.catch((error) => {
          console.error("R2 background upload failed:", error?.message || error);
        }));

        return jsonResponse({
          queued: true,
          started: true,
          bucketId: pickBucket(bucketList, videoUrl).id,
        }, 202);
      }

      return await uploadTask;
    }

    // ---- DELETE ----
    if (action === "delete") {
      const key = cacheKey(videoUrl);
      const results: any[] = [];
      for (const bucket of bucketList) {
        try {
          const res = await signedS3Request(bucket, "DELETE", key);
          await res.text();
          const res2 = await signedS3Request(bucket, "DELETE", `${key}.meta.json`);
          await res2.text();
          results.push({ bucketId: bucket.id, status: res.status });
        } catch (e: any) {
          results.push({ bucketId: bucket.id, error: e.message });
        }
      }
      return new Response(JSON.stringify({ success: true, results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- CLEANUP ----
    if (action === "cleanup") {
      const maxAgeMs = 12 * 60 * 60 * 1000;
      const now = Date.now();
      let deleted = 0;

      for (const bucket of bucketList) {
        try {
          const listRes = await signedS3Request(bucket, "GET", "", undefined, {
            "prefix": "cache/",
            "list-type": "2",
            "max-keys": "1000",
          });
          if (listRes.ok) {
            const xml = await listRes.text();
            const keyMatches = xml.match(/<Key>([^<]+)<\/Key>/g) || [];
            const keys = keyMatches.map(k => k.replace(/<Key>|<\/Key>/g, ""));

            for (const key of keys) {
              if (key.endsWith(".meta.json")) {
                try {
                  const metaRes = await signedS3Request(bucket, "GET", key);
                  if (metaRes.ok) {
                    const meta = await metaRes.json();
                    if (meta.cachedAt && (now - meta.cachedAt) > maxAgeMs) {
                      const videoKey = key.replace(".meta.json", "");
                      const d1 = await signedS3Request(bucket, "DELETE", videoKey);
                      await d1.text();
                      const d2 = await signedS3Request(bucket, "DELETE", key);
                      await d2.text();
                      deleted++;
                    }
                  } else {
                    await metaRes.text();
                  }
                } catch {}
              }
            }
          } else {
            await listRes.text();
          }
        } catch (e: any) {
          console.error(`Cleanup error for bucket ${bucket.id}:`, e.message);
        }
      }
      return new Response(JSON.stringify({ success: true, deleted }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- LIST (storage info per bucket) ----
    if (action === "list") {
      const results: any[] = [];
      for (const bucket of bucketList) {
        try {
          let totalFiles = 0;
          let totalSize = 0;
          let continuationToken: string | undefined;
          const files: { key: string; size: number; lastModified: string }[] = [];

          do {
            const params: Record<string, string> = { "prefix": "cache/", "list-type": "2", "max-keys": "1000" };
            if (continuationToken) params["continuation-token"] = continuationToken;
            const listRes = await signedS3Request(bucket, "GET", "", undefined, params);
            if (!listRes.ok) {
              const errorText = await listRes.text();
              throw new Error(`LIST ${listRes.status}: ${errorText || "Bucket access failed"}`);
            }
            const xml = await listRes.text();

            const keyMatches = xml.match(/<Key>([^<]+)<\/Key>/g) || [];
            const sizeMatches = xml.match(/<Size>([^<]+)<\/Size>/g) || [];
            const dateMatches = xml.match(/<LastModified>([^<]+)<\/LastModified>/g) || [];

            for (let i = 0; i < keyMatches.length; i++) {
              const key = keyMatches[i].replace(/<Key>|<\/Key>/g, "");
              if (key.endsWith(".meta.json")) continue;
              const size = parseInt(sizeMatches[i]?.replace(/<Size>|<\/Size>/g, "") || "0");
              const lastMod = dateMatches[i]?.replace(/<LastModified>|<\/LastModified>/g, "") || "";
              totalFiles++;
              totalSize += size;
              files.push({ key, size, lastModified: lastMod });
            }

            const truncated = xml.includes("<IsTruncated>true</IsTruncated>");
            const tokenMatch = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
            continuationToken = truncated && tokenMatch ? tokenMatch[1] : undefined;
          } while (continuationToken);

          const recentFiles = files
            .sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime())
            .slice(0, 50);

          const filesWithMeta = await Promise.all(recentFiles.map(async (file) => {
            try {
              const metaRes = await signedS3Request(bucket, "GET", `${file.key}.meta.json`);
              if (!metaRes.ok) {
                await metaRes.text();
                return file;
              }

              const meta = await metaRes.json();
              return {
                ...file,
                originalUrl: meta.originalUrl || "",
                sourceUrl: meta.sourceUrl || "",
                cachedAt: meta.cachedAt || null,
              };
            } catch {
              return file;
            }
          }));

          results.push({ bucketId: bucket.id, bucketName: bucket.bucketName, totalFiles, totalSizeBytes: totalSize, files: filesWithMeta });
        } catch (e: any) {
          results.push({ bucketId: bucket.id, bucketName: bucket.bucketName, error: e.message, totalFiles: 0, totalSizeBytes: 0, files: [] });
        }
      }
      return new Response(JSON.stringify({ results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- PURGE (delete ALL cached files in a bucket) ----
    if (action === "purge") {
      let deleted = 0;
      for (const bucket of bucketList) {
        try {
          let continuationToken: string | undefined;
          do {
            const params: Record<string, string> = { "prefix": "cache/", "list-type": "2", "max-keys": "1000" };
            if (continuationToken) params["continuation-token"] = continuationToken;
            const listRes = await signedS3Request(bucket, "GET", "", undefined, params);
            if (!listRes.ok) { await listRes.text(); break; }
            const xml = await listRes.text();
            const keyMatches = xml.match(/<Key>([^<]+)<\/Key>/g) || [];
            const keys = keyMatches.map(k => k.replace(/<Key>|<\/Key>/g, ""));
            for (const key of keys) {
              try { const d = await signedS3Request(bucket, "DELETE", key); await d.text(); deleted++; } catch {}
            }
            const truncated = xml.includes("<IsTruncated>true</IsTruncated>");
            const tokenMatch = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
            continuationToken = truncated && tokenMatch ? tokenMatch[1] : undefined;
          } while (continuationToken);
        } catch {}
      }
      return new Response(JSON.stringify({ success: true, deleted }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- STATUS ----
    if (action === "status") {
      const results: any[] = [];
      for (const bucket of bucketList) {
        try {
          const start = Date.now();
          const res = await signedS3Request(bucket, "GET", "", undefined, {
            "list-type": "2",
            "max-keys": "1",
          });
          const bodyText = await res.text();
          results.push({
            bucketId: bucket.id,
            alive: res.ok,
            latency: Date.now() - start,
            status: res.status,
          });
        } catch (e: any) {
          results.push({ bucketId: bucket.id, alive: false, error: e.message });
        }
      }
      return new Response(JSON.stringify({ results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

      return jsonResponse({ error: "Unknown action" }, 400);

  } catch (e: any) {
    return jsonResponse({ error: e.message }, 500);
  }
});
