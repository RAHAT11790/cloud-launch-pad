import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/firebase", () => ({ db: { app: { options: {} } }, ref: vi.fn(), query: vi.fn(), limitToLast: vi.fn(), onValue: vi.fn(), push: vi.fn(), set: vi.fn(), remove: vi.fn() }));
import { buildMessage, currentChatProfile, messagePreview, sendChatMessage } from "@/lib/communityChat";

const me = { id: "u_real_1", name: "Rahat", photo: "" };

describe("Global chat rules", () => {
  beforeEach(() => localStorage.clear());

  it("accepts text, photo, voice and sticker messages", () => {
    expect(buildMessage(me, { kind: "text", text: " Hi " }).text).toBe("Hi");
    expect(buildMessage(me, { kind: "image", image: "https://i.ibb.co/x/a.jpg" }).kind).toBe("image");
    expect(buildMessage(me, { kind: "voice", voice: "-NvoiceId12", dur: 12 }).dur).toBe(12);
    expect(buildMessage(me, { kind: "sticker", sticker: "🔥" }).sticker).toBe("🔥");
  });

  it("never accepts video", () => {
    expect(() => buildMessage(me, { kind: "video" } as never)).toThrow();
    expect(() => buildMessage(me, { kind: "image", image: "https://x.com/clip.mp4" })).toThrow("Invalid image");
    expect(() => buildMessage(me, { kind: "sticker", sticker: "https://x.com/a.webm" })).toThrow("Invalid sticker");
  });

  it("limits voice messages to 60 seconds", () => {
    expect(() => buildMessage(me, { kind: "voice", voice: "-NvoiceId12", dur: 61 })).toThrow();
  });

  it("keeps the replied-to message reference", () => {
    const row = buildMessage(me, { kind: "text", text: "yes" }, { id: "m1", name: "Asha", preview: "Who watched EP 12?" });
    expect(row.reply).toEqual({ id: "m1", name: "Asha", preview: "Who watched EP 12?" });
    expect(messagePreview({ kind: "voice", dur: 65 })).toContain("1:05");
  });

  it("lets signed-in accounts send but not guests", async () => {
    localStorage.setItem("rsanime_user", JSON.stringify({ id: "guest_abc", name: "Guest" }));
    expect(currentChatProfile()).toBeNull();
    await expect(sendChatMessage({ kind: "text", text: "hi" })).rejects.toThrow("Sign in");
    localStorage.setItem("rsanime_user", JSON.stringify({ id: "u_real_1", name: "Rahat", email: "r@example.com" }));
    expect(currentChatProfile()?.id).toBe("u_real_1");
  });
});
