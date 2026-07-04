import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

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
