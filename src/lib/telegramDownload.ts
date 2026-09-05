import { db, ref, onValue } from "@/lib/firebase";

/**
 * Telegram download link builder.
 *
 * Final format (bot base comes from Admin Panel → Telegram Download):
 *   {BOT_URL}?start=ep_{season}_{episodes}_{qualities}_{Title-With-Dashes}
 *
 * Rules:
 *  - season   : always 2 digits            -> 01, 02, 10
 *  - episodes : single  -> 2 digits        -> 05
 *               multiple-> min-max (plain) -> 1-5
 *  - quality  : lowercase, joined by "-"   -> 480p-720p-1080p (always 480→720→1080→…)
 *  - title    : every space becomes "-"    -> Bottom-Tier-Character-Tomozaki
 *
 * Example:
 *   https://t.me/RS_ANIME_03_BOT?start=ep_01_05_720p_Bottom-Tier-Character-Tomozaki
 *   https://t.me/RS_ANIME_03_BOT?start=ep_01_1-5_480p-720p-1080p_Bottom-Tier-Character-Tomozaki
 */

const TG_BOT_CACHE_KEY = "rs_telegram_bot_url_v1";

let telegramBotUrl = "";
try {
  if (typeof window !== "undefined") {
    telegramBotUrl = String(localStorage.getItem(TG_BOT_CACHE_KEY) || "").trim();
  }
} catch {}

try {
  if (typeof window !== "undefined") {
    onValue(ref(db, "settings/telegramDownload"), (snap) => {
      const val = snap.val() || {};
      const url = String(val?.botUrl || val?.url || "").trim();
      telegramBotUrl = /^https?:\/\//i.test(url) ? url : "";
      try {
        if (telegramBotUrl) localStorage.setItem(TG_BOT_CACHE_KEY, telegramBotUrl);
        else localStorage.removeItem(TG_BOT_CACHE_KEY);
      } catch {}
    });
  }
} catch {}

export const getTelegramBotUrl = () => telegramBotUrl;

export const TELEGRAM_FREE_QUALITIES = ["480P", "720P", "1080P"];

/** "1080P" | "1080p" | "1080" -> "1080p" */
export const normalizeTelegramQuality = (value: string): string => {
  const raw = String(value || "").trim().toLowerCase().replace(/\s+/g, "");
  const match = raw.match(/(\d{3,4})/);
  if (match) return `${match[1]}p`;
  if (raw === "4k" || raw === "2160p") return "2160p";
  return raw;
};

const QUALITY_ORDER = ["480p", "720p", "1080p", "2160p"];

export const sortTelegramQualities = (values: string[]): string[] => {
  const cleaned = Array.from(new Set(values.map(normalizeTelegramQuality).filter(Boolean)));
  return cleaned.sort((a, b) => {
    const ai = QUALITY_ORDER.indexOf(a);
    const bi = QUALITY_ORDER.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
};

/** "Bottom Tier Character Tomozaki!" -> "Bottom-Tier-Character-Tomozaki" */
export const toTelegramTitleSlug = (value: string): string =>
  String(value || "")
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");

const pad2 = (n: number) => String(Math.max(0, Math.trunc(n))).padStart(2, "0");

export const buildTelegramEpisodeSegment = (episodes: number[]): string => {
  const list = Array.from(new Set(episodes.map((n) => Math.trunc(Number(n))).filter((n) => Number.isFinite(n) && n > 0)))
    .sort((a, b) => a - b);
  if (list.length === 0) return "";
  if (list.length === 1) return pad2(list[0]);
  return `${list[0]}-${list[list.length - 1]}`;
};

export type TelegramDownloadRequest = {
  botUrl?: string;
  title: string;
  season: number;
  episodes: number[];
  qualities: string[];
};

export const buildTelegramDownloadUrl = ({
  botUrl,
  title,
  season,
  episodes,
  qualities,
}: TelegramDownloadRequest): string => {
  const base = String(botUrl || telegramBotUrl || "").trim().replace(/\/+$/, "").replace(/\?.*$/, "");
  if (!/^https?:\/\//i.test(base)) return "";
  const slug = toTelegramTitleSlug(title);
  if (!slug) return "";
  const epSegment = buildTelegramEpisodeSegment(episodes);
  if (!epSegment) return "";
  const qualitySegment = sortTelegramQualities(qualities).join("-");
  if (!qualitySegment) return "";
  const seasonSegment = pad2(Number(season) > 0 ? Number(season) : 1);
  return `${base}?start=ep_${seasonSegment}_${epSegment}_${qualitySegment}_${slug}`;
};
