/**
 * Where Google sign-in finishes — one place decides it.
 *
 * Firebase's own sign-in page (`*.firebaseapp.com`) hands the result to the site
 * through a hidden frame. Phone browsers and the installed app split that
 * frame's storage from the sign-in page, so the result is lost: the visitor
 * picks an account, lands back on the site and is not signed in.
 *
 * When the domain checker on the email server has confirmed that this address
 * serves Firebase's helper at `/__/auth/` and that Google accepts
 * `https://<this address>/__/auth/handler` as a return address, sign-in runs on
 * the site's own address (same storage, nothing to lose). Phones and the
 * installed app then use a full-page sign-in, computers keep the small window.
 * Until then the old Firebase page is used, exactly as before.
 *
 * Must not import Firebase: `firebase.ts` reads it while starting.
 */
import { isPreviewHost, readCachedSiteDomain, type SiteDomainState } from "@/lib/siteDomain";

export const FIREBASE_AUTH_HOST = "animeverse-d7b79.firebaseapp.com";

/** True when the server confirmed Google sign-in can return to `host` itself. */
export function googleReturnsHere(host: string, state: SiteDomainState | null): boolean {
  const h = String(host || "").toLowerCase();
  if (!h || isPreviewHost(h) || !state) return false;
  return Object.values(state.hosts).some((x) => x.host === h && x.serving && x.google === true);
}

/** The auth domain Firebase starts with on this page. */
export function pickAuthDomain(fallback: string = FIREBASE_AUTH_HOST): string {
  if (typeof window === "undefined" || window.location.protocol !== "https:") return fallback;
  const host = window.location.hostname;
  return googleReturnsHere(host, readCachedSiteDomain()) ? host : fallback;
}

/** Phones, tablets and the installed app (popups there lose the result or never open). */
export function prefersFullPageSignIn(ua: string, standalone: boolean): boolean {
  return standalone || /Android|iPhone|iPad|iPod|Mobile|Opera Mini|IEMobile/i.test(ua);
}

export type GoogleSignInMode = "popup" | "redirect" | "reload";

/**
 * popup    — small Google window (computers, or before this address is ready).
 * redirect — full-page sign-in on this address (phones / installed app).
 * reload   — this address just became ready but Firebase started with the old
 *            page; reload once so it starts on this address, then continue.
 */
export function googleSignInMode(opts: { host: string; authDomain: string; state: SiteDomainState | null; ua: string; standalone: boolean }): GoogleSignInMode {
  const ready = googleReturnsHere(opts.host, opts.state);
  if (!ready || !prefersFullPageSignIn(opts.ua, opts.standalone)) return "popup";
  return opts.authDomain.toLowerCase() === opts.host.toLowerCase() ? "redirect" : "reload";
}

const REDIRECT_KEY = "rs_google_redirect";
const AUTOSTART_KEY = "rs_google_autostart";
const ss = () => { try { return window.sessionStorage; } catch { return null; } };

/** Remember a full-page sign-in is under way (the sign-in screen reopens on return). */
export function markGoogleRedirect() { ss()?.setItem(REDIRECT_KEY, String(Date.now())); }
/** A full-page sign-in started in the last 10 minutes and has not been read yet. */
export function googleRedirectPending(now = Date.now()): boolean {
  const at = Number(ss()?.getItem(REDIRECT_KEY) || 0);
  return at > 0 && now - at < 10 * 60_000;
}
export function clearGoogleRedirect() { ss()?.removeItem(REDIRECT_KEY); }
/** After the one-time reload, start Google sign-in again by itself. */
export function markGoogleAutoStart() { ss()?.setItem(AUTOSTART_KEY, String(Date.now())); }
export function googleAutoStartPending(now = Date.now()): boolean {
  const at = Number(ss()?.getItem(AUTOSTART_KEY) || 0);
  return at > 0 && now - at < 60_000;
}
export function takeGoogleAutoStart(now = Date.now()): boolean {
  const at = Number(ss()?.getItem(AUTOSTART_KEY) || 0);
  ss()?.removeItem(AUTOSTART_KEY);
  return at > 0 && now - at < 60_000;
}
