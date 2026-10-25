/** Bell items: admin messages (normal / one-time popup) + live New Release notices. */
export type AnnouncementKind = "normal" | "popup";
export interface Announcement {
  id: string;
  kind: AnnouncementKind;
  title: string;
  description: string;
  image?: string;
  createdAt: number;
  expiresAt: number;
}
export interface BellItem {
  id: string;
  type: "release" | AnnouncementKind;
  title: string;
  body: string;
  image?: string;
  time: number;
  expiresAt?: number;
  contentId?: string;
}

export const RELEASE_TTL_MS = 36 * 60 * 60 * 1000;
export const ANNOUNCEMENT_EXPIRY_HOURS = [6, 12, 24, 72, 168, 720];
export const POPUP_SEEN_KEY = "rs_popup_seen_v1";
export const BELL_READ_KEY = "rs_bell_read_at_v1";

export function activeAnnouncements(raw: Record<string, any> | null | undefined, now = Date.now()): Announcement[] {
  return Object.entries(raw || {})
    .map(([id, v]) => ({
      id,
      kind: v?.kind === "popup" ? "popup" : "normal",
      title: String(v?.title || "").trim(),
      description: String(v?.description || "").trim(),
      image: /^https?:\/\//i.test(String(v?.image || "")) ? String(v.image) : undefined,
      createdAt: Number(v?.createdAt) || 0,
      expiresAt: Number(v?.expiresAt) || 0,
    }) as Announcement)
    .filter(a => a.title && a.expiresAt > now)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function expiredAnnouncementIds(raw: Record<string, any> | null | undefined, now = Date.now()): string[] {
  return Object.entries(raw || {}).filter(([, v]) => !(Number(v?.expiresAt) > now)).map(([id]) => id);
}

/** One notice per series: its newest active release inside the 36h window. Deleted releases simply vanish. */
export function releaseNotices(raw: Record<string, any> | null | undefined, now = Date.now()): BellItem[] {
  const latest = new Map<string, BellItem>();
  Object.entries(raw || {}).forEach(([id, r]) => {
    const time = Number(r?.timestamp) || 0;
    if (!r?.contentId || r.active === false || !time || now - time >= RELEASE_TTL_MS) return;
    const info = r.episodeInfo || {};
    const start = Number(info.episodeNumber ?? r.episode) || 0;
    const end = Number(info.episodeNumberEnd) || start;
    const body = info.type === "movie" ? "New movie released" :
      [info.seasonName || (r.season ? `Season ${r.season}` : ""), start ? (end > start ? `Episodes ${start}–${end}` : `Episode ${start}`) : ""].filter(Boolean).join(" · ") || "New episode released";
    const prev = latest.get(r.contentId);
    if (!prev || prev.time < time) latest.set(r.contentId, { id: `rel:${id}`, type: "release", title: String(r.title || "New release"), body, image: r.poster || undefined, time, expiresAt: time + RELEASE_TTL_MS, contentId: String(r.contentId) });
  });
  return [...latest.values()];
}

export function bellItems(announcements: Announcement[], releases: BellItem[]): BellItem[] {
  return [
    ...announcements.map(a => ({ id: `ann:${a.id}`, type: a.kind, title: a.title, body: a.description, image: a.image, time: a.createdAt, expiresAt: a.expiresAt }) as BellItem),
    ...releases,
  ].sort((a, b) => b.time - a.time);
}

export const unreadCount = (items: BellItem[], readAt: number) => items.filter(i => i.time > readAt).length;

/** Newest popup this device has not shown yet; each popup is shown exactly once. */
export const nextPopup = (list: Announcement[], seen: Set<string>) => list.find(a => a.kind === "popup" && !seen.has(a.id)) || null;

export function readSeenPopups(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(POPUP_SEEN_KEY) || "[]")); } catch { return new Set(); }
}
export function markPopupSeen(id: string, active: Announcement[] = []) {
  const keep = new Set(active.map(a => a.id));
  const seen = [...readSeenPopups()].filter(x => keep.size === 0 || keep.has(x));
  if (!seen.includes(id)) seen.push(id);
  try { localStorage.setItem(POPUP_SEEN_KEY, JSON.stringify(seen.slice(-200))); } catch {}
}

export function timeAgo(t: number, now = Date.now()) {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "Just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
