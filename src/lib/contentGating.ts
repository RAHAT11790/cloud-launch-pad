/**
 * Content gating helpers.
 *
 * 1) Timed episode lock (admin controlled, per episode):
 *      episode.lockUntil = <epoch ms>
 *    While `lockUntil` is in the future the episode is premium-only. Once the
 *    day count passes it becomes free for everyone automatically — no cleanup
 *    job is needed because the check is purely time based.
 *
 * 2) Guest restrictions (push visitors to create/login an account):
 *    - max 3 episodes per series (4th episode requires login, message only)
 *    - movies are fully locked (redirect to login)
 *    - profile customisation is disabled
 */

export const GUEST_EPISODE_LIMIT = 3;

export const DAY_MS = 86_400_000;

export const episodeLockUntil = (episode: any): number => {
  const raw = Number(episode?.lockUntil || 0);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
};

export const isEpisodeTimeLocked = (episode: any): boolean => episodeLockUntil(episode) > Date.now();

export const episodeLockRemainingMs = (episode: any): number => {
  const until = episodeLockUntil(episode);
  return until > Date.now() ? until - Date.now() : 0;
};

/** "3d 4h" / "5h 20m" / "18m" */
export const formatLockRemaining = (ms: number): string => {
  if (ms <= 0) return "unlocked";
  const totalMinutes = Math.ceil(ms / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
};

export const lockUntilFromDays = (days: number): number => {
  const d = Math.max(0, Number(days) || 0);
  if (d <= 0) return 0;
  return Date.now() + Math.round(d * DAY_MS);
};

/** Reads the episode at (seasonIdx, episodeIdx) from a series-like object. */
export const getEpisodeAt = (anime: any, seasonIdx = 0, episodeIdx = 0): any => {
  const seasons = Array.isArray(anime?.seasons) ? anime.seasons : [];
  const season = seasons[seasonIdx] || seasons[0];
  const episodes = Array.isArray(season?.episodes) ? season.episodes : [];
  return episodes[episodeIdx] || null;
};

/** Lock key used by the lightweight `episodeLocks` index on list payloads. */
export const lockKeyFor = (anime: any, seasonIdx = 0, episodeIdx = 0): string =>
  isMovieContent(anime) ? `p${Math.max(0, Number(episodeIdx || 0))}` : `s${Math.max(0, Number(seasonIdx || 0))}e${Math.max(0, Number(episodeIdx || 0))}`;

/**
 * Timed lock read from the lightweight index that every card payload carries,
 * so the gate works even before the full item (with per-episode data) loads.
 */
export const isTimeLockedByIndex = (anime: any, seasonIdx = 0, episodeIdx = 0): boolean => {
  const index = anime?.episodeLocks;
  if (!index || typeof index !== "object") return false;
  const now = Date.now();
  const direct = Number(index[lockKeyFor(anime, seasonIdx, episodeIdx)] || 0);
  if (direct > now) return true;
  if (isMovieContent(anime) || anime?.type === "movie") {
    if (Number(index.movie || 0) > now) return true;
    if (Number(index.p0 || 0) > now && Math.max(0, Number(episodeIdx || 0)) === 0) return true;
  }
  return false;
};

/** Timed lock for a series episode (or a movie part). */
export const isTimeLockedTarget = (anime: any, seasonIdx = 0, episodeIdx = 0): boolean => {
  if (isTimeLockedByIndex(anime, seasonIdx, episodeIdx)) return true;
  if (isEpisodeTimeLocked(anime)) return true;
  if (anime?.type === "movie" || isMovieContent(anime)) {
    const parts = Array.isArray(anime?.parts) ? anime.parts : [];
    const part = parts[episodeIdx] || parts[0];
    if (isEpisodeTimeLocked(part)) return true;
    return false;
  }
  return isEpisodeTimeLocked(getEpisodeAt(anime, seasonIdx, episodeIdx));
};

/** Remaining lock time for a target, using both the index and full data. */
export const targetLockRemainingMs = (anime: any, seasonIdx = 0, episodeIdx = 0): number => {
  const candidates = [
    Number(anime?.episodeLocks?.[lockKeyFor(anime, seasonIdx, episodeIdx)] || 0),
    Number(anime?.lockUntil || 0),
    episodeLockUntil(getEpisodeAt(anime, seasonIdx, episodeIdx)),
    episodeLockUntil((Array.isArray(anime?.parts) ? anime.parts : [])[episodeIdx]),
  ];
  const until = Math.max(...candidates, 0);
  return until > Date.now() ? until - Date.now() : 0;
};

/** True when ANY episode/part of the title is still inside its premium window. */
export const hasActiveTimeLock = (anime: any): boolean => {
  const now = Date.now();
  if (Number(anime?.lockUntil || 0) > now) return true;
  const index = anime?.episodeLocks;
  if (index && typeof index === "object") {
    if (Object.values(index).some((v) => Number(v || 0) > now)) return true;
  }
  const seasons = Array.isArray(anime?.seasons) ? anime.seasons : [];
  if (seasons.some((s: any) => (Array.isArray(s?.episodes) ? s.episodes : []).some((ep: any) => isEpisodeTimeLocked(ep)))) return true;
  const parts = Array.isArray(anime?.parts) ? anime.parts : [];
  return parts.some((p: any) => isEpisodeTimeLocked(p));
};

export const isMovieContent = (anime: any): boolean =>
  anime?.type === "movie" || String(anime?.id || "").startsWith("an_mv_");

/** Guests may only watch the first 3 episodes of any series (RS or AN). */
export const isGuestEpisodeBlocked = (episodeIdx?: number | null): boolean =>
  Math.max(0, Number(episodeIdx || 0)) >= GUEST_EPISODE_LIMIT;

export const GUEST_EPISODE_MESSAGE = `Guests can watch only the first ${GUEST_EPISODE_LIMIT} episodes. Please log in to continue.`;
export const GUEST_MOVIE_MESSAGE = "Movies are for logged-in members only. Please log in to watch.";
export const GUEST_PROFILE_MESSAGE = "Log in to customise your profile.";

/**
 * A "guest visitor" is anyone browsing without a real account — including the
 * local placeholder account created by "Continue as Guest".
 */
export const isGuestVisitor = (): boolean => {
  if (typeof window === "undefined") return true;
  try {
    const u = JSON.parse(localStorage.getItem("rsanime_user") || "{}");
    const email = String(u?.email || "").toLowerCase();
    if (!u?.id) return true;
    if (u?.guest === true || u?.isGuest === true) return true;
    if (!email) return true;
    return email === "guest@rsanime.com" || email.endsWith("@guest.local");
  } catch {
    return true;
  }
};
