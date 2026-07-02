import { useEffect, useState } from "react";
import { db, ref, onValue } from "@/lib/firebase";
import { getLocalUserId } from "@/lib/unlockAccess";
import {
  DEFAULT_PREMIUM_SETTINGS,
  isPremiumActive,
  PremiumGlobalSettings,
  PremiumStatus,
  subscribePremiumSettings,
  ensureGuestUser,
} from "@/lib/premiumAccess";

export interface CoinWallet {
  coins: number;
  adWatchLog: Record<string, { count: number; adIds: Record<string, number> }>;
}

const EMPTY_WALLET: CoinWallet = { coins: 0, adWatchLog: {} };

export function usePremium() {
  const [uid, setUid] = useState<string | null>(() => ensureGuestUser());
  const [status, setStatus] = useState<PremiumStatus | null>(null);
  const [wallet, setWallet] = useState<CoinWallet>(EMPTY_WALLET);
  const [settings, setSettings] = useState<PremiumGlobalSettings>(DEFAULT_PREMIUM_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const check = () => setUid(getLocalUserId() || ensureGuestUser());
    window.addEventListener("storage", check);
    window.addEventListener("rs_auth_changed", check);
    const iv = window.setInterval(check, 2500);
    return () => {
      window.removeEventListener("storage", check);
      window.removeEventListener("rs_auth_changed", check);
      window.clearInterval(iv);
    };
  }, []);

  useEffect(() => {
    const unsub = subscribePremiumSettings(setSettings);
    return unsub;
  }, []);

  useEffect(() => {
    if (!uid) {
      setStatus(null);
      setWallet(EMPTY_WALLET);
      setLoaded(true);
      return;
    }
    const u1 = onValue(ref(db, `users/${uid}/premium`), (snap) => {
      setStatus((snap.val() as PremiumStatus) || null);
      setLoaded(true);
    });
    const u2 = onValue(ref(db, `users/${uid}/coinWallet`), (snap) => {
      const v = snap.val() || {};
      setWallet({ coins: v.coins || 0, adWatchLog: v.adWatchLog || {} });
    });
    return () => { u1(); u2(); };
  }, [uid]);

  return {
    uid,
    isPremium: isPremiumActive(status),
    status,
    wallet,
    settings,
    loaded,
  };
}
