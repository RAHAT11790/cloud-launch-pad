import { auth, db, ref, query, limitToLast, onValue, push, set } from "@/lib/firebase";
import { readDisplayName, readProfilePhoto } from "@/lib/localUser";

// Fail closed: enable only after the namespaced RTDB rules have been deployed
// and authenticated/unauthenticated access has been verified on the real DB.
export const CHAT_SECURITY_READY = false;
export type ChatProfile = { id: string; name: string; photo: string };
export type ChatMessage = { id: string; sender: ChatProfile; text: string; timestamp: number; image?: string; movieId?: string };
export function privateRoomId(a: string, b: string) {
  if (!a || !b || a === b || /[.#$\[\]/]/.test(a + b)) throw new Error("Invalid participant");
  return [a, b].sort().map(encodeURIComponent).join("~");
}
export function cleanChatText(value: string) {
  const text = value.trim();
  if (text.length > 2000) throw new Error("Message is too long");
  return text;
}
export function currentChatProfile(): ChatProfile | null {
  const user = auth.currentUser;
  if (!user || user.isAnonymous) return null;
  return { id: user.uid, name: readDisplayName(user.uid) || user.displayName || "Member", photo: readProfilePhoto(user.uid) || user.photoURL || "" };
}
export function subscribeChat(room: string, receive: (messages: ChatMessage[]) => void, error: () => void) {
  if (!CHAT_SECURITY_READY) { receive([]); return () => {}; }
  return onValue(query(ref(db, `communityChat/messages/${room}`), limitToLast(100)), snapshot => {
    const rows: ChatMessage[] = [];
    snapshot.forEach(child => { const row = child.val(); if (row?.sender?.id && typeof row.text === "string") rows.push({ ...row, id: child.key }); });
    receive(rows);
  }, error);
}
export async function sendChatMessage(room: string, text: string, attachment: { image?: string; movieId?: string } = {}, recipient?: ChatProfile) {
  if (!CHAT_SECURITY_READY) throw new Error("Chat security setup is pending");
  const sender = currentChatProfile();
  if (!sender) throw new Error("A verified sign-in is required");
  const cleaned = cleanChatText(text);
  if (!cleaned && !attachment.image && !attachment.movieId) return;
  if (attachment.image && !/^https:\/\//.test(attachment.image)) throw new Error("Invalid image");
  if (room !== "global") {
    if (!recipient || room !== privateRoomId(sender.id, recipient.id)) throw new Error("Invalid conversation");
    await set(ref(db, `communityChat/rooms/${room}`), { members: { [sender.id]: true, [recipient.id]: true } });
  }
  await set(ref(db, `communityChat/profiles/${sender.id}`), sender);
  await push(ref(db, `communityChat/messages/${room}`), { sender, text: cleaned, timestamp: Date.now(), ...attachment });
}