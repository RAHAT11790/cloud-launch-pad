import { db, ref, get, set, update, remove } from "@/lib/firebase";

type PremiumDeviceEntry = {
  name?: string;
  type?: string;
  registeredAt?: number;
  lastSeen?: number;
  fingerprint?: string;
};

const DEVICE_ID_KEY = "rs_device_id";
const SESSION_KEYS_TO_CLEAR = ["rsanime_user", "rs_display_name", "rs_profile_photo", "rs_photo_url"];

const hashText = (input: string): string => {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
};

export const getDeviceFingerprint = (): string => {
  try {
    const screenSize = typeof window !== "undefined" && window.screen
      ? `${window.screen.width}x${window.screen.height}`
      : "unknown";
    const raw = `${navigator.userAgent}|${navigator.platform}|${navigator.language}|${screenSize}`;
    return `fp_${hashText(raw)}`;
  } catch {
    return "fp_unknown";
  }
};

export const getDeviceId = (): string => {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
  } catch {}

  const id = "dev_" + Date.now().toString(36) + "_" + Math.random().toString(36).substring(2, 8);
  try {
    localStorage.setItem(DEVICE_ID_KEY, id);
  } catch {}
  return id;
};

export const clearLocalAccountSession = (): void => {
  try {
    SESSION_KEYS_TO_CLEAR.forEach((key) => localStorage.removeItem(key));
  } catch {}
};

export const getDeviceInfo = (): { type: string; name: string } => {
  const ua = navigator.userAgent;
  let type = "desktop";
  let name = "Unknown Device";

  if (/iPhone/i.test(ua)) {
    type = "mobile";
    name = "iPhone";
  } else if (/iPad/i.test(ua)) {
    type = "tablet";
    name = "iPad";
  } else if (/Android/i.test(ua)) {
    type = /Mobile/i.test(ua) ? "mobile" : "tablet";
    const match = ua.match(/;\s*([^;)]+)\s+Build/);
    name = match ? match[1].trim() : "Android Device";
  } else if (/Windows/i.test(ua)) {
    name = "Windows PC";
  } else if (/Mac/i.test(ua)) {
    name = "Mac";
  } else if (/Linux/i.test(ua)) {
    name = "Linux PC";
  }

  return { type, name };
};

const getDevicesSorted = (devices: Record<string, PremiumDeviceEntry>) =>
  Object.entries(devices).sort(([, a], [, b]) => (a?.registeredAt || 0) - (b?.registeredAt || 0));

const getMatchedDeviceId = (
  devices: Record<string, PremiumDeviceEntry>,
  currentDeviceId: string,
  currentFingerprint: string,
): string | null => {
  if (devices[currentDeviceId]) return currentDeviceId;
  const byFingerprint = Object.entries(devices).find(([, d]) => d?.fingerprint && d.fingerprint === currentFingerprint);
  return byFingerprint?.[0] || null;
};

/**
 * LOGIN-TIME CHECK: Check if this device can login.
 * Returns { allowed, reason, expiresAt? }
 * - If user has no premium or premium expired → allowed (no device limit for free users)
 * - If premium active and this device is already registered → allowed
 * - If premium active and device limit not reached → allowed (will register)
 * - If premium active and device limit reached and this device NOT registered → BLOCKED
 */
export const checkDeviceLimitForLogin = async (
  userId: string,
): Promise<{
  allowed: boolean;
  reason?: string;
  maxDevices?: number;
  currentCount?: number;
  registeredDeviceNames?: string[];
}> => {
  const deviceId = getDeviceId();
  const fingerprint = getDeviceFingerprint();

  const premSnap = await get(ref(db, `users/${userId}/premium`));
  const premData = premSnap.val();

  // No premium or expired → no device limit, allow login
  if (!premData || !premData.active || premData.expiresAt <= Date.now()) {
    return { allowed: true };
  }

  const maxDevices = Math.max(1, Number(premData.maxDevices) || 1);
  const devices: Record<string, PremiumDeviceEntry> = premData.devices || {};
  const currentCount = Object.keys(devices).length;

  // Check if this device is already registered
  const matchedDeviceId = getMatchedDeviceId(devices, deviceId, fingerprint);
  if (matchedDeviceId) {
    // Already registered → allow and refresh lastSeen
    return { allowed: true };
  }

  // Not registered → check if there's room
  if (currentCount >= maxDevices) {
    const deviceNames = Object.values(devices).map(d => d?.name || "Unknown Device");
    return {
      allowed: false,
      reason: `Device limit reached! Your account allows up to ${maxDevices} devices. Currently ${currentCount} devices are logged in. Please log out from another device first.`,
      maxDevices,
      currentCount,
      registeredDeviceNames: deviceNames,
    };
  }

  // Room available → allow
  return { allowed: true };
};

/**
 * Register device AFTER successful login
 */
export const registerDeviceOnLogin = async (userId: string): Promise<void> => {
  const deviceId = getDeviceId();
  const deviceInfo = getDeviceInfo();
  const fingerprint = getDeviceFingerprint();

  const premSnap = await get(ref(db, `users/${userId}/premium`));
  const premData = premSnap.val();

  // No premium → nothing to register
  if (!premData || !premData.active || premData.expiresAt <= Date.now()) return;

  const devices: Record<string, PremiumDeviceEntry> = premData.devices || {};
  const matchedDeviceId = getMatchedDeviceId(devices, deviceId, fingerprint);

  // Migrate if fingerprint matches old key
  if (matchedDeviceId && matchedDeviceId !== deviceId) {
    const oldData = devices[matchedDeviceId] || {};
    await set(ref(db, `users/${userId}/premium/devices/${deviceId}`), {
      ...oldData,
      name: deviceInfo.name,
      type: deviceInfo.type,
      fingerprint,
      lastSeen: Date.now(),
      registeredAt: oldData.registeredAt || Date.now(),
    });
    await remove(ref(db, `users/${userId}/premium/devices/${matchedDeviceId}`));
    return;
  }

  // Already registered → refresh
  if (devices[deviceId]) {
    await update(ref(db, `users/${userId}/premium/devices/${deviceId}`), {
      lastSeen: Date.now(),
      name: deviceInfo.name,
      type: deviceInfo.type,
      fingerprint,
    });
    return;
  }

  // Register new
  await set(ref(db, `users/${userId}/premium/devices/${deviceId}`), {
    name: deviceInfo.name,
    type: deviceInfo.type,
    registeredAt: Date.now(),
    lastSeen: Date.now(),
    fingerprint,
  });
};

/**
 * Unregister current device on logout
 */
export const unregisterCurrentDevice = async (userId: string): Promise<void> => {
  const deviceId = getDeviceId();
  const fingerprint = getDeviceFingerprint();

  try {
    const premSnap = await get(ref(db, `users/${userId}/premium`));
    const premData = premSnap.val();
    if (!premData?.devices) return;

    const devices: Record<string, PremiumDeviceEntry> = premData.devices;
    const matchedDeviceId = getMatchedDeviceId(devices, deviceId, fingerprint);

    if (matchedDeviceId) {
      await remove(ref(db, `users/${userId}/premium/devices/${matchedDeviceId}`));
    }
  } catch {}
};

// Remove a specific device (admin use)
export const removeDevice = async (userId: string, deviceId: string): Promise<void> => {
  await remove(ref(db, `users/${userId}/premium/devices/${deviceId}`));
};

// Get all devices for a user
export const getUserDevices = async (userId: string): Promise<{ id: string; name: string; type: string; registeredAt: number; lastSeen: number }[]> => {
  const devicesSnap = await get(ref(db, `users/${userId}/premium/devices`));
  const devices = devicesSnap.val() || {};
  return Object.entries(devices)
    .map(([id, data]: any) => ({
      id,
      name: data.name || "Unknown",
      type: data.type || "unknown",
      registeredAt: data.registeredAt || 0,
      lastSeen: data.lastSeen || 0,
    }))
    .sort((a, b) => a.registeredAt - b.registeredAt);
};

// Legacy: kept for admin panel compatibility
export const activateOnThisDevice = async (userId: string): Promise<boolean> => {
  const deviceId = getDeviceId();
  const deviceInfo = getDeviceInfo();
  const fingerprint = getDeviceFingerprint();

  const premRef = ref(db, `users/${userId}/premium`);
  const premSnap = await get(premRef);
  const premData = premSnap.val();
  if (!premData || !premData.active) return false;

  const maxDevices = Math.max(1, Number(premData.maxDevices) || 1);
  const devices: Record<string, PremiumDeviceEntry> = premData.devices || {};

  if (devices[deviceId]) {
    await update(ref(db, `users/${userId}/premium/devices/${deviceId}`), { lastSeen: Date.now(), fingerprint });
    return true;
  }

  const deviceEntries = getDevicesSorted(devices);
  if (deviceEntries.length >= maxDevices) {
    const oldest = deviceEntries[0];
    if (oldest) {
      await remove(ref(db, `users/${userId}/premium/devices/${oldest[0]}`));
    }
  }

  await set(ref(db, `users/${userId}/premium/devices/${deviceId}`), {
    name: deviceInfo.name,
    type: deviceInfo.type,
    registeredAt: Date.now(),
    lastSeen: Date.now(),
    fingerprint,
  });

  return true;
};
