// ============================================================
// RS ANIME — EMAIL SERVICE · Gmail API (Cloudflare build) · v3
// ------------------------------------------------------------
// Sign-up verification + password-reset emails sent through the
// official Gmail API (users.messages.send). No Resend / SMTP.
//
// Required secrets (Cloudflare → Worker → Settings → Variables
// and Secrets → Add → type "Secret"):
//   GMAIL_CLIENT_ID      Google OAuth client ID
//   GMAIL_CLIENT_SECRET  Google OAuth client secret
//   GMAIL_REFRESH_TOKEN  refresh token with scope gmail.send
//   GMAIL_SENDER_EMAIL   the Gmail address that authorised it
// Optional:
//   EMAIL_SECRET         long random text used to hash codes
//                        (falls back to a key derived from the
//                         Gmail client secret + refresh token)
//   SITE_URL             default https://rsanime03.lovable.app
//   FIREBASE_DB_URL      Firebase Realtime Database URL
//   FIREBASE_DB_SECRET   Firebase database secret (admin writes)
//   ALLOWED_ORIGINS      extra site origins, comma separated
//
// Routes
//   GET  /                 → health  (?deep=1 also checks Gmail)
//   GET  /preview?type=register|reset[&format=text] → template
//   GET  /v/{rid}/{token}  → "Confirm" page (scanner-safe)
//   POST /v/{rid}/{token}  → marks the email verified, redirects
//   POST /  { action, ... } or POST /api/{action}
//     send | send-otp | send-link   { email, purpose, name? }
//     resend                         { ticket }
//     verify | verify-otp            { ticket, code }
//     status                         { ticket }
//     claim                          { ticket } | { rid, grant }
//
// Security: OTP, link token and session are stored only as
// HMAC-SHA256 hashes; the email address is AES-GCM encrypted.
// Every state change is a conditional (ETag) write, so a code or
// link works exactly once and using one kills the other.
// ============================================================

const VERSION = "email-service-gmail-v3";
const BRAND = "RS ANIME";
const LOGO = "https://i.ibb.co/6RcjXRjL/image.jpg";
const DEFAULT_SITE = "https://rsanime03.lovable.app";
const DEFAULT_DB = "https://animeverse-d7b79-default-rtdb.asia-southeast1.firebasedatabase.app";
const PROJECT_TAG = "d9496f6f-add2-411c-96f8-fb97b0c234a7";
const ROOT = "emailAuth";

const DEFAULTS = { otpMinutes: 10, linkMinutes: 30, cooldownSeconds: 60, maxAttempts: 5, dailyLimit: 450, hourlyPerEmail: 6, hourlyPerIp: 20 };
const BOUNDS = { otpMinutes: [3, 30], linkMinutes: [5, 180], cooldownSeconds: [20, 900], maxAttempts: [3, 10], dailyLimit: [10, 2000], hourlyPerEmail: [2, 30], hourlyPerIp: [3, 200] };
const IP_WRONG_PER_HOUR = 40;
const HOUR = 3600_000;

// ---------------- small utils ----------------
const enc = new TextEncoder();
const dec = new TextDecoder();
function bytesToB64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const b64url = (bytes) => bytesToB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function b64urlToBytes(s) {
  const p = String(s).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(p + "===".slice((p.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const randBytes = (n) => crypto.getRandomValues(new Uint8Array(n));
const randToken = (n) => b64url(randBytes(n));
function randBase36(len) {
  const a = "0123456789abcdefghijklmnopqrstuvwxyz";
  const b = randBytes(len);
  let s = "";
  for (let i = 0; i < len; i++) s += a[b[i] % 36];
  return s;
}
/** Uniform 6-digit code 100000–999999 (rejection sampling, no modulo bias). */
function makeOtp() {
  const LIMIT = 4294800000; // 900000 * 4772
  for (;;) {
    const n = crypto.getRandomValues(new Uint32Array(1))[0];
    if (n < LIMIT) return String(100000 + (n % 900000));
  }
}
const safeEq = (a, b) => {
  a = String(a || ""); b = String(b || "");
  let r = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) r |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return r === 0;
};
const clamp = (v, [lo, hi], d) => { if (v == null || v === "") return d; const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const normEmail = (v) => String(v || "").trim().toLowerCase();
const maskEmail = (e) => { const at = e.lastIndexOf("@"); if (at < 1) return "***"; return e.slice(0, Math.min(2, at)) + "***" + e.slice(at); };
const dayKey = (t) => new Date(t + 6 * HOUR).toISOString().slice(0, 10); // Bangladesh day
const hourBucket = (t) => String(Math.floor(t / HOUR));
const siteUrl = (env) => String(env.SITE_URL || DEFAULT_SITE).replace(/\/+$/, "");
const hasCtl = (s) => /[\r\n\u0000]/.test(String(s));

// ---------------- validation (mirrors src/lib/emailService.ts) ----------------
const GMAIL_RE = /^(?=.{6,30}@)[a-z0-9](?:[a-z0-9]|\.(?!\.))*[a-z0-9]@gmail\.com$/;
const LOCAL_RE = /^(?=.{3,40}$)[a-z0-9](?:[a-z0-9_-]|\.(?!\.))*[a-z0-9]$/;
const DOMAIN_RE = /^(?=.{3,63}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
const SENDER_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i;
const RID_RE = /^[a-z0-9]{14,40}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{20,80}$/;
function emailAllowed(email, domains) {
  const at = email.lastIndexOf("@");
  if (at < 1) return false;
  const domain = email.slice(at + 1);
  if (!domains.includes(domain)) return false;
  return domain === "gmail.com" ? GMAIL_RE.test(email) : LOCAL_RE.test(email.slice(0, at));
}
const appUserKey = (email) => email.replace(/\./g, ",").replace(/[^a-z0-9@,_-]/g, "_");
const canonicalKey = (email) => email.endsWith("@gmail.com")
  ? email.split("@")[0].replace(/\./g, "")
  : email.replace(/\./g, ",").replace(/[^a-z0-9@,_-]/g, "_");

// ---------------- crypto ----------------
let keyMemo = { src: "", hmac: null, aes: null };
async function keys(env) {
  const src = env.EMAIL_SECRET || `${env.GMAIL_CLIENT_SECRET || ""}|${env.GMAIL_REFRESH_TOKEN || ""}`;
  if (keyMemo.hmac && keyMemo.src === src) return keyMemo;
  const hk = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode("rs-email-hmac-v3|" + src)));
  const ak = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode("rs-email-aes-v3|" + src)));
  keyMemo = {
    src,
    hmac: await crypto.subtle.importKey("raw", hk, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]),
    aes: await crypto.subtle.importKey("raw", ak, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]),
  };
  return keyMemo;
}
async function hash(env, ...parts) {
  const k = await keys(env);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", k.hmac, enc.encode(parts.join("|")))));
}
async function seal(env, text) {
  const k = await keys(env);
  const iv = randBytes(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k.aes, enc.encode(text)));
  return `${b64url(iv)}.${b64url(ct)}`;
}
async function unseal(env, sealed) {
  const [iv, ct] = String(sealed || "").split(".");
  const k = await keys(env);
  return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64urlToBytes(iv) }, k.aes, b64urlToBytes(ct)));
}

// ---------------- Firebase Realtime Database (REST) ----------------
const dbBase = (env) => String(env.FIREBASE_DB_URL || DEFAULT_DB).replace(/\/+$/, "");
function dbUrl(env, path, q = {}) {
  const u = new URL(`${dbBase(env)}/${path}.json`);
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
  if (env.FIREBASE_DB_SECRET) u.searchParams.set("auth", env.FIREBASE_DB_SECRET);
  return u.toString();
}
async function dbFetch(env, path, init = {}, q) {
  const r = await fetch(dbUrl(env, path, q), init);
  if (!r.ok && r.status !== 412) {
    const err = new Error(`database ${init.method || "GET"} ${path.split("/")[0]}/${path.split("/")[1] || ""} failed (${r.status})`);
    err.code = "db_error";
    throw err;
  }
  return r;
}
const dbGet = async (env, path, q) => (await dbFetch(env, path, {}, q)).json();
const jsonInit = (method, val, extra = {}) => ({ method, headers: { "Content-Type": "application/json", ...extra }, body: JSON.stringify(val) });
const dbPut = (env, path, val) => dbFetch(env, path, jsonInit("PUT", val));
const dbPatch = (env, path, val) => dbFetch(env, path, jsonInit("PATCH", val));
/** Optimistic transaction: fn(current) → { next, result } (next undefined = no write). */
async function dbTxn(env, path, fn, tries = 5) {
  for (let i = 0; i < tries; i++) {
    const r = await dbFetch(env, path, { headers: { "X-Firebase-ETag": "true" } });
    const etag = r.headers.get("ETag") || "";
    const cur = await r.json();
    const out = await fn(cur);
    if (out.next === undefined) return out.result;
    const w = await dbFetch(env, path, jsonInit("PUT", out.next, { "if-match": etag }));
    if (w.status === 412) continue;
    return out.result;
  }
  const err = new Error("database busy");
  err.code = "db_busy";
  throw err;
}

let settingsMemo = { v: null, exp: 0 };
async function settings(env) {
  if (settingsMemo.v && settingsMemo.exp > Date.now()) return settingsMemo.v;
  let raw = null;
  try { raw = await dbGet(env, "settings/emailService"); } catch {}
  const v = {};
  for (const k of Object.keys(DEFAULTS)) v[k] = clamp(raw?.[k], BOUNDS[k], DEFAULTS[k]);
  settingsMemo = { v, exp: Date.now() + 60_000 };
  return v;
}
let domainsMemo = { list: ["gmail.com"], exp: 0 };
async function allowedDomains(env) {
  if (domainsMemo.exp > Date.now()) return domainsMemo.list;
  try {
    const raw = await dbGet(env, "settings/loginAccess/allowedDomains");
    const vals = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? Object.values(raw) : [];
    const list = [...new Set(vals.map((d) => String(d || "").trim().toLowerCase().replace(/^@+/, "")).filter((d) => DOMAIN_RE.test(d)))];
    domainsMemo = { list: list.length ? list : ["gmail.com"], exp: Date.now() + 60_000 };
  } catch { domainsMemo = { list: domainsMemo.list, exp: Date.now() + 15_000 }; }
  return domainsMemo.list;
}

// ---------------- stats + events (admin panel) ----------------
function track(env, ctx, fields, event) {
  const now = Date.now();
  const inc = {};
  for (const [k, n] of Object.entries(fields)) inc[k] = { ".sv": { increment: n } };
  const jobs = [dbPatch(env, `${ROOT}/stats/${dayKey(now)}`, inc)];
  if (event) jobs.push(dbPut(env, `${ROOT}/events/${now.toString(36)}${randBase36(4)}`, { t: now, ...event }));
  if (Math.random() < 0.06) jobs.push(cleanup(env, now));
  const p = Promise.allSettled(jobs);
  if (ctx?.waitUntil) ctx.waitUntil(p); else return p;
}
async function cleanup(env, now) {
  const old = (now - 2 * 86400_000).toString(36);
  const tickets = await dbGet(env, `${ROOT}/tickets`, { orderBy: '"$key"', endAt: `"${old}"`, limitToFirst: "60" }).catch(() => null);
  const patch = {};
  for (const k of Object.keys(tickets || {})) patch[`tickets/${k}`] = null;
  for (const node of ["ip", "mail", "wrong"]) {
    const buckets = await dbGet(env, `${ROOT}/${node}`, { shallow: "true" }).catch(() => null);
    for (const b of Object.keys(buckets || {})) if (Number(b) < Number(hourBucket(now)) - 2) patch[`${node}/${b}`] = null;
  }
  const events = await dbGet(env, `${ROOT}/events`, { shallow: "true" }).catch(() => null);
  const ek = Object.keys(events || {}).sort();
  for (const k of ek.slice(0, Math.max(0, ek.length - 300))) patch[`events/${k}`] = null;
  if (Object.keys(patch).length) await dbPatch(env, ROOT, patch);
}

// ---------------- Gmail API ----------------
let tokenMemo = { key: "", token: "", exp: 0, scope: "" };
function gmailError(code, message) { const e = new Error(message); e.code = code; return e; }
async function gmailAccessToken(env, force = false) {
  const key = `${env.GMAIL_CLIENT_ID}|${env.GMAIL_REFRESH_TOKEN}`;
  if (!force && tokenMemo.key === key && tokenMemo.exp > Date.now() + 60_000) return tokenMemo;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID, client_secret: env.GMAIL_CLIENT_SECRET,
      refresh_token: env.GMAIL_REFRESH_TOKEN, grant_type: "refresh_token",
    }).toString(),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) {
    const why = `${d.error || r.status}${d.error_description ? `: ${d.error_description}` : ""}`.slice(0, 160);
    if (d.error === "invalid_grant") throw gmailError("gmail_token_revoked", `Refresh token rejected (${why})`);
    if (d.error === "invalid_client" || d.error === "unauthorized_client") throw gmailError("gmail_client_invalid", `OAuth client rejected (${why})`);
    throw gmailError("gmail_token_failed", `Token exchange failed (${why})`);
  }
  tokenMemo = { key, token: d.access_token, exp: Date.now() + (Number(d.expires_in) || 3600) * 1000, scope: String(d.scope || "") };
  return tokenMemo;
}
const encWord = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${bytesToB64(enc.encode(s))}?=`);
const wrap76 = (s) => s.match(/.{1,76}/g)?.join("\r\n") || "";
function buildMime({ from, to, subject, text, html, ref, date = new Date() }) {
  if ([from, to, subject, ref].some(hasCtl)) throw gmailError("bad_header", "Invalid header value");
  const b = `rs_${randBase36(18)}`;
  const head = [
    `From: ${encWord(BRAND)} <${from}>`,
    `To: <${to}>`,
    `Subject: ${encWord(subject)}`,
    `Date: ${date.toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${ref}.${date.getTime().toString(36)}@rsanime.mail>`,
    "MIME-Version: 1.0",
    "Auto-Submitted: auto-generated",
    `X-Entity-Ref-ID: ${ref}`,
    `Content-Type: multipart/alternative; boundary="${b}"`,
  ];
  const part = (type, body) => [`--${b}`, `Content-Type: ${type}; charset=UTF-8`, "Content-Transfer-Encoding: base64", "", wrap76(bytesToB64(enc.encode(body)))].join("\r\n");
  return `${head.join("\r\n")}\r\n\r\n${part("text/plain", text)}\r\n${part("text/html", html)}\r\n--${b}--\r\n`;
}
async function sendGmail(env, msg) {
  const raw = b64url(enc.encode(buildMime({ ...msg, from: env.GMAIL_SENDER_EMAIL })));
  for (let attempt = 0; attempt < 2; attempt++) {
    const { token } = await gmailAccessToken(env, attempt > 0);
    const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
    });
    if (r.status === 401 && attempt === 0) continue; // stale token → refresh once
    const text = await r.text();
    let d = {}; try { d = JSON.parse(text); } catch {}
    if (r.ok && d.id) return d.id;
    const reason = d?.error?.errors?.[0]?.reason || d?.error?.status || "";
    const why = `${r.status} ${reason} ${d?.error?.message || ""}`.trim().slice(0, 180);
    console.error("gmail send failed:", why);
    if (r.status === 429 || /rateLimit|dailyLimit|quota/i.test(reason)) throw gmailError("gmail_quota", `Gmail sending limit reached (${why})`);
    if (r.status === 403) throw gmailError("gmail_scope_missing", `Gmail refused (${why}) — token needs the gmail.send scope`);
    if (r.status === 400) throw gmailError("gmail_rejected", `Gmail rejected the message (${why})`);
    throw gmailError("gmail_send_failed", `Gmail send failed (${why})`);
  }
  throw gmailError("gmail_send_failed", "Gmail send failed (401 after refresh)");
}

// ---------------- templates ----------------
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
const C = { bg: "#060B1F", card: "#0C1633", panel: "#081029", line: "#1E2E5C", line2: "#22356B", blue: "#2563EB", blue2: "#3B82F6", sky: "#60A5FA", text: "#E6ECFF", soft: "#A9B6DA", mute: "#7F90C2", dim: "#56669A" };
function fmtTime(t) {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dhaka", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(t)) + " (Bangladesh time)";
  } catch { return new Date(t).toUTCString(); }
}
function copyFor(purpose) {
  return purpose === "reset"
    ? { eyebrow: "PASSWORD RESET", icon: "&#128272;", title: "Reset your password", subject: "Reset your RS ANIME password", button: "Reset Password",
        intro: "We received a request to reset the password of your RS ANIME account. Enter the code below in the app, or tap the button to confirm it's you." }
    : { eyebrow: "ACCOUNT VERIFICATION", icon: "&#9993;&#65039;", title: "Verify your email address", subject: "Verify your RS ANIME email", button: "Verify Email",
        intro: "Welcome to RS ANIME! Enter the code below in the app, or tap the button, to confirm this email address belongs to you." };
}
function emailTemplate({ purpose, code, link, name, email, otpMinutes, linkMinutes, site, requestedAt }) {
  const c = copyFor(purpose);
  const year = new Date(requestedAt).getUTCFullYear();
  const host = site.replace(/^https?:\/\//, "");
  const hi = name ? `Hi <b style="color:${C.text}">${esc(name)}</b>,` : "Hi there,";
  const pre = `${code} is your RS ANIME code. It expires in ${otpMinutes} minutes.`;
  const td = `font-family:${FONT};`;
  const html = `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="dark light"><meta name="supported-color-schemes" content="dark light">
<title>${esc(c.title)}</title>
<style>
body{margin:0!important;padding:0!important;background:${C.bg};-webkit-text-size-adjust:100%}
a{text-decoration:none}img{border:0;outline:none}
@media (max-width:520px){.rs-pad{padding-left:22px!important;padding-right:22px!important}.rs-code{font-size:34px!important;letter-spacing:9px!important}.rs-h1{font-size:23px!important;line-height:30px!important}.rs-outer{padding:20px 10px!important}}
</style></head>
<body style="margin:0;padding:0;background:${C.bg};">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;color:${C.bg};">${esc(pre)}${"&#847;&zwnj;&nbsp;".repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.bg}" style="background:${C.bg};">
<tr><td align="center" class="rs-outer" style="padding:34px 14px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">

<tr><td align="center" style="padding:0 0 22px;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td style="padding-right:12px;"><img src="${LOGO}" width="46" height="46" alt="RS ANIME" style="display:block;width:46px;height:46px;border-radius:13px;border:1px solid #24376E;"></td>
    <td style="${td}font-size:21px;font-weight:800;letter-spacing:3px;color:#FFFFFF;">RS <span style="color:${C.sky};">ANIME</span></td>
  </tr></table>
</td></tr>

<tr><td style="background:${C.card};border:1px solid ${C.line};border-radius:22px;overflow:hidden;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td height="4" style="height:4px;line-height:4px;font-size:0;background:${C.blue};background-image:linear-gradient(90deg,#1D4ED8,#3B82F6,#22D3EE);border-radius:22px 22px 0 0;">&nbsp;</td></tr>
    <tr><td class="rs-pad" align="center" style="padding:36px 42px 6px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="66" height="66" align="center" valign="middle" style="width:66px;height:66px;border-radius:20px;background:#13224A;border:1px solid #2A4185;font-size:30px;line-height:66px;">${c.icon}</td></tr></table>
      <div style="${td}margin-top:20px;font-size:11px;font-weight:800;letter-spacing:3px;color:${C.sky};">${c.eyebrow}</div>
      <h1 class="rs-h1" style="${td}margin:10px 0 0;font-size:27px;line-height:35px;font-weight:800;color:#FFFFFF;">${esc(c.title)}</h1>
      <p style="${td}margin:14px 0 0;font-size:15px;line-height:24px;color:${C.soft};">${hi}<br>${esc(c.intro)}</p>
    </td></tr>

    <tr><td class="rs-pad" style="padding:26px 42px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.panel};border:1px solid ${C.line2};border-radius:18px;">
        <tr><td align="center" style="${td}padding:22px 16px 4px;font-size:11px;font-weight:800;letter-spacing:3px;color:${C.mute};">YOUR 6-DIGIT CODE</td></tr>
        <tr><td align="center" class="rs-code" style="padding:6px 10px 8px;font-family:'SF Mono',SFMono-Regular,Menlo,Consolas,'Courier New',monospace;font-size:42px;line-height:52px;letter-spacing:13px;font-weight:800;color:#FFFFFF;">${esc(code)}</td></tr>
        <tr><td align="center" style="${td}padding:0 16px 22px;font-size:12px;line-height:18px;color:${C.mute};">Expires in <b style="color:#C7D5FF;">${otpMinutes} minutes</b> &nbsp;&#183;&nbsp; works only once</td></tr>
      </table>
    </td></tr>

    <tr><td class="rs-pad" style="padding:26px 42px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td width="44%" style="font-size:0;line-height:0;"><div style="height:1px;background:${C.line};">&nbsp;</div></td>
        <td align="center" style="${td}padding:0 10px;font-size:11px;font-weight:700;letter-spacing:2px;color:${C.dim};white-space:nowrap;">OR</td>
        <td width="44%" style="font-size:0;line-height:0;"><div style="height:1px;background:${C.line};">&nbsp;</div></td>
      </tr></table>
    </td></tr>

    <tr><td align="center" class="rs-pad" style="padding:22px 42px 0;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td align="center" bgcolor="${C.blue}" style="border-radius:14px;background:${C.blue};background-image:linear-gradient(135deg,#1D4ED8,#3B82F6);box-shadow:0 10px 26px rgba(37,99,235,.35);">
          <a href="${esc(link)}" target="_blank" style="${td}display:inline-block;padding:16px 40px;font-size:16px;font-weight:800;letter-spacing:.3px;color:#FFFFFF;border-radius:14px;">${esc(c.button)} &rarr;</a>
        </td>
      </tr></table>
      <div style="${td}margin-top:12px;font-size:12px;line-height:18px;color:${C.mute};">One tap &#183; opens your browser &#183; expires in ${linkMinutes} minutes</div>
    </td></tr>

    <tr><td class="rs-pad" style="padding:28px 42px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0F1C40;border-radius:14px;border-left:3px solid ${C.blue2};">
        <tr><td style="${td}padding:15px 18px;font-size:13px;line-height:20px;color:${C.soft};">&#128274; <b style="color:${C.text};">Keep this code private.</b> RS ANIME will never ask for it by chat, call or message. Didn't request this? Just ignore this email &mdash; nothing will change on your account.</td></tr>
      </table>
    </td></tr>

    <tr><td class="rs-pad" style="padding:20px 42px 34px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${td}font-size:12px;line-height:18px;">
        <tr><td style="color:${C.dim};padding:3px 0;width:92px;" valign="top">Requested</td><td style="color:${C.soft};padding:3px 0;">${esc(fmtTime(requestedAt))}</td></tr>
        <tr><td style="color:${C.dim};padding:3px 0;" valign="top">Account</td><td style="color:${C.soft};padding:3px 0;word-break:break-all;">${esc(email)}</td></tr>
      </table>
    </td></tr>
  </table>
</td></tr>

<tr><td align="center" style="${td}padding:20px 16px 0;font-size:12px;line-height:18px;color:${C.dim};">
  Button not working? Copy this link into your browser:<br>
  <a href="${esc(link)}" style="color:${C.sky};word-break:break-all;">${esc(link)}</a>
</td></tr>

<tr><td align="center" style="padding:28px 16px 6px;">
  <img src="${LOGO}" width="30" height="30" alt="" style="display:block;width:30px;height:30px;border-radius:9px;opacity:.9;">
  <div style="${td}margin-top:9px;font-size:12px;font-weight:800;letter-spacing:3px;color:#8A9BC8;">RS ANIME</div>
  <div style="${td}margin-top:7px;font-size:11px;line-height:17px;color:${C.dim};">This is an automated security email &mdash; replies are not monitored.<br>
  <a href="${esc(site)}" style="color:#7FA8F8;">${esc(host)}</a> &nbsp;&#183;&nbsp; &copy; ${year} RS ANIME. All rights reserved.</div>
</td></tr>

</table>
</td></tr></table>
</body></html>`;
  const text = [
    `RS ANIME — ${c.title}`,
    "",
    name ? `Hi ${name},` : "Hi there,",
    c.intro,
    "",
    `Your 6-digit code: ${code}`,
    `(expires in ${otpMinutes} minutes, works only once)`,
    "",
    `Or open this link (expires in ${linkMinutes} minutes):`,
    link,
    "",
    "Keep this code private. RS ANIME will never ask for it.",
    "Didn't request this? Ignore this email — nothing will change.",
    "",
    `Requested: ${fmtTime(requestedAt)}`,
    `Account: ${email}`,
    "",
    `© ${year} RS ANIME · ${host}`,
  ].join("\n");
  return { subject: `${code} — ${c.subject}`, html, text };
}

function pageHtml({ state, purpose, redirect, action, title, message }) {
  const ok = state === "success";
  const icon = ok || state === "info" ? `<svg viewBox="0 0 52 52" class="ck${ok ? "" : " info"}"><circle cx="26" cy="26" r="24"/><path d="M15 27l7 7 15-16"/></svg>`
    : state === "confirm" ? `<div class="spin"></div>`
    : `<div class="bad">!</div>`;
  const btn = ok
    ? `<a class="btn" href="${esc(redirect)}">Continue to RS ANIME &rarr;</a><p class="small">Redirecting in <b id="n">3</b>s…</p>`
    : state === "confirm"
      ? `<form id="f" method="POST" action="${esc(action)}"><button class="btn" type="submit">${purpose === "reset" ? "Confirm password reset" : "Verify my email"}</button></form><p class="small">Confirming securely…</p>`
      : `<a class="btn ghost" href="${esc(redirect)}">Open RS ANIME</a>`;
  const script = ok
    ? `<script>(function(){var n=3,e=document.getElementById("n");var t=setInterval(function(){n--;if(e)e.textContent=n;if(n<=0){clearInterval(t);location.replace(${JSON.stringify(redirect)});}},1000);})();</script>`
    : state === "confirm" ? `<script>setTimeout(function(){document.getElementById("f").submit();},350);</script>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>${esc(title)} · RS ANIME</title>
${ok ? `<meta http-equiv="refresh" content="4;url=${esc(redirect)}">` : ""}
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:radial-gradient(120% 80% at 50% 0%,#12235A 0%,#060B1F 60%);font-family:${FONT};color:#E6ECFF}
.card{width:100%;max-width:400px;background:rgba(12,22,51,.92);border:1px solid #1E2E5C;border-radius:24px;padding:30px 24px 26px;text-align:center;box-shadow:0 30px 80px rgba(0,0,0,.45);position:relative;overflow:hidden}
.card:before{content:"";position:absolute;left:0;right:0;top:0;height:4px;background:linear-gradient(90deg,#1D4ED8,#3B82F6,#22D3EE)}
.brand{display:flex;align-items:center;justify-content:center;gap:10px;font-weight:800;letter-spacing:3px;font-size:16px;margin-bottom:26px}.brand img{width:38px;height:38px;border-radius:11px;border:1px solid #24376E}.brand span{color:#60A5FA}
.ck{width:84px;height:84px;margin:0 auto 6px;display:block}.ck circle{fill:none;stroke:#22C55E;stroke-width:3;stroke-dasharray:160;stroke-dashoffset:160;animation:d .7s ease forwards}.ck path{fill:none;stroke:#22C55E;stroke-width:4;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:40;stroke-dashoffset:40;animation:d .4s .6s ease forwards}
@keyframes d{to{stroke-dashoffset:0}}.ck.info circle,.ck.info path{stroke:#60A5FA}
.spin{width:64px;height:64px;margin:10px auto 16px;border-radius:50%;border:4px solid #1E2E5C;border-top-color:#3B82F6;animation:s 1s linear infinite}@keyframes s{to{transform:rotate(360deg)}}
.bad{width:72px;height:72px;margin:6px auto 12px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:36px;font-weight:900;color:#FCA5A5;background:rgba(239,68,68,.12);border:2px solid rgba(239,68,68,.45)}
h1{margin:10px 0 0;font-size:23px;line-height:30px}p{margin:10px 0 0;font-size:14px;line-height:22px;color:#A9B6DA}
.btn{display:block;width:100%;margin-top:24px;padding:15px 18px;border:0;border-radius:14px;background:linear-gradient(135deg,#1D4ED8,#3B82F6);color:#fff;font:800 15px ${FONT};cursor:pointer;text-decoration:none;box-shadow:0 10px 26px rgba(37,99,235,.35)}
.btn.ghost{background:#13224A;border:1px solid #2A4185;box-shadow:none}.small{font-size:12px;color:#7F90C2}.foot{margin-top:22px;font-size:11px;color:#56669A}
</style></head><body><main class="card">
<div class="brand"><img src="${LOGO}" alt=""><div>RS <span>ANIME</span></div></div>
${icon}<h1>${esc(title)}</h1><p>${esc(message)}</p>${btn}
<div class="foot">Secured by RS ANIME</div></main>${script}</body></html>`;
}

// ---------------- HTTP helpers ----------------
function originAllowed(origin, env) {
  if (!origin) return false;
  let u; try { u = new URL(origin); } catch { return false; }
  const o = u.origin;
  const extra = String(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);
  if (extra.includes(o)) return true;
  try { if (o === new URL(siteUrl(env)).origin) return true; } catch {}
  const h = u.hostname;
  if (h === "localhost" || h === "127.0.0.1") return true;
  return u.protocol === "https:" && (h.endsWith(".lovable.app") || h.endsWith(".lovableproject.com")) && (h.includes(PROJECT_TAG) || /^(?:[a-z0-9-]+--)?rsanime03\./.test(h));
}
function corsFor(req, env) {
  const origin = req.headers.get("Origin") || "";
  const h = { "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "content-type, authorization, x-client-info, apikey", "Access-Control-Max-Age": "86400", Vary: "Origin" };
  if (originAllowed(origin, env)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}
const baseHeaders = { "Cache-Control": "no-store", "x-rs-edge": VERSION, "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
const json = (cors, body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, ...baseHeaders, "Content-Type": "application/json" } });
const fail = (cors, status, error, message, extra = {}) => json(cors, { ok: false, error, message, ...extra }, status);
const html = (body, status = 200) => new Response(body, {
  status,
  headers: {
    ...baseHeaders, "Content-Type": "text/html; charset=utf-8", "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'none'; img-src https://i.ibb.co data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  },
});
const MISSING = (env) => ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN", "GMAIL_SENDER_EMAIL"].filter((k) => !env[k]);
function parseTicket(t) {
  const [rid, session] = String(t || "").split(".");
  return RID_RE.test(rid || "") && TOKEN_RE.test(session || "") ? { rid, session } : null;
}
const PUBLIC_ERRORS = {
  gmail_quota: "Email sending limit reached for today. Please try again later.",
  db_error: "Server storage is busy. Please try again.",
  db_busy: "Server is busy. Please try again.",
};
const publicGmailMessage = (code) => PUBLIC_ERRORS[code] || "Email could not be sent right now. Please try again in a few minutes.";

// ---------------- core flows ----------------
async function issueTicket(env, ctx, cors, { email, purpose, name, origin, ip, replaces }) {
  const cfg = await settings(env);
  const now = Date.now();
  const eh = await hash(env, "email", email);
  const ih = await hash(env, "ip", ip);
  const hb = hourBucket(now);

  const sentToday = Number(await dbGet(env, `${ROOT}/stats/${dayKey(now)}/sent`).catch(() => 0)) || 0;
  if (sentToday >= cfg.dailyLimit) {
    track(env, ctx, { limited: 1 }, { k: "limited", p: purpose, m: maskEmail(email), err: "daily_limit" });
    return fail(cors, 429, "daily_limit", "Today's email limit is reached. Please try again tomorrow.");
  }

  const ipOk = await dbTxn(env, `${ROOT}/ip/${hb}/${ih}`, (cur) => {
    const n = Number(cur) || 0;
    return n >= cfg.hourlyPerIp ? { result: false } : { next: n + 1, result: true };
  });
  if (!ipOk) {
    track(env, ctx, { limited: 1 }, { k: "limited", p: purpose, m: maskEmail(email), err: "ip_hourly" });
    return fail(cors, 429, "too_many", "Too many emails from this network. Please try again in an hour.", { retryAfter: 3600 });
  }

  const prevBucket = await dbGet(env, `${ROOT}/mail/${Number(hb) - 1}/${eh}`).catch(() => null);
  const rid = `${now.toString(36)}${randBase36(12)}`;
  const gate = await dbTxn(env, `${ROOT}/mail/${hb}/${eh}`, (cur) => {
    const last = Math.max(Number(cur?.last) || 0, Number(prevBucket?.last) || 0);
    const wait = last + cfg.cooldownSeconds * 1000 - now;
    if (wait > 0) return { result: { err: "cooldown", wait } };
    if ((Number(cur?.n) || 0) >= cfg.hourlyPerEmail) return { result: { err: "email_hourly" } };
    return { next: { n: (Number(cur?.n) || 0) + 1, last: now, rid, prevLast: last }, result: { prevRid: cur?.rid || prevBucket?.rid || "", prevLast: last } };
  });
  if (gate.err === "cooldown") {
    const retryAfter = Math.ceil(gate.wait / 1000);
    return fail(cors, 429, "cooldown", `Please wait ${retryAfter}s before asking for another email.`, { retryAfter });
  }
  if (gate.err) {
    track(env, ctx, { limited: 1 }, { k: "limited", p: purpose, m: maskEmail(email), err: gate.err });
    return fail(cors, 429, "too_many", "Too many emails to this address. Please try again in an hour.", { retryAfter: 3600 });
  }

  const otp = makeOtp();
  const linkToken = randToken(32);
  const session = randToken(24);
  const x = now + cfg.otpMinutes * 60_000;
  const lx = now + cfg.linkMinutes * 60_000;
  await dbPut(env, `${ROOT}/tickets/${rid}`, {
    p: purpose, m: maskEmail(email), e: eh, ec: await seal(env, email),
    o: await hash(env, "otp", rid, otp), l: await hash(env, "link", rid, linkToken), s: await hash(env, "sess", rid, session),
    c: now, x, lx, a: 0, max: cfg.maxAttempts, st: "sending", org: origin || "",
  });

  const site = siteUrl(env);
  const link = `${env.__WORKER_ORIGIN}/v/${rid}/${linkToken}`;
  const tpl = emailTemplate({ purpose, code: otp, link, name, email, otpMinutes: cfg.otpMinutes, linkMinutes: cfg.linkMinutes, site, requestedAt: now });
  const t0 = Date.now();
  try {
    await sendGmail(env, { to: email, subject: tpl.subject, html: tpl.html, text: tpl.text, ref: rid });
  } catch (err) {
    const ms = Date.now() - t0;
    await Promise.allSettled([
      dbPatch(env, `${ROOT}/tickets/${rid}`, { st: "failed" }),
      dbTxn(env, `${ROOT}/mail/${hb}/${eh}`, (cur) => cur?.rid === rid ? { next: { ...cur, n: Math.max(0, (Number(cur.n) || 1) - 1), last: Number(cur.prevLast) || 0 }, result: 1 } : { result: 0 }),
    ]);
    track(env, ctx, { failed: 1 }, { k: "failed", p: purpose, m: maskEmail(email), ms, err: String(err?.code || "error"), why: String(err?.message || "").slice(0, 200) });
    return fail(cors, 502, err?.code || "send_failed", publicGmailMessage(err?.code));
  }
  const ms = Date.now() - t0;
  await dbPatch(env, `${ROOT}/tickets/${rid}`, { st: "pending" });
  const old = replaces || gate.prevRid;
  if (old && old !== rid) {
    await dbTxn(env, `${ROOT}/tickets/${old}`, (cur) => cur && (cur.st === "pending" || cur.st === "verified" || cur.st === "sending")
      ? { next: { ...cur, st: "replaced" }, result: 1 } : { result: 0 }).catch(() => 0);
  }
  track(env, ctx, { sent: 1, [`sent_${purpose}`]: 1, gmail_ms: ms, gmail_n: 1, ...(replaces ? { resend: 1 } : {}) }, { k: "sent", p: purpose, m: maskEmail(email), ms });
  return json(cors, {
    ok: true, ticket: `${rid}.${session}`, rid, purpose, email: maskEmail(email),
    expiresAt: x, linkExpiresAt: lx, cooldown: cfg.cooldownSeconds, resendAt: now + cfg.cooldownSeconds * 1000, maxAttempts: cfg.maxAttempts,
  });
}

async function accountCheck(env, email, purpose) {
  const [user, canon] = await Promise.all([
    dbGet(env, `appUsers/${appUserKey(email)}`, { shallow: "true" }),
    purpose === "register" ? dbGet(env, `gmailRegistry/${canonicalKey(email)}`) : Promise.resolve(null),
  ]);
  if (purpose === "register" && (user != null || canon != null)) return { err: ["already_registered", "This email already has an account. Please sign in."] };
  if (purpose === "reset" && user == null) return { err: ["no_account", "No account found with this email."] };
  let name = "";
  if (purpose === "reset") name = String((await dbGet(env, `appUsers/${appUserKey(email)}/name`).catch(() => "")) || "");
  return { name };
}

async function actSend(env, ctx, cors, body, origin, ip) {
  const email = normEmail(body.email);
  const purpose = body.purpose === "reset" ? "reset" : body.purpose === "register" ? "register" : "";
  if (!purpose) return fail(cors, 400, "bad_purpose", "purpose must be \"register\" or \"reset\".");
  if (!email || email.length > 80 || hasCtl(email)) return fail(cors, 400, "bad_email", "Enter a valid email address.");
  const domains = await allowedDomains(env);
  if (!emailAllowed(email, domains)) return fail(cors, 400, "domain_not_allowed", `Only ${domains.map((d) => "@" + d).join(", ")} addresses are allowed.`);
  const acc = await accountCheck(env, email, purpose);
  if (acc.err) return fail(cors, purpose === "reset" ? 404 : 409, acc.err[0], acc.err[1]);
  const typed = String(body.name || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 30);
  return issueTicket(env, ctx, cors, { email, purpose, name: acc.name || typed, origin, ip });
}

async function loadOwned(env, cors, ticket) {
  const t = parseTicket(ticket);
  if (!t) return { res: fail(cors, 400, "bad_ticket", "This request is invalid. Please start again.") };
  const cur = await dbGet(env, `${ROOT}/tickets/${t.rid}`);
  if (!cur || !safeEq(cur.s, await hash(env, "sess", t.rid, t.session))) return { res: fail(cors, 404, "not_found", "This request was not found. Please start again.") };
  return { t, cur };
}

async function actResend(env, ctx, cors, body, origin, ip) {
  const { res, t, cur } = await loadOwned(env, cors, body.ticket);
  if (res) return res;
  if (cur.st === "consumed") return fail(cors, 409, "already_used", "This email was already verified.");
  const email = await unseal(env, cur.ec);
  const acc = await accountCheck(env, email, cur.p);
  if (acc.err) return fail(cors, cur.p === "reset" ? 404 : 409, acc.err[0], acc.err[1]);
  return issueTicket(env, ctx, cors, { email, purpose: cur.p, name: acc.name || String(body.name || "").slice(0, 30), origin: cur.org || origin, ip, replaces: t.rid });
}

function stateError(cors, st, via) {
  if (st === "consumed") return fail(cors, 409, "already_used", "This code was already used.");
  if (st === "verified") return fail(cors, 409, "verified_by_link", "This email was already verified with the link.", { status: "verified", via });
  if (st === "replaced") return fail(cors, 410, "replaced", "A newer email was sent. Please use the latest code.");
  if (st === "locked") return fail(cors, 423, "locked", "Too many wrong tries. Please ask for a new code.");
  return fail(cors, 400, "invalid", "This code is no longer valid. Please ask for a new one.");
}

async function actVerify(env, ctx, cors, body, ip) {
  const t = parseTicket(body.ticket);
  const code = String(body.code || "").replace(/\D/g, "");
  if (!t) return fail(cors, 400, "bad_ticket", "This request is invalid. Please start again.");
  if (code.length !== 6) return fail(cors, 400, "bad_code", "Enter the 6-digit code.");
  const now = Date.now();
  const ih = await hash(env, "ip", ip);
  const wrongPath = `${ROOT}/wrong/${hourBucket(now)}/${ih}`;
  if ((Number(await dbGet(env, wrongPath).catch(() => 0)) || 0) >= IP_WRONG_PER_HOUR) return fail(cors, 429, "too_many", "Too many wrong codes from this network. Try again later.", { retryAfter: 3600 });
  const sessHash = await hash(env, "sess", t.rid, t.session);
  const otpHash = await hash(env, "otp", t.rid, code);
  const out = await dbTxn(env, `${ROOT}/tickets/${t.rid}`, (cur) => {
    if (!cur || !safeEq(cur.s, sessHash)) return { result: { e: "not_found" } };
    if (cur.st !== "pending") return { result: { e: "state", st: cur.st, via: cur.via } };
    if (now > cur.x) return { result: { e: "expired", p: cur.p, m: cur.m } };
    const max = Number(cur.max) || DEFAULTS.maxAttempts;
    if ((Number(cur.a) || 0) >= max) return { next: { ...cur, st: "locked" }, result: { e: "state", st: "locked" } };
    if (!safeEq(cur.o, otpHash)) {
      const a = (Number(cur.a) || 0) + 1;
      return { next: { ...cur, a, ...(a >= max ? { st: "locked" } : {}) }, result: { e: "wrong", left: Math.max(0, max - a), p: cur.p, m: cur.m } };
    }
    return { next: { ...cur, st: "consumed", via: "otp", v: now }, result: { ok: true, p: cur.p, m: cur.m, ec: cur.ec } };
  });
  if (out.e === "not_found") return fail(cors, 404, "not_found", "This request was not found. Please start again.");
  if (out.e === "state") return stateError(cors, out.st, out.via);
  if (out.e === "expired") {
    track(env, ctx, { expired: 1 }, { k: "expired", p: out.p, m: out.m });
    return fail(cors, 410, "expired", "This code has expired. Please ask for a new one.");
  }
  if (out.e === "wrong") {
    await dbTxn(env, wrongPath, (n) => ({ next: (Number(n) || 0) + 1, result: 1 })).catch(() => 0);
    const locked = out.left <= 0;
    track(env, ctx, { wrong: 1, ...(locked ? { locked: 1 } : {}) }, { k: locked ? "locked" : "wrong", p: out.p, m: out.m });
    return locked
      ? fail(cors, 423, "locked", "Too many wrong tries. Please ask for a new code.", { attemptsLeft: 0 })
      : fail(cors, 400, "wrong_code", `Incorrect code. ${out.left} ${out.left === 1 ? "try" : "tries"} left.`, { attemptsLeft: out.left });
  }
  const email = await unseal(env, out.ec);
  track(env, ctx, { verified_otp: 1 }, { k: "verified_otp", p: out.p, m: out.m });
  return json(cors, { ok: true, email, purpose: out.p, via: "otp" });
}

async function actStatus(env, cors, body) {
  const { res, cur } = await loadOwned(env, cors, body.ticket);
  if (res) return res;
  const now = Date.now();
  let status = cur.st === "sending" ? "pending" : cur.st;
  if (status === "pending" && now > cur.x && now > cur.lx) status = "expired";
  return json(cors, {
    ok: true, status, purpose: cur.p, via: cur.via || null, email: cur.m,
    expiresAt: cur.x, linkExpiresAt: cur.lx, codeExpired: now > cur.x,
    attemptsLeft: Math.max(0, (Number(cur.max) || DEFAULTS.maxAttempts) - (Number(cur.a) || 0)),
  });
}

async function actClaim(env, ctx, cors, body) {
  let rid = "", check;
  const t = parseTicket(body.ticket);
  if (t) {
    rid = t.rid;
    const sh = await hash(env, "sess", t.rid, t.session);
    check = (cur) => safeEq(cur.s, sh);
  } else if (RID_RE.test(String(body.rid || "")) && TOKEN_RE.test(String(body.grant || ""))) {
    rid = String(body.rid);
    const gh = await hash(env, "grant", rid);
    // Grants (from the link page) only finish a password reset on another device;
    // a sign-up must finish where its password was typed (it owns the ticket).
    check = (cur) => cur.p === "reset" && safeEq(gh, String(body.grant));
  } else return fail(cors, 400, "bad_ticket", "This request is invalid. Please start again.");
  const now = Date.now();
  const out = await dbTxn(env, `${ROOT}/tickets/${rid}`, (cur) => {
    if (!cur || !check(cur)) return { result: { e: "not_found" } };
    if (cur.st !== "verified") return { result: { e: "state", st: cur.st } };
    return { next: { ...cur, st: "consumed", claimed: now }, result: { ok: true, p: cur.p, m: cur.m, ec: cur.ec } };
  });
  if (out.e === "not_found") return fail(cors, 404, "not_found", "This verification was not found.");
  if (out.e === "state") {
    if (out.st === "pending" || out.st === "sending") return fail(cors, 409, "not_verified", "This email is not verified yet.");
    return stateError(cors, out.st);
  }
  track(env, ctx, { claimed: 1 }, { k: "claimed", p: out.p, m: out.m });
  return json(cors, { ok: true, email: await unseal(env, out.ec), purpose: out.p, via: "link" });
}

// Link page. GET only shows a confirm page (mail scanners pre-open links);
// the page auto-submits a POST, which is what actually verifies.
async function linkPage(env, ctx, req, rid, token) {
  const site = siteUrl(env);
  const action = `/v/${rid}/${token}`;
  if (!RID_RE.test(rid) || !TOKEN_RE.test(token)) {
    return html(pageHtml({ state: "error", redirect: site, title: "Invalid link", message: "This verification link is not valid. Please open the latest email from RS ANIME." }), 400);
  }
  if (req.method === "GET") {
    return html(pageHtml({ state: "confirm", action, redirect: site, title: "Verifying your email…", message: "Please wait a moment while we confirm your email address." }));
  }
  const lh = await hash(env, "link", rid, token);
  const now = Date.now();
  const out = await dbTxn(env, `${ROOT}/tickets/${rid}`, (cur) => {
    if (!cur || !safeEq(cur.l, lh)) return { result: { e: "invalid" } };
    const back = cur.org || site;
    if (cur.st === "verified") return { result: { ok: true, again: true, p: cur.p, back } };
    if (cur.st === "consumed" && cur.via === "link") return { result: { e: "done", p: cur.p, back } };
    if (cur.st === "consumed") return { result: { e: "used", p: cur.p, back } };
    if (cur.st !== "pending") return { result: { e: cur.st, p: cur.p, back } };
    if (now > cur.lx) return { result: { e: "expired", p: cur.p, back } };
    return { next: { ...cur, st: "verified", via: "link", v: now }, result: { ok: true, p: cur.p, m: cur.m, back } };
  });
  const back = out.back || site;
  if (out.ok) {
    if (!out.again) track(env, ctx, { verified_link: 1 }, { k: "verified_link", p: out.p, m: out.m });
    const grant = await hash(env, "grant", rid);
    const redirect = `${back}/?ev=${rid}&eg=${encodeURIComponent(grant)}&ep=${out.p}`;
    return html(pageHtml({
      state: "success", purpose: out.p, redirect,
      title: out.p === "reset" ? "Email confirmed" : "Email verified",
      message: out.p === "reset" ? "It's really you. Taking you back to RS ANIME to set your new password." : "Your email address is verified. Taking you to RS ANIME…",
    }));
  }
  const msg = {
    invalid: ["Invalid link", "This verification link is not valid. Please open the latest email from RS ANIME."],
    done: ["Already verified", "This email was already verified. You can continue in the RS ANIME app."],
    used: ["Already verified", "This email was already verified with the code. You can continue in the app."],
    expired: ["Link expired", "This link has expired. Go back to RS ANIME and ask for a new email."],
    replaced: ["Newer email sent", "A newer email was sent to you. Please use the button in the latest email."],
    locked: ["Request locked", "This request was locked after too many wrong codes. Ask for a new email."],
    failed: ["Link not valid", "This email could not be confirmed. Please ask for a new one."],
    sending: ["Please try again", "This email is still being prepared. Try the button again in a few seconds."],
  }[out.e] || ["Link not valid", "Please ask for a new verification email."];
  if (out.e === "expired") track(env, ctx, { expired: 1 }, { k: "expired", p: out.p });
  return html(pageHtml({ state: out.e === "done" || out.e === "used" ? "info" : "error", redirect: back, title: msg[0], message: msg[1] }), out.e === "invalid" ? 400 : 200);
}

let deepMemo = { at: 0, v: null };
async function health(env, deep) {
  const missing = MISSING(env);
  const out = {
    ok: true, service: VERSION, provider: "gmail-api", ready: missing.length === 0, missing,
    optional: { EMAIL_SECRET: !!env.EMAIL_SECRET, SITE_URL: !!env.SITE_URL, FIREBASE_DB_URL: !!env.FIREBASE_DB_URL, FIREBASE_DB_SECRET: !!env.FIREBASE_DB_SECRET },
    sender: env.GMAIL_SENDER_EMAIL ? maskEmail(normEmail(env.GMAIL_SENDER_EMAIL)) : null,
    senderValid: env.GMAIL_SENDER_EMAIL ? SENDER_RE.test(String(env.GMAIL_SENDER_EMAIL).trim()) : false,
    settings: await settings(env),
  };
  if (deep && out.ready) {
    if (deepMemo.v && Date.now() - deepMemo.at < 60_000) out.gmail = deepMemo.v;
    else {
      const t0 = Date.now();
      try {
        const tk = await gmailAccessToken(env, true);
        const scoped = !tk.scope || /gmail\.send|mail\.google\.com|gmail\.modify|gmail\.compose/.test(tk.scope);
        out.gmail = { ok: scoped, code: scoped ? "ok" : "gmail_scope_missing", ms: Date.now() - t0, message: scoped ? "Gmail authorised" : "Token works but is missing the gmail.send scope" };
      } catch (err) {
        out.gmail = { ok: false, code: err?.code || "error", ms: Date.now() - t0, message: String(err?.message || err).slice(0, 200) };
      }
      deepMemo = { at: Date.now(), v: out.gmail };
    }
  }
  return out;
}

export default {
  // Exposed for the project's unit tests only (not routes).
  _internals: { buildMime, emailTemplate, makeOtp, originAllowed },
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const cors = corsFor(req, env);
    env = { ...env, __WORKER_ORIGIN: url.origin };
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const path = url.pathname.replace(/\/+$/, "") || "/";
    try {
      const link = path.match(/^\/v\/([^/]+)\/([^/]+)$/);
      if (link) {
        if (MISSING(env).length) return html(pageHtml({ state: "error", redirect: siteUrl(env), title: "Service unavailable", message: "Email verification is being set up. Please try again soon." }), 503);
        if (req.method !== "GET" && req.method !== "POST") return new Response("Method not allowed", { status: 405 });
        return await linkPage(env, ctx, req, link[1], link[2]);
      }
      if (req.method === "GET") {
        if (path === "/preview") {
          const type = url.searchParams.get("type") === "reset" ? "reset" : "register";
          const cfg = await settings(env);
          const tpl = emailTemplate({ purpose: type, code: "482913", link: `${url.origin}/v/preview/example`, name: "Rahat", email: "you@gmail.com", otpMinutes: cfg.otpMinutes, linkMinutes: cfg.linkMinutes, site: siteUrl(env), requestedAt: Date.now() });
          if (url.searchParams.get("format") === "text") return new Response(tpl.text, { headers: { ...cors, ...baseHeaders, "Content-Type": "text/plain; charset=utf-8" } });
          return new Response(tpl.html, { headers: { ...cors, ...baseHeaders, "Content-Type": "text/html; charset=utf-8" } });
        }
        if (path === "/" || path === "/health") return json({ ...cors, "Access-Control-Allow-Origin": "*" }, await health(env, url.searchParams.get("deep") === "1"));
        return fail(cors, 404, "not_found", "Unknown route.");
      }
      if (req.method !== "POST") return fail(cors, 405, "method", "Use POST.");
      const origin = req.headers.get("Origin") || "";
      if (!originAllowed(origin, env)) return fail(cors, 403, "origin_not_allowed", "This website is not allowed to use the RS ANIME email service.");
      const missing = MISSING(env);
      if (missing.length) return fail(cors, 503, "not_configured", "Email service is not set up yet. Please try again later.", { missing });
      if (Number(req.headers.get("content-length") || 0) > 4096) return fail(cors, 413, "too_large", "Request too large.");
      let body = {};
      try { body = await req.json(); } catch { return fail(cors, 400, "bad_json", "Request body must be JSON."); }
      if (!body || typeof body !== "object") return fail(cors, 400, "bad_json", "Request body must be JSON.");
      const action = path.startsWith("/api/") ? path.slice(5) : String(body.action || "");
      const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "0.0.0.0";
      switch (action) {
        case "send": case "send-otp": case "send-link": return await actSend(env, ctx, cors, body, origin, ip);
        case "resend": return await actResend(env, ctx, cors, body, origin, ip);
        case "verify": case "verify-otp": return await actVerify(env, ctx, cors, body, ip);
        case "status": return await actStatus(env, cors, body);
        case "claim": return await actClaim(env, ctx, cors, body);
        default: return fail(cors, 400, "bad_action", "Unknown action.");
      }
    } catch (err) {
      console.error("email-service error:", err?.code || "", String(err?.message || err).slice(0, 200));
      return fail(cors, 500, err?.code || "server", PUBLIC_ERRORS[err?.code] || "Something went wrong. Please try again.");
    }
  },
};
