// Reload the site the moment Premium switches on in this session, so every ad tag
// already mounted in the page (pop-under listeners, social bar) is destroyed.
import { useEffect } from "react";
import { db, ref, onValue } from "@/lib/firebase";
import { getLocalUserId } from "@/lib/unlockAccess";
import { isPremiumActive, type PremiumStatus } from "@/lib/premiumAccess";
import { toast } from "sonner";

export const PREMIUM_RELOAD_FLAG = "rs_premium_just_activated";

/** Pure decision: reload only on a real inactive → active change seen in this session. */
export function shouldReloadForPremium(baseline: boolean | null, nextActive: boolean) {
  return baseline === false && nextActive;
}

export function usePremiumActivationReload() {
  useEffect(() => {
    try {
      if (sessionStorage.getItem(PREMIUM_RELOAD_FLAG) === "1") {
        sessionStorage.removeItem(PREMIUM_RELOAD_FLAG);
        window.setTimeout(() => toast.success("Premium is active — ads are now off"), 600);
      }
    } catch {}

    let uid = getLocalUserId();
    let baseline: boolean | null = null;
    let unsub: (() => void) | null = null;
    let reloading = false;
    const watch = () => {
      unsub?.(); unsub = null; baseline = null;
      if (!uid) return;
      unsub = onValue(ref(db, `users/${uid}/premium`), snap => {
        const active = isPremiumActive(snap.val() as PremiumStatus | null);
        if (reloading) return;
        if (shouldReloadForPremium(baseline, active)) {
          reloading = true;
          try { sessionStorage.setItem(PREMIUM_RELOAD_FLAG, "1"); } catch {}
          window.setTimeout(() => window.location.reload(), 900);
          return;
        }
        baseline = active;
      }, () => {});
    };
    watch();
    // A different account (login / logout) starts a fresh baseline — no reload for that.
    const onAuth = () => { const next = getLocalUserId(); if (next !== uid) { uid = next; watch(); } };
    window.addEventListener("rs_auth_changed", onAuth);
    window.addEventListener("storage", onAuth);
    const iv = window.setInterval(onAuth, 3000);
    return () => { unsub?.(); window.removeEventListener("rs_auth_changed", onAuth); window.removeEventListener("storage", onAuth); window.clearInterval(iv); };
  }, []);
}

export function PremiumActivationReload() {
  usePremiumActivationReload();
  return null;
}
