import { toast } from "sonner";

import { isInTelegramWebView, openExternalBrowser } from "@/lib/openExternal";
import { SUPABASE_URL } from "@/lib/siteConfig";

const isHttpUrl = (value: string) => /^https?:\/\//i.test(value);

export function buildApkProxyUrl(rawUrl: string): string | null {
  const trimmedUrl = rawUrl.trim();
  if (!trimmedUrl || !isHttpUrl(trimmedUrl) || !SUPABASE_URL) return null;

  return `${SUPABASE_URL}/functions/v1/apk-download?url=${encodeURIComponent(trimmedUrl)}`;
}

export function triggerApkDownload(rawUrl: string, fileName?: string): boolean {
  const proxyUrl = buildApkProxyUrl(rawUrl);

  if (!proxyUrl) {
    toast.error("Download link is invalid");
    return false;
  }

  if (isInTelegramWebView()) {
    openExternalBrowser(proxyUrl);
    return true;
  }

  const link = document.createElement("a");
  link.href = proxyUrl;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  if (fileName) link.download = fileName;

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  return true;
}