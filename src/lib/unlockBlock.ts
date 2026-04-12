const UNLOCK_BLOCK_DURATION_MS = 6 * 60 * 60 * 1000;

type UnlockBlockRecord = {
  blocked?: boolean;
  blockedAt?: number;
  expiresAt?: number;
  reason?: string;
};

export const getUnlockBlockExpiry = (blockedAt = Date.now()): number => {
  return blockedAt + UNLOCK_BLOCK_DURATION_MS;
};

export const isUnlockBlockActive = (value: unknown): boolean => {
  if (!value || typeof value !== "object") return false;

  const record = value as UnlockBlockRecord;
  if (record.blocked !== true) return false;

  const now = Date.now();
  const expiresAt = Number(record.expiresAt || 0);
  const blockedAt = Number(record.blockedAt || 0);

  if (expiresAt > 0) return expiresAt > now;
  if (blockedAt > 0) return blockedAt + UNLOCK_BLOCK_DURATION_MS > now;

  return false;
};