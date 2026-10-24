export type BrowserIdentity = { name: string; version: string; supported: boolean };
export function detectBrowser(ua: string, brave = false): BrowserIdentity {
  const browsers: [string, RegExp][] = [
    ["Brave", /(?:Chrome|CriOS)\/([\d.]+)/],
    ["Microsoft Edge", /(?:EdgA|EdgiOS|Edg)\/([\d.]+)/],
    ["Opera", /(?:OPR|OPiOS)\/([\d.]+)/],
    ["Samsung Internet", /SamsungBrowser\/([\d.]+)/],
    ["Firefox", /(?:Firefox|FxiOS)\/([\d.]+)/],
    ["Chromium", /Chromium\/([\d.]+)/],
    ["In-app browser", /(?:FBAV|Instagram|Version)\/([\d.]+).*;?\s*wv\b/],
    ["Google Chrome", /(?:Chrome|CriOS)\/([\d.]+)/],
    ["Safari", /Version\/([\d.]+).*Safari/],
  ];
  if (/;\s*wv\)/.test(ua) || /FBAN|FBAV|Instagram|Telegram/i.test(ua)) return { name: "In-app browser", version: ua.match(/(?:Chrome|Version)\/([\d.]+)/)?.[1] || "Unknown", supported: false };
  for (const [name, pattern] of browsers) {
    if (name === "Brave" && !brave) continue;
    const match = ua.match(pattern);
    if (match) return { name, version: match[1], supported: name === "Google Chrome" };
  }
  return { name: "Unknown browser", version: "Unknown", supported: false };
}
export function chromeLaunchUrl(url: string, ua: string): string {
  const parsed = new URL(url);
  if (/Android/i.test(ua)) return `intent://${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}#Intent;scheme=${parsed.protocol.slice(0, -1)};package=com.android.chrome;end`;
  return `${parsed.protocol === "https:" ? "googlechromes" : "googlechrome"}://${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`;
}