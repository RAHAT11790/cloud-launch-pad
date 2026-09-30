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
import commentBridgeSrc from "../../cloudflare-workers/comment-bridge.js?raw";
import anApiSrc         from "../../cloudflare-workers/an-api.js?raw";
import anPlaybackSrc    from "../../cloudflare-workers/an-playback.js?raw";
import verifyAdminPinSrc from "../../cloudflare-workers/verify-admin-pin.js?raw";
import animeSearchBotSrc from "../../cloudflare-workers/anime-search-bot.js?raw";
import adShieldSrc from "../../cloudflare-workers/ad-shield.js?raw";


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
  entry("video-proxy",     "Video Proxy",     "⚡ v9 CLOUDFLARE-NATIVE FAST PATH — https ranges pass through untouched (no extra edge hop on seek), only http mirrors are windowed (8MB), CF edge cache for segments, same-origin-Referer-first + 7s header timeout so dead mirrors fail over instantly. Tuned ONLY for Cloudflare — do not mirror the Supabase build here.", videoProxySrc, [], { isNew: true, badgeText: "v9 · CF", badgeTone: "amber" }),

  entry("ad-shield",       "Ad Shield",       "🛡️ ANTI-ADBLOCK GATEWAY (Cloudflare build) — relays ad scripts/assets through YOUR worker domain (/s, /t) so DNS blockers and filter lists have nothing to match, plus /probe, /px and the /check reachability oracle used by the home-page Ad-Blocker Gate. Deploy and paste the URL into EGD Router → ad-shield.", adShieldSrc, [], { isNew: true, badgeText: "AD SHIELD · NEW", badgeTone: "amber" }),
  entry("anime-search-bot","Anime Asset Bot", "🤖 Telegram bot: search any anime → returns backdrop, poster, title-logo URL & title (TMDB). Ultra-professional 🪄 Remove BG per-image (HD transparent PNG, semi-transparent hair edges, auto-crop — powered by remove.bg). Auto-registers webhook on first visit. Secrets: TELEGRAM_BOT_TOKEN + REMOVE_BG_API_KEY.", animeSearchBotSrc, ["TELEGRAM_BOT_TOKEN", "REMOVE_BG_API_KEY"]),
  entry("an-api",          "AN Fetch API",    "AnimeSalt extractor: search, seasons, episodes, and Hindi-first stream/audio discovery. Paste this Worker URL into EGD Router → 'an-api' to route the whole app through Cloudflare.", anApiSrc, [], { isNew: true, badgeText: "NEW", badgeTone: "emerald" }),
  entry("an-playback",     "AN Playback API", "Playback-only AnimeSalt HLS proxy — playlist rewriting, range streaming, CDN-safe headers. Paste into EGD Router → 'an-playback' for unlimited-bandwidth playback.", anPlaybackSrc, [], { isNew: true, badgeText: "NEW", badgeTone: "emerald" }),
  entry("live-tv-proxy",   "Live TV Proxy",   "Dedicated HLS proxy for Live TV — isolates streaming bandwidth from the main video proxy.", liveTvProxySrc),
  entry("video-download",  "Video Download",  "Hardened attachment-mode download proxy with retries and clean headers.", videoDownloadSrc),
  entry("verify-admin-pin","Verify Admin PIN","Server-side admin PIN verifier. Set ADMIN_PIN secret in this Worker to control the admin panel PIN privately.", verifyAdminPinSrc, ["ADMIN_PIN"]),
  entry("apk-download",    "APK Download",    "Serves the user APK from a private origin with correct MIME + range support. Requires APK_URL secret.", apkDownloadSrc, ["APK_URL"]),
  entry("shorten-arolinks","Shorten Arolinks","Arolinks shortener proxy. Requires AROLINKS_API_KEY secret.", shortenArolinksSrc, ["AROLINKS_API_KEY"]),
  entry("telegram-post",   "Telegram Post",   "📮 Channel posts + group link share only. Secrets: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID.", telegramPostSrc, ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"]),
  entry("comment-bridge",  "Comment Bridge Bot", "💬 Standalone bot (use a SEPARATE bot token). Website comments → your Telegram group; reply with `/rs your answer` → it lands in the site's comment thread + push notification. Firebase DB URL is hard-coded inside — you only set 3 values: TELEGRAM_BOT_TOKEN, TELEGRAM_ADMIN_USER_ID, TELEGRAM_COMMENT_GROUP_ID. Open the worker URL once to auto-register the webhook.", commentBridgeSrc, ["TELEGRAM_BOT_TOKEN", "TELEGRAM_ADMIN_USER_ID", "TELEGRAM_COMMENT_GROUP_ID"], { isNew: true, badgeText: "NEW · 3 VALUES", badgeTone: "emerald" }),
];


export const getCfLibraryEntry = (slug: string) =>
  CF_WORKER_LIBRARY.find((e) => e.slug === slug);

// Manager Worker source is bundled separately so users can copy-paste it
// straight from the setup screen without hunting for the file.
export { default as CF_MANAGER_WORKER_CODE } from "../../cloudflare-worker/cf-manager-worker.js?raw";
