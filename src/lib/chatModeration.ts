/**
 * Global chat moderation — pure rules (tested) + Firebase paths.
 *   communityChat/settings          = ChatSettings (admin panel)
 *   communityChat/bans/{uid}        = ChatBan       (until 0 = permanent)
 *   communityChat/warnings/{uid}/id = ChatWarning
 *   communityChat/members/{uid}     = ChatMember    (written on every send)
 *   communityChat/mentions/{uid}/id = ChatMention   (reply-tags; cleared when the chat opens)
 * The RTDB is public, so this is community discipline, not a security boundary.
 */
export const CEO_EMAILS = ["rahatsarker224@gmail.com"];
export const isCeoEmail = (email?: string | null) => !!email && CEO_EMAILS.includes(String(email).trim().toLowerCase());

export type ChatSettings = {
  filterEnabled: boolean;
  customWords: string[];
  blockLinks: boolean;
  slowModeSeconds: number;
  autoBanSeconds: number;
};
export const DEFAULT_CHAT_SETTINGS: ChatSettings = { filterEnabled: true, customWords: [], blockLinks: true, slowModeSeconds: 0, autoBanSeconds: 300 };

export type ChatBan = { until: number; reason: string; by: string; t: number; name?: string };
export type ChatWarning = { id: string; text: string; by: string; t: number; seen?: boolean };
export type ChatMember = { uid: string; name: string; photo: string; last: number; count: number };
export type ChatMention = { id: string; from: string; preview: string; t: number };

/** Default abusive words (English + Bangla script + romanized Bangla). Admin can add more. */
export const DEFAULT_BAD_WORDS = [
  "fuck", "fucker", "fucking", "motherfucker", "bitch", "bastard", "asshole", "dick", "pussy", "cunt", "slut", "whore", "nigger", "nigga", "retard", "shit", "bullshit", "porn", "xxx",
  "মাদারচোদ", "চোদ", "চুদি", "চুদা", "চোদা", "খানকি", "মাগি", "মাগী", "বেশ্যা", "হারামি", "হারামজাদা", "কুত্তার বাচ্চা", "শুয়োরের বাচ্চা", "বোকাচোদা", "জারজ",
  "madarchod", "madarchud", "chod", "chudi", "chuda", "choda", "khanki", "beshya", "harami", "haramjada", "kuttar baccha", "shuorer baccha", "bokachoda", "jaroj", 
];

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i" };
const normalize = (value: string) => String(value || "").toLowerCase()
  .replace(/[013457@$!]/g, c => LEET[c] || c)
  .replace(/(.)\1{2,}/g, "$1$1");
const isLatin = (word: string) => /^[a-z ]+$/.test(word);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Returns the first filtered word found, or "" when the text is clean. */
export function findBadWord(text: string, words: string[]): string {
  const value = normalize(text);
  if (!value) return "";
  const squashed = value.replace(/[^a-z\u0980-\u09ff ]+/g, "");
  for (const raw of words) {
    const word = normalize(raw).trim();
    if (!word) continue;
    if (isLatin(word)) {
      // Whole-word match so "class"/"ball" never trip "ass"/"bal".
      const re = new RegExp(`(^|[^a-z])${escapeRe(word).replace(/ /g, "[\\s._-]*")}($|[^a-z])`);
      if (re.test(value) || re.test(squashed)) return raw;
    } else if (value.includes(word) || squashed.includes(word)) return raw;
  }
  return "";
}
export const activeWords = (s: ChatSettings) => s.filterEnabled ? [...DEFAULT_BAD_WORDS, ...s.customWords] : [...s.customWords];

export function containsLink(text: string) {
  const v = String(text || "").toLowerCase();
  return /(https?:\/\/|www\.|t\.me\/|wa\.me\/|bit\.ly)/.test(v)
    || /\b[a-z0-9-]{2,}\.(com|net|org|io|xyz|me|app|dev|link|site|online|info|co|in|bd|tk|ru|top|live|tv|gg|ly|to)\b/.test(v);
}

/** "30s" / "30m" / "3h" / "2d" → ms; "permanent"/"perm" → "permanent"; otherwise null. */
export function parseBanDuration(value: string): number | "permanent" | null {
  const v = String(value || "").trim().toLowerCase();
  if (v === "permanent" || v === "perm") return "permanent";
  const m = v.match(/^(\d{1,5})\s*(s|sec|m|min|h|hr|d|day)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!n) return null;
  const unit = (m[2] || "m")[0];
  return n * ({ s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as Record<string, number>)[unit];
}

export type ChatCommand =
  | { cmd: "ban"; target: string; duration: number | "permanent"; reason: string }
  | { cmd: "unban"; target: string }
  | { cmd: "warning"; target: string; text: string }
  | { cmd: "invalid"; error: string };

/**
 * `/ban 30m [reason]` · `/ban permanent` · `/unban` · `/warning text` — on a reply, the
 * replied member is the target; without a reply write the ID first: `/ban @ID 3h`.
 */
export function parseChatCommand(input: string, replyUid?: string): ChatCommand | null {
  const text = String(input || "").trim();
  if (!/^\/(ban|unban|warning|warn)\b/i.test(text)) return null;
  const parts = text.split(/\s+/);
  const cmd = parts.shift()!.slice(1).toLowerCase();
  let target = replyUid || "";
  if (parts[0]?.startsWith("@")) target = parts.shift()!.slice(1);
  if (!target) return { cmd: "invalid", error: "Reply to a member's message or write /" + cmd + " @ID" };
  if (cmd === "unban") return { cmd: "unban", target };
  if (cmd === "ban") {
    const duration = parseBanDuration(parts.shift() || "");
    if (duration === null) return { cmd: "invalid", error: "Use /ban 30s, /ban 30m, /ban 3h or /ban permanent" };
    return { cmd: "ban", target, duration, reason: parts.join(" ").slice(0, 200) };
  }
  const body = parts.join(" ").trim().slice(0, 500);
  if (!body) return { cmd: "invalid", error: "Write the warning after /warning" };
  return { cmd: "warning", target, text: body };
}

export const banActive = (ban: ChatBan | null | undefined, now = Date.now()) => !!ban && (ban.until === 0 || ban.until > now);
export const banRemainingMs = (ban: ChatBan | null | undefined, now = Date.now()) => !ban ? 0 : ban.until === 0 ? Infinity : Math.max(0, ban.until - now);
export function formatCountdown(ms: number) {
  if (!Number.isFinite(ms)) return "Permanent";
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}
export function slowModeWaitMs(lastSent: number, seconds: number, now = Date.now()) {
  if (!seconds || !lastSent) return 0;
  return Math.max(0, lastSent + seconds * 1000 - now);
}

export function parseSettings(raw: any): ChatSettings {
  const r = raw && typeof raw === "object" ? raw : {};
  const words = r.customWords && typeof r.customWords === "object" ? Object.values(r.customWords).map(v => String((v as any)?.w ?? v).trim()).filter(Boolean) : [];
  return {
    filterEnabled: r.filterEnabled !== false,
    customWords: words,
    blockLinks: r.blockLinks !== false,
    slowModeSeconds: Math.max(0, Math.min(3600, Number(r.slowModeSeconds) || 0)),
    autoBanSeconds: Math.max(0, Math.min(30 * 86400, r.autoBanSeconds === undefined ? 300 : Number(r.autoBanSeconds) || 0)),
  };
}
