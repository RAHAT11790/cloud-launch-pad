// ============================================================
// Edge Function Code Library
// ============================================================
// Central registry of every deployable Supabase Edge Function in the
// project, with its source code (loaded via Vite `?raw` import) and the
// list of secrets the user must populate when deploying it to their own
// Supabase project from the admin panel.
//
// Functions whose secrets/values cannot be re-created outside Lovable
// (e.g. the AI Gateway proxy) are intentionally excluded.
// ============================================================

import videoProxySource from "../../supabase/functions/video-proxy/index.ts?raw";
import videoDownloadSource from "../../supabase/functions/video-download/index.ts?raw";
import telegramPostSource from "../../supabase/functions/telegram-post/index.ts?raw";
import rsBotSource from "../../supabase/functions/rs-bot/index.ts?raw";
import sendOtpEmailSource from "../../supabase/functions/send-otp-email/index.ts?raw";
import processEmailQueueSource from "../../supabase/functions/process-email-queue/index.ts?raw";
import apkDownloadSource from "../../supabase/functions/apk-download/index.ts?raw";
import linkShareBotSource from "../../supabase/functions/link-share-bot/index.ts?raw";
import shortenArolinksSource from "../../supabase/functions/shorten-arolinks/index.ts?raw";
import generateBackdropSource from "../../supabase/functions/generate-backdrop/index.ts?raw";

export type EdgeFnLibraryEntry = {
  slug: string;          // Supabase function slug — also the URL path segment
  label: string;         // Friendly button label
  description: string;   // Short Bengali description
  source: string;        // index.ts content
  secrets: string[];     // Required secret names (user must fill before deploy)
};

// Regex auto-detects Deno.env.get("XXX") references and offers them as
// secret input fields. Anything starting with SUPABASE_ is provided by
// the platform and stripped.
const RESERVED_PREFIXES = ["SUPABASE_", "SB_"];
function autoDetectSecrets(source: string, extra: string[] = []): string[] {
  const found = new Set<string>(extra);
  const re = /Deno\.env\.get\(\s*["']([A-Z0-9_]+)["']\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const name = m[1];
    if (RESERVED_PREFIXES.some((p) => name.startsWith(p))) continue;
    found.add(name);
  }
  return Array.from(found).sort();
}

const entry = (
  slug: string,
  label: string,
  description: string,
  source: string,
  extraSecrets: string[] = [],
): EdgeFnLibraryEntry => ({
  slug,
  label,
  description,
  source,
  secrets: autoDetectSecrets(source, extraSecrets),
});

export const EDGE_FUNCTION_LIBRARY: EdgeFnLibraryEntry[] = [
  entry("video-download", "Video Download", "Dedicated, retry-hardened download proxy (recommended for downloads).", videoDownloadSource),
  entry("video-proxy",    "Video Proxy",    "Universal streaming proxy used by the video player.", videoProxySource),
  entry("telegram-post",  "Telegram Post",  "Posts new episodes to your Telegram channel.", telegramPostSource),
  entry("rs-bot",         "RS Bot (AI)",    "In-app AI chat — requires LOVABLE_API_KEY.", rsBotSource),
  entry("send-otp-email", "Send OTP Email", "Sends 6-digit OTP via Resend.", sendOtpEmailSource),
  entry("process-email-queue", "Process Email Queue", "Background queue worker that flushes pending OTP emails.", processEmailQueueSource),
  entry("apk-download",   "APK Download",   "Serves the user-facing APK with proper headers.", apkDownloadSource),
  entry("link-share-bot", "Link Share Bot", "Telegram bot for shareable unlock / access links.", linkShareBotSource),
  entry("shorten-arolinks", "Shorten Arolinks", "Generic shortener proxy used by ad services.", shortenArolinksSource),
  entry("generate-backdrop", "Generate Backdrop", "AI backdrop generator for missing anime art.", generateBackdropSource),
];

export const getLibraryEntry = (slug: string) =>
  EDGE_FUNCTION_LIBRARY.find((e) => e.slug === slug);
