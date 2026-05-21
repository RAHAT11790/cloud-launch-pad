const normalize = (value?: string | null) => String(value || "").trim();

export const isHttpsDownloadableUrl = (value?: string | null) => {
  const url = normalize(value).toLowerCase();
  if (!url.startsWith("https://")) return false;
  if (url.includes(".m3u8") || url.includes(".mpd")) return false;
  if (url.includes("/embed/") || url.includes("iframe")) return false;
  return true;
};

export const pickHttpsDownloadUrl = (preferred?: string | null, fallbacks: Array<string | null | undefined> = []) => {
  const candidates = [preferred, ...fallbacks].map(normalize).filter(Boolean);
  return candidates.find((url) => isHttpsDownloadableUrl(url)) || "";
};