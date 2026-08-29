// ============================================================
// RS Anime — site-wide Ad-Block gate watcher
// Mounted once inside the Router. Pushes the user to the gate page the
// moment a blocker / DNS filter is proven, and releases them when clean.
// ============================================================
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  GATE_PATH,
  CLEARED_PATH,
  isExemptPath,
  rememberReturnPath,
  runGateCheck,
  startAdBlockGate,
  subscribeGate,
} from "@/lib/adBlockGate";

const AdBlockGateWatcher = () => {
  const nav = useNavigate();
  const loc = useLocation();

  useEffect(() => { startAdBlockGate(); }, []);

  // Re-verify on every route change.
  useEffect(() => {
    if (isExemptPath(loc.pathname)) return;
    rememberReturnPath(loc.pathname + loc.search);
    void runGateCheck();
  }, [loc.pathname, loc.search]);

  useEffect(() => {
    const off = subscribeGate((s) => {
      const path = window.location.pathname;
      if (s.blocked && !isExemptPath(path) && path !== GATE_PATH && path !== CLEARED_PATH) {
        rememberReturnPath(path + window.location.search);
        nav(GATE_PATH, { replace: true });
      }
    });
    return () => { off(); };
  }, [nav]);

  return null;
};

export default AdBlockGateWatcher;
