// RS Link Share Bot — Telegram webhook edge function
// Pure HTTP. Firebase Realtime DB for storage. RS Anime 24h verify gate.
//
// PORTABILITY:
// All Firebase config has hard-coded fallbacks below so this function
// can be lifted into another project — only LINK_SHARE_BOT_TOKEN and
// FIREBASE_SERVICE_ACCOUNT_KEY need to be re-set as secrets.
// Channel/fsub/verify data lives in Firebase ({NS}/* paths) so even if
// the bot or this function is wiped, you can re-deploy and instantly
// recover every channel from Firebase backup.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ============== ENV (with inline defaults for portability) ==============
const BOT_TOKEN =
  Deno.env.get("RS_ACCESS_BOT_TOKEN") || Deno.env.get("LINK_SHARE_BOT_TOKEN") || Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const ADMIN_ID = Number(Deno.env.get("LINK_SHARE_ADMIN_ID") || "6621572366");

// Inline Firebase defaults — same as src/lib/firebase.ts
const FIREBASE_DB_URL =
  Deno.env.get("FIREBASE_DB_URL") || "https://rs-anime-default-rtdb.firebaseio.com";
const FIREBASE_PROJECT_ID =
  Deno.env.get("FIREBASE_PROJECT_ID") || "rs-anime";
// Service account JSON MUST come from secret (private key cannot be inlined)
const FIREBASE_SA_JSON = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_KEY") || "";

const RS_API_KEY = Deno.env.get("RS_API_KEY") || "";
const RS_MINI_BOT = Deno.env.get("RS_MINI_BOT") || "RS_ANIME_ACCESS_BOT";
const RS_MINI_APP_NAME = Deno.env.get("RS_MINI_APP_NAME") || "app";
const RS_RETURN_BOT = (Deno.env.get("RS_RETURN_BOT") || "RS_ANIME_FIND_BOT").replace(/^@/, "");
const RS_BACKEND_URL =
  Deno.env.get("RS_BACKEND_URL") ||
  "https://kqxpzqegtvaiwgdusrin.supabase.co/functions/v1/mini-app";

// Shared secret to protect the /notify endpoint (mini-app → bot push).
// Defaults to RS_API_KEY so existing deploys keep working.
const NOTIFY_SECRET = Deno.env.get("LINK_SHARE_NOTIFY_SECRET") || RS_API_KEY;

const NS = "linkShareBot";

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

function shortAccessCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

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

const getUserProfilePhotos = (user_id: number) =>
  tg("getUserProfilePhotos", { user_id, limit: 1 });

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

// ============== SMART CLEANER ==============
// Two policies:
//   - "display"  → message has no workflow attached → auto-delete in 30s
//   - "workflow" → message belongs to a flow (verify, fsub, link delivery,
//                  admin add-channel) → DO NOT auto-delete; flow handler
//                  deletes it explicitly when the flow completes.
function scheduleDelete(chat_id: number, message_id: number, delayMs = 30_000) {
  if (!message_id) return;
  setTimeout(() => {
    deleteMessage(chat_id, message_id).catch(() => {});
  }, delayMs);
}

// Convenience: send a "display-only" message that auto-cleans in 30s.
async function sendEphemeral(chat_id: number, text: string, extra: any = {}, delayMs = 30_000) {
  const r = await sendMessage(chat_id, text, extra);
  scheduleDelete(chat_id, r?.result?.message_id, delayMs);
  return r;
}

// ============== FIREBASE (Service Account → OAuth2) ==============
let _accessToken: { token: string; exp: number } | null = null;

function b64url(bytes: Uint8Array): string {
  const s = btoa(String.fromCharCode(...bytes));
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
    "pkcs8", keyDer, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"],
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

// ============== TYPES & HELPERS ==============
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
async function saveFsub(ch: FsubChannel) {
  const key = String(ch.channel_id).replace("-", "n");
  await fb("PUT", `${NS}/fsub/${key}`, ch);
}
async function deleteFsubById(channel_id: number): Promise<boolean> {
  const key = String(channel_id).replace("-", "n");
  const existing = await fb("GET", `${NS}/fsub/${key}`);
  if (!existing) return false;
  await fb("DELETE", `${NS}/fsub/${key}`);
  return true;
}

// 24h verify cache — persistent per user
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

// Save user profile (name + photo) for tracking
async function saveUserProfile(user_id: number, from: any) {
  try {
    const name = [from?.first_name, from?.last_name].filter(Boolean).join(" ") || from?.username || `User ${user_id}`;
    let photo_url: string | null = null;
    let photo_file_id: string | null = null;
    try {
      const pp = await getUserProfilePhotos(user_id);
      const photos = pp?.result?.photos;
      if (photos && photos.length > 0 && photos[0].length > 0) {
        const file_id = photos[0][photos[0].length - 1].file_id;
        photo_file_id = file_id;
        const f = await tg("getFile", { file_id });
        if (f?.result?.file_path) {
          photo_url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${f.result.file_path}`;
        }
      }
    } catch {}
    await fb("PUT", `${NS}/users/${user_id}`, {
      user_id,
      name,
      username: from?.username || null,
      photo_file_id,
      photo_url,
      first_seen: Date.now(),
      last_seen: Date.now(),
    });
    return { name, photo_url, photo_file_id };
  } catch (e) {
    console.error("[saveUserProfile]", e);
    return { name: from?.first_name || "User", photo_url: null, photo_file_id: null };
  }
}

async function touchUser(user_id: number) {
  try {
    await fb("PATCH", `${NS}/users/${user_id}`, { last_seen: Date.now() });
  } catch {}
}

async function getUserProfileCached(user_id: number) {
  try {
    const u = await fb("GET", `${NS}/users/${user_id}`);
    if (u) return { name: u.name || `User ${user_id}`, photo_url: u.photo_url || null, photo_file_id: u.photo_file_id || null };
  } catch {}
  return { name: `User ${user_id}`, photo_url: null, photo_file_id: null };
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

// Verify keyboard — uses vplink shortener pointing back to website,
// which marks the bot user as verified and redirects back to bot.
async function verifyKeyboard(user_id: number, returnPayload = "") {
  let hours = 24;
  try {
    const cfg = await fb("GET", `settings/botVerifyHours`);
    if (cfg && Number(cfg) > 0) hours = Number(cfg);
  } catch {}

  const token = `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  try {
    await fb("PUT", `${NS}/botVerifyTokens/${token}`, {
      token, tg_user_id: user_id, return_payload: returnPayload, hours,
      created_at: Date.now(), expires_at: Date.now() + 30 * 60 * 1000, consumed: false,
    });
  } catch (e) { console.error("[verifyToken]", e); }

  const SITE_URL = Deno.env.get("SITE_URL") || "https://rsanime03.lovable.app";
  const me = await botUsername();
  const callbackUrl = `${SITE_URL}/unlock?botv=${token}&bot=${encodeURIComponent(me)}`;

  let finalUrl = callbackUrl;
  try {
    const vplinkKey = Deno.env.get("VPLINK_API_KEY") || "ab26a97a3a3540c5be2ce837bd97526f8e76043d";
    const apiUrl = `https://vplink.in/api?api=${encodeURIComponent(vplinkKey)}&url=${encodeURIComponent(callbackUrl)}`;
    const r = await fetch(apiUrl);
    const j = await r.json().catch(() => ({}));
    if (j?.status === "success" && j?.shortenedUrl) finalUrl = j.shortenedUrl;
  } catch (e) { console.error("[vplink]", e); }

  return {
    inline_keyboard: [[{ text: `🎁 ᴠᴇʀɪғʏ ᴀᴄᴄᴇꜱꜱ (${hours}ʜ)`, url: finalUrl }]],
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
${stylish("›› 2. Open the verify link and complete the ads")}
${stylish("›› 3. Auto-return — done!")}

✦━━━━━━━━━━━━━━━━━━━✦`;
  const kb = await verifyKeyboard(user_id, returnPayload);
  const r = await sendPhoto(chat_id, RS_VERIFY_IMG, caption, { reply_markup: kb });
  // WORKFLOW message: do NOT schedule auto-delete — flow deletes it on success.
  const mid = r?.result?.message_id;
  if (mid) {
    try {
      await fb("PUT", `${NS}/pendingVerify/${user_id}`, {
        chat_id, message_id: mid, return_payload: returnPayload, created_at: Date.now(),
      });
    } catch {}
  }
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
    const url = ch.channel_username
      ? `https://t.me/${ch.channel_username}`
      : `https://t.me/c/${String(ch.channel_id).replace("-100", "")}`;
    row.push({ text: name, url });
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

// ============== DELIVER LINK (workflow) ==============
async function deliverChannelLink(chat_id: number, user_id: number, channel_id: number) {
  const notJoined = await checkFsub(user_id);
  if (notJoined.length > 0) {
    // FSUB workflow message — NO auto-delete, removed when user passes
    await sendPhoto(
      chat_id,
      START_IMG,
      `${stylish("✦ FORCE SUBSCRIBE REQUIRED ✦")}\n\n${stylish("›› Join all channels then press TRY AGAIN")}`,
      { reply_markup: fsubMarkup(notJoined, `fsub_retry_${channel_id}`) },
    );
    return;
  }

  const ch = await getChannel(channel_id);
  if (!ch) {
    await sendEphemeral(chat_id, stylish("✦ Channel not found in database ✦"));
    return;
  }

  const join = await createJoinRequestInvite(channel_id);
  if (!join) {
    await sendEphemeral(chat_id, stylish("✦ Failed to create link. Please try again. ✦"));
    return;
  }
  // Link delivery: workflow done → cleanup after 30s (link itself expires in 30s)
  const photoRes = await sendPhoto(
    chat_id,
    LINK_SHARE_IMG,
    `✦━━━━━━━━━━━━━━━━━━━✦
    ${stylish("HERE IS YOUR LINK")}
✦━━━━━━━━━━━━━━━━━━━✦
${stylish("›› Click button & press REQUEST")}
${stylish("›› Auto approved in 1 second")}`,
    { reply_markup: { inline_keyboard: [[{ text: "🔗 REQUEST TO JOIN", url: join }]] } },
  );
  scheduleDelete(chat_id, photoRes?.result?.message_id);

  await sendEphemeral(
    chat_id,
    `✦━━━━━━━━━━━━━━━━━━━✦
    ⚠️ ${stylish("NOTICE")} ⚠️
✦━━━━━━━━━━━━━━━━━━━✦
${stylish("›› Link expires in 30 seconds")}
${stylish("›› Click post link for new one")}`,
  );
}

// ============== VERIFY SUCCESS WELCOME ==============
async function sendVerifySuccess(chat_id: number, user_id: number, from: any) {
  const profile = from
    ? await saveUserProfile(user_id, from)
    : await getUserProfileCached(user_id);
  const displayName = profile.name;
  const expireTs = Math.floor((Date.now() + 24 * 3600 * 1000) / 1000);
  const expireDate = new Date(expireTs * 1000).toUTCString();

  const caption = `✦━━━━━━━━━━━━━━━━━━━✦
     🎉 ${stylish("VERIFICATION SUCCESS")} 🎉
✦━━━━━━━━━━━━━━━━━━━✦

${stylish("›› Welcome")}, <b>${displayName}</b>!

${stylish("✦ STATUS")}: ✅ <b>${stylish("VERIFIED")}</b>
${stylish("✦ ACCESS")}: 🎁 <b>${stylish("24 HOURS FULL")}</b>
${stylish("✦ EXPIRES")}: ⏰ <code>${expireDate}</code>

${stylish("›› All anime links unlocked")}
${stylish("›› Open any post link instantly")}
${stylish("›› Come back after 24h to renew")}

✦━━━━━━━━━━━━━━━━━━━✦
${stylish("✦ ENJOY YOUR ANIME ✦")}
✦━━━━━━━━━━━━━━━━━━━✦`;

  let res: any = null;
  for (const media of [profile.photo_file_id, profile.photo_url, RS_VERIFY_IMG]) {
    if (!media) continue;
    const attempt = await sendPhoto(chat_id, media, caption);
    if (attempt?.ok && attempt?.result?.message_id) {
      res = attempt;
      break;
    }
  }
  if (!res?.result?.message_id) {
    res = await sendMessage(chat_id, caption);
  }
  // Welcome card = display only → 30s auto-clean
  scheduleDelete(chat_id, res?.result?.message_id);
}

// ============== UPDATE HANDLERS ==============
const isAdmin = (uid: number) => uid === ADMIN_ID;

// Detect verification & auto-show welcome (used on /start AND on push)
async function tryAutoVerifyOnReturn(chat_id: number, user_id: number, from: any | null): Promise<boolean> {
  let pending: any = null;
  try { pending = await fb("GET", `${NS}/pendingVerify/${user_id}`); } catch {}

  let verified = await isUserVerified(user_id);
  if (!verified) {
    if (await verifyUserWithBackend(user_id)) {
      await markUserVerified(user_id, 24);
      verified = true;
    }
  }
  if (!verified) return false;

  // Delete the verify-gate workflow message
  if (pending?.message_id && pending?.chat_id) {
    try { await deleteMessage(pending.chat_id, pending.message_id); } catch {}
    try { await fb("DELETE", `${NS}/pendingVerify/${user_id}`); } catch {}
  }

  await sendVerifySuccess(chat_id, user_id, from);

  // If user came from a channel link, also deliver it
  const payload = pending?.return_payload;
  if (payload && /^-?\d+$/.test(payload)) {
    await deliverChannelLink(chat_id, user_id, Number(payload));
  }
  return true;
}

async function handleStart(chat_id: number, user_id: number, from: any, arg?: string) {
  await touchUser(user_id);

  if (!arg || arg === "verified" || arg === "back") {
    const ok = await tryAutoVerifyOnReturn(chat_id, user_id, from);
    if (ok) return;
  }

  if (arg && arg.startsWith("channel_")) {
    const cid = Number(arg.replace("channel_", ""));
    if (!Number.isFinite(cid)) {
      await sendEphemeral(chat_id, stylish("✦ Invalid channel ✦"));
      return;
    }
    if (!(await isUserVerified(user_id))) {
      if (await verifyUserWithBackend(user_id)) {
        await markUserVerified(user_id, 24);
      } else {
        await sendVerifyGate(chat_id, user_id, String(cid));
        return;
      }
    }
    await deliverChannelLink(chat_id, user_id, cid);
    return;
  }

  // Default /start — pure display message, 30s cleanup
  await saveUserProfile(user_id, from);

  const caption = `✦━━━━━━━━━━━━━━━━━━━✦
${stylish("✦ RS LINK SHARE BOT ✦")}
✦━━━━━━━━━━━━━━━━━━━✦
${stylish("›› Bot Type")}: ${stylish("Link Share Bot")}
${stylish("›› 30 sec temporary links")}
${stylish("›› Auto approve requests")}

${stylish("›› Powered by")}: <a href="https://t.me/CARTOONFUNNY03">𓆩𝐀𝐍𝐈𝐌𝐄 𝐈𝐍 𝐇𝐈𝐍𝐃𝐈𓆪</a>
${stylish("✦ MADE WITH ❤️ BY")}: <a href="https://t.me/rs_woner">𝐑𝐒 𝐖𝐎𝐍𝐄𝐑</a>
✦━━━━━━━━━━━━━━━━━━━✦`;
  const r = await sendPhoto(chat_id, START_IMG, caption, { reply_markup: mainMenu() });
  scheduleDelete(chat_id, r?.result?.message_id);
}

async function handleSetChannel(chat_id: number, user_id: number) {
  if (!isAdmin(user_id)) {
    await sendEphemeral(chat_id, stylish("✦ Unauthorized ✦"));
    return;
  }
  await fb("PUT", `${NS}/adminState/${user_id}`, { mode: "set_channel", at: Date.now() });
  // Workflow prompt — keep until admin forwards or cancels (5 min safety)
  const r = await sendMessage(
    chat_id,
    `${stylish("✦ ADD CHANNEL ✦")}

${stylish("›› 1. Add me as admin in channel")}
${stylish("›› 2. Enable \"Invite Links\" permission")}
${stylish("›› 3. Enable \"Approve Requests\" permission")}
${stylish("›› 4. Forward a post from channel here")}`,
  );
  // store prompt id so handleForward can delete it on success
  if (r?.result?.message_id) {
    await fb("PATCH", `${NS}/adminState/${user_id}`, {
      prompt_chat_id: chat_id, prompt_message_id: r.result.message_id,
    }).catch(() => {});
  }
  scheduleDelete(chat_id, r?.result?.message_id, 5 * 60_000); // safety: 5 min
}

async function handleFsubAddCmd(chat_id: number, user_id: number) {
  if (!isAdmin(user_id)) {
    await sendEphemeral(chat_id, stylish("✦ Unauthorized ✦"));
    return;
  }
  await fb("PUT", `${NS}/adminState/${user_id}`, { mode: "fsub_add", at: Date.now() });
  const r = await sendMessage(
    chat_id,
    `${stylish("✦ ADD FORCE-SUB CHANNEL ✦")}

${stylish("›› Forward a post from the channel")}
${stylish("›› Bot must be a member of that channel")}
${stylish("›› Forward-mode required (works for private too)")}`,
  );
  if (r?.result?.message_id) {
    await fb("PATCH", `${NS}/adminState/${user_id}`, {
      prompt_chat_id: chat_id, prompt_message_id: r.result.message_id,
    }).catch(() => {});
  }
  scheduleDelete(chat_id, r?.result?.message_id, 5 * 60_000);
}

async function handleForward(chat_id: number, user_id: number, msg: any) {
  if (!isAdmin(user_id)) return;
  const fwd = msg.forward_from_chat;
  if (!fwd) {
    await sendEphemeral(chat_id, stylish("✦ Forward from channel only ✦"));
    return;
  }

  let state: any = null;
  try { state = await fb("GET", `${NS}/adminState/${user_id}`); } catch {}
  const mode = state?.mode || "set_channel";

  // Workflow done → delete prompt + admin's forward message
  if (state?.prompt_chat_id && state?.prompt_message_id) {
    deleteMessage(state.prompt_chat_id, state.prompt_message_id).catch(() => {});
  }
  if (msg.message_id) deleteMessage(chat_id, msg.message_id).catch(() => {});

  const channel_id = fwd.id;
  const channel_title = fwd.title;
  const channel_username = fwd.username || null;

  if (mode === "fsub_add") {
    try {
      await saveFsub({
        channel_id, channel_title, channel_username,
        added_by: user_id, added_at: Date.now(),
      });
      await fb("DELETE", `${NS}/adminState/${user_id}`).catch(() => {});
      await sendEphemeral(chat_id,
        `${stylish("✦ FSUB CHANNEL ADDED ✅")}\n\n${stylish("›› Name")}: ${channel_title}\n${stylish("›› ID")}: <code>${channel_id}</code>${channel_username ? `\n${stylish("›› Username")}: @${channel_username}` : ""}`);
    } catch (e) {
      await sendEphemeral(chat_id,
        `${stylish("✦ FAILED ✦")}\n\n${stylish("Error")}: ${String(e).slice(0, 150)}`);
    }
    return;
  }

  // Default: set_channel
  if (await getChannel(channel_id)) {
    await sendEphemeral(chat_id, stylish("✦ Channel already added! ✦"));
    return;
  }
  try {
    await createJoinRequestInvite(channel_id); // sanity check perms
    await saveChannel({
      channel_id, channel_title, channel_username,
      added_by: user_id, added_at: Date.now(),
    });
    await fb("DELETE", `${NS}/adminState/${user_id}`).catch(() => {});
    const perm = await permanentLink(channel_id);
    await sendEphemeral(
      chat_id,
      `${stylish("✦ CHANNEL ADDED ✅")}

${stylish("›› Name")}: ${channel_title}
${stylish("›› ID")}: <code>${channel_id}</code>

${stylish("✦ Permanent Link")}:
${perm}`,
      {},
      60_000,
    );
  } catch (e) {
    await sendEphemeral(
      chat_id,
      `${stylish("✦ FAILED TO ADD CHANNEL ✦")}\n\n${stylish("Error")}: ${String(e).slice(0, 150)}`,
    );
  }
}

async function handleShort(chat_id: number, user_id: number, text: string) {
  if (!isAdmin(user_id)) {
    await sendEphemeral(chat_id, stylish("✦ Unauthorized ✦"));
    return;
  }
  const parts = text.split(/\s+/);
  if (parts.length < 2) {
    await sendEphemeral(chat_id, `${stylish("✦ Usage")}: /short https://example.com/...`);
    return;
  }
  const url = parts[1].trim();
  if (!/^https?:\/\//.test(url)) {
    await sendEphemeral(chat_id, stylish("✦ Invalid URL ✦"));
    return;
  }
  const short = await shortenViaRs(url);
  await sendEphemeral(chat_id, `${stylish("✦ SHORT LINK ✦")}\n\n${short}`, {}, 60_000);
}

async function handleList(chat_id: number, user_id: number) {
  if (!isAdmin(user_id)) {
    await sendEphemeral(chat_id, stylish("✦ Unauthorized ✦"));
    return;
  }
  const all = await listChannels();
  if (all.length === 0) {
    await sendEphemeral(chat_id, stylish("✦ No channels added ✦"));
    return;
  }
  const buttons = all.map((ch) => {
    const name = ch.channel_title.length > 20 ? ch.channel_title.slice(0, 20) + ".." : ch.channel_title;
    return [{ text: `📺 ${name}`, callback_data: `channel_detail_${ch.channel_id}` }];
  });
  buttons.push([{ text: "❌ CLOSE", callback_data: "close" }]);
  // Admin display panel — 60s
  await sendEphemeral(chat_id, `${stylish("✦ YOUR CHANNELS ✦")}\n\n${stylish("›› Click for details")}`, {
    reply_markup: { inline_keyboard: buttons },
  }, 60_000);
}

async function handleFsubList(chat_id: number, user_id: number) {
  if (!isAdmin(user_id)) {
    await sendEphemeral(chat_id, stylish("✦ Unauthorized ✦"));
    return;
  }
  const all = await listFsub();
  if (all.length === 0) {
    await sendEphemeral(chat_id, stylish("✦ No FSUB channels ✦"));
    return;
  }
  const buttons = all.map((ch) => {
    const name = ch.channel_title.length > 18 ? ch.channel_title.slice(0, 18) + ".." : ch.channel_title;
    return [{ text: `🔔 ${name}`, callback_data: `fsub_remove_${ch.channel_id}` }];
  });
  buttons.push([{ text: "❌ CLOSE", callback_data: "close" }]);
  await sendEphemeral(chat_id,
    `${stylish("✦ FORCE SUBSCRIBE CHANNELS ✦")}\n\n${stylish("›› Tap to remove")}`,
    { reply_markup: { inline_keyboard: buttons } }, 60_000);
}

// ============== BROADCAST ==============
// Usage: reply to ANY message with /broadcast → that message is forwarded
// (via copyMessage) to every user in linkShareBot/users/*.
// Live progress is shown by editing a single status message.
async function handleUsersCount(chat_id: number, user_id: number) {
  if (!isAdmin(user_id)) {
    await sendEphemeral(chat_id, stylish("✦ Unauthorized ✦"));
    return;
  }
  const data = await fb("GET", `${NS}/users`).catch(() => null);
  const total = data ? Object.keys(data).length : 0;
  await sendEphemeral(
    chat_id,
    `${stylish("✦ TOTAL USERS ✦")}\n\n${stylish("›› Count")}: <b>${total}</b>`,
    {},
    60_000,
  );
}

async function handleBroadcast(chat_id: number, user_id: number, msg: any) {
  if (!isAdmin(user_id)) {
    await sendEphemeral(chat_id, stylish("✦ Unauthorized ✦"));
    return;
  }
  const reply = msg.reply_to_message;
  if (!reply) {
    await sendEphemeral(
      chat_id,
      `${stylish("✦ HOW TO BROADCAST ✦")}\n\n${stylish("›› 1. Send the message to me first")}\n${stylish("›› 2. Reply to it with")} <code>/broadcast</code>`,
      {},
      60_000,
    );
    return;
  }

  const usersData = await fb("GET", `${NS}/users`).catch(() => null);
  const ids: number[] = usersData
    ? Object.keys(usersData).map((k) => Number(k)).filter((n) => Number.isFinite(n) && n > 0)
    : [];
  const total = ids.length;

  if (total === 0) {
    await sendEphemeral(chat_id, stylish("✦ No users to broadcast to ✦"));
    return;
  }

  const status = await sendMessage(
    chat_id,
    `${stylish("✦ BROADCAST STARTED ✦")}\n\n${stylish("›› Total")}: <b>${total}</b>\n${stylish("›› Sent")}: 0\n${stylish("›› Failed")}: 0`,
  );
  const statusId = status?.result?.message_id;

  let sent = 0;
  let failed = 0;
  let lastEdit = Date.now();

  for (let i = 0; i < ids.length; i++) {
    const target = ids[i];
    try {
      const r = await tg("copyMessage", {
        chat_id: target,
        from_chat_id: chat_id,
        message_id: reply.message_id,
      });
      if (r?.ok) sent++;
      else failed++;
    } catch {
      failed++;
    }

    // Live progress edit (throttled to every ~1.5s or end)
    const now = Date.now();
    if (statusId && (now - lastEdit > 1500 || i === ids.length - 1)) {
      lastEdit = now;
      const pct = Math.floor(((i + 1) / total) * 100);
      const bar = "▓".repeat(Math.floor(pct / 5)) + "░".repeat(20 - Math.floor(pct / 5));
      editMessageText(
        chat_id,
        statusId,
        `${stylish("✦ BROADCAST IN PROGRESS ✦")}\n\n<code>${bar}</code> ${pct}%\n\n${stylish("›› Total")}: <b>${total}</b>\n${stylish("›› Sent")}: ✅ <b>${sent}</b>\n${stylish("›› Failed")}: ❌ <b>${failed}</b>\n${stylish("›› Done")}: <b>${i + 1}/${total}</b>`,
      ).catch(() => {});
    }

    // Telegram rate-limit safety: ~25 msg/sec
    if (i % 25 === 24) await new Promise((res) => setTimeout(res, 1000));
  }

  if (statusId) {
    editMessageText(
      chat_id,
      statusId,
      `${stylish("✦ BROADCAST COMPLETE ✅")}\n\n${stylish("›› Total")}: <b>${total}</b>\n${stylish("›› Sent")}: ✅ <b>${sent}</b>\n${stylish("›› Failed")}: ❌ <b>${failed}</b>`,
    ).catch(() => {});
  }
}

async function handleCallback(cb: any) {
  const data: string = cb.data || "";
  const user_id: number = cb.from.id;
  const chat_id: number = cb.message?.chat?.id;
  const message_id: number = cb.message?.message_id;

  try {
    if (data === "about") {
      await editMessageMedia(chat_id, message_id, {
        type: "photo", media: ABOUT_BTN_IMG, parse_mode: "HTML",
        caption: `✦━━━━━━━━━━━━━━━━━━━✦
${stylish("✦ ABOUT RS LINK SHARE BOT ✦")}
✦━━━━━━━━━━━━━━━━━━━✦
${stylish("›› Bot Name")}: ${stylish("RS Link Share Bot")}
${stylish("›› Version")}: ${stylish("3.1")}
${stylish("›› Runtime")}: ${stylish("Deno / Edge")}
${stylish("›› Database")}: ${stylish("Firebase")}
✦━━━━━━━━━━━━━━━━━━━✦
${stylish("✦ FEATURES ✦")}
✦━━━━━━━━━━━━━━━━━━━✦
${stylish("›› 30 sec temporary links")}
${stylish("›› Auto approve requests")}
${stylish("›› 24h verify gate (RS ANIME)")}
${stylish("›› Smart workflow cleanup")}

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

    if (data.startsWith("fsub_remove_")) {
      const cid = Number(data.replace("fsub_remove_", ""));
      const ok = await deleteFsubById(cid);
      await answerCallback(cb.id, ok ? "✅ Removed!" : "Not found", true);
      const all = await listFsub();
      if (all.length > 0) {
        const buttons = all.map((ch) => {
          const name = ch.channel_title.length > 18 ? ch.channel_title.slice(0, 18) + ".." : ch.channel_title;
          return [{ text: `🔔 ${name}`, callback_data: `fsub_remove_${ch.channel_id}` }];
        });
        buttons.push([{ text: "❌ CLOSE", callback_data: "close" }]);
        await editMessageText(chat_id, message_id,
          `${stylish("✦ FORCE SUBSCRIBE CHANNELS ✦")}\n\n${stylish("›› Tap to remove")}`,
          { reply_markup: { inline_keyboard: buttons } });
      } else {
        await editMessageText(chat_id, message_id, stylish("✦ No FSUB channels left ✦"));
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

    // FSUB TRY AGAIN — workflow gate
    if (data.startsWith("fsub_retry_")) {
      const cid = Number(data.replace("fsub_retry_", ""));
      const notJoined = await checkFsub(user_id);
      if (notJoined.length > 0) {
        await editMessageMedia(chat_id, message_id, {
          type: "photo", media: START_IMG, parse_mode: "HTML",
          caption: `${stylish("✦ FORCE SUBSCRIBE REQUIRED ✦")}\n\n${stylish("›› Still not joined all channels")}`,
        }, fsubMarkup(notJoined, `fsub_retry_${cid}`));
        await answerCallback(cb.id, "Still missing channels!", true);
        return;
      }
      await answerCallback(cb.id, "✅ All joined!");
      try { await deleteMessage(chat_id, message_id); } catch {}
      await deliverChannelLink(chat_id, user_id, cid);
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
  const from = msg.from;
  if (!user_id) return;

  // NOTE: Never auto-delete user-sent commands; only bot-generated messages
  // are auto-cleaned via scheduleDelete inside handlers.

  if (msg.forward_from_chat && msg.chat.type === "private") {
    await handleForward(chat_id, user_id, msg);
    return;
  }

  const text: string = msg.text || msg.caption || "";
  if (!text.startsWith("/")) return;

  const [cmdRaw, ...rest] = text.split(/\s+/);
  const cmd = cmdRaw.split("@")[0].toLowerCase();
  const arg = rest.join(" ").trim();
  const adminOnly = new Set([
    "/set_channel",
    "/short",
    "/list",
    "/fsub_add",
    "/fsub_list",
    "/broadcast",
    "/users",
  ]);

  if (cmd !== "/start" && adminOnly.has(cmd) && !isAdmin(user_id)) {
    return;
  }

  switch (cmd) {
    case "/start":
      await handleStart(chat_id, user_id, from, arg || undefined);
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
      if (msg.chat.type === "private") await handleFsubAddCmd(chat_id, user_id);
      break;
    case "/fsub_list":
      if (msg.chat.type === "private") await handleFsubList(chat_id, user_id);
      break;
    case "/broadcast":
      if (msg.chat.type === "private") await handleBroadcast(chat_id, user_id, msg);
      break;
    case "/users":
      if (msg.chat.type === "private") await handleUsersCount(chat_id, user_id);
      break;
  }
}

// ============== NOTIFY (mini-app → bot push welcome) ==============
// Called by mini-app right after user completes 5-ad verify.
// Pushes the welcome card automatically — no /start needed.
async function handleNotify(payload: any): Promise<{ ok: boolean; error?: string }> {
  const user_id = Number(payload?.user_id);
  if (!Number.isFinite(user_id) || user_id <= 0) {
    return { ok: false, error: "invalid_user_id" };
  }
  // Mark verified (cache) + run the same auto-return flow
  await markUserVerified(user_id, 24).catch(() => {});
  await tryAutoVerifyOnReturn(user_id, user_id, null);
  return { ok: true };
}

// ============== HTTP SERVER ==============
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);

  if (url.searchParams.get("setWebhook")) {
    const target = url.searchParams.get("setWebhook")!;
    const r = await tg("setWebhook", { url: target, allowed_updates: ["message", "callback_query", "chat_join_request"] });
    return new Response(JSON.stringify(r), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  if (url.searchParams.get("info")) {
    const r = await tg("getWebhookInfo", {});
    return new Response(JSON.stringify(r), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Verify-consume endpoint: POST { token } → marks bot user verified, returns deep link back to bot
  if (url.pathname.endsWith("/verify-consume") || url.searchParams.get("verifyConsume") === "1") {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ ok: false, error: "POST only" }), {
        status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    let body: any = {};
    try { body = await req.json(); } catch {}
    const token = String(body?.token || "").trim();
    if (!token) {
      return new Response(JSON.stringify({ ok: false, error: "token required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    try {
      const tok: any = await fb("GET", `${NS}/botVerifyTokens/${token}`);
      if (!tok || tok.consumed || (tok.expires_at && tok.expires_at < Date.now())) {
        return new Response(JSON.stringify({ ok: false, error: "invalid_or_expired" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const uid = Number(tok.tg_user_id);
      const hours = Number(tok.hours || 24);
      await markUserVerified(uid, hours);
      await fb("PATCH", `${NS}/botVerifyTokens/${token}`, { consumed: true, consumed_at: Date.now() });
      // Push welcome
      try { await tryAutoVerifyOnReturn(uid, uid, null); } catch {}
      const me = await botUsername();
      const back = `https://t.me/${me}?start=verified`;
      return new Response(JSON.stringify({ ok: true, hours, deepLink: back }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (e: any) {
      return new Response(JSON.stringify({ ok: false, error: e?.message || "internal" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  // Push endpoint: POST { user_id, secret } → bot sends welcome to that user.
  if (url.pathname.endsWith("/notify") || url.searchParams.get("notify") === "1") {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ ok: false, error: "POST only" }), {
        status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    let body: any = {};
    try { body = await req.json(); } catch {}
    const provided = String(body?.secret || req.headers.get("x-notify-secret") || "");
    if (!NOTIFY_SECRET || provided !== NOTIFY_SECRET) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const result = await handleNotify(body);
    return new Response(JSON.stringify(result), {
      status: result.ok ? 200 : 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: true, bot: "link-share-bot" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const update = await req.json();
    handleUpdate(update).catch((e) => console.error("[update]", e));
    return new Response("ok", { headers: corsHeaders });
  } catch (e) {
    console.error("[server]", e);
    return new Response("ok", { headers: corsHeaders });
  }
});
