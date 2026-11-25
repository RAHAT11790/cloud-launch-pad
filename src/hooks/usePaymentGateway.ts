import { useEffect, useMemo, useState } from "react";
import { firebaseRestGet } from "@/lib/firebaseRest";
import { normalizeGateway, readCachedGateway, writeCachedGateway, type PaymentGatewayConfig } from "@/lib/paymentGateway";

const LEGACY_KEY = "rs_bkash_settings_cache_v1";
const readLegacy = () => { try { return JSON.parse(localStorage.getItem(LEGACY_KEY) || "null"); } catch { return null; } };

/** Gateway config + shared plans, painted from the device cache and refreshed from Firebase. */
export function usePaymentGateway(): { config: PaymentGatewayConfig; plans: any[]; legacy: any; loaded: boolean } {
  const [raw, setRaw] = useState<any>(() => readCachedGateway());
  const [legacy, setLegacy] = useState<any>(() => readLegacy());
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let off = false;
    Promise.all([
      firebaseRestGet<any>("settings/paymentGateway").catch(() => undefined),
      firebaseRestGet<any>("bkashSettings").catch(() => undefined),
    ]).then(([g, b]) => {
      if (off) return;
      if (g !== undefined) { setRaw(g); writeCachedGateway(g); }
      if (b !== undefined) { setLegacy(b); try { localStorage.setItem(LEGACY_KEY, JSON.stringify(b)); } catch {} }
      setLoaded(true);
    });
    return () => { off = true; };
  }, []);
  const config = useMemo(() => normalizeGateway(raw, legacy), [raw, legacy]);
  const plans = useMemo(() => (legacy?.plans || []).filter((p: any) => p && p.active !== false), [legacy]);
  return { config, plans, legacy, loaded };
}
