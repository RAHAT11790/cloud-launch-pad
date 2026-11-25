import { describe, expect, it } from "vitest";
import { premiumPayPath, readPremiumPayTab } from "@/lib/premiumPayLink";

describe("Redeem page payment buttons", () => {
  it("bKash opens the profile's bKash payment tab", () => {
    expect(premiumPayPath("bkash")).toBe("/profile?pay=bkash");
    expect(readPremiumPayTab("?pay=bkash")).toBe("bkash");
  });
  it("Redeem Code opens the profile's redeem-code tab", () => {
    expect(premiumPayPath("redeem")).toBe("/profile?pay=redeem");
    expect(readPremiumPayTab("?pay=redeem")).toBe("redeem");
  });
  it("Nagad and Binance open their own payment tab", () => {
    expect(readPremiumPayTab("?pay=nagad")).toBe("nagad");
    expect(readPremiumPayTab("?pay=binance")).toBe("binance");
  });
  it("other addresses open no payment tab", () => {
    expect(readPremiumPayTab("")).toBe(null);
    expect(readPremiumPayTab("?pay=movies")).toBe(null);
  });
});
