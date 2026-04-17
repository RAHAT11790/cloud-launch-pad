import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initMonetag } from "@/lib/monetagAds";

// Apply saved theme before render to prevent flash
const savedTheme = localStorage.getItem("rs_theme");
if (savedTheme === "dark" || (!savedTheme && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
  document.documentElement.classList.add("dark");
}

createRoot(document.getElementById("root")!).render(<App />);

// Initialize Monetag ads after first paint (premium users auto-skip inside).
// Re-runs on auth/premium status change via storage event from login/logout flows.
const bootMonetag = () => {
  try { initMonetag(); } catch {}
};
if (typeof window !== "undefined") {
  if (document.readyState === "complete") setTimeout(bootMonetag, 1500);
  else window.addEventListener("load", () => setTimeout(bootMonetag, 1500), { once: true });
  window.addEventListener("storage", (e) => {
    if (e.key === "rsanime_user") bootMonetag();
  });
}
