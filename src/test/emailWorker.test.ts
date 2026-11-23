// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import worker from "../../cloudflare-workers/email-service.js";

// ---------- in-memory Firebase RTDB (REST) ----------
type Tree = Record<string, any>;
let tree: Tree = {};
const segs = (p: string) => p.split("/").filter(Boolean);
function getAt(p: string) { let n: any = tree; for (const s of segs(p)) { if (n == null || typeof n !== "object") return null; n = n[s]; } return n ?? null; }
function setAt(p: string, v: any) {
  const ss = segs(p);
  if (!ss.length) { tree = v ?? {}; return; }
  let n: any = tree;
  for (const s of ss.slice(0, -1)) { if (n[s] == null || typeof n[s] !== "object") n[s] = {}; n = n[s]; }
  if (v == null) delete n[ss[ss.length - 1]]; else n[ss[ss.length - 1]] = v;
}
const etagOf = (v: any) => (v == null ? "null_etag" : `e${JSON.stringify(v).length}_${JSON.stringify(v)}`);
const resolveSv = (cur: any, v: any): any => {
  if (v && typeof v === "object" && v[".sv"]?.increment != null) return (Number(cur) || 0) + v[".sv"].increment;
  return v;
};

let mails: string[] = [];
let logins = 0;
let lastEhlo = "";
let smtpFail: null | { at: "auth" | "rcpt"; code: number; text: string } = null;
const te = new TextEncoder();
const tdc = new TextDecoder();
/** In-memory SMTP server speaking just enough ESMTP for the worker. */
function fakeSmtp() {
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  let closed = false;
  const say = (s: string) => { if (!closed) ctrl.enqueue(te.encode(s + "\r\n")); };
  const close = () => { if (!closed) { closed = true; try { ctrl.close(); } catch { /* closed */ } } };
  const readable = new ReadableStream<Uint8Array>({ start(c) { ctrl = c; say("220 fake.smtp ESMTP"); } });
  let buf = "", inData = false, data: string[] = [];
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      buf += tdc.decode(chunk);
      let i;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (inData) {
          if (line === ".") { inData = false; mails.push(data.join("\r\n")); data = []; say("250 2.0.0 queued"); }
          else data.push(line.startsWith("..") ? line.slice(1) : line);
          continue;
        }
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === "EHLO") { lastEhlo = line; } if (cmd === "EHLO") say("250-fake.smtp\r\n250 AUTH PLAIN LOGIN");
        else if (cmd === "AUTH") {
          logins++;
          const pass = Buffer.from(line.split(" ")[2], "base64").toString("utf8").split("\u0000")[2];
          say(smtpFail?.at === "auth" || pass !== ENV.SMTP_PASS ? "535 5.7.8 Authentication failed" : "235 2.7.0 ok");
        } else if (cmd === "MAIL") say("250 ok");
        else if (cmd === "RCPT") say(smtpFail?.at === "rcpt" ? `${smtpFail.code} ${smtpFail.text}` : "250 ok");
        else if (cmd === "DATA") { inData = true; say("354 go ahead"); }
        else if (cmd === "QUIT") { say("221 bye"); close(); }
        else say("502 unknown");
      }
    },
  });
  return { readable, writable, close };
}
let now = Date.UTC(2026, 10, 8, 14, 0, 0);
let idtCalls: { path: string; body: any }[] = [];
let googleUsers: Record<string, any> = {};

const DB = "https://animeverse-d7b79-default-rtdb.asia-southeast1.firebasedatabase.app";
async function fakeFetch(input: any, init: any = {}): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input.url);
  const method = (init.method || "GET").toUpperCase();
  const headers = new Headers(init.headers || {});
  if (url.origin === DB) {
    const p = decodeURIComponent(url.pathname.replace(/\.json$/, ""));
    if (method === "GET") {
      let v = getAt(p);
      if (url.searchParams.get("shallow") === "true" && v && typeof v === "object") v = Object.fromEntries(Object.keys(v).map((k) => [k, true]));
      const ob = url.searchParams.get("orderBy");
      if (ob && ob !== '"$key"' && v && typeof v === "object") {
        const field = JSON.parse(ob);
        const eq = JSON.parse(url.searchParams.get("equalTo") || "null");
        v = Object.fromEntries(Object.entries(v).filter(([, r]: any) => r && typeof r === "object" && r[field] === eq).slice(0, Number(url.searchParams.get("limitToFirst") || 1e9)));
      }
      if (url.searchParams.get("orderBy") === '"$key"' && v && typeof v === "object") {
        const end = JSON.parse(url.searchParams.get("endAt") || "null");
        const ents = Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)).filter(([k]) => end == null || k <= end);
        const last = Number(url.searchParams.get("limitToLast") || 0);
        v = Object.fromEntries(last ? ents.slice(-last) : ents.slice(0, Number(url.searchParams.get("limitToFirst") || 1e9)));
      }
      return new Response(JSON.stringify(v ?? null), { status: 200, headers: headers.get("X-Firebase-ETag") ? { ETag: etagOf(getAt(p)) } : {} });
    }
    const body = init.body ? JSON.parse(init.body) : null;
    if (method === "PUT") {
      const match = headers.get("if-match");
      if (match && match !== etagOf(getAt(p))) return new Response("{}", { status: 412 });
      setAt(p, body);
      return new Response(JSON.stringify(body), { status: 200 });
    }
    if (method === "PATCH") {
      for (const [k, v] of Object.entries(body || {})) setAt(`${p}/${k}`, resolveSv(getAt(`${p}/${k}`), v));
      return new Response(JSON.stringify(body), { status: 200 });
    }
    if (method === "DELETE") { setAt(p, null); return new Response("null", { status: 200 }); }
  }
  if (url.hostname === "identitytoolkit.googleapis.com" || url.hostname === "securetoken.googleapis.com") {
    const body = init.body ? JSON.parse(init.body) : {};
    idtCalls.push({ path: url.pathname, body });
    if (url.pathname.endsWith("accounts:signUp")) return new Response(JSON.stringify({ localId: `LOCAL${idtCalls.length}abcdefgh`, refreshToken: "rt-1", idToken: "id-1" }), { status: 200 });
    if (url.pathname.endsWith("accounts:lookup")) {
      const u = googleUsers[body.idToken];
      return u ? new Response(JSON.stringify({ users: [u] }), { status: 200 }) : new Response("{}", { status: 400 });
    }
    if (url.hostname === "securetoken.googleapis.com") return new Response(JSON.stringify({ id_token: "fresh-id" }), { status: 200 });
    return new Response("{}", { status: 200 });
  }
  throw new Error(`unexpected fetch ${method} ${url.href}`);
}

const ENV = { SMTP_PASS: "smtp-test-pass", EMAIL_SECRET: "unit-test-secret" };
const SITE = "https://rsanime03.lovable.app";
const W = "https://email-service.test.workers.dev";
const ctx = { waitUntil: (p: Promise<unknown>) => { pending.push(p); } };
let pending: Promise<unknown>[] = [];
const flush = async () => { while (pending.length) await Promise.allSettled(pending.splice(0)); };

async function api(action: string, body: Record<string, unknown>, opts: { origin?: string; env?: any; ip?: string } = {}) {
  const res = await worker.fetch(new Request(W, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: opts.origin ?? SITE, "cf-connecting-ip": opts.ip || "203.0.113.7" },
    body: JSON.stringify({ action, ...body }),
  }), opts.env || ENV, ctx);
  await flush();
  return { status: res.status, data: await res.json() };
}
function decodeMail(raw: string) {
  const mime = raw;
  const parts = mime.split(/--rs_[a-z0-9]+/);
  const body = (i: number) => Buffer.from(parts[i].split("\r\n\r\n")[1].replace(/\r\n/g, ""), "base64").toString("utf8");
  const text = body(1), html = body(2);
  return { mime, text, html, code: text.match(/code: (\d{6})/)![1] };
}

beforeEach(() => {
  tree = { settings: { loginAccess: { allowedDomains: ["gmail.com"] } }, appUsers: { "old,user99@gmail,com": { id: "user_old99", name: "Old User", password: "x" }, "stub,user42@gmail,com": { photoUrl: "p.jpg" } } };
  mails = []; logins = 0; smtpFail = null; pending = []; idtCalls = []; googleUsers = {};
  (globalThis as any).__rsOpenTls = async () => fakeSmtp();
  now = Date.UTC(2026, 10, 8, 14, 0, 0) + Math.floor(Math.random() * 1e6) * 1000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  vi.stubGlobal("fetch", fakeFetch);
  (worker as any)._internals.resetMemory();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); delete (globalThis as any).__rsOpenTls; });

describe("SMTP email worker", () => {
  it("sends one branded, code-only MIME email over SMTP after one login", async () => {
    const r = await api("send", { email: "new.user55@gmail.com", purpose: "register", name: "Rahat" });
    expect(r.status).toBe(200);
    expect(r.data.ticket).toMatch(/^[a-z0-9]+\.[A-Za-z0-9_-]+$/);
    expect(mails).toHaveLength(1);
    const m = decodeMail(mails[0]);
    expect(m.mime).toContain("From: \"RS ANIME03\" <rsanime03@alwaysdata.net>");
    expect(m.mime).toContain("To: <new.user55@gmail.com>");
    expect(m.mime).toContain(`Subject: Your RS ANIME03 verification code: ${m.code}`);
    expect(m.mime).toMatch(/Message-ID: <[^>]+@alwaysdata\.net>/);
    expect(m.mime).toContain("multipart/alternative");
    expect(m.html).toContain(m.code);
    expect(m.text).toContain(`Your verification code: ${m.code}`);
    expect(m.html).toContain("This code expires in 5 minutes.");
    expect(logins).toBe(1);
  });

  it("the email carries no links, buttons, images, web addresses or the reader's email", async () => {
    await api("send", { email: "new.user55@gmail.com", purpose: "register", name: "Rahat" });
    const m = decodeMail(mails[0]);
    for (const part of [m.html, m.text]) {
      expect(part).not.toMatch(/https?:\/\//);
      expect(part).not.toMatch(/www\.|\.app\b|\.dev\b|\.net\b|\.com\b/);
      expect(part).not.toContain("new.user55");
      expect(part.toLowerCase()).not.toContain("powered by");
    }
    expect(m.html).not.toMatch(/<a[\s>]|href=|<img|<form|<button/);
    expect(m.html).not.toContain("&#847;");
  });

  it("talks to the mail server with Alwaysdata's own host name, never the site's domain", async () => {
    await api("send", { email: "new.user55@gmail.com", purpose: "register" });
    expect(lastEhlo).toBe("EHLO rsanime03.alwaysdata.net");
    expect(mails[0]).not.toContain("lovable.app");
  });

  it("copy needs no browser: the code is one select-all block", async () => {
    await api("send", { email: "copy.check77@gmail.com", purpose: "register", name: "Rahat" });
    const m = decodeMail(mails[mails.length - 1]);
    expect(m.html).toMatch(new RegExp(`user-select:all[^>]*>${m.code}</td>`));
  });

  it("stores only hashes — no plain email or code in the database", async () => {
    await api("send", { email: "new.user55@gmail.com", purpose: "register" });
    const m = decodeMail(mails[0]);
    const dump = JSON.stringify(tree.emailAuth.tickets);
    expect(dump).not.toContain("new.user55@gmail.com");
    expect(dump).not.toContain(m.code);
  });

  it("a correct code works exactly once", async () => {
    const { data } = await api("send", { email: "new.user55@gmail.com", purpose: "register" });
    const m = decodeMail(mails[0]);
    const ok = await api("verify", { ticket: data.ticket, code: m.code });
    expect(ok.data).toMatchObject({ ok: true, email: "new.user55@gmail.com", purpose: "register", via: "otp" });
    expect((await api("verify", { ticket: data.ticket, code: m.code })).data.error).toBe("already_used");
  });

  it("the old button routes and actions are gone", async () => {
    const { data } = await api("send", { email: "new.user55@gmail.com", purpose: "register" });
    for (const action of ["status", "claim", "link"]) expect((await api(action, { ticket: data.ticket })).data.error).toBe("bad_action");
    const r = await worker.fetch(new Request(`${W}/v/abc/def`), ENV, ctx);
    expect(r.status).toBe(404);
  });

  it("locks after 5 wrong codes, even for the right code", async () => {
    const { data } = await api("send", { email: "new.user55@gmail.com", purpose: "register" });
    const m = decodeMail(mails[0]);
    const wrong = m.code === "111111" ? "222222" : "111111";
    for (let i = 4; i >= 1; i--) {
      const r = await api("verify", { ticket: data.ticket, code: wrong });
      expect(r.data).toMatchObject({ error: "wrong_code", attemptsLeft: i });
    }
    expect((await api("verify", { ticket: data.ticket, code: wrong })).data.error).toBe("locked");
    expect((await api("verify", { ticket: data.ticket, code: m.code })).data.error).toBe("locked");
  });

  it("code expires after 5 minutes", async () => {
    const { data } = await api("send", { email: "new.user55@gmail.com", purpose: "register" });
    expect(data.expiresAt - now).toBe(5 * 60_000);
    expect(data.linkExpiresAt).toBeUndefined();
    const m = decodeMail(mails[0]);
    expect(m.text).toContain("This code expires in 5 minutes.");
    now += 5 * 60_000 + 1000;
    expect((await api("verify", { ticket: data.ticket, code: m.code })).data.error).toBe("expired");
  });

  it("enforces the 60 second resend wait, and a resend kills the old code", async () => {
    const first = await api("send", { email: "new.user55@gmail.com", purpose: "register" });
    const oldCode = decodeMail(mails[0]).code;
    const tooSoon = await api("resend", { ticket: first.data.ticket });
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.data.error).toBe("cooldown");
    expect(tooSoon.data.retryAfter).toBe(60);
    now += 59_000;
    expect((await api("resend", { ticket: first.data.ticket })).data.error).toBe("cooldown");
    now += 2_000;
    const again = await api("resend", { ticket: first.data.ticket });
    expect(again.status).toBe(200);
    expect(mails).toHaveLength(2);
    expect((await api("verify", { ticket: first.data.ticket, code: oldCode })).data.error).toBe("replaced");
    const newCode = decodeMail(mails[1]).code;
    expect((await api("verify", { ticket: again.data.ticket, code: newCode })).data.ok).toBe(true);
  });

  it("checks the account server-side: sign-up needs a new email, reset needs an existing one", async () => {
    expect((await api("send", { email: "old.user99@gmail.com", purpose: "register" })).data.error).toBe("already_registered");
    expect((await api("send", { email: "someone@yahoo.com", purpose: "register" })).data.error).toBe("domain_not_allowed");
    expect(mails).toHaveLength(0);
  });

  it("forgot password for an email with no account sends nothing and says to sign up first", async () => {
    const r = await api("send", { email: "nobody123@gmail.com", purpose: "reset" });
    expect(r.status).toBe(404);
    expect(r.data).toMatchObject({ error: "no_account", message: "ID not found. Please sign up first." });
    // a leftover id-less record (e.g. from a profile-photo write) is not an account
    expect((await api("send", { email: "stub.user42@gmail.com", purpose: "reset" })).data.error).toBe("no_account");
    expect(mails).toHaveLength(0);
  });

  it("a password reset email for a real account uses the reset wording and name", async () => {
    await api("send", { email: "old.user99@gmail.com", purpose: "reset" });
    const m = decodeMail(mails[0]);
    expect(m.mime).toContain(`Subject: Your RS ANIME03 password reset code: ${m.code}`);
    expect(m.html).toContain("Reset your password");
    expect(m.html).toContain("Old User");
  });

  it("rejects other websites and reports a missing SMTP password", async () => {
    expect((await api("send", { email: "new.user55@gmail.com", purpose: "register" }, { origin: "https://evil.example" })).status).toBe(403);
    const r = await api("send", { email: "new.user55@gmail.com", purpose: "register" }, { env: { ...ENV, SMTP_PASS: "" } });
    expect(r.status).toBe(503);
    expect(r.data.missing).toEqual(["SMTP_PASS"]);
    const h = await worker.fetch(new Request(`${W}/`), {}, ctx);
    expect((await h.json()).missing).toEqual(["SMTP_PASS"]);
  });

  it("a mail-server failure is reported without secrets and does not start the resend wait", async () => {
    smtpFail = { at: "auth", code: 535, text: "Authentication failed" };
    const r = await api("send", { email: "new.user55@gmail.com", purpose: "register" });
    expect(r.status).toBe(502);
    expect(r.data.error).toBe("smtp_auth_failed");
    expect(JSON.stringify(r.data)).not.toContain("smtp-test-pass");
    smtpFail = null;
    expect((await api("send", { email: "new.user55@gmail.com", purpose: "register" })).status).toBe(200);
  });

  it("allows only 3 codes per email per day, then blocks until tomorrow", async () => {
    now = Math.floor(now / 86_400_000) * 86_400_000 + 6 * 3_600_000; // midday in Bangladesh
    const first = await api("send", { email: "new.user55@gmail.com", purpose: "register" });
    expect(first.data).toMatchObject({ dailyLeft: 2, dailyMax: 3 });
    let t = first.data.ticket;
    for (const left of [1, 0]) {
      now += 301_000;
      const r = await api("resend", { ticket: t });
      expect(r.data.dailyLeft).toBe(left);
      t = r.data.ticket;
    }
    now += 301_000;
    const blocked = await api("resend", { ticket: t });
    expect(blocked.status).toBe(429);
    expect(blocked.data).toMatchObject({ error: "email_daily", dailyLeft: 0 });
    expect(mails).toHaveLength(3);
  });

  it("one network (IP) is limited to 10 emails per hour, even to different addresses", async () => {
    now = Math.floor(now / 3_600_000) * 3_600_000 + 60_000; // stay inside one hour
    for (let i = 0; i < 10; i++) {
      expect((await api("send", { email: `fresh.user${i}x@gmail.com`, purpose: "register" })).status).toBe(200);
      now += 61_000;
    }
    const r = await api("send", { email: "fresh.user99x@gmail.com", purpose: "register" });
    expect(r.status).toBe(429);
    expect(r.data.error).toBe("too_many");
    expect((await api("send", { email: "fresh.user99x@gmail.com", purpose: "register" }, { ip: "198.51.100.4" })).status).toBe(200);
  });

  it("an edited ticket in the database is rejected (sealed), and a rolled-back one stays locked", async () => {
    const { data } = await api("send", { email: "new.user55@gmail.com", purpose: "register" });
    const m = decodeMail(mails[0]);
    const rid = data.ticket.split(".")[0];
    const snapshot = JSON.parse(JSON.stringify(tree.emailAuth.tickets[rid]));
    const wrong = m.code === "111111" ? "222222" : "111111";
    for (let i = 0; i < 5; i++) await api("verify", { ticket: data.ticket, code: wrong });
    // attacker un-locks the ticket by hand
    tree.emailAuth.tickets[rid] = { ...tree.emailAuth.tickets[rid], st: "pending", a: 0 };
    expect((await api("verify", { ticket: data.ticket, code: m.code })).data.error).toBe("not_found");
    // attacker restores the original sealed copy (rollback)
    tree.emailAuth.tickets[rid] = snapshot;
    expect((await api("verify", { ticket: data.ticket, code: m.code })).data.error).toBe("locked");
  });

  it("deleting the rate-limit counters from the database does not reset the wait", async () => {
    await api("send", { email: "new.user55@gmail.com", purpose: "register" });
    delete tree.emailAuth.rl;
    const r = await api("send", { email: "new.user55@gmail.com", purpose: "register" });
    expect(r.status).toBe(429);
    expect(r.data.error).toBe("cooldown");
  });

  it("a used code frees the email for its next request right away", async () => {
    const { data } = await api("send", { email: "old.user99@gmail.com", purpose: "reset" });
    expect((await api("verify", { ticket: data.ticket, code: decodeMail(mails[0]).code })).data.ok).toBe(true);
    expect((await api("send", { email: "old.user99@gmail.com", purpose: "reset" })).status).toBe(200);
  });

  it("admin activity with full emails needs the Worker's ADMIN_PIN", async () => {
    await api("send", { email: "new.user55@gmail.com", purpose: "register" });
    expect((await api("admin-events", { pin: "1" })).data.error).toBe("admin_pin_not_set");
    const env = { ...ENV, ADMIN_PIN: "778899" };
    expect((await api("admin-events", { pin: "000000" }, { env })).status).toBe(401);
    const ok = await api("admin-events", { pin: "778899" }, { env });
    expect(ok.data.ok).toBe(true);
    expect(ok.data.events[0]).toMatchObject({ k: "sent", email: "new.user55@gmail.com", p: "register" });
    expect(JSON.stringify(tree.emailAuth.events)).not.toContain("new.user55@gmail.com");
  });

  it("health shows today's usage and the last send result", async () => {
    await api("send", { email: "new.user55@gmail.com", purpose: "register" });
    const h = await (await worker.fetch(new Request(`${W}/`), ENV, ctx)).json();
    expect(h.today).toMatchObject({ sent: 1, limit: 300, left: 299 });
    expect(h.last.ok).toBe(true);
    expect(h.settings).toMatchObject({ otpMinutes: 5, cooldownSeconds: 60, perEmailDaily: 3 });
  });

  it("the Lovable Cloud copy is the same code as the Cloudflare worker", () => {
    const root = path.resolve(__dirname, "../..");
    const cf = readFileSync(path.join(root, "cloudflare-workers/email-service.js"), "utf8");
    const deno = readFileSync(path.join(root, "supabase/functions/email-service/index.ts"), "utf8");
    const body = deno.split("\n").slice(3).join("\n").split("\n// ---- Deno / Lovable Cloud adapter ----")[0];
    expect(body.trimEnd()).toBe(cf.replace("export default {", "const worker = {").trimEnd());
  });
});

describe("passwords checked only by the email worker", () => {
  const acc = [{ node: "appUsers", key: "old,user99@gmail,com" }];
  it("accepts an old plain password once and stores a hash in the locked area", async () => {
    const r = await api("password", { op: "login", refs: acc, password: "x".repeat(4).slice(0, 1) + "xxx" });
    expect(r.data.error).toBe("wrong_password"); // stored password is "x", "xxxx" is wrong
    tree.appUsers["old,user99@gmail,com"].password = "oldpass1";
    const ok = await api("password", { op: "login", refs: acc, password: "oldpass1" });
    expect(ok.data).toMatchObject({ ok: true, node: "appUsers", key: "old,user99@gmail,com" });
    expect(String(tree.secure.credentials.appUsers["old,user99@gmail,com"].h)).toMatch(/^pbkdf2\$100000\$/);
    expect(String(tree.secure.credentials.appUsers["old,user99@gmail,com"].h)).not.toContain("oldpass1");
    // after migration the hash decides, even if the plain field is edited
    tree.appUsers["old,user99@gmail,com"].password = "hacked";
    expect((await api("password", { op: "login", refs: acc, password: "hacked" })).data.error).toBe("wrong_password");
    expect((await api("password", { op: "login", refs: acc, password: "oldpass1" })).data.ok).toBe(true);
  });

  it("locks an account after 10 wrong passwords in an hour", async () => {
    tree.appUsers["old,user99@gmail,com"].password = "rightpw1";
    for (let i = 0; i < 10; i++) await api("password", { op: "login", refs: acc, password: `wrong${i}x` });
    const r = await api("password", { op: "login", refs: acc, password: "rightpw1" });
    expect(r.status).toBe(429);
  });

  it("deletes the plain password field once strip mode is on", async () => {
    tree.secure = { authConfig: { stripLegacy: true } };
    tree.appUsers["old,user99@gmail,com"].password = "oldpass1";
    await api("password", { op: "login", refs: acc, password: "oldpass1" });
    const r = await api("password", { op: "change", refs: acc, oldPassword: "oldpass1", newPassword: "newpass22" });
    expect(r.data.ok).toBe(true);
    expect(tree.appUsers["old,user99@gmail,com"].password).toBeUndefined();
    expect((await api("password", { op: "login", refs: acc, password: "newpass22" })).data.ok).toBe(true);
  });

  it("a reset needs a verified code, and that code saves a password only once", async () => {
    const s = await api("send", { email: "old.user99@gmail.com", purpose: "reset" });
    const ticket = s.data.ticket;
    expect((await api("password", { op: "reset", ticket, password: "brandnew1" })).data.error).toBe("not_found");
    const code = decodeMail(mails[0]).code;
    expect((await api("verify", { ticket, code })).data.ok).toBe(true);
    expect((await api("password", { op: "reset", ticket, password: "brandnew1" })).data.ok).toBe(true);
    expect((await api("password", { op: "reset", ticket, password: "another22" })).data.error).toBe("already_used");
    expect((await api("password", { op: "login", refs: acc, password: "brandnew1" })).data.ok).toBe(true);
  });

  it("an account without any password cannot be claimed when it uses Google", async () => {
    tree.appUsers["g,user7@gmail,com"] = { id: "u7", googleAuth: true };
    const r = await api("password", { op: "login", refs: [{ node: "appUsers", key: "g,user7@gmail,com" }], password: "anything1" });
    expect(r.data.error).toBe("use_google");
  });
});

describe("locked account lists: username sign-in and admin sessions", () => {
  it("signs in with a username without the site reading any account list", async () => {
    tree.appUsers["old,user99@gmail,com"].password = "oldpass1";
    const r = await api("password", { op: "login", name: "old user", password: "oldpass1" });
    expect(r.data).toMatchObject({ ok: true, node: "appUsers", key: "old,user99@gmail,com" });
    expect((await api("password", { op: "login", name: "Nobody Here", password: "oldpass1" })).data.error).toBe("not_found");
    expect((await api("password", { op: "login", name: "Old User", password: "wrongpw9" })).data.error).toBe("wrong_password");
  });

  it("after the move to hashes a plain password written into a record is deleted, never used", async () => {
    tree.secure = { authConfig: { stripLegacy: true }, credentials: { appUsers: {} } };
    const acc = [{ node: "appUsers", key: "old,user99@gmail,com" }];
    await api("password", { op: "change", refs: acc, oldPassword: "x", newPassword: "realpass1" }).catch(() => null);
    tree.appUsers["old,user99@gmail,com"].password = "planted1";
    tree.secure.credentials.appUsers["old,user99@gmail,com"] = { h: "pbkdf2$100000$AAAA$BBBB" };
    expect((await api("password", { op: "login", refs: acc, password: "planted1" })).data.error).toBe("wrong_password");
  });

  it("a wrong admin PIN opens no session; the right one opens a 7-day session", async () => {
    const env = { ...ENV, ADMIN_PIN: "246810" };
    const bad = await api("admin-session", { pin: "111111" }, { env });
    expect(bad.data.error).toBe("wrong_pin");
    expect(tree.secure?.adminSessions).toBeUndefined();
    const ok = await api("admin-session", { pin: "246810" }, { env });
    expect(ok.data.ok).toBe(true);
    expect(ok.data.email).toMatch(/@admin-session\.rsanime03\.app$/);
    const [uid, sess] = Object.entries(tree.secure.adminSessions)[0] as [string, any];
    expect(uid).toMatch(/^LOCAL/);
    expect(sess.exp - now).toBe(7 * 86400_000);
  });

  it("8 wrong admin PINs in an hour lock the network", async () => {
    const env = { ...ENV, ADMIN_PIN: "246810" };
    for (let i = 0; i < 8; i++) await api("admin-session", { pin: `99999${i}` }, { env });
    expect((await api("admin-session", { pin: "246810" }, { env })).status).toBe(429);
  });

  it("Google admin sessions only for owner or authorized admin emails", async () => {
    googleUsers = {
      own: { localId: "OwnerUid123456", email: "rahatsarker224@gmail.com", emailVerified: true },
      rnd: { localId: "RandomUid12345", email: "someone@gmail.com", emailVerified: true },
    };
    expect((await api("admin-session", { idToken: "rnd" })).data.error).toBe("not_admin");
    expect((await api("admin-session", { idToken: "own" })).data.ok).toBe(true);
    expect(tree.secure.adminSessions.OwnerUid123456.by).toBe("google");
    expect(tree.secure.adminSessions.RandomUid12345).toBeUndefined();
  });

  it("expired admin sessions are removed together with their throw-away sign-in", async () => {
    tree.secure = { adminSessions: { OldUid1234567: { exp: now - 1, rt: "old-rt" } } };
    await api("admin-session", { pin: "246810" }, { env: { ...ENV, ADMIN_PIN: "246810" } });
    expect(tree.secure.adminSessions.OldUid1234567).toBeUndefined();
    expect(idtCalls.some((c) => c.path.endsWith("accounts:delete"))).toBe(true);
  });
});


describe("Lovable email relay (own domain first, SMTP fallback)", () => {
  const RELAY = "https://relay.test/functions/v1/lovable-email";
  let relayCalls: any[] = [];
  let relayMode: "ok" | "down" = "ok";
  let checks: boolean[] = [];
  /** Plays the Lovable relay: confirms at /relay-check, then reports a real send. */
  async function relayFetch(input: any, init: any = {}): Promise<Response> {
    const url = typeof input === "string" ? input : input.url;
    if (url !== RELAY) return fakeFetch(input, init);
    const body = JSON.parse(init.body);
    relayCalls.push(body);
    if (relayMode === "down") return new Response(JSON.stringify({ ok: false, error: "timeout" }), { status: 502 });
    const res = await worker.fetch(new Request(`${W}/relay-check`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), ENV, ctx);
    const ok = (await res.json()).ok === true;
    checks.push(ok);
    return new Response(JSON.stringify({ ok }), { status: ok ? 200 : 502 });
  }
  beforeEach(() => {
    relayCalls = []; checks = []; relayMode = "ok";
    tree.settings.functionOverrides = { "lovable-email": { customUrl: RELAY, enabled: true } };
    vi.stubGlobal("fetch", relayFetch);
  });

  it("sends through the Lovable relay and not over SMTP when the relay confirms", async () => {
    const r = await api("send", { email: "new.user55@gmail.com", purpose: "register" });
    expect(r.status).toBe(200);
    expect(relayCalls).toHaveLength(1);
    expect(relayCalls[0]).toMatchObject({ to: "new.user55@gmail.com", purpose: "register", otpMinutes: 5 });
    expect(relayCalls[0].code).toMatch(/^\d{6}$/);
    expect(checks).toEqual([true]);
    expect(mails).toHaveLength(0);
  });

  it("the code sent through the relay is the one that verifies", async () => {
    const r = await api("send", { email: "new.user55@gmail.com", purpose: "register" });
    const v = await api("verify", { ticket: r.data.ticket, code: relayCalls[0].code });
    expect(v.status).toBe(200);
    expect(v.data.ok).toBe(true);
  });

  it("falls back to SMTP when the relay fails, then skips the relay for 10 minutes", async () => {
    relayMode = "down";
    const r1 = await api("send", { email: "new.user55@gmail.com", purpose: "register" });
    expect(r1.status).toBe(200);
    expect(mails).toHaveLength(1);
    expect(relayCalls).toHaveLength(1);
    relayMode = "ok";
    now += 61_000;
    await api("send", { email: "other.user77@gmail.com", purpose: "register" });
    expect(relayCalls).toHaveLength(1);
    expect(mails).toHaveLength(2);
    now += 10 * 60_000;
    (worker as any)._internals.resetMemory();
    await api("send", { email: "third.user88@gmail.com", purpose: "register" });
    expect(relayCalls).toHaveLength(2);
    expect(mails).toHaveLength(2);
  });

  it("uses SMTP only when the router has no lovable-email row", async () => {
    delete tree.settings.functionOverrides;
    await api("send", { email: "new.user55@gmail.com", purpose: "register" });
    expect(relayCalls).toHaveLength(0);
    expect(mails).toHaveLength(1);
  });

  it("relay-check refuses a wrong code and confirms each ticket only once", async () => {
    let captured: any = null;
    vi.stubGlobal("fetch", async (input: any, init: any = {}) => {
      const url = typeof input === "string" ? input : input.url;
      if (url !== RELAY) return fakeFetch(input, init);
      captured = JSON.parse(init.body);
      const check = (b: any) => worker.fetch(new Request(`${W}/relay-check`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }), ENV, ctx).then((x) => x.json());
      const wrong = String((Number(captured.code) + 1) % 1000000).padStart(6, "0");
      checks.push((await check({ ...captured, code: wrong })).ok);
      checks.push((await check({ ...captured, to: "someone.else@gmail.com" })).ok);
      checks.push((await check(captured)).ok);
      checks.push((await check(captured)).ok);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    await api("send", { email: "new.user55@gmail.com", purpose: "register" });
    expect(captured).not.toBeNull();
    expect(checks).toEqual([false, false, true, false]);
  });
});
