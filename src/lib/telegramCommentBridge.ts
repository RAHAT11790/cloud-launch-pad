// Fire-and-forget bridge: website comment → admin Telegram group.
// The `telegram-post` worker forwards it and lets the admin answer with /rs.
import { getEdgeFunctionUrl } from "@/lib/edgeFunctionRouter";

export interface TelegramCommentPayload {
  animeId: string;
  commentId: string;
  userId?: string;
  userName?: string;
  isGuest?: boolean;
  text: string;
  title?: string;
  parentId?: string;
}

export async function forwardCommentToTelegram(p: TelegramCommentPayload): Promise<void> {
  try {
    const url = await getEdgeFunctionUrl("telegram-post");
    if (!url) return;
    const pageUrl =
      typeof window !== "undefined"
        ? `${window.location.origin}/?anime=${encodeURIComponent(p.animeId)}#comments`
        : undefined;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "comment", ...p, pageUrl }),
    });
  } catch {
    // silent — comment is already saved
  }
}
