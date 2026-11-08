/** Counters written by the Gmail email Worker to Firebase `emailAuth/stats/{YYYY-MM-DD}` (Bangladesh day). */
export type EmailDayStats = {
  sent?: number; sent_register?: number; sent_reset?: number; failed?: number; resend?: number;
  verified_otp?: number; verified_link?: number; claimed?: number;
  wrong?: number; locked?: number; expired?: number; limited?: number;
  gmail_ms?: number; gmail_n?: number;
};

export type EmailSummary = {
  sent: number; failed: number; verified: number; viaOtp: number; viaLink: number;
  register: number; reset: number; wrong: number; locked: number; expired: number; limited: number; resend: number;
  /** % of send attempts Gmail accepted. */
  deliveryRate: number | null;
  /** % of sent emails that were verified (code or button). */
  verifyRate: number | null;
  /** Average Gmail API time per email, ms. */
  avgMs: number | null;
};

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0);
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

export function summarizeEmailStats(days: EmailDayStats[]): EmailSummary {
  const t = days.reduce<Record<string, number>>((acc, d) => {
    for (const [k, v] of Object.entries(d || {})) acc[k] = (acc[k] || 0) + n(v);
    return acc;
  }, {});
  const sent = t.sent || 0, failed = t.failed || 0;
  const viaOtp = t.verified_otp || 0, viaLink = t.verified_link || 0;
  const verified = viaOtp + viaLink;
  return {
    sent, failed, verified, viaOtp, viaLink,
    register: t.sent_register || 0, reset: t.sent_reset || 0,
    wrong: t.wrong || 0, locked: t.locked || 0, expired: t.expired || 0, limited: t.limited || 0, resend: t.resend || 0,
    deliveryRate: pct(sent, sent + failed),
    verifyRate: sent > 0 ? Math.min(100, pct(verified, sent) as number) : null,
    avgMs: t.gmail_n ? Math.round((t.gmail_ms || 0) / t.gmail_n) : null,
  };
}

/** Bangladesh calendar day (UTC+6), same key the Worker uses. */
export const emailDayKey = (t = Date.now()) => new Date(t + 6 * 3600_000).toISOString().slice(0, 10);

/** Last `count` day keys, oldest first, ending today. */
export function lastDayKeys(count: number, now = Date.now()): string[] {
  return Array.from({ length: count }, (_, i) => emailDayKey(now - (count - 1 - i) * 86400_000));
}

export type EmailServiceSettings = {
  otpMinutes: number; linkMinutes: number; cooldownSeconds: number; maxAttempts: number;
  dailyLimit: number; hourlyPerEmail: number; hourlyPerIp: number;
};
export const EMAIL_SETTING_DEFAULTS: EmailServiceSettings = { otpMinutes: 10, linkMinutes: 30, cooldownSeconds: 60, maxAttempts: 5, dailyLimit: 450, hourlyPerEmail: 6, hourlyPerIp: 20 };
/** Same limits the Worker clamps to. */
export const EMAIL_SETTING_BOUNDS: Record<keyof EmailServiceSettings, [number, number]> = {
  otpMinutes: [3, 30], linkMinutes: [5, 180], cooldownSeconds: [20, 900], maxAttempts: [3, 10],
  dailyLimit: [10, 2000], hourlyPerEmail: [2, 30], hourlyPerIp: [3, 200],
};
export function clampEmailSettings(raw: Partial<Record<keyof EmailServiceSettings, unknown>> | null | undefined): EmailServiceSettings {
  const out = { ...EMAIL_SETTING_DEFAULTS };
  for (const k of Object.keys(EMAIL_SETTING_DEFAULTS) as (keyof EmailServiceSettings)[]) {
    if (raw?.[k] == null || raw?.[k] === "") continue;
    const v = Math.round(Number(raw[k]));
    const [lo, hi] = EMAIL_SETTING_BOUNDS[k];
    if (Number.isFinite(v)) out[k] = Math.min(hi, Math.max(lo, v));
  }
  return out;
}
