// Multi-Bot Edge Function — RS Link Share Bot port (Firebase + raw Telegram Bot API)
// Webhook URL pattern: https://<project>.supabase.co/functions/v1/multi-bot/<botId>
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const FB_URL =
  Deno.env.get("FIREBASE_DB_URL") ||
  "https://rs-anime-default-rtdb.firebaseio.com";

const RS_BACKEND_URL =
  "https://kqxpzqegtvaiwgdusrin.supabase.co/functions/v1/mini-app";
const RS_MINI_BOT = "RS_ANIME_ACCESS_BOT";
const RS_MINI_APP_NAME = "app";

const START_IMG = "https://i.ibb.co/670dG09j/IMG-20251015-191633.jpg";
const CHANNEL_BTN_IMG = "https://i.ibb.co/PsNMKqnT/IMG-20260417-065611-339.jpg";
const ABOUT_BTN_IMG = "https://i.ibb.co/60jQqGff/IMG-20260417-065628-002.jpg";
const LINK_SHARE_IMG = "https://i.ibb.co/PsNMKqnT/IMG-20260417-065611-339.jpg";
const RS_VERIFY_IMG = "https://i.ibb.co/PsNMKqnT/IMG-20260417-065611-339.jpg";

// ===== Firebase REST helpers =====
async function fbGet<T = any>(path: string): Promise<T | null> {
  const r = await fetch(`${FB_URL}/${path}.json`);
  if (!r.ok) return null;
  return (await r.json()) as T | null;
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
async function fbDelete(path: string) {
  await fetch(`${FB_URL}/${path}.json`, { method: "DELETE" });
}
async function fbPush(path: string, value: unknown): Promise<string | null> {
  const r = await fetch(`${FB_URL}/${path}.json`, {
    method: "POST",
    body: JSON.stringify(value),
  });
  if (!r.ok) return null;
  const d = await r.json();
  return d?.name ?? null;
}

// ===== Telegram helpers =====
async function tgCall(botToken: string, method: string, payload?: any) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
  const data = await res.json().catch(() => ({}));
  return data;
}

async function autoDelete(botToken: string, chatId: number | string, messageId: number, delayMs = 30_000) {
  // Fire-and-forget; do not block webhook response
  setTimeout(() => {
    tgCall(botToken, "deleteMessage", { chat_id: chatId, message_id: messageId }).catch(() => {});
  }, delayMs);
}

// ===== Stylish font =====
const STYLE_MAP: Record<string, string> = {
  A: "ᴀ", B: "ʙ", C: "ᴄ", D: "ᴅ", E: "ᴇ", F: "ꜰ", G: "ɢ", H: "ʜ",
  I: "ɪ", J: "ᴊ", K: "ᴋ", L: "ʟ", M: "ᴍ", N: "ɴ", O: "ᴏ", P: "ᴘ",
  Q: "ǫ", R: "ʀ", S: "ꜱ", T: "ᴛ", U: "ᴜ", V: "ᴠ", W: "ᴡ", X: "x",
  Y: "ʏ", Z: "ᴢ",
  a: "ᴀ", b: "ʙ", c: "ᴄ", d: "ᴅ", e: "ᴇ", f: "ꜰ", g: "ɢ", h: "ʜ",
  i: "ɪ", j: "ᴊ", k: "ᴋ", l: "ʟ", m: "ᴍ", n: "ɴ", o: "ᴏ", p: "ᴘ",
  q: "ǫ", r: "ʀ", s: "ꜱ", t: "ᴛ", u: "ᴜ", v: "ᴠ", w: "ᴡ", x: "x",
  y: "ʏ", z: "ᴢ",
};
const stylish = (s: string) =>
  s.split("").map((c) => STYLE_MAP[c] ?? c).join("");

// ===== Bot Config (per botId in Firebase) =====
type BotConfig = {
  id: string;
  name?: string;
  botToken: string;
  apiKey?: string;        // RS Anime API key for shortener
  adminId?: number;       // admin Telegram user id
  username?: string;      // bot username (for permanent link)
  createdAt?: number;
};

async function loadBotConfig(botId: string): Promise<BotConfig | null> {
  const cfg = await fbGet<BotConfig>(`multiBots/${botId}/config`);
  if (!cfg || !cfg.botToken) return null;
  return { ...cfg, id: botId };
}

const isAdmin = (cfg: BotConfig, userId: number) =>
  !!cfg.adminId && Number(cfg.adminId) === Number(userId);

// ===== Shortener (calls RS Anime mini-app backend) =====
async function shortenUrlViaRs(apiKey: string | undefined, longUrl: string): Promise<string> {
  if (!apiKey) return longUrl;
  try {
    const r = await fetch(RS_BACKEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "shorten", apiKey, url: longUrl }),
    });
    const data = await r.json();
    if (data?.ok && data?.shortId) {
      return `https://t.me/${RS_MINI_BOT}/${RS_MINI_APP_NAME}?startapp=s_${data.shortId}`;
    }
  } catch (e) {
    console.error("[RS] shorten error", e);
  }
  return longUrl;
}

async function verifyUserWithBackend(telegramUserId: number): Promise<boolean> {
  try {
    const r = await fetch(RS_BACKEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "user-info", userId: `tg_${telegramUserId}` }),
    });
    const data = await r.json();
    return !!(data?.freeAccess?.active);
  } catch (e) {
    console.error("[RS] verify-check error", e);
    return false;
  }
}

// ===== Verify cache (Firebase, per-bot per-user) =====
async function isUserVerified(botId: string, userId: number): Promise<boolean> {
  const rec = await fbGet<{ expiresAt?: number }>(`multiBots/${botId}/verify/${userId}`);
  if (!rec?.expiresAt) return false;
  return Date.now() < rec.expiresAt;
}
async function markUserVerified(botId: string, userId: number, hours = 24) {
  const expiresAt = Date.now() + hours * 3600 * 1000;
  await fbPut(`multiBots/${botId}/verify/${userId}`, {
    userId, verifiedAt: Date.now(), expiresAt,
  });
}

// ===== Verify Gate UI =====
function getVerifyKeyboard(userId: number, returnPayload = "", shortId = "") {
  const verifyUrl = shortId
    ? `https://t.me/${RS_MINI_BOT}/${RS_MINI_APP_NAME}?startapp=s_${shortId}`
    : `https://t.me/${RS_MINI_BOT}/${RS_MINI_APP_NAME}?startapp=u_tg_${userId}`;
  const cb = `verify_check_${returnPayload}`;
  return {
    inline_keyboard: [
      [{ text: "🎁 ᴠᴇʀɪғʏ ᴀᴄᴄᴇꜱꜱ (24ʜ)", url: verifyUrl }],
      [{ text: "✅ ɪ'ᴍ ᴠᴇʀɪғɪᴇᴅ — ᴄᴏɴᴛɪɴᴜᴇ", callback_data: cb }],
    ],
  };
}

async function sendVerifyGate(cfg: BotConfig, chatId: number, userId: number, returnPayload = "") {
  const caption = `✦━━━━━━━━━━━━━━━━━━━✦
   ${stylish("✦ 24H ACCESS REQUIRED ✦")}
✦━━━━━━━━━━━━━━━━━━━✦

${stylish("›› Get 24-hour FREE access")}
${stylish("›› Watch all anime links freely")}
${stylish("›› Open any link instantly")}

${stylish("✦ HOW TO VERIFY ✦")}
${stylish("›› 1. Tap VERIFY ACCESS button")}
${stylish("›› 2. Watch 5 short ads")}
${stylish("›› 3. Tap GET ACCESS")}
${stylish("›› 4. Return here & continue")}

✦━━━━━━━━━━━━━━━━━━━✦`;
  const r = await tgCall(cfg.botToken, "sendPhoto", {
    chat_id: chatId,
    photo: RS_VERIFY_IMG,
    caption,
    reply_markup: getVerifyKeyboard(userId, returnPayload),
  });
  const mid = r?.result?.message_id;
  if (mid) autoDelete(cfg.botToken, chatId, mid, 300_000);
}

// ===== Force-Subscribe =====
type FsubChannel = {
  channelId: number | string;
  channelUsername?: string;
  channelTitle: string;
};

async function listFsubChannels(botId: string): Promise<FsubChannel[]> {
  const data = await fbGet<Record<string, FsubChannel>>(`multiBots/${botId}/fsubChannels`);
  if (!data) return [];
  return Object.values(data);
}

async function checkFsub(cfg: BotConfig, userId: number): Promise<FsubChannel[]> {
  const channels = await listFsubChannels(cfg.id);
  const notJoined: FsubChannel[] = [];
  for (const ch of channels) {
    try {
      const r = await tgCall(cfg.botToken, "getChatMember", {
        chat_id: ch.channelId,
        user_id: userId,
      });
      const status = r?.result?.status;
      if (!["creator", "administrator", "member"].includes(status)) notJoined.push(ch);
    } catch {
      notJoined.push(ch);
    }
  }
  return notJoined;
}

function getFsubMarkup(notJoined: FsubChannel[], callbackData: string) {
  const rows: any[] = [];
  let row: any[] = [];
  notJoined.forEach((ch, i) => {
    let name = ch.channelTitle || "Channel";
    if (name.length > 12) name = name.slice(0, 10) + "..";
    row.push({ text: name, url: `https://t.me/${ch.channelUsername || ""}` });
    if ((i + 1) % 2 === 0 || i === notJoined.length - 1) {
      rows.push(row);
      row = [];
    }
  });
  rows.push([{ text: "🔄 TRY AGAIN", callback_data: callbackData }]);
  return { inline_keyboard: rows };
}

// ===== Channel storage =====
type Channel = {
  channelId: number;
  channelTitle: string;
  channelUsername?: string;
  addedBy?: number;
  addedAt?: number;
};

async function getChannel(botId: string, channelId: number): Promise<Channel | null> {
  return await fbGet<Channel>(`multiBots/${botId}/channels/${channelId}`);
}
async function saveChannel(botId: string, ch: Channel) {
  await fbPut(`multiBots/${botId}/channels/${ch.channelId}`, ch);
}
async function deleteChannel(botId: string, channelId: number) {
  await fbDelete(`multiBots/${botId}/channels/${channelId}`);
}
async function listChannels(botId: string): Promise<Channel[]> {
  const data = await fbGet<Record<string, Channel>>(`multiBots/${botId}/channels`);
  if (!data) return [];
  return Object.values(data);
}

async function getBotUsername(cfg: BotConfig): Promise<string> {
  if (cfg.username) return cfg.username;
  const me = await tgCall(cfg.botToken, "getMe");
  const username = me?.result?.username;
  if (username) {
    await fbPatch(`multiBots/${cfg.id}/config`, { username });
    cfg.username = username;
  }
  return username || "";
}
async function getPermanentLink(cfg: BotConfig, channelId: number) {
  const username = await getBotUsername(cfg);
  return `https://t.me/${username}?start=channel_${channelId}`;
}

async function createJoinRequestLink(cfg: BotConfig, chatId: number): Promise<string | null> {
  const expire = Math.floor(Date.now() / 1000) + 30;
  const r = await tgCall(cfg.botToken, "createChatInviteLink", {
    chat_id: chatId,
    expire_date: expire,
    creates_join_request: true,
  });
  return r?.result?.invite_link || null;
}

// ===== Deliver Channel Link (after verify passes + fsub) =====
async function deliverChannelLink(cfg: BotConfig, chatId: number, userId: number, channelId: number) {
  const notJoined = await checkFsub(cfg, userId);
  if (notJoined.length) {
    const r = await tgCall(cfg.botToken, "sendPhoto", {
      chat_id: chatId,
      photo: START_IMG,
      caption: `${stylish("✦ FORCE SUBSCRIBE REQUIRED ✦")}\n\n${stylish("›› Join all channels to access link")}`,
      reply_markup: getFsubMarkup(notJoined, `channel_${channelId}`),
    });
    const mid = r?.result?.message_id;
    if (mid) autoDelete(cfg.botToken, chatId, mid, 60_000);
    return;
  }

  const channel = await getChannel(cfg.id, channelId);
  if (!channel) {
    const r = await tgCall(cfg.botToken, "sendMessage", {
      chat_id: chatId,
      text: stylish("✦ Channel not found in database ✦"),
    });
    const mid = r?.result?.message_id;
    if (mid) autoDelete(cfg.botToken, chatId, mid, 30_000);
    return;
  }

  const joinLink = await createJoinRequestLink(cfg, channelId);
  if (joinLink) {
    const r1 = await tgCall(cfg.botToken, "sendPhoto", {
      chat_id: chatId,
      photo: LINK_SHARE_IMG,
      caption: `✦━━━━━━━━━━━━━━━━━━━✦
    ${stylish("HERE IS YOUR LINK")}
✦━━━━━━━━━━━━━━━━━━━✦
${stylish("›› Click button & press REQUEST")}
${stylish("›› Auto approved in 1 second")}`,
      reply_markup: {
        inline_keyboard: [[{ text: "🔗 REQUEST TO JOIN", url: joinLink }]],
      },
    });
    const r2 = await tgCall(cfg.botToken, "sendMessage", {
      chat_id: chatId,
      text: `✦━━━━━━━━━━━━━━━━━━━✦
    ⚠️ ${stylish("NOTICE")} ⚠️
✦━━━━━━━━━━━━━━━━━━━✦
${stylish("›› Link expires in 30 seconds")}
${stylish("›› Click post link for new one")}`,
    });
    const m1 = r1?.result?.message_id;
    const m2 = r2?.result?.message_id;
    if (m1) autoDelete(cfg.botToken, chatId, m1, 30_000);
    if (m2) autoDelete(cfg.botToken, chatId, m2, 30_000);
  } else {
    const r = await tgCall(cfg.botToken, "sendMessage", {
      chat_id: chatId,
      text: stylish("✦ Failed to create link. Please try again. ✦"),
    });
    const mid = r?.result?.message_id;
    if (mid) autoDelete(cfg.botToken, chatId, mid, 30_000);
  }
}

// ===== Main menu / About / Channels keyboards =====
const mainMenu = {
  inline_keyboard: [
    [
      { text: "✦ ABOUT ✦", callback_data: "about" },
      { text: "✦ CHANNELS ✦", callback_data: "channels" },
    ],
    [{ text: "❌ CLOSE", callback_data: "close" }],
  ],
};

const startCaption = `✦━━━━━━━━━━━━━━━━━━━✦       
${stylish("✦ RS LINK SHARE BOT ✦")}
✦━━━━━━━━━━━━━━━━━━━✦
${stylish("›› Bot Type")}: ${stylish("Link Share Bot")}
${stylish("›› 30 sec temporary links")}
${stylish("›› Auto approve requests")}

${stylish("›› Powered by")}: <a href="https://t.me/CARTOONFUNNY03">𓆩𝐀𝐍𝐈𝐌𝐄 𝐈𝐍 𝐇𝐈𝐍𝐃𝐈𓆪</a>
${stylish("✦ MADE WITH ❤️ BY")}: <a href="https://t.me/rs_woner">𝐑𝐒 𝐖𝐎𝐍𝐄𝐑</a>
✦━━━━━━━━━━━━━━━━━━━✦`;

const aboutCaption = `✦━━━━━━━━━━━━━━━━━━━✦                
${stylish("✦ ABOUT RS LINK SHARE BOT ✦")}
✦━━━━━━━━━━━━━━━━━━━✦
${stylish("›› Bot Name")}: ${stylish("RS Link Share Bot")}
${stylish("›› Version")}: ${stylish("3.0")}
${stylish("›› Runtime")}: ${stylish("Supabase Edge")}
${stylish("›› Database")}: ${stylish("Firebase RTDB")}
✦━━━━━━━━━━━━━━━━━━━✦
${stylish("✦ FEATURES ✦")}
✦━━━━━━━━━━━━━━━━━━━✦
${stylish("›› 30 sec temporary links")}
${stylish("›› Auto approve requests")}
${stylish("›› 24h verify gate (RS ANIME)")}

${stylish("✦ POWERED BY")}: <a href="https://t.me/CARTOONFUNNY03">𓆩𝐀𝐍𝐈𝐌𝐄 𝐈𝐍 𝐇𝐈𝐍𝐃𝐈𓆪</a>
${stylish("✦ MADE WITH ❤️ BY")}: <a href="https://t.me/rs_woner">𝐑𝐒 𝐖𝐎𝐍𝐄𝐑</a>
✦━━━━━━━━━━━━━━━━━━━✦`;

const channelsCaption = `✦━━━━━━━━━━━━━━━━━━━✦                
${stylish("✦ OUR CHANNELS ✦")}
✦━━━━━━━━━━━━━━━━━━━✦
${stylish("›› MAIN CHANNEL")}: <a href="https://t.me/CARTOONFUNNY03">𓆩𝐀𝐍𝐈𝐌𝐄 𝐈𝐍 𝐇𝐈𝐍𝐃𝐈𓆪</a>
${stylish("›› FANDUB ANIME")}: <a href="https://t.me/rsanime01">𝐅𝐀𝐍𝐃𝐔𝐁 𝐀𝐍𝐈𝐌𝐄</a>
${stylish("›› OFFICIAL DUB")}: <a href="https://t.me/rsanime04">𝐎𝐅𝐅𝐈𝐂𝐈𝐀𝐋 𝐃𝐔𝐁</a>
${stylish("›› ANIME GROUP")}: <a href="https://t.me/hindianime03">𝐀𝐍𝐈𝐌𝐄 𝐆𝐑𝐎𝐔𝐏</a>

${stylish("✦ JOIN OUR NETWORK ✦")}
✦━━━━━━━━━━━━━━━━━━━✦`;

const navKeyboard = {
  inline_keyboard: [[
    { text: "◀️ BACK", callback_data: "back" },
    { text: "❌ CLOSE", callback_data: "close" },
  ]],
};

// ===== Update Handlers =====
async function handleUpdate(cfg: BotConfig, update: any) {
  // Auto-approve join requests
  if (update.chat_join_request) {
    try {
      await tgCall(cfg.botToken, "approveChatJoinRequest", {
        chat_id: update.chat_join_request.chat.id,
        user_id: update.chat_join_request.from.id,
      });
    } catch (e) {
      console.error("auto-approve err", e);
    }
    return;
  }

  // Callback queries
  if (update.callback_query) {
    return await handleCallback(cfg, update.callback_query);
  }

  // Messages
  const msg = update.message;
  if (!msg) return;

  const chatId = msg.chat.id;
  const userId = msg.from?.id;
  if (!userId) return;

  const text: string = msg.text || msg.caption || "";

  // Forward handler (admin adds channel)
  if (msg.forward_from_chat) {
    return await handleForwarded(cfg, msg);
  }

  // Commands
  if (text.startsWith("/start")) {
    const parts = text.split(/\s+/);
    if (parts.length > 1) {
      const data = parts[1];
      if (data.startsWith("channel_")) {
        const channelId = parseInt(data.replace("channel_", ""), 10);
        if (!Number.isFinite(channelId)) return;
        if (!(await isUserVerified(cfg.id, userId))) {
          await sendVerifyGate(cfg, chatId, userId, String(channelId));
          return;
        }
        await deliverChannelLink(cfg, chatId, userId, channelId);
        return;
      }
    }
    // Default start
    const r = await tgCall(cfg.botToken, "sendPhoto", {
      chat_id: chatId,
      photo: START_IMG,
      caption: startCaption,
      parse_mode: "HTML",
      reply_markup: mainMenu,
    });
    const mid = r?.result?.message_id;
    if (mid) autoDelete(cfg.botToken, chatId, mid, 60_000);
    return;
  }

  // Admin commands
  if (text.startsWith("/set_channel")) {
    if (!isAdmin(cfg, userId)) {
      const r = await tgCall(cfg.botToken, "sendMessage", { chat_id: chatId, text: stylish("✦ Unauthorized ✦") });
      const mid = r?.result?.message_id; if (mid) autoDelete(cfg.botToken, chatId, mid, 30_000);
      return;
    }
    const r = await tgCall(cfg.botToken, "sendMessage", {
      chat_id: chatId,
      text: `${stylish("✦ ADD CHANNEL ✦")}

${stylish("›› 1. Add me as admin in channel")}
${stylish('›› 2. Enable "Invite Links" permission')}
${stylish('›› 3. Enable "Approve Requests" permission')}
${stylish("›› 4. Forward a post from channel here")}`,
    });
    const mid = r?.result?.message_id;
    if (mid) autoDelete(cfg.botToken, chatId, mid, 60_000);
    return;
  }

  if (text.startsWith("/short")) {
    if (!isAdmin(cfg, userId)) return;
    const parts = text.split(/\s+/);
    if (parts.length < 2) {
      await tgCall(cfg.botToken, "sendMessage", { chat_id: chatId, text: `${stylish("✦ Usage")}: /short https://example.com/...` });
      return;
    }
    const longUrl = parts.slice(1).join(" ").trim();
    if (!/^https?:\/\//.test(longUrl)) {
      await tgCall(cfg.botToken, "sendMessage", { chat_id: chatId, text: stylish("✦ Invalid URL ✦") });
      return;
    }
    const short = await shortenUrlViaRs(cfg.apiKey, longUrl);
    await tgCall(cfg.botToken, "sendMessage", { chat_id: chatId, text: `${stylish("✦ SHORT LINK ✦")}\n\n${short}` });
    return;
  }

  if (text.startsWith("/list")) {
    if (!isAdmin(cfg, userId)) return;
    const channels = await listChannels(cfg.id);
    if (!channels.length) {
      await tgCall(cfg.botToken, "sendMessage", { chat_id: chatId, text: stylish("✦ No channels added ✦") });
      return;
    }
    const buttons = channels.map((ch) => {
      const name = ch.channelTitle.length > 20 ? ch.channelTitle.slice(0, 20) + ".." : ch.channelTitle;
      return [{ text: `📺 ${name}`, callback_data: `channel_detail_${ch.channelId}` }];
    });
    buttons.push([{ text: "❌ CLOSE", callback_data: "close" }]);
    await tgCall(cfg.botToken, "sendMessage", {
      chat_id: chatId,
      text: `${stylish("✦ YOUR CHANNELS ✦")}\n\n${stylish("›› Click for details")}`,
      reply_markup: { inline_keyboard: buttons },
    });
    return;
  }

  if (text.startsWith("/fsub_add")) {
    if (!isAdmin(cfg, userId)) return;
    const parts = text.split(/\s+/);
    if (parts.length !== 2) {
      await tgCall(cfg.botToken, "sendMessage", { chat_id: chatId, text: `${stylish("✦ Usage")}: /fsub_add @username` });
      return;
    }
    const username = parts[1].replace("@", "");
    try {
      const r = await tgCall(cfg.botToken, "getChat", { chat_id: `@${username}` });
      const chat = r?.result;
      if (!chat) throw new Error("chat not found");
      const existing = await fbGet(`multiBots/${cfg.id}/fsubChannels/${chat.id}`);
      if (existing) {
        await tgCall(cfg.botToken, "sendMessage", { chat_id: chatId, text: stylish("✦ Already in list ✦") });
        return;
      }
      await fbPut(`multiBots/${cfg.id}/fsubChannels/${chat.id}`, {
        channelId: chat.id,
        channelUsername: username,
        channelTitle: chat.title,
        addedBy: userId,
        addedAt: Date.now(),
      });
      await tgCall(cfg.botToken, "sendMessage", { chat_id: chatId, text: `${stylish("✦ Added ✅")}: ${chat.title}` });
    } catch (e: any) {
      await tgCall(cfg.botToken, "sendMessage", { chat_id: chatId, text: `${stylish("✦ Error")}: ${String(e?.message || e).slice(0, 100)}` });
    }
    return;
  }

  if (text.startsWith("/fsub_list")) {
    if (!isAdmin(cfg, userId)) return;
    const channels = await listFsubChannels(cfg.id);
    if (!channels.length) {
      await tgCall(cfg.botToken, "sendMessage", { chat_id: chatId, text: stylish("✦ No FSUB channels ✦") });
      return;
    }
    let txt = `${stylish("✦ FORCE SUBSCRIBE CHANNELS ✦")}\n\n`;
    channels.forEach((ch, i) => {
      txt += `${stylish("››")} ${i + 1}. ${ch.channelTitle}\n   @${ch.channelUsername || ""}\n\n`;
    });
    await tgCall(cfg.botToken, "sendMessage", { chat_id: chatId, text: txt });
    return;
  }

  if (text.startsWith("/fsub_remove")) {
    if (!isAdmin(cfg, userId)) return;
    const parts = text.split(/\s+/);
    if (parts.length !== 2) {
      await tgCall(cfg.botToken, "sendMessage", { chat_id: chatId, text: `${stylish("✦ Usage")}: /fsub_remove @username` });
      return;
    }
    const username = parts[1].replace("@", "");
    const all = await fbGet<Record<string, FsubChannel>>(`multiBots/${cfg.id}/fsubChannels`);
    let removed = false;
    if (all) {
      for (const [key, ch] of Object.entries(all)) {
        if (ch.channelUsername === username) {
          await fbDelete(`multiBots/${cfg.id}/fsubChannels/${key}`);
          removed = true;
        }
      }
    }
    await tgCall(cfg.botToken, "sendMessage", {
      chat_id: chatId,
      text: removed ? stylish("✦ Removed successfully ✅") : stylish("✦ Not found ✦"),
    });
    return;
  }
}

async function handleForwarded(cfg: BotConfig, msg: any) {
  const userId = msg.from?.id;
  const chatId = msg.chat.id;
  if (!isAdmin(cfg, userId)) return;
  const ch = msg.forward_from_chat;
  if (!ch || ch.type !== "channel") {
    await tgCall(cfg.botToken, "sendMessage", { chat_id: chatId, text: stylish("✦ Forward from channel only ✦") });
    return;
  }
  const channelId = ch.id;
  const existing = await getChannel(cfg.id, channelId);
  if (existing) {
    await tgCall(cfg.botToken, "sendMessage", { chat_id: chatId, text: stylish("✦ Channel already added! ✦") });
    return;
  }
  try {
    // Test invite-link permission
    await tgCall(cfg.botToken, "createChatInviteLink", {
      chat_id: channelId,
      expire_date: Math.floor(Date.now() / 1000) + 60,
      creates_join_request: true,
    });
    await saveChannel(cfg.id, {
      channelId,
      channelTitle: ch.title,
      channelUsername: ch.username,
      addedBy: userId,
      addedAt: Date.now(),
    });
    const permanent = await getPermanentLink(cfg, channelId);
    const short = await shortenUrlViaRs(cfg.apiKey, permanent);
    await tgCall(cfg.botToken, "sendMessage", {
      chat_id: chatId,
      text: `${stylish("✦ CHANNEL ADDED ✅")}

${stylish("›› Name")}: ${ch.title}
${stylish("›› ID")}: ${channelId}

${stylish("✦ Permanent Link")}:
${permanent}

${stylish("✦ RS Short Link")} (verify-gated):
${short}`,
      disable_web_page_preview: true,
    });
  } catch (e: any) {
    await tgCall(cfg.botToken, "sendMessage", {
      chat_id: chatId,
      text: `${stylish("✦ FAILED TO ADD CHANNEL ✦")}\n\n${stylish("Error")}: ${String(e?.message || e).slice(0, 100)}`,
    });
  }
}

async function handleCallback(cfg: BotConfig, cb: any) {
  const userId = cb.from.id;
  const chatId = cb.message?.chat?.id;
  const messageId = cb.message?.message_id;
  const data: string = cb.data || "";

  const answer = (text?: string, alert = false) =>
    tgCall(cfg.botToken, "answerCallbackQuery", { callback_query_id: cb.id, text, show_alert: alert }).catch(() => {});

  try {
    if (data.startsWith("verify_check_")) {
      const payload = data.replace("verify_check_", "");
      let verified = await isUserVerified(cfg.id, userId);
      if (!verified) {
        const ok = await verifyUserWithBackend(userId);
        if (ok) {
          await markUserVerified(cfg.id, userId, 24);
          verified = true;
        }
      }
      if (!verified) {
        await answer("❌ Not verified yet! Open Mini App, watch 5 ads, then come back.", true);
        return;
      }
      await answer("✅ Verified! Sending your link…");
      try { await tgCall(cfg.botToken, "deleteMessage", { chat_id: chatId, message_id: messageId }); } catch {}
      if (payload && /^-?\d+$/.test(payload)) {
        await deliverChannelLink(cfg, chatId, userId, parseInt(payload, 10));
      } else {
        const r = await tgCall(cfg.botToken, "sendMessage", {
          chat_id: chatId,
          text: `${stylish("✅ You are verified for 24 hours!")}\n\n${stylish("Now click any channel link again.")}`,
        });
        const mid = r?.result?.message_id;
        if (mid) autoDelete(cfg.botToken, chatId, mid, 30_000);
      }
      return;
    }

    if (data === "about") {
      await tgCall(cfg.botToken, "editMessageMedia", {
        chat_id: chatId, message_id: messageId,
        media: { type: "photo", media: ABOUT_BTN_IMG, caption: aboutCaption, parse_mode: "HTML" },
        reply_markup: navKeyboard,
      });
      await answer();
      return;
    }

    if (data === "channels") {
      await tgCall(cfg.botToken, "editMessageMedia", {
        chat_id: chatId, message_id: messageId,
        media: { type: "photo", media: CHANNEL_BTN_IMG, caption: channelsCaption, parse_mode: "HTML" },
        reply_markup: navKeyboard,
      });
      await answer();
      return;
    }

    if (data === "back") {
      await tgCall(cfg.botToken, "editMessageMedia", {
        chat_id: chatId, message_id: messageId,
        media: { type: "photo", media: START_IMG, caption: startCaption, parse_mode: "HTML" },
        reply_markup: mainMenu,
      });
      await answer();
      return;
    }

    if (data === "close") {
      try { await tgCall(cfg.botToken, "deleteMessage", { chat_id: chatId, message_id: messageId }); } catch {}
      await answer();
      return;
    }

    // Channel detail / remove / back-to-list (admin)
    if (data.startsWith("channel_detail_")) {
      const channelId = parseInt(data.replace("channel_detail_", ""), 10);
      const channel = await getChannel(cfg.id, channelId);
      if (!channel) { await answer("Channel not found!", true); return; }
      const permanent = await getPermanentLink(cfg, channelId);
      await tgCall(cfg.botToken, "editMessageText", {
        chat_id: chatId, message_id: messageId,
        text: `${stylish("✦ CHANNEL DETAILS ✦")}

${stylish("›› Name")}: ${channel.channelTitle}
${stylish("›› ID")}: ${channel.channelId}

${stylish("›› Permanent Link")}:
${permanent}`,
        disable_web_page_preview: true,
        reply_markup: { inline_keyboard: [
          [{ text: "🗑 REMOVE", callback_data: `remove_channel_${channelId}` }],
          [{ text: "◀️ BACK", callback_data: "back_to_list" }, { text: "❌ CLOSE", callback_data: "close" }],
        ]},
      });
      await answer();
      return;
    }

    if (data.startsWith("remove_channel_")) {
      const channelId = parseInt(data.replace("remove_channel_", ""), 10);
      await deleteChannel(cfg.id, channelId);
      await answer("✅ Channel removed!", true);
      const channels = await listChannels(cfg.id);
      if (channels.length) {
        const buttons = channels.map((ch) => {
          const n = ch.channelTitle.length > 20 ? ch.channelTitle.slice(0, 20) + ".." : ch.channelTitle;
          return [{ text: `📺 ${n}`, callback_data: `channel_detail_${ch.channelId}` }];
        });
        buttons.push([{ text: "❌ CLOSE", callback_data: "close" }]);
        await tgCall(cfg.botToken, "editMessageText", {
          chat_id: chatId, message_id: messageId,
          text: `${stylish("✦ YOUR CHANNELS ✦")}\n\n${stylish("›› Channel removed")}`,
          reply_markup: { inline_keyboard: buttons },
        });
      } else {
        await tgCall(cfg.botToken, "editMessageText", {
          chat_id: chatId, message_id: messageId, text: stylish("✦ No channels left ✦"),
        });
      }
      return;
    }

    if (data === "back_to_list") {
      const channels = await listChannels(cfg.id);
      if (!channels.length) {
        await tgCall(cfg.botToken, "editMessageText", {
          chat_id: chatId, message_id: messageId, text: stylish("✦ No channels added yet ✦"),
        });
        await answer();
        return;
      }
      const buttons = channels.map((ch) => {
        const n = ch.channelTitle.length > 20 ? ch.channelTitle.slice(0, 20) + ".." : ch.channelTitle;
        return [{ text: `📺 ${n}`, callback_data: `channel_detail_${ch.channelId}` }];
      });
      buttons.push([{ text: "❌ CLOSE", callback_data: "close" }]);
      await tgCall(cfg.botToken, "editMessageText", {
        chat_id: chatId, message_id: messageId,
        text: `${stylish("✦ YOUR CHANNELS ✦")}\n\n${stylish("›› Click for details")}`,
        reply_markup: { inline_keyboard: buttons },
      });
      await answer();
      return;
    }

    // TRY AGAIN from force-subscribe — data === channel_<id>
    if (/^channel_-?\d+$/.test(data)) {
      const channelId = parseInt(data.replace("channel_", ""), 10);
      const notJoined = await checkFsub(cfg, userId);
      if (notJoined.length) {
        await tgCall(cfg.botToken, "editMessageMedia", {
          chat_id: chatId, message_id: messageId,
          media: { type: "photo", media: START_IMG, caption: `${stylish("✦ FORCE SUBSCRIBE REQUIRED ✦")}\n\n${stylish("›› Join all channels to access link")}` },
          reply_markup: getFsubMarkup(notJoined, `channel_${channelId}`),
        });
        await answer();
        return;
      }
      try { await tgCall(cfg.botToken, "deleteMessage", { chat_id: chatId, message_id: messageId }); } catch {}
      await deliverChannelLink(cfg, chatId, userId, channelId);
      await answer();
      return;
    }

    await answer();
  } catch (e: any) {
    console.error("callback err", e);
    await answer("Something went wrong!", true);
  }
}

// ===== Admin REST API (called by Lovable admin panel) =====
async function handleAdminApi(req: Request, action: string): Promise<Response> {
  const projectUrl = `https://${Deno.env.get("SUPABASE_URL")?.replace("https://", "") || "kqxpzqegtvaiwgdusrin.supabase.co"}`;
  const baseHook = `${projectUrl}/functions/v1/multi-bot`;

  if (action === "list" && req.method === "GET") {
    const all = await fbGet<Record<string, { config: BotConfig }>>("multiBots");
    const bots = all
      ? Object.entries(all).map(([id, v]) => ({
          id,
          name: v?.config?.name || id,
          username: v?.config?.username || "",
          adminId: v?.config?.adminId || null,
          hasApiKey: !!v?.config?.apiKey,
          hasToken: !!v?.config?.botToken,
          webhookUrl: `${baseHook}/${id}`,
          createdAt: v?.config?.createdAt || 0,
        }))
      : [];
    return json({ ok: true, bots });
  }

  if (action === "add" && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const { botToken, apiKey, name, adminId } = body || {};
    if (!botToken) return json({ ok: false, error: "botToken required" }, 400);
    // Verify token & fetch username
    const me = await tgCall(botToken, "getMe");
    if (!me?.ok) return json({ ok: false, error: "Invalid bot token" }, 400);
    const botId = String(me.result.id);
    const username = me.result.username;
    const cfg: BotConfig = {
      id: botId,
      name: name || username,
      botToken,
      apiKey: apiKey || "",
      adminId: adminId ? Number(adminId) : undefined,
      username,
      createdAt: Date.now(),
    };
    await fbPut(`multiBots/${botId}/config`, cfg);
    return json({ ok: true, botId, username, webhookUrl: `${baseHook}/${botId}` });
  }

  if (action === "delete" && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const { botId } = body || {};
    if (!botId) return json({ ok: false, error: "botId required" }, 400);
    const cfg = await loadBotConfig(botId);
    if (cfg) {
      try { await tgCall(cfg.botToken, "deleteWebhook", { drop_pending_updates: true }); } catch {}
    }
    await fbDelete(`multiBots/${botId}`);
    return json({ ok: true });
  }

  if (action === "set-webhook" && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const { botId } = body || {};
    if (!botId) return json({ ok: false, error: "botId required" }, 400);
    const cfg = await loadBotConfig(botId);
    if (!cfg) return json({ ok: false, error: "Bot not found" }, 404);
    const url = `${baseHook}/${botId}`;
    const r = await tgCall(cfg.botToken, "setWebhook", {
      url,
      drop_pending_updates: true,
      allowed_updates: ["message", "callback_query", "chat_join_request"],
    });
    if (!r?.ok) return json({ ok: false, error: r?.description || "setWebhook failed", url }, 400);
    return json({ ok: true, webhookUrl: url, telegram: r.result });
  }

  if (action === "webhook-info" && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const { botId } = body || {};
    if (!botId) return json({ ok: false, error: "botId required" }, 400);
    const cfg = await loadBotConfig(botId);
    if (!cfg) return json({ ok: false, error: "Bot not found" }, 404);
    const r = await tgCall(cfg.botToken, "getWebhookInfo");
    return json({ ok: true, info: r?.result });
  }

  return json({ ok: false, error: "Unknown action" }, 404);
}

// ===== HTTP entry =====
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  // Path: /functions/v1/multi-bot[/<botId> | /admin/<action>]
  const parts = url.pathname.split("/").filter(Boolean);
  const fnIdx = parts.indexOf("multi-bot");
  const tail = fnIdx >= 0 ? parts.slice(fnIdx + 1) : [];

  // Admin REST: /multi-bot/admin/<action>
  if (tail[0] === "admin") {
    return await handleAdminApi(req, tail[1] || "");
  }

  // Default GET: health
  if (req.method === "GET" && tail.length === 0) {
    return json({ ok: true, service: "multi-bot", time: Date.now() });
  }

  // Webhook: /multi-bot/<botId>
  const botId = tail[0];
  if (!botId) return json({ ok: false, error: "Missing botId" }, 400);

  const cfg = await loadBotConfig(botId);
  if (!cfg) return json({ ok: false, error: "Bot not registered" }, 404);

  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  let update: any;
  try { update = await req.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

  // Respond fast; process update in background
  handleUpdate(cfg, update).catch((e) => console.error("handleUpdate err", e));
  return json({ ok: true });
});
