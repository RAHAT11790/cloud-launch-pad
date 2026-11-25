import { describe, it, expect } from "vitest";
import { normalizeGateway, usableMethods, priceFor, senderLooksValid, contactLinks } from "@/lib/paymentGateway";

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
  it("crypto price is the Taka price divided by the USDT rate, rounded up", () => {
    expect(priceFor({ kind: "crypto" }, 100, 125)).toBe("0.80 USDT");
    expect(priceFor({ kind: "crypto" }, 101, 125)).toBe("0.81 USDT");
    expect(priceFor({ kind: "mobile" }, 100, 125)).toBe("৳100");
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
});
