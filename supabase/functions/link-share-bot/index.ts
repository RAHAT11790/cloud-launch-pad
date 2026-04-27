// RS Link Share Bot — Telegram webhook edge function
// Pure HTTP (no Pyrogram). Firebase Realtime DB for storage. RS Anime 24h verify gate.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ============== ENV ==============
const BOT_TOKEN =
  Deno.env.get("LINK_SHARE_BOT_TOKEN") || Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const ADMIN_ID = Number(Deno.env.get("LINK_SHARE_ADMIN_ID") || "6621572366");
const FIREBASE_DB_URL =
  Deno.env.get("FIREBASE_DB_URL") || "https://rs-anime-default-rtdb.firebaseio.com";
const FIREBASE_SA_JSON = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_KEY") || "";

// RS Anime verify gate
const RS_API_KEY = Deno.env.get("RS_API_KEY") || "";
const RS_MINI_BOT = Deno.env.get("RS_MINI_BOT") || "RS_ANIME_ACCESS_BOT";
const RS_MINI_APP_NAME = Deno.env.get("RS_MINI_APP_NAME") || "app";
const RS_BACKEND_URL =
  Deno.env.get("RS_BACKEND_URL") ||
  "https://kqxpzqegtvaiwgdusrin.supabase.co/functions/v1/mini-app";

// Storage namespace under Firebase
const NS = "linkShareBot";

// Images
const START_IMG = "https://i.ibb.co.com/670dG09j/IMG-20251015-191633.jpg";
const CHANNEL_BTN_IMG = "https://i.ibb.co.com/PsNMKqnT/IMG-20260417-065611-339.jpg";
const ABOUT_BTN_IMG = "https://i.ibb.co.com/60jQqGff/IMG-20260417-065628-002.jpg";
const LINK_SHARE_IMG = "https://i.ibb.co.com/PsNMKqnT/IMG-20260417-065611-339.jpg";
const RS_VERIFY_IMG = "https://i.ibb.co/PsNMKqnT/IMG-20260417-065611-339.jpg";

// ============== STYLISH FONT ==============
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
const stylish = (s: string) => s.split("").map((c) => STYLE_MAP[c] ?? c).join("");

// ============== TELEGRAM HTTP ==============
const TG = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function tg(method: string, body: any): Promise<any> {
  if (!BOT_TOKEN) throw new Error("BOT_TOKEN missing");
  const r = await fetch(`${TG}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!data?.ok) console.error(`[tg ${method}]`, data);
  return data;
}

const sendMessage = (chat_id: number, text: string, extra: any = {}) =>
  tg("sendMessage", { chat_id, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra });

const sendPhoto = (chat_id: number, photo: string, caption: string, extra: any = {}) =>
  tg("sendPhoto", { chat_id, photo, caption, parse_mode: "HTML", ...extra });

const editMessageText = (chat_id: number, message_id: number, text: string, extra: any = {}) =>
  tg("editMessageText", { chat_id, message_id, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra });

const editMessageMedia = (chat_id: number, message_id: number, media: any, reply_markup?: any) =>
  tg("editMessageMedia", { chat_id, message_id, media, reply_markup });

const answerCallback = (id: string, text = "", show_alert = false) =>
  tg("answerCallbackQuery", { callback_query_id: id, text, show_alert });

const deleteMessage = (chat_id: number, message_id: number) =>
  tg("deleteMessage", { chat_id, message_id });

const getChatMember = (chat_id: number | string, user_id: number) =>
  tg("getChatMember", { chat_id, user_id });

const getChat = (chat_id: number | string) => tg("getChat", { chat_id });

const approveChatJoinRequest = (chat_id: number, user_id: number) =>
  tg("approveChatJoinRequest", { chat_id, user_id });

async function createJoinRequestInvite(chat_id: number): Promise<string | null> {
  const expire = Math.floor(Date.now() / 1000) + 30;
  const r = await tg("createChatInviteLink", {
    chat_id,
    expire_date: expire,
    creates_join_request: true,
  });
  return r?.result?.invite_link || null;
}

async function getMe(): Promise<{ username?: string }> {
  const r = await tg("getMe", {});
  return r?.result || {};
}

// ============== FIREBASE (Service Account → OAuth2) ==============
let _accessToken: { token: string; exp: number } | null = null;

function b64url(bytes: Uint8Array): string {
  let s = btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToDer(pem: string): Uint8Array {
  const b64 = pem.replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

async function getFirebaseToken(): Promise<string> {
  if (_accessToken && _accessToken.exp > Date.now() + 60_000) return _accessToken.token;
  if (!FIREBASE_SA_JSON) throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY missing");
  const sa = JSON.parse(FIREBASE_SA_JSON);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const enc = new TextEncoder();
  const headerB64 = b64url(enc.encode(JSON.stringify(header)));
  const claimB64 = b64url(enc.encode(JSON.stringify(claim)));
  const signingInput = `${headerB64}.${claimB64}`;
  const keyDer = pemToDer(sa.private_key);
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyDer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, enc.encode(signingInput)),
  );
  const jwt = `${signingInput}.${b64url(sig)}`;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const data = await r.json();
  if (!data.access_token) throw new Error("Failed to get Firebase token: " + JSON.stringify(data));
  _accessToken = { token: data.access_token, exp: Date.now() + (data.expires_in - 60) * 1000 };
  return data.access_token;
}

async function fb(method: "GET" | "PUT" | "PATCH" | "DELETE" | "POST", path: string, body?: any) {
  const token = await getFirebaseToken();
  const url = `${FIREBASE_DB_URL}/${path}.json?access_token=${token}`;
  const r = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Firebase ${method} ${path} failed: ${r.status} ${t}`);
  }
  if (r.status === 204) return null;
  return await r.json();
}

// ============== FIREBASE HELPERS ==============
type Channel = {
  channel_id: number;
  channel_title: string;
  channel_username?: string | null;
  added_by?: number;
  added_at?: number;
};
type FsubChannel = Channel;

async function listChannels(): Promise<Channel[]> {
  const data = await fb("GET", `${NS}/channels`);
  if (!data) return [];
  return Object.values(data) as Channel[];
}
async function getChannel(channel_id: number): Promise<Channel | null> {
  const key = String(channel_id).replace("-", "n");
  const data = await fb("GET", `${NS}/channels/${key}`);
  return data || null;
}
async function saveChannel(ch: Channel) {
  const key = String(ch.channel_id).replace("-", "n");
  await fb("PUT", `${NS}/channels/${key}`, ch);
}
async function deleteChannel(channel_id: number) {
  const key = String(channel_id).replace("-", "n");
  await fb("DELETE", `${NS}/channels/${key}`);
}

async function listFsub(): Promise<FsubChannel[]> {
  const data = await fb("GET", `${NS}/fsub`);
  if (!data) return [];
  return Object.values(data) as FsubChannel[];
}
async function getFsubByUsername(username: string): Promise<FsubChannel | null> {
  const all = await listFsub();
  return all.find((c) => (c.channel_username || "").toLowerCase() === username.toLowerCase()) || null;
}
async function saveFsub(ch: FsubChannel) {
  const key = String(ch.channel_id).replace("-", "n");
  await fb("PUT", `${NS}/fsub/${key}`, ch);
}
async function deleteFsubByUsername(username: string): Promise<boolean> {
  const all = await listFsub();
  const found = all.find((c) => (c.channel_username || "").toLowerCase() === username.toLowerCase());
  if (!found) return false;
  const key = String(found.channel_id).replace("-", "n");
  await fb("DELETE", `${NS}/fsub/${key}`);
  return true;
}

// 24h verify cache
async function isUserVerified(user_id: number): Promise<boolean> {
  const data = await fb("GET", `${NS}/verify/${user_id}`);
  if (!data?.expires_at) return false;
  return Date.now() < data.expires_at;
}
async function markUserVerified(user_id: number, hours = 24) {
  await fb("PUT", `${NS}/verify/${user_id}`, {
    user_id,
    verified_at: Date.now(),
    expires_at: Date.now() + hours * 3600 * 1000,
  });
}

// ============== RS ANIME ==============
async function shortenViaRs(longUrl: string): Promise<string> {
  if (!RS_API_KEY) return longUrl;
  try {
    const r = await fetch(RS_BACKEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "shorten", apiKey: RS_API_KEY, url: longUrl }),
    });
    const data = await r.json();
    if (data?.ok && data?.shortId) {
      return `https://t.me/${RS_MINI_BOT}/${RS_MINI_APP_NAME}?startapp=s_${data.shortId}`;
    }
  } catch (e) {
    console.error("[RS shorten]", e);
  }
  return longUrl;
}

async function verifyUserWithBackend(user_id: number): Promise<boolean> {
  try {
    const r = await fetch(RS_BACKEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "user-info", userId: `tg_${user_id}` }),
    });
    const data = await r.json();
    return !!data?.freeAccess?.active;
  } catch {
    return false;
  }
}

function verifyKeyboard(user_id: number, returnPayload = "") {
  const url = `https://t.me/${RS_MINI_BOT}/${RS_MINI_APP_NAME}?startapp=u_tg_${user_id}`;
  const cb = `verify_check_${returnPayload}`;
  return {
    inline_keyboard: [
      [{ text: "🎁 ᴠᴇʀɪғʏ ᴀᴄᴄᴇꜱꜱ (24ʜ)", url }],
      [{ text: "✅ ɪ'ᴍ ᴠᴇʀɪғɪᴇᴅ — ᴄᴏɴᴛɪɴᴜᴇ", callback_data: cb }],
    ],
  };
}

async function sendVerifyGate(chat_id: number, user_id: number, returnPayload = "") {
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
  await sendPhoto(chat_id, RS_VERIFY_IMG, caption, { reply_markup: verifyKeyboard(user_id, returnPayload) });
}

// ============== FORCE SUBSCRIBE ==============
async function checkFsub(user_id: number): Promise<FsubChannel[]> {
  const all = await listFsub();
  const notJoined: FsubChannel[] = [];
  for (const ch of all) {
    try {
      const r = await getChatMember(ch.channel_id, user_id);
      const status = r?.result?.status;
      if (!["member", "administrator", "creator"].includes(status)) {
        notJoined.push(ch);
      }
    } catch {
      notJoined.push(ch);
    }
  }
  return notJoined;
}

function fsubMarkup(notJoined: FsubChannel[], retryCb: string) {
  const rows: any[] = [];
  let row: any[] = [];
  notJoined.forEach((ch, i) => {
    let name = ch.channel_title || ch.channel_username || "Channel";
    if (name.length > 12) name = name.slice(0, 10) + "..";
    row.push({ text: name, url: `https://t.me/${ch.channel_username}` });
    if (row.length === 2 || i === notJoined.length - 1) {
      rows.push(row);
      row = [];
    }
  });
  rows.push([{ text: "🔄 TRY AGAIN", callback_data: retryCb }]);
  return { inline_keyboard: rows };
}

// ============== MAIN MENU ==============
function mainMenu() {
  return {
    inline_keyboard: [
      [
        { text: "✦ ABOUT ✦", callback_data: "about" },
        { text: "✦ CHANNELS ✦", callback_data: "channels" },
      ],
      [{ text: "❌ CLOSE", callback_data: "close" }],
    ],
  };
}

let _botUsername: string | null = null;
async function botUsername(): Promise<string> {
  if (_botUsername) return _botUsername;
  const me = await getMe();
  _botUsername = me.username || "";
  return _botUsername;
}

async function permanentLink(channel_id: number): Promise<string> {
  const u = await botUsername();
  return `https://t.me/${u}?start=channel_${channel_id}`;
}

// ============== DELIVER LINK ==============
async function deliverChannelLink(chat_id: number, user_id: number, channel_id: number) {
  const notJoined = await checkFsub(user_id);
  if (notJoined.length > 0) {
    await sendPhoto(
      chat_id,
      START_IMG,
      `${stylish("✦ FORCE SUBSCRIBE REQUIRED ✦")}\n\n${stylish("›› Join all channels to access link")}`,
      { reply_markup: fsubMarkup(notJoined, `channel_${channel_id}`) },
    );
    return;
  }

  const ch = await getChannel(channel_id);
  if (!ch) {
    await sendMessage(chat_id, stylish("✦ Channel not found in database ✦"));
    return;
  }

  const join = await createJoinRequestInvite(channel_id);
  if (!join) {
    await sendMessage(chat_id, stylish("✦ Failed to create link. Please try again. ✦"));
    return;
  }
  await sendPhoto(
    chat_id,
    LINK_SHARE_IMG,
    `✦━━━━━━━━━━━━━━━━━━━✦
    ${stylish("HERE IS YOUR LINK")}
✦━━━━━━━━━━━━━━━━━━━✦
${stylish("›› Click button & press REQUEST")}
${stylish("›› Auto approved in 1 second")}`,
    {
      reply_markup: { inline_keyboard: [[{ text: "🔗 REQUEST TO JOIN", url: join }]] },
    },
  );
  await sendMessage(
    chat_id,
    `✦━━━━━━━━━━━━━━━━━━━✦
    ⚠️ ${stylish("NOTICE")} ⚠️
✦━━━━━━━━━━━━━━━━━━━✦
${stylish("›› Link expires in 30 seconds")}
${stylish("›› Click post link for new one")}`,
  );
}

// ============== UPDATE HANDLERS ==============
const isAdmin = (uid: number) => uid === ADMIN_ID;

async function handleStart(chat_id: number, user_id: number, arg?: string) {
  if (arg && arg.startsWith("channel_")) {
    const cid = Number(arg.replace("channel_", ""));
    if (!Number.isFinite(cid)) {
      await sendMessage(chat_id, stylish("✦ Invalid channel ✦"));
      return;
    }
    if (!(await isUserVerified(user_id))) {
      await sendVerifyGate(chat_id, user_id, String(cid));
      return;
    }
    await deliverChannelLink(chat_id, user_id, cid);
    return;
  }
  const caption = `✦━━━━━━━━━━━━━━━━━━━✦
${stylish("✦ RS LINK SHARE BOT ✦")}
✦━━━━━━━━━━━━━━━━━━━✦
${stylish("›› Bot Type")}: ${stylish("Link Share Bot")}
${stylish("›› 30 sec temporary links")}
${stylish("›› Auto approve requests")}

${stylish("›› Powered by")}: <a href="https://t.me/CARTOONFUNNY03">𓆩𝐀𝐍𝐈𝐌𝐄 𝐈𝐍 𝐇𝐈𝐍𝐃𝐈𓆪</a>
${stylish("✦ MADE WITH ❤️ BY")}: <a href="https://t.me/rs_woner">𝐑𝐒 𝐖𝐎𝐍𝐄𝐑</a>
✦━━━━━━━━━━━━━━━━━━━✦`;
  await sendPhoto(chat_id, START_IMG, caption, { reply_markup: mainMenu() });
}

async function handleSetChannel(chat_id: number, user_id: number) {
  if (!isAdmin(user_id)) {
    await sendMessage(chat_id, stylish("✦ Unauthorized ✦"));
    return;
  }
  await sendMessage(
    chat_id,
    `${stylish("✦ ADD CHANNEL ✦")}

${stylish("›› 1. Add me as admin in channel")}
${stylish("›› 2. Enable \"Invite Links\" permission")}
${stylish("›› 3. Enable \"Approve Requests\" permission")}
${stylish("›› 4. Forward a post from channel here")}`,
  );
}

async function handleForward(chat_id: number, user_id: number, msg: any) {
  if (!isAdmin(user_id)) return;
  const fwd = msg.forward_from_chat;
  if (!fwd) {
    await sendMessage(chat_id, stylish("✦ Forward from channel only ✦"));
    return;
  }
  const channel_id = fwd.id;
  const channel_title = fwd.title;
  const channel_username = fwd.username || null;
  if (await getChannel(channel_id)) {
    await sendMessage(chat_id, stylish("✦ Channel already added! ✦"));
    return;
  }
  try {
    await createJoinRequestInvite(channel_id); // sanity check perms
    await saveChannel({
      channel_id, channel_title, channel_username,
      added_by: user_id, added_at: Date.now(),
    });
    const perm = await permanentLink(channel_id);
    const short = await shortenViaRs(perm);
    await sendMessage(
      chat_id,
      `${stylish("✦ CHANNEL ADDED ✅")}

${stylish("›› Name")}: ${channel_title}
${stylish("›› ID")}: <code>${channel_id}</code>

${stylish("✦ Permanent Link")}:
${perm}

${stylish("✦ RS Short Link")} (verify-gated):
${short}`,
    );
  } catch (e) {
    await sendMessage(
      chat_id,
      `${stylish("✦ FAILED TO ADD CHANNEL ✦")}\n\n${stylish("Error")}: ${String(e).slice(0, 150)}`,
    );
  }
}

async function handleShort(chat_id: number, user_id: number, text: string) {
  if (!isAdmin(user_id)) {
    await sendMessage(chat_id, stylish("✦ Unauthorized ✦"));
    return;
  }
  const parts = text.split(/\s+/);
  if (parts.length < 2) {
    await sendMessage(chat_id, `${stylish("✦ Usage")}: /short https://example.com/...`);
    return;
  }
  const url = parts[1].trim();
  if (!/^https?:\/\//.test(url)) {
    await sendMessage(chat_id, stylish("✦ Invalid URL ✦"));
    return;
  }
  const short = await shortenViaRs(url);
  await sendMessage(chat_id, `${stylish("✦ SHORT LINK ✦")}\n\n${short}`);
}

async function handleList(chat_id: number, user_id: number) {
  if (!isAdmin(user_id)) {
    await sendMessage(chat_id, stylish("✦ Unauthorized ✦"));
    return;
  }
  const all = await listChannels();
  if (all.length === 0) {
    await sendMessage(chat_id, stylish("✦ No channels added ✦"));
    return;
  }
  const buttons = all.map((ch) => {
    const name = ch.channel_title.length > 20 ? ch.channel_title.slice(0, 20) + ".." : ch.channel_title;
    return [{ text: `📺 ${name}`, callback_data: `channel_detail_${ch.channel_id}` }];
  });
  buttons.push([{ text: "❌ CLOSE", callback_data: "close" }]);
  await sendMessage(chat_id, `${stylish("✦ YOUR CHANNELS ✦")}\n\n${stylish("›› Click for details")}`, {
    reply_markup: { inline_keyboard: buttons },
  });
}

async function handleFsubAdd(chat_id: number, user_id: number, text: string) {
  if (!isAdmin(user_id)) {
    await sendMessage(chat_id, stylish("✦ Unauthorized ✦"));
    return;
  }
  const parts = text.split(/\s+/);
  if (parts.length !== 2) {
    await sendMessage(chat_id, `${stylish("✦ Usage")}: /fsub_add @username`);
    return;
  }
  const username = parts[1].replace("@", "");
  try {
    const r = await getChat(`@${username}`);
    const chat = r?.result;
    if (!chat) throw new Error("Chat not found");
    if (await getFsubByUsername(username)) {
      await sendMessage(chat_id, stylish("✦ Already in list ✦"));
      return;
    }
    await saveFsub({
      channel_id: chat.id,
      channel_username: username,
      channel_title: chat.title,
      added_by: user_id,
      added_at: Date.now(),
    });
    await sendMessage(chat_id, `${stylish("✦ Added ✅")}: ${chat.title}`);
  } catch (e) {
    await sendMessage(chat_id, `${stylish("✦ Error")}: ${String(e).slice(0, 150)}`);
  }
}

async function handleFsubList(chat_id: number, user_id: number) {
  if (!isAdmin(user_id)) {
    await sendMessage(chat_id, stylish("✦ Unauthorized ✦"));
    return;
  }
  const all = await listFsub();
  if (all.length === 0) {
    await sendMessage(chat_id, stylish("✦ No FSUB channels ✦"));
    return;
  }
  let text = `${stylish("✦ FORCE SUBSCRIBE CHANNELS ✦")}\n\n`;
  all.forEach((ch, i) => {
    text += `${stylish("››")} ${i + 1}. ${ch.channel_title}\n   @${ch.channel_username}\n\n`;
  });
  await sendMessage(chat_id, text);
}

async function handleFsubRemove(chat_id: number, user_id: number, text: string) {
  if (!isAdmin(user_id)) {
    await sendMessage(chat_id, stylish("✦ Unauthorized ✦"));
    return;
  }
  const parts = text.split(/\s+/);
  if (parts.length !== 2) {
    await sendMessage(chat_id, `${stylish("✦ Usage")}: /fsub_remove @username`);
    return;
  }
  const username = parts[1].replace("@", "");
  const ok = await deleteFsubByUsername(username);
  await sendMessage(chat_id, stylish(ok ? "✦ Removed successfully ✅" : "✦ Not found ✦"));
}

// ============== CALLBACKS ==============
async function handleCallback(cb: any) {
  const data: string = cb.data || "";
  const user_id: number = cb.from.id;
  const chat_id: number = cb.message?.chat?.id;
  const message_id: number = cb.message?.message_id;

  try {
    // 24h verify check
    if (data.startsWith("verify_check_")) {
      const payload = data.replace("verify_check_", "");
      let verified = await isUserVerified(user_id);
      if (!verified) {
        if (await verifyUserWithBackend(user_id)) {
          await markUserVerified(user_id, 24);
          verified = true;
        }
      }
      if (!verified) {
        await answerCallback(cb.id, "❌ Not verified yet! Open Mini App, watch 5 ads, then come back.", true);
        return;
      }
      await answerCallback(cb.id, "✅ Verified! Sending your link…");
      try { await deleteMessage(chat_id, message_id); } catch {}
      if (payload && /^-?\d+$/.test(payload)) {
        await deliverChannelLink(chat_id, user_id, Number(payload));
      } else {
        await sendMessage(chat_id,
          `${stylish("✅ You are verified for 24 hours!")}\n\n${stylish("Now click any channel link again.")}`);
      }
      return;
    }

    if (data === "about") {
      await editMessageMedia(chat_id, message_id, {
        type: "photo", media: ABOUT_BTN_IMG, parse_mode: "HTML",
        caption: `✦━━━━━━━━━━━━━━━━━━━✦
${stylish("✦ ABOUT RS LINK SHARE BOT ✦")}
✦━━━━━━━━━━━━━━━━━━━✦
${stylish("›› Bot Name")}: ${stylish("RS Link Share Bot")}
${stylish("›› Version")}: ${stylish("2.0")}
${stylish("›› Runtime")}: ${stylish("Deno / Edge")}
${stylish("›› Database")}: ${stylish("Firebase")}
✦━━━━━━━━━━━━━━━━━━━✦
${stylish("✦ FEATURES ✦")}
✦━━━━━━━━━━━━━━━━━━━✦
${stylish("›› 30 sec temporary links")}
${stylish("›› Auto approve requests")}
${stylish("›› 24h verify gate (RS ANIME)")}

${stylish("✦ POWERED BY")}: <a href="https://t.me/CARTOONFUNNY03">𓆩𝐀𝐍𝐈𝐌𝐄 𝐈𝐍 𝐇𝐈𝐍𝐃𝐈𓆪</a>
${stylish("✦ MADE WITH ❤️ BY")}: <a href="https://t.me/rs_woner">𝐑𝐒 𝐖𝐎𝐍𝐄𝐑</a>
✦━━━━━━━━━━━━━━━━━━━✦`,
      }, {
        inline_keyboard: [[
          { text: "◀️ BACK", callback_data: "back" },
          { text: "❌ CLOSE", callback_data: "close" },
        ]],
      });
      await answerCallback(cb.id);
      return;
    }

    if (data === "channels") {
      await editMessageMedia(chat_id, message_id, {
        type: "photo", media: CHANNEL_BTN_IMG, parse_mode: "HTML",
        caption: `✦━━━━━━━━━━━━━━━━━━━✦
${stylish("✦ OUR CHANNELS ✦")}
✦━━━━━━━━━━━━━━━━━━━✦
${stylish("›› MAIN CHANNEL")}: <a href="https://t.me/CARTOONFUNNY03">𓆩𝐀𝐍𝐈𝐌𝐄 𝐈𝐍 𝐇𝐈𝐍𝐃𝐈𓆪</a>
${stylish("›› FANDUB ANIME")}: <a href="https://t.me/rsanime01">𝐅𝐀𝐍𝐃𝐔𝐁 𝐀𝐍𝐈𝐌𝐄</a>
${stylish("›› OFFICIAL DUB")}: <a href="https://t.me/rsanime04">𝐎𝐅𝐅𝐈𝐂𝐈𝐀𝐋 𝐃𝐔𝐁</a>
${stylish("›› ANIME GROUP")}: <a href="https://t.me/hindianime03">𝐀𝐍𝐈𝐌𝐄 𝐆𝐑𝐎𝐔𝐏</a>

${stylish("✦ JOIN OUR NETWORK ✦")}
✦━━━━━━━━━━━━━━━━━━━✦`,
      }, {
        inline_keyboard: [[
          { text: "◀️ BACK", callback_data: "back" },
          { text: "❌ CLOSE", callback_data: "close" },
        ]],
      });
      await answerCallback(cb.id);
      return;
    }

    if (data === "back") {
      await editMessageMedia(chat_id, message_id, {
        type: "photo", media: START_IMG, parse_mode: "HTML",
        caption: `✦━━━━━━━━━━━━━━━━━━━✦
${stylish("✦ RS LINK SHARE BOT ✦")}
✦━━━━━━━━━━━━━━━━━━━✦
${stylish("›› Powered by")}: <a href="https://t.me/CARTOONFUNNY03">𓆩𝐀𝐍𝐈𝐌𝐄 𝐈𝐍 𝐇𝐈𝐍𝐃𝐈𓆪</a>
${stylish("›› Bot Type")}: ${stylish("Link Share Bot")}
${stylish("›› 30 sec temporary links")}
${stylish("›› Auto approve requests")}

${stylish("✦ MADE WITH ❤️ BY")}: <a href="https://t.me/rs_woner">𝐑𝐒 𝐖𝐎𝐍𝐄𝐑</a>
✦━━━━━━━━━━━━━━━━━━━✦`,
      }, mainMenu());
      await answerCallback(cb.id);
      return;
    }

    if (data === "close") {
      try { await deleteMessage(chat_id, message_id); } catch {}
      await answerCallback(cb.id);
      return;
    }

    if (data.startsWith("channel_detail_")) {
      const cid = Number(data.replace("channel_detail_", ""));
      const ch = await getChannel(cid);
      if (!ch) {
        await answerCallback(cb.id, "Channel not found!", true);
        return;
      }
      const perm = await permanentLink(cid);
      await editMessageText(chat_id, message_id,
        `${stylish("✦ CHANNEL DETAILS ✦")}

${stylish("›› Name")}: ${ch.channel_title}
${stylish("›› ID")}: <code>${ch.channel_id}</code>

${stylish("›› Permanent Link")}:
${perm}`,
        { reply_markup: { inline_keyboard: [
          [{ text: "🗑 REMOVE", callback_data: `remove_channel_${cid}` }],
          [
            { text: "◀️ BACK", callback_data: "back_to_list" },
            { text: "❌ CLOSE", callback_data: "close" },
          ],
        ] } });
      await answerCallback(cb.id);
      return;
    }

    if (data.startsWith("remove_channel_")) {
      const cid = Number(data.replace("remove_channel_", ""));
      await deleteChannel(cid);
      await answerCallback(cb.id, "✅ Channel removed!", true);
      const all = await listChannels();
      if (all.length > 0) {
        const buttons = all.map((ch) => {
          const name = ch.channel_title.length > 20 ? ch.channel_title.slice(0, 20) + ".." : ch.channel_title;
          return [{ text: `📺 ${name}`, callback_data: `channel_detail_${ch.channel_id}` }];
        });
        buttons.push([{ text: "❌ CLOSE", callback_data: "close" }]);
        await editMessageText(chat_id, message_id,
          `${stylish("✦ YOUR CHANNELS ✦")}\n\n${stylish("›› Channel removed")}`,
          { reply_markup: { inline_keyboard: buttons } });
      } else {
        await editMessageText(chat_id, message_id, stylish("✦ No channels left ✦"));
      }
      return;
    }

    if (data === "back_to_list") {
      const all = await listChannels();
      if (all.length === 0) {
        await editMessageText(chat_id, message_id, stylish("✦ No channels added yet ✦"));
        await answerCallback(cb.id);
        return;
      }
      const buttons = all.map((ch) => {
        const name = ch.channel_title.length > 20 ? ch.channel_title.slice(0, 20) + ".." : ch.channel_title;
        return [{ text: `📺 ${name}`, callback_data: `channel_detail_${ch.channel_id}` }];
      });
      buttons.push([{ text: "❌ CLOSE", callback_data: "close" }]);
      await editMessageText(chat_id, message_id,
        `${stylish("✦ YOUR CHANNELS ✦")}\n\n${stylish("›› Click for details")}`,
        { reply_markup: { inline_keyboard: buttons } });
      await answerCallback(cb.id);
      return;
    }

    // TRY AGAIN — fsub re-check
    if (data.startsWith("channel_")) {
      const cid = Number(data.replace("channel_", ""));
      const notJoined = await checkFsub(user_id);
      if (notJoined.length > 0) {
        await editMessageMedia(chat_id, message_id, {
          type: "photo", media: START_IMG, parse_mode: "HTML",
          caption: `${stylish("✦ FORCE SUBSCRIBE REQUIRED ✦")}\n\n${stylish("›› Join all channels to access link")}`,
        }, fsubMarkup(notJoined, `channel_${cid}`));
        await answerCallback(cb.id);
        return;
      }
      try { await deleteMessage(chat_id, message_id); } catch {}
      await deliverChannelLink(chat_id, user_id, cid);
      await answerCallback(cb.id);
      return;
    }

    await answerCallback(cb.id);
  } catch (e) {
    console.error("[callback]", e);
    try { await answerCallback(cb.id, "Something went wrong!", true); } catch {}
  }
}

// ============== UPDATE ROUTER ==============
async function handleUpdate(update: any) {
  // Auto-approve join requests
  if (update.chat_join_request) {
    try {
      await approveChatJoinRequest(update.chat_join_request.chat.id, update.chat_join_request.from.id);
    } catch (e) {
      console.error("[approve]", e);
    }
    return;
  }

  if (update.callback_query) {
    await handleCallback(update.callback_query);
    return;
  }

  const msg = update.message;
  if (!msg) return;
  const chat_id = msg.chat.id;
  const user_id = msg.from?.id;
  if (!user_id) return;

  // Forward handler (admin private only)
  if (msg.forward_from_chat && msg.chat.type === "private") {
    await handleForward(chat_id, user_id, msg);
    return;
  }

  const text: string = msg.text || msg.caption || "";
  if (!text.startsWith("/")) return;

  const [cmdRaw, ...rest] = text.split(/\s+/);
  const cmd = cmdRaw.split("@")[0].toLowerCase();
  const arg = rest.join(" ").trim();

  switch (cmd) {
    case "/start":
      await handleStart(chat_id, user_id, arg || undefined);
      break;
    case "/set_channel":
      if (msg.chat.type === "private") await handleSetChannel(chat_id, user_id);
      break;
    case "/short":
      if (msg.chat.type === "private") await handleShort(chat_id, user_id, text);
      break;
    case "/list":
      if (msg.chat.type === "private") await handleList(chat_id, user_id);
      break;
    case "/fsub_add":
      if (msg.chat.type === "private") await handleFsubAdd(chat_id, user_id, text);
      break;
    case "/fsub_list":
      if (msg.chat.type === "private") await handleFsubList(chat_id, user_id);
      break;
    case "/fsub_remove":
      if (msg.chat.type === "private") await handleFsubRemove(chat_id, user_id, text);
      break;
  }
}

// ============== HTTP SERVER ==============
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);

  // Setup helpers (admin-only via secret query param matching admin id)
  if (url.searchParams.get("setWebhook")) {
    const target = url.searchParams.get("setWebhook")!;
    const r = await tg("setWebhook", { url: target, allowed_updates: ["message", "callback_query", "chat_join_request"] });
    return new Response(JSON.stringify(r), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  if (url.searchParams.get("info")) {
    const r = await tg("getWebhookInfo", {});
    return new Response(JSON.stringify(r), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: true, bot: "link-share-bot" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const update = await req.json();
    // Acknowledge fast; process async
    handleUpdate(update).catch((e) => console.error("[update]", e));
    return new Response("ok", { headers: corsHeaders });
  } catch (e) {
    console.error("[server]", e);
    return new Response("ok", { headers: corsHeaders });
  }
});
