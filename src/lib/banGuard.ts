// ============================================================
// RS Anime — Ban Guard
// Blocks banned accounts (by uid / email) and banned devices (device id).
// Realtime: an admin ban takes effect within seconds, even mid-session.
// ============================================================
import { db, ref, onValue, get, set, remove } from "@/lib/firebase";
import { getDeviceId } from "@/lib/premiumAccess";

export type BanState = { banned: boolean; reason?: string; scope?: "user" | "email" | "device" };

export const emailKey = (email: string) =>
  String(email || "").trim().toLowerCase().replace(/[.#$/[\]]/g, ",");

const readLocalUser = (): { id?: string; email?: string } => {
  try {
    const raw = localStorage.getItem("rsanime_user");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

/** Realtime ban subscription for the current visitor. */
export const subscribeBanState = (cb: (s: BanState) => void): (() => void) => {
  const unsubs: Array<() => void> = [];
  const flags: Record<string, BanState | null> = {};

  const emit = () => {
    const hit = Object.values(flags).find((v) => v?.banned);
    cb(hit || { banned: false });
  };

  const attach = (path: string, scope: BanState["scope"], isBan: (v: any) => boolean) => {
    const u = onValue(ref(db, path), (snap) => {
      const v = snap.val();
      flags[path] = isBan(v)
        ? { banned: true, scope, reason: (v && typeof v === "object" && v.reason) || "" }
        : null;
      emit();
    });
    unsubs.push(() => u());
  };

  const wire = () => {
    unsubs.splice(0).forEach((u) => u());
    Object.keys(flags).forEach((k) => delete flags[k]);

    const { id, email } = readLocalUser();
    const device = getDeviceId();

    attach(`bans/devices/${device}`, "device", (v) => !!v && v.banned !== false);
    if (id) attach(`users/${id}/banned`, "user", (v) => v === true || (!!v && v.banned === true));
    if (email && !/guest@rsanime\.com/i.test(email)) {
      attach(`bans/emails/${emailKey(email)}`, "email", (v) => !!v && v.banned !== false);
    }
    emit();
  };

  wire();
  const onAuth = () => wire();
  window.addEventListener("rs_auth_changed", onAuth);
  window.addEventListener("storage", onAuth);

  return () => {
    unsubs.splice(0).forEach((u) => u());
    window.removeEventListener("rs_auth_changed", onAuth);
    window.removeEventListener("storage", onAuth);
  };
};

// ---------- Admin helpers ----------
export const banUser = async (opts: { uid?: string; email?: string; deviceIds?: string[]; reason?: string }) => {
  const at = Date.now();
  const reason = opts.reason || "Violation of terms";
  if (opts.uid) await set(ref(db, `users/${opts.uid}/banned`), true).then(() => set(ref(db, `users/${opts.uid}/bannedAt`), at));
  if (opts.email) await set(ref(db, `bans/emails/${emailKey(opts.email)}`), { banned: true, at, reason, uid: opts.uid || null });
  for (const d of opts.deviceIds || []) {
    if (d) await set(ref(db, `bans/devices/${d}`), { banned: true, at, reason, uid: opts.uid || null });
  }
};

export const unbanUser = async (opts: { uid?: string; email?: string; deviceIds?: string[] }) => {
  if (opts.uid) {
    await set(ref(db, `users/${opts.uid}/banned`), null);
    await set(ref(db, `users/${opts.uid}/bannedAt`), null);
  }
  if (opts.email) await remove(ref(db, `bans/emails/${emailKey(opts.email)}`));
  for (const d of opts.deviceIds || []) {
    if (d) await remove(ref(db, `bans/devices/${d}`));
  }
};

export const listBans = async () => {
  const snap = await get(ref(db, "bans"));
  const raw = snap.val() || {};
  const emails = Object.entries(raw.emails || {}).map(([k, v]: any) => ({ key: k, kind: "email" as const, ...(v || {}) }));
  const devices = Object.entries(raw.devices || {}).map(([k, v]: any) => ({ key: k, kind: "device" as const, ...(v || {}) }));
  return [...emails, ...devices].sort((a: any, b: any) => (b.at || 0) - (a.at || 0));
};
