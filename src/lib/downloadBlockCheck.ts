export type DownloadBlockState = "checking" | "clear" | "blocked" | "unavailable";
// Independent of the site switch and premium exemption. No ad scripts executed.
export async function checkDownloadBlocker(): Promise<DownloadBlockState> {
  if (!navigator.onLine) return "unavailable";
  const bait = document.createElement("div");
  bait.setAttribute("aria-hidden", "true");
  bait.style.cssText = "position:absolute;left:-9999px;width:120px;height:60px;pointer-events:none";
  bait.innerHTML = '<div class="adsbox adsbygoogle ad-banner" style="width:120px;height:60px"></div>';
  document.body.appendChild(bait);
  const child = bait.firstElementChild;
  const hidden = child instanceof HTMLElement && (getComputedStyle(child).display === "none" || getComputedStyle(child).visibility === "hidden" || child.offsetHeight === 0);
  bait.remove();
  if (hidden) return "blocked";
  const probe = async (url: string) => {
    const abort = new AbortController();
    const timer = window.setTimeout(() => abort.abort(), 5000);
    try { const res = await fetch(url, { mode: "no-cors", cache: "no-store", signal: abort.signal }); await res.body?.cancel(); return true; }
    catch { return false; }
    finally { clearTimeout(timer); }
  };
  const [control, ...networks] = await Promise.all([
    probe("/favicon.ico"),
    probe("https://bauval.org/"),
    probe("https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"),
    probe("https://www.googletagservices.com/tag/js/gpt.js"),
  ]);
  // Fetch failure cannot distinguish DNS filtering from ISP/server failure.
  return control && networks.some(Boolean) ? "clear" : "unavailable";
}