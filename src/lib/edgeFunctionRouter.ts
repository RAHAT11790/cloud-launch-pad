// ============================================
// Edge Function Router — Cloudflare Workers + Lovable Cloud
// ============================================
// Firebase settings/edgeRouter থেকে config পড়ে
// Cloudflare Worker বা Lovable Cloud URL ব্যবহার করে ফাংশন কল করে
// ডাইনামিকভাবে নতুন ফাংশন যোগ করা যায়

import { db, ref, get } from "@/lib/firebase";

// ---- Default built-in Cloudflare Worker endpoints ----
export const DEFAULT_CF_FUNCTIONS = [
  "animesalt",
] as const;

export type DefaultCFFunction = typeof DEFAULT_CF_FUNCTIONS[number];

// Keep backward compat — old code uses EDGE_FUNCTIONS
export const EDGE_FUNCTIONS = DEFAULT_CF_FUNCTIONS;
export type EdgeFunctionName = DefaultCFFunction;

// ---- Dynamic function entry (saved in Firebase) ----
export interface CloudFunction {
  id: string;
  name: string;
  endpoint: string;          // path segment or full URL
  method: "GET" | "POST" | "GET/POST";
  description?: string;
  apiKey?: string;            // optional API key appended to requests
  enabled: boolean;
  addedAt: number;
}

export interface EdgeRouterConfig {
  platform: "cloudflare" | "lovable";
  cloudflareBaseUrl: string;
  functions: Record<string, CloudFunction>;
  // Legacy compat
  denoBaseUrl?: string;
  perFunction?: Record<string, string>;
}

const DEFAULT_CONFIG: EdgeRouterConfig = {
  platform: "cloudflare",
  cloudflareBaseUrl: "",
  functions: {},
};

let cachedConfig: EdgeRouterConfig | null = null;
let cacheTime = 0;
const CACHE_TTL = 120_000;

export async function getEdgeRouterConfig(): Promise<EdgeRouterConfig> {
  const now = Date.now();
  if (cachedConfig && now - cacheTime < CACHE_TTL) return cachedConfig;

  try {
    const snap = await get(ref(db, "settings/edgeRouter"));
    const val = snap.val();
    if (val) {
      cachedConfig = {
        platform: val.platform === "deno" ? "cloudflare" : (val.platform || "cloudflare"),
        cloudflareBaseUrl: val.cloudflareBaseUrl || val.denoBaseUrl || DEFAULT_CONFIG.cloudflareBaseUrl,
        functions: val.functions || {},
      };
    } else {
      cachedConfig = DEFAULT_CONFIG;
    }
    cacheTime = now;
    return cachedConfig!;
  } catch {
    return cachedConfig || DEFAULT_CONFIG;
  }
}

/** Build URL for a function endpoint */
export function buildFunctionUrl(endpoint: string, config: EdgeRouterConfig): string {
  if (endpoint.startsWith("http://") || endpoint.startsWith("https://")) return endpoint;

  if (config.cloudflareBaseUrl) {
    return `${config.cloudflareBaseUrl.replace(/\/$/, "")}/${endpoint}`;
  }
  console.warn(`[EdgeRouter] No base URL — "${endpoint}" disabled`);
  return "";
}

const SELF_DEPLOYED_FUNCTIONS = new Set([
  
  "video-proxy",
  "video-download",
  "live-tv-proxy",
  "telegram-post",
  "comment-bridge",
  "apk-download",
  "link-share-bot",
  "shorten-arolinks",
  "an-api",
  "an-playback",
  "verify-admin-pin",
]);

const KNOWN_FUNCTION_NAMES = new Set([
  ...SELF_DEPLOYED_FUNCTIONS,
  "generate-backdrop",
  "lovable-backdrop",
  "rs-bot",
  "send-otp-email",
  "process-email-queue",
  "episode",
  "hls",
]);

export function normalizeFunctionEndpointUrl(fnName: string, rawUrl: string): string {
  const trimmed = String(rawUrl || "").trim();
  if (!/^https?:\/\//i.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    const parts = url.pathname.split("/").filter(Boolean);
    const functionsIdx = parts.findIndex((part, idx) => part === "functions" && parts[idx + 1] === "v1");

    if (functionsIdx >= 0) {
      const fnIdx = functionsIdx + 2;
      const currentFn = parts[fnIdx] || "";
      // IMPORTANT: a pasted URL is the source of truth. The deployed function
      // may be named ANYTHING (e.g. `generate-anime-art` for the backdrop row),
      // so we only fill in the slug when the path has no function segment, or
      // when the admin clearly pasted a DIFFERENT known function of this app.
      if (!currentFn) {
        parts[fnIdx] = fnName;
      } else if (currentFn !== fnName && KNOWN_FUNCTION_NAMES.has(currentFn)) {
        parts[fnIdx] = fnName;
      }
      // Function base URLs must stop at `/functions/v1/<name>`;
      // query params are appended later by callers.
      parts.splice(fnIdx + 1);

      url.pathname = `/${parts.join("/")}`;
      url.search = "";
      url.hash = "";
      return url.toString().replace(/\/+$/, "");
    }

    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return trimmed;
  }
}

export function buildSelfHostedFunctionUrl(fnName: string, baseUrl?: string): string {
  const base = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!base || !/^https?:\/\//i.test(base)) return "";
  return normalizeFunctionEndpointUrl(fnName, `${base}/${fnName}`);
}

function deriveFromEgdDeployerUrl(deployerUrl: string, fnName: string): string {
  const u = String(deployerUrl || "").trim();
  if (!/^https?:\/\//i.test(u)) return "";
  try {
    const url = new URL(u);
    const match = url.pathname.match(/^(.*\/functions\/v1\/)[^/]+(?:\/.*)?$/i);
    url.pathname = match
      ? `${match[1]}${fnName}`
      : `${url.pathname.replace(/\/+$/, "")}/functions/v1/${fnName}`;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

/** Get URL for a named function — checks per-function overrides first */
export async function getEdgeFunctionUrl(fnName: string): Promise<string> {
  // generate-backdrop uses GEMINI_API_KEY inside the user's EGD-deployed
  // project only. Never allow stale app overrides or Lovable fallbacks here.
  if (fnName === "generate-backdrop") {
    try {
      const egdSnap = await get(ref(db, "egdManager/config/deployerUrl"));
      return deriveFromEgdDeployerUrl(egdSnap.val() || "", fnName);
    } catch {
      return "";
    }
  }

  // Easy Router is the only runtime source of truth. A Default button merely
  // pastes a URL into the same field; no implicit base URL or backend fallback
  // may bypass an empty/disabled row.
  try {
    const overrideSnap = await get(ref(db, `settings/functionOverrides/${fnName}`));
    const override = overrideSnap.val();
    if (override?.enabled !== false) {
      const customUrl = String(override?.customUrl || override?.url || "").trim();
      if (customUrl) {
        return normalizeFunctionEndpointUrl(fnName, customUrl);
      }
    }
  } catch {}

  return "";
}

/** Call a cloud function */
export async function callEdgeFunction(
  fnName: string,
  body: Record<string, any>,
  options?: { method?: string; headers?: Record<string, string>; queryParams?: Record<string, string> }
): Promise<any> {
  let url = await getEdgeFunctionUrl(fnName);
  const method = options?.method || "POST";

  if (!url) throw new Error(`Cloud function ${fnName} is not configured in EGD Router`);

  if (options?.queryParams) {
    url += `?${new URLSearchParams(options.queryParams).toString()}`;
  }

  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: method !== "GET" ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) throw new Error(`Cloud function ${fnName} failed: ${res.status}`);

  const ct = res.headers.get("Content-Type") || "";
  return ct.includes("application/json") ? res.json() : res;
}

// Alias for backward compat
export const callCloudFunction = callEdgeFunction;

/** Live status check */
export async function checkFunctionStatus(
  endpoint: string,
  _platformOrBaseUrl?: string,
  baseUrl?: string
): Promise<{ alive: boolean; latency: number; status: number }> {
  // Handle old 3-arg signature: checkFunctionStatus(fn, platform, baseUrl)
  const resolvedBase = baseUrl || _platformOrBaseUrl || "";
  const url = endpoint.startsWith("http")
    ? endpoint
    : resolvedBase
      ? `${resolvedBase.replace(/\/$/, "")}/${endpoint}`
      : endpoint;

  const start = Date.now();
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, { method: "GET", signal: controller.signal });
    clearTimeout(t);
    return { alive: res.status < 500, latency: Date.now() - start, status: res.status };
  } catch {
    return { alive: false, latency: Date.now() - start, status: 0 };
  }
}

/** Get built-in description */
function getBuiltInDescription(fn: string): string {
  const d: Record<string, string> = {
    "animesalt": "AnimeSalt scraper",
  };
  return d[fn] || fn;
}

/** Get all functions (built-in + dynamic) */
export async function getAllFunctions(): Promise<CloudFunction[]> {
  const config = await getEdgeRouterConfig();
  const builtIn: CloudFunction[] = DEFAULT_CF_FUNCTIONS.map(fn => ({
    id: `builtin-${fn}`,
    name: fn,
    endpoint: fn,
    method: "POST" as CloudFunction["method"],
    description: getBuiltInDescription(fn),
    enabled: true,
    addedAt: 0,
  }));
  const dynamic = Object.values(config.functions || {});
  return [...builtIn, ...dynamic];
}
