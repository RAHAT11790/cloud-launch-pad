import { describe, it, expect } from "vitest";
import { normalizeGateway, usableMethods, priceFor, plansFor, paymentRequestGroup, senderLooksValid, contactLinks, paymentProofRule, paymentSubmissionError } from "@/lib/paymentGateway";

describe("payment gateway", () => {
  it("defaults list bKash first, then Nagad, then Binance", () => {
    expect(normalizeGateway(null).methods.map((m) => m.id)).toEqual(["bkash", "nagad", "binance"]);
  });
  it("old bKash number keeps working when the gateway is not set up yet", () => {
    const cfg = normalizeGateway(null, { phoneNumber: "01712345678", accountType: "Personal" });
    expect(cfg.methods[0].number).toBe("01712345678");
    expect(cfg.methods[0].accountType).toBe("Personal");
  });
  it("a method without a number or switched off is not offered", () => {
    const cfg = normalizeGateway({ methods: [
      { id: "bkash", number: "01712345678" }, { id: "nagad", number: "" }, { id: "binance", number: "123", enabled: false },
    ] });
    expect(usableMethods(cfg).map((m) => m.id)).toEqual(["bkash"]);
  });
  it("crypto uses the independent admin dollar price, never the old 125 Taka rate", () => {
    const cfg = normalizeGateway({ usdtRate: 125, methods: [{ id: "binance", kind: "crypto", plans: [{ id: "usd", name: "Month", price: 3.5, days: 30 }] }] });
    const list = plansFor(cfg.methods[0], [{ id: "taka", price: 100 }]);
    expect(list.map((p) => p.id)).toEqual(["usd"]);
    expect(priceFor(cfg.methods[0], list[0].price)).toBe("3.50 USDT");
    expect(priceFor({ kind: "mobile" }, 100)).toBe("৳100");
  });
  it("an unset Binance price list never falls back to bKash prices", () => {
    expect(plansFor({ kind: "crypto" }, [{ id: "wallet", price: 125 }])).toEqual([]);
  });
  it("wallet and crypto requests belong to separate lists, including old Binance requests", () => {
    expect(paymentRequestGroup({ method: "bkash" })).toBe("wallet");
    expect(paymentRequestGroup({ method: "nagad" })).toBe("wallet");
    expect(paymentRequestGroup({ method: "binance" })).toBe("crypto");
    expect(paymentRequestGroup({ method: "custom", methodKind: "crypto", currency: "USDT" })).toBe("crypto");
    expect(paymentRequestGroup({})).toBe("wallet");
  });
  it("wallet sender must be an 11-digit number starting 01", () => {
    expect(senderLooksValid({ kind: "mobile" }, "01712345678")).toBe(true);
    expect(senderLooksValid({ kind: "mobile" }, "1712345678")).toBe(false);
    expect(senderLooksValid({ kind: "crypto" }, "8812")).toBe(true);
  });
  it("Telegram username and WhatsApp number become links", () => {
    expect(contactLinks({ telegram: "@rsadmin", whatsapp: "+880 1712-345678" })).toEqual({
      telegram: "https://t.me/rsadmin", whatsapp: "https://wa.me/8801712345678",
    });
  });
  it("review wait defaults to 24 hours", () => expect(normalizeGateway({}).reviewHours).toBe(24));
  it("keeps admin benefits in order even when Firebase returns sparse numeric keys", () => {
    expect(normalizeGateway({ benefits: { 0: "NO ANY ADS", 2: "4K QUALITY UNLOCK", 4: "NO WATER MARK" } }).benefits)
      .toEqual(["NO ANY ADS", "4K QUALITY UNLOCK", "NO WATER MARK"]);
  });
  it.each(["BEP20 (USDT)", "TRC20 (USDT)", "TON (USDT)"])("preserves the configured %s network and its address/QR", (network) => {
    const cfg = normalizeGateway({ methods: [{ id: "binance", kind: "crypto", accountType: network, number: "wallet-address", qr: "data:image/png;base64,QR" }] });
    expect(cfg.methods[0].accountType).toBe(network);
    expect(cfg.methods[0].number).toBe("wallet-address");
    expect(cfg.methods[0].qr).toBe("data:image/png;base64,QR");
  });
});

describe("payment proof rules", () => {
  const wallet = { kind: "mobile" as const, name: "bKash", senderLabel: "Your bKash number" };
  const crypto = { kind: "crypto" as const, name: "Binance", senderLabel: "Your Binance ID" };

  it("bKash still requires the Transaction ID and needs no screenshot", () => {
    expect(paymentSubmissionError(wallet, { sender: "01712345678", transactionId: "", screenshot: "" })).toMatch(/Transaction ID/);
    expect(paymentSubmissionError(wallet, { sender: "01712345678", transactionId: "DKQ923H0TJ", screenshot: "" })).toBe("");
  });

  it("Binance never asks for a Transaction ID but requires the screenshot", () => {
    expect(paymentProofRule(crypto).needsTransactionId).toBe(false);
    expect(paymentSubmissionError(crypto, { sender: "", transactionId: "", screenshot: "" })).toMatch(/screenshot/);
    expect(paymentSubmissionError(crypto, { sender: "", transactionId: "", screenshot: "data:image/webp;base64,AA" })).toBe("");
  });
});
