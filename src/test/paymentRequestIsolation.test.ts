import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/firebase", () => ({ db: {}, ref: vi.fn(), get: vi.fn(), set: vi.fn(), update: vi.fn(), onValue: vi.fn(), remove: vi.fn() }));
import { smsMatchesRequest, tryMatchPayment, type PaymentRequest } from "@/lib/bkashAutoMatcher";
import { get, set, update } from "@/lib/firebase";

const request: PaymentRequest = { id: "req", userId: "account", transactionId: "TX1", planId: "month", planName: "Month", planPrice: 3.5, planDays: 30, status: "pending", submittedAt: 1 };
describe("payment request isolation", () => {
  it("never SMS-approves Binance even when transaction and numeric amount match", async () => {
    const crypto = { ...request, method: "binance", currency: "USDT" };
    expect(smsMatchesRequest({ txid: "TX1", type: "B", amount: 3.5 }, crypto).ok).toBe(false);
    expect(await tryMatchPayment(crypto)).toBe(false);
  });
  it("Nagad requests do not match bKash SMS", () => {
    expect(smsMatchesRequest({ txid: "TX1", type: "B", amount: 3.5 }, { ...request, method: "nagad" }).ok).toBe(false);
    expect(smsMatchesRequest({ txid: "TX1", type: "N", amount: 3.5 }, { ...request, method: "nagad" }).ok).toBe(true);
  });
  it("leaves an already approved record and subscription unchanged", async () => {
    vi.mocked(get).mockResolvedValueOnce({ exists: () => true, val: () => ({ txid: "TX1", type: "B", amount: 3.5 }) } as any);
    vi.mocked(get).mockResolvedValueOnce({ val: () => ({ status: "approved" }) } as any);
    expect(await tryMatchPayment({ ...request, method: "bkash" })).toBe(false);
    expect(set).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});