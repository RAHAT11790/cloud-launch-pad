import { useState, useEffect, forwardRef, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { Zap, ChevronRight, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { db, ref, onValue, remove } from "@/lib/firebase";
import type { AnimeItem } from "@/data/animeData";
import { getAnimeTitleStyle } from "@/lib/animeFonts";
import { optimizedImageUrl } from "@/lib/imageCache";

const splitLanguageTokens = (value: string | undefined | null) =>
  String(value || "")
    .split(/[,/|]/)
    .map((item) => item.trim())
    .filter(Boolean);

const getPrimaryLanguageToken = (value: string | undefined | null) => splitLanguageTokens(value)[0] || "";

const NEW_RELEASE_TTL_MS = 36 * 60 * 60 * 1000; // 36 hours

interface EpisodeRelease {
  id: string;
  contentId: string;
  title?: string;
  poster?: string;
  year?: string;
  rating?: string;
  season?: number;
  episode?: number;
  seasonName?: string;
  timestamp: number;
  active?: boolean;
  weeklyEnabled?: boolean;
  weeklyEveryDays?: number;
}

interface NewEpisodeReleasesProps {
  allAnime: AnimeItem[];
  onCardClick: (anime: AnimeItem, seasonIdx?: number, epIdx?: number) => void;
}

const RELEASE_CACHE_KEY = "rs_cache_newReleases_v1";
const readReleaseCache = (): EpisodeRelease[] => {
  try {
    const raw = localStorage.getItem(RELEASE_CACHE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
};

const NewEpisodeReleases = forwardRef<HTMLDivElement, NewEpisodeReleasesProps>(({ allAnime, onCardClick }, _ref) => {
  // Seed from localStorage so the section paints instantly on first load
  // instead of waiting 3-5s for Firebase's first onValue snapshot.
  const [releases, setReleases] = useState<EpisodeRelease[]>(() => readReleaseCache());
  const [showModal, setShowModal] = useState(false);
  const [tick, setTick] = useState(0);
  const openingRef = useRef<string | null>(null);

  useEffect(() => {
    const relRef = ref(db, "newEpisodeReleases");
    const unsub = onValue(relRef, (snapshot) => {
      const data = snapshot.val() || {};
      const items: EpisodeRelease[] = [];
      const now = Date.now();
      Object.entries(data).forEach(([id, item]: [string, any]) => {
        // Auto-delete entries older than 36h directly from Firebase (no hard delete of anime, only release entry)
        if (item?.timestamp && now - item.timestamp >= NEW_RELEASE_TTL_MS) {
          remove(ref(db, `newEpisodeReleases/${id}`)).catch(() => {});
          return;
        }
        items.push({ id, ...item });
      });
      items.sort((a, b) => b.timestamp - a.timestamp);
      setReleases(items);
      try { localStorage.setItem(RELEASE_CACHE_KEY, JSON.stringify(items)); } catch {}
    });
    return () => unsub();
  }, []);


  // Live countdown tick every 60s — also triggers cleanup re-evaluation
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const contentById = useMemo(() => {
    const map = new Map<string, AnimeItem>();
    allAnime.forEach((item) => { if (item?.id) map.set(item.id, item); });
    return map;
  }, [allAnime]);

  // Filter active releases within 36h - only RS Anime content (no AnimeSalt).
  // Fresh releases can arrive before the home index refreshes, so don't hide or
  // block a card just because allAnime does not contain it yet.
  const activeReleases = useMemo(() => releases.filter(
    (r) => r.active !== false && Date.now() - r.timestamp < NEW_RELEASE_TTL_MS
      && (r as any).contentType !== "animesalt"
  ), [releases, tick]);

  // Helpers — releases may store episode info either at the top level
  // (r.episode / r.season) or nested under r.episodeInfo with optional
  // episodeNumberEnd for ranges added via the admin's multi-range publisher.
  const getEpStart = (r: any): number | undefined => {
    const v = r?.episode ?? r?.episodeInfo?.episodeNumber ?? r?.episodeInfo?.partStart;
    return typeof v === "number" && v > 0 ? v : undefined;
  };
  const getEpEnd = (r: any): number | undefined => {
    const v = r?.episodeInfo?.episodeNumberEnd ?? r?.episodeInfo?.partEnd ?? r?.episode ?? r?.episodeInfo?.episodeNumber ?? r?.episodeInfo?.partStart;
    return typeof v === "number" && v > 0 ? v : undefined;
  };
  const getSeason = (r: any): number | undefined => {
    const v = r?.season ?? r?.episodeInfo?.seasonNumber;
    return typeof v === "number" && v > 0 ? v : undefined;
  };
  const getSeasonName = (r: any): string | undefined => r?.seasonName ?? r?.episodeInfo?.seasonName;

  // Group releases by contentId so multiple new-episode entries for the same anime
  // collapse to one card showing a range (e.g. "EP 1-13").
  const groupedReleases = useMemo(() => {
    const byContent = new Map<string, EpisodeRelease[]>();
    activeReleases.forEach((r) => {
      const arr = byContent.get(r.contentId) || [];
      arr.push(r);
      byContent.set(r.contentId, arr);
    });
    const groups = Array.from(byContent.values()).map((arr) => {
      arr.sort((a, b) => b.timestamp - a.timestamp);
      const latest = arr[0];
      const starts = arr.map(getEpStart).filter((n): n is number => typeof n === "number");
      const ends = arr.map(getEpEnd).filter((n): n is number => typeof n === "number");
      const all = [...starts, ...ends];
      return {
        latest,
        all: arr,
        minEp: all.length ? Math.min(...all) : undefined,
        maxEp: all.length ? Math.max(...all) : undefined,
      };
    });
    groups.sort((a, b) => b.latest.timestamp - a.latest.timestamp);
    return groups;
  }, [activeReleases]);

  if (groupedReleases.length === 0) return null;

  const getContent = (contentId: string) => contentById.get(contentId);

  const warmRelease = (release: EpisodeRelease) => {
    const content = getContent(release.contentId);
    const target = content || ({ id: release.contentId, type: (release as any).contentType === "movie" ? "movie" : "webseries" } as any);
    try { (window as any).__rsPrefetchAnime?.(target, { forceFresh: true }); } catch {}
  };

  const timeAgo = (ts: number) => {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const handleClick = (release: EpisodeRelease, startEpisode?: number) => {
    if (openingRef.current === release.id) return;
    openingRef.current = release.id;
    window.setTimeout(() => { if (openingRef.current === release.id) openingRef.current = null; }, 180);
    const content = getContent(release.contentId);
    const sIdx = getSeason(release) ? getSeason(release)! - 1 : 0;
    const eIdx = typeof startEpisode === "number"
      ? Math.max(0, startEpisode - 1)
      : (getEpStart(release) ? getEpStart(release)! - 1 : 0);
    if (content) {
      onCardClick({ ...(content as any), __rsForceFreshPlayback: true } as AnimeItem, sIdx, eIdx);
      return;
    }
    // Fallback: content wasn't in the local index (rare — Firebase snapshot
    // race after a fresh publish). Synthesize a minimal AnimeItem from the
    // release payload so navigation still works instead of the tap being a no-op.
    const synth: any = {
      id: release.contentId,
      title: release.title || "New Release",
      poster: release.poster || "",
      backdrop: release.poster || "",
      year: release.year || "",
      rating: release.rating || "",
      type: (release as any).contentType === "movie" ? "movie" : "webseries",
      seasons: [],
      category: "",
      storyline: "",
      language: "",
      __rsForceFreshPlayback: true,
    };
    onCardClick(synth, sIdx, eIdx);
  };

  const releaseModal = (
    <AnimatePresence>
      {showModal && (
        <motion.div
          key="new-release-view-all"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14, ease: "easeOut" }}
          onClick={() => setShowModal(false)}
          className="fixed inset-0 z-[5000] flex items-center justify-center px-3 py-4 overflow-hidden"
          style={{ willChange: "opacity", touchAction: "manipulation", background: "hsl(var(--background) / 0.94)" }}
          data-no-swipe="true"
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="All New Releases"
            initial={{ y: 18, opacity: 0, scale: 0.985 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 14, opacity: 0, scale: 0.985 }}
            transition={{ type: "tween", duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[520px] max-h-[calc(100dvh-32px)] rounded-2xl flex flex-col shadow-2xl border border-border/70 transform-gpu overflow-hidden"
            style={{ willChange: "transform, opacity", contain: "layout paint", background: "hsl(var(--card))" }}
          >
            <div className="relative shrink-0 px-4 py-3 border-b border-border/40" style={{ background: "hsl(var(--secondary))" }}>
              <div className="min-w-0 pr-12">
                <h3 className="text-base font-bold flex items-center gap-2 leading-tight">
                  <span className="inline-flex w-8 h-8 rounded-xl bg-primary/15 items-center justify-center border border-primary/25">
                    <Zap className="w-4 h-4 text-accent" />
                  </span>
                  All New Releases
                </h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {groupedReleases.length} {groupedReleases.length === 1 ? "release" : "releases"}
                </p>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-background/70 border border-border/60 flex items-center justify-center hover:bg-secondary active:scale-95 shrink-0"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 p-3 space-y-2.5 overscroll-contain" style={{ background: "hsl(var(--background) / 0.35)" }}>
              {groupedReleases.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  No new releases yet — check back soon.
                </div>
              ) : (
                groupedReleases.map(({ latest: release, minEp, maxEp }) => {
                  const content = getContent(release.contentId);
                  const title = content?.title || release.title || "Unknown";
                  const poster = content?.poster || release.poster || "";
                  const fallbackEp = getEpStart(release);
                  const epStr = minEp && maxEp && minEp !== maxEp
                    ? `Episode ${minEp}-${maxEp}`
                    : fallbackEp ? `Episode ${fallbackEp}` : "New";
                  const seasonLabel = getSeasonName(release) || (getSeason(release) ? `Season ${getSeason(release)}` : "New Season");
                  return (
                    <button
                      type="button"
                      key={release.id}
                      onPointerDown={() => warmRelease(release)}
                      onClick={() => { handleClick(release, minEp); setShowModal(false); }}
                      className="w-full min-w-0 flex items-center gap-3 p-2.5 rounded-xl border border-border/45 cursor-pointer text-left transition-transform hover:bg-secondary active:scale-[0.985] overflow-hidden"
                      style={{ background: "hsl(var(--card))" }}
                    >
                      {poster ? (
                        <img
                          src={optimizedImageUrl(poster, "poster")}
                          alt={title}
                          className="w-[58px] h-[82px] rounded-lg object-cover flex-shrink-0 bg-muted border border-border/35"
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <div className="w-[58px] h-[82px] rounded-lg bg-muted flex-shrink-0 border border-border/35" />
                      )}
                      <div className="flex-1 min-w-0 flex flex-col justify-center">
                        <h4 className="text-sm font-semibold mb-1 line-clamp-1" style={getAnimeTitleStyle(title)}>{title}</h4>
                        <p className="text-xs text-muted-foreground line-clamp-1">
                          {seasonLabel} • {epStr}
                        </p>
                        <span className="text-[10px] text-primary/80 mt-1 inline-flex w-fit rounded-md bg-primary/10 px-1.5 py-0.5">{timeAgo(release.timestamp)}</span>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground self-center shrink-0" />
                    </button>
                  );
                })
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <>
      <div className="px-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-bold flex items-center gap-2 category-bar">
            <Zap className="w-4 h-4 text-accent" />
            New Episode Release
          </h3>
          <button
            onClick={() => setShowModal(true)}
            className="text-xs text-primary flex items-center gap-1 hover:underline"
          >
            View All <ChevronRight className="w-3 h-3" />
          </button>
        </div>

        <div data-no-swipe="true" className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide" style={{ touchAction: "pan-x pan-y" }}>
          {groupedReleases.slice(0, 10).map(({ latest: release, minEp, maxEp }) => {
            const content = getContent(release.contentId);
            const poster = content?.poster || release.poster || "";
            const title = content?.title || release.title || "Unknown";
            const year = content?.year || release.year || "N/A";
            const rating = content?.rating || release.rating || "N/A";
            const languageLabel = getPrimaryLanguageToken((release as any).language || content?.baseLanguage || content?.language);

            // Fallback: if admin didn't set episode/season on the release, use latest from content seasons
            let epNum: number | undefined = getEpStart(release);
            let snNum: number | undefined = getSeason(release);
            let snName: string | undefined = getSeasonName(release);
            if ((!epNum || !snNum) && content?.seasons && content.seasons.length > 0) {
              const lastSeasonIdx = content.seasons.length - 1;
              const lastSeason: any = content.seasons[lastSeasonIdx];
              const lastEp = lastSeason?.episodes?.[lastSeason.episodes.length - 1];
              if (!snNum) snNum = lastSeasonIdx + 1;
              if (!snName) snName = lastSeason?.name;
              if (!epNum && lastEp) epNum = lastEp.episodeNumber || lastEp.number || lastSeason.episodes.length;
            }

            // Build episode label with range support
            const epLabel = (() => {
              const hi = maxEp ?? epNum;
              const lo = minEp ?? epNum;
              if (!hi) return null;
              const epStr = lo && hi && lo !== hi ? `EP ${lo}-${hi}` : `EP ${hi}`;
              return snNum && snNum > 1 ? `S${snNum} · ${epStr}` : epStr;
            })();

            return (
              <div
                key={release.id}
                data-anime-card="true"
                data-new-release-card="true"
                role="button"
                tabIndex={0}
                className="relative flex-shrink-0 w-[124px] lg:w-[210px] xl:w-[230px] cursor-pointer group"
                onPointerDown={() => warmRelease(release)}
                onClick={() => handleClick(release, minEp)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleClick(release, minEp); } }}
              >
                  <div className="relative aspect-[2/3] rounded-xl overflow-hidden poster-hover shadow-md">
                  {/* NEW badge */}
                  <div className="absolute top-1.5 left-1.5 z-10 bg-gradient-to-r from-accent to-pink-500 text-white text-[9px] font-bold px-2 py-0.5 rounded flex items-center gap-1 shadow">
                    <Zap className="w-2.5 h-2.5" /> NEW
                  </div>
                  <img src={optimizedImageUrl(poster, "poster")} alt={title} className="poster-img w-full h-full object-cover" loading="eager" decoding="async" />
                  <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.35) 45%, transparent 75%)" }} />
                  <div className="absolute top-1.5 right-1.5 flex flex-col items-end gap-1 z-10">
                    {languageLabel ? <span className="rounded-md bg-black/70 px-1.5 py-0.5 text-[8px] font-semibold text-white">{languageLabel}</span> : null}
                    <span className="gradient-primary px-2 py-0.5 rounded text-[9px] font-bold">{year}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[7px] font-black tracking-wider ${content?.source === "animesalt" ? "bg-accent/85 text-accent-foreground" : "bg-primary/85 text-primary-foreground"}`}>{content?.source === "animesalt" ? "AN" : "RS"}</span>
                  </div>

                  {/* Bottom info bar — title + rating left, EP badge bottom-right corner */}
                  <div className="absolute bottom-0 left-0 right-0 p-2">
                    <p className="text-[11px] font-semibold leading-tight line-clamp-2 text-white pr-1" style={{ ...getAnimeTitleStyle(title), textShadow: "0 2px 6px rgba(0,0,0,0.9)" }}>
                      {title}
                    </p>
                    <div className="flex items-end justify-between mt-1 gap-1">
                      <div className="flex flex-col">
                        <p className="text-[9px] text-white/85 flex items-center gap-1">
                          <span>⭐ {rating}</span>
                          <span className="opacity-70">· {timeAgo(release.timestamp)}</span>
                        </p>
                      </div>
                      {epLabel && (
                        <span
                          className="shrink-0 px-1.5 py-[2px] rounded-md text-[9px] font-black tracking-tight bg-gradient-to-r from-primary to-amber-500 text-primary-foreground shadow-md"
                          style={{ textShadow: "0 1px 1px rgba(0,0,0,0.25)" }}
                        >
                          {epLabel}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

      </div>

      {typeof document !== "undefined" ? createPortal(releaseModal, document.body) : releaseModal}
    </>
  );
});

NewEpisodeReleases.displayName = "NewEpisodeReleases";

export default NewEpisodeReleases;
