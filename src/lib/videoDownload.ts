import { toast } from "sonner";

import { isInTelegramWebView, openExternalBrowser } from "@/lib/openExternal";
import { SUPABASE_URL } from "@/lib/siteConfig";
import { db, ref, onValue } from "@/lib/firebase";

const isHttpUrl = (value: string) => /^https?:\/\//i.test(value);

const buildSafeFileName = (rawName: string) => {
  const cleaned = String(rawName || "video")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const withExt = /\.[a-z0-9]{2,5}$/i.test(cleaned) ? cleaned : `${cleaned}.mp4`;
  return withExt || "video.mp4";
};

// ----- Live-updating override URL for the download proxy --------------------
// Admin can override the default `video-download` Supabase URL in:
//   Firebase → settings/functionOverrides/video-download.customUrl
// We subscribe once at module load and keep the latest value in memory so
// buildVideoDownloadUrl() can stay synchronous (VideoPlayer probes need that).
let overrideBaseUrl = "";
let overrideEnabled = true;
try {
  if (typeof window !== "undefined") {
    onValue(ref(db, "settings/functionOverrides/video-download"), (snap) => {
      const v = snap.val() || {};
      overrideBaseUrl = String(v.customUrl || "").trim();
      overrideEnabled = v.enabled !== false;
    });
  }
} catch {}

const defaultBase = (): string => {
  if (!SUPABASE_URL) return "";
  return `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/video-download`;
};

const resolveBaseSync = (): string => {
  if (overrideEnabled && overrideBaseUrl) return overrideBaseUrl.replace(/\/+$/, "");
  return defaultBase();
};

/**
 * Build the dedicated `video-download` proxy URL. Stays synchronous so it can
 * be used inside render paths and HEAD probes. Picks up admin URL overrides
 * live via the Firebase subscription above.
 */
export function buildVideoDownloadUrl(rawUrl: string, rawFileName: string): string | null {
  const trimmedUrl = String(rawUrl || "").trim();
  if (!trimmedUrl || !isHttpUrl(trimmedUrl)) return null;
  const base = resolveBaseSync();
  if (!base) return null;
  const fileName = buildSafeFileName(rawFileName);
  return `${base}?filename=${encodeURIComponent(fileName)}&url=${encodeURIComponent(trimmedUrl)}`;
}

function openDownloadLink(finalUrl: string, fileName: string) {
  if (isInTelegramWebView()) { openExternalBrowser(finalUrl); return; }
  const link = document.createElement("a");
  link.href = finalUrl;
  link.rel = "noopener noreferrer";
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Iframe-based download trigger. Used for batch/bulk downloads so the browser
 * does NOT show the "Allow multiple downloads" / battery prompt for every
 * additional file. Each download lives in its own short-lived iframe, which
 * Chrome treats as a separate document context and bypasses the prompt.
 */
function openDownloadViaIframe(finalUrl: string) {
  try {
    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.src = finalUrl;
    document.body.appendChild(iframe);
    // Remove after browser has had time to start the download.
    setTimeout(() => {
      try { document.body.removeChild(iframe); } catch {}
    }, 10_000);
  } catch {
    // Fallback to anchor click if iframe creation fails.
    const link = document.createElement("a");
    link.href = finalUrl;
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

/**
 * Route every download through the dedicated `video-download` edge function.
 * That function adds:
 *  - upstream retries (no more ERR_INVALID_RESPONSE in the browser)
 *  - clean Content-Disposition with the chosen filename
 *  - HTTP origin support on an HTTPS app (no mixed-content block)
 *  - JSON-formatted errors instead of raw broken bytes
 */
export function triggerBackgroundVideoDownload(rawUrl: string, rawFileName: string): boolean {
  const trimmedUrl = String(rawUrl || "").trim();
  if (!trimmedUrl || !isHttpUrl(trimmedUrl)) {
    toast.error("Download link is invalid");
    return false;
  }
  const fileName = buildSafeFileName(rawFileName);
  const finalUrl = buildVideoDownloadUrl(trimmedUrl, fileName);
  if (!finalUrl) {
    toast.error("Download service is unavailable");
    return false;
  }
  openDownloadLink(finalUrl, fileName);
  return true;
}

/**
 * Fire MANY downloads in a single user gesture without spamming the browser's
 * "Allow multiple downloads" / battery prompt.
 *
 * Strategy:
 *  - First download → standard anchor click (so the user sees one prompt,
 *    if any, that grants permission for the rest).
 *  - Subsequent downloads → hidden iframes, fired with tiny 80ms gaps so
 *    Chrome groups them with the first gesture and does NOT re-prompt.
 *
 * Pass an array of { url, fileName } in the order you want them downloaded.
 * Returns the number of downloads that were actually triggered.
 */
export function triggerBulkBackgroundDownloads(
  items: Array<{ url: string; fileName: string }>,
): number {
  if (!Array.isArray(items) || items.length === 0) return 0;

  const valid = items
    .map((it) => {
      const u = String(it?.url || "").trim();
      if (!u || !isHttpUrl(u)) return null;
      const fn = buildSafeFileName(it?.fileName || "video");
      const final = buildVideoDownloadUrl(u, fn);
      return final ? { final, fn } : null;
    })
    .filter((x): x is { final: string; fn: string } => !!x);

  if (valid.length === 0) {
    toast.error("No downloadable links found");
    return 0;
  }

  // First one via anchor (carries the user-gesture, gets the one-shot prompt).
  const [head, ...rest] = valid;
  openDownloadLink(head.final, head.fn);

  // Rest via iframes, staggered by 80ms so the browser treats them as a
  // single batch and does NOT show a separate prompt for each file.
  rest.forEach((entry, idx) => {
    setTimeout(() => openDownloadViaIframe(entry.final), 80 * (idx + 1));
  });

  return valid.length;
}
