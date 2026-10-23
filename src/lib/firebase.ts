import { initializeApp } from "firebase/app";
import { getDatabase, ref, onValue as remoteOnValue, push as remotePush, set as remoteSet, remove as remoteRemove, update as remoteUpdate, query, orderByChild, orderByKey, equalTo, get as remoteGet, runTransaction as remoteTransaction, limitToLast, limitToFirst, startAfter, startAt, endAt, type DataSnapshot } from "firebase/database";
import { currentGuestId, localGuestPath, readGuestPath, writeGuestPath } from "@/lib/guestPersistence";
import { getAuth, signInWithEmailAndPassword, signOut, GoogleAuthProvider, signInWithPopup, sendPasswordResetEmail, confirmPasswordReset, updatePassword } from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyASjrQM27mfAbHXA9ZqYv3YbubZPUxOR50",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "animeverse-d7b79.firebaseapp.com",
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || "https://animeverse-d7b79-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "animeverse-d7b79",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "animeverse-d7b79.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "1050779978318",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:1050779978318:web:8bc00ed477bec7a14f511f",
  measurementId: "G-GWGVY15T2V"
};


// Guard against Vite HMR re-initializing the app on every hot update.
// A second `initializeApp` call with the same name tears down the existing
// WebSocket and forces every listener to reconnect — which is exactly what
// the user was seeing as "Firebase disconnect after update".
const globalKey = "__rs_firebase_app__";
const g = globalThis as any;
const app = g[globalKey] || (g[globalKey] = initializeApp(firebaseConfig));

export const db = g.__rs_firebase_db__ || (g.__rs_firebase_db__ = getDatabase(app));
export const auth = g.__rs_firebase_auth__ || (g.__rs_firebase_auth__ = getAuth(app));
export const googleProvider = new GoogleAuthProvider();

const referencePath = (target: Parameters<typeof remoteGet>[0]) => {
  try { return decodeURIComponent(new URL(target.toString()).pathname).replace(/^\/+|\/+$/g, ""); } catch { return ""; }
};
const useLocal = (path: string) => localGuestPath(path, currentGuestId());
function localSnapshot(target: Parameters<typeof remoteGet>[0]): DataSnapshot {
  const path = referencePath(target);
  const value = readGuestPath(path);
  return { key: target.ref.key, ref: target.ref, val: () => value, exists: () => value !== null,
    toJSON: () => value, size: value && typeof value === "object" ? Object.keys(value).length : 0,
    child: (child: string) => localSnapshot(ref(db, `${path}/${child}`)),
    hasChild: (child: string) => readGuestPath(`${path}/${child}`) !== null,
    hasChildren: () => !!value && typeof value === "object" && Object.keys(value).length > 0,
    forEach: (action: (snapshot: DataSnapshot) => boolean | void) => {
      for (const key of Object.keys(value || {})) if (action(localSnapshot(ref(db, `${path}/${key}`)))) return true;
      return false;
    }, priority: null } as unknown as DataSnapshot;
}
export const get: typeof remoteGet = (target) => useLocal(referencePath(target)) ? Promise.resolve(localSnapshot(target)) : remoteGet(target);
export const set: typeof remoteSet = (target, value) => {
  const path = referencePath(target);
  if (!useLocal(path)) return remoteSet(target, value);
  try { writeGuestPath(path, value); return Promise.resolve(); } catch (error) { return Promise.reject(error); }
};
export const remove: typeof remoteRemove = target => useLocal(referencePath(target)) ? set(target, null) : remoteRemove(target);
export const push: typeof remotePush = (target, value) => {
  if (!useLocal(referencePath(target))) return remotePush(target, value);
  const child = remotePush(target);
  if (value !== undefined && value !== null) writeGuestPath(referencePath(child), value);
  return child;
};
export const update: typeof remoteUpdate = (target, values) => {
  const path = referencePath(target);
  const remote: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    const child = [path, key].filter(Boolean).join("/");
    if (useLocal(child)) writeGuestPath(child, value); else remote[key] = value;
  }
  return Object.keys(remote).length ? remoteUpdate(target, remote) : Promise.resolve();
};
export const runTransaction: typeof remoteTransaction = (target, action, options) => {
  const path = referencePath(target);
  if (!useLocal(path)) return remoteTransaction(target, action, options);
  try {
    const next = action(readGuestPath(path));
    if (next !== undefined) writeGuestPath(path, next);
    const snapshot = localSnapshot(target);
    return Promise.resolve({ committed: next !== undefined, snapshot, toJSON: () => ({ committed: next !== undefined, snapshot: snapshot.toJSON() }) });
  } catch (error) { return Promise.reject(error); }
};
export const onValue: typeof remoteOnValue = ((target: Parameters<typeof remoteGet>[0], callback: (snapshot: DataSnapshot) => unknown, ...args: unknown[]) => {
  if (!useLocal(referencePath(target))) return (remoteOnValue as Function)(target, callback, ...args);
  let active = true;
  const emit = () => { if (active) callback(localSnapshot(target)); };
  queueMicrotask(emit);
  if (args.some(value => value && typeof value === "object" && "onlyOnce" in value && value.onlyOnce)) return () => { active = false; };
  window.addEventListener("rs_guest_data_changed", emit);
  window.addEventListener("storage", emit);
  return () => { active = false; window.removeEventListener("rs_guest_data_changed", emit); window.removeEventListener("storage", emit); };
}) as typeof remoteOnValue;
/** Only an ID bit is persisted for guest counting; no profile or activity. */
const registeredGuests = new Set<string>();
export async function registerGuestId(id: string) {
  if (registeredGuests.has(id)) return;
  registeredGuests.add(id);
  try { await remoteSet(ref(db, `guestRegistry/${id}`), true); }
  catch (error) { registeredGuests.delete(id); throw error; }
}
export { ref, query, orderByChild, orderByKey, equalTo, limitToLast, limitToFirst, startAfter, startAt, endAt, signInWithEmailAndPassword, signOut, signInWithPopup, sendPasswordResetEmail, confirmPasswordReset, updatePassword };
