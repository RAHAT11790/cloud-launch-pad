// ============================================
// Edge Function Router — Cloudflare Workers + Lovable Cloud
// ============================================
// Firebase settings/edgeRouter থেকে config পড়ে
// Cloudflare Worker বা Lovable Cloud URL ব্যবহার করে ফাংশন কল করে
// ডাইনামিকভাবে নতুন ফাংশন যোগ করা যায়

import { db, ref, get } from "@/lib/firebase";

// ---- Default built-in Cloudflare Worker endpoints ----
export const DEFAULT_CF_FUNCTIONS = [
  "telegram-post",
  "shorten",
  "send-fcm",
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
const CACHE_TTL = 30_000;

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

/** Get URL for a named function — checks per-function overrides first */
export async function getEdgeFunctionUrl(fnName: string): Promise<string> {
  // Check per-function override from Firebase
  try {
    const overrideSnap = await get(ref(db, `settings/functionOverrides/${fnName}`));
    const override = overrideSnap.val();
    if (override?.enabled === false) return "";
    if (override?.customUrl) return override.customUrl;
  } catch {}

  const config = await getEdgeRouterConfig();
  // Check dynamic functions first
  const dynFn = Object.values(config.functions).find(f => f.name === fnName || f.endpoint === fnName);
  if (dynFn) return buildFunctionUrl(dynFn.endpoint, config);
  return buildFunctionUrl(fnName, config);
}

/** Call a cloud function */
export async function callEdgeFunction(
  fnName: string,
  body: Record<string, any>,
  options?: { method?: string; headers?: Record<string, string>; queryParams?: Record<string, string> }
): Promise<any> {
  let url = await getEdgeFunctionUrl(fnName);
  const method = options?.method || "POST";

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
    "telegram-post": "Send Telegram message",
    "shorten": "URL shortener",
    "animesalt": "AnimeSalt scraper",
    "send-fcm": "Push notification sender",
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
