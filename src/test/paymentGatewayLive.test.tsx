import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const subscriptions = vi.hoisted(() => new Map<string, (snapshot: { val: () => unknown }) => void>());
vi.mock("@/lib/firebase", () => ({
  db: {}, ref: (_db: unknown, path: string) => path,
  onValue: (path: string, callback: (snapshot: { val: () => unknown }) => void) => {
    subscriptions.set(path, callback);
    return () => subscriptions.delete(path);
  },
}));
import { usePaymentGateway } from "@/hooks/usePaymentGateway";

describe("live payment gateway settings", () => {
  beforeEach(() => { localStorage.clear(); subscriptions.clear(); });
  it("a mounted buyer receives newly saved admin benefits instead of keeping the old list", () => {
    const { result, unmount } = renderHook(() => usePaymentGateway());
    act(() => subscriptions.get("settings/paymentGateway")?.({ val: () => ({ benefits: ["Ad-free streaming"] }) }));
    expect(result.current.config.benefits).toEqual(["Ad-free streaming"]);
    act(() => subscriptions.get("settings/paymentGateway")?.({ val: () => ({ benefits: ["NO ANY ADS", "4K QUALITY UNLOCK", "NO WATER MARK"] }) }));
    expect(result.current.config.benefits).toEqual(["NO ANY ADS", "4K QUALITY UNLOCK", "NO WATER MARK"]);
    unmount();
    expect(subscriptions.size).toBe(0);
  });
});