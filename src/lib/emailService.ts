import { getEdgeFunctionUrl } from "@/lib/edgeFunctionRouter";

/** Only real-looking @gmail.com addresses (6–30 char local part, no "+", no double dots). */
const GMAIL_RE = /^(?=.{6,30}@)[a-z0-9](?:[a-z0-9]|\.(?!\.))*[a-z0-9]@gmail\.com$/;

export const normalizeEmail = (v: string) => String(v || "").trim().toLowerCase();
export const isAllowedGmail = (v: string) => GMAIL_RE.test(normalizeEmail(v));
/** Gmail ignores dots, so a.b.c@gmail.com and abc@gmail.com are one inbox. */
export const gmailCanonicalKey = (v: string) => normalizeEmail(v).split("@")[0].replace(/\./g, "");

export type EmailPurpose = "register" | "reset";
export class EmailServiceError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

const COOLDOWN_KEY = "rs_email_cooldown";
const COOLDOWN_MS = 60_000;

export function cooldownLeftMs(email: string, now = Date.now()): number {
  try {
    const map = JSON.parse(localStorage.getItem(COOLDOWN_KEY) || "{}");
    return Math.max(0, Number(map[normalizeEmail(email)] || 0) + COOLDOWN_MS - now);
  } catch { return 0; }
}
function markSent(email: string) {
  try {
    const map = JSON.parse(localStorage.getItem(COOLDOWN_KEY) || "{}");
    const now = Date.now();
    for (const k of Object.keys(map)) if (now - map[k] > COOLDOWN_MS) delete map[k];
    map[normalizeEmail(email)] = now;
    localStorage.setItem(COOLDOWN_KEY, JSON.stringify(map));
  } catch {}
}

async function call(body: Record<string, unknown>) {
  const url = await getEdgeFunctionUrl("email-service");
  if (!url) throw new EmailServiceError("not_configured", "Email service is not set up yet. Please try again later.");
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new EmailServiceError("network", "Can't reach the email server. Check your internet and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok) {
    if (data?.details) console.error("email-service failed:", res.status, data.details);
    throw new EmailServiceError(data?.error || "server", data?.message || "Something went wrong. Try again.");
  }
  return data;
}

export async function sendEmailCode(email: string, purpose: EmailPurpose, name?: string): Promise<{ token: string; expiresAt: number }> {
  const e = normalizeEmail(email);
  if (!isAllowedGmail(e)) throw new EmailServiceError("only_gmail", "Only @gmail.com addresses are allowed.");
  const wait = cooldownLeftMs(e);
  if (wait > 0) throw new EmailServiceError("cooldown", `Please wait ${Math.ceil(wait / 1000)}s before asking for another code.`);
  const data = await call({ action: "send", email: e, purpose, name });
  markSent(e);
  return { token: String(data.token), expiresAt: Number(data.expiresAt) };
}

export async function verifyEmailCode(token: string, code: string): Promise<{ email: string; purpose: EmailPurpose }> {
  const data = await call({ action: "verify", token, code: String(code).replace(/\D/g, "") });
  return { email: String(data.email), purpose: data.purpose === "reset" ? "reset" : "register" };
}

// ---- Pending sign-up (lets the email's "Verify" button finish sign-up) ----
const PENDING_KEY = "rs_pending_register";
export type PendingRegister = { name: string; email: string; password: string; token: string; expiresAt: number };
export const savePendingRegister = (p: PendingRegister) => { try { localStorage.setItem(PENDING_KEY, JSON.stringify(p)); } catch {} };
export const clearPendingRegister = () => { try { localStorage.removeItem(PENDING_KEY); } catch {} };
export function readPendingRegister(now = Date.now()): PendingRegister | null {
  try {
    const p = JSON.parse(localStorage.getItem(PENDING_KEY) || "null");
    if (!p?.token || !p?.email || Number(p.expiresAt) < now) return null;
    return p;
  } catch { return null; }
}

// ---- Login-first entry wall ----
const ENTRY_KEY = "rs_entry_done";
export const entryChosen = () => { try { return localStorage.getItem(ENTRY_KEY) === "1"; } catch { return true; } };
export const markEntryChosen = () => { try { localStorage.setItem(ENTRY_KEY, "1"); } catch {} };
export const clearEntryChosen = () => { try { localStorage.removeItem(ENTRY_KEY); } catch {} };
