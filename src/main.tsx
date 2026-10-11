import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "@fontsource/sora/600.css";
import "@fontsource/sora/700.css";
import "@fontsource/manrope/400.css";
import "@fontsource/manrope/500.css";
import "@fontsource/manrope/600.css";
import { setupTvNavigation } from "@/hooks/useTvNavigation";

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
    const androidTvLike = /Android/i.test(ua)
      && !/Mobile/i.test(ua)
      && Math.max(window.screen?.width || 0, window.innerWidth) >= 960
      && window.innerWidth > window.innerHeight;
    const isTv =
      /Android TV|GoogleTV|SMART-TV|SmartTV|Tizen|Web0S|WebOS|HbbTV|NetCast|AppleTV|BRAVIA|AFT[A-Z]/i.test(ua) ||
      androidTvLike ||
      // Big-screen heuristic: very wide + coarse pointer (typical TV WebView)
      (window.matchMedia("(pointer: coarse)").matches && window.innerWidth >= 1280 && !/Mobile/i.test(ua));
    if (isTv) document.documentElement.classList.add("tv-mode");
  } catch {}
})();

setupTvNavigation();

createRoot(document.getElementById("root")!).render(<App />);
