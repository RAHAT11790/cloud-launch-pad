// ============================================================
// Edge Function Code Library
// ============================================================
// Central registry of every deployable Supabase Edge Function in the
// project, with its source code (loaded via Vite `?raw` import) and the
// list of secrets the user must populate when deploying it to their own
// Supabase project from the admin panel.
//
// Library sources are self-deployable from EGD Manager; no Lovable-only
// private API keys are required by these entries.
// ============================================================

import videoProxySource from "../../supabase/functions/video-proxy/index.ts?raw";

import liveTvProxySource from "../../supabase/functions/live-tv-proxy/index.ts?raw";
import videoDownloadSource from "../../supabase/functions/video-download/index.ts?raw";
import telegramPostSource from "../../supabase/functions/telegram-post/index.ts?raw";
import apkDownloadSource from "../../supabase/functions/apk-download/index.ts?raw";
import linkShareBotSource from "../../supabase/functions/link-share-bot/index.ts?raw";
import shortenArolinksSource from "../../supabase/functions/shorten-arolinks/index.ts?raw";
// generate-backdrop is removed — backdrop AI now runs on Lovable Cloud
// via the auto-deployed `lovable-backdrop` edge function.

import anApiSource from "../../supabase/functions/an-api/index.ts?raw";
import anPlaybackSource from "../../supabase/functions/an-playback/index.ts?raw";
import verifyAdminPinSource from "../../supabase/functions/verify-admin-pin/index.ts?raw";
import iosProtectionSource from "../../supabase/functions/ios-protection/index.ts?raw";
import adShieldSource from "../../supabase/functions/ad-shield/index.ts?raw";


export type EdgeFnLibraryEntry = {
  slug: string;          // Supabase function slug — also the URL path segment
  label: string;         // Friendly button label
  description: string;   // Short Bengali description
  source: string;        // index.ts content
  secrets: string[];     // Required secret names (user must fill before deploy)
  isNew?: boolean;       // Only current update gets a NEW badge
  badgeText?: string;    // Custom badge text overriding NEW
  badgeTone?: "emerald" | "cyan" | "amber"; // Badge color tone
};

// Regex auto-detects Deno.env.get("XXX") references and offers them as
// secret input fields. Anything starting with SUPABASE_ is provided by
// the platform and stripped.
const RESERVED_PREFIXES = ["SUPABASE_", "SB_"];
// Detect ONLY truly-required env vars. A var is OPTIONAL if every occurrence in
// the source has a fallback via `?? "..."` or `|| "..."` (or `?? '...'`).
function autoDetectSecrets(source: string, extra: string[] = []): string[] {
  const required = new Set<string>(extra);
  const optional = new Set<string>();
  // Capture each env.get and the immediate suffix so we can see fallbacks.
  const re = /Deno\.env\.get\(\s*["']([A-Z0-9_]+)["']\s*\)\s*(\?\?|\|\|)?\s*(["'`][^"'`\n]*["'`])?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const name = m[1];
    if (RESERVED_PREFIXES.some((p) => name.startsWith(p))) continue;
    const hasFallback = !!(m[2] && m[3]);
    if (hasFallback) {
      if (!required.has(name)) optional.add(name);
    } else {
      required.add(name);
      optional.delete(name);
    }
  }
  return Array.from(required).sort();
}

const entry = (
  slug: string,
  label: string,
  description: string,
  source: string,
  extraSecrets: string[] = [],
  options: { isNew?: boolean; badgeText?: string; badgeTone?: "emerald" | "cyan" | "amber" } = {},
): EdgeFnLibraryEntry => ({
  slug,
  label,
  description,
  source,
  secrets: autoDetectSecrets(source, extraSecrets),
  isNew: options.isNew,
  badgeText: options.badgeText,
  badgeTone: options.badgeTone,
});

// Only functions the admin self-deploys via EGD Manager are listed here.
// Lovable-managed functions (rs-bot, send-otp-email, process-email-queue)
// are permanently hidden from this deployable library.

export const EDGE_FUNCTION_LIBRARY: EdgeFnLibraryEntry[] = [
  entry("video-proxy",    "Video Proxy",    "⚡ v9 ADAPTIVE-WINDOW BUILD (Supabase/Deno) — 1MB first window for instant start, 6MB steady (12MB on https), 7s header timeout, same-origin-Referer-first so HTTP mirrors answer on the first try. Fixes 'proxy down / video never loads'. Redeploy and paste the URL into EGD Router → video-proxy.", videoProxySource, [], { isNew: true, badgeText: "v9 · NEW", badgeTone: "amber" }),
  entry("ad-shield",      "Ad Shield",      "🛡️ ANTI-ADBLOCK GATEWAY — first-party relay for every ad script/asset (/s, /t), unblockable control probe (/probe, /px) and edge-side reachability oracle (/check) that exposes AdGuard DNS / NextDNS / Pi-hole / Brave / AdBlock browsers. The home-page Ad-Blocker Gate uses this to prove a block instead of guessing. Attach the URL here and the whole anti-adblock system switches on.", adShieldSource, [], { isNew: true, badgeText: "AD SHIELD · NEW", badgeTone: "amber" }),
  entry("ios-protection", "iOS Protection", "🍏 iPhone / iPad / Safari playback gateway. Fixes wrong MIME types, serves '.mkv' files whose real container is MP4 as video/mp4 so Safari plays them natively, normalises byte-range responses, rewrites HLS playlists, and reports true Matroska with 415 so the player fails over instantly. Attach it once here — the player uses it for EVERY video server on iOS only.", iosProtectionSource, [], { isNew: true, badgeText: "iOS · NEW", badgeTone: "cyan" }),
  entry("an-api",         "AN Fetch API", "AnimeSalt fetch/index API only: anime-only browse/search filter, all seasons/episodes/details extraction, Hindi-first stream/audio extraction, and short-lived link discovery for Firebase/localStorage cache refresh.", anApiSource, [], { badgeText: "AN FETCH", badgeTone: "emerald" }),
  entry("an-playback",    "AN Playback API", "Playback-only AnimeSalt HLS proxy: playlist/segment CORS, range streaming, and CDN-safe headers. Use for user-panel video playback after links are cached.", anPlaybackSource, [], { badgeText: "AN PLAYBACK", badgeTone: "cyan" }),
  entry("video-download", "Video Download", "Dedicated, retry-hardened download proxy (recommended for downloads).", videoDownloadSource),
  entry("live-tv-proxy",  "Live TV Proxy",  "Dedicated HLS proxy for Live TV channels.", liveTvProxySource),
  entry("telegram-post",  "Telegram Post",  "Posts new episodes to your Telegram channel.", telegramPostSource),
  entry("apk-download",   "APK Download",   "Serves the user-facing APK with proper headers.", apkDownloadSource),
  entry("link-share-bot", "Link Share Bot", "Telegram bot for shareable unlock / access links.", linkShareBotSource),
  entry("shorten-arolinks", "Shorten Arolinks", "Generic shortener proxy used by ad services.", shortenArolinksSource),
  entry("verify-admin-pin", "Verify Admin PIN", "Server-side admin PIN verifier. Set ADMIN_PIN secret in your own deployment to control the admin panel PIN privately. Without deploying this, the project default PIN is used.", verifyAdminPinSource, ["ADMIN_PIN"]),

];

export const getLibraryEntry = (slug: string) =>
  EDGE_FUNCTION_LIBRARY.find((e) => e.slug === slug);
