/** Guest identity is a data-routing hint, never an authorization check. */
export function isGuestRecord(id: string, value: { email?: string; guest?: boolean } = {}) {
  const email = String(value.email || "").trim().toLowerCase();
  if (email && email !== "guest@rsanime.com" && !email.endsWith("@guest.local")) return false;
  return id.startsWith("guest_") || value.guest === true || email === "guest@rsanime.com" || email.endsWith("@guest.local") || (/^user_\d+/.test(id) && !email);
}
export function currentGuestId(): string | null {
  try {
    const user = JSON.parse(localStorage.getItem("rsanime_user") || "null");
    return user?.id && isGuestRecord(String(user.id), user) ? String(user.id) : null;
  } catch { return null; }
}
/** Destructive cleanup requires an explicit marker, never just an absent email. */
export function isLegacyGuestCleanupCandidate(id: string, value: { email?: string; guest?: boolean } = {}) {
  const email = String(value.email || "").trim().toLowerCase();
  if (email && email !== "guest@rsanime.com" && !email.endsWith("@guest.local")) return false;
  return id.startsWith("guest_") || value.guest === true || email === "guest@rsanime.com" || email.endsWith("@guest.local");
}
export function localGuestPath(path: string, guestId: string | null): boolean {
  if (!guestId) return false;
  const parts = path.split("/").filter(Boolean);
  return parts.includes(guestId) || ["coinDeviceDaily", "deviceTransferClaims"].includes(parts[0] || "");
}
export const GUEST_DATA_KEY = "rs_guest_data_v2";
export function readGuestPath(path: string): any {
  try {
    const data = JSON.parse(localStorage.getItem(GUEST_DATA_KEY) || "{}");
    return path.split("/").filter(Boolean).reduce((value, key) => value?.[key], data) ?? null;
  } catch { return null; }
}
export function writeGuestPath(path: string, value: unknown) {
  const data = readGuestPath("") || {};
  const parts = path.split("/").filter(Boolean);
  let node = data;
  parts.slice(0, -1).forEach(key => { node[key] ||= {}; node = node[key]; });
  const key = parts.at(-1);
  if (!key) return;
  if (value === null || value === undefined) delete node[key]; else node[key] = value;
  localStorage.setItem(GUEST_DATA_KEY, JSON.stringify(data));
  window.dispatchEvent(new Event("rs_guest_data_changed"));
}
export function guestCleanupBatches<T>(items: T[]): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += 50) batches.push(items.slice(i, i + 50));
  return batches;
}