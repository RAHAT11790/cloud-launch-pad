import { db, ref, query, limitToLast, onValue, push, set, remove } from "@/lib/firebase";
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

export type ChatProfile = { id: string; name: string; photo: string };
export type ChatReply = { id: string; name: string; preview: string };
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
};
export type ChatDraft =
  | { kind: "text"; text: string }
  | { kind: "image"; image: string; text?: string }
  | { kind: "voice"; voice: string; dur: number }
  | { kind: "sticker"; sticker: string };

export const BUILT_IN_STICKERS = ["😂", "🤣", "😍", "🥰", "😭", "😡", "🤯", "😱", "😎", "🤔", "🙏", "👍", "👏", "🔥", "💯", "❤️", "💔", "🎉", "😴", "🤡", "👀", "💀", "🫡", "🥳"];

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
  const base = { uid: sender.id, name: sender.name.slice(0, 60) || "Member", photo: isHttpsUrl(sender.photo) ? sender.photo : "", t: now };
  const replyPart = reply?.id ? { reply: { id: reply.id, name: reply.name.slice(0, 60), preview: reply.preview.slice(0, 120) } } : {};
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
    return { id, name, photo: isHttpsUrl(photo) ? photo : "" };
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

export async function sendChatMessage(draft: ChatDraft, reply?: ChatReply | null) {
  const sender = currentChatProfile();
  if (!sender) throw new Error("Sign in to chat");
  const row = buildMessage(sender, draft, reply);
  await push(ref(db, CHAT_ROOM_PATH), row);
}

export async function deleteOwnMessage(message: ChatMessage) {
  const me = currentChatProfile();
  if (!me || me.id !== message.uid) throw new Error("Not allowed");
  await remove(ref(db, `${CHAT_ROOM_PATH}/${message.id}`));
}

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
