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
import { SITE_URL } from "@/lib/siteConfig";

type BIPEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

interface UsePwaInstallOptions {
  appName?: string;
  installPath?: string;
}

let cachedPrompt: BIPEvent | null = null;
const listeners = new Set<(e: BIPEvent | null) => void>();
let swRegistrationStarted = false;

const shouldSkipInstallWorker = () => {
  if (typeof window === "undefined") return true;

  const host = window.location.hostname;
  const isPreviewHost =
    host.includes("id-preview--") || host.includes("lovableproject.com");

  try {
    if (window.self !== window.top) return true;
  } catch {
    return true;
  }

  return isPreviewHost;
};

const isInIframe = () => {
  if (typeof window === "undefined") return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
};

const isPreviewHost = () => {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return host.includes("id-preview--") || host.includes("lovableproject.com");
};

const ensureInstallWorker = async () => {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  if (swRegistrationStarted || shouldSkipInstallWorker()) return;

  swRegistrationStarted = true;

  try {
    await navigator.serviceWorker.register("/firebase-messaging-sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
    await navigator.serviceWorker.ready;
  } catch {
    swRegistrationStarted = false;
  }
};

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

export function usePwaInstall(options: UsePwaInstallOptions = {}) {
  const { appName = "app", installPath = "/app" } = options;
  const [prompt, setPrompt] = useState<BIPEvent | null>(cachedPrompt);
  const [isStandalone, setIsStandalone] = useState(false);

  const runInstallPrompt = useCallback(async (activePrompt: BIPEvent) => {
    try {
      await activePrompt.prompt();
      const choice = await activePrompt.userChoice;
      if (choice.outcome === "accepted") {
        toast.success(`Installing ${appName}…`);
      }
      cachedPrompt = null;
      setPrompt(null);
      return true;
    } catch (e: any) {
      toast.error(`Install failed: ${e?.message || "unknown"}`);
      return false;
    }
  }, [appName]);

  useEffect(() => {
    ensureInstallWorker();

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

  useEffect(() => {
    if (typeof window === "undefined" || !prompt || isStandalone) return;

    const params = new URLSearchParams(window.location.search);
    if (params.get("install") !== "1") return;

    const timer = window.setTimeout(async () => {
      const ok = await runInstallPrompt(prompt);
      if (ok) {
        const nextUrl = `${window.location.pathname}${window.location.hash || ""}`;
        window.history.replaceState({}, "", nextUrl);
      }
    }, 300);

    return () => window.clearTimeout(timer);
  }, [prompt, isStandalone, runInstallPrompt]);

  const promptInstall = useCallback(async () => {
    if (isStandalone) {
      toast.success("App is already installed");
      return;
    }
    if (prompt) {
      const ok = await runInstallPrompt(prompt);
      if (ok) return;
    }

    const installUrl = `${SITE_URL}${installPath}?install=1`;
    if (isInIframe() || isPreviewHost()) {
      window.open(installUrl, "_blank", "noopener,noreferrer");
      toast.info(`Opening ${appName} install page in Chrome`);
      return;
    }

    if (!window.location.pathname.startsWith(installPath)) {
      window.location.assign(`${installPath}?install=1`);
      return;
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
