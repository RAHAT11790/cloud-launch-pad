import { toast } from "sonner";

import { isInTelegramWebView, openExternalBrowser } from "@/lib/openExternal";
import { SUPABASE_URL } from "@/lib/siteConfig";

const isHttpUrl = (value: string) => /^https?:\/\//i.test(value);
const isHttpsUrl = (value: string) => /^https:\/\//i.test(value);

const buildSafeFileName = (rawName: string) => {
  const cleaned = String(rawName || "video")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const withExt = /\.[a-z0-9]{2,5}$/i.test(cleaned) ? cleaned : `${cleaned}.mp4`;
  return withExt || "video.mp4";
};

export function buildVideoDownloadUrl(rawUrl: string, rawFileName: string): string | null {
  const trimmedUrl = String(rawUrl || "").trim();
  if (!trimmedUrl || !isHttpUrl(trimmedUrl) || !SUPABASE_URL) return null;

  const fileName = buildSafeFileName(rawFileName);
  return `${SUPABASE_URL}/functions/v1/video-proxy?download=1&filename=${encodeURIComponent(fileName)}&url=${encodeURIComponent(trimmedUrl)}`;
}

async function probeUrlOk(url: string): Promise<boolean> {
  // Quick HEAD probe; if HEAD is blocked, try a 1-byte range GET. We treat any
  // 2xx/3xx as healthy; 4xx/5xx (e.g. Render 502) means the server is dead.
  const tryFetch = async (init: RequestInit) => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      const r = await fetch(url, { ...init, signal: ctrl.signal, mode: "cors" });
      clearTimeout(t);
      return r.ok || (r.status >= 200 && r.status < 400);
    } catch { return false; }
  };
  if (await tryFetch({ method: "HEAD" })) return true;
  if (await tryFetch({ method: "GET", headers: { Range: "bytes=0-0" } })) return true;
  return false;
}

function openDownloadLink(finalUrl: string, fileName: string, newTab: boolean) {
  if (isInTelegramWebView()) { openExternalBrowser(finalUrl); return; }
  const link = document.createElement("a");
  link.href = finalUrl;
  link.rel = "noopener noreferrer";
  link.download = fileName;
  if (newTab) link.target = "_blank";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Downloads always work — never gated by a single proxy.
 *  - HTTPS sources: try the ORIGINAL link directly. If a HEAD probe fails
 *    (e.g. Render returns 502 Bad Gateway), automatically fall back to the
 *    Supabase video-proxy so the download still succeeds.
 *  - HTTP (mixed-content) sources: route through the Supabase proxy from the
 *    start so the browser will accept the response on the HTTPS app.
 */
export function triggerBackgroundVideoDownload(rawUrl: string, rawFileName: string): boolean {
  const trimmedUrl = String(rawUrl || "").trim();
  if (!trimmedUrl || !isHttpUrl(trimmedUrl)) {
    toast.error("Download link is invalid");
    return false;
  }

  const fileName = buildSafeFileName(rawFileName);
  const proxyUrl = buildVideoDownloadUrl(trimmedUrl, fileName);

  if (!isHttpsUrl(trimmedUrl)) {
    // HTTP source — must go through proxy (mixed-content blocked otherwise).
    if (!proxyUrl) { toast.error("Download link is invalid"); return false; }
    openDownloadLink(proxyUrl, fileName, false);
    return true;
  }

  // HTTPS source — try direct first (no proxy bandwidth cost). Probe in the
  // background; if the origin is down, retry through the Supabase proxy so the
  // user never sees a "page isn't working" / 502 dead end.
  openDownloadLink(trimmedUrl, fileName, true);

  if (proxyUrl) {
    probeUrlOk(trimmedUrl).then((ok) => {
      if (ok) return;
      toast.message("Switching server…", { description: "Primary host is down, retrying via backup." });
      openDownloadLink(proxyUrl, fileName, false);
    }).catch(() => {});
  }
  return true;
}
