import { db, ref, get } from "@/lib/firebase";
import { SITE_URL } from "@/lib/siteConfig";
import { callEdgeFunction } from "@/lib/edgeFunctionRouter";

type MaybeString = string | null | undefined;

export interface SendWebPushInput {
  title: string;
  body: string;
  type?: string;
  contentId?: MaybeString;
  contentType?: MaybeString;
  image?: MaybeString;
  userIds?: string[];
  tokens?: string[];
  url?: MaybeString;
  extraData?: Record<string, string | number | boolean | null | undefined>;
}

export interface AdminNotificationTargets {
  adminIds: string[];
  inboxUserIds: string[];
  tokens: string[];
}

const uniq = (items: MaybeString[]) => [...new Set(items.map((item) => String(item || "").trim()).filter(Boolean))];

export const buildContentUrl = (contentId?: MaybeString) => {
  if (!contentId) return SITE_URL;
  return `${SITE_URL}/?anime=${encodeURIComponent(String(contentId))}`;
};

export async function sendWebPush({
  title,
  body,
  type,
  contentId,
  contentType,
  image,
  userIds,
  tokens,
  url,
  extraData,
}: SendWebPushInput) {
  const data: Record<string, string> = {};
  if (type) data.type = type;
  if (contentId) {
    data.key = String(contentId);
    data.contentId = String(contentId);
    data.url = url || buildContentUrl(contentId);
  }
  if (contentType) data.contentType = String(contentType);
  if (extraData) {
    Object.entries(extraData).forEach(([key, value]) => {
      if (value == null) return;
      data[key] = String(value);
    });
  }

  const payload: Record<string, unknown> = { title, body, data };
  if (image) {
    payload.image = image;
    payload.imageUrl = image;
  }
  if (userIds?.length) payload.userIds = uniq(userIds);
  if (tokens?.length) payload.tokens = uniq(tokens);

  return callEdgeFunction("send-fcm", payload);
}

export async function getAdminNotificationTargets(): Promise<AdminNotificationTargets> {
  const adminSnap = await get(ref(db, "admin"));
  const adminData = adminSnap.val() || {};
  const notificationTargets = typeof adminData === "object" ? adminData?.notificationTargets || {} : {};
  const adminIds = uniq([
    typeof adminData === "string" ? adminData : "",
    typeof adminData === "object" ? adminData?.userId || "" : "",
    typeof adminData === "object" ? adminData?.email || "" : "",
    ...(Array.isArray(notificationTargets?.userIds) ? notificationTargets.userIds : []),
  ]);
  const tokens = uniq(Array.isArray(notificationTargets?.tokens) ? notificationTargets.tokens : []);
  const inboxUserIds = adminIds.filter((value) => !value.includes("@") && !value.includes(",") && !value.includes("."));

  return { adminIds, inboxUserIds, tokens };
}