// @ts-nocheck
// Lovable Cloud copy of cloudflare-workers/email-service.js (same code, Deno adapter
// at the end). Keep both files identical above the adapter — a unit test checks it.
// ============================================================
// RS ANIME — EMAIL SERVICE · SMTP (Alwaysdata, Cloudflare build) · v5
// ------------------------------------------------------------
// Sign-up verification + password-reset emails sent over SMTP
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
//   SITE_URL             default https://rsanime03.lovable.app
//   FIREBASE_DB_URL      Firebase Realtime Database URL
//   FIREBASE_DB_SECRET   Firebase database secret (admin writes)
//   ALLOWED_ORIGINS      extra site origins, comma separated
//   ADMIN_PIN            unlocks full emails in the admin panel
//
// Routes
//   GET  /                 → health  (?deep=1 also logs in to SMTP)
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

const VERSION = "email-service-smtp-v6";
const BRAND = "RS ANIME03";
const LOGO = "https://i.ibb.co/6RcjXRjL/image.jpg";
const DEFAULT_SITE = "https://rsanime03.lovable.app";
const DEFAULT_DB = "https://animeverse-d7b79-default-rtdb.asia-southeast1.firebasedatabase.app";
const PROJECT_TAG = "d9496f6f-add2-411c-96f8-fb97b0c234a7";
const ROOT = "emailAuth";

// Sending limits (admin can tune inside BOUNDS): one live code at a time with a
// 60-second resend wait, 3 codes per email per Bangladesh day, and service caps
// that keep the mailbox well inside its provider's sending limits.
const DEFAULTS = { otpMinutes: 5, linkMinutes: 10, cooldownSeconds: 60, maxAttempts: 5, perEmailDaily: 3, perIpDaily: 30, hourlyPerIp: 10, perMinute: 10, dailyLimit: 300 };
const BOUNDS = { otpMinutes: [1, 30], linkMinutes: [2, 120], cooldownSeconds: [30, 3600], maxAttempts: [3, 10], perEmailDaily: [1, 20], perIpDaily: [2, 200], hourlyPerIp: [2, 100], perMinute: [2, 60], dailyLimit: [10, 2000] };
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
    await step("EHLO rsanime03.mail", [250], "smtp_ehlo", "EHLO");
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
    ? { title: "Reset Your Password", subject: `Reset your ${BRAND} password`, button: "Reset Password",
        intro: `We received a request to reset the password of your ${BRAND} account. Enter this code in the app, or tap the button below.` }
    : { title: "Verify Your Email", subject: `Verify your ${BRAND} email`, button: "Verify Email",
        intro: `Welcome to ${BRAND}! Enter this code in the app, or tap the button below, to confirm your email and finish creating your account.` };
}

/**
 * Email HTML. Emails cannot run scripts, so a "copy" button would have to open a web page.
 * Instead the code is one unbroken, select-all block: a single long-press selects it for copying.
 */
function emailTemplate({ purpose, code, link, name, email, otpMinutes, linkMinutes, site, requestedAt, rid = "" }) {
  const c = copyFor(purpose);
  const year = new Date(requestedAt).getUTCFullYear();
  const host = site.replace(/^https?:\/\//, "");
  const hi = name ? `Hi <b style="color:#FFFFFF;">${esc(name)}</b>,` : "Hi there,";
  const pre = `${code} is your ${BRAND} code. It expires in ${mins(otpMinutes)}.`;
  const td = `font-family:${FONT};`;
  const ref = shortRef(rid);
  const row = (k, v) => `<tr><td style="${td}color:${C.dim};padding:5px 0;width:92px;font-size:12px;" valign="top">${k}</td><td style="${td}color:${C.soft};padding:5px 0;font-size:12px;word-break:break-all;">${v}</td></tr>`;
  const html = `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no">
<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">
<title>${esc(c.title)} · ${BRAND}</title>
<style>
body{margin:0!important;padding:0!important;background:${C.bg};-webkit-text-size-adjust:100%}
a{text-decoration:none}img{border:0;outline:none;display:block}
.rs-code a{color:${C.text}!important;text-decoration:none!important}
@media (max-width:520px){
.rs-pad{padding-left:20px!important;padding-right:20px!important}
.rs-outer{padding:14px 8px!important}
.rs-h1{font-size:23px!important;line-height:30px!important}
.rs-code{font-size:36px!important;letter-spacing:9px!important;padding:18px 8px 20px 17px!important}
.rs-btn a{padding:15px 28px!important}
.rs-brand{font-size:21px!important;letter-spacing:4px!important}
}
</style></head>
<body style="margin:0;padding:0;background:${C.bg};">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;color:${C.bg};">${esc(pre)}${"&#847;&zwnj;&nbsp;".repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.bg}" style="background:${C.bg};background-image:radial-gradient(120% 60% at 50% 0%,#0E2A4F 0%,${C.bg} 62%);">
<tr><td align="center" class="rs-outer" style="padding:32px 14px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:540px;">

<tr><td bgcolor="${C.card}" style="background:${C.card};background-image:linear-gradient(180deg,${C.cardTop} 0%,${C.card} 40%);border:1px solid ${C.line};border-top:1px solid ${C.hi};border-bottom:4px solid ${C.depth};border-radius:20px;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.6);">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td align="center" bgcolor="${C.blue}" style="background:${C.blue};background-image:${C.grad};border-radius:19px 19px 0 0;border-bottom:3px solid ${C.navy};padding:30px 20px 26px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr>
        <td style="padding:4px;border-radius:22px;background:rgba(255,255,255,.22);border-top:1px solid rgba(255,255,255,.7);border-bottom:3px solid rgba(15,23,42,.55);box-shadow:0 10px 22px rgba(2,6,23,.45);">
          <img src="${LOGO}" width="60" height="60" alt="${BRAND}" style="width:60px;height:60px;border-radius:18px;">
        </td>
      </tr></table>
      <div class="rs-brand" style="${td}margin-top:14px;font-size:24px;font-weight:900;letter-spacing:5px;color:#FFFFFF;text-transform:uppercase;text-shadow:${BRAND_3D};">RS&nbsp;ANIME<span style="color:${C.gold};">03</span></div>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin-top:12px;"><tr>
        <td style="${td}padding:6px 14px;border-radius:999px;background:rgba(2,6,23,.32);border:1px solid rgba(255,255,255,.28);font-size:10px;font-weight:800;letter-spacing:2px;color:#E0F2FE;text-transform:uppercase;">&#128274;&nbsp; Account Security &amp; Verification</td>
      </tr></table>
    </td></tr>

    <tr><td class="rs-pad" align="center" style="padding:30px 36px 0;">
      <h1 class="rs-h1" style="${td}margin:0;font-size:26px;line-height:34px;font-weight:800;color:#FFFFFF;letter-spacing:-.2px;">${esc(c.title)}</h1>
      <p style="${td}margin:12px 0 0;font-size:15px;line-height:24px;color:${C.soft};">${hi}<br>${esc(c.intro)}</p>
    </td></tr>

    <tr><td class="rs-pad" align="center" style="padding:26px 36px 0;">
      <div style="${td}font-size:10px;font-weight:800;letter-spacing:3px;color:${C.mute};text-transform:uppercase;">Your verification code</div>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin-top:12px;"><tr>
        <td class="rs-code" align="center" bgcolor="${C.slab}" style="background:${C.slab};background-image:linear-gradient(180deg,${C.slabTop} 0%,${C.slab} 100%);border:1px solid #334155;border-top:1px solid #64748B;border-bottom:6px solid ${C.depth};border-radius:18px;padding:20px 14px 22px 26px;font-family:${MONO};font-size:42px;line-height:48px;font-weight:800;letter-spacing:12px;color:${C.text};text-shadow:${DIGIT_3D};box-shadow:0 18px 34px rgba(0,0,0,.55),0 0 0 4px rgba(56,189,248,.10);user-select:all;-webkit-user-select:all;white-space:nowrap;">${esc(code)}</td>
      </tr></table>
      <div style="${td}margin-top:14px;font-size:12px;line-height:18px;color:${C.mute};">Press and hold the code to copy it</div>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin-top:12px;"><tr>
        <td style="${td}padding:7px 14px;border-radius:999px;background:rgba(245,196,81,.10);border:1px solid rgba(245,196,81,.35);font-size:12px;font-weight:700;color:${C.gold};">&#9201;&nbsp; This code will expire in ${mins(otpMinutes)}.</td>
      </tr></table>
    </td></tr>

    <tr><td align="center" class="rs-pad" style="padding:26px 36px 0;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" class="rs-btn"><tr>
        <td align="center" bgcolor="${C.blue}" style="border-radius:14px;background:${C.blue};background-image:${C.btnGrad};border-top:1px solid #7DD3FC;border-bottom:4px solid ${C.navy};box-shadow:0 12px 26px rgba(37,99,235,.45);">
          <a href="${esc(link)}" target="_blank" style="${td}display:inline-block;padding:15px 42px;font-size:15px;font-weight:800;letter-spacing:.3px;color:#FFFFFF;border-radius:14px;text-shadow:0 1px 1px rgba(15,23,42,.5);">${esc(c.button)}&nbsp;&rarr;</a>
        </td>
      </tr></table>
      <div style="${td}margin-top:10px;font-size:12px;line-height:18px;color:${C.mute};">One tap confirms it &#183; button works for ${mins(linkMinutes)}</div>
    </td></tr>

    <tr><td class="rs-pad" style="padding:26px 36px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0E1A2F;border:1px solid ${C.line};border-left:3px solid ${C.gold};border-radius:12px;">
        <tr><td style="${td}padding:14px 16px;font-size:13px;line-height:20px;color:${C.soft};">&#128737;&#65039;&nbsp; <b style="color:#FFFFFF;">Never share your ${BRAND} code with anyone.</b> Our team will never ask for it. Didn't request this? You can ignore this email.</td></tr>
      </table>
    </td></tr>

    <tr><td class="rs-pad" style="padding:18px 36px 26px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${C.line};">
        <tr><td style="height:10px;line-height:10px;font-size:0;" colspan="2">&nbsp;</td></tr>
        ${row("Requested", esc(fmtTime(requestedAt)))}
        ${row("Account", esc(email))}
        ${ref ? row("Reference", `<span style="font-family:${MONO};letter-spacing:1px;">#${esc(ref)}</span>`) : ""}
      </table>
    </td></tr>
  </table>
</td></tr>

<tr><td align="center" style="${td}padding:18px 18px 0;font-size:12px;line-height:18px;color:${C.dim};">
  Button not working? Open this link:<br>
  <a href="${esc(link)}" style="color:${C.cyan};word-break:break-all;">${esc(link)}</a>
</td></tr>
<tr><td align="center" style="${td}padding:22px 16px 6px;font-size:11px;line-height:17px;color:${C.dim};">
  ${BRAND} &mdash; Premium Anime Streaming &#8226; Automated Message<br>
  <a href="${esc(site)}" style="color:#93C5FD;">${esc(host)}</a> &nbsp;&#183;&nbsp; &copy; ${year} ${BRAND}
</td></tr>

</table>
</td></tr></table>
</body></html>`;
  const text = [
    `${BRAND} — Account Security & Verification`,
    "",
    c.title,
    name ? `Hi ${name},` : "Hi there,",
    c.intro,
    "",
    `Your code: ${code}`,
    `This code will expire in ${mins(otpMinutes)}.`,
    "",
    `Or open this link (works for ${mins(linkMinutes)}):`,
    link,
    "",
    `Never share your ${BRAND} code with anyone.`,
    "Didn't request this? You can ignore this email.",
    "",
    `Requested: ${fmtTime(requestedAt)}`,
    `Account: ${email}`,
    ...(ref ? [`Reference: #${ref}`] : []),
    "",
    `${BRAND} — Premium Anime Streaming • Automated Message · ${host}`,
  ].join("\n");
  return { subject: `${code} is your ${BRAND} code`, html, text };
}

function pageHtml({ state, purpose, redirect, action, title, message }) {
  const ok = state === "success";
  const icon = ok || state === "info" ? `<svg viewBox="0 0 52 52" class="ck${ok ? "" : " info"}"><circle cx="26" cy="26" r="24"/><path d="M15 27l7 7 15-16"/></svg>`
    : state === "confirm" ? `<div class="spin"></div>`
    : `<div class="bad">!</div>`;
  const btn = ok
    ? `<a class="btn" href="${esc(redirect)}">Continue to ${BRAND} &rarr;</a><p class="small">Redirecting in <b id="n">3</b>s…</p>`
    : state === "confirm"
      ? `<form id="f" method="POST" action="${esc(action)}"><button class="btn" type="submit">${purpose === "reset" ? "Confirm password reset" : "Verify my email"}</button></form><p class="small">Confirming securely…</p>`
      : `<a class="btn ghost" href="${esc(redirect)}">Open ${BRAND}</a>`;
  const script = ok
    ? `<script>(function(){var n=3,e=document.getElementById("n");var t=setInterval(function(){n--;if(e)e.textContent=n;if(n<=0){clearInterval(t);location.replace(${JSON.stringify(redirect)});}},1000);})();</script>`
    : state === "confirm" ? `<script>setTimeout(function(){document.getElementById("f").submit();},350);</script>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>${esc(title)} · ${BRAND}</title>
${ok ? `<meta http-equiv="refresh" content="4;url=${esc(redirect)}">` : ""}
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:22px;background:radial-gradient(120% 70% at 50% 0%,#0E2A4F 0%,#070B14 60%,#05070D 100%);font-family:${FONT};color:#F8FAFC}
.card{width:100%;max-width:400px;background:linear-gradient(180deg,#111A2E 0%,#0B1120 40%);border:1px solid #1C2740;border-top-color:#2B3A5C;border-bottom:4px solid #020617;border-radius:20px;padding:0 0 26px;text-align:center;box-shadow:0 30px 80px rgba(0,0,0,.6);overflow:hidden}
.head{padding:26px 20px 22px;background:linear-gradient(160deg,#38BDF8 0%,#2563EB 55%,#1E3A8A 100%);border-bottom:3px solid #1E3A8A}
.ring{display:inline-block;padding:4px;border-radius:20px;background:rgba(255,255,255,.22);border-top:1px solid rgba(255,255,255,.7);border-bottom:3px solid rgba(15,23,42,.55);box-shadow:0 10px 22px rgba(2,6,23,.45)}.ring img{display:block;width:54px;height:54px;border-radius:16px}
.brand{margin-top:12px;font-weight:900;letter-spacing:4px;font-size:18px;text-shadow:${BRAND_3D}}.brand span{color:#F5C451}
.body{padding:24px 24px 0}
.ck{width:84px;height:84px;margin:0 auto 6px;display:block}.ck circle{fill:none;stroke:#34D399;stroke-width:3;stroke-dasharray:160;stroke-dashoffset:160;animation:d .7s ease forwards}.ck path{fill:none;stroke:#34D399;stroke-width:4;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:40;stroke-dashoffset:40;animation:d .4s .6s ease forwards}
@keyframes d{to{stroke-dashoffset:0}}.ck.info circle,.ck.info path{stroke:#7DD3FC}
.spin{width:64px;height:64px;margin:10px auto 16px;border-radius:50%;border:4px solid #1C2740;border-top-color:#38BDF8;animation:s 1s linear infinite}@keyframes s{to{transform:rotate(360deg)}}
.bad{width:72px;height:72px;margin:6px auto 12px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:36px;font-weight:900;color:#FCA5A5;background:rgba(239,68,68,.12);border:2px solid rgba(239,68,68,.45)}
h1{margin:8px 0 0;font-size:23px;line-height:30px}p{margin:10px 0 0;font-size:14px;line-height:22px;color:#B6C2D9}
.btn{display:block;width:100%;margin-top:22px;padding:15px 18px;border:0;border-top:1px solid #7DD3FC;border-bottom:4px solid #1E3A8A;border-radius:14px;background:linear-gradient(180deg,#4CC9FA 0%,#2563EB 100%);color:#fff;font:800 15px ${FONT};cursor:pointer;text-decoration:none;box-shadow:0 12px 28px rgba(37,99,235,.4)}
.btn:active{transform:translateY(2px);border-bottom-width:2px}
.btn.ghost{background:#111A2E;border:1px solid #1C2740;border-bottom:4px solid #020617;box-shadow:none}.small{font-size:12px;color:#8392AD}.foot{margin-top:20px;font-size:11px;color:#5E6B85}
</style></head><body><main class="card">
<div class="head"><span class="ring"><img src="${LOGO}" alt=""></span><div class="brand">RS ANIME<span>03</span></div></div>
<div class="body">${icon}<h1>${esc(title)}</h1><p>${esc(message)}</p>${btn}
<div class="foot">&#128274; Secured by ${BRAND}</div></div></main>${script}</body></html>`;
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
  const linkToken = randToken(32);
  const session = randToken(24);
  const x = now + cfg.otpMinutes * 60_000;
  const lx = now + cfg.linkMinutes * 60_000;
  const [oH, lH, sH] = await Promise.all([hash(env, "otp", rid, otp), hash(env, "link", rid, linkToken), hash(env, "sess", rid, session)]);
  await ticketTxn(env, ctx, rid, () => ({
    next: { p: purpose, m, e: eh, ec, o: oH, l: lH, s: sH, c: now, x, lx, a: 0, max: cfg.maxAttempts, st: "sending", org: origin || "" },
    result: 1,
  }));

  const site = siteUrl(env);
  const link = `${env.__WORKER_ORIGIN}/v/${rid}/${linkToken}`;
  const tpl = emailTemplate({ purpose, code: otp, link, name, email, otpMinutes: cfg.otpMinutes, linkMinutes: cfg.linkMinutes, site, requestedAt: now, rid });
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
    await ticketTxn(env, ctx, old, (cur) => (cur && (cur.st === "pending" || cur.st === "verified" || cur.st === "sending")
      ? { next: { ...cur, st: "replaced" }, result: 1 } : { result: 0 })).catch(() => 0);
  }
  shadowPut(`g:${day}`, sentToday + 1, dayExp);
  track(env, ctx, { sent: 1, [`sent_${purpose}`]: 1, mail_ms: ms, mail_n: 1, ...(replaces ? { resend: 1 } : {}) }, ev("sent", { ms, r: shortRef(rid) }));
  noteHealth(env, ctx, { ok: true, lastOkAt: Date.now(), lastMs: ms });
  const dailyLeft = Math.max(0, cfg.perEmailDaily - gate.n);
  return json(cors, {
    ok: true, ticket: `${rid}.${session}`, rid, purpose, email: m,
    expiresAt: x, linkExpiresAt: lx, cooldown: cfg.cooldownSeconds, resendAt: now + cfg.cooldownSeconds * 1000, maxAttempts: cfg.maxAttempts,
    dailyLeft, dailyMax: cfg.perEmailDaily, otpMinutes: cfg.otpMinutes, linkMinutes: cfg.linkMinutes,
  });
}

/** A finished (used) code frees the email right away for its next request. */
async function releaseCooldown(env, eh, created, rid) {
  if (!eh) return;
  const t = Number(created) || Date.now();
  shadowSet(`ml:${eh}`, 0, Date.now() + 2 * DAY);
  await dbTxn(env, `${ROOT}/rl/mail/${dayKey(t)}/${eh}`, (cur) => (cur && cur.rid === rid ? { next: { ...cur, last: 0 }, result: 1 } : { result: 0 })).catch(() => 0);
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
  const wb = hourBucket(now);
  const wrongPath = `${ROOT}/wrong/${wb}/${ih}`;
  const wrongKey = `w:${wb}:${ih}`;
  if (Math.max(Number(await dbGet(env, wrongPath).catch(() => 0)) || 0, shadowGet(wrongKey, now)) >= IP_WRONG_PER_HOUR) return fail(cors, 429, "too_many", "Too many wrong codes from this network. Try again later.", { retryAfter: 3600 });
  const sessHash = await hash(env, "sess", t.rid, t.session);
  const otpHash = await hash(env, "otp", t.rid, code);
  const out = await ticketTxn(env, ctx, t.rid, (cur) => {
    if (!cur || !safeEq(cur.s, sessHash)) return { result: { e: "not_found" } };
    if (cur.st !== "pending") return { result: { e: "state", st: cur.st, via: cur.via } };
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
  if (out.e === "state") return stateError(cors, out.st, out.via);
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

async function actStatus(env, ctx, cors, body) {
  const { res, cur } = await loadOwned(env, ctx, cors, body.ticket);
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
  const out = await ticketTxn(env, ctx, rid, (cur) => {
    if (!cur || !check(cur)) return { result: { e: "not_found" } };
    if (cur.st !== "verified") return { result: { e: "state", st: cur.st } };
    if (now > Number(cur.lx) + 15 * 60_000) return { result: { e: "state", st: "expired" } };
    return { next: { ...cur, st: "consumed", claimed: now }, result: { ok: true, p: cur.p, m: cur.m, ec: cur.ec, eh: cur.e, c: cur.c } };
  });
  if (out.e === "not_found") return fail(cors, 404, "not_found", "This verification was not found.");
  if (out.e === "state") {
    if (out.st === "pending" || out.st === "sending") return fail(cors, 409, "not_verified", "This email is not verified yet.");
    return stateError(cors, out.st);
  }
  await releaseCooldown(env, out.eh, out.c, rid);
  track(env, ctx, { claimed: 1 }, { k: "claimed", p: out.p, m: out.m, ec: out.ec });
  return json(cors, { ok: true, email: await unseal(env, out.ec), purpose: out.p, via: "link" });
}

// Link page. GET only shows a confirm page (mail scanners pre-open links);
// the page auto-submits a POST, which is what actually verifies.
async function linkPage(env, ctx, req, rid, token) {
  const site = siteUrl(env);
  const action = `/v/${rid}/${token}`;
  if (!RID_RE.test(rid) || !TOKEN_RE.test(token)) {
    return html(pageHtml({ state: "error", redirect: site, title: "Invalid link", message: "This verification link is not valid. Please open the latest email from RS ANIME03." }), 400);
  }
  if (req.method === "GET") {
    return html(pageHtml({ state: "confirm", action, redirect: site, title: "Verifying your email…", message: "Please wait a moment while we confirm your email address." }));
  }
  const lh = await hash(env, "link", rid, token);
  const now = Date.now();
  const out = await ticketTxn(env, ctx, rid, (cur) => {
    if (!cur || !safeEq(cur.l, lh)) return { result: { e: "invalid" } };
    const back = cur.org || site;
    if (cur.st === "verified") return { result: { ok: true, again: true, p: cur.p, back } };
    if (cur.st === "consumed" && cur.via === "link") return { result: { e: "done", p: cur.p, back } };
    if (cur.st === "consumed") return { result: { e: "used", p: cur.p, back } };
    if (cur.st !== "pending") return { result: { e: cur.st, p: cur.p, back } };
    if (now > cur.lx) return { result: { e: "expired", p: cur.p, back } };
    return { next: { ...cur, st: "verified", via: "link", v: now }, result: { ok: true, p: cur.p, m: cur.m, ec: cur.ec, back } };
  });
  const back = out.back || site;
  if (out.ok) {
    if (!out.again) track(env, ctx, { verified_link: 1 }, { k: "verified_link", p: out.p, m: out.m, ec: out.ec });
    const grant = await hash(env, "grant", rid);
    const redirect = `${back}/?ev=${rid}&eg=${encodeURIComponent(grant)}&ep=${out.p}`;
    return html(pageHtml({
      state: "success", purpose: out.p, redirect,
      title: out.p === "reset" ? "Email confirmed" : "Email verified",
      message: out.p === "reset" ? "It's really you. Taking you back to RS ANIME03 to set your new password." : "Your email address is verified. Taking you to RS ANIME03…",
    }));
  }
  const msg = {
    invalid: ["Invalid link", "This verification link is not valid. Please open the latest email from RS ANIME03."],
    done: ["Already verified", "This email was already verified. You can continue in the RS ANIME03 app."],
    used: ["Already verified", "This email was already verified with the code. You can continue in the app."],
    expired: ["Link expired", "This link has expired. Go back to RS ANIME03 and ask for a new email."],
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

const worker = {
  // Exposed for the project's unit tests only (not routes).
  _internals: { buildMime, emailTemplate, smtpSession, makeOtp, originAllowed, DEFAULTS, BOUNDS, resetMemory: () => { shadow.clear(); settingsMemo = { v: null, exp: 0 }; } },
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
        case "send": case "send-otp": case "send-link": return await actSend(env, ctx, cors, body, origin, ip);
        case "resend": return await actResend(env, ctx, cors, body, origin, ip);
        case "verify": case "verify-otp": return await actVerify(env, ctx, cors, body, ip);
        case "status": return await actStatus(env, ctx, cors, body);
        case "claim": return await actClaim(env, ctx, cors, body);
        case "admin-events": return await actAdminEvents(env, cors, body, ip);
        default: return fail(cors, 400, "bad_action", "Unknown action.");
      }
    } catch (err) {
      console.error("email-service error:", err?.code || "", String(err?.message || err).slice(0, 200));
      return fail(cors, 500, err?.code || "server", PUBLIC_ERRORS[err?.code] || "Something went wrong. Please try again.");
    }
  },
};

// ---- Deno / Lovable Cloud adapter ----
(globalThis as any).__rsOpenTls = async (host: string, port: number) => {
  const conn = await (Deno as any).connectTls({ hostname: host, port });
  return { readable: conn.readable, writable: conn.writable, close: () => { try { conn.close(); } catch { /* closed */ } } };
};
Deno.serve((req) => worker.fetch(req, Deno.env.toObject(), {
  waitUntil: (p) => { try { (globalThis as any).EdgeRuntime?.waitUntil?.(p); } catch { /* ignore */ } },
}));
