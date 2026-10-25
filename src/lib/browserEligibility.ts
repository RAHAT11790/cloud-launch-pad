export type BrowserIdentity = { name: string; version: string; supported: boolean };
/**
 * `brands` = navigator.userAgentData brands. `undefined` skips the brand check (legacy callers),
 * `null` means the browser has no userAgentData at all (every real desktop/Android Chrome has it).
 * Chromium forks (Booyah, Opera, Edge, Brave, Mi, etc.) copy Chrome's user agent but cannot claim
 * the "Google Chrome" brand, so the check is instant and synchronous.
 */
export type BrowserSignals = { brave?: boolean; brands?: string[] | null };
const GENERIC_BRAND = /not.?a.?brand|chromium/i;
export function detectBrowser(ua: string, signals: boolean | BrowserSignals = {}): BrowserIdentity {
  const { brave = false, brands } = typeof signals === "boolean" ? { brave: signals } : signals;
  const browsers: [string, RegExp][] = [
    ["Microsoft Edge", /(?:EdgA|EdgiOS|Edg)\/([\d.]+)/],
    ["Opera", /(?:OPR|OPiOS|OPT)\/([\d.]+)/],
    ["Samsung Internet", /SamsungBrowser\/([\d.]+)/],
    ["Firefox", /(?:Firefox|FxiOS)\/([\d.]+)/],
    ["Yandex Browser", /YaBrowser\/([\d.]+)/],
    ["UC Browser", /UCBrowser\/([\d.]+)/],
    ["Mi Browser", /(?:MiuiBrowser|XiaoMi)\/([\d.]+)/],
    ["Vivaldi", /Vivaldi\/([\d.]+)/],
    ["DuckDuckGo", /(?:DuckDuckGo|Ddg)\/([\d.]+)/],
    ["Booyah Browser", /(?:Booyah|BYBrowser)\/?([\d.]*)/i],
    ["Chromium", /Chromium\/([\d.]+)/],
    ["Google Chrome", /(?:Chrome|CriOS)\/([\d.]+)/],
    ["Safari", /Version\/([\d.]+).*Safari/],
  ];
  const chromeVersion = ua.match(/(?:Chrome|CriOS|Version)\/([\d.]+)/)?.[1] || "Unknown";
  if (/;\s*wv\)/.test(ua) || /FBAN|FBAV|Instagram|Telegram|Line\//i.test(ua)) return { name: "In-app browser", version: chromeVersion, supported: false };
  if (brave) return { name: "Brave", version: chromeVersion, supported: false };
  for (const [name, pattern] of browsers) {
    const match = ua.match(pattern);
    if (!match) continue;
    if (name !== "Google Chrome") return { name, version: match[1] || chromeVersion, supported: false };
    // Chrome on iPhone/iPad has no userAgentData; everywhere else the brand must say Google Chrome.
    if (/CriOS\//.test(ua) || brands === undefined) return { name, version: match[1], supported: true };
    if (brands === null) return { name: "Chromium-based browser", version: match[1], supported: false };
    if (brands.includes("Google Chrome")) return { name, version: match[1], supported: true };
    const other = brands.find(b => !GENERIC_BRAND.test(b));
    return { name: other || "Chromium-based browser", version: match[1], supported: false };
  }
  return { name: "Unknown browser", version: "Unknown", supported: false };
}
export function browserBrands(nav: Navigator): string[] | null {
  const data = (nav as Navigator & { userAgentData?: { brands?: { brand: string }[] } }).userAgentData;
  return Array.isArray(data?.brands) ? data.brands.map(b => b.brand) : null;
}
/** The admin panel (also opened from the Telegram mini app) is never browser-gated. */
export function browserGateApplies(pathname: string) {
  return !/^\/admin(?:\/|$)/.test(pathname);
}
export function chromeLaunchUrl(url: string, ua: string): string {
  const parsed = new URL(url);
  if (/Android/i.test(ua)) return `intent://${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}#Intent;scheme=${parsed.protocol.slice(0, -1)};package=com.android.chrome;end`;
  return `${parsed.protocol === "https:" ? "googlechromes" : "googlechrome"}://${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`;
}
