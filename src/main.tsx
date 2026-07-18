import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
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
    const isTv =
      /Android TV|GoogleTV|SMART-TV|SmartTV|Tizen|Web0S|WebOS|HbbTV|NetCast|AppleTV|BRAVIA|AFT[A-Z]|Chromecast|CrKey|PhilipsTV|VIDAA|HisenseTV|Roku|PlayStation|Xbox|Nintendo/i.test(ua) ||
      // Big-screen heuristic: very wide + coarse pointer (typical TV WebView)
      (window.matchMedia("(pointer: coarse)").matches && window.innerWidth >= 1280 && !/Mobile/i.test(ua)) ||
      // Non-mobile UA with a large screen — desktop browsers on TVs / STBs
      (!/Mobile|Android(?!.*TV)/i.test(ua) && Math.max(window.innerWidth, window.screen?.width || 0) >= 1280);
    if (isTv) {
      document.documentElement.classList.add("tv-mode");
      // Force desktop-site rendering on TVs: many TV browsers request the
      // mobile layout because their device-width reports small. Pin the
      // viewport to a desktop width so our desktop CSS breakpoints kick in.
      try {
        let vp = document.querySelector('meta[name="viewport"]') as HTMLMetaElement | null;
        if (!vp) {
          vp = document.createElement("meta");
          vp.name = "viewport";
          document.head.appendChild(vp);
        }
        vp.setAttribute("content", "width=1280, initial-scale=1, viewport-fit=cover");
      } catch {}
    }
  } catch {}
})();

setupTvNavigation();

createRoot(document.getElementById("root")!).render(<App />);
