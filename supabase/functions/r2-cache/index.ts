// ============================================
// R2 Video Cache — Supabase Edge Function
// ============================================
// Multi-bucket R2 ক্যাশিং সিস্টেম
// - check: ভিডিও ক্যাশে আছে কিনা চেক করে
// - upload: সোর্স থেকে ডাউনলোড করে R2-তে আপলোড করে
// - delete: ক্যাশ থেকে ফাইল মুছে ফেলে
// - cleanup: পুরনো ক্যাশ ক্লিন করে
// - list: ক্যাশে থাকা ফাইলগুলো দেখায়
//
// ডিপ্লয়: Supabase Dashboard → Edge Functions → New → Paste this code
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

// ---- S3-compatible signing (AWS Signature V4) ----
async function hmacSHA256(key: Uint8Array, message: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
  return new Uint8Array(sig);
}

async function sha256(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function toHex(arr: Uint8Array): string {
  return [...arr].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function getSignatureKey(key: string, dateStamp: string, region: string, service: string): Promise<Uint8Array> {
  let kDate = await hmacSHA256(new TextEncoder().encode("AWS4" + key), dateStamp);
  let kRegion = await hmacSHA256(kDate, region);
  let kService = await hmacSHA256(kRegion, service);
  let kSigning = await hmacSHA256(kService, "aws4_request");
  return kSigning;
}

async function signedS3Request(
  bucket: R2Bucket,
  method: string,
  objectKey: string,
  body?: Uint8Array,
  extraHeaders?: Record<string, string>
): Promise<Response> {
  const now = new Date();
  const dateStamp = now.toISOString().replace(/[-:]/g, "").split(".")[0].replace("T", "").slice(0, 8);
  const amzDate = now.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const region = "auto";
  const service = "s3";

  // Use s3Endpoint directly — it already includes bucket name
  const endpoint = bucket.s3Endpoint.replace(/\/$/, "");
  const url = `${endpoint}/${objectKey}`;
  const parsedUrl = new URL(url);

  const payloadHash = body ? await sha256(body) : await sha256(new Uint8Array(0));

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
  const signedHeaders = signedHeaderKeys.join(";");
  const canonicalHeaders = signedHeaderKeys.map(k => `${k}:${headers[Object.keys(headers).find(h => h.toLowerCase() === k)!]}`).join("\n") + "\n";

  const canonicalRequest = [
    method,
    parsedUrl.pathname,
    parsedUrl.search.replace("?", ""),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256(new TextEncoder().encode(canonicalRequest)),
  ].join("\n");

  const signingKey = await getSignatureKey(bucket.secretAccessKey, dateStamp, region, service);
  const signature = toHex(await hmacSHA256(signingKey, stringToSign));

  const authHeader = `AWS4-HMAC-SHA256 Credential=${bucket.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const fetchHeaders: Record<string, string> = { ...headers, Authorization: authHeader };

  return fetch(url, {
    method,
    headers: fetchHeaders,
    body: body || undefined,
  });
}

// ---- Helper: generate cache key from video URL ----
function cacheKey(videoUrl: string): string {
  // Use a hash of the URL as the object key
  let hash = 0;
  for (let i = 0; i < videoUrl.length; i++) {
    const chr = videoUrl.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  // Also include part of the URL for readability
  const urlParts = videoUrl.split("/");
  const fileName = urlParts[urlParts.length - 1]?.split("?")[0] || "video";
  return `cache/${Math.abs(hash).toString(36)}_${fileName}`;
}

// ---- Pick bucket with round-robin load balancing ----
function pickBucket(buckets: R2Bucket[], videoUrl: string): R2Bucket {
  if (buckets.length === 1) return buckets[0];
  // Hash-based distribution for consistent mapping
  let hash = 0;
  for (let i = 0; i < videoUrl.length; i++) {
    hash = ((hash << 5) - hash) + videoUrl.charCodeAt(i);
    hash |= 0;
  }
  return buckets[Math.abs(hash) % buckets.length];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { action, videoUrl, buckets, maxSizeMB = 300 } = await req.json();

    if (!buckets || !Array.isArray(buckets) || buckets.length === 0) {
      return new Response(JSON.stringify({ error: "No R2 buckets configured" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- CHECK: Is video cached in any bucket? ----
    if (action === "check") {
      const key = cacheKey(videoUrl);
      for (const bucket of buckets as R2Bucket[]) {
        try {
          const res = await signedS3Request(bucket, "HEAD", key);
          if (res.ok) {
            const publicUrl = `${bucket.publicUrl.replace(/\/$/, "")}/${key}`;
            return new Response(JSON.stringify({
              cached: true,
              url: publicUrl,
              bucketId: bucket.id,
              size: res.headers.get("Content-Length"),
            }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        } catch {}
      }
      return new Response(JSON.stringify({ cached: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- UPLOAD: Download from source & upload to R2 ----
    if (action === "upload") {
      const bucket = pickBucket(buckets as R2Bucket[], videoUrl);
      const key = cacheKey(videoUrl);

      // First check if already cached
      try {
        const headRes = await signedS3Request(bucket, "HEAD", key);
        if (headRes.ok) {
          const publicUrl = `${bucket.publicUrl.replace(/\/$/, "")}/${key}`;
          return new Response(JSON.stringify({
            success: true,
            url: publicUrl,
            alreadyCached: true,
            bucketId: bucket.id,
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } catch {}

      // Download from source
      const sourceRes = await fetch(videoUrl, {
        headers: { "User-Agent": "Mozilla/5.0" },
      });

      if (!sourceRes.ok) {
        return new Response(JSON.stringify({ error: `Source fetch failed: ${sourceRes.status}` }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Check file size
      const contentLength = parseInt(sourceRes.headers.get("Content-Length") || "0");
      const maxBytes = maxSizeMB * 1024 * 1024;
      if (contentLength > maxBytes) {
        return new Response(JSON.stringify({
          error: "File too large",
          size: contentLength,
          maxSize: maxBytes,
          skipped: true,
        }), {
          status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Read the video data
      const videoData = new Uint8Array(await sourceRes.arrayBuffer());

      // Double-check actual size
      if (videoData.length > maxBytes) {
        return new Response(JSON.stringify({
          error: "File too large after download",
          size: videoData.length,
          maxSize: maxBytes,
          skipped: true,
        }), {
          status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Upload to R2
      const contentType = sourceRes.headers.get("Content-Type") || "video/mp4";
      const uploadRes = await signedS3Request(bucket, "PUT", key, videoData, {
        "Content-Type": contentType,
      });

      if (!uploadRes.ok) {
        const errText = await uploadRes.text();
        return new Response(JSON.stringify({ error: `R2 upload failed: ${uploadRes.status}`, details: errText }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Store metadata (timestamp for cleanup)
      const metaKey = `${key}.meta.json`;
      const meta = JSON.stringify({
        originalUrl: videoUrl,
        cachedAt: Date.now(),
        size: videoData.length,
        contentType,
      });
      await signedS3Request(bucket, "PUT", metaKey, new TextEncoder().encode(meta), {
        "Content-Type": "application/json",
      });

      const publicUrl = `${bucket.publicUrl.replace(/\/$/, "")}/${key}`;
      return new Response(JSON.stringify({
        success: true,
        url: publicUrl,
        size: videoData.length,
        bucketId: bucket.id,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- DELETE: Remove a cached video ----
    if (action === "delete") {
      const key = cacheKey(videoUrl);
      const results: any[] = [];
      for (const bucket of buckets as R2Bucket[]) {
        try {
          const res = await signedS3Request(bucket, "DELETE", key);
          await signedS3Request(bucket, "DELETE", `${key}.meta.json`);
          results.push({ bucketId: bucket.id, status: res.status });
        } catch (e: any) {
          results.push({ bucketId: bucket.id, error: e.message });
        }
      }
      return new Response(JSON.stringify({ success: true, results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- CLEANUP: Delete old cached files ----
    if (action === "cleanup") {
      const maxAgeMs = 12 * 60 * 60 * 1000; // 12 hours
      const now = Date.now();
      let deleted = 0;

      for (const bucket of buckets as R2Bucket[]) {
        try {
          // List objects in cache/ prefix
          const listRes = await signedS3Request(bucket, "GET", "", undefined, {});
          const listUrl = `${bucket.s3Endpoint.replace(/\/$/, "")}?prefix=cache/&list-type=2`;

          // Parse XML response to get keys
          const xmlRes = await fetch(listUrl.replace(bucket.s3Endpoint.replace(/\/$/, ""), ""), {
            headers: { "Host": new URL(bucket.s3Endpoint).host },
          });

          // Simple approach: list meta files and check timestamps
          const listRes2 = await signedS3Request(bucket, "GET", "?prefix=cache/&max-keys=1000");
          if (listRes2.ok) {
            const xml = await listRes2.text();
            // Extract keys from XML
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
                      await signedS3Request(bucket, "DELETE", videoKey);
                      await signedS3Request(bucket, "DELETE", key);
                      deleted++;
                    }
                  }
                } catch {}
              }
            }
          }
        } catch (e: any) {
          console.error(`Cleanup error for bucket ${bucket.id}:`, e.message);
        }
      }

      return new Response(JSON.stringify({ success: true, deleted }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- STATUS: Check all buckets health ----
    if (action === "status") {
      const results: any[] = [];
      for (const bucket of buckets as R2Bucket[]) {
        try {
          const start = Date.now();
          const res = await signedS3Request(bucket, "GET", "?max-keys=1");
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

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
