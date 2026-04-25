// Free access device tracker — max 2 devices per account.
// On 3rd device, the user keeps no benefit from free access (will see Unlock again).
import { db, ref, get, set, update } from "@/lib/firebase";
import { getDeviceId, getDeviceInfo } from "@/lib/premiumDevice";

const MAX_FREE_DEVICES = 2;

export interface FreeAccessSnap {
  active?: boolean;
  expiresAt?: number;
  grantedAt?: number;
  devices?: Record<string, { name?: string; type?: string; registeredAt?: number; lastSeen?: number }>;
}

/**
 * Returns true if the *current* device is allowed to consume the user's free access.
 * Auto-registers this device if there's room (≤2 total).
 */
export async function ensureFreeAccessDeviceAllowed(userId: string, snap: FreeAccessSnap | null): Promise<boolean> {
  if (!snap || !snap.active || !snap.expiresAt || snap.expiresAt <= Date.now()) return false;

  const deviceId = getDeviceId();
  const devices = snap.devices || {};

  // Already registered → allowed
  if (devices[deviceId]) {
    // touch lastSeen
    try {
      await update(ref(db, `users/${userId}/freeAccess/devices/${deviceId}`), { lastSeen: Date.now() });
    } catch {}
    return true;
  }

  // Room available → register
  if (Object.keys(devices).length < MAX_FREE_DEVICES) {
    const info = getDeviceInfo();
    try {
      await set(ref(db, `users/${userId}/freeAccess/devices/${deviceId}`), {
        name: info.name,
        type: info.type,
        registeredAt: Date.now(),
        lastSeen: Date.now(),
      });
    } catch {}
    return true;
  }

  // 3rd device — not allowed
  return false;
}
