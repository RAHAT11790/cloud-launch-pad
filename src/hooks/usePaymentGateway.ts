import { useEffect, useMemo, useState } from "react";
import { db, ref, onValue } from "@/lib/firebase";
import { normalizeGateway, readCachedGateway, writeCachedGateway, type PaymentGatewayConfig } from "@/lib/paymentGateway";

const LEGACY_KEY = "rs_bkash_settings_cache_v1";
const readLegacy = () => { try { return JSON.parse(localStorage.getItem(LEGACY_KEY) || "null"); } catch { return null; } };

/** Small live settings keep mounted Profile and purchase screens in sync after admin saves. */
export function usePaymentGateway(): { config: PaymentGatewayConfig; plans: any[]; legacy: any; loaded: boolean } {
  const [raw, setRaw] = useState<any>(() => readCachedGateway());
  const [legacy, setLegacy] = useState<any>(() => readLegacy());
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const gatewayOff = onValue(ref(db, "settings/paymentGateway"), (snapshot) => {
      const g = snapshot.val();
      setRaw(g); writeCachedGateway(g); setLoaded(true);
    }, () => setLoaded(true));
    const legacyOff = onValue(ref(db, "bkashSettings"), (snapshot) => {
      const b = snapshot.val();
      setLegacy(b);
      try { localStorage.setItem(LEGACY_KEY, JSON.stringify(b)); } catch { /* full */ }
    });
    return () => { gatewayOff(); legacyOff(); };
  }, []);
  const config = useMemo(() => normalizeGateway(raw, legacy), [raw, legacy]);
  const plans = useMemo(() => Object.values(legacy?.plans || {}).filter((p: any) => p && p.active !== false), [legacy]);
  return { config, plans, legacy, loaded };
}
