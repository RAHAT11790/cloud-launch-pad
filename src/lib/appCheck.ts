import type { FirebaseApp } from "firebase/app";
import { initializeAppCheck, getToken, ReCaptchaV3Provider, type AppCheck } from "firebase/app-check";

/**
 * Firebase App Check: proves each database request comes from the real
 * RS ANIME03 website (reCAPTCHA v3, bound to the registered domains).
 * Off until a public reCAPTCHA v3 site key is set; the SDK socket attaches the
 * token automatically and REST calls add it via `appCheckHeaders()`.
 */
export const APP_CHECK_SITE_KEY: string = String(import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY || "").trim();

let instance: AppCheck | null = null;

export function startAppCheck(app: FirebaseApp): AppCheck | null {
  if (instance || !APP_CHECK_SITE_KEY || typeof window === "undefined") return instance;
  const g = globalThis as { __rs_app_check__?: AppCheck };
  if (g.__rs_app_check__) return (instance = g.__rs_app_check__);
  try {
    instance = initializeAppCheck(app, { provider: new ReCaptchaV3Provider(APP_CHECK_SITE_KEY), isTokenAutoRefreshEnabled: true });
    g.__rs_app_check__ = instance;
  } catch (err) {
    console.warn("App Check could not start", err);
  }
  return instance;
}

/** Header for raw REST calls; empty when App Check is off or the token is unavailable. */
export async function appCheckHeaders(): Promise<Record<string, string>> {
  if (!instance) return {};
  try {
    const { token } = await getToken(instance, false);
    return token ? { "X-Firebase-AppCheck": token } : {};
  } catch {
    return {};
  }
}
