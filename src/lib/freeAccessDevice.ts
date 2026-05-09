// Free access device tracker — no device count limit.
// Each physical device must claim its own access separately.
import { db, ref, set, update, remove } from "@/lib/firebase";
import { getDeviceFingerprint, getDeviceId, getDeviceInfo } from "@/lib/premiumDevice";

export interface FreeAccessSnap {
  active?: boolean;
  expiresAt?: number;
  grantedAt?: number;
  devices?: Record<string, { name?: string; type?: string; fingerprint?: string; registeredAt?: number; lastSeen?: number }>;
}

type FreeAccessDeviceEntry = NonNullable<FreeAccessSnap["devices"]>[string];

const getMatchedDeviceId = (
  devices: Record<string, FreeAccessDeviceEntry>,
  currentDeviceId: string,
  currentFingerprint: string,
): string | null => {
  if (devices[currentDeviceId]) return currentDeviceId;
  const byFingerprint = Object.entries(devices).find(([, d]) => d?.fingerprint && d.fingerprint === currentFingerprint);
  return byFingerprint?.[0] || null;
};

/**
 * Returns true if the current device has access.
 * Free access is now strictly per-device: the first claiming device keeps access,
 * and every new device must claim its own access separately.
 */
export async function ensureFreeAccessDeviceAllowed(userId: string, snap: FreeAccessSnap | null): Promise<boolean> {
  if (!snap || !snap.active || !snap.expiresAt || snap.expiresAt <= Date.now()) return false;

  const deviceId = getDeviceId();
  const fingerprint = getDeviceFingerprint();
  const info = getDeviceInfo();
  const devices = snap.devices || {};
  const matchedDeviceId = getMatchedDeviceId(devices, deviceId, fingerprint);

  // Already registered (by local id or stable fingerprint) → allow and self-heal key/fingerprint
  if (matchedDeviceId) {
    const current = devices[matchedDeviceId] || {};
    const nextPayload = {
      name: info.name,
      type: info.type,
      fingerprint,
      registeredAt: current.registeredAt || Date.now(),
      lastSeen: Date.now(),
    };

    try {
      if (matchedDeviceId !== deviceId) {
        await set(ref(db, `users/${userId}/freeAccess/devices/${deviceId}`), nextPayload);
        await remove(ref(db, `users/${userId}/freeAccess/devices/${matchedDeviceId}`));
      } else {
        await update(ref(db, `users/${userId}/freeAccess/devices/${deviceId}`), nextPayload);
      }
    } catch {}
    return true;
  }

  // Legacy records from older versions may have had no devices map at all.
  // In that case, bind the current device once and keep access only for it.
  if (Object.keys(devices).length === 0) {
    try {
      await set(ref(db, `users/${userId}/freeAccess/devices/${deviceId}`), {
        name: info.name,
        type: info.type,
        fingerprint,
        registeredAt: Date.now(),
        lastSeen: Date.now(),
      });
    } catch {}
    return true;
  }

  // Different device: access must be claimed again on that specific device.
  return false;
}
