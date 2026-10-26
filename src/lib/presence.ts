import { useEffect, useState } from "react";
import { onDisconnect, serverTimestamp, ref as remoteRef, set as remoteSet, remove as remoteRemove } from "firebase/database";
import { db, onValue, ref } from "@/lib/firebase";
import { isGuestRecord } from "@/lib/guestPersistence";

/**
 * Live presence: one tiny `presence/{key}` row = { k: "r" | "g", t } per active device.
 * No names, emails, history or guest profile — removed on disconnect / tab hidden.
 */
export const PRESENCE_WINDOW_MS = 150_000;
const HEARTBEAT_MS = 60_000;
const DEVICE_KEY = "rs_presence_device_v1";

export function presenceKeyFor(user: { id?: string; email?: string; guest?: boolean } | null, deviceId: string) {
  const id = String(user?.id || "");
  if (id && user?.email && !isGuestRecord(id, user)) return { key: `r_${id.replace(/[.#$\[\]/]/g, "_")}`, kind: "r" as const };
  return { key: `g_${deviceId}`, kind: "g" as const };
}

export function countPresence(raw: Record<string, any> | null | undefined, now = Date.now()) {
  let real = 0, guest = 0;
  Object.values(raw || {}).forEach(v => {
    const t = Number(v?.t) || 0;
    if (!t || now - t > PRESENCE_WINDOW_MS) return;
    if (v?.k === "r") real++; else if (v?.k === "g") guest++;
  });
  return { real, guest };
}

/** Real account total from the users node's key list alone (guest_* keys are visitors), so the dashboard needs no full profile download. */
export function realAccountKeyCount(keys: string[]) {
  return keys.filter(k => k && !k.startsWith("guest_")).length;
}

function deviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) { id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36); localStorage.setItem(DEVICE_KEY, id); }
    return id;
  } catch { return "anon" + Math.random().toString(36).slice(2, 8); }
}
function currentUser() {
  try { return JSON.parse(localStorage.getItem("rsanime_user") || "null"); } catch { return null; }
}

export function startPresence(): () => void {
  if (typeof window === "undefined") return () => {};
  const device = deviceId();
  let active: { key: string; kind: "r" | "g" } | null = null;
  const leave = () => {
    if (!active) return;
    const r = remoteRef(db, `presence/${active.key}`);
    onDisconnect(r).cancel().catch(() => {});
    remoteRemove(r).catch(() => {});
    active = null;
  };
  const beat = () => {
    if (document.visibilityState === "hidden" || location.pathname.startsWith("/admin")) { leave(); return; }
    const next = presenceKeyFor(currentUser(), device);
    if (active && active.key !== next.key) leave();
    const r = remoteRef(db, `presence/${next.key}`);
    if (!active) onDisconnect(r).remove().catch(() => {});
    active = next;
    remoteSet(r, { k: next.kind, t: serverTimestamp() }).catch(() => {});
  };
  beat();
  const timer = window.setInterval(beat, HEARTBEAT_MS);
  window.addEventListener("rs_auth_changed", beat);
  document.addEventListener("visibilitychange", beat);
  window.addEventListener("pagehide", leave);
  return () => {
    clearInterval(timer);
    window.removeEventListener("rs_auth_changed", beat);
    document.removeEventListener("visibilitychange", beat);
    window.removeEventListener("pagehide", leave);
    leave();
  };
}

/** Admin: live real / guest online counts (re-evaluated every 15s against the heartbeat window). */
export function usePresenceCounts() {
  const [raw, setRaw] = useState<Record<string, any>>({});
  const [, setTick] = useState(0);
  useEffect(() => onValue(ref(db, "presence"), snap => setRaw(snap.val() || {})), []);
  useEffect(() => { const t = setInterval(() => setTick(n => n + 1), 15000); return () => clearInterval(t); }, []);
  return countPresence(raw);
}
