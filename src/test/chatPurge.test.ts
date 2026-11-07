import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/firebase", () => ({ db: { app: { options: {} } }, ref: vi.fn(), query: vi.fn(), limitToLast: vi.fn(), onValue: vi.fn(), push: vi.fn(), set: vi.fn(), remove: vi.fn(), get: vi.fn(), update: vi.fn(), auth: {} }));
import { memberMessagePatch, CHAT_ROOM_PATH } from "@/lib/communityChat";

describe("permanent ban purge", () => {
  it("deletes only the banned member's messages and their voice notes", () => {
    const room = {
      a: { uid: "bad", kind: "text", text: "x" },
      b: { uid: "good", kind: "text", text: "y" },
      c: { uid: "bad", kind: "voice", voice: "voice_123456" },
      d: { uid: "bad", kind: "image", image: "https://i.ibb.co/p.png" },
    };
    expect(memberMessagePatch(room, "bad")).toEqual({
      [`${CHAT_ROOM_PATH}/a`]: null,
      [`${CHAT_ROOM_PATH}/c`]: null,
      "communityChat/voice/voice_123456": null,
      [`${CHAT_ROOM_PATH}/d`]: null,
    });
  });
  it("returns nothing when the member has no messages", () => {
    expect(memberMessagePatch({ b: { uid: "good" } }, "bad")).toEqual({});
    expect(memberMessagePatch(null, "bad")).toEqual({});
  });
});
