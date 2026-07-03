// ============================================================
// Cloudflare Worker Code Library
// ============================================================
// Every entry here is a self-contained CF Module Worker (`export default
// { fetch }`) that the admin can 1-click deploy to their Cloudflare
// account via the CF Manager. Secrets are auto-detected from
// `env.XXX` usage inside each script.
// ============================================================

import videoProxySrc    from "../../cloudflare-workers/video-proxy.js?raw";
import liveTvProxySrc   from "../../cloudflare-workers/live-tv-proxy.js?raw";
import videoDownloadSrc from "../../cloudflare-workers/video-download.js?raw";
import apkDownloadSrc   from "../../cloudflare-workers/apk-download.js?raw";
import shortenArolinksSrc from "../../cloudflare-workers/shorten-arolinks.js?raw";
import telegramPostSrc  from "../../cloudflare-workers/telegram-post.js?raw";

export type CfLibraryEntry = {
  slug: string;
  label: string;
  description: string;
  source: string;
  secrets: string[];
  isNew?: boolean;
  badgeText?: string;
  badgeTone?: "emerald" | "cyan" | "amber";
};

// Detect only truly-required env vars — same rule as Supabase library:
// a var is optional if every `env.XXX` reference has `||`/`??` fallback.
function detectSecrets(src: string, extra: string[] = []): string[] {
  const required = new Set<string>(extra);
  const optional = new Set<string>();
  const re = /env\.([A-Z0-9_]+)\s*(\|\||\?\?)?\s*(["'`][^"'`\n]*["'`])?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const name = m[1];
    const hasFallback = !!(m[2] && m[3]);
    if (hasFallback) { if (!required.has(name)) optional.add(name); }
    else { required.add(name); optional.delete(name); }
  }
  return Array.from(required).sort();
}

const entry = (
  slug: string, label: string, description: string, source: string,
  extra: string[] = [], opts: Partial<CfLibraryEntry> = {},
): CfLibraryEntry => ({
  slug, label, description, source,
  secrets: detectSecrets(source, extra),
  ...opts,
});

export const CF_WORKER_LIBRARY: CfLibraryEntry[] = [
  entry("video-proxy",     "Video Proxy",     "Universal HLS/video proxy with playlist rewriting, range streaming and multi-attempt referrer/origin fallback. Unlimited bandwidth on Cloudflare.", videoProxySrc, [], { isNew: true, badgeText: "UNLIMITED", badgeTone: "emerald" }),
  entry("live-tv-proxy",   "Live TV Proxy",   "Dedicated HLS proxy for Live TV — isolates streaming bandwidth from the main video proxy.", liveTvProxySrc),
  entry("video-download",  "Video Download",  "Hardened attachment-mode download proxy with retries and clean headers.", videoDownloadSrc),
  entry("apk-download",    "APK Download",    "Serves the user APK from a private origin with correct MIME + range support. Requires APK_URL secret.", apkDownloadSrc, ["APK_URL"]),
  entry("shorten-arolinks","Shorten Arolinks","Arolinks shortener proxy. Requires AROLINKS_API_KEY secret.", shortenArolinksSrc, ["AROLINKS_API_KEY"]),
  entry("telegram-post",   "Telegram Post",   "Posts new episodes / notifications to your Telegram channel via Bot API.", telegramPostSrc, ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"]),
];

export const getCfLibraryEntry = (slug: string) =>
  CF_WORKER_LIBRARY.find((e) => e.slug === slug);

// Manager Worker source is bundled separately so users can copy-paste it
// straight from the setup screen without hunting for the file.
export { default as CF_MANAGER_WORKER_CODE } from "../../cloudflare-worker/cf-manager-worker.js?raw";
