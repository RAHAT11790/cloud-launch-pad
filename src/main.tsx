import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { ensureGuestUser, runResetRulesIfDue } from "@/lib/guestSession";

try {
  const url = new URL(window.location.href);
  const animeId = url.searchParams.get("anime")?.trim();
  if (url.pathname === "/" && animeId) {
    sessionStorage.setItem("rs_directWatchShare", animeId);
    window.history.replaceState({}, "", `/watch/${encodeURIComponent(animeId)}`);
  } else if (url.pathname.startsWith("/anime/")) {
    const routeAnimeId = decodeURIComponent(url.pathname.split("/anime/")[1]?.split("/")[0] || "").trim();
    if (routeAnimeId) {
      sessionStorage.setItem("rs_directWatchShare", routeAnimeId);
      window.history.replaceState({}, "", `/watch/${encodeURIComponent(routeAnimeId)}${url.search}`);
    }
  }
} catch {}

// Bootstrap guest session on app start (RS parity)
try { ensureGuestUser(); } catch {}
// Run periodic trim (history weekly, watchlist monthly) — fire-and-forget
try { runResetRulesIfDue(); } catch {}

// Theme
const savedTheme = localStorage.getItem("rs_theme");
if (savedTheme === "dark" || (!savedTheme && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
  document.documentElement.classList.add("dark");
}

// Android TV / large-screen TV detection — adds .tv-mode to kill animations
// and enable focus rings for D-pad remote navigation.
(function detectTv() {
  try {
    const ua = navigator.userAgent || "";
    const isTv =
      /Android TV|GoogleTV|SMART-TV|SmartTV|Tizen|Web0S|WebOS|HbbTV|NetCast|AppleTV|BRAVIA|AFT[A-Z]/i.test(ua) ||
      // Big-screen heuristic: very wide + coarse pointer (typical TV WebView)
      (window.matchMedia("(pointer: coarse)").matches && window.innerWidth >= 1280 && !/Mobile/i.test(ua));
    if (isTv) document.documentElement.classList.add("tv-mode");
  } catch {}
})();

createRoot(document.getElementById("root")!).render(<App />);
