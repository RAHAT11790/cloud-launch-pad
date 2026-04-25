// Utility: open a URL in the user's real external browser (Chrome/Safari)
// instead of letting it stay inside Telegram's in-app WebView.
//
// Detection rules:
// - If the page is running inside Telegram WebApp (window.Telegram.WebApp) OR
//   the User-Agent contains "Telegram", we treat it as Telegram WebView.
// - In that case we call Telegram.WebApp.openLink(url, { try_instant_view:false })
//   which Telegram routes to the system browser.
// - On Android we additionally try an `intent://` URL as a fallback so the link
//   forcibly leaves Telegram's WebView even on older Telegram clients.
// - From a real Chrome/Safari tab we just navigate normally.

export function isInTelegramWebView(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const w: any = window;
    if (w.Telegram?.WebApp?.initData !== undefined) return true;
    const ua = navigator.userAgent || "";
    if (/Telegram/i.test(ua)) return true;
  } catch {}
  return false;
}

export function openExternalBrowser(url: string): void {
  if (!url) return;
  if (typeof window === "undefined") return;

  const w: any = window;
  const tg = w.Telegram?.WebApp;

  if (isInTelegramWebView()) {
    // Preferred: Telegram's own API to open link in the system browser
    try {
      if (tg?.openLink) {
        tg.openLink(url, { try_instant_view: false });
        return;
      }
    } catch {}

    // Android fallback: intent:// forces external browser
    try {
      const ua = navigator.userAgent || "";
      if (/Android/i.test(ua)) {
        const httpsUrl = url.replace(/^https?:\/\//, "");
        const intentUrl =
          `intent://${httpsUrl}#Intent;scheme=https;package=com.android.chrome;` +
          `S.browser_fallback_url=${encodeURIComponent(url)};end`;
        window.location.href = intentUrl;
        return;
      }
    } catch {}
  }

  // Default: normal Chrome/Safari navigation
  window.location.href = url;
}
