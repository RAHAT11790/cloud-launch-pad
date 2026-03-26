// ============================================
// Edge Function Router — Lovable Cloud ↔ Deno Deploy
// ============================================
// Firebase settings/edgeRouter থেকে config পড়ে
// সক্রিয় প্ল্যাটফর্ম অনুযায়ী URL তৈরি করে

import { db, ref, get } from "@/lib/firebase";
import { SUPABASE_URL } from "@/lib/siteConfig";

export const EDGE_FUNCTIONS = [
  "video-proxy",
  "shorten-link",
  "send-fcm",
  "scrape-animesalt",
  "clean-embed",
  "send-telegram-post",
  "welcome-tts",
  "live-chat",
] as const;

export type EdgeFunctionName = typeof EDGE_FUNCTIONS[number];

export interface EdgeRouterConfig {
  platform: "lovable" | "deno"; // global default
  denoBaseUrl: string; // e.g. https://my-project.deno.dev
  perFunction: Record<string, "lovable" | "deno" | "auto">; // per-function override
}

const DEFAULT_CONFIG: EdgeRouterConfig = {
  platform: "lovable",
  denoBaseUrl: "",
  perFunction: {},
};

let cachedConfig: EdgeRouterConfig | null = null;
let cacheTime = 0;
const CACHE_TTL = 30_000; // 30s

export async function getEdgeRouterConfig(): Promise<EdgeRouterConfig> {
  const now = Date.now();
  if (cachedConfig && now - cacheTime < CACHE_TTL) return cachedConfig;

  try {
    const snap = await get(ref(db, "settings/edgeRouter"));
    const val = snap.val();
    if (val) {
      cachedConfig = { ...DEFAULT_CONFIG, ...val };
    } else {
      cachedConfig = DEFAULT_CONFIG;
    }
    cacheTime = now;
    return cachedConfig!;
  } catch {
    return cachedConfig || DEFAULT_CONFIG;
  }
}

/**
 * একটি edge function-এর সক্রিয় URL বের করে
 */
export async function getEdgeFunctionUrl(fnName: EdgeFunctionName): Promise<string> {
  const config = await getEdgeRouterConfig();
  const fnPlatform = config.perFunction[fnName] || "auto";
  
  let activePlatform: "lovable" | "deno";
  if (fnPlatform === "auto") {
    activePlatform = config.platform;
  } else {
    activePlatform = fnPlatform;
  }

  if (activePlatform === "deno" && config.denoBaseUrl) {
    // Deno Deploy format: https://base-url.deno.dev/function-name
    const base = config.denoBaseUrl.replace(/\/$/, "");
    return `${base}/${fnName}`;
  }

  // Default: Lovable Cloud (Supabase)
  return `${SUPABASE_URL}/functions/v1/${fnName}`;
}

/**
 * Edge function call করার হেল্পার — platform অনুযায়ী URL রাউট করে
 */
export async function callEdgeFunction(
  fnName: EdgeFunctionName,
  body: Record<string, any>,
  options?: { method?: string; headers?: Record<string, string> }
): Promise<any> {
  const url = await getEdgeFunctionUrl(fnName);
  const method = options?.method || "POST";

  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    body: method !== "GET" ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    throw new Error(`Edge function ${fnName} failed: ${res.status}`);
  }

  const contentType = res.headers.get("Content-Type") || "";
  if (contentType.includes("application/json")) {
    return res.json();
  }
  return res;
}

/**
 * Live status check — function URL-এ ping করে response time মাপে
 */
export async function checkFunctionStatus(
  fnName: EdgeFunctionName,
  platform: "lovable" | "deno",
  denoBaseUrl: string
): Promise<{ alive: boolean; latency: number; status: number }> {
  let url: string;
  if (platform === "deno" && denoBaseUrl) {
    url = `${denoBaseUrl.replace(/\/$/, "")}/${fnName}`;
  } else {
    url = `${SUPABASE_URL}/functions/v1/${fnName}`;
  }

  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    
    const res = await fetch(url, {
      method: "OPTIONS",
      signal: controller.signal,
    });
    clearTimeout(timeout);
    
    return {
      alive: res.status < 500,
      latency: Date.now() - start,
      status: res.status,
    };
  } catch {
    return { alive: false, latency: Date.now() - start, status: 0 };
  }
}
