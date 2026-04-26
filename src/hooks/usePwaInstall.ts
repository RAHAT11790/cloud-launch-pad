// =====================================================================
// usePwaInstall — captures Chrome's beforeinstallprompt event so we can
// trigger a real "Add to Home screen / Install app" prompt from a button.
//
// Behavior:
//  • Listens once globally for `beforeinstallprompt` and stashes it.
//  • Returns { canInstall, isStandalone, promptInstall }.
//  • promptInstall() shows the native dialog when available; otherwise
//    falls back to instructions for iOS / unsupported browsers.
// =====================================================================
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";

type BIPEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let cachedPrompt: BIPEvent | null = null;
const listeners = new Set<(e: BIPEvent | null) => void>();

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    cachedPrompt = e as BIPEvent;
    listeners.forEach((l) => l(cachedPrompt));
  });
  window.addEventListener("appinstalled", () => {
    cachedPrompt = null;
    listeners.forEach((l) => l(null));
  });
}

export function usePwaInstall() {
  const [prompt, setPrompt] = useState<BIPEvent | null>(cachedPrompt);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    const update = (e: BIPEvent | null) => setPrompt(e);
    listeners.add(update);
    setPrompt(cachedPrompt);

    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      // iOS Safari
      (window.navigator as any).standalone === true;
    setIsStandalone(!!standalone);

    return () => { listeners.delete(update); };
  }, []);

  const promptInstall = useCallback(async () => {
    if (isStandalone) {
      toast.success("App is already installed");
      return;
    }
    if (prompt) {
      try {
        await prompt.prompt();
        const choice = await prompt.userChoice;
        if (choice.outcome === "accepted") {
          toast.success("Installing app…");
        }
        cachedPrompt = null;
        setPrompt(null);
        return;
      } catch (e: any) {
        toast.error(`Install failed: ${e?.message || "unknown"}`);
        return;
      }
    }
    // Fallback messaging
    const ua = navigator.userAgent || "";
    const isIOS = /iPhone|iPad|iPod/i.test(ua);
    if (isIOS) {
      toast.info("Tap the Share icon, then 'Add to Home Screen'");
    } else {
      toast.info("Open Chrome menu (⋮) and tap 'Add to Home screen' / 'Install app'");
    }
  }, [prompt, isStandalone]);

  return {
    canInstall: !!prompt,
    isStandalone,
    promptInstall,
  };
}
