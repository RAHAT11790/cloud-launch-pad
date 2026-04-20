/**
 * bKash / Nagad / Rocket Auto Payment Matcher
 * ---------------------------------------------
 * Works in tandem with the Android SMS-forwarder app
 * (ShuvoService.java) which writes incoming bank SMS into
 *   Firebase RTDB:  XNXANIKPAY/{txid}  =>  { type, agent, amount, txid }
 *
 * type values written by the Android side:
 *   "B" = bKash, "N" = Nagad, "R" = Rocket (16216)
 *
 * This module provides:
 *  1. matchPaymentRequest()  – try once for a single request
 *  2. autoApprovePayment()   – activate premium + notify user
 *  3. startGlobalAutoMatcher() – realtime listener that auto-approves
 *     ANY pending bkashPayments request as soon as a matching SMS lands.
 */

import { db, ref, get, set, update, push, onValue, remove } from "@/lib/firebase";

const SMS_NODE = "XNXANIKPAY";
const PAYMENTS_NODE = "bkashPayments";
const SETTINGS_NODE = "bkashSettings";

const TYPE_LABEL: Record<string, string> = {
  B: "bKash",
  N: "Nagad",
  R: "Rocket",
};

export interface SmsEntry {
  txid: string;
  type?: string;          // B / N / R
  agent?: string;         // sender number
  amount?: string | number;
  receivedAt?: number;
  consumed?: boolean;
  consumedBy?: string;    // payment request id
}

export interface PaymentRequest {
  id: string;
  userId: string;
  userName?: string;
  userEmail?: string;
  transactionId: string;
  bkashNumber?: string;
  planId: string;
  planName: string;
  planPrice: number;
  planDays: number;
  status: "pending" | "approved" | "rejected";
  submittedAt: number;
  autoMatched?: boolean;
  matchedSmsType?: string;
  matchedSmsAmount?: string;
  matchedSmsAgent?: string;
}

const normalizeTrx = (s: string) => String(s || "").trim().toUpperCase();
const normalizeAmt = (a: any) => {
  const n = Number(String(a ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** Look up an SMS entry by TrxID (case-insensitive scan). */
export async function findSmsByTrxId(rawTrx: string): Promise<SmsEntry | null> {
  const trx = normalizeTrx(rawTrx);
  if (!trx) return null;

  // Fast path: direct child read (Android writes node by exact txid)
  try {
    const direct = await get(ref(db, `${SMS_NODE}/${trx}`));
    if (direct.exists()) return { txid: trx, ...direct.val() } as SmsEntry;
  } catch {}

  // Fallback: case-insensitive scan
  try {
    const snap = await get(ref(db, SMS_NODE));
    const all = snap.val() || {};
    for (const [key, val] of Object.entries<any>(all)) {
      if (normalizeTrx(key) === trx || normalizeTrx(val?.txid) === trx) {
        return { txid: key, ...val } as SmsEntry;
      }
    }
  } catch {}

  return null;
}

/**
 * Validate that an SMS entry truly matches a payment request.
 * - TrxID is the strong key (already matched by lookup)
 * - Optional: amount tolerance check (within ±2tk to allow charges)
 * - Optional: receiver type check (we don't have receiver in SMS, only sender,
 *   so we trust the txid + amount combo)
 */
export function smsMatchesRequest(sms: SmsEntry, req: PaymentRequest): {
  ok: boolean;
  reason?: string;
} {
  if (!sms || !req) return { ok: false, reason: "missing_data" };
  if (normalizeTrx(sms.txid) !== normalizeTrx(req.transactionId)) {
    return { ok: false, reason: "txid_mismatch" };
  }
  const smsAmount = normalizeAmt(sms.amount);
  const reqAmount = normalizeAmt(req.planPrice);
  if (smsAmount > 0 && reqAmount > 0 && Math.abs(smsAmount - reqAmount) > 2) {
    return { ok: false, reason: `amount_mismatch (sms=${smsAmount} expected=${reqAmount})` };
  }
  return { ok: true };
}

/** Activate premium + notify user (used by both auto-match and manual approve). */
export async function autoApprovePayment(
  req: PaymentRequest,
  opts: { sms?: SmsEntry; source: "auto-sms" | "manual" } = { source: "manual" },
): Promise<void> {
  // Resolve plan device limit from settings if available
  let maxDevices = 1;
  try {
    const settingsSnap = await get(ref(db, SETTINGS_NODE));
    const plans = settingsSnap.val()?.plans || [];
    const plan = plans.find((p: any) => p.id === req.planId);
    maxDevices = plan?.maxDevices || (req.planDays <= 30 ? 1 : req.planDays <= 90 ? 3 : 4);
  } catch {
    maxDevices = req.planDays <= 30 ? 1 : req.planDays <= 90 ? 3 : 4;
  }

  // Stack onto existing premium if still active
  const premiumSnap = await get(ref(db, `users/${req.userId}/premium`));
  const currentPremium = premiumSnap.val() || {};
  const baseExpiry = currentPremium?.active && currentPremium?.expiresAt > Date.now()
    ? currentPremium.expiresAt
    : Date.now();
  const expiresAt = baseExpiry + req.planDays * 24 * 60 * 60 * 1000;

  await set(ref(db, `users/${req.userId}/premium`), {
    ...currentPremium,
    active: true,
    expiresAt,
    redeemedAt: Date.now(),
    method: opts.source === "auto-sms" ? "bkash-auto" : "bkash",
    transactionId: req.transactionId,
    maxDevices,
    devices: currentPremium?.devices || {},
  });

  // Mark payment as approved with rich audit trail
  await update(ref(db, `${PAYMENTS_NODE}/${req.id}`), {
    status: "approved",
    approvedAt: Date.now(),
    autoMatched: opts.source === "auto-sms",
    matchedSmsType: opts.sms?.type || null,
    matchedSmsAmount: opts.sms?.amount ?? null,
    matchedSmsAgent: opts.sms?.agent ?? null,
  });

  // Tag the SMS entry as consumed so it can't double-approve another request
  if (opts.sms?.txid) {
    try {
      await update(ref(db, `${SMS_NODE}/${opts.sms.txid}`), {
        consumed: true,
        consumedBy: req.id,
        consumedAt: Date.now(),
      });
    } catch {}
  }

  // In-app notification
  try {
    const notifRef = push(ref(db, `notifications/${req.userId}`));
    await set(notifRef, {
      title: opts.source === "auto-sms" ? "Payment Auto-Verified! ⚡" : "Premium Activated! 🎉",
      message: `${req.planName} (৳${req.planPrice}) — ${req.planDays} days unlocked.`,
      type: "success",
      timestamp: Date.now(),
      read: false,
    });
  } catch {}

  // Push notification (best effort)
  try {
    const { sendPushToUsers } = await import("@/lib/fcm");
    await sendPushToUsers([req.userId, req.userEmail].filter(Boolean) as string[], {
      title: opts.source === "auto-sms" ? "Payment Auto-Verified ⚡" : "Premium Activated 🎉",
      body: `${req.planName} (৳${req.planPrice}) — ${req.planDays} days.`,
      url: "/profile",
      data: { type: "subscription_activated", planName: req.planName, expiresAt: String(expiresAt) },
    });
  } catch {}
}

/**
 * Try to auto-match a single payment request against existing SMS feed.
 * Returns true if matched & approved.
 */
export async function tryMatchPayment(req: PaymentRequest): Promise<boolean> {
  if (req.status !== "pending") return false;

  const sms = await findSmsByTrxId(req.transactionId);
  if (!sms) return false;
  if (sms.consumed && sms.consumedBy && sms.consumedBy !== req.id) return false;

  const check = smsMatchesRequest(sms, req);
  if (!check.ok) return false;

  await autoApprovePayment(req, { sms, source: "auto-sms" });
  return true;
}

/**
 * Realtime listener: watches BOTH new SMS arrivals AND new payment requests.
 * Whenever either side changes, attempts to pair them up.
 *
 * Returns a cleanup function.
 *
 * NOTE: only one instance should run globally — best place is the Admin panel
 * (admin device acts as the matcher). We also run a lightweight per-user
 * version on submit (see ProfilePage `submitBkashPayment`).
 */
export function startGlobalAutoMatcher(): () => void {
  let pendingCache: PaymentRequest[] = [];
  let smsCache: Record<string, SmsEntry> = {};

  const tryMatchAll = async () => {
    for (const req of pendingCache) {
      if (req.status !== "pending") continue;
      const txKey = normalizeTrx(req.transactionId);
      // direct lookup first
      let sms = smsCache[txKey] || smsCache[req.transactionId];
      if (!sms) {
        for (const [k, v] of Object.entries(smsCache)) {
          if (normalizeTrx(k) === txKey || normalizeTrx(v?.txid) === txKey) {
            sms = v;
            break;
          }
        }
      }
      if (!sms) continue;
      if (sms.consumed && sms.consumedBy && sms.consumedBy !== req.id) continue;
      const check = smsMatchesRequest(sms, req);
      if (!check.ok) continue;
      try {
        await autoApprovePayment(req, { sms, source: "auto-sms" });
        // mutate local cache so we don't double-process
        req.status = "approved";
      } catch (e) {
        console.warn("[autoMatcher] approve failed", e);
      }
    }
  };

  const paymentsRef = ref(db, PAYMENTS_NODE);
  const smsRef = ref(db, SMS_NODE);

  const paymentsCb = (snap: any) => {
    const val = snap.val() || {};
    pendingCache = Object.entries<any>(val).map(([id, p]) => ({ id, ...p })) as PaymentRequest[];
    tryMatchAll();
  };
  const smsCb = (snap: any) => {
    smsCache = snap.val() || {};
    tryMatchAll();
  };

  onValue(paymentsRef, paymentsCb);
  onValue(smsRef, smsCb);

  return () => {
    try { off(paymentsRef, "value", paymentsCb); } catch {}
    try { off(smsRef, "value", smsCb); } catch {}
  };
}

/** Admin maintenance: clear consumed/old SMS entries (>30 days). */
export async function pruneOldSmsEntries(maxAgeDays = 30): Promise<number> {
  const snap = await get(ref(db, SMS_NODE));
  const all = snap.val() || {};
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  let removed = 0;
  await Promise.all(Object.entries<any>(all).map(async ([key, val]) => {
    const ts = Number(val?.consumedAt || val?.receivedAt || 0);
    if (val?.consumed && ts && ts < cutoff) {
      try { await remove(ref(db, `${SMS_NODE}/${key}`)); removed++; } catch {}
    }
  }));
  return removed;
}

export const SmsTypeLabel = TYPE_LABEL;
