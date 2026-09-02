// ============================================================
// RS Anime — site-wide Ad-Block gate watcher
// Mounted once inside the Router. Pushes the user to the gate page the
// moment a blocker / DNS filter is proven, and releases them when clean.
// Premium members are fully exempt — they are never checked or gated.
// ============================================================
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { usePremium } from "@/hooks/usePremium";
import {
  GATE_PATH,
  CLEARED_PATH,
  isExemptPath,
  rememberReturnPath,
  runGateCheck,
  setGatePremiumExempt,
  startAdBlockGate,
  subscribeGate,
} from "@/lib/adBlockGate";

const AdBlockGateWatcher = () => {
  const nav = useNavigate();
  const loc = useLocation();
  const { isPremium } = usePremium();

  // Keep the engine in sync with premium status before anything else runs.
  useEffect(() => {
    setGatePremiumExempt(!!isPremium);
    if (isPremium && (loc.pathname === GATE_PATH || loc.pathname === CLEARED_PATH)) {
      nav("/", { replace: true });
    }
  }, [isPremium, loc.pathname, nav]);

  useEffect(() => { startAdBlockGate(); }, []);

  // Re-verify on every route change.
  useEffect(() => {
    if (isPremium) return;
    if (isExemptPath(loc.pathname)) return;
    rememberReturnPath(loc.pathname + loc.search);
    void runGateCheck();
  }, [loc.pathname, loc.search, isPremium]);

  useEffect(() => {
    const off = subscribeGate((s) => {
      if (isPremium) return;
      const path = window.location.pathname;
      if (s.blocked && !isExemptPath(path) && path !== GATE_PATH && path !== CLEARED_PATH) {
        rememberReturnPath(path + window.location.search);
        nav(GATE_PATH, { replace: true });
      }
    });
    return () => { off(); };
  }, [nav, isPremium]);

  return null;
};

export default AdBlockGateWatcher;
