import { db, onValue, ref, update } from "@/lib/firebase";

/**
 * Public "about me" card shown on the profile (bio, mood, favourite genres,
 * card glow). Stored at `users/{uid}/profileCard`, mirrored in localStorage so
 * the profile paints correctly before the network answers.
 */
export type ProfileCard = { bio: string; mood: string; genres: string[]; accent: string; updatedAt?: number };

export const BIO_MAX = 120;
export const GENRES_MAX = 5;
export const NAME_MIN = 2;
export const NAME_MAX = 30;

export const PROFILE_MOODS = [
  { id: "", emoji: "", label: "None" },
  { id: "binge", emoji: "🍿", label: "Binge mode" },
  { id: "chill", emoji: "😌", label: "Chilling" },
  { id: "hype", emoji: "🔥", label: "Hyped" },
  { id: "otaku", emoji: "🎌", label: "Full otaku" },
  { id: "battle", emoji: "⚔️", label: "Battle ready" },
  { id: "romance", emoji: "💘", label: "In my romance era" },
  { id: "sleepy", emoji: "😴", label: "Sleepy" },
  { id: "hunting", emoji: "🔎", label: "Finding new anime" },
] as const;

export const PROFILE_GENRES = [
  "Action", "Adventure", "Comedy", "Drama", "Fantasy", "Isekai", "Romance", "Shonen",
  "Seinen", "Slice of Life", "Sci-Fi", "Mecha", "Mystery", "Horror", "Sports", "Supernatural",
] as const;

/** Card glow colours as "r g b" so they work with rgb(var(--x) / a). "" = follow the profile theme. */
export const PROFILE_ACCENTS = [
  { id: "", name: "Theme", rgb: "" },
  { id: "ruby", name: "Ruby", rgb: "237 66 69" },
  { id: "ocean", name: "Ocean", rgb: "59 130 246" },
  { id: "aqua", name: "Aqua", rgb: "34 211 238" },
  { id: "jade", name: "Jade", rgb: "46 196 141" },
  { id: "gold", name: "Gold", rgb: "240 178 50" },
  { id: "sakura", name: "Sakura", rgb: "244 114 182" },
  { id: "silver", name: "Silver", rgb: "190 196 210" },
] as const;

export const EMPTY_CARD: ProfileCard = { bio: "", mood: "", genres: [], accent: "" };

const MOOD_IDS = new Set<string>(PROFILE_MOODS.map((m) => m.id));
const GENRE_SET = new Set<string>(PROFILE_GENRES);
const ACCENT_IDS = new Set<string>(PROFILE_ACCENTS.map((a) => a.id));

/** Trims, strips control characters, collapses blank lines, enforces every limit. */
export function cleanBio(v: unknown): string {
  return String(v ?? "")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f\u200b-\u200f\u202a-\u202e]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n").map((l) => l.replace(/\s+$/g, "")).join("\n")
    .trim()
    .slice(0, BIO_MAX);
}
export function cleanCard(raw: any): ProfileCard {
  const genres = Array.isArray(raw?.genres) ? raw.genres : raw?.genres && typeof raw.genres === "object" ? Object.values(raw.genres) : [];
  return {
    bio: cleanBio(raw?.bio),
    mood: MOOD_IDS.has(String(raw?.mood ?? "")) ? String(raw?.mood ?? "") : "",
    genres: [...new Set(genres.map(String).filter((g: string) => GENRE_SET.has(g)))].slice(0, GENRES_MAX) as string[],
    accent: ACCENT_IDS.has(String(raw?.accent ?? "")) ? String(raw?.accent ?? "") : "",
    ...(Number(raw?.updatedAt) ? { updatedAt: Number(raw.updatedAt) } : {}),
  };
}
/** Display name rule: 2–30 visible characters, no control characters. */
export function cleanName(v: unknown): string {
  return String(v ?? "").replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e<>]/g, "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
}
export const nameError = (v: string) => {
  const n = cleanName(v);
  if (n.length < NAME_MIN) return `Name needs at least ${NAME_MIN} characters`;
  return "";
};

export const moodOf = (id: string) => PROFILE_MOODS.find((m) => m.id === id) || PROFILE_MOODS[0];
export const accentRgb = (id: string) => PROFILE_ACCENTS.find((a) => a.id === id)?.rgb || "";
export const sameCard = (a: ProfileCard, b: ProfileCard) =>
  a.bio === b.bio && a.mood === b.mood && a.accent === b.accent && a.genres.join("|") === b.genres.join("|");

const cacheKey = (uid: string) => `rs_profile_card_v1_${uid}`;
export function readCachedCard(uid?: string | null): ProfileCard {
  if (!uid) return EMPTY_CARD;
  try { return cleanCard(JSON.parse(localStorage.getItem(cacheKey(uid)) || "null")); } catch { return EMPTY_CARD; }
}
export function subscribeProfileCard(uid: string, cb: (c: ProfileCard) => void): () => void {
  cb(readCachedCard(uid));
  return onValue(ref(db, `users/${uid}/profileCard`), (snap) => {
    const c = cleanCard(snap.val());
    try { localStorage.setItem(cacheKey(uid), JSON.stringify(c)); } catch { /* quota */ }
    cb(c);
  }, () => undefined);
}
export async function saveProfileCard(uid: string, card: ProfileCard): Promise<ProfileCard> {
  const c = { ...cleanCard(card), updatedAt: Date.now() };
  try { localStorage.setItem(cacheKey(uid), JSON.stringify(c)); } catch { /* quota */ }
  await update(ref(db, `users/${uid}`), { profileCard: { bio: c.bio, mood: c.mood, genres: c.genres, accent: c.accent, updatedAt: c.updatedAt } });
  return c;
}
