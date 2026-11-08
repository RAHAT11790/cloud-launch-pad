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

let gmailRaw: string[] = [];
let tokenCalls = 0;
let gmailFail: null | { status: number; body: any } = null;
let now = Date.UTC(2026, 10, 8, 14, 0, 0);

const DB = "https://animeverse-d7b79-default-rtdb.asia-southeast1.firebasedatabase.app";
async function fakeFetch(input: any, init: any = {}): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input.url);
  const method = (init.method || "GET").toUpperCase();
  const headers = new Headers(init.headers || {});
  if (url.href.startsWith("https://oauth2.googleapis.com/token")) {
    tokenCalls++;
    return new Response(JSON.stringify({ access_token: "ya29.test", expires_in: 3599, scope: "https://www.googleapis.com/auth/gmail.send", token_type: "Bearer" }), { status: 200 });
  }
  if (url.href.startsWith("https://gmail.googleapis.com/gmail/v1/users/me/messages/send")) {
    if (gmailFail) return new Response(JSON.stringify(gmailFail.body), { status: gmailFail.status });
    gmailRaw.push(JSON.parse(init.body).raw);
    return new Response(JSON.stringify({ id: `m${gmailRaw.length}`, threadId: "t" }), { status: 200 });
  }
  if (url.origin === DB) {
    const p = decodeURIComponent(url.pathname.replace(/\.json$/, ""));
    if (method === "GET") {
      let v = getAt(p);
      if (url.searchParams.get("shallow") === "true" && v && typeof v === "object") v = Object.fromEntries(Object.keys(v).map((k) => [k, true]));
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
  throw new Error(`unexpected fetch ${method} ${url.href}`);
}

const ENV = { GMAIL_CLIENT_ID: "cid.apps.googleusercontent.com", GMAIL_CLIENT_SECRET: "csecret", GMAIL_REFRESH_TOKEN: "1//refresh", GMAIL_SENDER_EMAIL: "rsanime.mail@gmail.com", EMAIL_SECRET: "unit-test-secret" };
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
const link = async (url: string, method: "GET" | "POST") => {
  const r = await worker.fetch(new Request(url, { method }), ENV, ctx);
  await flush();
  return { status: r.status, html: await r.text(), headers: r.headers };
};

function decodeMail(raw: string) {
  const mime = Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  const parts = mime.split(/--rs_[a-z0-9]+/);
  const body = (i: number) => Buffer.from(parts[i].split("\r\n\r\n")[1].replace(/\r\n/g, ""), "base64").toString("utf8");
  const text = body(1), html = body(2);
  return { mime, text, html, code: text.match(/code: (\d{6})/)![1], link: text.match(/(https:\/\/\S+\/v\/\S+)/)![1] };
}

beforeEach(() => {
  tree = { settings: { loginAccess: { allowedDomains: ["gmail.com"] } }, appUsers: { "old,user99@gmail,com": { name: "Old User", password: "x" } } };
  gmailRaw = []; tokenCalls = 0; gmailFail = null; pending = [];
  now = Date.UTC(2026, 10, 8, 14, 0, 0) + Math.floor(Math.random() * 1e6) * 1000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  vi.stubGlobal("fetch", fakeFetch);
  (worker as any)._internals.resetMemory();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Gmail API email worker", () => {
  it("sends one branded MIME email (code + Verify button) through Gmail with a refreshed token", async () => {
    const r = await api("send", { email: "new.user55@gmail.com", purpose: "register", name: "Rahat" });
    expect(r.status).toBe(200);
    expect(r.data.ticket).toMatch(/^[a-z0-9]+\.[A-Za-z0-9_-]+$/);
    expect(gmailRaw).toHaveLength(1);
    expect(gmailRaw[0]).not.toMatch(/[+/=]/); // base64url
    const m = decodeMail(gmailRaw[0]);
    expect(m.mime).toContain("From: RS ANIME03 <rsanime.mail@gmail.com>");
    expect(m.mime).toContain("To: <new.user55@gmail.com>");
    expect(m.mime).toContain("multipart/alternative");
    expect(m.html).toContain("https://i.ibb.co/6RcjXRjL/image.jpg");
    expect(m.html).toContain(m.code);
    expect(m.html).toContain("Verify Email");
    expect(m.link.startsWith(`${W}/v/`)).toBe(true);
    expect(tokenCalls).toBe(1);
  });

  it("stores only hashes — no plain email, code or link token in the database", async () => {
    await api("send", { email: "new.user55@gmail.com", purpose: "register" });
    const m = decodeMail(gmailRaw[0]);
    const dump = JSON.stringify(tree.emailAuth.tickets);
    expect(dump).not.toContain("new.user55@gmail.com");
    expect(dump).not.toContain(m.code);
    expect(dump).not.toContain(m.link.split("/").pop());
  });

  it("a correct code works once and then the email button no longer verifies", async () => {
    const { data } = await api("send", { email: "new.user55@gmail.com", purpose: "register" });
    const m = decodeMail(gmailRaw[0]);
    const ok = await api("verify", { ticket: data.ticket, code: m.code });
    expect(ok.data).toMatchObject({ ok: true, email: "new.user55@gmail.com", purpose: "register", via: "otp" });
    expect((await api("verify", { ticket: data.ticket, code: m.code })).data.error).toBe("already_used");
    const page = await link(m.link, "POST");
    expect(page.html).toContain("Already verified");
    expect(page.html).not.toContain("?ev=");
  });

  it("opening the link (GET) does not verify — only the page's POST does — and then the code is dead", async () => {
    const { data } = await api("send", { email: "new.user55@gmail.com", purpose: "register" });
    const m = decodeMail(gmailRaw[0]);
    const get = await link(m.link, "GET");
    expect(get.html).toContain("Verifying your email");
    expect((await api("status", { ticket: data.ticket })).data.status).toBe("pending");
    const post = await link(m.link, "POST");
    expect(post.html).toContain("Email verified");
    expect(post.html).toContain(`${SITE}/?ev=`);
    expect(post.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect((await api("status", { ticket: data.ticket })).data.status).toBe("verified");
    expect((await api("verify", { ticket: data.ticket, code: m.code })).data.error).toBe("verified_by_link");
    const claim = await api("claim", { ticket: data.ticket });
    expect(claim.data).toMatchObject({ ok: true, email: "new.user55@gmail.com", via: "link" });
    expect((await api("claim", { ticket: data.ticket })).data.error).toBe("already_used");
  });

  it("locks after 5 wrong codes, even for the right code", async () => {
    const { data } = await api("send", { email: "new.user55@gmail.com", purpose: "register" });
    const m = decodeMail(gmailRaw[0]);
    const wrong = m.code === "111111" ? "222222" : "111111";
    for (let i = 4; i >= 1; i--) {
      const r = await api("verify", { ticket: data.ticket, code: wrong });
      expect(r.data).toMatchObject({ error: "wrong_code", attemptsLeft: i });
    }
    expect((await api("verify", { ticket: data.ticket, code: wrong })).data.error).toBe("locked");
    expect((await api("verify", { ticket: data.ticket, code: m.code })).data.error).toBe("locked");
  });

  it("code expires after 5 minutes, link after 10 minutes", async () => {
    const { data } = await api("send", { email: "new.user55@gmail.com", purpose: "register" });
    expect(data.expiresAt - now).toBe(5 * 60_000);
    expect(data.linkExpiresAt - now).toBe(10 * 60_000);
    const m = decodeMail(gmailRaw[0]);
    expect(m.text).toContain("valid for 5 minutes");
    now += 5 * 60_000 + 1000;
    expect((await api("verify", { ticket: data.ticket, code: m.code })).data.error).toBe("expired");
    now += 5 * 60_000;
    expect((await link(m.link, "POST")).html).toContain("Link expired");
  });

  it("enforces the 5 minute resend wait, and a resend kills the old code", async () => {
    const first = await api("send", { email: "new.user55@gmail.com", purpose: "register" });
    const oldCode = decodeMail(gmailRaw[0]).code;
    const tooSoon = await api("resend", { ticket: first.data.ticket });
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.data.error).toBe("cooldown");
    expect(tooSoon.data.retryAfter).toBe(300);
    now += 299_000;
    expect((await api("resend", { ticket: first.data.ticket })).data.error).toBe("cooldown");
    now += 2_000;
    const again = await api("resend", { ticket: first.data.ticket });
    expect(again.status).toBe(200);
    expect(gmailRaw).toHaveLength(2);
    expect((await api("verify", { ticket: first.data.ticket, code: oldCode })).data.error).toBe("replaced");
    const newCode = decodeMail(gmailRaw[1]).code;
    expect((await api("verify", { ticket: again.data.ticket, code: newCode })).data.ok).toBe(true);
    expect(tokenCalls).toBeLessThanOrEqual(1); // access token reused, refreshed only when needed
  });

  it("checks the account server-side: sign-up needs a new email, reset needs an existing one", async () => {
    expect((await api("send", { email: "old.user99@gmail.com", purpose: "register" })).data.error).toBe("already_registered");
    expect((await api("send", { email: "nobody123@gmail.com", purpose: "reset" })).data.error).toBe("no_account");
    expect((await api("send", { email: "someone@yahoo.com", purpose: "register" })).data.error).toBe("domain_not_allowed");
    expect(gmailRaw).toHaveLength(0);
  });

  it("a reset grant from the link page finishes once on another device", async () => {
    await api("send", { email: "old.user99@gmail.com", purpose: "reset" });
    const m = decodeMail(gmailRaw[0]);
    expect(m.html).toContain("Reset Password");
    expect(m.html).toContain("Old User");
    const page = await link(m.link, "POST");
    const back = new URL(page.html.match(/href="([^"]+\?ev=[^"]+)"/)![1].replace(/&amp;/g, "&"));
    const rid = back.searchParams.get("ev")!, grant = back.searchParams.get("eg")!;
    expect(back.searchParams.get("ep")).toBe("reset");
    expect((await api("claim", { rid, grant })).data).toMatchObject({ ok: true, email: "old.user99@gmail.com", purpose: "reset" });
    expect((await api("claim", { rid, grant })).data.error).toBe("already_used");
  });

  it("rejects other websites and reports missing Gmail secrets", async () => {
    expect((await api("send", { email: "new.user55@gmail.com", purpose: "register" }, { origin: "https://evil.example" })).status).toBe(403);
    const r = await api("send", { email: "new.user55@gmail.com", purpose: "register" }, { env: { ...ENV, GMAIL_REFRESH_TOKEN: "" } });
    expect(r.status).toBe(503);
    expect(r.data.missing).toEqual(["GMAIL_REFRESH_TOKEN"]);
    const h = await worker.fetch(new Request(`${W}/`), {}, ctx);
    expect((await h.json()).missing).toEqual(["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN", "GMAIL_SENDER_EMAIL"]);
  });

  it("a Gmail failure is reported without secrets and does not start the resend wait", async () => {
    gmailFail = { status: 403, body: { error: { code: 403, message: "Request had insufficient authentication scopes.", errors: [{ reason: "insufficientPermissions" }] } } };
    const r = await api("send", { email: "new.user55@gmail.com", purpose: "register" });
    expect(r.status).toBe(502);
    expect(r.data.error).toBe("gmail_scope_missing");
    expect(JSON.stringify(r.data)).not.toContain("csecret");
    gmailFail = null;
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
    expect(gmailRaw).toHaveLength(3);
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
    const m = decodeMail(gmailRaw[0]);
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
    expect((await api("verify", { ticket: data.ticket, code: decodeMail(gmailRaw[0]).code })).data.ok).toBe(true);
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

  it("health shows today's usage and the last Gmail result", async () => {
    await api("send", { email: "new.user55@gmail.com", purpose: "register" });
    const h = await (await worker.fetch(new Request(`${W}/`), ENV, ctx)).json();
    expect(h.today).toMatchObject({ sent: 1, limit: 300, left: 299 });
    expect(h.last.ok).toBe(true);
    expect(h.settings).toMatchObject({ otpMinutes: 5, cooldownSeconds: 300, perEmailDaily: 3 });
  });

  it("the Lovable Cloud copy is the same code as the Cloudflare worker", () => {
    const root = path.resolve(__dirname, "../..");
    const cf = readFileSync(path.join(root, "cloudflare-workers/email-service.js"), "utf8");
    const deno = readFileSync(path.join(root, "supabase/functions/email-service/index.ts"), "utf8");
    const body = deno.split("\n").slice(3).join("\n").split("\n// ---- Deno / Lovable Cloud adapter ----")[0];
    expect(body.trimEnd()).toBe(cf.replace("export default {", "const worker = {").trimEnd());
  });
});
