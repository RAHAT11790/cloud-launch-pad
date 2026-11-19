// @ts-nocheck
// Lovable Cloud copy of cloudflare-workers/email-service.js (same code, Deno adapter
// at the end). Keep both files identical above the adapter — a unit test checks it.
// ============================================================
// RS ANIME — EMAIL SERVICE · SMTP (Alwaysdata, Cloudflare build) · v8
// ------------------------------------------------------------
// Sign-up verification + password-reset codes sent over SMTP
// (port 465, direct TLS) through the Alwaysdata mailbox.
//
// Required secret (Cloudflare → Worker → Settings → Variables
// and Secrets → Add → type "Secret"):
//   SMTP_PASS            password of the Alwaysdata mailbox
// Optional (defaults in SMTP_DEFAULTS below):
//   SMTP_HOST            smtp-rsanime03.alwaysdata.net
//   SMTP_PORT            465
//   SMTP_USER            rsanime03@alwaysdata.net
//   SMTP_FROM            sender address (defaults to SMTP_USER)
//   EMAIL_SECRET         long random text used to hash codes
//   SITE_URL             default https://rsanime03.lovable.app (allowed origin)
//   FIREBASE_DB_URL      Firebase Realtime Database URL
//   FIREBASE_DB_SECRET   Firebase database secret (admin writes)
//   ALLOWED_ORIGINS      extra site origins, comma separated
//   ADMIN_PIN            unlocks full emails in the admin panel
//
// Routes
//   GET  /                 → health  (?deep=1 also logs in to SMTP)
//   GET  /preview?type=register|reset[&format=text] → template
//   POST /  { action, ... } or POST /api/{action}
//     send | send-otp               { email, purpose, name? }
//     resend                         { ticket }
//     verify | verify-otp            { ticket, code }
//
// Inbox placement: the email is code-only — no links, no buttons, no images,
// no web addresses — and the whole SMTP conversation uses only Alwaysdata's
// own names (EHLO = the account's alwaysdata.net host, From/Message-ID on
// alwaysdata.net), which Alwaysdata signs with DKIM d=alwaysdata.net.
//
// Security: OTP and session are stored only as HMAC-SHA256 hashes;
// the email address is AES-GCM encrypted. Every state change is a
// conditional (ETag) write, so a code works exactly once.
// ============================================================

const VERSION = "email-service-smtp-v10";
const BRAND = "RS ANIME03";
const DEFAULT_SITE = "https://rsanime03.lovable.app";
const DEFAULT_DB = "https://animeverse-d7b79-default-rtdb.asia-southeast1.firebasedatabase.app";
const PROJECT_TAG = "d9496f6f-add2-411c-96f8-fb97b0c234a7";
const ROOT = "emailAuth";

// Sending limits (admin can tune inside BOUNDS): one live code at a time with a
// 60-second resend wait, 3 codes per email per Bangladesh day, and service caps
// that keep the mailbox well inside its provider's sending limits.
const DEFAULTS = { otpMinutes: 5, cooldownSeconds: 60, maxAttempts: 5, perEmailDaily: 3, perIpDaily: 30, hourlyPerIp: 10, perMinute: 10, dailyLimit: 300 };
const BOUNDS = { otpMinutes: [1, 30], cooldownSeconds: [30, 3600], maxAttempts: [3, 10], perEmailDaily: [1, 20], perIpDaily: [2, 200], hourlyPerIp: [2, 100], perMinute: [2, 60], dailyLimit: [10, 2000] };
const IP_WRONG_PER_HOUR = 40;
const ADMIN_WRONG_PER_HOUR = 8;
const HOUR = 3600_000;
const DAY = 86400_000;

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
const minuteBucket = (t) => String(Math.floor(t / 60_000));
/** ms until the next Bangladesh midnight (when daily limits reset). */
const msToDayEnd = (t) => DAY - ((t + 6 * HOUR) % DAY);
const shortRef = (rid) => String(rid || "").slice(-8).toUpperCase();

// In-isolate shadow counters: a second, Firebase-independent layer. If someone
// lowers or deletes a counter in the database, the higher value seen here
// still wins for as long as this Worker instance lives.
const shadow = new Map();
function shadowGet(key, now) { const s = shadow.get(key); return s && s.exp > now ? s.v : 0; }
function shadowPut(key, v, exp) {
  if (shadow.size > 4000) { const now = Date.now(); for (const [k, s] of shadow) if (s.exp <= now || shadow.size > 3000) shadow.delete(k); }
  const cur = shadow.get(key);
  shadow.set(key, { v: Math.max(v, cur && cur.exp > Date.now() ? cur.v : 0), exp });
}
const shadowSet = (key, v, exp) => shadow.set(key, { v, exp });
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
  const src = env.EMAIL_SECRET || `smtp|${env.SMTP_PASS || ""}|${env.SMTP_USER || SMTP_DEFAULTS.user}`;
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

// Every ticket carries an HMAC seal ("g") over all of its fields. Anyone who
// edits a ticket directly in the database (status, attempts, hashes, expiry)
// breaks the seal and the ticket is treated as not found.
const TICKET_FIELDS = ["p", "e", "ec", "m", "o", "l", "s", "c", "x", "lx", "a", "max", "st", "org", "via", "v", "claimed"];
const ticketSig = (env, rid, t) => hash(env, "tkt", rid, JSON.stringify(TICKET_FIELDS.map((k) => (t[k] == null ? "" : String(t[k])))));
async function sealTicket(env, rid, t) { const { g, ...rest } = t; return { ...rest, g: await ticketSig(env, rid, rest) }; }
async function ticketValid(env, rid, t) { return !!t && typeof t === "object" && typeof t.g === "string" && safeEq(t.g, await ticketSig(env, rid, t)); }

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

// Ticket states that can never go back to "pending" (kept in memory as well,
// so replaying an old database snapshot cannot revive a finished code).
const FINAL = new Set(["consumed", "replaced", "locked", "failed"]);
/** Reads a ticket; a broken seal counts as "not found" (and is reported). */
async function ticketGet(env, ctx, rid) {
  const cur = await dbGet(env, `${ROOT}/tickets/${rid}`);
  if (cur == null) return null;
  if (!(await ticketValid(env, rid, cur))) { track(env, ctx, { tampered: 1 }, { k: "tampered" }); return null; }
  return withShadow(rid, cur);
}
function withShadow(rid, cur) {
  const a = Math.max(Number(cur.a) || 0, shadowGet(`a:${rid}`, Date.now()));
  const fin = shadow.get(`st:${rid}`);
  return { ...cur, a, ...(fin && FINAL.has(fin.v) && !FINAL.has(cur.st) ? { st: fin.v } : {}) };
}
/** Sealed optimistic transaction on one ticket. fn(cur|null) → { next, result }. */
function ticketTxn(env, ctx, rid, fn) {
  return dbTxn(env, `${ROOT}/tickets/${rid}`, async (raw) => {
    let cur = null;
    if (raw != null) {
      if (await ticketValid(env, rid, raw)) cur = withShadow(rid, raw);
      else track(env, ctx, { tampered: 1 }, { k: "tampered" });
    }
    const out = await fn(cur);
    if (out.next !== undefined) {
      const exp = Date.now() + DAY;
      shadowPut(`a:${rid}`, Number(out.next.a) || 0, exp);
      if (FINAL.has(out.next.st)) shadowSet(`st:${rid}`, out.next.st, exp);
      out.next = await sealTicket(env, rid, out.next);
    }
    return out;
  });
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
  for (const node of ["wrong", "adminWrong"]) {
    const buckets = await dbGet(env, `${ROOT}/${node}`, { shallow: "true" }).catch(() => null);
    for (const b of Object.keys(buckets || {})) if (Number(b) < Number(hourBucket(now)) - 2) patch[`${node}/${b}`] = null;
  }
  const keepDays = new Set([dayKey(now), dayKey(now - DAY)]);
  for (const node of ["rl/mail", "rl/ip"]) {
    const days = await dbGet(env, `${ROOT}/${node}`, { shallow: "true" }).catch(() => null);
    for (const d of Object.keys(days || {})) if (!keepDays.has(d)) patch[`${node}/${d}`] = null;
  }
  const mins = await dbGet(env, `${ROOT}/rl/min`, { shallow: "true" }).catch(() => null);
  for (const m of Object.keys(mins || {})) if (Number(m) < Number(minuteBucket(now)) - 5) patch[`rl/min/${m}`] = null;
  // Old v3 counters
  for (const node of ["ip", "mail"]) patch[node] = null;
  const events = await dbGet(env, `${ROOT}/events`, { shallow: "true" }).catch(() => null);
  const ek = Object.keys(events || {}).sort();
  for (const k of ek.slice(0, Math.max(0, ek.length - 300))) patch[`events/${k}`] = null;
  if (Object.keys(patch).length) await dbPatch(env, ROOT, patch);
}

// ---------------- SMTP (Alwaysdata, port 465 direct TLS) ----------------
const SMTP_DEFAULTS = { host: "smtp-rsanime03.alwaysdata.net", port: 465, user: "rsanime03@alwaysdata.net" };
const smtpConf = (env) => {
  const user = String(env.SMTP_USER || SMTP_DEFAULTS.user).trim();
  return {
    host: String(env.SMTP_HOST || SMTP_DEFAULTS.host).trim(),
    port: Number(env.SMTP_PORT) || SMTP_DEFAULTS.port,
    user,
    pass: String(env.SMTP_PASS || ""),
    from: String(env.SMTP_FROM || user).trim(),
  };
};
/**
 * EHLO name from the mail provider's own naming, never the site's domain:
 * smtp-<account>.alwaysdata.net → <account>.alwaysdata.net (a real host of the same account).
 */
const ehloName = (env) => {
  const h = smtpConf(env).host.toLowerCase();
  return /^smtp-[a-z0-9-]+\.alwaysdata\.net$/.test(h) ? h.slice(5) : h;
};
function mailError(code, message) { const e = new Error(message); e.code = code; return e; }
/** Opens a TLS socket. Cloudflare: cloudflare:sockets; other runtimes set globalThis.__rsOpenTls. */
async function openTls(host, port) {
  if (typeof globalThis.__rsOpenTls === "function") return globalThis.__rsOpenTls(host, port);
  const spec = "cloudflare:" + "sockets";
  const { connect } = await import(spec);
  const s = connect({ hostname: host, port }, { secureTransport: "on", allowHalfOpen: false });
  await s.opened;
  return { readable: s.readable, writable: s.writable, close: () => { try { s.close(); } catch {} } };
}
const withTimeout = (p, ms, code, what) => {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(mailError(code, `${what} timed out`)), ms); })]).finally(() => clearTimeout(t));
};
/** One SMTP conversation. send(null) only logs in (health check). */
async function smtpSession(env, msg) {
  const c = smtpConf(env);
  if (!c.pass) throw mailError("smtp_not_configured", "SMTP_PASS secret is missing");
  let sock;
  try { sock = await withTimeout(openTls(c.host, c.port), 12_000, "smtp_connect_failed", "Connecting to the mail server"); }
  catch (e) { throw e.code ? e : mailError("smtp_connect_failed", `Could not reach ${c.host}:${c.port} (${String(e?.message || e).slice(0, 120)})`); }
  const reader = sock.readable.getReader();
  const writer = sock.writable.getWriter();
  let buf = "";
  const readReply = () => withTimeout((async () => {
    const lines = [];
    for (;;) {
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, "");
        buf = buf.slice(i + 1);
        lines.push(line);
        if (/^\d{3}(?: |$)/.test(line)) return { code: Number(line.slice(0, 3)), text: lines.join(" | ").slice(0, 240) };
      }
      const { value, done } = await reader.read();
      if (done) throw mailError("smtp_closed", "Mail server closed the connection");
      buf += dec.decode(value, { stream: true });
    }
  })(), 20_000, "smtp_timeout", "Mail server reply");
  const write = (s) => writer.write(enc.encode(s));
  const step = async (cmd, ok, code, what) => {
    if (cmd != null) await write(cmd + "\r\n");
    const r = await readReply();
    if (!ok.includes(r.code)) {
      const busy = r.code >= 400 && r.code < 500;
      const quota = /limit|quota|too many|rate/i.test(r.text);
      throw mailError(quota ? "smtp_quota" : busy ? "smtp_busy" : code, `${what}: ${r.text}`);
    }
    return r;
  };
  try {
    await step(null, [220], "smtp_greeting", "Greeting");
    await step(`EHLO ${ehloName(env)}`, [250], "smtp_ehlo", "EHLO");
    await step(`AUTH PLAIN ${bytesToB64(enc.encode(`\u0000${c.user}\u0000${c.pass}`))}`, [235], "smtp_auth_failed", "Login refused");
    if (msg) {
      if ([msg.to, c.from].some(hasCtl)) throw mailError("bad_header", "Invalid address");
      await step(`MAIL FROM:<${c.from}>`, [250], "smtp_rejected", "Sender refused");
      await step(`RCPT TO:<${msg.to}>`, [250, 251], "smtp_rcpt_rejected", "Recipient refused");
      await step("DATA", [354], "smtp_rejected", "DATA refused");
      const raw = buildMime({ ...msg, from: c.from }).replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
      await write(raw.endsWith("\r\n") ? raw : raw + "\r\n");
      const r = await step(".", [250], "smtp_rejected", "Message refused");
      await write("QUIT\r\n").catch(() => 0);
      return r.text;
    }
    await write("QUIT\r\n").catch(() => 0);
    return "ok";
  } finally {
    try { reader.releaseLock(); } catch {}
    try { writer.releaseLock(); } catch {}
    sock.close();
  }
}
const encWord = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${bytesToB64(enc.encode(s))}?=`);
const wrap76 = (s) => s.match(/.{1,76}/g)?.join("\r\n") || "";
function buildMime({ from, to, subject, text, html, ref, date = new Date() }) {
  if ([from, to, subject, ref].some(hasCtl)) throw mailError("bad_header", "Invalid header value");
  const b = `rs_${randBase36(18)}`;
  const domain = String(from).split("@")[1] || "rsanime.mail";
  const head = [
    `From: "${encWord(BRAND)}" <${from}>`,
    `To: <${to}>`,
    `Subject: ${encWord(subject)}`,
    `Date: ${date.toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${ref}.${date.getTime().toString(36)}@${domain}>`,
    "MIME-Version: 1.0",
    "Auto-Submitted: auto-generated",
    `X-Entity-Ref-ID: ${ref}`,
    `Content-Type: multipart/alternative; boundary="${b}"`,
  ];
  const part = (type, body) => [`--${b}`, `Content-Type: ${type}; charset=UTF-8`, "Content-Transfer-Encoding: base64", "", wrap76(bytesToB64(enc.encode(body)))].join("\r\n");
  return `${head.join("\r\n")}\r\n\r\n${part("text/plain", text)}\r\n${part("text/html", html)}\r\n--${b}--\r\n`;
}
const sendMail = (env, msg) => smtpSession(env, msg);

// ---------------- templates ----------------
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
const MONO = "'SF Mono',SFMono-Regular,Menlo,Consolas,'Roboto Mono','Courier New',monospace";
// "Midnight sapphire" palette: deep navy surfaces, cyan→royal-blue accent, gold highlight.
const C = {
  bg: "#05070D", card: "#0B1120", cardTop: "#111A2E", line: "#1C2740", hi: "#2B3A5C",
  slab: "#0F172A", slabTop: "#1E293B", depth: "#020617",
  cyan: "#38BDF8", blue: "#2563EB", navy: "#1E3A8A",
  grad: "linear-gradient(160deg,#38BDF8 0%,#2563EB 55%,#1E3A8A 100%)",
  btnGrad: "linear-gradient(180deg,#4CC9FA 0%,#2563EB 100%)",
  gold: "#F5C451", text: "#F8FAFC", soft: "#B6C2D9", mute: "#8392AD", dim: "#5E6B85",
};
// Layered shadows give the code and brand an extruded, raised (3D) look.
const DIGIT_3D = "0 1px 0 #BAE6FD,0 2px 0 #7DD3FC,0 3px 0 #38BDF8,0 4px 0 #0EA5E9,0 5px 0 #0369A1,0 10px 18px rgba(14,165,233,.45)";
const BRAND_3D = "0 1px 0 #1D4ED8,0 2px 0 #1E40AF,0 3px 0 #1E3A8A,0 4px 0 #172554,0 8px 16px rgba(2,6,23,.55)";
function fmtTime(t) {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dhaka", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(t)) + " · Bangladesh time";
  } catch { return new Date(t).toUTCString(); }
}
const mins = (n) => `${n} minute${n === 1 ? "" : "s"}`;
function copyFor(purpose) {
  return purpose === "reset"
    ? { title: "Reset your password", label: "Password reset code", subject: (c) => `Your ${BRAND} password reset code: ${c}`,
        intro: `Use this code to reset the password of your ${BRAND} account.` }
    : { title: "Verify your email", label: "Verification code", subject: (c) => `Your ${BRAND} verification code: ${c}`,
        intro: `Use this code to verify your email and finish creating your ${BRAND} account.` };
}

/**
 * Code-only email: no links, buttons, images or web addresses (each one is a spam
 * signal for a shared sender). The subject and first lines say "<kind> code: 123456",
 * the pattern Gmail's own "Copy code" chip looks for. Emails cannot run scripts, so
 * the code is one select-all block: a single long-press selects it for copying.
 */
function emailTemplate({ purpose, code, name, otpMinutes, requestedAt }) {
  const c = copyFor(purpose);
  const year = new Date(requestedAt).getUTCFullYear();
  const hi = name ? `Hi <b style="color:#FFFFFF;">${esc(name)}</b>,` : "Hi there,";
  const pre = `Your ${c.label.toLowerCase()} is ${code}. It expires in ${mins(otpMinutes)}.`;
  const td = `font-family:${FONT};`;
  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no">
<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">
<title>${esc(c.title)} · ${BRAND}</title>
<style>
body{margin:0!important;padding:0!important;background:${C.bg};-webkit-text-size-adjust:100%}
.rs-code a{color:${C.text}!important;text-decoration:none!important}
@media (max-width:520px){
.rs-pad{padding-left:20px!important;padding-right:20px!important}
.rs-outer{padding:14px 8px!important}
.rs-h1{font-size:23px!important;line-height:30px!important}
.rs-code{font-size:36px!important;letter-spacing:9px!important;padding:18px 8px 20px 17px!important}
.rs-brand{font-size:21px!important;letter-spacing:4px!important}
}
</style></head>
<body style="margin:0;padding:0;background:${C.bg};">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;color:${C.bg};">${esc(pre)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.bg}" style="background:${C.bg};background-image:radial-gradient(120% 60% at 50% 0%,#0E2A4F 0%,${C.bg} 62%);">
<tr><td align="center" class="rs-outer" style="padding:32px 14px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">

<tr><td bgcolor="${C.card}" style="background:${C.card};background-image:linear-gradient(180deg,${C.cardTop} 0%,${C.card} 40%);border:1px solid ${C.line};border-top:1px solid ${C.hi};border-bottom:4px solid ${C.depth};border-radius:20px;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.6);">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td align="center" bgcolor="${C.blue}" style="background:${C.blue};background-image:${C.grad};border-radius:19px 19px 0 0;border-bottom:3px solid ${C.navy};padding:28px 20px 24px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr>
        <td style="padding:4px;border-radius:22px;background:rgba(255,255,255,.22);border-top:1px solid rgba(255,255,255,.7);border-bottom:3px solid rgba(15,23,42,.55);box-shadow:0 10px 22px rgba(2,6,23,.45);">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            <td align="center" valign="middle" width="58" height="58" bgcolor="${C.slab}" style="${td}width:58px;height:58px;border-radius:18px;background:${C.slab};background-image:linear-gradient(160deg,${C.slabTop} 0%,${C.depth} 100%);border-top:1px solid #64748B;border-bottom:3px solid ${C.depth};font-size:23px;line-height:58px;font-weight:900;letter-spacing:1px;color:#FFFFFF;text-shadow:${DIGIT_3D};">R<span style="color:${C.gold};">S</span></td>
          </tr></table>
        </td>
      </tr></table>
      <div class="rs-brand" style="${td}margin-top:14px;font-size:24px;font-weight:900;letter-spacing:5px;color:#FFFFFF;text-transform:uppercase;text-shadow:${BRAND_3D};">RS&nbsp;ANIME<span style="color:${C.gold};">03</span></div>
    </td></tr>

    <tr><td class="rs-pad" align="center" style="padding:30px 36px 0;">
      <h1 class="rs-h1" style="${td}margin:0;font-size:26px;line-height:34px;font-weight:800;color:#FFFFFF;letter-spacing:-.2px;">${esc(c.title)}</h1>
      <p style="${td}margin:12px 0 0;font-size:15px;line-height:24px;color:${C.soft};">${hi}<br>${esc(c.intro)}</p>
    </td></tr>

    <tr><td class="rs-pad" align="center" style="padding:26px 36px 0;">
      <div style="${td}font-size:11px;font-weight:800;letter-spacing:3px;color:${C.mute};text-transform:uppercase;">Your ${esc(c.label.toLowerCase())}</div>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin-top:12px;"><tr>
        <td class="rs-code" align="center" bgcolor="${C.slab}" style="background:${C.slab};background-image:linear-gradient(180deg,${C.slabTop} 0%,${C.slab} 100%);border:1px solid #334155;border-top:1px solid #64748B;border-bottom:6px solid ${C.depth};border-radius:18px;padding:20px 14px 22px 26px;font-family:${MONO};font-size:42px;line-height:48px;font-weight:800;letter-spacing:12px;color:${C.text};text-shadow:${DIGIT_3D};box-shadow:0 18px 34px rgba(0,0,0,.55),0 0 0 4px rgba(56,189,248,.10);user-select:all;-webkit-user-select:all;white-space:nowrap;">${esc(code)}</td>
      </tr></table>
      <div style="${td}margin-top:14px;font-size:12px;line-height:18px;color:${C.mute};">Press and hold the code to copy it</div>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin-top:12px;"><tr>
        <td style="${td}padding:7px 14px;border-radius:999px;background:rgba(245,196,81,.10);border:1px solid rgba(245,196,81,.35);font-size:12px;font-weight:700;color:${C.gold};">&#9201;&nbsp; This code expires in ${mins(otpMinutes)}.</td>
      </tr></table>
    </td></tr>

    <tr><td class="rs-pad" style="padding:26px 36px 30px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0E1A2F;border:1px solid ${C.line};border-left:3px solid ${C.gold};border-radius:12px;">
        <tr><td style="${td}padding:14px 16px;font-size:13px;line-height:20px;color:${C.soft};">&#128737;&#65039;&nbsp; <b style="color:#FFFFFF;">Never share this code with anyone.</b> ${BRAND} will never ask for it. If you didn't request it, you can ignore this email.</td></tr>
      </table>
    </td></tr>
  </table>
</td></tr>

<tr><td align="center" style="${td}padding:20px 16px 6px;font-size:11px;line-height:17px;color:${C.dim};">
  This is an automated message from ${BRAND}. Please don't reply.<br>&copy; ${year} ${BRAND}
</td></tr>

</table>
</td></tr></table>
</body></html>`;
  const text = [
    BRAND,
    "",
    c.title,
    name ? `Hi ${name},` : "Hi there,",
    c.intro,
    "",
    `Your ${c.label.toLowerCase()}: ${code}`,
    `This code expires in ${mins(otpMinutes)}.`,
    "",
    "Never share this code with anyone. " + `${BRAND} will never ask for it.`,
    "If you didn't request it, you can ignore this email.",
    "",
    `This is an automated message from ${BRAND}. Please don't reply.`,
  ].join("\n");
  return { subject: c.subject(code), html, text };
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
const MISSING = (env) => ["SMTP_PASS"].filter((k) => !env[k]);
function parseTicket(t) {
  const [rid, session] = String(t || "").split(".");
  return RID_RE.test(rid || "") && TOKEN_RE.test(session || "") ? { rid, session } : null;
}
const PUBLIC_ERRORS = {
  smtp_quota: "Email sending limit reached for now. Please try again later.",
  db_error: "Server storage is busy. Please try again.",
  db_busy: "Server is busy. Please try again.",
};
const publicMailMessage = (code) => PUBLIC_ERRORS[code] || "Email could not be sent right now. Please try again in a few minutes.";

// ---------------- core flows ----------------
function noteHealth(env, ctx, patch) {
  const p = dbPatch(env, `${ROOT}/health`, patch).catch(() => 0);
  if (ctx?.waitUntil) ctx.waitUntil(p);
}
const bump = (cur, n) => Math.max(Number(cur) || 0, n);

async function refundSend(env, { day, eh, ih, rid, prevLast, hb }) {
  const now = Date.now();
  await Promise.allSettled([
    dbTxn(env, `${ROOT}/rl/mail/${day}/${eh}`, (cur) => (cur && cur.rid === rid
      ? { next: { ...cur, n: Math.max(0, (Number(cur.n) || 1) - 1), last: Number(cur.prevLast) || 0 }, result: 1 }
      : { result: 0 })),
    dbTxn(env, `${ROOT}/rl/ip/${day}/${ih}`, (cur) => (cur
      ? { next: { ...cur, n: Math.max(0, (Number(cur.n) || 1) - 1), hn: cur.hb === hb ? Math.max(0, (Number(cur.hn) || 1) - 1) : Number(cur.hn) || 0 }, result: 1 }
      : { result: 0 })),
  ]);
  const dayExp = now + msToDayEnd(now);
  shadowSet(`md:${day}:${eh}`, Math.max(0, shadowGet(`md:${day}:${eh}`, now) - 1), dayExp);
  shadowSet(`ml:${eh}`, prevLast || 0, now + 2 * DAY);
  shadowSet(`ipd:${day}:${ih}`, Math.max(0, shadowGet(`ipd:${day}:${ih}`, now) - 1), dayExp);
  shadowSet(`iph:${hb}:${ih}`, Math.max(0, shadowGet(`iph:${hb}:${ih}`, now) - 1), now + HOUR);
}

/** Per-email gate (one live code + daily count), read-only. */
function mailGate(cfg, now, cur, prev, eh, day) {
  const n = Math.max(Number(cur?.n) || 0, shadowGet(`md:${day}:${eh}`, now));
  const last = Math.max(Number(cur?.last) || 0, Number(prev?.last) || 0, shadowGet(`ml:${eh}`, now));
  const wait = last + cfg.cooldownSeconds * 1000 - now;
  if (wait > 0) return { err: "cooldown", wait, n, last };
  if (n >= cfg.perEmailDaily) return { err: "email_daily", n, last };
  return { n, last };
}

async function issueTicket(env, ctx, cors, { email, purpose, name, origin, ip, replaces }) {
  const cfg = await settings(env);
  const now = Date.now();
  const day = dayKey(now);
  const dayExp = now + msToDayEnd(now);
  const toMidnight = Math.ceil(msToDayEnd(now) / 1000);
  const hb = hourBucket(now);
  const [eh, ih, ec] = await Promise.all([hash(env, "email", email), hash(env, "ip", ip), seal(env, email)]);
  const m = maskEmail(email);
  const ev = (k, extra = {}) => ({ k, p: purpose, m, ec, ...extra });
  const limited = (error, why, message, extra = {}) => {
    track(env, ctx, { limited: 1 }, ev("limited", { why }));
    return fail(cors, 429, error, message, extra);
  };
  const mailPath = `${ROOT}/rl/mail/${day}/${eh}`;
  const prevDay = await dbGet(env, `${ROOT}/rl/mail/${dayKey(now - DAY)}/${eh}`).catch(() => null);

  // 1) One live code per email + daily limit. Checked first and read-only, so a
  //    rejected request never uses up any other counter.
  const pre = mailGate(cfg, now, await dbGet(env, mailPath), prevDay, eh, day);
  if (pre.err === "cooldown") {
    const s = Math.ceil(pre.wait / 1000);
    return limited("cooldown", "cooldown", `A code was already sent. You can ask for a new one in ${s >= 60 ? `${Math.ceil(s / 60)} min` : `${s}s`}.`, { retryAfter: s, dailyLeft: Math.max(0, cfg.perEmailDaily - pre.n), dailyMax: cfg.perEmailDaily });
  }
  if (pre.err === "email_daily") {
    return limited("email_daily", "email_daily", `You've used all ${cfg.perEmailDaily} codes for this email today. Please try again tomorrow.`, { retryAfter: toMidnight, dailyLeft: 0, dailyMax: cfg.perEmailDaily });
  }

  // 2) Whole-service daily cap (keeps the mailbox inside its sending limits).
  const sentToday = Math.max(Number(await dbGet(env, `${ROOT}/stats/${day}/sent`).catch(() => 0)) || 0, shadowGet(`g:${day}`, now));
  if (sentToday >= cfg.dailyLimit) return limited("daily_limit", "daily", "Today's email limit is reached. Please try again tomorrow.", { retryAfter: toMidnight });

  // 3) Burst cap for the whole service (per minute).
  const mb = minuteBucket(now);
  const minN = await dbTxn(env, `${ROOT}/rl/min/${mb}`, (cur) => {
    const n = Math.max(Number(cur) || 0, shadowGet(`min:${mb}`, now));
    return n >= cfg.perMinute ? { result: 0 } : { next: n + 1, result: n + 1 };
  });
  if (!minN) return limited("busy", "minute", "Lots of people are requesting codes right now. Please try again in a minute.", { retryAfter: 60 });
  shadowPut(`min:${mb}`, minN, now + 120_000);

  // 4) Per network (IP): hourly + daily.
  const ipOut = await dbTxn(env, `${ROOT}/rl/ip/${day}/${ih}`, (cur) => {
    const n = Math.max(Number(cur?.n) || 0, shadowGet(`ipd:${day}:${ih}`, now));
    const hn = Math.max(cur?.hb === hb ? Number(cur?.hn) || 0 : 0, shadowGet(`iph:${hb}:${ih}`, now));
    if (n >= cfg.perIpDaily) return { result: { err: "ip_daily" } };
    if (hn >= cfg.hourlyPerIp) return { result: { err: "ip_hourly" } };
    return { next: { n: n + 1, hb, hn: hn + 1 }, result: { n: n + 1, hn: hn + 1 } };
  });
  if (ipOut.err === "ip_daily") return limited("too_many", "ip_daily", "Too many emails from this network today. Please try again tomorrow.", { retryAfter: toMidnight });
  if (ipOut.err) return limited("too_many", "ip_hourly", "Too many emails from this network. Please try again in an hour.", { retryAfter: 3600 });
  shadowPut(`ipd:${day}:${ih}`, ipOut.n, dayExp);
  shadowPut(`iph:${hb}:${ih}`, ipOut.hn, now + HOUR);

  // 5) Reserve the email slot (re-checked inside the transaction).
  const rid = `${now.toString(36)}${randBase36(12)}`;
  const gate = await dbTxn(env, mailPath, (cur) => {
    const g = mailGate(cfg, now, cur, prevDay, eh, day);
    if (g.err) return { result: g };
    return { next: { n: g.n + 1, last: now, rid, prevLast: g.last }, result: { n: g.n + 1, prevLast: g.last, prevRid: cur?.rid || prevDay?.rid || "" } };
  });
  if (gate.err) return limited("cooldown", "race", "A code was just sent. Please check your inbox.", { retryAfter: cfg.cooldownSeconds });
  shadowPut(`md:${day}:${eh}`, gate.n, dayExp);
  shadowSet(`ml:${eh}`, now, now + 2 * DAY);

  // 6) Create the sealed ticket, then send.
  const otp = makeOtp();
  const session = randToken(24);
  const x = now + cfg.otpMinutes * 60_000;
  const [oH, sH] = await Promise.all([hash(env, "otp", rid, otp), hash(env, "sess", rid, session)]);
  await ticketTxn(env, ctx, rid, () => ({
    next: { p: purpose, m, e: eh, ec, o: oH, s: sH, c: now, x, a: 0, max: cfg.maxAttempts, st: "sending", org: origin || "" },
    result: 1,
  }));

  const tpl = emailTemplate({ purpose, code: otp, name, otpMinutes: cfg.otpMinutes, requestedAt: now });
  const t0 = Date.now();
  try {
    await sendMail(env, { to: email, subject: tpl.subject, html: tpl.html, text: tpl.text, ref: rid });
  } catch (err) {
    const ms = Date.now() - t0;
    const codeErr = String(err?.code || "send_failed");
    await Promise.allSettled([
      ticketTxn(env, ctx, rid, (cur) => (cur ? { next: { ...cur, st: "failed" }, result: 1 } : { result: 0 })),
      refundSend(env, { day, eh, ih, rid, prevLast: gate.prevLast, hb }),
    ]);
    track(env, ctx, { failed: 1 }, ev("failed", { ms, err: codeErr, why: String(err?.message || "").slice(0, 200) }));
    noteHealth(env, ctx, { ok: false, lastErrAt: Date.now(), lastErr: codeErr, lastErrMsg: String(err?.message || "").slice(0, 300) });
    return fail(cors, codeErr === "smtp_quota" ? 429 : 502, codeErr, publicMailMessage(codeErr));
  }
  const ms = Date.now() - t0;
  await ticketTxn(env, ctx, rid, (cur) => (cur && cur.st === "sending" ? { next: { ...cur, st: "pending" }, result: 1 } : { result: 0 }));
  const old = replaces || gate.prevRid;
  if (old && old !== rid) {
    await ticketTxn(env, ctx, old, (cur) => (cur && (cur.st === "pending" || cur.st === "sending")
      ? { next: { ...cur, st: "replaced" }, result: 1 } : { result: 0 })).catch(() => 0);
  }
  shadowPut(`g:${day}`, sentToday + 1, dayExp);
  track(env, ctx, { sent: 1, [`sent_${purpose}`]: 1, mail_ms: ms, mail_n: 1, ...(replaces ? { resend: 1 } : {}) }, ev("sent", { ms, r: shortRef(rid) }));
  noteHealth(env, ctx, { ok: true, lastOkAt: Date.now(), lastMs: ms });
  const dailyLeft = Math.max(0, cfg.perEmailDaily - gate.n);
  return json(cors, {
    ok: true, ticket: `${rid}.${session}`, rid, purpose, email: m,
    expiresAt: x, cooldown: cfg.cooldownSeconds, resendAt: now + cfg.cooldownSeconds * 1000, maxAttempts: cfg.maxAttempts,
    dailyLeft, dailyMax: cfg.perEmailDaily, otpMinutes: cfg.otpMinutes,
  });
}

/** A finished (used) code frees the email right away for its next request. */
async function releaseCooldown(env, eh, created, rid) {
  if (!eh) return;
  const t = Number(created) || Date.now();
  shadowSet(`ml:${eh}`, 0, Date.now() + 2 * DAY);
  await dbTxn(env, `${ROOT}/rl/mail/${dayKey(t)}/${eh}`, (cur) => (cur && cur.rid === rid ? { next: { ...cur, last: 0 }, result: 1 } : { result: 0 })).catch(() => 0);
}

const NO_ACCOUNT = "ID not found. Please sign up first.";
async function accountCheck(env, email, purpose) {
  const [user, canon] = await Promise.all([
    dbGet(env, `appUsers/${appUserKey(email)}`, { shallow: "true" }),
    purpose === "register" ? dbGet(env, `gmailRegistry/${canonicalKey(email)}`) : Promise.resolve(null),
  ]);
  if (purpose === "register" && (user != null || canon != null)) return { err: ["already_registered", "This email already has an account. Please sign in."] };
  // A real account record always has an id (profile-photo writes can leave id-less stubs).
  if (purpose === "reset" && !(user && typeof user === "object" && user.id)) return { err: ["no_account", NO_ACCOUNT] };
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

async function loadOwned(env, ctx, cors, ticket) {
  const t = parseTicket(ticket);
  if (!t) return { res: fail(cors, 400, "bad_ticket", "This request is invalid. Please start again.") };
  const cur = await ticketGet(env, ctx, t.rid);
  if (!cur || !safeEq(cur.s, await hash(env, "sess", t.rid, t.session))) return { res: fail(cors, 404, "not_found", "This request was not found. Please start again.") };
  return { t, cur };
}

async function actResend(env, ctx, cors, body, origin, ip) {
  const { res, t, cur } = await loadOwned(env, ctx, cors, body.ticket);
  if (res) return res;
  if (cur.st === "consumed") return fail(cors, 409, "already_used", "This email was already verified.");
  const email = await unseal(env, cur.ec);
  const acc = await accountCheck(env, email, cur.p);
  if (acc.err) return fail(cors, cur.p === "reset" ? 404 : 409, acc.err[0], acc.err[1]);
  return issueTicket(env, ctx, cors, { email, purpose: cur.p, name: acc.name || String(body.name || "").slice(0, 30), origin: cur.org || origin, ip, replaces: t.rid });
}

function stateError(cors, st) {
  if (st === "consumed") return fail(cors, 409, "already_used", "This code was already used.");
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
  const wb = hourBucket(now);
  const wrongPath = `${ROOT}/wrong/${wb}/${ih}`;
  const wrongKey = `w:${wb}:${ih}`;
  if (Math.max(Number(await dbGet(env, wrongPath).catch(() => 0)) || 0, shadowGet(wrongKey, now)) >= IP_WRONG_PER_HOUR) return fail(cors, 429, "too_many", "Too many wrong codes from this network. Try again later.", { retryAfter: 3600 });
  const sessHash = await hash(env, "sess", t.rid, t.session);
  const otpHash = await hash(env, "otp", t.rid, code);
  const out = await ticketTxn(env, ctx, t.rid, (cur) => {
    if (!cur || !safeEq(cur.s, sessHash)) return { result: { e: "not_found" } };
    if (cur.st !== "pending") return { result: { e: "state", st: cur.st } };
    if (now > cur.x) return { result: { e: "expired", p: cur.p, m: cur.m, ec: cur.ec } };
    const max = Number(cur.max) || DEFAULTS.maxAttempts;
    if ((Number(cur.a) || 0) >= max) return { next: { ...cur, st: "locked" }, result: { e: "state", st: "locked" } };
    if (!safeEq(cur.o, otpHash)) {
      const a = (Number(cur.a) || 0) + 1;
      return { next: { ...cur, a, ...(a >= max ? { st: "locked" } : {}) }, result: { e: "wrong", left: Math.max(0, max - a), p: cur.p, m: cur.m, ec: cur.ec } };
    }
    return { next: { ...cur, st: "consumed", via: "otp", v: now }, result: { ok: true, p: cur.p, m: cur.m, ec: cur.ec, e: null, eh: cur.e, c: cur.c } };
  });
  if (out.e === "not_found") return fail(cors, 404, "not_found", "This request was not found. Please start again.");
  if (out.e === "state") return stateError(cors, out.st);
  if (out.e === "expired") {
    track(env, ctx, { expired: 1 }, { k: "expired", p: out.p, m: out.m, ec: out.ec });
    return fail(cors, 410, "expired", "This code has expired. Please ask for a new one.");
  }
  if (out.e === "wrong") {
    const wn = await dbTxn(env, wrongPath, (n) => ({ next: Math.max(Number(n) || 0, shadowGet(wrongKey, now)) + 1, result: Math.max(Number(n) || 0, shadowGet(wrongKey, now)) + 1 })).catch(() => 0);
    shadowPut(wrongKey, Number(wn) || shadowGet(wrongKey, now) + 1, now + HOUR);
    const locked = out.left <= 0;
    track(env, ctx, { wrong: 1, ...(locked ? { locked: 1 } : {}) }, { k: locked ? "locked" : "wrong", p: out.p, m: out.m, ec: out.ec });
    return locked
      ? fail(cors, 423, "locked", "Too many wrong tries. Please ask for a new code.", { attemptsLeft: 0 })
      : fail(cors, 400, "wrong_code", `Incorrect code. ${out.left} ${out.left === 1 ? "try" : "tries"} left.`, { attemptsLeft: out.left });
  }
  const email = await unseal(env, out.ec);
  await releaseCooldown(env, out.eh, out.c, t.rid);
  track(env, ctx, { verified_otp: 1 }, { k: "verified_otp", p: out.p, m: out.m, ec: out.ec });
  return json(cors, { ok: true, email, purpose: out.p, via: "otp" });
}

let deepMemo = { at: 0, v: null };
async function health(env, deep) {
  const missing = MISSING(env);
  const now = Date.now();
  const day = dayKey(now);
  const [cfg, sentRaw, last] = await Promise.all([
    settings(env),
    dbGet(env, `${ROOT}/stats/${day}/sent`).catch(() => 0),
    dbGet(env, `${ROOT}/health`).catch(() => null),
  ]);
  const sent = Math.max(Number(sentRaw) || 0, shadowGet(`g:${day}`, now));
  const out = {
    ok: true, service: VERSION, provider: "smtp", ready: missing.length === 0, missing,
    optional: { EMAIL_SECRET: !!env.EMAIL_SECRET, SITE_URL: !!env.SITE_URL, FIREBASE_DB_URL: !!env.FIREBASE_DB_URL, FIREBASE_DB_SECRET: !!env.FIREBASE_DB_SECRET, ADMIN_PIN: !!env.ADMIN_PIN },
    sender: smtpConf(env).from,
    senderValid: SENDER_RE.test(smtpConf(env).from),
    smtpHost: `${smtpConf(env).host}:${smtpConf(env).port}`,
    settings: cfg,
    today: { day, sent, limit: cfg.dailyLimit, left: Math.max(0, cfg.dailyLimit - sent), resetsInSec: Math.ceil(msToDayEnd(now) / 1000) },
    last: last && typeof last === "object" ? {
      ok: last.ok !== false, lastOkAt: Number(last.lastOkAt) || 0, lastErrAt: Number(last.lastErrAt) || 0,
      lastErr: String(last.lastErr || "").slice(0, 40), lastErrMsg: String(last.lastErrMsg || "").slice(0, 300), lastMs: Number(last.lastMs) || 0,
    } : null,
    security: { sealedTickets: true, hashedCodes: true, encryptedEmails: true, shadowCounters: true },
    now,
  };
  if (deep && out.ready) {
    if (deepMemo.v && now - deepMemo.at < 60_000) out.smtp = deepMemo.v;
    else {
      const t0 = Date.now();
      try {
        await smtpSession(env, null);
        out.smtp = { ok: true, code: "ok", ms: Date.now() - t0, message: "Mail server login works", checkedAt: Date.now() };
      } catch (err) {
        out.smtp = { ok: false, code: err?.code || "error", ms: Date.now() - t0, message: String(err?.message || err).slice(0, 200), checkedAt: Date.now() };
      }
      deepMemo = { at: Date.now(), v: out.smtp };
    }
  }
  return out;
}

// Admin-only activity with full email addresses. Protected by the Worker's own
// ADMIN_PIN secret (never stored in the database) and a per-network wrong-PIN limit.
async function actAdminEvents(env, cors, body, ip) {
  if (!env.ADMIN_PIN) return fail(cors, 503, "admin_pin_not_set", "Add an ADMIN_PIN secret to this Worker to unlock full emails.");
  const now = Date.now();
  const ih = await hash(env, "ip", ip);
  const hb = hourBucket(now);
  const wp = `${ROOT}/adminWrong/${hb}/${ih}`;
  const wk = `aw:${hb}:${ih}`;
  const wrong = Math.max(Number(await dbGet(env, wp).catch(() => 0)) || 0, shadowGet(wk, now));
  if (wrong >= ADMIN_WRONG_PER_HOUR) return fail(cors, 429, "too_many", "Too many wrong PINs. Try again in an hour.", { retryAfter: 3600 });
  if (!safeEq(String(body.pin || "").trim(), String(env.ADMIN_PIN).trim())) {
    const n = await dbTxn(env, wp, (c) => { const v = Math.max(Number(c) || 0, wrong) + 1; return { next: v, result: v }; }).catch(() => wrong + 1);
    shadowPut(wk, Number(n) || wrong + 1, now + HOUR);
    return fail(cors, 401, "wrong_pin", "Wrong admin PIN.", { left: Math.max(0, ADMIN_WRONG_PER_HOUR - (Number(n) || 0)) });
  }
  const limit = Math.min(200, Math.max(10, Number(body.limit) || 80));
  const raw = await dbGet(env, `${ROOT}/events`, { orderBy: '"$key"', limitToLast: String(limit) }).catch(() => null);
  const rows = await Promise.all(Object.entries(raw || {}).map(async ([id, e]) => {
    let email = "";
    if (e && e.ec) { try { email = await unseal(env, e.ec); } catch { email = ""; } }
    return {
      id, t: Number(e?.t) || 0, k: String(e?.k || ""), p: String(e?.p || ""), m: String(e?.m || ""), email,
      ms: Number(e?.ms) || 0, err: String(e?.err || ""), why: String(e?.why || "").slice(0, 200), r: String(e?.r || ""),
    };
  }));
  rows.sort((a, b) => b.t - a.t);
  return json(cors, { ok: true, events: rows });
}

// ---------------- Passwords (never readable by visitors) ----------------
// Passwords live only as PBKDF2 hashes in the locked `secure/credentials/{node}/{key}`
// path and are checked here. Old plain-text `password` fields on account records are
// accepted once and moved to a hash. While `secure/authConfig/stripLegacy` is not true
// (the published site may still be the old build) the plain field is kept in sync;
// once true it is deleted on every write.
const PW_ITER = 100000;
const PW_MIN = 4, PW_MAX = 128;
const LOGIN_WRONG_PER_ACCOUNT = 10, LOGIN_WRONG_PER_IP = 40;
const NODE_RE = /^(appUsers|users)$/;
const KEY_RE = /^[A-Za-z0-9_\-,@%]{1,160}$/;
const FIREBASE_WEB_KEY = "AIzaSyASjrQM27mfAbHXA9ZqYv3YbubZPUxOR50";
async function pwHash(password, saltB64) {
  const salt = saltB64 ? b64urlToBytes(saltB64) : randBytes(16);
  const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: PW_ITER }, base, 256));
  return `pbkdf2$${PW_ITER}$${b64url(salt)}$${b64url(bits)}`;
}
async function pwCheck(password, stored) {
  const [kind, iter, salt, want] = String(stored || "").split("$");
  if (kind !== "pbkdf2" || Number(iter) !== PW_ITER || !salt || !want) return false;
  return safeEq((await pwHash(password, salt)).split("$")[3], want);
}
const credPath = (node, key) => `secure/credentials/${node}/${key}`;
const validRef = (r) => r && typeof r === "object" && NODE_RE.test(String(r.node || "")) && KEY_RE.test(String(r.key || ""));
async function stripLegacy(env) { return (await dbGet(env, "secure/authConfig/stripLegacy").catch(() => null)) === true; }
/** Saves a new password hash and keeps/deletes the old plain field per transition mode. */
async function storePassword(env, node, key, password) {
  await dbPut(env, credPath(node, key), { h: await pwHash(password), t: Date.now() });
  const rec = await dbGet(env, `${node}/${key}`, { shallow: "true" }).catch(() => null);
  if (rec && typeof rec === "object") {
    if (await stripLegacy(env)) { if (rec.password) await dbFetch(env, `${node}/${key}/password`, { method: "DELETE" }); }
    else await dbPut(env, `${node}/${key}/password`, password);
  }
}
/** state of one account: { hash } | { legacy } | { none, google } | null (no record) */
async function credState(env, node, key) {
  const [cred, rec] = await Promise.all([dbGet(env, credPath(node, key)).catch(() => null), dbGet(env, `${node}/${key}`, { shallow: "true" }).catch(() => null)]);
  if (cred && cred.h) return { hash: cred.h, rec };
  if (!rec || typeof rec !== "object") return null;
  if (rec.password) {
    const pw = await dbGet(env, `${node}/${key}/password`).catch(() => null);
    if (pw != null && String(pw)) return { legacy: String(pw), rec };
  }
  return { none: true, google: !!rec.googleAuth, rec };
}
async function wrongCount(env, kind, id, now) {
  const p = `secure/loginWrong/${hourBucket(now)}/${kind}/${await hash(env, "lw", kind, id)}`;
  return { p, n: Math.max(Number(await dbGet(env, p).catch(() => 0)) || 0, shadowGet(`lw:${p}`, now)) };
}
async function bumpWrong(env, w, now) {
  const n = await dbTxn(env, w.p, (c) => { const v = Math.max(Number(c) || 0, w.n) + 1; return { next: v, result: v }; }).catch(() => w.n + 1);
  shadowPut(`lw:${w.p}`, Number(n) || w.n + 1, now + HOUR);
}
/** Google sign-in proof: the Firebase ID token's verified email. */
async function googleEmail(idToken) {
  if (!idToken || typeof idToken !== "string" || idToken.length > 4000) return "";
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_WEB_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json", Referer: "https://rsanime03.lovable.app/" }, body: JSON.stringify({ idToken }),
  }).catch(() => null);
  if (!r || !r.ok) return "";
  const u = (await r.json().catch(() => ({})))?.users?.[0];
  return u && u.emailVerified && u.email ? normEmail(u.email) : "";
}
/** A finished (verified) code that has not yet been used to save a password. */
async function claimVerifiedTicket(env, ctx, ticket, purpose) {
  const t = parseTicket(ticket);
  if (!t) return { err: [400, "bad_ticket", "This request is invalid. Please start again."] };
  const sessHash = await hash(env, "sess", t.rid, t.session);
  const now = Date.now();
  const out = await ticketTxn(env, ctx, t.rid, (cur) => {
    if (!cur || !safeEq(cur.s, sessHash)) return { result: { e: "not_found" } };
    if (cur.st !== "consumed" || cur.p !== purpose) return { result: { e: "state" } };
    if (cur.claimed) return { result: { e: "used" } };
    if (now - (Number(cur.v) || 0) > 30 * 60_000) return { result: { e: "expired" } };
    return { next: { ...cur, claimed: now }, result: { ok: true, ec: cur.ec } };
  });
  if (!out.ok) return { err: out.e === "expired" ? [410, "expired", "This code has expired. Please ask for a new one."] : out.e === "used" ? [409, "already_used", "This code was already used. Please ask for a new one."] : [404, "not_found", "This request was not found. Please start again."] };
  return { email: normEmail(await unseal(env, out.ec)) };
}
const pwOk = (p) => typeof p === "string" && p.length >= PW_MIN && p.length <= PW_MAX && p.trim().length > 0;

async function actPassword(env, ctx, cors, body, ip) {
  const op = String(body.op || "");
  const now = Date.now();
  if (op === "login") {
    const refs = (Array.isArray(body.refs) ? body.refs : []).filter(validRef).slice(0, 8);
    const password = String(body.password || "");
    if (!refs.length || !pwOk(password)) return fail(cors, 400, "bad_request", "Enter your ID and password.");
    const ipW = await wrongCount(env, "ip", ip, now);
    if (ipW.n >= LOGIN_WRONG_PER_IP) return fail(cors, 429, "too_many", "Too many wrong passwords from this network. Try again in an hour.", { retryAfter: 3600 });
    const states = [];
    for (const r of refs) { const st = await credState(env, r.node, r.key); if (st) states.push({ r, st }); }
    if (!states.length) return fail(cors, 404, "not_found", "User not found!");
    const withPw = states.find((x) => x.st.hash || x.st.legacy);
    if (!withPw) {
      // Old accounts that never had a password: the first password typed becomes theirs
      // (same as before), except Google accounts, which must use Google.
      const target = states[0];
      if (states.some((x) => x.st.google)) return fail(cors, 403, "use_google", "This account uses Google. Tap Continue with Google.");
      await storePassword(env, target.r.node, target.r.key, password);
      return json(cors, { ok: true, node: target.r.node, key: target.r.key, claimed: true });
    }
    const accW = await wrongCount(env, "acc", `${withPw.r.node}/${withPw.r.key}`, now);
    if (accW.n >= LOGIN_WRONG_PER_ACCOUNT) return fail(cors, 429, "too_many", "Too many wrong passwords for this account. Try again in an hour, or reset it by email.", { retryAfter: 3600 });
    const good = withPw.st.hash ? await pwCheck(password, withPw.st.hash) : safeEq(password, withPw.st.legacy);
    if (!good) { await Promise.all([bumpWrong(env, ipW, now), bumpWrong(env, accW, now)]); return fail(cors, 401, "wrong_password", "Wrong password!"); }
    if (!withPw.st.hash) {
      await dbPut(env, credPath(withPw.r.node, withPw.r.key), { h: await pwHash(password), t: now });
      if (await stripLegacy(env)) await dbFetch(env, `${withPw.r.node}/${withPw.r.key}/password`, { method: "DELETE" });
    }
    return json(cors, { ok: true, node: withPw.r.node, key: withPw.r.key });
  }
  if (op === "status") {
    const refs = (Array.isArray(body.refs) ? body.refs : []).filter(validRef).slice(0, 8);
    for (const r of refs) { const st = await credState(env, r.node, r.key); if (st && (st.hash || st.legacy)) return json(cors, { ok: true, hasPassword: true }); }
    return json(cors, { ok: true, hasPassword: false });
  }
  if (op === "google-status" || op === "google-set") {
    const email = await googleEmail(body.idToken);
    if (!email) return fail(cors, 401, "bad_google", "Google sign-in expired. Please tap Continue with Google again.");
    const key = appUserKey(email);
    const st = await credState(env, "appUsers", key);
    const has = !!(st && (st.hash || st.legacy));
    if (op === "google-status") return json(cors, { ok: true, hasPassword: has });
    if (has) return fail(cors, 409, "already_set", "This account already has a password.");
    if (!pwOk(String(body.password || ""))) return fail(cors, 400, "weak_password", `Password must be at least ${PW_MIN} characters.`);
    await storePassword(env, "appUsers", key, String(body.password));
    return json(cors, { ok: true });
  }
  if (op === "reset" || op === "register") {
    const password = String(body.password || "");
    if (!pwOk(password) || password.length < 6) return fail(cors, 400, "weak_password", "Password must be at least 6 characters.");
    const c = await claimVerifiedTicket(env, ctx, body.ticket, op);
    if (c.err) return fail(cors, c.err[0], c.err[1], c.err[2]);
    const key = appUserKey(c.email);
    if (op === "reset") {
      const rec = await dbGet(env, `appUsers/${key}`, { shallow: "true" }).catch(() => null);
      if (!(rec && typeof rec === "object" && rec.id)) return fail(cors, 404, "no_account", NO_ACCOUNT);
    } else {
      const cred = await dbGet(env, credPath("appUsers", key)).catch(() => null);
      if (cred && cred.h) return fail(cors, 409, "already_registered", "This email already has an account. Please sign in.");
    }
    await storePassword(env, "appUsers", key, password);
    return json(cors, { ok: true, email: c.email });
  }
  if (op === "change") {
    const refs = (Array.isArray(body.refs) ? body.refs : []).filter(validRef).slice(0, 4);
    const oldPw = String(body.oldPassword || ""), newPw = String(body.newPassword || "");
    if (!refs.length || !pwOk(newPw) || newPw.length < 6) return fail(cors, 400, "weak_password", "New password needs at least 6 characters.");
    let target = null;
    for (const r of refs) { const st = await credState(env, r.node, r.key); if (st) { target = { r, st }; if (st.hash || st.legacy) break; } }
    if (!target) return fail(cors, 404, "not_found", "Account not found.");
    if (target.st.hash || target.st.legacy) {
      const w = await wrongCount(env, "acc", `${target.r.node}/${target.r.key}`, now);
      if (w.n >= LOGIN_WRONG_PER_ACCOUNT) return fail(cors, 429, "too_many", "Too many wrong passwords. Try again in an hour, or reset it by email.", { retryAfter: 3600 });
      const good = target.st.hash ? await pwCheck(oldPw, target.st.hash) : safeEq(oldPw, target.st.legacy);
      if (!good) { await bumpWrong(env, w, now); return fail(cors, 401, "wrong_password", "Current password is incorrect"); }
    } else {
      const email = await googleEmail(body.idToken);
      if (!email || appUserKey(email) !== target.r.key) return fail(cors, 403, "need_reset", "Use “Reset by email” to set a password for this account.");
    }
    await storePassword(env, target.r.node, target.r.key, newPw);
    return json(cors, { ok: true });
  }
  return fail(cors, 400, "bad_action", "Unknown action.");
}

// ---------------- Database security gateway (server-to-server) ----------------
// Lets the owner's tooling read/replace the Realtime Database security rules and
// run privileged one-off data moves (e.g. moving passwords to a locked path)
// using this Worker's FIREBASE_DB_SECRET. Protected by the RULES_KEY secret
// (never stored in the database). Every rules change first saves the previous
// rules under the locked `secure/rulesBackups` path so a lock can be rolled back.
const RULES_MAX_BYTES = 262144;
async function actDbRules(env, req) {
  const out = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...baseHeaders, "Content-Type": "application/json" } });
  if (!env.RULES_KEY || !env.FIREBASE_DB_SECRET) return out({ ok: false, error: "not_configured" }, 503);
  if (!safeEq(String(req.headers.get("x-rules-key") || ""), String(env.RULES_KEY))) return out({ ok: false, error: "forbidden" }, 403);
  if (Number(req.headers.get("content-length") || 0) > RULES_MAX_BYTES) return out({ ok: false, error: "too_large" }, 413);
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return out({ ok: false, error: "bad_json" }, 400);
  const rulesUrl = `${dbBase(env)}/.settings/rules.json?auth=${encodeURIComponent(env.FIREBASE_DB_SECRET)}`;
  if (body.action === "get" || body.action === "put") {
    const cur = await fetch(rulesUrl);
    const curText = await cur.text();
    if (!cur.ok) return out({ ok: false, error: "read_failed", status: cur.status }, 502);
    if (body.action === "get") return out({ ok: true, rules: curText });
    if (typeof body.rules !== "string" || !body.rules.trim()) return out({ ok: false, error: "rules_missing" }, 400);
    await dbPut(env, `secure/rulesBackups/${Date.now()}`, curText);
    const r = await fetch(rulesUrl, { method: "PUT", headers: { "Content-Type": "application/json" }, body: body.rules });
    const t = await r.text();
    return out({ ok: r.ok, status: r.status, result: t.slice(0, 1000) }, r.ok ? 200 : 400);
  }
  if (body.action === "db") {
    const method = String(body.method || "GET").toUpperCase();
    const path = String(body.path || "").replace(/^\/+|\/+$/g, "");
    if (!["GET", "PUT", "PATCH", "DELETE"].includes(method) || !/^[A-Za-z0-9_\-.,@%$/]+$/.test(path) || path.includes("..")) return out({ ok: false, error: "bad_request" }, 400);
    const q = body.query && typeof body.query === "object" ? body.query : {};
    const init = method === "GET" || method === "DELETE" ? { method } : jsonInit(method, body.value ?? null);
    const r = await fetch(dbUrl(env, path, q), init);
    const t = await r.text();
    let v = null; try { v = JSON.parse(t); } catch { v = t; }
    return out({ ok: r.ok, status: r.status, value: v }, r.ok ? 200 : 400);
  }
  return out({ ok: false, error: "bad_action" }, 400);
}

const worker = {
  // Exposed for the project's unit tests only (not routes).
  _internals: { pwHash, pwCheck, buildMime, emailTemplate, smtpSession, makeOtp, originAllowed, DEFAULTS, BOUNDS, resetMemory: () => { shadow.clear(); settingsMemo = { v: null, exp: 0 }; } },
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const cors = corsFor(req, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const path = url.pathname.replace(/\/+$/, "") || "/";
    try {
      if (path === "/db-rules" && req.method === "POST") return await actDbRules(env, req);
      if (req.method === "GET") {
        if (path === "/preview") {
          const type = url.searchParams.get("type") === "reset" ? "reset" : "register";
          const cfg = await settings(env);
          const tpl = emailTemplate({ purpose: type, code: "482913", name: "Rahat", otpMinutes: cfg.otpMinutes, requestedAt: Date.now() });
          if (url.searchParams.get("format") === "text") return new Response(tpl.text, { headers: { ...cors, ...baseHeaders, "Content-Type": "text/plain; charset=utf-8" } });
          return new Response(tpl.html, { headers: { ...cors, ...baseHeaders, "Content-Type": "text/html; charset=utf-8" } });
        }
        if (path === "/" || path === "/health") return json({ ...cors, "Access-Control-Allow-Origin": "*" }, await health(env, url.searchParams.get("deep") === "1"));
        return fail(cors, 404, "not_found", "Unknown route.");
      }
      if (req.method !== "POST") return fail(cors, 405, "method", "Use POST.");
      const origin = req.headers.get("Origin") || "";
      if (!originAllowed(origin, env)) return fail(cors, 403, "origin_not_allowed", "This website is not allowed to use the RS ANIME03 email service.");
      const missing = MISSING(env);
      if (missing.length) return fail(cors, 503, "not_configured", "Email service is not set up yet. Please try again later.", { missing });
      if (Number(req.headers.get("content-length") || 0) > 4096) return fail(cors, 413, "too_large", "Request too large.");
      let body = {};
      try { body = await req.json(); } catch { return fail(cors, 400, "bad_json", "Request body must be JSON."); }
      if (!body || typeof body !== "object") return fail(cors, 400, "bad_json", "Request body must be JSON.");
      const action = path.startsWith("/api/") ? path.slice(5) : String(body.action || "");
      const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "0.0.0.0";
      switch (action) {
        case "send": case "send-otp": return await actSend(env, ctx, cors, body, origin, ip);
        case "resend": return await actResend(env, ctx, cors, body, origin, ip);
        case "verify": case "verify-otp": return await actVerify(env, ctx, cors, body, ip);
        case "admin-events": return await actAdminEvents(env, cors, body, ip);
        case "password": return await actPassword(env, ctx, cors, body, ip);
        default: return fail(cors, 400, "bad_action", "Unknown action.");
      }
    } catch (err) {
      console.error("email-service error:", err?.code || "", String(err?.message || err).slice(0, 200));
      return fail(cors, 500, err?.code || "server", PUBLIC_ERRORS[err?.code] || "Something went wrong. Please try again.");
    }
  },
};

// ---- Deno / Lovable Cloud adapter ----
Deno.serve((req) => worker.fetch(req, Deno.env.toObject(), {
  waitUntil: (p) => { try { (globalThis as any).EdgeRuntime?.waitUntil?.(p); } catch { /* ignore */ } },
}));
