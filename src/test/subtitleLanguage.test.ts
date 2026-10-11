import { describe, expect, it } from "vitest";
import { detectSubtitleLanguage } from "@/lib/mkv/subtitleLanguage";
const rep = (s: string) => Array(8).fill(s);
describe("detectSubtitleLanguage", () => {
  it("Hindi", () => expect(detectSubtitleLanguage(rep("तुम यहाँ क्या कर रहे हो?"))).toBe("Hindi"));
  it("Bengali", () => expect(detectSubtitleLanguage(rep("তুমি এখানে কী করছ?"))).toBe("Bengali"));
  it("Tamil", () => expect(detectSubtitleLanguage(rep("நீ இங்கே என்ன செய்கிறாய்?"))).toBe("Tamil"));
  it("Telugu", () => expect(detectSubtitleLanguage(rep("నువ్వు ఇక్కడ ఏం చేస్తున్నావు?"))).toBe("Telugu"));
  it("Japanese", () => expect(detectSubtitleLanguage(rep("ここで何をしているの？"))).toBe("Japanese"));
  it("Urdu", () => expect(detectSubtitleLanguage(rep("تم یہاں کیا کر رہے ہو؟ ٹھیک ہے"))).toBe("Urdu"));
  it("English", () => expect(detectSubtitleLanguage(rep("What are you doing here, it is not safe"))).toBe("English"));
});
