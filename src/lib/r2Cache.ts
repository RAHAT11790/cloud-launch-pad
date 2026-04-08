// ============================================
// R2 Video Cache Client
// ============================================
// Firebase থেকে R2 bucket config পড়ে
// Edge function এর মাধ্যমে ক্যাশ চেক/আপলোড করে

import { db, ref, onValue, get } from "@/lib/firebase";

export interface R2BucketConfig {
  id: string;
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  publicUrl: string;
  s3Endpoint: string;
  enabled: boolean;
}

export interface R2CacheSettings {
  enabled: boolean;
  maxSizeMB: number;
  cacheHours: number;
  activeHoursStart: number; // 6 = 6 AM
  activeHoursEnd: number;   // 0 = 12 AM (midnight)
  edgeFunctionUrl: string;
  buckets: R2BucketConfig[];
}

const DEFAULT_SETTINGS: R2CacheSettings = {
  enabled: false,
  maxSizeMB: 300,
  cacheHours: 12,
  activeHoursStart: 6,
  activeHoursEnd: 0,
  edgeFunctionUrl: "",
  buckets: [],
};

let cachedSettings: R2CacheSettings | null = null;

export function subscribeR2Settings(cb: (settings: R2CacheSettings) => void): () => void {
  const unsub = onValue(ref(db, "settings/r2Cache"), (snap) => {
    const val = snap.val();
    if (val) {
      const buckets: R2BucketConfig[] = [];
      if (val.buckets) {
        Object.entries(val.buckets).forEach(([id, b]: any) => {
          if (b.enabled !== false) {
            buckets.push({ ...b, id });
          }
        });
      }
      cachedSettings = {
        enabled: val.enabled !== false,
        maxSizeMB: val.maxSizeMB || 300,
        cacheHours: val.cacheHours || 12,
        activeHoursStart: val.activeHoursStart ?? 6,
        activeHoursEnd: val.activeHoursEnd ?? 0,
        edgeFunctionUrl: val.edgeFunctionUrl || "",
        buckets,
      };
    } else {
      cachedSettings = DEFAULT_SETTINGS;
    }
    cb(cachedSettings);
  });
  return unsub;
}

export async function getR2Settings(): Promise<R2CacheSettings> {
  if (cachedSettings) return cachedSettings;
  const snap = await get(ref(db, "settings/r2Cache"));
  const val = snap.val();
  if (!val) return DEFAULT_SETTINGS;
  const buckets: R2BucketConfig[] = [];
  if (val.buckets) {
    Object.entries(val.buckets).forEach(([id, b]: any) => {
      if (b.enabled !== false) {
        buckets.push({ ...b, id });
      }
    });
  }
  cachedSettings = {
    enabled: val.enabled !== false,
    maxSizeMB: val.maxSizeMB || 300,
    cacheHours: val.cacheHours || 12,
    activeHoursStart: val.activeHoursStart ?? 6,
    activeHoursEnd: val.activeHoursEnd ?? 0,
    edgeFunctionUrl: val.edgeFunctionUrl || "",
    buckets,
  };
  return cachedSettings;
}

function isActiveHours(settings: R2CacheSettings): boolean {
  const hour = new Date().getHours();
  const start = settings.activeHoursStart;
  const end = settings.activeHoursEnd;
  // e.g. start=6, end=0 means 6AM to midnight
  if (end === 0) return hour >= start;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

// Check if a video URL is cached in R2
export async function checkR2Cache(videoUrl: string): Promise<string | null> {
  const settings = await getR2Settings();
  if (!settings.enabled || !settings.edgeFunctionUrl || settings.buckets.length === 0) return null;
  if (!isActiveHours(settings)) return null;

  try {
    const res = await fetch(settings.edgeFunctionUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "check",
        videoUrl,
        buckets: settings.buckets,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.cached && data.url) return data.url;
    return null;
  } catch {
    return null;
  }
}

// Trigger background upload of a video to R2
export async function triggerR2Upload(videoUrl: string, sourceUrl?: string): Promise<void> {
  const settings = await getR2Settings();
  if (!settings.enabled || !settings.edgeFunctionUrl || settings.buckets.length === 0) return;
  if (!isActiveHours(settings)) return;

  try {
    // Fire and forget — don't block playback
    fetch(settings.edgeFunctionUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "upload",
        videoUrl,
        sourceUrl,
        buckets: settings.buckets,
        maxSizeMB: settings.maxSizeMB,
      }),
    }).catch(() => {});
  } catch {}
}

// Trigger cleanup of old cached files
export async function triggerR2Cleanup(): Promise<{ deleted: number } | null> {
  const settings = await getR2Settings();
  if (!settings.edgeFunctionUrl || settings.buckets.length === 0) return null;

  try {
    const res = await fetch(settings.edgeFunctionUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "cleanup",
        buckets: settings.buckets,
      }),
    });
    if (res.ok) return await res.json();
    return null;
  } catch {
    return null;
  }
}

// Check bucket health
export async function checkR2Status(): Promise<any[]> {
  const settings = await getR2Settings();
  if (!settings.edgeFunctionUrl || settings.buckets.length === 0) return [];

  try {
    const res = await fetch(settings.edgeFunctionUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "status",
        buckets: settings.buckets,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      return data.results || [];
    }
    return [];
  } catch {
    return [];
  }
}
