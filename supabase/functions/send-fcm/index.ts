import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ServiceAccount = {
  client_email: string;
  private_key: string;
  project_id: string;
  database_url?: string;
};

type TokenLookupResult = {
  tokens: string[];
  tokenPathsByToken: Record<string, string[]>;
};

function base64UrlEncode(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function getAccessToken(serviceAccount: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64UrlEncode(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: [
      "https://www.googleapis.com/auth/firebase.messaging",
      "https://www.googleapis.com/auth/firebase.database",
    ].join(" "),
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));

  const pemKey = serviceAccount.private_key;
  const pemContents = pemKey
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\n/g, "");

  const binaryKey = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signatureInput = new TextEncoder().encode(`${header}.${payload}`);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, signatureInput);
  const sig = base64UrlEncode(new Uint8Array(signature));
  const jwt = `${header}.${payload}.${sig}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || !tokenData.access_token) {
    throw new Error(`Failed to get access token: ${JSON.stringify(tokenData)}`);
  }

  return tokenData.access_token;
}

const BRAND_ICON_URL = "https://i.ibb.co.com/gLc93Bc3/android-chrome-512x512.png";

const ensureAbsoluteUrl = (value: string | undefined, baseUrl: string): string | undefined => {
  if (!value) return undefined;
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  if (value.startsWith("//")) return `https:${value}`;
  if (value.startsWith("/")) return `${baseUrl}${value}`;
  return `${baseUrl}/${value}`;
};

const TRANSIENT_ERROR_CODES = ["UNAVAILABLE", "INTERNAL", "RESOURCE_EXHAUSTED", "DEADLINE_EXCEEDED"];

type FailCategory = "invalid" | "transient" | "other";

const categorizeError = (errorText: string): FailCategory => {
  const msg = errorText.toUpperCase();
  
  // Invalid token errors
  if (msg.includes("UNREGISTERED") || msg.includes("REGISTRATION_TOKEN_NOT_REGISTERED")) return "invalid";
  if (msg.includes("INVALID_ARGUMENT")) {
    if (msg.includes("REGISTRATION TOKEN") || msg.includes("MESSAGE.TOKEN") || msg.includes("TOKEN")) return "invalid";
  }
  
  // Transient errors
  for (const code of TRANSIENT_ERROR_CODES) {
    if (msg.includes(code)) return "transient";
  }
  
  return "other";
};

const getRealtimeDbBaseUrl = (serviceAccount: ServiceAccount): string => {
  const configured = (serviceAccount.database_url || "").trim();
  if (configured) return configured.replace(/\/$/, "");
  return `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`;
};

const extractTokensFromTree = (tree: Record<string, any>, userIds?: string[]): TokenLookupResult => {
  const allowed = userIds?.length ? new Set(userIds) : null;
  const tokens = new Set<string>();
  const tokenPathsByToken: Record<string, string[]> = {};

  Object.entries(tree || {}).forEach(([uid, userTokens]) => {
    if (allowed && !allowed.has(uid)) return;
    Object.entries(userTokens || {}).forEach(([tokenKey, entry]: any) => {
      const token = entry?.token;
      if (!token) return;
      tokens.add(token);
      if (!tokenPathsByToken[token]) tokenPathsByToken[token] = [];
      tokenPathsByToken[token].push(`fcmTokens/${uid}/${tokenKey}`);
    });
  });

  return { tokens: [...tokens], tokenPathsByToken };
};

const fetchTokensFromRealtimeDb = async (
  serviceAccount: ServiceAccount,
  accessToken: string,
  userIds?: string[],
): Promise<TokenLookupResult> => {
  const dbUrl = getRealtimeDbBaseUrl(serviceAccount);
  
  let readRes = await fetch(`${dbUrl}/fcmTokens.json`);
  
  if (!readRes.ok) {
    console.log(`Public read failed (${readRes.status}), trying with access_token param...`);
    readRes = await fetch(`${dbUrl}/fcmTokens.json?access_token=${accessToken}`);
  }

  if (!readRes.ok) {
    const text = await readRes.text();
    throw new Error(`Failed to read fcmTokens: ${text || readRes.status}`);
  }

  const allTokensTree = await readRes.json();
  return extractTokensFromTree(allTokensTree || {}, userIds);
};

const cleanupInvalidTokensInRealtimeDb = async (
  serviceAccount: ServiceAccount,
  accessToken: string,
  invalidTokens: string[],
  tokenPathsByToken: Record<string, string[]>,
): Promise<number> => {
  if (!invalidTokens.length) return 0;

  const dbUrl = getRealtimeDbBaseUrl(serviceAccount);
  const paths = invalidTokens.flatMap((token) => tokenPathsByToken[token] || []);
  if (!paths.length) return 0;

  let removed = 0;
  await Promise.all(paths.map(async (path) => {
    try {
      const delRes = await fetch(`${dbUrl}/${path}.json`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (delRes.ok) removed++;
    } catch {
      // noop
    }
  }));

  return removed;
};

/** Sleep utility */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Send a single FCM message with retry for transient errors */
const sendSingleWithRetry = async (
  projectId: string,
  accessToken: string,
  message: any,
  maxRetries = 2,
): Promise<{ ok: boolean; category?: FailCategory; errText?: string }> => {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(message),
      });

      if (res.ok) {
        return { ok: true };
      }

      const errText = await res.text();
      const category = categorizeError(errText);

      // Only retry transient errors
      if (category === "transient" && attempt < maxRetries) {
        await sleep(500 * Math.pow(2, attempt)); // 500ms, 1s, 2s
        continue;
      }

      return { ok: false, category, errText };
    } catch (err) {
      // Network error - treat as transient
      if (attempt < maxRetries) {
        await sleep(500 * Math.pow(2, attempt));
        continue;
      }
      return { ok: false, category: "transient", errText: String(err) };
    }
  }

  return { ok: false, category: "other" };
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { tokens, userIds, title, body, image, icon, badge, data } = await req.json();

    const inputTokens = Array.isArray(tokens) ? tokens.filter(Boolean) : [];
    const inputUserIds = Array.isArray(userIds) ? userIds.filter(Boolean) : [];

    if (inputTokens.length === 0 && inputUserIds.length === 0) {
      return new Response(JSON.stringify({ error: "No tokens or userIds provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceAccountJson = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_KEY");
    if (!serviceAccountJson) {
      return new Response(JSON.stringify({ error: "Service account not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceAccount: ServiceAccount = JSON.parse(serviceAccountJson);
    const accessToken = await getAccessToken(serviceAccount);
    const projectId = serviceAccount.project_id;

    const normalizedData: Record<string, string> = {};
    if (data && typeof data === "object") {
      Object.entries(data).forEach(([key, value]) => {
        normalizedData[key] = value == null ? "" : String(value);
      });
    }

    const rawBaseUrl = normalizedData.baseUrl || req.headers.get("origin") || "https://rs-anime.lovable.app";
    const baseUrl = rawBaseUrl.replace(/\/$/, "");

    const iconUrl = BRAND_ICON_URL;
    const badgeUrl = BRAND_ICON_URL;
    const imageUrl = ensureAbsoluteUrl(image, baseUrl);
    const clickLink = ensureAbsoluteUrl(normalizedData.url || "/", baseUrl);

    let resolvedTokens = [...new Set(inputTokens)];
    let tokenPathsByToken: Record<string, string[]> = {};

    if (resolvedTokens.length === 0 && inputUserIds.length > 0) {
      try {
        const lookup = await fetchTokensFromRealtimeDb(serviceAccount, accessToken, inputUserIds);
        resolvedTokens = lookup.tokens;
        tokenPathsByToken = lookup.tokenPathsByToken;
      } catch (lookupErr: any) {
        return new Response(JSON.stringify({
          success: 0,
          failed: 0,
          totalTokens: 0,
          invalidTokens: [],
          invalidRemoved: 0,
          failReasons: { invalid: 0, transient: 0, other: 0 },
          reason: "TOKEN_LOOKUP_FAILED",
          details: {
            message: lookupErr?.message || "Failed to load fcmTokens",
            targetUsers: inputUserIds.length,
            firebaseProjectId: serviceAccount.project_id,
          },
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (resolvedTokens.length === 0) {
      return new Response(JSON.stringify({
        success: 0,
        failed: 0,
        totalTokens: 0,
        invalidTokens: [],
        invalidRemoved: 0,
        failReasons: { invalid: 0, transient: 0, other: 0 },
        reason: "NO_MATCHING_TOKENS",
        details: {
          targetUsers: inputUserIds.length,
          firebaseProjectId: serviceAccount.project_id,
          hint: "No push tokens were found for selected users. Usually this means permission not granted yet or Firebase project mismatch.",
        },
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let successCount = 0;
    let failCount = 0;
    const invalidTokens: string[] = [];
    const failReasons = { invalid: 0, transient: 0, other: 0 };

    // Reduced concurrency for stability (was 120)
    const concurrency = Math.min(30, resolvedTokens.length);
    let currentIndex = 0;

    const worker = async () => {
      while (currentIndex < resolvedTokens.length) {
        const idx = currentIndex++;
        const token = resolvedTokens[idx];

        const message: any = {
          message: {
            token,
            notification: {
              title,
              body,
            },
            webpush: {
              headers: {
                Urgency: "high",
                TTL: "2419200",
              },
              notification: {
                title,
                body,
                icon: iconUrl,
                image: imageUrl,
                badge: badgeUrl,
                vibrate: [200, 100, 200],
                requireInteraction: false,
              },
              fcm_options: clickLink ? { link: clickLink } : undefined,
            },
            data: normalizedData,
          },
        };

        const result = await sendSingleWithRetry(projectId, accessToken, message);

        if (result.ok) {
          successCount++;
        } else {
          failCount++;
          const cat = result.category || "other";
          failReasons[cat]++;
          if (cat === "invalid") {
            invalidTokens.push(token);
          }
        }
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    const invalidRemoved = inputUserIds.length > 0
      ? await cleanupInvalidTokensInRealtimeDb(serviceAccount, accessToken, invalidTokens, tokenPathsByToken)
      : 0;

    return new Response(JSON.stringify({
      success: successCount,
      failed: failCount,
      totalTokens: resolvedTokens.length,
      invalidTokens,
      invalidRemoved,
      failReasons,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
