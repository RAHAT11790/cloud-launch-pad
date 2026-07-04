export type ImageSize = "poster" | "backdrop" | "avatar";

const TMDB_SIZE: Record<ImageSize, string> = {
  poster: "w342",
  backdrop: "w780",
  avatar: "w185",
};

export function optimizedImageUrl(src?: string | null, size: ImageSize = "poster") {
  const url = String(src || "").trim();
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "image.tmdb.org") {
      parsed.pathname = parsed.pathname.replace(/\/t\/p\/[^/]+\//, `/t/p/${TMDB_SIZE[size]}/`);
      return parsed.toString();
    }
  } catch {}
  return url;
}