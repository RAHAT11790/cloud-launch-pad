import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/firebase", () => ({ auth: { currentUser: null }, db: {}, ref: vi.fn(), query: vi.fn(), limitToLast: vi.fn(), onValue: vi.fn(), push: vi.fn(), set: vi.fn() }));
import { CHAT_SECURITY_READY, privateRoomId, sendChatMessage } from "@/lib/communityChat";
describe("Community privacy", () => {
  it("uses the same room for both participants, separate from another pair", () => {
    expect(privateRoomId("alice", "bob")).toBe(privateRoomId("bob", "alice"));
    expect(privateRoomId("alice", "carol")).not.toBe(privateRoomId("alice", "bob"));
  });
  it("rejects sending until deployed Firebase access rules are verified", async () => {
    expect(CHAT_SECURITY_READY).toBe(false);
    await expect(sendChatMessage("global", "Hello")).rejects.toThrow("security setup");
  });
});