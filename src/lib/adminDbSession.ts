// Admin database session — the user lists (users / appUsers) are locked by the
// database rules; only a session opened by the email Worker after a correct
// admin PIN or a Google admin sign-in can read them. PIN admins are signed in
// with a throw-away account the Worker creates (nothing to set up by hand).
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { auth, db, get, limitToLast, query, ref } from "@/lib/firebase";
import { openAdminSession } from "@/lib/emailService";

const TEMP_DOMAIN = "@admin-session.rsanime03.app";
export const isTempAdminUser = () => !!auth.currentUser?.email?.endsWith(TEMP_DOMAIN);

/** Opens a session with the PIN or the signed-in Google admin. */
export async function startAdminDbSession(cred: { pin?: string; idToken?: string }): Promise<void> {
  const d = await openAdminSession(cred);
  if (d.email && d.password) await signInWithEmailAndPassword(auth, d.email, d.password);
}

/** True when this browser can read the locked user lists right now. */
export async function adminDbReady(): Promise<boolean> {
  try { await auth.authStateReady(); } catch {}
  try { await get(query(ref(db, "appUsers"), limitToLast(1))); return true; } catch { return false; }
}

/**
 * Makes sure the admin page can read the user lists: reuses a live session,
 * otherwise renews it with the PIN of this tab or the Google admin sign-in.
 * "relogin" = nothing to renew with (the admin must enter the PIN again).
 */
export async function ensureAdminDbSession(): Promise<"ready" | "relogin" | "failed"> {
  if (await adminDbReady()) return "ready";
  let pin = "";
  try { pin = sessionStorage.getItem("rs_admin_pin") || ""; } catch {}
  const google = auth.currentUser && !isTempAdminUser() ? auth.currentUser : null;
  if (!pin && !google) return "relogin";
  try {
    await startAdminDbSession(pin ? { pin } : { idToken: await google!.getIdToken() });
  } catch { return "failed"; }
  return (await adminDbReady()) ? "ready" : "failed";
}

export async function endAdminDbSession(): Promise<void> {
  if (isTempAdminUser()) { try { await signOut(auth); } catch {} }
}
