import { useState, useRef, useEffect, forwardRef, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { User, LogOut, History, Bookmark, Settings, ChevronRight, ArrowLeft, Camera, X, Save, Globe, Monitor, Info, Crown, Gift, Check, Lock, Eye, EyeOff, KeyRound, Clock, Download, Play, Trash2, Loader2, Smartphone, Laptop, Tablet, Shield, AlertTriangle, Sparkles, Coins } from "lucide-react";
import { usePremium } from "@/hooks/usePremium";
import { motion, AnimatePresence } from "framer-motion";
import { db, ref, onValue, set, remove, get, update, push, query, orderByChild, equalTo } from "@/lib/firebase";
import type { AnimeItem } from "@/data/animeData";
import { toast } from "sonner";
import { TELEGRAM_ADMIN_URL, TELEGRAM_CHANNEL_URL, SITE_NAME } from "@/lib/siteConfig";
import { useBranding } from "@/hooks/useBranding";
import { triggerApkDownload } from "@/lib/apkDownload";
import AboutPage from "./AboutPage";
import PrivacyPolicyPage from "./PrivacyPolicyPage";
import { usePwaInstall } from "@/hooks/usePwaInstall";
import { Progress } from "@/components/ui/progress";
import { downloadManager, type DownloadQueueSnapshot } from "@/lib/downloadManager";
import { buildEmailAliasKey, readDisplayName, readProfilePhoto, removeProfilePhoto, writeDisplayName, writeProfilePhoto } from "@/lib/localUser";
import { optimizedImageUrl } from "@/lib/imageCache";
import { getTodayRemaining } from "@/lib/premiumAccess";

import VideoPlayer from "@/components/VideoPlayer";
import InviteFriendCard from "@/components/InviteFriendCard";


const DownloadVideoPlayer = ({ src, title, subtitle, poster, onClose, downloadedEpisodes, onPlayEpisode, currentId, qualityOptions, onQualityChange }: {
  src: string; title: string; subtitle?: string; poster?: string; onClose: () => void;
  downloadedEpisodes?: any[]; onPlayEpisode?: (id: string) => void; currentId?: string;
  qualityOptions?: { label: string; src: string; downloadId: string }[];
  onQualityChange?: (downloadId: string) => void;
}) => {
  // Build episode list - group by title+subtitle, only show unique episodes
  const episodeList = useMemo(() => {
    if (!downloadedEpisodes || downloadedEpisodes.length === 0) return undefined;
    // Deduplicate by title+subtitle (same episode, different qualities)
    const seen = new Map<string, any>();
    downloadedEpisodes.forEach(ep => {
      const key = `${ep.title}||${ep.subtitle || ''}`;
      if (!seen.has(key)) seen.set(key, ep);
    });
    const uniqueEps = Array.from(seen.values());
    if (uniqueEps.length <= 1) return undefined;
    return uniqueEps.map((ep, idx) => ({
      number: idx + 1,
      active: ep.id === currentId || (downloadedEpisodes.some(d => d.id === currentId && d.title === ep.title && d.subtitle === ep.subtitle)),
      onClick: () => onPlayEpisode?.(ep.id),
    }));
  }, [downloadedEpisodes, currentId, onPlayEpisode]);

  // Build quality options for VideoPlayer format (without downloadId)
  const vpQualityOptions = useMemo(() => {
    if (!qualityOptions || qualityOptions.length <= 1) return undefined;
    return qualityOptions.map(q => ({ label: q.label, src: q.src }));
  }, [qualityOptions]);

  return (
    <div className="fixed inset-0 z-[300]">
      <VideoPlayer
        src={src}
        title={title}
        subtitle={subtitle}
        poster={poster}
        onClose={onClose}
        hideDownload
        episodeList={episodeList}
        qualityOptions={vpQualityOptions}
      />
    </div>
  );
};

interface ProfilePageProps {
  onClose: () => void;
  allAnime?: AnimeItem[];
  onCardClick?: (anime: AnimeItem, seasonIdx?: number, epIdx?: number) => void;
  onContinueWatching?: (item: any) => void;
  onLogout?: () => void;
  onLoginClick?: () => void;
}

const MAX_PHOTO_SIZE = 10 * 1024 * 1024;
const PAYMENT_REVIEW_WINDOW_MS = 24 * 60 * 60 * 1000;

const AccessTimer = () => {
  const [timeLeft, setTimeLeft] = useState<string | null>(null);
  const [hasAccess, setHasAccess] = useState(false);
  const [paused, setPaused] = useState(false);
  const [globalFree, setGlobalFree] = useState<{ active: boolean; expiresAt: number } | null>(null);
  const [userFreeExpiry, setUserFreeExpiry] = useState<number>(0);

  // Check maintenance status and pause/extend timer
  useEffect(() => {
    const unsub = onValue(ref(db, "maintenance"), (snap) => {
      const maint = snap.val();
      if (maint?.active) {
        setPaused(true);
      } else {
        setPaused(false);
        if (maint?.lastPauseDuration && maint?.lastResumedAt) {
          const appliedKey = `rsanime_pause_applied_${maint.lastResumedAt}`;
          if (!localStorage.getItem(appliedKey)) {
            const expiry = localStorage.getItem("rsanime_ad_access");
            if (expiry) {
              const newExpiry = parseInt(expiry) + maint.lastPauseDuration;
              localStorage.setItem("rsanime_ad_access", newExpiry.toString());
            }
            localStorage.setItem(appliedKey, "true");
          }
        }
      }
    });
    return () => unsub();
  }, []);

  // Listen for global free access
  useEffect(() => {
    const unsub = onValue(ref(db, "globalFreeAccess"), (snap) => {
      const data = snap.val();
      if (data?.active && data?.expiresAt > Date.now()) {
        setGlobalFree(data);
      } else {
        setGlobalFree(null);
      }
    });
    return () => unsub();
  }, []);

  // Listen for UID-based free access (primary source — works across devices)
  useEffect(() => {
    let uid: string | null = null;
    try {
      const u = localStorage.getItem("rsanime_user");
      if (u) uid = JSON.parse(u).id;
    } catch {}
    if (!uid) { setUserFreeExpiry(0); return; }
    const unsub = onValue(ref(db, `users/${uid}/freeAccess`), (snap) => {
      const data = snap.val();
      if (data?.active && Number(data.expiresAt) > Date.now()) {
        setUserFreeExpiry(Number(data.expiresAt));
      } else {
        setUserFreeExpiry(0);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const tick = () => {
      // Priority 1: Global free access
      if (globalFree?.active && globalFree.expiresAt > Date.now()) {
        setHasAccess(true);
        const diff = globalFree.expiresAt - Date.now();
        const h = Math.floor(diff / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        setTimeLeft(`${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`);
        return;
      }
      // Priority 2: UID-based free access from Firebase (cross-device, persistent)
      const localExpiry = parseInt(localStorage.getItem("rsanime_ad_access") || "0");
      const effectiveExpiry = Math.max(userFreeExpiry, localExpiry);
      if (effectiveExpiry <= Date.now()) {
        setHasAccess(false); setTimeLeft(null); return;
      }
      const diff = effectiveExpiry - Date.now();
      setHasAccess(true);
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setTimeLeft(`${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [globalFree, userFreeExpiry]);

  if (!hasAccess && !paused) return null;
  return (
    <div className="mb-1">
      <div className={`glass-card p-4 rounded-xl flex items-center gap-3 ${hasAccess ? "border-primary/30 bg-primary/5" : "border-accent/30 bg-accent/5"}`}>
        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${hasAccess ? "gradient-primary" : "bg-muted"}`}>
          <Clock className={`w-5 h-5 ${hasAccess ? "text-primary-foreground" : "text-muted-foreground"}`} />
        </div>
        <div className="flex-1">
          <p className="text-xs text-muted-foreground">
            {paused ? "⏸ Timer Paused (Maintenance)" : globalFree?.active ? "Global Free Access Remaining" : hasAccess ? "Free Access Remaining" : "No Active Access"}
          </p>
          {paused && hasAccess ? (
            <p className="text-lg font-bold font-mono text-yellow-400 tracking-wider">{timeLeft} ⏸</p>
          ) : hasAccess && timeLeft ? (
            <p className="text-lg font-bold font-mono text-primary tracking-wider">{timeLeft}</p>
          ) : (
            <p className="text-sm font-medium text-muted-foreground">Watch a video to unlock 24h access</p>
          )}
        </div>
      </div>
    </div>
  );
};

// Downloads Panel Component
const DownloadsPanel = ({ onBack }: { onBack: () => void }) => {
  const [downloads, setDownloads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [queueSnapshot, setQueueSnapshot] = useState<DownloadQueueSnapshot>(() => downloadManager.getSnapshotState());
  const [playingVideo, setPlayingVideo] = useState<string | null>(null);
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);
  const [qualityUrls, setQualityUrls] = useState<{ label: string; src: string; downloadId: string }[]>([]);
  const videoPlayRef = useRef<HTMLVideoElement>(null);

  const loadDownloads = async () => {
    try {
      const { getAllDownloads } = await import("@/lib/downloadStore");
      const items = await getAllDownloads();
      setDownloads(items);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { loadDownloads(); }, []);

  useEffect(() => {
    return downloadManager.subscribe((snapshot) => {
      setQueueSnapshot(snapshot);
      const hasCompleted = Array.from(snapshot.downloads.values()).some((item) => item.status === "complete");
      if (hasCompleted) loadDownloads();
    });
  }, []);

  useEffect(() => {
    return () => {
      if (playingUrl) URL.revokeObjectURL(playingUrl);
      qualityUrls.forEach(q => URL.revokeObjectURL(q.src));
    };
  }, [playingUrl, qualityUrls]);

  const handlePlay = async (id: string) => {
    try {
      const { getVideoBlob } = await import("@/lib/downloadStore");
      const blob = await getVideoBlob(id);
      if (!blob) { toast.error("Video file not found"); return; }
      
      // Revoke old URLs
      if (playingUrl) URL.revokeObjectURL(playingUrl);
      qualityUrls.forEach(q => URL.revokeObjectURL(q.src));
      
      const url = URL.createObjectURL(blob);
      setPlayingUrl(url);
      setPlayingVideo(id);
      
      // Find same episode with different qualities
      const currentItem = downloads.find(d => d.id === id);
      if (currentItem) {
        const sameEpisode = downloads.filter(d => 
          d.title === currentItem.title && d.subtitle === currentItem.subtitle
        );
        if (sameEpisode.length > 1) {
          // Create blob URLs for all qualities
          const qUrls: { label: string; src: string; downloadId: string }[] = [];
          for (const ep of sameEpisode) {
            if (ep.id === id) {
              qUrls.push({ label: ep.quality || 'Auto', src: url, downloadId: ep.id });
            } else {
              const epBlob = await getVideoBlob(ep.id);
              if (epBlob) {
                const epUrl = URL.createObjectURL(epBlob);
                qUrls.push({ label: ep.quality || 'Auto', src: epUrl, downloadId: ep.id });
              }
            }
          }
          setQualityUrls(qUrls);
        } else {
          setQualityUrls([]);
        }
      }
    } catch { toast.error("Failed to load video"); }
  };

  const handleDelete = async (id: string) => {
    try {
      const { deleteDownload } = await import("@/lib/downloadStore");
      await deleteDownload(id);
      setDownloads(prev => prev.filter(d => d.id !== id));
      if (playingVideo === id) {
        setPlayingVideo(null);
        if (playingUrl) URL.revokeObjectURL(playingUrl);
        setPlayingUrl(null);
      }
      toast.success("Download deleted");
    } catch {
      toast.error("Failed to delete download");
    }
  };

  const formatSize = (bytes: number) => {
    if (!bytes || bytes <= 0) return "Size unknown";
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatQueueSize = (loadedMB: number, totalMB: number) => {
    const fmt = (mb: number) => {
      if (!mb || mb <= 0) return "";
      if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
      return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
    };
    if (loadedMB > 0 && totalMB > 0) return `${fmt(loadedMB)} / ${fmt(totalMB)}`;
    if (totalMB > 0) return fmt(totalMB);
    if (loadedMB > 0) return fmt(loadedMB);
    return "Preparing size...";
  };

  return (
    <motion.div className="fixed inset-0 z-[200] bg-background overflow-y-auto pt-[70px] px-4 pb-24"
      initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
      transition={{ type: "tween", duration: 0.22, ease: [0.32, 0.72, 0, 1] }}>
      <button onClick={onBack} className="flex items-center gap-2 mb-5 text-sm text-secondary-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="w-5 h-5" />
        <span className="font-medium">Downloads</span>
      </button>

      {playingVideo && playingUrl && (() => {
        const currentItem = downloads.find(d => d.id === playingVideo);
        return (
          <DownloadVideoPlayer
            src={playingUrl}
            title={currentItem?.title || "Video"}
            subtitle={currentItem?.subtitle}
            poster={currentItem?.poster}
            onClose={() => {
              setPlayingVideo(null);
              if (playingUrl) URL.revokeObjectURL(playingUrl);
              qualityUrls.forEach(q => { if (q.src !== playingUrl) URL.revokeObjectURL(q.src); });
              setPlayingUrl(null);
              setQualityUrls([]);
            }}
            downloadedEpisodes={downloads}
            currentId={playingVideo}
            onPlayEpisode={(id) => handlePlay(id)}
            qualityOptions={qualityUrls.length > 1 ? qualityUrls : undefined}
          />
        );
      })()}

      <div className="mb-4 glass-card rounded-xl p-3 border border-primary/20">
        <p className="text-sm font-semibold text-foreground">Sequential HTTPS downloads</p>
        <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
          Downloads now run one by one with live progress. Installed app and browser both use the same progress queue.
        </p>
      </div>

      {queueSnapshot.totalCount > 0 && (
        <div className="mb-4 glass-card rounded-xl p-3 border border-primary/20 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Download Queue</p>
              <p className="text-[11px] text-muted-foreground">
                {queueSnapshot.completedCount}/{queueSnapshot.totalCount} complete • {queueSnapshot.queuedCount} waiting
              </p>
            </div>
            <button
              onClick={() => downloadManager.clearFinished()}
              className="text-[10px] font-semibold px-2.5 py-1.5 rounded-lg bg-secondary text-secondary-foreground"
            >
              Clear Done
            </button>
          </div>
          <div className="space-y-2">
            {Array.from(queueSnapshot.downloads.values()).sort((a, b) => a.sequence - b.sequence).map((item) => (
              <div key={item.id} className="rounded-xl bg-secondary/55 px-3 py-2.5 border border-border/60">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-foreground truncate">{item.subtitle || item.title}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {item.status === "queued" ? `Queued • ${item.queueIndex}/${item.totalInBatch}` : item.status === "downloading" ? `Downloading • ${item.percent}%` : item.status === "paused" ? "Paused" : item.status}
                    </p>
                    <p className="text-[10px] text-primary/80 mt-0.5">
                      {formatQueueSize(item.loadedMB, item.totalMB)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {(item.status === "queued" || item.status === "downloading") && (
                      <button
                        onClick={() => downloadManager.pauseDownload(item.id)}
                        className="px-2 py-1 rounded-lg bg-secondary text-[10px] font-semibold text-foreground"
                      >
                        Pause
                      </button>
                    )}
                    {item.status === "paused" && (
                      <button
                        onClick={() => downloadManager.resumeDownload(item.id)}
                        className="px-2 py-1 rounded-lg gradient-primary text-[10px] font-semibold text-primary-foreground"
                      >
                        Resume
                      </button>
                    )}
                    {(item.status === "queued" || item.status === "downloading" || item.status === "paused") && (
                      <button
                        onClick={() => downloadManager.cancelDownload(item.id)}
                        className="w-7 h-7 rounded-full bg-destructive/15 flex items-center justify-center"
                      >
                        <X className="w-3.5 h-3.5 text-destructive" />
                      </button>
                    )}
                  </div>
                </div>
                <Progress value={item.status === "complete" ? 100 : item.percent} className="h-2 bg-background/60" />
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="py-16 text-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Loading downloads...</p>
        </div>
      ) : downloads.length === 0 ? (
        <div className="py-16 text-center text-muted-foreground">
          <Download className="w-14 h-14 mx-auto mb-3 opacity-30" />
          <h3 className="text-base font-semibold mb-2 text-foreground">No downloads yet</h3>
          <p className="text-sm px-4">Open the video player and tap Download Episode to save videos.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {downloads.length > 0 && (
            <p className="text-xs text-muted-foreground">{downloads.length} videos saved</p>
          )}
          {downloads.map((item) => (
            <div key={item.id} className="glass-card rounded-xl p-3 flex items-center gap-3">
              <button onClick={() => handlePlay(item.id)}
                className="w-12 h-12 rounded-lg overflow-hidden flex items-center justify-center flex-shrink-0 relative">
                {item.poster ? (
                  <img src={item.poster} alt={item.title} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full gradient-primary flex items-center justify-center">
                    <Play className="w-5 h-5 text-primary-foreground" />
                  </div>
                )}
                <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                  <Play className="w-4 h-4 text-white" />
                </div>
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{item.title}</p>
                {item.subtitle && <p className="text-xs text-primary truncate">{item.subtitle}</p>}
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {formatSize(item.size)}
                  {item.quality ? ` • ${item.quality}` : ""}
                  {` • ${new Date(item.downloadedAt).toLocaleDateString("en-US")}`}
                </p>
              </div>
              <button onClick={() => handleDelete(item.id)}
                className="w-8 h-8 rounded-full bg-destructive/20 flex items-center justify-center flex-shrink-0 hover:bg-destructive/40 transition-colors">
                <Trash2 className="w-3.5 h-3.5 text-destructive" />
              </button>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
};

const ProfilePageInner = ({ onClose, allAnime = [], onCardClick, onContinueWatching, onLogout, onLoginClick }: ProfilePageProps) => {
  const navigate = useNavigate();
  const isGuestUser = (() => {
    try {
      const u = JSON.parse(localStorage.getItem("rsanime_user") || "{}");
      const email = String(u?.email || "");
      return !u?.id || u?.guest || email === "guest@rsanime.com" || email.endsWith("@guest.local");
    } catch { return true; }
  })();
  const brandingCfg = useBranding();
  const { wallet: coinWallet, settings: premiumSettings } = usePremium();
  const [activePanel, setActivePanel] = useState<"main" | "settings" | "edit" | "language" | "quality" | "notification-settings" | "premium" | "change-password" | "downloads" | "about" | "privacy">("main");
  const [profilePhoto, setProfilePhoto] = useState<string | null>(() => {
    try {
      const uid = JSON.parse(localStorage.getItem("rsanime_user") || "{}").id;
      return readProfilePhoto(uid);
    } catch { return null; }
  });
  const [displayName, setDisplayName] = useState(() => {
    try {
      const uid = JSON.parse(localStorage.getItem("rsanime_user") || "{}").id;
      return readDisplayName(uid) || "Guest User";
    } catch { return "Guest User"; }
  });
  const [tempName, setTempName] = useState(displayName);
  const fileRef = useRef<HTMLInputElement>(null);
  const profilePhotoStampRef = useRef(0);

  // Settings state
  const [selectedLanguage, setSelectedLanguage] = useState(() => {
    try { return localStorage.getItem("rs_language") || "English"; } catch { return "English"; }
  });
  const [selectedQuality, setSelectedQuality] = useState(() => {
    try { return localStorage.getItem("rs_quality") || "Auto"; } catch { return "Auto"; }
  });

  // Watchlist & History from Firebase
  const [watchlist, setWatchlist] = useState<any[]>(() => {
    try { return JSON.parse(localStorage.getItem("rs_watchlistCache") || "[]"); } catch { return []; }
  });
  const [watchHistory, setWatchHistory] = useState<any[]>(() => {
    try { return JSON.parse(localStorage.getItem("rs_continueCache") || "[]"); } catch { return []; }
  });
  const [viewAllMode, setViewAllMode] = useState<null | "history" | "watchlist">(null);
  const [isPremium, setIsPremium] = useState(false);
  const [premiumExpiry, setPremiumExpiry] = useState<number | null>(null);
  const [premiumMaxDevices, setPremiumMaxDevices] = useState(1);
  const [premiumDeviceCount, setPremiumDeviceCount] = useState(0);
  const [isCoAdmin, setIsCoAdmin] = useState(false);
  const [redeemInput, setRedeemInput] = useState("");
  const [redeemLoading, setRedeemLoading] = useState(false);
  const [bkashSettings, setBkashSettings] = useState<any>(null);
  const [selectedPlan, setSelectedPlan] = useState<any>(null);
  const [trxInput, setTrxInput] = useState("");
  const [trxSubmitting, setTrxSubmitting] = useState(false);
  const [pendingPaymentRequest, setPendingPaymentRequest] = useState<any | null>(null);
  const [editingPendingRequest, setEditingPendingRequest] = useState(false);
  const [bkashSenderNumber, setBkashSenderNumber] = useState("");
  const [paymentTab, setPaymentTab] = useState<"bkash" | "redeem">("bkash");
  const [deviceExceeded, setDeviceExceeded] = useState(false);
  const [deviceCheckDone, setDeviceCheckDone] = useState(false);

  // User-side APK download — admin sets URL + ON/OFF toggle from APK DW.
  // Paths: settings/apk/userEnabled (bool), settings/apk/userUrl (string).
  const [userApkEnabled, setUserApkEnabled] = useState<boolean>(true);
  const [userApkUrl, setUserApkUrl] = useState<string>("");
  useEffect(() => {
    const u1 = onValue(ref(db, "settings/apk/userEnabled"), (snap) => {
      const v = snap.val();
      setUserApkEnabled(v === undefined || v === null ? true : !!v);
    });
    const u2 = onValue(ref(db, "settings/apk/userUrl"), (snap) => {
      setUserApkUrl(String(snap.val() || ""));
    });
    return () => { u1(); u2(); };
  }, []);
  const handleDownloadUserApk = () => {
    const url = (userApkUrl || "").trim();
    if (!url) {
      toast.error("Download link is not configured yet");
      return;
    }

    const ok = triggerApkDownload(url, `${brandingCfg.siteName}.apk`);
    if (!ok) {
      toast.error("Download could not be started");
    }
  };

  const getUserId = (): string | null => {
    try {
      const user = localStorage.getItem("rsanime_user");
      if (user) return JSON.parse(user).id;
    } catch {}
    return null;
  };

  const getLocalAuthUser = (): { id?: string; email?: string; name?: string } => {
    try { return JSON.parse(localStorage.getItem("rsanime_user") || "{}"); } catch { return {}; }
  };

  const userId = getUserId();
  const premiumDaysLeft = premiumExpiry ? Math.max(0, Math.ceil((premiumExpiry - Date.now()) / 86400000)) : 0;
  const isPremiumExpiringSoon = isPremium && premiumDaysLeft <= 3;
  const dailyCoinCap = Math.max(1, Number(premiumSettings.dailyAdCap || 5));
  const remainingCoinAds = getTodayRemaining(coinWallet, dailyCoinCap);

  useEffect(() => {
    if (!userId) return;
    const localUser = getLocalAuthUser();
    const localEmail = String(localUser.email || "").trim();
    const emailAlias = buildEmailAliasKey(localEmail);
    const applyRemoteProfile = (data: any) => {
      if (!data || typeof data !== "object") return;
      const remotePhoto = String(data.profilePhoto || data.photoUrl || data.avatar || "").trim();
      const remotePhotoAt = Number(data.photoUpdatedAt || 0);
      const remoteName = String(data.name || localUser.name || "").trim();

      if (remotePhoto) {
        if (remotePhotoAt && remotePhotoAt < profilePhotoStampRef.current) return;
        if (remotePhotoAt) profilePhotoStampRef.current = remotePhotoAt;
        setProfilePhoto(remotePhoto);
        writeProfilePhoto(remotePhoto, userId);
      }
      if (remoteName && remoteName !== "Guest User") {
        setDisplayName(remoteName);
        setTempName(remoteName);
        writeDisplayName(remoteName, userId);
      }
    };

    // Bandwidth: subscribe only to the tiny profile fields. Subscribing to the
    // whole `users/{uid}` node re-downloads the full record on every heartbeat
    // / watch-history write.
    const subscribeProfileFields = (key: string) => {
      const state: any = {};
      const bind = (field: string) => onValue(ref(db, `users/${key}/${field}`), (snap) => {
        state[field] = snap.val();
        applyRemoteProfile(state);
      });
      const unsubs = ["name", "profilePhoto", "photoUpdatedAt"].map(bind);
      return () => unsubs.forEach((u) => u());
    };

    const unsubUser = subscribeProfileFields(userId);
    let unsubAlias: (() => void) | undefined;
    if (emailAlias && emailAlias !== userId) {
      unsubAlias = subscribeProfileFields(emailAlias);
    }

    return () => { unsubUser(); unsubAlias?.(); };
  }, [userId]);

  const handleDeleteThisPhoneLogin = useCallback(async () => {
    try {
      const uid = getUserId();
      if (uid) {
        const { unregisterCurrentDevice, clearLocalAccountSession } = await import("@/lib/premiumDevice");
        await unregisterCurrentDevice(uid);
        clearLocalAccountSession();
      } else {
        const { clearLocalAccountSession } = await import("@/lib/premiumDevice");
        clearLocalAccountSession();
      }
    } catch {
      const { clearLocalAccountSession } = await import("@/lib/premiumDevice");
      clearLocalAccountSession();
    }
    if (onLogout) onLogout();
    onClose();
  }, [onLogout, onClose]);

  useEffect(() => {
    if (!userId) return;
    const premRef = ref(db, `users/${userId}/premium`);
    const unsubPremium = onValue(premRef, (snap) => {
      const data = snap.val();
      if (data && data.active === true && data.expiresAt > Date.now()) {
        setIsPremium(true);
        setPremiumExpiry(data.expiresAt);
        setPremiumMaxDevices(data.maxDevices || 1);
        const devCount = data.devices ? Object.keys(data.devices).length : 0;
        setPremiumDeviceCount(devCount);
        setDeviceExceeded(false);
        setDeviceCheckDone(true);
      } else {
        setIsPremium(false);
        setPremiumExpiry(null);
        setDeviceExceeded(false);
        setDeviceCheckDone(true);
      }
    });

    const unsubCoAdmin = onValue(ref(db, `users/${userId}/coAdmin`), (snap) => {
      const v = snap.val();
      setIsCoAdmin(!!(v && v.enabled));
    });
    (window as any).__rs_coadmin_unsub__ = unsubCoAdmin;

    const wlRef = ref(db, `users/${userId}/watchlist`);
    const whRef = ref(db, `users/${userId}/watchHistory`);

    Promise.all([get(wlRef), get(whRef)]).then(([wlSnap, whSnap]) => {
      const wlData = wlSnap.val() || {};
      const wlItems = Object.values(wlData);
      setWatchlist(wlItems);
      try { localStorage.setItem("rs_watchlistCache", JSON.stringify(wlItems.slice(0, 80))); } catch {}

      const whData = whSnap.val() || {};
      const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
      const now = Date.now();
      const items = (Object.values(whData)
        .filter((v: any) => v && typeof v === "object" && v.id) as any[])
        .filter((i: any) => !i.watchedAt || (now - i.watchedAt) <= THIRTY_DAYS);
      items.sort((a: any, b: any) => (b.watchedAt || 0) - (a.watchedAt || 0));
      setWatchHistory(items);
      try { localStorage.setItem("rs_continueCache", JSON.stringify(items.slice(0, 50))); } catch {}
    }).catch(() => {});

    const idle = window.setTimeout(() => {
      const unsubBkash = onValue(ref(db, "bkashSettings"), (snap) => {
        setBkashSettings(snap.val());
      });
      const paymentQuery = query(ref(db, "bkashPayments"), orderByChild("userId"), equalTo(userId));
      const unsubPayments = onValue(paymentQuery, (snap) => {
        const items = Object.entries(snap.val() || {})
          .map(([id, item]: any) => ({ id, ...item }))
          .sort((a: any, b: any) => (b.submittedAt || 0) - (a.submittedAt || 0));

        const activePending = items.find((item: any) => item.status === "pending") || null;
        setPendingPaymentRequest(activePending);

        if (!activePending) {
          setEditingPendingRequest(false);
        }
      });

      (window as any).__rs_profile_cleanup__ = () => {
        unsubBkash();
        unsubPayments();
      };
    }, 250);

    return () => {
      unsubPremium();
      try { unsubCoAdmin(); } catch {}
      delete (window as any).__rs_coadmin_unsub__;
      window.clearTimeout(idle);
      const cleanup = (window as any).__rs_profile_cleanup__;
      if (typeof cleanup === "function") cleanup();
      delete (window as any).__rs_profile_cleanup__;
    };
  }, [userId]);

  const formatRemainingTime = (ms: number) => {
    if (ms <= 0) return "00h 00m";
    const totalMinutes = Math.floor(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours.toString().padStart(2, "0")}h ${minutes.toString().padStart(2, "0")}m`;
  };

  const startEditingPendingRequest = () => {
    if (!pendingPaymentRequest) return;

    const matchedPlan = (bkashSettings?.plans || []).find((plan: any) => (
      plan.id === pendingPaymentRequest.planId ||
      (plan.name === pendingPaymentRequest.planName && Number(plan.price) === Number(pendingPaymentRequest.planPrice))
    ));

    setSelectedPlan(matchedPlan || {
      id: pendingPaymentRequest.planId,
      name: pendingPaymentRequest.planName,
      price: pendingPaymentRequest.planPrice,
      days: pendingPaymentRequest.planDays,
    });
    setBkashSenderNumber(pendingPaymentRequest.bkashNumber || "");
    setTrxInput((pendingPaymentRequest.transactionId || "").toUpperCase());
    setPaymentTab("bkash");
    setEditingPendingRequest(true);
  };

  const [photoUploading, setPhotoUploading] = useState(false);

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    if (file.size > MAX_PHOTO_SIZE) { toast.error("Image must be under 10MB"); return; }
    if (!file.type.startsWith("image/")) { toast.error("Please select an image file"); return; }
    setPhotoUploading(true);
    try {
      // Compress to a small square JPEG so we can store the data URL locally
      // (instant preview, works for guests). For logged-in users we also push
      // a permanent ImgBB URL into users/{uid} so the photo follows the account
      // across devices — works identically for Google + email/password logins.
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const img = new Image();
          img.onload = () => {
            try {
              const SIZE = 256;
              const canvas = document.createElement("canvas");
              canvas.width = SIZE; canvas.height = SIZE;
              const ctx = canvas.getContext("2d");
              if (!ctx) return reject(new Error("canvas"));
              const ratio = Math.max(SIZE / img.width, SIZE / img.height);
              const w = img.width * ratio;
              const h = img.height * ratio;
              ctx.drawImage(img, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
              resolve(canvas.toDataURL("image/jpeg", 0.85));
            } catch (err) { reject(err as any); }
          };
          img.onerror = () => reject(new Error("image"));
          img.src = String(reader.result || "");
        };
        reader.onerror = () => reject(new Error("read"));
        reader.readAsDataURL(file);
      });

      // Instant local preview (guests + logged-in users)
      setProfilePhoto(dataUrl);
      writeProfilePhoto(dataUrl, userId);

      if (userId) {
        const localUser = getLocalAuthUser();
        const email = String(localUser.email || "").trim();
        const emailAlias = buildEmailAliasKey(email);
        // Permanent host upload so other devices can fetch it. Fall back to
        // the inline data URL if the host upload fails — Firebase RTDB accepts
        // values up to 10MB, and our 256×256 JPEG is ~25KB so it always fits.
        let finalUrl = dataUrl;
        try {
          const { uploadToImgbb } = await import("@/lib/imgbbUpload");
          finalUrl = await uploadToImgbb(file);
        } catch (err) {
          console.warn("[profile-photo] ImgBB failed, using inline copy", err);
        }
        try {
          const photoSavedAt = Date.now();
          profilePhotoStampRef.current = photoSavedAt;
          const photoPayload = {
            profilePhoto: finalUrl,
            photoUrl: finalUrl,
            avatar: finalUrl,
            photoUpdatedAt: photoSavedAt,
          };
          const writes: Promise<any>[] = [
            update(ref(db, `users/${userId}`), photoPayload),
          ];
          if (emailAlias) {
            writes.push(update(ref(db, `users/${emailAlias}`), { ...photoPayload, id: userId, email }));
            writes.push(update(ref(db, `appUsers/${emailAlias}`), photoPayload));
          }
          await Promise.all(writes);
          if (finalUrl !== dataUrl) {
            setProfilePhoto(finalUrl);
            writeProfilePhoto(finalUrl, userId);
          }
          try {
            const rawUser = localStorage.getItem("rsanime_user");
            const parsedUser = rawUser ? JSON.parse(rawUser) : {};
            localStorage.setItem("rsanime_user", JSON.stringify({ ...parsedUser, profilePhoto: finalUrl, photoUrl: finalUrl, avatar: finalUrl }));
            window.dispatchEvent(new Event("rs_auth_changed"));
          } catch {}
        } catch (err) {
          console.error("[profile-photo] Firebase write failed", err);
          throw err;
        }
      }
      toast.success("✅ Profile photo saved — synced across all your devices");
    } catch {
      toast.error("Could not process image. Try a different photo.");
    }
    setPhotoUploading(false);
  };

  const removePhoto = () => {
    setProfilePhoto(null);
    removeProfilePhoto(userId);
    if (userId) {
      const localUser = getLocalAuthUser();
      const emailAlias = buildEmailAliasKey(localUser.email);
      const photoRemovedAt = Date.now();
      profilePhotoStampRef.current = photoRemovedAt;
      const payload = { profilePhoto: null, photoUrl: null, avatar: null, photoUpdatedAt: photoRemovedAt };
      const writes: Promise<any>[] = [update(ref(db, `users/${userId}`), payload).catch(() => {})];
      if (emailAlias) {
        writes.push(update(ref(db, `users/${emailAlias}`), payload).catch(() => {}));
        writes.push(update(ref(db, `appUsers/${emailAlias}`), payload).catch(() => {}));
      }
      Promise.all(writes).catch(() => {});
    }
  };

  const saveName = () => {
    setDisplayName(tempName);
    writeDisplayName(tempName, userId);
    if (userId && tempName.trim()) {
      update(ref(db, `users/${userId}`), { name: tempName.trim() }).catch(() => {});
    }
    setActivePanel("main");
  };

  const saveLanguage = (lang: string) => {
    setSelectedLanguage(lang);
    localStorage.setItem("rs_language", lang);
  };

  const saveQuality = (q: string) => {
    setSelectedQuality(q);
    localStorage.setItem("rs_quality", q);
  };

  const initial = displayName.charAt(0).toUpperCase();

  const languages = ["English", "Bangla", "Hindi", "Japanese", "Korean", "Arabic"];
  const qualities = ["Auto", "1080p", "720p", "480p", "360p"];

  const handleAnimeClick = (item: any) => {
    // Watch-history items resume from saved position via continue-watching flow.
    const hasProgress = Number(item?.currentTime) > 0 && Number(item?.duration) > 0;
    if (hasProgress && onContinueWatching) {
      onClose();
      setTimeout(() => onContinueWatching(item), 100);
      return;
    }
    if (!onCardClick) return;
    const anime = allAnime.find(a => a.id === item.id);
    if (anime) {
      const seasonIdx = typeof item?.episodeInfo?.seasonIdx === "number"
        ? item.episodeInfo.seasonIdx
        : typeof item?.episodeInfo?.season === "number"
          ? Math.max(0, item.episodeInfo.season - 1)
          : undefined;
      const epIdx = typeof item?.episodeInfo?.epIdx === "number"
        ? item.episodeInfo.epIdx
        : typeof item?.episodeInfo?.episode === "number"
          ? Math.max(0, item.episodeInfo.episode - 1)
          : undefined;
      onClose();
      setTimeout(() => onCardClick(anime, seasonIdx, epIdx), 100);
    }
  };

  const removeFromWatchlist = (itemId: string) => {
    if (!userId) return;
    remove(ref(db, `users/${userId}/watchlist/${itemId}`));
  };

  const redeemCode = async () => {
    if (!userId || !redeemInput.trim()) { toast.error("Please enter a redeem code"); return; }
    setRedeemLoading(true);
    try {
      const codesSnap = await get(ref(db, "redeemCodes"));
      const codes = codesSnap.val() || {};
      let found = false;
      for (const [codeId, codeData] of Object.entries(codes) as any[]) {
        if (codeData.code === redeemInput.trim().toUpperCase() && !codeData.used) {
          found = true;
          const days = codeData.days || 30;
          const expiresAt = Date.now() + days * 24 * 60 * 60 * 1000;
          await set(ref(db, `users/${userId}/premium`), {
            active: true, expiresAt, redeemedAt: Date.now(), code: codeData.code
          });
          await update(ref(db, `redeemCodes/${codeId}`), {
            used: true, usedBy: userId, usedAt: Date.now()
          });
          toast.success(`Premium activated for ${days} days!`);
          setRedeemInput("");
          setActivePanel("main");
          break;
        }
      }
      if (!found) toast.error("Invalid or already used code");
    } catch (err: any) { toast.error("Error: " + err.message); }
    finally { setRedeemLoading(false); }
  };

  const submitBkashPayment = async () => {
    if (!userId || !selectedPlan || !trxInput.trim()) {
      toast.error("Enter Transaction ID");
      return;
    }
    if (!bkashSenderNumber.trim() || bkashSenderNumber.trim().length < 11) {
      toast.error("Enter your bKash number");
      return;
    }
    setTrxSubmitting(true);
    try {
      const isEditingExistingRequest = !!pendingPaymentRequest?.id;
      const userName = (() => { try { return JSON.parse(localStorage.getItem("rsanime_user") || "{}").name || "Unknown"; } catch { return "Unknown"; } })();
      const userEmail = (() => { try { return JSON.parse(localStorage.getItem("rsanime_user") || "{}").email || ""; } catch { return ""; } })();
      const paymentData = {
        userId,
        userName,
        userEmail,
        transactionId: trxInput.trim(),
        bkashNumber: bkashSenderNumber.trim(),
        planId: selectedPlan.id,
        planName: selectedPlan.name,
        planPrice: selectedPlan.price,
        planDays: selectedPlan.days,
        status: "pending",
        submittedAt: pendingPaymentRequest?.submittedAt || Date.now(),
        updatedAt: Date.now(),
      };

      if (isEditingExistingRequest) {
        await update(ref(db, `bkashPayments/${pendingPaymentRequest.id}`), paymentData);
      } else {
        const newRef = push(ref(db, "bkashPayments"));
        await set(newRef, paymentData);
      }

      // In-app admin notification inbox removed (Firebase bandwidth optimization).
      setEditingPendingRequest(false);
      setTrxInput("");
      setBkashSenderNumber("");
      toast.success(isEditingExistingRequest ? "Payment request updated!" : "Payment request submitted!");

      // 🔁 Instant auto-match attempt — if the SMS has already been forwarded
      // by the Android side, the user gets premium without admin intervention.
      try {
        const { tryMatchPayment } = await import("@/lib/bkashAutoMatcher");
        const reqId = isEditingExistingRequest
          ? pendingPaymentRequest!.id
          : (await get(query(ref(db, "bkashPayments"), orderByChild("transactionId"), equalTo(trxInput.trim()))));
        const requestSnapshot = isEditingExistingRequest
          ? { ...pendingPaymentRequest, ...paymentData, id: pendingPaymentRequest!.id }
          : (() => {
              const data = (reqId as any)?.val?.() || {};
              const entry = Object.entries<any>(data)[0];
              return entry ? { id: entry[0], ...entry[1] } : null;
            })();
        if (requestSnapshot) {
          const matched = await tryMatchPayment(requestSnapshot as any);
          if (matched) toast.success("⚡ Auto-verified! Premium activated instantly.");
        }
      } catch (matchErr) {
        console.warn("[bkash] auto-match attempt failed", matchErr);
      }
    } catch (err: any) {
      toast.error("Error: " + err.message);
    } finally {
      setTrxSubmitting(false);
    }
  };

  // Settings Panel
  if (activePanel === "settings") {
    return (
      <motion.div className="fixed inset-0 z-[200] bg-background overflow-y-auto pt-[70px] px-4 pb-24"
        initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
        transition={{ type: "tween", duration: 0.3 }}>
        <button onClick={() => setActivePanel("main")} className="flex items-center gap-2 mb-5 text-sm text-secondary-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-5 h-5" />
          <span className="font-medium">Settings</span>
        </button>
        <div className="space-y-3">
          <div onClick={() => setActivePanel("quality")} className="glass-card px-4 py-4 rounded-xl cursor-pointer transition-all hover:border-primary flex items-center gap-3">
            <Monitor className="w-5 h-5 text-primary" />
            <div className="flex-1">
              <p className="text-sm font-medium">Video Quality</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Current: {selectedQuality}</p>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </div>
          <div onClick={() => setActivePanel("language")} className="glass-card px-4 py-4 rounded-xl cursor-pointer transition-all hover:border-primary flex items-center gap-3">
            <Globe className="w-5 h-5 text-primary" />
            <div className="flex-1">
              <p className="text-sm font-medium">Language</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Current: {selectedLanguage}</p>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </div>
          <div onClick={() => setActivePanel("about")} className="glass-card px-4 py-4 rounded-xl cursor-pointer transition-all hover:border-primary flex items-center gap-3">
            <Info className="w-5 h-5 text-primary" />
            <div className="flex-1">
              <p className="text-sm font-medium">About</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Version 2.0</p>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </div>
          <div onClick={() => setActivePanel("privacy")} className="glass-card px-4 py-4 rounded-xl cursor-pointer transition-all hover:border-primary flex items-center gap-3">
            <Shield className="w-5 h-5 text-primary" />
            <div className="flex-1">
              <p className="text-sm font-medium">Privacy Policy</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Terms & data usage</p>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </div>

          {isCoAdmin && (
            <div className="mt-6">
              <p className="text-[11px] uppercase tracking-wider text-yellow-400 font-bold mb-2 px-1 flex items-center gap-1.5">
                <Crown className="w-3.5 h-3.5" /> Co-Admin Quick Tools
              </p>
              <div className="glass-card rounded-xl p-4 border border-yellow-500/30 space-y-3">
                <button
                  onClick={async () => {
                    if (!userId) return;
                    const premiumRef = ref(db, `users/${userId}/premium`);
                    const backupRef = ref(db, `users/${userId}/premiumRestoreBackup`);

                    try {
                      const now = Date.now();
                      const premiumSnap = await get(premiumRef);
                      const currentPremium = premiumSnap.val() || null;

                      if (currentPremium?.active === true && Number(currentPremium.expiresAt) > now) {
                        const remainingMs = Math.max(0, Number(currentPremium.expiresAt) - now);
                        await set(backupRef, {
                          snapshot: currentPremium,
                          remainingMs,
                          savedAt: now,
                        });

                        await set(premiumRef, {
                          ...currentPremium,
                          active: false,
                          pausedAt: now,
                          pausedBy: "co-admin-self",
                          pausedRemainingMs: remainingMs,
                        });

                        toast.success("✅ Premium disabled temporarily");
                        return;
                      }

                      const backupSnap = await get(backupRef);
                      const backup = backupSnap.val() || null;
                      const snapshot = backup?.snapshot || currentPremium;
                      const remainingMs = Math.max(
                        0,
                        Number(backup?.remainingMs || currentPremium?.pausedRemainingMs || 0),
                      );

                      if (!snapshot || remainingMs <= 0) {
                        toast.error("Saved premium time not found");
                        return;
                      }

                      await set(premiumRef, {
                        ...snapshot,
                        devices: currentPremium?.devices || snapshot?.devices || {},
                        active: true,
                        expiresAt: now + remainingMs,
                        restoredAt: now,
                        restoredBy: "co-admin-self",
                      });

                      await remove(backupRef);
                      toast.success("👑 Premium restored");
                    } catch (e: any) {
                      toast.error(e?.message || "Failed");
                    }
                  }}
                  className={`w-full py-2.5 rounded-lg text-sm font-bold transition-all ${
                    isPremium
                      ? "bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/30"
                      : "bg-gradient-to-r from-yellow-500 to-orange-500 text-black"
                  }`}
                >
                  {isPremium ? "🚫 Disable Premium" : "⚡ Restore Premium"}
                </button>
                <button
                  onClick={() => {
                    const expiry = Date.now() + 24 * 60 * 60 * 1000;
                    localStorage.setItem("rsanime_ad_access", expiry.toString());
                    toast.success("🎁 Free Access activated (24h)");
                  }}
                  className="w-full py-2.5 rounded-lg text-sm font-bold bg-purple-500/15 hover:bg-purple-500/25 text-purple-300 border border-purple-500/30 transition-all"
                >
                  🎁 Grant Self Free Access (24h)
                </button>
                <button
                  onClick={() => {
                    localStorage.removeItem("rsanime_ad_access");
                    toast.success("Free access cleared");
                  }}
                  className="w-full py-2.5 rounded-lg text-sm font-bold bg-white/5 hover:bg-white/10 text-foreground border border-white/10 transition-all"
                >
                  🧹 Clear Free Access
                </button>
                <a
                  href="/admin"
                  className="block w-full text-center py-2.5 rounded-lg text-sm font-bold bg-gradient-to-r from-primary to-accent text-white transition-all"
                >
                  🛡️ Open Full Admin Panel
                </a>
                <p className="text-[10px] text-muted-foreground text-center">
                  Sign in to /admin with your Google account (already authorized).
                </p>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    );
  }

  // Language Panel
  if (activePanel === "language") {
    return (
      <motion.div className="fixed inset-0 z-[200] bg-background overflow-y-auto pt-[70px] px-4 pb-24"
        initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
        transition={{ type: "tween", duration: 0.3 }}>
        <button onClick={() => setActivePanel("settings")} className="flex items-center gap-2 mb-5 text-sm text-secondary-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-5 h-5" />
          <span className="font-medium">Language</span>
        </button>
        <div className="space-y-2">
          {languages.map((lang) => (
            <div key={lang} onClick={() => saveLanguage(lang)}
              className={`glass-card px-4 py-4 rounded-xl cursor-pointer transition-all flex items-center justify-between ${selectedLanguage === lang ? "border-primary bg-primary/10" : "hover:border-primary/50"}`}>
              <span className="text-sm font-medium">{lang}</span>
              {selectedLanguage === lang && <span className="w-5 h-5 rounded-full bg-primary flex items-center justify-center"><Check className="w-3 h-3 text-primary-foreground" /></span>}
            </div>
          ))}
        </div>
      </motion.div>
    );
  }

  // Quality Panel
  if (activePanel === "quality") {
    return (
      <motion.div className="fixed inset-0 z-[200] bg-background overflow-y-auto pt-[70px] px-4 pb-24"
        initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
        transition={{ type: "tween", duration: 0.3 }}>
        <button onClick={() => setActivePanel("settings")} className="flex items-center gap-2 mb-5 text-sm text-secondary-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-5 h-5" />
          <span className="font-medium">Video Quality</span>
        </button>
        <p className="text-xs text-muted-foreground mb-4">Select default streaming quality. Higher quality uses more data.</p>
        <div className="space-y-2">
          {qualities.map((q) => (
            <div key={q} onClick={() => saveQuality(q)}
              className={`glass-card px-4 py-4 rounded-xl cursor-pointer transition-all flex items-center justify-between ${selectedQuality === q ? "border-primary bg-primary/10" : "hover:border-primary/50"}`}>
              <div>
                <span className="text-sm font-medium">{q}</span>
                {q === "Auto" && <p className="text-[10px] text-muted-foreground">Adjusts based on your connection</p>}
              </div>
              {selectedQuality === q && <span className="w-5 h-5 rounded-full bg-primary flex items-center justify-center"><Check className="w-3 h-3 text-primary-foreground" /></span>}
            </div>
          ))}
        </div>
      </motion.div>
    );
  }

  // About Panel
  if (activePanel === "about") {
    return <AboutPage onBack={() => setActivePanel("settings")} siteName={brandingCfg.siteName} />;
  }

  // Privacy Policy Panel
  if (activePanel === "privacy") {
    return <PrivacyPolicyPage onBack={() => setActivePanel("settings")} siteName={brandingCfg.siteName} />;
  }

  // Notification Settings panel removed — FCM disabled site-wide

  // Premium Panel
  if (activePanel === "premium") {
    const activePlans = (bkashSettings?.plans || []).filter((p: any) => p.active !== false);
    const hasBkash = bkashSettings?.phoneNumber;
    const pendingReviewMs = pendingPaymentRequest
      ? (pendingPaymentRequest.submittedAt || Date.now()) + PAYMENT_REVIEW_WINDOW_MS - Date.now()
      : 0;
    const showPendingRequest = !!pendingPaymentRequest && !editingPendingRequest;

    const renderPaymentOptions = () => (
      <>
        {hasBkash && (
          <div className="flex gap-2 mb-4">
            <button onClick={() => setPaymentTab("bkash")}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors ${paymentTab === "bkash" ? "bg-[#E2136E] text-white" : "bg-foreground/10 text-foreground"}`}>
              📱 bKash Payment
            </button>
            <button onClick={() => setPaymentTab("redeem")}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors ${paymentTab === "redeem" ? "premium-gradient text-primary-foreground" : "bg-foreground/10 text-foreground"}`}>
              🎁 Redeem Code
            </button>
          </div>
        )}

        {(paymentTab === "bkash" && hasBkash) ? (
          <div>
            <div className="premium-card p-4 rounded-2xl mb-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <h4 className="text-sm font-semibold premium-text">📦 {isPremium ? "Extend or Renew Your Plan" : editingPendingRequest ? "Edit Payment Request" : "Select a Plan"}</h4>
                {editingPendingRequest && (
                  <button
                    onClick={() => setEditingPendingRequest(false)}
                    className="text-[11px] px-3 py-1.5 rounded-lg bg-foreground/10 text-muted-foreground hover:bg-foreground/15 transition-colors"
                  >
                    Cancel Edit
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {activePlans.map((plan: any) => (
                  <div key={plan.id} onClick={() => setSelectedPlan(plan)}
                    className={`p-3.5 rounded-xl border-2 cursor-pointer transition-all ${selectedPlan?.id === plan.id ? "border-[#E2136E] bg-[#E2136E]/10" : "border-foreground/10 bg-foreground/5 hover:border-foreground/20"}`}>
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="text-sm font-bold">{plan.name}</p>
                        <p className="text-[11px] text-muted-foreground">{plan.days} days Ad-Free</p>
                        {plan.maxDevices && (
                          <p className="text-[10px] mt-0.5 flex items-center gap-1" style={{ color: "hsl(45,90%,55%)" }}>
                            <Smartphone className="w-3 h-3" /> Up to {plan.maxDevices} devices
                          </p>
                        )}
                      </div>
                      <p className="text-lg font-extrabold text-[#E2136E]">৳{plan.price}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {selectedPlan && (
              <div className="premium-card p-4 rounded-2xl mb-4">
                <h4 className="text-sm font-semibold mb-3 text-[#E2136E]">📲 {editingPendingRequest ? "Update Your Request" : "Complete Payment"}</h4>

                <div className="bg-[#E2136E]/10 border border-[#E2136E]/30 rounded-xl p-3 mb-3">
                  <p className="text-xs text-muted-foreground mb-1">{bkashSettings.accountType} number:</p>
                  <p className="text-lg font-bold text-[#E2136E] tracking-wider">{bkashSettings.phoneNumber}</p>
                  <p className="text-xs text-muted-foreground mt-1">Amount: <span className="font-bold text-foreground">৳{selectedPlan.price}</span></p>
                </div>

                {bkashSettings.instructions && (
                  <p className="text-xs text-muted-foreground mb-3 leading-relaxed">{bkashSettings.instructions}</p>
                )}

                {bkashSettings.qrCodeLink && (
                  <div className="text-center mb-3">
                    <p className="text-xs text-muted-foreground mb-2">Scan the QR code:</p>
                    <img src={bkashSettings.qrCodeLink} alt="bKash QR" className="w-40 h-40 mx-auto rounded-xl border border-foreground/10" />
                  </div>
                )}

                <div className="mb-3">
                  <label className="text-xs text-muted-foreground mb-1 block">Your bKash Number</label>
                  <input value={bkashSenderNumber} onChange={e => setBkashSenderNumber(e.target.value)}
                    placeholder="01XXXXXXXXX" maxLength={11}
                    className="w-full py-3 px-4 rounded-xl bg-foreground/10 border border-foreground/10 text-foreground text-sm focus:border-[#E2136E] focus:outline-none transition-colors" />
                </div>

                <div className="mb-3">
                  <label className="text-xs text-muted-foreground mb-1 block">Transaction ID</label>
                  <input value={trxInput} onChange={e => setTrxInput(e.target.value.toUpperCase())}
                    placeholder="Example: 0A1B2C3D4E"
                    className="w-full py-3 px-4 rounded-xl bg-foreground/10 border border-foreground/10 text-foreground text-sm font-mono tracking-wider focus:border-[#E2136E] focus:outline-none transition-colors" />
                </div>

                <button onClick={submitBkashPayment} disabled={trxSubmitting || !trxInput.trim() || !bkashSenderNumber.trim()}
                  className="w-full py-3 rounded-xl bg-[#E2136E] text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-50 transition-colors hover:bg-[#C8115F]">
                  {trxSubmitting ? "Submitting..." : editingPendingRequest ? "✅ Update Request" : "✅ Submit Request"}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="premium-card p-4 rounded-2xl mb-4">
            <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Gift className="w-4 h-4" style={{ color: "hsl(45,90%,55%)" }} /> Enter Redeem Code
            </h4>
            <input
              value={redeemInput}
              onChange={e => setRedeemInput(e.target.value.toUpperCase())}
              placeholder=""
              className="w-full py-3 px-4 rounded-xl bg-foreground/10 border border-foreground/10 text-foreground text-sm font-mono tracking-widest focus:border-primary focus:outline-none transition-colors mb-3 text-center"
            />
            <button onClick={redeemCode} disabled={redeemLoading}
              className="w-full py-3 rounded-xl premium-gradient font-semibold flex items-center justify-center gap-2 disabled:opacity-50" style={{ color: "hsl(30,20%,8%)" }}>
              {redeemLoading ? "Verifying..." : "Activate"}
            </button>
          </div>
        )}

        <a href={TELEGRAM_ADMIN_URL} target="_blank" rel="noopener noreferrer"
          className="block w-full py-3 rounded-xl bg-[#0088cc] text-white font-semibold text-center text-sm transition-colors hover:opacity-90">
          📩 Need help? Contact Owner
        </a>
      </>
    );

    return (
      <motion.div className="fixed inset-0 z-[200] overflow-y-auto pt-[70px] px-4 pb-24"
        style={{ background: isPremium ? "linear-gradient(180deg, hsl(30,20%,6%) 0%, hsl(215,35%,7%) 100%)" : "hsl(215,35%,7%)" }}
        initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
        transition={{ type: "tween", duration: 0.3 }}>
        <button onClick={() => { setActivePanel("main"); setSelectedPlan(null); setEditingPendingRequest(false); }} className="flex items-center gap-2 mb-5 text-sm text-secondary-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-5 h-5" />
          <span className="font-medium">{isPremium ? "Premium Status" : "Get Premium"}</span>
        </button>

        {showPendingRequest ? (
          <div>
            <div className="premium-card-glow p-6 rounded-2xl mb-5 relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-1 premium-gradient" />
              <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: "hsla(45,90%,55%,0.15)", border: "1px solid hsla(45,90%,55%,0.3)" }}>
                <Clock className="w-8 h-8" style={{ color: "hsl(45,90%,55%)" }} />
              </div>
              <h3 className="text-lg font-bold text-center premium-text mb-2">Payment Request Submitted</h3>
              <p className="text-sm text-secondary-foreground text-center mb-3">Your request is under review. Please wait while we verify your payment.</p>
              <div className="rounded-xl bg-foreground/5 border border-foreground/10 p-3 space-y-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Plan</span>
                  <span className="font-semibold">{pendingPaymentRequest.planName} • ৳{pendingPaymentRequest.planPrice}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Transaction ID</span>
                  <span className="font-mono font-semibold">{pendingPaymentRequest.transactionId}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">bKash Number</span>
                  <span className="font-semibold">{pendingPaymentRequest.bkashNumber || "—"}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Time left</span>
                  <span className="font-semibold" style={{ color: pendingReviewMs > 0 ? "hsl(45,90%,55%)" : "hsl(var(--destructive))" }}>
                    {pendingReviewMs > 0 ? formatRemainingTime(pendingReviewMs) : "Review time passed"}
                  </span>
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button
                  onClick={startEditingPendingRequest}
                  className="flex-1 py-3 rounded-xl bg-[#E2136E] text-white font-semibold transition-colors hover:bg-[#C8115F]"
                >
                  Edit Request
                </button>
                <button
                  onClick={() => setActivePanel("main")}
                  className="flex-1 py-3 rounded-xl bg-foreground/10 text-foreground font-semibold transition-colors hover:bg-foreground/15"
                >
                  Back
                </button>
              </div>
            </div>

            {isPremium && (
              <div className="premium-card rounded-2xl p-4 mb-4">
                <h4 className="text-sm font-semibold premium-text mb-2">Current Subscription</h4>
                <p className="text-sm text-secondary-foreground">Active until {premiumExpiry ? new Date(premiumExpiry).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "N/A"}</p>
              </div>
            )}
          </div>
        ) : isPremium ? (
          <div>
            {/* Premium Active Hero Card */}
            <div className="premium-card-glow p-6 rounded-2xl text-center mb-5 relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-1 premium-gradient" />
              <div className="w-16 h-16 mx-auto mb-3 relative" style={{ animation: "crownFloat 3s ease-in-out infinite" }}>
                <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "linear-gradient(135deg, hsl(45,90%,55%), hsl(30,85%,45%))" }}>
                  <Crown className="w-8 h-8" style={{ color: "hsl(30,20%,8%)" }} />
                </div>
              </div>
              <h3 className="text-xl font-bold premium-text mb-1">Premium Active</h3>
              <p className="text-sm text-secondary-foreground">
                Expires: {premiumExpiry ? new Date(premiumExpiry).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "N/A"}
              </p>
              <div className="flex items-center justify-center gap-4 mt-3">
                <div className="text-center">
                  <p className="text-xs text-muted-foreground">Days Left</p>
                  <p className="text-lg font-bold premium-text">{premiumDaysLeft}</p>
                </div>
                <div className="w-px h-8 bg-foreground/10" />
                <div className="text-center">
                  <p className="text-xs text-muted-foreground">Devices</p>
                  <p className="text-lg font-bold premium-text">{premiumDeviceCount}/{premiumMaxDevices}</p>
                </div>
              </div>
            </div>

            {/* Premium Benefits */}
            <div className="premium-card rounded-2xl p-4 mb-4">
              <h4 className="text-sm font-semibold premium-text mb-3 flex items-center gap-2">
                <Sparkles className="w-4 h-4" style={{ color: "hsl(45,90%,55%)" }} /> Premium Benefits
              </h4>
              <div className="space-y-2.5">
                {[
                  { icon: "🚫", text: "Ad-free streaming" },
                  { icon: "📺", text: "4K quality access" },
                  { icon: "⚡", text: "Priority support" },
                  { icon: "🔒", text: "Exclusive content" },
                ].map((b, i) => (
                  <div key={i} className="flex items-center gap-3 py-1.5">
                    <span className="text-base">{b.icon}</span>
                    <span className="text-sm text-foreground/90">{b.text}</span>
                    <Check className="w-4 h-4 ml-auto" style={{ color: "hsl(45,90%,55%)" }} />
                  </div>
                ))}
              </div>
            </div>

            {/* Device Info */}
            <div className="premium-card rounded-2xl p-4 mb-4">
              <h4 className="text-sm font-semibold premium-text mb-3 flex items-center gap-2">
                <Smartphone className="w-4 h-4" style={{ color: "hsl(45,90%,55%)" }} /> Device Usage
              </h4>
              <div className="flex items-center gap-3 mb-3">
                <div className="flex-1 h-2 rounded-full bg-foreground/10 overflow-hidden">
                  <div className="h-full rounded-full premium-gradient transition-all" style={{ width: `${(premiumDeviceCount / premiumMaxDevices) * 100}%` }} />
                </div>
                <span className="text-xs font-mono text-muted-foreground">{premiumDeviceCount}/{premiumMaxDevices}</span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {premiumDeviceCount >= premiumMaxDevices
                  ? "⚠️ Device limit reached. Remove a device from another account to add new ones."
                  : `You can use ${premiumMaxDevices - premiumDeviceCount} more device${premiumMaxDevices - premiumDeviceCount > 1 ? "s" : ""}.`}
              </p>
            </div>

            <div className={`rounded-2xl p-4 mb-4 border ${isPremiumExpiringSoon ? "border-destructive/40 bg-destructive/10 animate-pulse" : "border-primary/20 bg-primary/5"}`}>
              <div className="flex items-start gap-3">
                <AlertTriangle className={`w-5 h-5 mt-0.5 ${isPremiumExpiringSoon ? "text-destructive" : "text-primary"}`} />
                <div>
                  <p className="text-sm font-semibold text-foreground">{isPremiumExpiringSoon ? "Your premium plan is ending soon" : "Want to extend your plan?"}</p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {isPremiumExpiringSoon
                      ? "Renew now to avoid interruption. Your profile card will keep glowing red until you extend it."
                      : "You can buy another plan below and extend your expiry date instantly after approval."}
                  </p>
                </div>
              </div>
            </div>

            {renderPaymentOptions()}
          </div>
        ) : deviceExceeded && deviceCheckDone ? (
          /* Device Limit Exceeded Screen */
          <div>
            <div className="premium-card-glow p-6 rounded-2xl text-center mb-5">
              <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ background: "hsla(0,84%,60%,0.15)", border: "1px solid hsla(0,84%,60%,0.3)" }}>
                <AlertTriangle className="w-8 h-8 text-destructive" />
              </div>
              <h3 className="text-lg font-bold text-destructive mb-2">Device Limit Exceeded</h3>
              <p className="text-sm text-secondary-foreground mb-1">
                Your premium subscription supports up to <strong>{premiumMaxDevices}</strong> devices.
              </p>
              <p className="text-xs text-muted-foreground">
                Currently {premiumDeviceCount} devices are active. This device is new.
              </p>
            </div>

            <div className="space-y-3">
              {/* Option 1: Activate on this device */}
              <button
                onClick={async () => {
                  if (!userId) return;
                  try {
                    const { activateOnThisDevice } = await import("@/lib/premiumDevice");
                    const ok = await activateOnThisDevice(userId);
                    if (ok) {
                      setDeviceExceeded(false);
                      toast.success("This device is now activated! Premium will work here.");
                    } else {
                      toast.error("Failed to activate on this device");
                    }
                  } catch { toast.error("Error activating device"); }
                }}
                className="w-full p-4 rounded-2xl text-left transition-all premium-card hover:border-[hsla(45,90%,55%,0.4)]"
                style={{ border: "1px solid hsla(45,90%,55%,0.25)" }}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "hsla(45,90%,55%,0.15)" }}>
                    <Shield className="w-5 h-5" style={{ color: "hsl(45,90%,55%)" }} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold premium-text">Activate Premium Here</p>
                    <p className="text-[11px] text-muted-foreground">Another device will be removed and premium activated here</p>
                  </div>
                </div>
              </button>

              {/* Option 2: Delete account from this phone */}
              <button
                onClick={handleDeleteThisPhoneLogin}
                className="w-full p-4 rounded-2xl text-left glass-card transition-all hover:border-destructive"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-destructive/15 border border-destructive/30 flex items-center justify-center flex-shrink-0">
                    <LogOut className="w-5 h-5 text-destructive" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">Delete ID & Logout from this phone</p>
                    <p className="text-[11px] text-muted-foreground">This will log you out and redirect to the login page</p>
                  </div>
                </div>
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Premium Features Card */}
            <div className="premium-card-glow p-5 rounded-2xl text-center mb-4 relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-1 premium-gradient" />
              <Crown className="w-14 h-14 mx-auto mb-3" style={{ color: "hsl(45,90%,55%)", animation: "crownFloat 3s ease-in-out infinite" }} />
              <h3 className="text-xl font-bold premium-text mb-3">{brandingCfg.premiumTitle}</h3>
              <div className="space-y-2.5 text-left">
                {[
                  { icon: "🚫", text: "Ad-free streaming" },
                  { icon: "📺", text: "4K Ultra HD quality" },
                  { icon: "⚡", text: "Uninterrupted streaming" },
                  { icon: "💎", text: "Support the creators" },
                ].map((f, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm">
                    <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs" style={{ background: "hsla(45,90%,55%,0.15)" }}>{f.icon}</span>
                    <span className="text-foreground/90">{f.text}</span>
                  </div>
                ))}
              </div>
            </div>

            {renderPaymentOptions()}
          </>
        )}
      </motion.div>
    );
  }

  // Downloads Panel
  if (activePanel === "downloads") {
    return <DownloadsPanel onBack={() => setActivePanel("main")} />;
  }

  // Change Password Panel
  if (activePanel === "change-password") {
    return <ChangePasswordPanel onBack={() => setActivePanel("edit")} />;
  }

  // Edit Profile Panel
  if (activePanel === "edit") {
    const isGoogleUser = (() => {
      try {
        const u = JSON.parse(localStorage.getItem("rsanime_user") || "{}");
        // Check if user logged in via Google (no password in appUsers)
        return !!u.email && !localStorage.getItem("rs_has_password");
      } catch { return false; }
    })();

    // Check if user has password (email login user)
    const hasPassword = (() => {
      try {
        const u = JSON.parse(localStorage.getItem("rsanime_user") || "{}");
        return !!u.email;
      } catch { return false; }
    })();

    return (
      <motion.div className="fixed inset-0 z-[200] bg-background overflow-y-auto pt-[70px] px-4 pb-24"
        initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
        transition={{ type: "tween", duration: 0.3 }}>
        <button onClick={() => setActivePanel("main")} className="flex items-center gap-2 mb-5 text-sm text-secondary-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-5 h-5" />
          <span className="font-medium">Edit Profile</span>
        </button>
        <div className="text-center mb-8">
          <div className="relative inline-block">
            {profilePhoto ? (
              <div className="relative">
                <img src={profilePhoto} alt="Profile" className="w-[100px] h-[100px] rounded-full object-cover border-4 border-primary/30 shadow-[0_10px_40px_hsla(355,85%,55%,0.3)]" />
                <button onClick={removePhoto} className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-destructive flex items-center justify-center">
                  <X className="w-3 h-3 text-white" />
                </button>
              </div>
            ) : (
              <div className="w-[100px] h-[100px] rounded-full gradient-primary flex items-center justify-center text-[42px] font-extrabold shadow-[0_10px_40px_hsla(355,85%,55%,0.4)] border-4 border-foreground/10">
                {initial}
              </div>
            )}
            <button disabled={photoUploading} onClick={() => fileRef.current?.click()} className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-primary flex items-center justify-center shadow-lg disabled:opacity-70">
              {photoUploading ? <Loader2 className="w-4 h-4 text-primary-foreground animate-spin" /> : <Camera className="w-4 h-4 text-primary-foreground" />}
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">Max 10MB • JPG, PNG, WebP</p>
        </div>
        <div className="mb-6">
          <label className="text-xs text-muted-foreground mb-2 block">Display Name</label>
          <input type="text" value={tempName} onChange={(e) => setTempName(e.target.value)} maxLength={30}
            className="w-full py-3 px-4 rounded-xl bg-foreground/10 border border-foreground/10 text-foreground text-sm focus:border-primary focus:outline-none focus:shadow-[0_0_20px_hsla(355,85%,55%,0.3)] transition-all" />
        </div>
        <button onClick={saveName} className="w-full py-3 rounded-xl gradient-primary text-primary-foreground font-semibold flex items-center justify-center gap-2 transition-all hover:opacity-90 mb-4">
          <Save className="w-4 h-4" /> Save Changes
        </button>

        {/* Change/Set Password Button - show for all users */}
        <button onClick={() => setActivePanel("change-password")}
          className="w-full py-3 rounded-xl bg-foreground/10 border border-foreground/10 text-foreground font-medium flex items-center justify-center gap-2 transition-all hover:border-primary text-sm">
          <Lock className="w-4 h-4 text-primary" /> Password settings
        </button>
      </motion.div>
    );
  }

  // Main Profile
  return (
    <motion.div className="fixed inset-0 z-[200] bg-background overflow-y-auto pt-[70px] px-4 pb-24"
      initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
      transition={{ type: "tween", duration: 0.24, ease: [0.32, 0.72, 0, 1] }}>
      <button onClick={onClose} className="flex items-center gap-2 mb-5 text-sm text-secondary-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="w-5 h-5" />
        <span className="font-medium">Back</span>
      </button>

      {/* Avatar - Premium styled */}
      <div className="text-center mb-7">
        <div className="relative inline-block">
          {profilePhoto ? (
            <img src={profilePhoto} alt="Profile" className={`w-[100px] h-[100px] rounded-full object-cover mx-auto mb-4 border-4 ${isPremium ? "" : "border-foreground/10"}`}
              style={isPremium ? { borderColor: "hsl(45,90%,55%)", boxShadow: "0 10px 40px hsla(45,90%,55%,0.3)" } : { boxShadow: "0 10px 40px hsla(355,85%,55%,0.4)" }} />
          ) : (
            <div className={`w-[100px] h-[100px] rounded-full mx-auto mb-4 flex items-center justify-center text-[42px] font-extrabold border-4 ${isPremium ? "" : "gradient-primary border-foreground/10"}`}
              style={isPremium ? { background: "linear-gradient(135deg, hsl(45,90%,55%), hsl(30,85%,45%))", borderColor: "hsl(45,90%,55%)", boxShadow: "0 10px 40px hsla(45,90%,55%,0.3)", color: "hsl(30,20%,8%)" } : { boxShadow: "0 10px 40px hsla(355,85%,55%,0.4)" }}>
              {initial}
            </div>
          )}
          {isPremium && (
            <div className="absolute -top-1 -right-1 w-7 h-7 rounded-full flex items-center justify-center premium-gradient" style={{ boxShadow: "0 2px 10px hsla(45,90%,55%,0.5)" }}>
              <Crown className="w-4 h-4" style={{ color: "hsl(30,20%,8%)" }} />
            </div>
          )}
        </div>
        <h2 className="text-2xl font-bold mb-1">{displayName}</h2>
        {isPremium && (
          <span className="inline-block px-3 py-0.5 rounded-full text-[10px] font-bold premium-badge mb-1">
            ⭐ PREMIUM MEMBER
          </span>
        )}
        <p className="text-sm text-secondary-foreground">
          {(() => {
            try {
              const u = JSON.parse(localStorage.getItem("rsanime_user") || "{}");
              const email = String(u.email || "");
              return email === "guest@rsanime.com" || u.guest ? "Guest Profile" : email;
            } catch { return "Guest Profile"; }
          })()}
        </p>
      </div>


      {/* Free / Global Access Timer */}
      <AccessTimer />

      {/* Get Free Coins — daily tasks entry (permanent) */}
      <button
        type="button"
        onClick={() => navigate("/daily-tasks")}
        className="w-full mb-7 rounded-2xl p-4 text-left border border-amber-400/30 bg-gradient-to-r from-amber-500/15 via-yellow-500/10 to-orange-500/5 active:scale-[0.99] transition-transform relative overflow-hidden group"
      >
        <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-amber-400/10 blur-2xl pointer-events-none" />
        <div className="flex items-center gap-3 relative">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-400 to-yellow-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-amber-500/25">
            <Coins className="w-6 h-6 text-black" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-black text-amber-200 leading-none">Get Free Coins</p>
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-300 uppercase tracking-wider">Daily</span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground leading-tight">
              5 daily tasks • Earn coins • Redeem Premium — Balance: <b className="text-amber-300">{coinWallet.coins || 0}</b>
            </p>
          </div>
          <span className="text-amber-300 text-xl font-black flex-shrink-0">›</span>
        </div>
      </button>





      {/* Watch History */}
      <div className="mb-7">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-bold flex items-center category-bar">Watch History</h3>
          {watchHistory.length > 0 && (
            <button
              onClick={() => setViewAllMode("history")}
              className="text-xs text-primary flex items-center gap-1 hover:underline"
            >
              View All <ChevronRight className="w-3 h-3" />
            </button>
          )}
        </div>
        {watchHistory.length === 0 ? (
          <div className="text-center py-8">
            <History className="w-10 h-10 text-muted-foreground/50 mx-auto mb-2.5" />
            <p className="text-sm text-secondary-foreground">No watch history yet</p>
          </div>
        ) : (
          <div className="flex gap-2.5 overflow-x-auto pb-2 scrollbar-hide">
            {watchHistory.slice(0, 10).map((item: any) => (
              <div key={item.id} onClick={() => handleAnimeClick(item)}
                className="flex-shrink-0 w-[100px] cursor-pointer">
                <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-card mb-1">
                  <img src={optimizedImageUrl(item.poster, "poster")} alt={item.title} className="poster-img w-full h-full object-cover" loading="eager" decoding="async" />
                  <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.9) 0%, transparent 50%)" }} />
                  <div className="absolute bottom-1 left-1 right-1">
                    <p className="text-[9px] font-semibold leading-tight line-clamp-2">{item.title}</p>
                    {item.episodeInfo && (
                      <p className="text-[8px] text-primary mt-0.5">
                        S{item.episodeInfo.season} E{item.episodeInfo.episodeNumber || item.episodeInfo.episode}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Watchlist */}
      <div className="mb-7">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-bold flex items-center category-bar">My Watchlist</h3>
          {watchlist.length > 0 && (
            <button
              onClick={() => setViewAllMode("watchlist")}
              className="text-xs text-primary flex items-center gap-1 hover:underline"
            >
              View All <ChevronRight className="w-3 h-3" />
            </button>
          )}
        </div>
        {watchlist.length === 0 ? (
          <div className="text-center py-8">
            <Bookmark className="w-10 h-10 text-muted-foreground/50 mx-auto mb-2.5" />
            <p className="text-sm text-secondary-foreground">No items in watchlist</p>
          </div>
        ) : (
          <div className="flex gap-2.5 overflow-x-auto pb-2 scrollbar-hide">
            {watchlist.slice(0, 10).map((item: any) => (
              <div key={item.id} onClick={() => handleAnimeClick(item)}
                className="flex-shrink-0 w-[100px] cursor-pointer relative">
                <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-card mb-1">
                  <img src={optimizedImageUrl(item.poster, "poster")} alt={item.title} className="poster-img w-full h-full object-cover" loading="eager" decoding="async" />
                  <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.9) 0%, transparent 50%)" }} />
                  <button onClick={(e) => { e.stopPropagation(); removeFromWatchlist(item.id); }}
                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-destructive/80 flex items-center justify-center">
                    <X className="w-3 h-3 text-white" />
                  </button>
                  <div className="absolute bottom-1 left-1 right-1">
                    <p className="text-[9px] font-semibold leading-tight line-clamp-2">{item.title}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* View All Overlay (full grid of history or watchlist) */}
      <AnimatePresence>
        {viewAllMode && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[400] bg-background flex flex-col"
          >
            <div className="sticky top-0 z-10 flex items-center gap-3 px-4 py-3 border-b border-border/40 bg-background/95 backdrop-blur">
              <button
                onClick={() => setViewAllMode(null)}
                className="w-9 h-9 rounded-full bg-secondary/60 flex items-center justify-center hover:bg-secondary"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div className="flex-1">
                <h2 className="text-base font-bold">
                  {viewAllMode === "history" ? "Watch History" : "My Watchlist"}
                </h2>
                <p className="text-[11px] text-muted-foreground">
                  {viewAllMode === "history"
                    ? `${watchHistory.length} items · last 30 days`
                    : `${watchlist.length} items`}
                </p>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3">
              {(viewAllMode === "history" ? watchHistory : watchlist).length === 0 ? (
                <div className="text-center py-16">
                  {viewAllMode === "history"
                    ? <History className="w-12 h-12 text-muted-foreground/50 mx-auto mb-3" />
                    : <Bookmark className="w-12 h-12 text-muted-foreground/50 mx-auto mb-3" />}
                  <p className="text-sm text-muted-foreground">
                    {viewAllMode === "history" ? "No watch history yet" : "No items in watchlist"}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-3">
                  {(viewAllMode === "history" ? watchHistory : watchlist).map((item: any) => (
                    <div
                      key={item.id}
                      onClick={() => { setViewAllMode(null); handleAnimeClick(item); }}
                      className="cursor-pointer relative"
                    >
                      <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-card mb-1">
                        <img src={optimizedImageUrl(item.poster, "poster")} alt={item.title} className="poster-img w-full h-full object-cover" loading="eager" decoding="async" />
                        <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.92) 0%, transparent 55%)" }} />
                        {viewAllMode === "watchlist" && (
                          <button
                            onClick={(e) => { e.stopPropagation(); removeFromWatchlist(item.id); }}
                            className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-destructive/80 flex items-center justify-center"
                          >
                            <X className="w-3 h-3 text-white" />
                          </button>
                        )}
                        <div className="absolute bottom-1.5 left-1.5 right-1.5">
                          <p className="text-[10px] font-semibold leading-tight line-clamp-2 text-white">{item.title}</p>
                          {viewAllMode === "history" && item.episodeInfo && (
                            <p className="text-[9px] text-primary mt-0.5">
                              S{item.episodeInfo.season} E{item.episodeInfo.episodeNumber || item.episodeInfo.episode}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Device warning */}
      {deviceExceeded && deviceCheckDone && (
        <div className="mb-4 rounded-xl border border-destructive/40 bg-destructive/10 p-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-destructive mt-0.5" />
            <div className="flex-1">
              <p className="text-xs font-semibold text-foreground">Your account is logged in on this phone, but this device is not approved for premium playback.</p>
              <p className="text-[11px] text-muted-foreground mt-1">You can remove this phone login below and automatically sign out from this device.</p>
              <button
                onClick={handleDeleteThisPhoneLogin}
                className="mt-2 rounded-lg bg-destructive/20 px-3 py-1.5 text-[11px] font-semibold text-destructive hover:bg-destructive/30 transition-colors"
              >
                Delete this phone login
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Menu Items */}
      <div className="flex flex-col gap-2">
        <div onClick={() => setActivePanel("premium")}
          className={`flex items-center gap-3.5 px-4 py-4 cursor-pointer transition-all hover:translate-x-1 rounded-xl ${isPremium ? (isPremiumExpiringSoon ? "border border-destructive/50 bg-destructive/10 animate-pulse" : "premium-card-glow") : "glass-card border-foreground/20 bg-gradient-to-r from-foreground/5 to-transparent hover:border-primary"}`}
          style={isPremiumExpiringSoon ? { boxShadow: "0 0 24px hsla(0,84%,60%,0.25)" } : undefined}>
          <Crown className="w-5 h-5" style={isPremium ? { color: "hsl(45,90%,55%)" } : { color: "hsl(var(--primary))" }} />
          <div className="flex-1">
            <span className={`text-[13px] font-medium ${isPremium ? "premium-text" : ""}`}>{isPremium ? "Premium Active ✨" : "Get Premium"}</span>
            {isPremium && premiumExpiry && (
              <p className={`text-[10px] ${isPremiumExpiringSoon ? "text-destructive" : "text-muted-foreground"}`}>Expires: {new Date(premiumExpiry).toLocaleDateString()} • {premiumDeviceCount}/{premiumMaxDevices} devices • {premiumDaysLeft} day{premiumDaysLeft === 1 ? "" : "s"} left</p>
            )}
            {!isPremium && <p className="text-[10px] text-muted-foreground">Buy premium with bKash</p>}
          </div>
          <ChevronRight className="w-3 h-3 text-muted-foreground" />
        </div>
        <div onClick={() => setActivePanel("settings")}
          className="glass-card flex items-center gap-3.5 px-4 py-4 cursor-pointer transition-all hover:border-primary hover:translate-x-1 rounded-xl">
          <Settings className="w-5 h-5 text-primary" />
          <span className="flex-1 text-[13px] font-medium">Settings</span>
          <ChevronRight className="w-3 h-3 text-muted-foreground" />
        </div>
        <div onClick={() => { setTempName(displayName); setActivePanel("edit"); }}
          className="glass-card flex items-center gap-3.5 px-4 py-4 cursor-pointer transition-all hover:border-primary hover:translate-x-1 rounded-xl">
          <User className="w-5 h-5 text-primary" />
          <span className="flex-1 text-[13px] font-medium">Edit Profile</span>
          <ChevronRight className="w-3 h-3 text-muted-foreground" />
        </div>
        {isGuestUser ? (
          <div onClick={() => { onClose(); onLoginClick?.(); }}
            className="flex items-center gap-3.5 px-4 py-4 cursor-pointer transition-all hover:translate-x-1 rounded-xl bg-gradient-to-r from-primary to-primary/70 text-primary-foreground shadow-lg">
            <User className="w-5 h-5" />
            <span className="flex-1 text-[13px] font-bold">Login / Sign Up</span>
            <ChevronRight className="w-3 h-3 opacity-80" />
          </div>
        ) : (
          <div onClick={handleDeleteThisPhoneLogin}
            className="glass-card flex items-center gap-3.5 px-4 py-4 cursor-pointer transition-all hover:bg-accent/20 border-accent/30 bg-accent/15 rounded-xl">
            <LogOut className="w-5 h-5" />
            <span className="flex-1 text-[13px] font-medium">Logout</span>
            <ChevronRight className="w-3 h-3 text-muted-foreground" />
          </div>
        )}

        {/* Telegram Join Button */}
        <a
          href={TELEGRAM_CHANNEL_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2.5 w-full py-3.5 rounded-xl font-semibold text-sm transition-all mt-2"
          style={{ background: 'linear-gradient(135deg, #0088cc, #00aaee)', color: '#fff' }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
          </svg>
          Join Our Telegram Channel
        </a>
        <p className="text-[10px] text-muted-foreground text-center mt-1 mb-2">Get all updates, news & details about {brandingCfg.siteName}</p>

        {/* Download APK — User panel install button.
            Hidden if admin disabled it via APK DW > User Panel Download Button. */}
        {userApkEnabled && userApkUrl ? (
          <>
            <button
              onClick={handleDownloadUserApk}
              className="flex items-center justify-center gap-2.5 w-full py-3.5 rounded-xl font-semibold text-sm transition-all mt-1"
              style={{ background: 'linear-gradient(135deg, #16a34a, #22c55e)', color: '#fff' }}
            >
              <Download className="w-4 h-4" />
              Download App
            </button>
            <p className="text-[10px] text-muted-foreground text-center mt-1 mb-3">
              Install {brandingCfg.siteName} as an app on your phone
            </p>
          </>
        ) : null}

        {/* Invite Friends — prominent section at the very bottom of profile */}
        <div className="mt-5">
          <InviteFriendCard variant="full" siteName={brandingCfg.siteName || SITE_NAME} />
        </div>
      </div>
    </motion.div>
  );
};

// Change Password sub-component (English UI + Email OTP forgot-password)
const ChangePasswordPanel = ({ onBack }: { onBack: () => void }) => {
  const branding = useBranding();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hasExistingPassword, setHasExistingPassword] = useState<boolean | null>(null);
  const [checkingPassword, setCheckingPassword] = useState(true);

  // Forgot-password (email OTP) state
  const [forgotMode, setForgotMode] = useState(false);
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpLoading, setOtpLoading] = useState(false);
  const [userEmail, setUserEmail] = useState<string>("");

  // Check if user already has a password
  useEffect(() => {
    const checkPassword = async () => {
      try {
        const user = JSON.parse(localStorage.getItem("rsanime_user") || "{}");
        if (!user.email) { setHasExistingPassword(false); setCheckingPassword(false); return; }
        setUserEmail(user.email);
        const emailKey = user.email.toLowerCase().replace(/\./g, ",").replace(/[^a-z0-9@,_-]/g, "_");
        const legacyKey = user.email.toLowerCase().replace(/[^a-z0-9]/g, "_");
        for (const key of [emailKey, legacyKey]) {
          const snap = await get(ref(db, `appUsers/${key}`));
          if (snap.exists() && snap.val().password) {
            setHasExistingPassword(true);
            setCheckingPassword(false);
            return;
          }
        }
        setHasExistingPassword(false);
      } catch { setHasExistingPassword(false); }
      setCheckingPassword(false);
    };
    checkPassword();
  }, []);

  const handleSetOrChangePassword = async () => {
    if (hasExistingPassword) {
      if (!oldPassword.trim() || !newPassword.trim()) { toast.error("Please fill in all fields"); return; }
      if (newPassword.length < 4) { toast.error("New password must be at least 4 characters"); return; }
      if (oldPassword === newPassword) { toast.error("New password cannot be the same as the old one"); return; }
      if (newPassword !== confirmPassword) { toast.error("Passwords don't match!"); return; }
    } else {
      if (!newPassword.trim()) { toast.error("Please enter a password"); return; }
      if (newPassword.length < 4) { toast.error("Password must be at least 4 characters"); return; }
      if (newPassword !== confirmPassword) { toast.error("Passwords don't match!"); return; }
    }

    setLoading(true);
    try {
      const user = JSON.parse(localStorage.getItem("rsanime_user") || "{}");
      if (!user.email) { toast.error("User not found"); setLoading(false); return; }

      const emailKey = user.email.toLowerCase().replace(/\./g, ",").replace(/[^a-z0-9@,_-]/g, "_");
      const legacyKey = user.email.toLowerCase().replace(/[^a-z0-9]/g, "_");

      let foundKey = "";
      let userData: any = null;
      for (const key of [emailKey, legacyKey]) {
        const snap = await get(ref(db, `appUsers/${key}`));
        if (snap.exists()) {
          foundKey = key;
          userData = snap.val();
          break;
        }
      }

      if (!foundKey) {
        foundKey = emailKey;
        userData = { id: user.id, name: user.name, email: user.email, createdAt: Date.now() };
      }

      if (hasExistingPassword) {
        if (userData.password !== oldPassword) {
          toast.error("Old password is incorrect!");
          setLoading(false); return;
        }
      }

      await update(ref(db, `appUsers/${foundKey}`), { password: newPassword });
      toast.success(hasExistingPassword ? "Password changed successfully! ✅" : "Password set successfully! ✅");
      setOldPassword(""); setNewPassword(""); setConfirmPassword("");
      onBack();
    } catch (err: any) { toast.error("Error: " + err.message); }
    setLoading(false);
  };

  // ----- Forgot password via email OTP -----
  const handleSendOtp = async () => {
    if (!userEmail) { toast.error("No email on this account"); return; }
    setOtpLoading(true);
    try {
      const emailKey = userEmail.toLowerCase().replace(/\./g, ",").replace(/[^a-z0-9@,_-]/g, "_");
      const emailServiceSnap = await get(ref(db, "settings/emailService/otpFunctionUrl"));
      const customUrl = emailServiceSnap.val();

      if (customUrl) {
        const code = String(Math.floor(100000 + Math.random() * 900000));
        await set(ref(db, `otpCodes/${emailKey}`), { code, expires: Date.now() + 5 * 60 * 1000 });
        const res = await fetch(customUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: userEmail,
            otp: code,
            siteName: branding.siteName || SITE_NAME,
            logoUrl: branding.logoUrl || "https://i.ibb.co.com/gLc93Bc3/android-chrome-512x512.png",
            siteUrl: "https://rsanime03.lovable.app",
            telegramUrl: TELEGRAM_ADMIN_URL,
          }),
        });
        if (!res.ok) throw new Error("Email sending failed");
      } else {
        const { supabase } = await import("@/integrations/supabase/client");
        const { error } = await supabase.auth.signInWithOtp({
          email: userEmail,
          options: { shouldCreateUser: true },
        });
        if (error) throw error;
      }
      setOtpSent(true);
      toast.success(`📧 Code sent to: ${userEmail}`);
    } catch (err: any) {
      toast.error("Failed to send code: " + (err.message || "unknown"));
    }
    setOtpLoading(false);
  };

  const handleResetWithOtp = async () => {
    if (!otp.trim() || !newPassword.trim()) { toast.error("Please fill in all fields"); return; }
    if (newPassword.length < 4) { toast.error("Password must be at least 4 characters"); return; }
    if (newPassword !== confirmPassword) { toast.error("Passwords don't match!"); return; }

    setOtpLoading(true);
    try {
      const emailKey = userEmail.toLowerCase().replace(/\./g, ",").replace(/[^a-z0-9@,_-]/g, "_");
      const emailServiceSnap = await get(ref(db, "settings/emailService/otpFunctionUrl"));
      const customUrl = emailServiceSnap.val();

      if (customUrl) {
        const otpSnap = await get(ref(db, `otpCodes/${emailKey}`));
        const otpData = otpSnap.val();
        if (!otpData || otpData.code !== otp.trim()) {
          toast.error("❌ Incorrect code!");
          setOtpLoading(false); return;
        }
        if (Date.now() > otpData.expires) {
          toast.error("⏰ Code expired! Please request a new one.");
          await remove(ref(db, `otpCodes/${emailKey}`));
          setOtpLoading(false); return;
        }
        await remove(ref(db, `otpCodes/${emailKey}`));
      } else {
        const { supabase } = await import("@/integrations/supabase/client");
        const { error: verifyError } = await supabase.auth.verifyOtp({
          email: userEmail,
          token: otp.trim(),
          type: 'email',
        });
        if (verifyError) {
          toast.error(verifyError.message.includes("expired") ? "⏰ Code expired! Please request a new one." : "❌ Incorrect code!");
          setOtpLoading(false); return;
        }
      }

      const snap = await get(ref(db, `appUsers/${emailKey}`));
      if (!snap.exists()) {
        const u = JSON.parse(localStorage.getItem("rsanime_user") || "{}");
        await set(ref(db, `appUsers/${emailKey}`), { id: u.id, name: u.name, email: userEmail, createdAt: Date.now(), password: newPassword });
      } else {
        await set(ref(db, `appUsers/${emailKey}/password`), newPassword);
      }

      toast.success("✅ New password set successfully!");
      setOtp(""); setNewPassword(""); setConfirmPassword(""); setOtpSent(false); setForgotMode(false);
      onBack();
    } catch (err: any) {
      toast.error("Error: " + err.message);
    }
    setOtpLoading(false);
  };

  if (checkingPassword) {
    return (
      <motion.div className="fixed inset-0 z-[200] bg-background flex items-center justify-center"
        initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
        transition={{ type: "tween", duration: 0.3 }}>
        <div className="animate-spin w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full" />
      </motion.div>
    );
  }

  return (
    <motion.div className="fixed inset-0 z-[200] bg-background overflow-y-auto pt-[70px] px-4 pb-24"
      initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
      transition={{ type: "tween", duration: 0.3 }}>
      <button onClick={onBack} className="flex items-center gap-2 mb-5 text-sm text-secondary-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="w-5 h-5" />
        <span className="font-medium">{forgotMode ? "Reset Password" : (hasExistingPassword ? "Change Password" : "Set Password")}</span>
      </button>

      <div className="glass-card p-5 rounded-2xl mb-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
            <KeyRound className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-bold">
              {forgotMode ? "Reset via Email OTP" : (hasExistingPassword ? "Change Password" : "Set Password")}
            </h3>
            <p className="text-[10px] text-muted-foreground">
              {forgotMode
                ? `We'll send a 6-digit code to ${userEmail || "your email"}`
                : (hasExistingPassword ? "Enter your old password and choose a new one" : "Your account doesn't have a password yet")}
            </p>
          </div>
        </div>

        {!forgotMode && (
          <div className="space-y-4">
            {hasExistingPassword && (
              <div>
                <label className="text-xs text-muted-foreground mb-2 block">Old Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input type={showOld ? "text" : "password"} value={oldPassword} onChange={e => setOldPassword(e.target.value)}
                    placeholder="Enter old password"
                    className="w-full py-3 pl-10 pr-10 rounded-xl bg-foreground/10 border border-foreground/10 text-foreground text-sm focus:border-primary focus:outline-none focus:shadow-[0_0_20px_hsla(355,85%,55%,0.3)] transition-all placeholder:text-muted-foreground" />
                  <button type="button" onClick={() => setShowOld(!showOld)} className="absolute right-3 top-1/2 -translate-y-1/2">
                    {showOld ? <EyeOff className="w-4 h-4 text-muted-foreground" /> : <Eye className="w-4 h-4 text-muted-foreground" />}
                  </button>
                </div>
              </div>
            )}

            <div>
              <label className="text-xs text-muted-foreground mb-2 block">{hasExistingPassword ? "New Password" : "Password"}</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input type={showNew ? "text" : "password"} value={newPassword} onChange={e => setNewPassword(e.target.value)}
                  placeholder="Enter password"
                  className="w-full py-3 pl-10 pr-10 rounded-xl bg-foreground/10 border border-foreground/10 text-foreground text-sm focus:border-primary focus:outline-none focus:shadow-[0_0_20px_hsla(355,85%,55%,0.3)] transition-all placeholder:text-muted-foreground" />
                <button type="button" onClick={() => setShowNew(!showNew)} className="absolute right-3 top-1/2 -translate-y-1/2">
                  {showNew ? <EyeOff className="w-4 h-4 text-muted-foreground" /> : <Eye className="w-4 h-4 text-muted-foreground" />}
                </button>
              </div>
            </div>

            <div>
              <label className="text-xs text-muted-foreground mb-2 block">Confirm Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input type={showConfirm ? "text" : "password"} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter password"
                  className="w-full py-3 pl-10 pr-10 rounded-xl bg-foreground/10 border border-foreground/10 text-foreground text-sm focus:border-primary focus:outline-none focus:shadow-[0_0_20px_hsla(355,85%,55%,0.3)] transition-all placeholder:text-muted-foreground" />
                <button type="button" onClick={() => setShowConfirm(!showConfirm)} className="absolute right-3 top-1/2 -translate-y-1/2">
                  {showConfirm ? <EyeOff className="w-4 h-4 text-muted-foreground" /> : <Eye className="w-4 h-4 text-muted-foreground" />}
                </button>
              </div>
            </div>

            {newPassword && confirmPassword && newPassword === confirmPassword && (
              <p className="text-xs text-green-500 flex items-center gap-1.5"><Check className="w-3.5 h-3.5" /> Passwords match</p>
            )}
            {newPassword && confirmPassword && newPassword !== confirmPassword && (
              <p className="text-xs text-destructive">Passwords don't match!</p>
            )}
          </div>
        )}

        {forgotMode && (
          <div className="space-y-4">
            {!otpSent ? (
              <>
                <div className="text-xs text-muted-foreground bg-foreground/5 rounded-lg p-3">
                  A 6-digit verification code will be sent to:<br />
                  <span className="font-semibold text-foreground">{userEmail || "—"}</span>
                </div>
                <button onClick={handleSendOtp} disabled={otpLoading || !userEmail}
                  className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50">
                  {otpLoading ? <span className="animate-spin w-4 h-4 border-2 border-white/30 border-t-white rounded-full" /> : <>📧 Send Verification Code</>}
                </button>
              </>
            ) : (
              <>
                <div>
                  <label className="text-xs text-muted-foreground mb-2 block">Verification Code (6 digits)</label>
                  <input type="text" value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="000000" maxLength={6}
                    className="w-full py-3 px-4 rounded-xl bg-foreground/10 border border-foreground/10 text-foreground text-center text-lg tracking-[0.5em] font-mono focus:border-primary focus:outline-none transition-all" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-2 block">New Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input type={showNew ? "text" : "password"} value={newPassword} onChange={e => setNewPassword(e.target.value)}
                      placeholder="Enter new password"
                      className="w-full py-3 pl-10 pr-10 rounded-xl bg-foreground/10 border border-foreground/10 text-foreground text-sm focus:border-primary focus:outline-none transition-all placeholder:text-muted-foreground" />
                    <button type="button" onClick={() => setShowNew(!showNew)} className="absolute right-3 top-1/2 -translate-y-1/2">
                      {showNew ? <EyeOff className="w-4 h-4 text-muted-foreground" /> : <Eye className="w-4 h-4 text-muted-foreground" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-2 block">Confirm New Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input type={showConfirm ? "text" : "password"} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                      placeholder="Re-enter new password"
                      className="w-full py-3 pl-10 pr-10 rounded-xl bg-foreground/10 border border-foreground/10 text-foreground text-sm focus:border-primary focus:outline-none transition-all placeholder:text-muted-foreground" />
                    <button type="button" onClick={() => setShowConfirm(!showConfirm)} className="absolute right-3 top-1/2 -translate-y-1/2">
                      {showConfirm ? <EyeOff className="w-4 h-4 text-muted-foreground" /> : <Eye className="w-4 h-4 text-muted-foreground" />}
                    </button>
                  </div>
                </div>
                <button onClick={handleSendOtp} disabled={otpLoading}
                  className="w-full text-xs text-primary underline">
                  Resend code
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {!forgotMode ? (
        <>
          <button onClick={handleSetOrChangePassword} disabled={loading}
            className="w-full py-3 rounded-xl gradient-primary text-primary-foreground font-semibold flex items-center justify-center gap-2 transition-all hover:opacity-90 disabled:opacity-50 mb-3">
            {loading ? <span className="animate-spin w-4 h-4 border-2 border-white/30 border-t-white rounded-full" /> : <><Save className="w-4 h-4" /> {hasExistingPassword ? "Change Password" : "Set Password"}</>}
          </button>

          {hasExistingPassword && (
            <button onClick={() => { setForgotMode(true); setOldPassword(""); setNewPassword(""); setConfirmPassword(""); }}
              className="w-full py-3 rounded-xl bg-foreground/10 hover:bg-foreground/20 text-foreground font-medium flex items-center justify-center gap-2 text-sm transition-all">
              🔑 Forgot password? Reset via Email
            </button>
          )}
        </>
      ) : (
        <>
          {otpSent && (
            <button onClick={handleResetWithOtp} disabled={otpLoading}
              className="w-full py-3 rounded-xl gradient-primary text-primary-foreground font-semibold flex items-center justify-center gap-2 mb-3 disabled:opacity-50">
              {otpLoading ? <span className="animate-spin w-4 h-4 border-2 border-white/30 border-t-white rounded-full" /> : <><Check className="w-4 h-4" /> Verify & Reset Password</>}
            </button>
          )}
          <button onClick={() => { setForgotMode(false); setOtp(""); setOtpSent(false); setNewPassword(""); setConfirmPassword(""); }}
            className="w-full py-3 rounded-xl bg-foreground/10 hover:bg-foreground/20 text-foreground font-medium flex items-center justify-center gap-2 text-sm transition-all">
            <ArrowLeft className="w-4 h-4" /> Back to Change Password
          </button>
        </>
      )}
    </motion.div>
  );
};

const ProfilePage = forwardRef<HTMLDivElement, ProfilePageProps>((props, _ref) => {
  return <ProfilePageInner {...props} />;
});

ProfilePage.displayName = "ProfilePage";

export default ProfilePage;
