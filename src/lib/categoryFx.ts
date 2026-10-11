// Category look: matching emoji + a motion that fits the category.
// Shared by the top category pills, the home rail titles and New Release.

export interface CategoryFx { emoji: string; motion: string; text: string }

const FX: [RegExp, CategoryFx][] = [
  [/new\s*(episode|release)|latest|⚡/i, { emoji: "⚡", motion: "strike", text: "flash" }],
  [/popular|trend|top|hot|🔥/i, { emoji: "🔥", motion: "flame", text: "wave" }],
  [/movie|film|🎬/i, { emoji: "🎬", motion: "clap", text: "wave" }],
  [/action|fight|battle|⚔/i, { emoji: "⚔️", motion: "slash", text: "impact" }],
  [/adventure|journey|🧭/i, { emoji: "🧭", motion: "travel", text: "wave" }],
  [/romance|love|💖|❤/i, { emoji: "💖", motion: "heart", text: "beat" }],
  [/comedy|funny|😂/i, { emoji: "😂", motion: "laugh", text: "bounce" }],
  [/isekai|portal|🌀/i, { emoji: "🌀", motion: "portal", text: "wave" }],
  [/fantasy|magic|✨/i, { emoji: "✨", motion: "orbit", text: "shine" }],
  [/drama|🎭/i, { emoji: "🎭", motion: "swing", text: "wave" }],
  [/horror|ghost|dark|👻/i, { emoji: "👻", motion: "ghost", text: "flicker" }],
  [/mystery|detective|🔍/i, { emoji: "🔍", motion: "scan", text: "wave" }],
  [/hindi|dub|🎙/i, { emoji: "🎙️", motion: "swing", text: "wave" }],
  [/series|tv|show|📺/i, { emoji: "📺", motion: "travel", text: "wave" }],
  [/sport|⚽/i, { emoji: "⚽", motion: "laugh", text: "bounce" }],
  [/sci-?fi|mecha|space|🚀/i, { emoji: "🚀", motion: "strike", text: "wave" }],
  [/slice|life|school|🌸/i, { emoji: "🌸", motion: "orbit", text: "wave" }],
  [/^all$/i, { emoji: "🌟", motion: "orbit", text: "shine" }],
];

const LEAD = /^(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*\uFE0F?)\s*/u;

/** Split an optional leading emoji off a title and pick the category motion. */
export function categoryFx(title: string): { emoji: string; label: string; fx: CategoryFx } {
  const raw = String(title || "").trim();
  const m = raw.match(LEAD);
  const label = m ? raw.slice(m[0].length) : raw;
  const fx = FX.find(([re]) => re.test(raw))?.[1] || { emoji: "🎌", motion: "travel", text: "wave" };
  return { emoji: m?.[1] || fx.emoji, label, fx };
}
