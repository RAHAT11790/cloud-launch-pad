// Native (in-app) Google sign-in for the RS ANIME03 Android app.
// The website keeps using the Firebase popup flow; inside the app a popup would
// bounce the user out to Chrome (blank page), so we use the native Google
// account sheet and exchange its ID token for a Firebase session.
import { GoogleAuthProvider, signInWithCredential, type UserCredential } from "firebase/auth";

import { auth } from "@/lib/firebase";
import { isNativeApp } from "@/lib/nativeRuntime";

// Firebase/Google "Web application" OAuth client of project animeverse-d7b79.
export const GOOGLE_WEB_CLIENT_ID =
  (import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID as string | undefined)
  || "1050779978318-vh13ch2c07oa1t8e7j4vcflagr07a2co.apps.googleusercontent.com";

let initialized: Promise<void> | null = null;

const loadPlugin = async () => {
  const mod = await import("@capgo/capacitor-social-login");
  return mod.SocialLogin;
};

const ensureInit = async () => {
  const plugin = await loadPlugin();
  if (!initialized) {
    initialized = plugin.initialize({ google: { webClientId: GOOGLE_WEB_CLIENT_ID } }).then(() => undefined);
  }
  await initialized;
  return plugin;
};

export const canUseNativeGoogleSignIn = () => isNativeApp();

/** Opens the native Google account picker and returns a Firebase credential. */
export const nativeGoogleSignIn = async (): Promise<UserCredential> => {
  const plugin = await ensureInit();
  const res: any = await plugin.login({ provider: "google", options: { scopes: ["email", "profile"] } });
  const idToken: string | undefined =
    res?.result?.idToken || res?.result?.credential?.idToken || res?.idToken;
  const accessToken: string | undefined =
    res?.result?.accessToken?.token || res?.result?.accessToken || undefined;
  if (!idToken) throw new Error("Google sign-in was cancelled");
  const credential = GoogleAuthProvider.credential(idToken, accessToken);
  return signInWithCredential(auth, credential);
};
