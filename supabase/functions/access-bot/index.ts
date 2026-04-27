import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const SITE_NAME = "RS ANIME";
const SITE_URL = "https://rsanime03.lovable.app";
const MINI_APP_URL = `${SITE_URL}/mini`;
const HERO_IMAGE = "https://i.ibb.co/PsNMKqnT/IMG-20260417-065611-339.jpg";
const AUTO_DELETE_MS = 30_000;
const FB_URL =
  Deno.env.get("FIREBASE_DB_URL") ||
  "https://rs-anime-default-rtdb.firebaseio.com";

type ForceChannel = {
  id?: string;
  chatId?: string;
  label?: string;
  url?: string;
  enabled?: boolean;
  order?: number;
};

type TelegramProfile = {
  id: string;
  telegramId: number;
  chatId: number | string;
  firstName: string;
  lastName: string;
  fullName: string;
  username: string;
  photoFileId?: string;
  photoFilePath?: string;
  updatedAt: number;
};

async function fbGet(path: string) {
  const r = await fetch(`${FB_URL}/${path}.json`);
  if (!r.ok) return null;
  return await r.json();
}

async function fbPut(path: string, value: unknown) {
  await fetch(`${FB_URL}/${path}.json`, {
    method: "PUT",
    body: JSON.stringify(value),
  });
}

async function fbPatch(path: string, value: unknown) {
  await fetch(`${FB_URL}/${path}.json`, {
    method: "PATCH",
    body: JSON.stringify(value),
  });
}

const escapeHtml = (value: string) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

async function tgCall(botToken: string, method: string, payload?: unknown) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: payload ? "POST" : "GET",
    headers: payload ? { "Content-Type": "application/json" } : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.description || `${method} failed`);
  }
  return data?.result;
}

async function getBotSettings() {
  const [botUsernameRaw, shortNameRaw] = await Promise.all([
    fbGet("settings/telegramMiniBotUsername"),
    fbGet("settings/telegramMiniAppShortName"),
  ]);

  return {
    botUsername: String(botUsernameRaw || "RS_ANIME_ACCESS_BOT").trim().replace(/^@/, ""),
    appShortName: String(shortNameRaw || "app").trim().replace(/^\//, ""),
  };
}

function buildMiniDeepLink(botUsername: string, appShortName: string, startParam = "") {
  const base = `https://t.me/${botUsername}/${appShortName}`;
  return startParam ? `${base}?startapp=${encodeURIComponent(startParam)}` : base;
}

function parseStartParam(text: string) {
  const match = String(text || "").trim().match(/^\/start(?:\s+(.+))?$/i);
  return match?.[1]?.trim() || "";
}

async function getUserProfilePhoto(botToken: string, telegramId: number) {
  try {
    const photos = await tgCall(botToken, "getUserProfilePhotos", {
      user_id: telegramId,
      limit: 1,
    });
    const first = Array.isArray(photos?.photos) ? photos.photos[0] : null;
    const chosen = Array.isArray(first) ? first[first.length - 1] : null;
    if (!chosen?.file_id) return {};
    const file = await tgCall(botToken, "getFile", { file_id: chosen.file_id });
    return {
      photoFileId: String(chosen.file_id),
      photoFilePath: String(file?.file_path || ""),
    };
  } catch {
    return {};
  }
}

async function syncTelegramProfile(botToken: string, tgUser: any, chatId: number | string, startParam = "") {
  const telegramId = Number(tgUser?.id || 0);
  if (!telegramId) return null;

  const id = `tg_${telegramId}`;
  const fullName = [tgUser?.first_name, tgUser?.last_name].filter(Boolean).join(" ") || tgUser?.username || "Telegram User";
  const photo = await getUserProfilePhoto(botToken, telegramId);
  const settings = await getBotSettings();

  const profile: TelegramProfile = {
    id,
    telegramId,
    chatId,
    firstName: String(tgUser?.first_name || ""),
    lastName: String(tgUser?.last_name || ""),
    fullName,
    username: String(tgUser?.username || ""),
    photoFileId: photo.photoFileId,
    photoFilePath: photo.photoFilePath,
    updatedAt: Date.now(),
  };

  await fbPut(`miniApp/telegramUsers/${id}`, {
    ...profile,
    botUsername: settings.botUsername,
    appShortName: settings.appShortName,
  });

  await fbPatch(`miniApp/sessions/${id}`, {
    userId: id,
    telegramId,
    chatId,
    startParam,
    shortId: startParam.startsWith("s_") ? startParam.slice(2) : "",
    botUsername: settings.botUsername,
    appShortName: settings.appShortName,
    firstName: profile.firstName,
    fullName: profile.fullName,
    username: profile.username,
    photoFileId: profile.photoFileId || "",
    photoFilePath: profile.photoFilePath || "",
    updatedAt: Date.now(),
  });

  return profile;
}

async function getForceChannels(): Promise<ForceChannel[]> {
  const raw = (await fbGet("miniApp/forceSubscribe/channels")) || {};
  const list = Object.entries(raw)
    .map(([id, value]: [string, any]) => ({ id, ...(value || {}) }))
    .filter((item: ForceChannel) => item.enabled !== false && !!String(item.chatId || "").trim() && !!String(item.url || "").trim());

  list.sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  return list;
}

async function getMissingChannels(botToken: string, telegramId: number, channels: ForceChannel[]) {
  const missing: ForceChannel[] = [];

  for (const channel of channels) {
    const chatId = String(channel.chatId || "").trim();
    if (!chatId) continue;

    try {
      const member = await tgCall(botToken, "getChatMember", {
        chat_id: chatId,
        user_id: telegramId,
      });
      const status = String(member?.status || "");
      const joined =
        status === "creator" ||
        status === "administrator" ||
        status === "member" ||
        (status === "restricted" && member?.is_member !== false);

      if (!joined) missing.push(channel);
    } catch {
      missing.push(channel);
    }
  }

  return missing;
}

function buildForceSubscribeText(firstName: string, missing: ForceChannel[]) {
  const name = escapeHtml(firstName || "Friend");
  return `✨ <b>FORCE SUBSCRIBE REQUIRED</b> ✨\n\n👋 <b>${name}</b>, access পেতে নিচের required channel গুলো join করতে হবে।\n\n${missing.length === 1 ? "👉 নিচের channel টি join করুন" : "👉 নিচের missing channel গুলো join করুন"}\n\nসব join হয়ে গেলে নিচের <b>TRY AGAIN</b> চাপুন।`;
}

function buildVerifyText(firstName: string) {
  const name = escapeHtml(firstName || "Friend");
  return `🎬 <b>Welcome ${name}!</b>\n\n✅ Subscription check complete\n✅ User detected successfully\n\nএখন নিচের <b>Verify Access</b> বাটনে ক্লিক করুন।\nMini App open হবে → 5 ads complete হলেই access auto unlock হবে।`;
}

function buildForceKeyboard(missing: ForceChannel[], retryToken: string) {
  return {
    inline_keyboard: [
      ...missing.map((channel) => [{ text: channel.label || "Join Channel", url: channel.url }]),
      [{ text: "🔄 TRY AGAIN", callback_data: `fs_retry:${retryToken}` }],
    ],
  };
}

function buildVerifyKeyboard(startUrl: string) {
  return {
    inline_keyboard: [[{ text: "✅ Verify Access", url: startUrl }]],
  };
}

async function safeDeleteMessage(botToken: string, chatId: number | string, messageId?: number) {
  if (!messageId) return;
  try {
    await tgCall(botToken, "deleteMessage", {
      chat_id: chatId,
      message_id: messageId,
    });
  } catch {}
}

async function sendPhotoOrText(botToken: string, payload: Record<string, unknown>) {
  const photo = String(payload.photo || "").trim();
  if (photo) {
    try {
      return await tgCall(botToken, "sendPhoto", payload);
    } catch {}
  }

  const nextPayload = { ...payload };
  delete nextPayload.photo;
  if (typeof nextPayload.caption === "string") {
    nextPayload.text = nextPayload.caption;
    delete nextPayload.caption;
  }
  return await tgCall(botToken, "sendMessage", nextPayload);
}

async function sendEntryMessage(
  botToken: string,
  chatId: number | string,
  profile: TelegramProfile,
  startParam = "",
  replaceMessageId?: number,
) {
  const { botUsername, appShortName } = await getBotSettings();
  const channels = await getForceChannels();
  const missing = await getMissingChannels(botToken, profile.telegramId, channels);
  const retryToken = startParam || "home";
  const startUrl = buildMiniDeepLink(botUsername, appShortName, startParam);

  if (replaceMessageId) await safeDeleteMessage(botToken, chatId, replaceMessageId);

  const payload: Record<string, unknown> = {
    chat_id: chatId,
    photo: HERO_IMAGE,
    parse_mode: "HTML",
    reply_markup:
      missing.length > 0
        ? buildForceKeyboard(missing, retryToken)
        : buildVerifyKeyboard(startUrl),
    caption:
      missing.length > 0
        ? buildForceSubscribeText(profile.firstName || profile.fullName, missing)
        : buildVerifyText(profile.firstName || profile.fullName),
  };

  const sent = await sendPhotoOrText(botToken, payload);
  await fbPatch(`miniApp/sessions/${profile.id}`, {
    lastGateMessageId: Number(sent?.message_id || 0),
    lastMissingChannels: missing.map((item) => ({
      chatId: item.chatId || "",
      label: item.label || "",
      url: item.url || "",
    })),
    verifiedAt: missing.length === 0 ? Date.now() : 0,
    updatedAt: Date.now(),
  });

  return { ok: true, missingCount: missing.length, startUrl };
}

async function sendStart(botToken: string, chatId: number | string, firstName: string) {
  const { botUsername, appShortName } = await getBotSettings();
  const text = `🎬 <b>Welcome to ${SITE_NAME} Access, ${escapeHtml(firstName || "Friend")}!</b>\n\n24h access পেতে নিচের button চাপুন।\nForce subscribe থাকলে আগে required channel join করতে হবে।`;

  return await sendPhotoOrText(botToken, {
    chat_id: chatId,
    photo: HERO_IMAGE,
    caption: text,
    parse_mode: "HTML",
    reply_markup: buildVerifyKeyboard(buildMiniDeepLink(botUsername, appShortName)),
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (req.method === "GET") {
    return json({
      ok: true,
      service: "access-bot",
      actions: ["set-webhook", "delete-webhook", "webhook-info", "set-menu", "send-start"],
    });
  }

  try {
    const botToken = Deno.env.get("RS_ACCESS_BOT_TOKEN");
    if (!botToken) return json({ error: "RS_ACCESS_BOT_TOKEN not configured" }, 500);

    const body = await req.json().catch(() => ({}));

    if (body?.update_id !== undefined) {
      const callback = body?.callback_query;
      if (callback?.id) {
        const data = String(callback.data || "");
        const retryToken = data.startsWith("fs_retry:") ? data.slice("fs_retry:".length) : "";
        const startParam = retryToken === "home" ? "" : retryToken;
        const tgUser = callback.from;
        const chatId = callback.message?.chat?.id;
        const messageId = callback.message?.message_id;

        try {
          await tgCall(botToken, "answerCallbackQuery", {
            callback_query_id: callback.id,
            text: "Checking your channels…",
          });
        } catch {}

        if (tgUser?.id && chatId) {
          const profile = await syncTelegramProfile(botToken, tgUser, chatId, startParam);
          if (profile) {
            await sendEntryMessage(botToken, chatId, profile, startParam, messageId);
          }
        }

        return json({ ok: true });
      }

      const message = body?.message;
      if (message?.text) {
        const text = String(message.text).trim();
        const startParam = parseStartParam(text);
        const chatId = message.chat.id;
        const firstName = message.from?.first_name || "Friend";

        if (text === "/start" || text.startsWith("/start ")) {
          const profile = await syncTelegramProfile(botToken, message.from, chatId, startParam);
          if (profile && startParam) {
            await sendEntryMessage(botToken, chatId, profile, startParam);
          } else {
            await sendStart(botToken, chatId, firstName);
          }
        } else if (text === "/help") {
          await tgCall(botToken, "sendMessage", {
            chat_id: chatId,
            text: "Verify Access চাপলেই Mini App open হবে। 5 ads complete হলে access auto unlock হবে।",
          });
        }
      }

      return json({ ok: true });
    }

    const action = String(body?.action || "");
    const { botUsername } = await getBotSettings();
    const base = `https://api.telegram.org/bot${botToken}`;

    if (action === "set-webhook") {
      const webhookUrl = String(body?.webhookUrl || "").trim();
      if (!webhookUrl) return json({ error: "webhookUrl required" }, 400);
      const r = await fetch(`${base}/setWebhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: webhookUrl, allowed_updates: ["message", "callback_query"] }),
      });
      return json(await r.json());
    }

    if (action === "delete-webhook") {
      const r = await fetch(`${base}/deleteWebhook`, { method: "POST" });
      return json(await r.json());
    }

    if (action === "webhook-info") {
      const r = await fetch(`${base}/getWebhookInfo`);
      return json(await r.json());
    }

    if (action === "set-menu") {
      const requestedMiniUrl = String(body?.miniUrl || MINI_APP_URL).trim();
      const miniUrl = requestedMiniUrl.includes("?")
        ? `${requestedMiniUrl}&entry=telegram`
        : `${requestedMiniUrl}?entry=telegram`;
      const r = await fetch(`${base}/setChatMenuButton`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          menu_button: {
            type: "web_app",
            text: "🎁 Free Access",
            web_app: { url: miniUrl },
          },
        }),
      });
      return json(await r.json());
    }

    if (action === "send-start") {
      const chatId = body?.chatId;
      const firstName = String(body?.firstName || "Friend");
      if (!chatId) return json({ error: "chatId required" }, 400);
      const data = await sendStart(botToken, chatId, firstName);
      return json(data);
    }

    if (action === "bot-meta") {
      return json({ ok: true, botUsername });
    }

    return json({ error: "unknown_action" }, 400);
  } catch (e: any) {
    return json({ error: e?.message || "internal" }, 500);
  }
});
