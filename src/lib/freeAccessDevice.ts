// Free access device tracker — max 2 devices per account.
// On 3rd device, the user keeps no benefit from free access (will see Unlock again).
import { db, ref, set, update, remove } from "@/lib/firebase";
import { getDeviceFingerprint, getDeviceId, getDeviceInfo } from "@/lib/premiumDevice";

const MAX_FREE_DEVICES = 2;

export interface FreeAccessSnap {
  active?: boolean;
  expiresAt?: number;
  grantedAt?: number;
  devices?: Record<string, { name?: string; type?: string; fingerprint?: string; registeredAt?: number; lastSeen?: number }>;
}

type FreeAccessDeviceEntry = NonNullable<FreeAccessSnap["devices"]>[string];

const sortDevicesByAge = (devices: Record<string, FreeAccessDeviceEntry>) =>
  Object.entries(devices).sort(
    ([, a], [, b]) => ((a?.lastSeen || a?.registeredAt || 0) - (b?.lastSeen || b?.registeredAt || 0)),
  );

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
 * Returns true if the *current* device is allowed to consume the user's free access.
 * Auto-registers this device if there's room (≤2 total).
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

  // Room available → register
  if (Object.keys(devices).length < MAX_FREE_DEVICES) {
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

  // If an older slot has the same physical fingerprint but stale local device id,
  // heal it instead of blocking the user.
  const staleFingerprintMatch = Object.entries(devices).find(([, device]) => device?.fingerprint === fingerprint);
  if (staleFingerprintMatch) {
    const [staleDeviceId, current] = staleFingerprintMatch;
    try {
      const nextPayload = {
        name: info.name,
        type: info.type,
        fingerprint,
        registeredAt: current?.registeredAt || Date.now(),
        lastSeen: Date.now(),
      };
      await set(ref(db, `users/${userId}/freeAccess/devices/${deviceId}`), nextPayload);
      if (staleDeviceId !== deviceId) {
        await remove(ref(db, `users/${userId}/freeAccess/devices/${staleDeviceId}`));
      }
    } catch {}
    return true;
  }

  // Legacy migration: older entries were keyed only by localStorage device id.
  // If every slot is legacy (no fingerprint yet), replace the oldest slot once.
  const hasFingerprintBackedSlot = Object.values(devices).some((device) => !!device?.fingerprint);
  if (!hasFingerprintBackedSlot) {
    const oldestLegacy = sortDevicesByAge(devices)[0];
    if (oldestLegacy) {
      const [legacyDeviceId] = oldestLegacy;
      try {
        await set(ref(db, `users/${userId}/freeAccess/devices/${deviceId}`), {
          name: info.name,
          type: info.type,
          fingerprint,
          registeredAt: Date.now(),
          lastSeen: Date.now(),
        });
        if (legacyDeviceId !== deviceId) {
          await remove(ref(db, `users/${userId}/freeAccess/devices/${legacyDeviceId}`));
        }
      } catch {}
      return true;
    }
  }

  // 3rd device — not allowed
  return false;
}
