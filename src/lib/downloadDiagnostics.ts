/** Accepts only plain HTTP/HTTPS server URLs (no scripts, no embedded credentials). */
export function validDownloadUrl(raw: string) {
  try {
    const url = new URL(raw.trim());
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.toString() : "";
  } catch { return ""; }
}
