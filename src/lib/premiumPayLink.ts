/**
 * Links from the Premium page into the profile's Premium screen.
 * "/profile?pay=<methodId>" opens that payment method, "/profile?pay=redeem" the redeem-code tab.
 */
export type PremiumPayTab = string;

export const premiumPayPath = (tab: PremiumPayTab) => `/profile?pay=${encodeURIComponent(tab)}`;

const KNOWN = /^(redeem|bkash|nagad|binance|pm-[a-z0-9-]{2,40})$/;

/** The tab asked for by the current address, or null when the address asks for none. */
export function readPremiumPayTab(search: string): PremiumPayTab | null {
  const v = new URLSearchParams(search).get("pay");
  return v && KNOWN.test(v) ? v : null;
}

/** Drops ?pay= from the address bar without touching the router's history entry. */
export function clearPremiumPayParam() {
  try {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("pay")) return;
    params.delete("pay");
    const q = params.toString();
    window.history.replaceState(window.history.state, "", window.location.pathname + (q ? `?${q}` : "") + window.location.hash);
  } catch { /* ignore */ }
}
