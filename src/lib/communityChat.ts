import { db, ref, query, limitToLast, onValue, push, set, remove, get, update, orderByChild, equalTo } from "@/lib/firebase";
import {
  activeWords, banActive, containsLink, findBadWord, isCeoEmail, parseSettings, slowModeWaitMs, formatCountdown, banRemainingMs,
  DEFAULT_CHAT_SETTINGS, type ChatBan, type ChatMember, type ChatMention, type ChatSettings, type ChatWarning,
} from "@/lib/chatModeration";
import { readDisplayName, readProfilePhoto } from "@/lib/localUser";
import { isGuestRecord } from "@/lib/guestPersistence";

/**
 * Global community chat (Firebase RTDB, same account identity as the rest of the app).
 *   communityChat/global/{pushId}      = ChatMessage (public room, newest 150 loaded)
 *   communityChat/voice/{mediaId}      = { d: data URL, t }  (fetched over REST on play)
 *   communityChat/stickers/{uid}/{id}  = { url, t }          (a member's own sticker pack)
 * Only text, image, voice and sticker messages exist — video is never accepted.
 */
export const CHAT_ROOM_PATH = "communityChat/global";
export const CHAT_KINDS = ["text", "image", "voice", "sticker"] as const;
export type ChatKind = (typeof CHAT_KINDS)[number];
export const MAX_TEXT = 2000;
export const MAX_VOICE_SECONDS = 60;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export type ChatProfile = { id: string; name: string; photo: string; ceo?: boolean };
export type ChatReply = { id: string; name: string; preview: string; uid?: string };
export type ChatMessage = {
  id: string;
  uid: string;
  name: string;
  photo: string;
  kind: ChatKind;
  t: number;
  text?: string;
  image?: string;
  voice?: string;
  dur?: number;
  sticker?: string;
  reply?: ChatReply;
  edited?: number;
  ceo?: boolean;
};
export type ChatDraft =
  | { kind: "text"; text: string }
  | { kind: "image"; image: string; text?: string }
  | { kind: "voice"; voice: string; dur: number }
  | { kind: "sticker"; sticker: string };

export const BUILT_IN_STICKERS = ["😂", "🤣", "😍", "🥰", "😭", "😡", "🤯", "😱", "😎", "🤔", "🙏", "👍", "👏", "🔥", "💯", "❤️", "💔", "🎉", "😴", "🤡", "👀", "💀", "🫡", "🥳", "😈", "🥺", "😤", "🤩", "😏", "🙄", "🤗", "🤫", "😵‍💫", "🫠", "🐱", "🐶", "🦊", "🐼", "🌸", "⚡", "🍿", "🎬", "👑", "✨"];

export function cleanChatText(value: string) {
  const text = String(value || "").replace(/\r\n/g, "\n").trim();
  if (text.length > MAX_TEXT) throw new Error("Message is too long");
  return text;
}
export const isHttpsUrl = (value: string) => /^https:\/\/[^\s]+$/i.test(String(value || ""));
const isEmojiSticker = (value: string) => BUILT_IN_STICKERS.includes(value);
const isVideoUrl = (value: string) => /\.(mp4|mkv|webm|mov|m3u8|avi)(\?|#|$)/i.test(value);

/** Validates a draft into the stored shape; throws for anything not allowed (e.g. video). */
export function buildMessage(sender: ChatProfile, draft: ChatDraft, reply?: ChatReply | null, now = Date.now()): Omit<ChatMessage, "id"> {
  if (!sender?.id) throw new Error("Sign in to chat");
  const base = { uid: sender.id, name: sender.name.slice(0, 60) || "Member", photo: isHttpsUrl(sender.photo) ? sender.photo : "", t: now, ...(sender.ceo ? { ceo: true } : {}) };
  const replyPart = reply?.id ? { reply: { id: reply.id, name: reply.name.slice(0, 60), preview: reply.preview.slice(0, 120), ...(reply.uid ? { uid: reply.uid } : {}) } } : {};
  if (!draft || !(CHAT_KINDS as readonly string[]).includes(draft.kind)) throw new Error("Unsupported message type");
  if (draft.kind === "text") {
    const text = cleanChatText(draft.text);
    if (!text) throw new Error("Message is empty");
    return { ...base, kind: "text", text, ...replyPart };
  }
  if (draft.kind === "image") {
    if (!isHttpsUrl(draft.image) || isVideoUrl(draft.image)) throw new Error("Invalid image");
    const text = cleanChatText(draft.text || "");
    return { ...base, kind: "image", image: draft.image, ...(text ? { text } : {}), ...replyPart };
  }
  if (draft.kind === "voice") {
    if (!/^[A-Za-z0-9_-]{6,40}$/.test(draft.voice)) throw new Error("Invalid voice note");
    const dur = Math.round(Number(draft.dur) || 0);
    if (dur < 1 || dur > MAX_VOICE_SECONDS) throw new Error("Voice note length is invalid");
    return { ...base, kind: "voice", voice: draft.voice, dur, ...replyPart };
  }
  const sticker = String(draft.sticker || "");
  if (!isEmojiSticker(sticker) && !(isHttpsUrl(sticker) && !isVideoUrl(sticker))) throw new Error("Invalid sticker");
  return { ...base, kind: "sticker", sticker, ...replyPart };
}

export function messagePreview(message: Pick<ChatMessage, "kind" | "text" | "dur" | "sticker">) {
  if (message.kind === "text") return (message.text || "").replace(/\s+/g, " ").slice(0, 120);
  if (message.kind === "image") return message.text ? `🖼 ${message.text.replace(/\s+/g, " ").slice(0, 100)}` : "🖼 Photo";
  if (message.kind === "voice") return `🎤 Voice message${message.dur ? ` · ${formatDuration(message.dur)}` : ""}`;
  return isEmojiSticker(message.sticker || "") ? `${message.sticker} Sticker` : "Sticker";
}
export function formatDuration(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Signed-in (non-guest) account from the app's own login; guests can read but not send. */
export function currentChatProfile(): ChatProfile | null {
  try {
    const user = JSON.parse(localStorage.getItem("rsanime_user") || "null");
    const id = String(user?.id || "");
    if (!id || /[.#$[\]/]/.test(id) || isGuestRecord(id, user || {})) return null;
    const name = String(readDisplayName(id) || user?.name || "Member").trim();
    const photo = String(readProfilePhoto(id) || user?.profilePhoto || user?.photoUrl || user?.avatar || "");
    return { id, name, photo: isHttpsUrl(photo) ? photo : "", ...(isCeoEmail(user?.email) ? { ceo: true } : {}) };
  } catch { return null; }
}

const parseRow = (id: string | null, row: any): ChatMessage | null => {
  if (!id || !row || typeof row !== "object" || !row.uid || !(CHAT_KINDS as readonly string[]).includes(row.kind)) return null;
  return { ...row, id, name: String(row.name || "Member"), photo: String(row.photo || ""), t: Number(row.t) || 0 };
};

export function subscribeChat(receive: (messages: ChatMessage[]) => void, error: () => void) {
  return onValue(query(ref(db, CHAT_ROOM_PATH), limitToLast(150)), snapshot => {
    const rows: ChatMessage[] = [];
    snapshot.forEach(child => { const row = parseRow(child.key, child.val()); if (row) rows.push(row); });
    receive(rows);
  }, error);
}

// ---------- moderation state (settings, my ban, slow mode) ----------
let settingsCache: ChatSettings = DEFAULT_CHAT_SETTINGS;
export function subscribeChatSettings(receive: (s: ChatSettings) => void) {
  return onValue(ref(db, "communityChat/settings"), snap => { settingsCache = parseSettings(snap.val()); receive(settingsCache); }, () => receive(settingsCache));
}
export const chatSettingsNow = () => settingsCache;
export function subscribeBan(uid: string, receive: (ban: ChatBan | null) => void) {
  return onValue(ref(db, `communityChat/bans/${uid}`), snap => { const v = snap.val(); receive(v && typeof v === "object" ? { until: Number(v.until) || 0, reason: String(v.reason || ""), by: String(v.by || ""), t: Number(v.t) || 0, name: v.name } : null); }, () => receive(null));
}
export function subscribeBans(receive: (rows: (ChatBan & { uid: string })[]) => void) {
  return onValue(ref(db, "communityChat/bans"), snap => {
    const rows: (ChatBan & { uid: string })[] = [];
    snap.forEach(c => { const v = c.val(); if (v) rows.push({ uid: String(c.key), until: Number(v.until) || 0, reason: String(v.reason || ""), by: String(v.by || ""), t: Number(v.t) || 0, name: v.name }); });
    receive(rows.filter(b => banActive(b)).sort((a, b) => b.t - a.t));
  }, () => receive([]));
}
export function subscribeMembers(receive: (rows: ChatMember[]) => void) {
  return onValue(ref(db, "communityChat/members"), snap => {
    const rows: ChatMember[] = [];
    snap.forEach(c => { const v = c.val(); if (v) rows.push({ uid: String(c.key), name: String(v.name || "Member"), photo: String(v.photo || ""), last: Number(v.last) || 0, count: Number(v.count) || 0 }); });
    receive(rows.sort((a, b) => b.last - a.last));
  }, () => receive([]));
}
const LAST_SENT_KEY = "rs_chat_last_sent";
export const lastSentAt = () => Number(localStorage.getItem(LAST_SENT_KEY)) || 0;

export class ChatBlockedError extends Error { constructor(message: string, public kind: "ban" | "slow" | "filter" | "link") { super(message); } }

/** Throws ChatBlockedError when this text may not be sent; bad words trigger the auto-ban. */
async function screenText(sender: ChatProfile, text: string) {
  if (sender.ceo || !text) return;
  const s = settingsCache;
  if (s.blockLinks && containsLink(text)) throw new ChatBlockedError("Links are not allowed in Global Chat", "link");
  const bad = findBadWord(text, activeWords(s));
  if (bad) {
    if (s.autoBanSeconds > 0) await banMember(sender.id, s.autoBanSeconds * 1000, "Abusive language (auto filter)", "Auto filter", sender.name);
    throw new ChatBlockedError(s.autoBanSeconds > 0 ? `Abusive words are not allowed — you are muted for ${formatCountdown(s.autoBanSeconds * 1000)}` : "Abusive words are not allowed", "filter");
  }
}
async function assertCanSend(sender: ChatProfile) {
  if (sender.ceo) return;
  const ban = (await get(ref(db, `communityChat/bans/${sender.id}`))).val() as ChatBan | null;
  if (banActive(ban)) throw new ChatBlockedError(ban!.until === 0 ? "You are permanently banned from Global Chat" : `You are muted for ${formatCountdown(banRemainingMs(ban))}`, "ban");
  const wait = slowModeWaitMs(lastSentAt(), settingsCache.slowModeSeconds);
  if (wait > 0) throw new ChatBlockedError(`Slow mode — wait ${Math.ceil(wait / 1000)}s`, "slow");
}

export async function sendChatMessage(draft: ChatDraft, reply?: ChatReply | null) {
  const sender = currentChatProfile();
  if (!sender) throw new Error("Sign in to chat");
  const row = buildMessage(sender, draft, reply);
  await assertCanSend(sender);
  await screenText(sender, row.text || "");
  const node = push(ref(db, CHAT_ROOM_PATH));
  await set(node, row);
  try { localStorage.setItem(LAST_SENT_KEY, String(row.t)); } catch {}
  const memberRef = ref(db, `communityChat/members/${sender.id}`);
  void get(memberRef).then(s => set(memberRef, { name: sender.name, photo: sender.photo, last: row.t, count: (Number(s.val()?.count) || 0) + 1 })).catch(() => {});
  // Reply = tag: the replied member gets a red badge until they open the chat.
  if (reply?.uid && reply.uid !== sender.id) {
    void set(ref(db, `communityChat/mentions/${reply.uid}/${node.key}`), { from: sender.name, preview: messagePreview(row as ChatMessage).slice(0, 120), t: row.t }).catch(() => {});
  }
  return String(node.key);
}

export async function editOwnMessage(message: ChatMessage, nextText: string) {
  const me = currentChatProfile();
  if (!me || me.id !== message.uid) throw new Error("Not allowed");
  const text = cleanChatText(nextText);
  if (!text && message.kind === "text") throw new Error("Message is empty");
  if (text === (message.text || "")) return;
  await screenText(me, text);
  await update(ref(db, `${CHAT_ROOM_PATH}/${message.id}`), { text: text || null, edited: Date.now() });
}

export async function deleteMessage(message: ChatMessage) {
  const me = currentChatProfile();
  if (!me || (me.id !== message.uid && !me.ceo)) throw new Error("Not allowed");
  await remove(ref(db, `${CHAT_ROOM_PATH}/${message.id}`));
  if (message.voice) void remove(ref(db, `communityChat/voice/${message.voice}`)).catch(() => {});
}
/** @deprecated kept name for callers; CEO may delete anyone's message. */
export const deleteOwnMessage = deleteMessage;

/** Deletes every message (text, photo, voice, sticker) a member ever sent. */
export async function purgeMemberMessages(uid: string) {
  const snap = await get(query(ref(db, CHAT_ROOM_PATH), orderByChild("uid"), equalTo(uid)));
  const patch: Record<string, null> = {};
  snap.forEach(c => { patch[`${CHAT_ROOM_PATH}/${c.key}`] = null; const v = c.val(); if (v?.voice) patch[`communityChat/voice/${v.voice}`] = null; });
  if (Object.keys(patch).length) await update(ref(db), patch);
  return Object.keys(patch).filter(k => k.startsWith(CHAT_ROOM_PATH)).length;
}

export async function banMember(uid: string, durationMs: number | "permanent", reason: string, by: string, name?: string) {
  const permanent = durationMs === "permanent";
  await set(ref(db, `communityChat/bans/${uid}`), { until: permanent ? 0 : Date.now() + durationMs, reason: reason || "", by, t: Date.now(), ...(name ? { name } : {}) });
  if (permanent) await purgeMemberMessages(uid);
}
export async function unbanMember(uid: string) { await remove(ref(db, `communityChat/bans/${uid}`)); }

export async function warnMember(uid: string, text: string, by: string) {
  await push(ref(db, `communityChat/warnings/${uid}`), { text: text.slice(0, 500), by, t: Date.now(), seen: false });
}
export function subscribeWarnings(uid: string, receive: (rows: ChatWarning[]) => void) {
  return onValue(ref(db, `communityChat/warnings/${uid}`), snap => {
    const rows: ChatWarning[] = [];
    snap.forEach(c => { const v = c.val(); if (v) rows.push({ id: String(c.key), text: String(v.text || ""), by: String(v.by || ""), t: Number(v.t) || 0, seen: !!v.seen }); });
    receive(rows.sort((a, b) => a.t - b.t));
  }, () => receive([]));
}
export async function markWarningsSeen(uid: string, ids: string[]) {
  const patch: Record<string, boolean> = {};
  ids.forEach(id => { patch[`communityChat/warnings/${uid}/${id}/seen`] = true; });
  if (ids.length) await update(ref(db), patch);
}

export function subscribeMentions(uid: string, receive: (rows: ChatMention[]) => void) {
  return onValue(ref(db, `communityChat/mentions/${uid}`), snap => {
    const rows: ChatMention[] = [];
    snap.forEach(c => { const v = c.val(); if (v) rows.push({ id: String(c.key), from: String(v.from || ""), preview: String(v.preview || ""), t: Number(v.t) || 0 }); });
    receive(rows.sort((a, b) => b.t - a.t));
  }, () => receive([]));
}
export async function clearMentions(uid: string) { await remove(ref(db, `communityChat/mentions/${uid}`)); }

const blobToDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ""));
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

export async function uploadVoice(blob: Blob): Promise<string> {
  if (!/^audio\//.test(blob.type || "audio/webm")) throw new Error("Only audio is allowed");
  if (blob.size > 900 * 1024) throw new Error("Voice note is too large");
  const data = await blobToDataUrl(blob);
  const node = push(ref(db, "communityChat/voice"));
  await set(node, { d: data, t: Date.now() });
  return String(node.key);
}

const voiceCache = new Map<string, Promise<string>>();
/** Voice notes are read over REST (never the realtime socket) and kept as object URLs. */
export function loadVoice(id: string): Promise<string> {
  if (!voiceCache.has(id)) {
    const base = String((db.app.options as { databaseURL?: string }).databaseURL || "").replace(/\/$/, "");
    const job = fetch(`${base}/communityChat/voice/${encodeURIComponent(id)}/d.json`)
      .then(res => { if (!res.ok) throw new Error("Voice unavailable"); return res.json(); })
      .then(async (data: unknown) => {
        if (typeof data !== "string" || !data.startsWith("data:audio/")) throw new Error("Voice unavailable");
        return URL.createObjectURL(await (await fetch(data)).blob());
      });
    job.catch(() => voiceCache.delete(id));
    voiceCache.set(id, job);
  }
  return voiceCache.get(id)!;
}

export function subscribeMyStickers(uid: string, receive: (urls: { id: string; url: string }[]) => void) {
  return onValue(ref(db, `communityChat/stickers/${uid}`), snapshot => {
    const rows: { id: string; url: string; t: number }[] = [];
    snapshot.forEach(child => { const v = child.val(); if (v && isHttpsUrl(v.url)) rows.push({ id: String(child.key), url: v.url, t: Number(v.t) || 0 }); });
    receive(rows.sort((a, b) => b.t - a.t));
  }, () => receive([]));
}
export async function addMySticker(uid: string, url: string) {
  if (!isHttpsUrl(url) || isVideoUrl(url)) throw new Error("Invalid sticker");
  await push(ref(db, `communityChat/stickers/${uid}`), { url, t: Date.now() });
}
export async function removeMySticker(uid: string, id: string) {
  await remove(ref(db, `communityChat/stickers/${uid}/${id}`));
}

/** Stable per-member name color slot (1..7) for the Telegram-style colored names. */
export function nameColorSlot(uid: string) {
  let hash = 0;
  for (let i = 0; i < uid.length; i++) hash = (hash * 31 + uid.charCodeAt(i)) >>> 0;
  return (hash % 7) + 1;
}
