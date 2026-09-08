import { db, ref, onValue } from "@/lib/firebase";

/**
 * Telegram deep-link builder (spec-compliant).
 *
 *   {BOT_URL}?start=ep_{season}_{episode_spec}_{quality_spec}_{title_hash}
 *
 *  - season       : 2 digits                         -> 01
 *  - episode_spec : 05 | 1-24 | 2,4-6,9 (compacted)
 *  - quality_spec : 480p-720p-1080p | all
 *  - title_hash   : first 8 hex chars of SHA1(title.trim().toLowerCase())
 *
 * Telegram allows max 64 chars in ?start= and only [A-Za-z0-9_-].
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

// ---------------------------------------------------------------------------
// SHA-1 (synchronous, UTF-8) — must match the bot's hash byte-for-byte.
// ---------------------------------------------------------------------------
const utf8Bytes = (input: string): number[] => {
  const out: number[] = [];
  for (let i = 0; i < input.length; i += 1) {
    let code = input.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < input.length) {
      const next = input.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = ((code - 0xd800) << 10) + (next - 0xdc00) + 0x10000;
        i += 1;
      }
    }
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return out;
};

const rotl = (n: number, s: number) => ((n << s) | (n >>> (32 - s))) >>> 0;

export const sha1Hex = (input: string): string => {
  const bytes = utf8Bytes(input);
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const hi = Math.floor(bitLen / 0x100000000);
  const lo = bitLen >>> 0;
  bytes.push((hi >>> 24) & 0xff, (hi >>> 16) & 0xff, (hi >>> 8) & 0xff, hi & 0xff);
  bytes.push((lo >>> 24) & 0xff, (lo >>> 16) & 0xff, (lo >>> 8) & 0xff, lo & 0xff);

  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Array<number>(80);

  for (let i = 0; i < bytes.length; i += 64) {
    for (let j = 0; j < 16; j += 1) {
      w[j] = ((bytes[i + j * 4] << 24) | (bytes[i + j * 4 + 1] << 16) | (bytes[i + j * 4 + 2] << 8) | bytes[i + j * 4 + 3]) >>> 0;
    }
    for (let j = 16; j < 80; j += 1) w[j] = rotl(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1);

    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let j = 0; j < 80; j += 1) {
      let f: number;
      let k: number;
      if (j < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
      else if (j < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
      else if (j < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else { f = b ^ c ^ d; k = 0xca62c1d6; }
      const temp = (rotl(a, 5) + (f >>> 0) + e + k + w[j]) >>> 0;
      e = d; d = c; c = rotl(b, 30); b = a; a = temp;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }

  return [h0, h1, h2, h3, h4].map((n) => n.toString(16).padStart(8, "0")).join("");
};

/** First 8 hex chars of SHA1(title.trim().toLowerCase()) */
export const telegramTitleHash = (title: string): string => {
  const normalized = String(title || "").trim().toLowerCase();
  if (!normalized) return "";
  return sha1Hex(normalized).slice(0, 8);
};

/** "1080P" | "1080" -> "1080p"; "4K" | "2160p" -> "4k" */
export const normalizeTelegramQuality = (value: string): string => {
  const raw = String(value || "").trim().toLowerCase().replace(/\s+/g, "");
  if (raw === "all") return "all";
  if (raw === "4k" || raw === "2160p" || raw === "2160") return "4k";
  const match = raw.match(/(\d{3,4})/);
  if (match) {
    if (match[1] === "2160") return "4k";
    return `${match[1]}p`;
  }
  return raw;
};

const QUALITY_ORDER = ["480p", "720p", "1080p", "4k"];

export const sortTelegramQualities = (values: string[]): string[] => {
  const cleaned = Array.from(new Set(values.map(normalizeTelegramQuality).filter(Boolean)));
  if (cleaned.includes("all")) return ["all"];
  return cleaned
    .filter((q) => QUALITY_ORDER.includes(q))
    .sort((a, b) => QUALITY_ORDER.indexOf(a) - QUALITY_ORDER.indexOf(b));
};

const pad2 = (n: number) => String(Math.max(0, Math.trunc(n))).padStart(2, "0");

/** Compact list into the shortest valid episode_spec: 05 | 1-5 | 2,4-6,9 */
export const buildTelegramEpisodeSegment = (episodes: number[]): string => {
  const list = Array.from(new Set(episodes.map((n) => Math.trunc(Number(n))).filter((n) => Number.isFinite(n) && n > 0)))
    .sort((a, b) => a - b);
  if (list.length === 0) return "";
  if (list.length === 1) return pad2(list[0]);

  const parts: string[] = [];
  let start = list[0];
  let prev = list[0];
  const flush = () => {
    if (start === prev) parts.push(String(start));
    else if (prev === start + 1) parts.push(`${start},${prev}`);
    else parts.push(`${start}-${prev}`);
  };
  for (let i = 1; i < list.length; i += 1) {
    if (list[i] === prev + 1) { prev = list[i]; continue; }
    flush();
    start = list[i];
    prev = list[i];
  }
  flush();
  return parts.join(",");
};

export type TelegramDownloadRequest = {
  botUrl?: string;
  title: string;
  season: number;
  episodes: number[];
  qualities: string[];
};

/** The `?start=` payload only (without the bot url). Empty when invalid. */
export const buildTelegramStartPayload = ({
  title,
  season,
  episodes,
  qualities,
}: Omit<TelegramDownloadRequest, "botUrl">): string => {
  const hash = telegramTitleHash(title);
  if (!hash) return "";
  let epSegment = buildTelegramEpisodeSegment(episodes);
  if (!epSegment) return "";
  const qualitySegment = sortTelegramQualities(qualities).join("-");
  if (!qualitySegment) return "";
  const seasonSegment = pad2(Number(season) > 0 ? Number(season) : 1);

  const make = (eps: string) => `ep_${seasonSegment}_${eps}_${qualitySegment}_${hash}`;
  let payload = make(epSegment);
  if (payload.length > 64) {
    // Collapse to a single inclusive range rather than truncating.
    const nums = episodes.map((n) => Math.trunc(Number(n))).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
    epSegment = `${nums[0]}-${nums[nums.length - 1]}`;
    payload = make(epSegment);
  }
  if (payload.length > 64) return "";
  // Telegram allows commas in start payloads is NOT guaranteed — spec allows
  // only [A-Za-z0-9_-]; convert any comma list into a plain range.
  if (!/^[A-Za-z0-9_-]+$/.test(payload)) {
    const nums = episodes.map((n) => Math.trunc(Number(n))).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
    payload = make(nums.length === 1 ? pad2(nums[0]) : `${nums[0]}-${nums[nums.length - 1]}`);
  }
  if (payload.length > 64 || !/^[A-Za-z0-9_-]+$/.test(payload)) return "";
  return payload;
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
  const payload = buildTelegramStartPayload({ title, season, episodes, qualities });
  if (!payload) return "";
  return `${base}?start=${payload}`;
};
