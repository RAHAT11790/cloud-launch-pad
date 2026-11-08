import { getEdgeFunctionUrl } from "@/lib/edgeFunctionRouter";
import { db, ref, onValue } from "@/lib/firebase";

/** Only real-looking @gmail.com addresses (6–30 char local part, no "+", no double dots). */
const GMAIL_RE = /^(?=.{6,30}@)[a-z0-9](?:[a-z0-9]|\.(?!\.))*[a-z0-9]@gmail\.com$/;

export const normalizeEmail = (v: string) => String(v || "").trim().toLowerCase();
export const isAllowedGmail = (v: string) => GMAIL_RE.test(normalizeEmail(v));
/** Gmail ignores dots, so a.b.c@gmail.com and abc@gmail.com are one inbox. */
export const gmailCanonicalKey = (v: string) => normalizeEmail(v).split("@")[0].replace(/\./g, "");

// ---- Admin login access (Firebase settings/loginAccess, cached on device) ----
export const DEFAULT_EMAIL_DOMAINS = ["gmail.com"];
export type LoginAccess = { guestEnabled: boolean; allowedDomains: string[] };
const DOMAIN_RE = /^(?=.{3,63}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
const LOCAL_RE = /^(?=.{3,40}$)[a-z0-9](?:[a-z0-9_-]|\.(?!\.))*[a-z0-9]$/;

/** "@Mail.Com " → "mail.com"; invalid → "". */
export const normalizeDomain = (v: string) => {
  const d = String(v || "").trim().toLowerCase().replace(/^@+/, "");
  return DOMAIN_RE.test(d) ? d : "";
};
export function parseLoginAccess(raw: any): LoginAccess {
  const list = Array.isArray(raw?.allowedDomains) ? raw.allowedDomains : raw?.allowedDomains && typeof raw.allowedDomains === "object" ? Object.values(raw.allowedDomains) : [];
  const domains = [...new Set(list.map((d: any) => normalizeDomain(String(d))).filter(Boolean))] as string[];
  return { guestEnabled: raw?.guestEnabled !== false, allowedDomains: domains.length ? domains : [...DEFAULT_EMAIL_DOMAINS] };
}
/** Registration rule: domain must be on the admin list; gmail.com keeps its stricter real-inbox check. */
export function isAllowedEmail(v: string, domains: string[] = loginAccessNow().allowedDomains): boolean {
  const e = normalizeEmail(v);
  const at = e.lastIndexOf("@");
  if (at < 1) return false;
  const domain = e.slice(at + 1);
  if (!domains.includes(domain)) return false;
  if (domain === "gmail.com") return GMAIL_RE.test(e);
  return LOCAL_RE.test(e.slice(0, at));
}
/** One account per inbox: Gmail ignores dots; other providers use the full address. */
export const emailCanonicalKey = (v: string) => {
  const e = normalizeEmail(v);
  return e.endsWith("@gmail.com") ? gmailCanonicalKey(e) : e.replace(/\./g, ",").replace(/[^a-z0-9@,_-]/g, "_");
};
export const allowedDomainsLabel = (domains: string[]) => domains.map(d => `@${d}`).join(", ");

const ACCESS_CACHE = "rs_login_access_v1";
let accessNow: LoginAccess = (() => {
  try { return parseLoginAccess(JSON.parse(localStorage.getItem(ACCESS_CACHE) || "null")); } catch { return parseLoginAccess(null); }
})();
export const loginAccessNow = () => accessNow;
export function subscribeLoginAccess(cb: (a: LoginAccess) => void): () => void {
  cb(accessNow);
  return onValue(ref(db, "settings/loginAccess"), snap => {
    accessNow = parseLoginAccess(snap.val());
    try { localStorage.setItem(ACCESS_CACHE, JSON.stringify(accessNow)); } catch {}
    cb(accessNow);
  }, () => {});
}

export type EmailPurpose = "register" | "reset";
export class EmailServiceError extends Error {
  code: string;
  retryAfter?: number;
  attemptsLeft?: number;
  constructor(code: string, message: string, extra: { retryAfter?: number; attemptsLeft?: number } = {}) {
    super(message); this.code = code; this.retryAfter = extra.retryAfter; this.attemptsLeft = extra.attemptsLeft;
  }
}

/** Opaque "rid.session" ticket returned by the Gmail email Worker. */
export type EmailTicket = { token: string; expiresAt: number; linkExpiresAt: number; resendAt: number; maxAttempts: number };
export type EmailStatus = "pending" | "verified" | "consumed" | "replaced" | "expired" | "locked" | "failed";

const COOLDOWN_KEY = "rs_email_cooldown";
const COOLDOWN_MS = 60_000;

export function cooldownLeftMs(email: string, now = Date.now()): number {
  try {
    const map = JSON.parse(localStorage.getItem(COOLDOWN_KEY) || "{}");
    const until = Number(map[normalizeEmail(email)] || 0);
    // Old entries stored the send time; new ones store the "can resend at" time.
    const at = until > now + COOLDOWN_MS * 20 ? 0 : until < now - COOLDOWN_MS * 20 ? until + COOLDOWN_MS : until;
    return Math.max(0, at - now);
  } catch { return 0; }
}
function markResendAt(email: string, at: number) {
  try {
    const map = JSON.parse(localStorage.getItem(COOLDOWN_KEY) || "{}");
    const now = Date.now();
    for (const k of Object.keys(map)) if (Number(map[k]) < now - COOLDOWN_MS * 30) delete map[k];
    map[normalizeEmail(email)] = at;
    localStorage.setItem(COOLDOWN_KEY, JSON.stringify(map));
  } catch {}
}

async function call(action: string, body: Record<string, unknown>) {
  const url = await getEdgeFunctionUrl("email-service");
  if (!url) throw new EmailServiceError("not_configured", "Email service is not set up yet. Please try again later.");
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...body }) });
  } catch {
    throw new EmailServiceError("network", "Can't reach the email server. Check your internet and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok) {
    throw new EmailServiceError(data?.error || "server", data?.message || "Something went wrong. Try again.", { retryAfter: data?.retryAfter, attemptsLeft: data?.attemptsLeft });
  }
  return data;
}
const toTicket = (d: any): EmailTicket => ({
  token: String(d.ticket), expiresAt: Number(d.expiresAt), linkExpiresAt: Number(d.linkExpiresAt) || Number(d.expiresAt),
  resendAt: Number(d.resendAt) || Date.now() + COOLDOWN_MS, maxAttempts: Number(d.maxAttempts) || 5,
});
function rememberCooldown(email: string, err: unknown) {
  if (err instanceof EmailServiceError && err.code === "cooldown" && err.retryAfter) markResendAt(email, Date.now() + err.retryAfter * 1000);
}

/** Sends one email with a 6-digit code and a one-tap "Verify" link (Gmail API Worker). */
export async function sendEmailCode(email: string, purpose: EmailPurpose, name?: string): Promise<EmailTicket> {
  const e = normalizeEmail(email);
  if (!isAllowedEmail(e)) throw new EmailServiceError("domain_not_allowed", `Only ${allowedDomainsLabel(loginAccessNow().allowedDomains)} addresses are allowed.`);
  const wait = cooldownLeftMs(e);
  if (wait > 0) throw new EmailServiceError("cooldown", `Please wait ${Math.ceil(wait / 1000)}s before asking for another code.`, { retryAfter: Math.ceil(wait / 1000) });
  try {
    const t = toTicket(await call("send", { email: e, purpose, name }));
    markResendAt(e, t.resendAt);
    return t;
  } catch (err) { rememberCooldown(e, err); throw err; }
}

/** New email for the same request; the previous code and link stop working. */
export async function resendEmailCode(ticket: string, email: string): Promise<EmailTicket> {
  const e = normalizeEmail(email);
  try {
    const t = toTicket(await call("resend", { ticket }));
    markResendAt(e, t.resendAt);
    return t;
  } catch (err) { rememberCooldown(e, err); throw err; }
}

/** Checks the 6-digit code. Single use: the email link stops working once this succeeds. */
export async function verifyEmailCode(ticket: string, code: string): Promise<{ email: string; purpose: EmailPurpose; via: "otp" | "link" }> {
  try {
    const data = await call("verify", { ticket, code: String(code).replace(/\D/g, "") });
    return { email: String(data.email), purpose: data.purpose === "reset" ? "reset" : "register", via: "otp" };
  } catch (err) {
    // The user tapped the email button first — finish with that instead.
    if (err instanceof EmailServiceError && err.code === "verified_by_link") return claimEmailLink(ticket);
    throw err;
  }
}

export async function checkEmailStatus(ticket: string): Promise<{ status: EmailStatus; purpose: EmailPurpose; codeExpired: boolean; attemptsLeft: number }> {
  const d = await call("status", { ticket });
  return { status: d.status, purpose: d.purpose === "reset" ? "reset" : "register", codeExpired: !!d.codeExpired, attemptsLeft: Number(d.attemptsLeft) || 0 };
}

/** Finishes a link-verified request exactly once (ticket owner, or a reset grant from the link page). */
export async function claimEmailLink(ticketOrRid: string, grant?: string): Promise<{ email: string; purpose: EmailPurpose; via: "link" }> {
  const d = await call("claim", grant ? { rid: ticketOrRid, grant } : { ticket: ticketOrRid });
  return { email: String(d.email), purpose: d.purpose === "reset" ? "reset" : "register", via: "link" };
}

export const ticketRid = (ticket: string) => String(ticket || "").split(".")[0] || "";

/** Reads (and removes) the ?ev=…&eg=…&ep=… the email link page sends people back with. */
export function takeVerifyRedirect(): { rid: string; grant: string; purpose: EmailPurpose } | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const rid = params.get("ev") || "";
    const grant = params.get("eg") || "";
    if (!rid || !grant) return null;
    const purpose: EmailPurpose = params.get("ep") === "reset" ? "reset" : "register";
    for (const k of ["ev", "eg", "ep", "verify", "code"]) params.delete(k);
    const q = params.toString();
    window.history.replaceState(window.history.state, "", window.location.pathname + (q ? `?${q}` : "") + window.location.hash);
    return { rid, grant, purpose };
  } catch { return null; }
}

// ---- Pending sign-up (lets the email's "Verify" button finish sign-up) ----
const PENDING_KEY = "rs_pending_register";
export type PendingRegister = { name: string; email: string; password: string; token: string; expiresAt: number; linkExpiresAt?: number };
export const savePendingRegister = (p: PendingRegister) => { try { localStorage.setItem(PENDING_KEY, JSON.stringify(p)); } catch {} };
export const clearPendingRegister = () => { try { localStorage.removeItem(PENDING_KEY); } catch {} };
export function readPendingRegister(now = Date.now()): PendingRegister | null {
  try {
    const p = JSON.parse(localStorage.getItem(PENDING_KEY) || "null");
    if (!p?.token || !p?.email || !String(p.token).includes(".")) return null;
    if (Math.max(Number(p.expiresAt) || 0, Number(p.linkExpiresAt) || 0) < now) return null;
    return p;
  } catch { return null; }
}

// ---- Pending password reset (so the email button can come back to this device) ----
const RESET_KEY = "rs_pending_reset";
export type PendingReset = { email: string; token: string; expiresAt: number; linkExpiresAt: number };
export const savePendingReset = (p: PendingReset) => { try { localStorage.setItem(RESET_KEY, JSON.stringify(p)); } catch {} };
export const clearPendingReset = () => { try { localStorage.removeItem(RESET_KEY); } catch {} };
export function readPendingReset(now = Date.now()): PendingReset | null {
  try {
    const p = JSON.parse(localStorage.getItem(RESET_KEY) || "null");
    if (!p?.token || !p?.email || Math.max(Number(p.expiresAt) || 0, Number(p.linkExpiresAt) || 0) < now) return null;
    return p;
  } catch { return null; }
}

// ---- Login-first entry wall ----
const ENTRY_KEY = "rs_entry_done";
export const entryChosen = () => { try { return localStorage.getItem(ENTRY_KEY) === "1"; } catch { return true; } };
export const markEntryChosen = () => { try { localStorage.setItem(ENTRY_KEY, "1"); } catch {} };
export const clearEntryChosen = () => { try { localStorage.removeItem(ENTRY_KEY); } catch {} };
