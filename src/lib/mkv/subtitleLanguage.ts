// Detects the real language of a subtitle track from its text. Many uploads
// tag every subtitle "English", so the script of the lines is trusted instead.
const SCRIPTS: [RegExp, string][] = [
  [/[\u0980-\u09FF]/g, "Bengali"],
  [/[\u0B80-\u0BFF]/g, "Tamil"],
  [/[\u0C00-\u0C7F]/g, "Telugu"],
  [/[\u0C80-\u0CFF]/g, "Kannada"],
  [/[\u0D00-\u0D7F]/g, "Malayalam"],
  [/[\u0A00-\u0A7F]/g, "Punjabi"],
  [/[\u0A80-\u0AFF]/g, "Gujarati"],
  [/[\u0900-\u097F]/g, "Hindi"],
  [/[\u3040-\u30FF]/g, "Japanese"],
  [/[\uAC00-\uD7AF]/g, "Korean"],
  [/[\u4E00-\u9FFF]/g, "Chinese"],
  [/[\u0E00-\u0E7F]/g, "Thai"],
  [/[\u0400-\u04FF]/g, "Russian"],
  [/[\u0600-\u06FF]/g, "Arabic"],
];

export function detectSubtitleLanguage(lines: string[]): string {
  const text = lines.join(" ");
  const letters = (text.match(/[\p{L}\p{M}]/gu) || []).length;
  if (letters < 4) return "";
  let best = ""; let bestCount = 0;
  for (const [re, name] of SCRIPTS) {
    const n = (text.match(re) || []).length;
    if (n > bestCount) { best = name; bestCount = n; }
  }
  if (best === "Japanese" || (best === "Chinese" && /[\u3040-\u30FF]/.test(text))) best = "Japanese";
  if (best === "Arabic" && /[ٹڈڑںےۓ]/.test(text)) best = "Urdu";
  // A non-Latin script is unambiguous even in one short sign line.
  if (bestCount / letters > 0.3) return best;
  if (letters < 20) return "";
  // Latin script: tell Hinglish (romanised Hindi) apart from English.
  const words = text.toLowerCase().match(/[a-z]+/g) || [];
  if (words.length < 8) return "";
  const hi = words.filter((w) => /^(hai|hain|nahi|nahin|kya|mujhe|tum|tumhe|mera|meri|kaise|aur|bhi|kyun|abhi|yeh|woh|hum|kar|karo|raha|rahe|gaya|tha|thi)$/.test(w)).length;
  const en = words.filter((w) => /^(the|you|is|are|and|what|this|that|to|of|i|it|we|not|have)$/.test(w)).length;
  if (hi > en && hi >= 3) return "Hindi";
  if (en >= 3) return "English";
  return "";
}
