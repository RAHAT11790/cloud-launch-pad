import { useState, useRef, useEffect, forwardRef, lazy, Suspense, useMemo, useCallback } from "react";
import { User, LogOut, History, Bookmark, Settings, ChevronRight, ArrowLeft, Camera, X, Save, Globe, Monitor, Bell, Info, Crown, Gift, Check, Lock, Eye, EyeOff, KeyRound, Clock, Download, Play, Trash2, Loader2, PauseCircle, PlayCircle, Smartphone, Laptop, Tablet, Shield, AlertTriangle, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { db, ref, onValue, set, remove, get, update, push, query, orderByChild, equalTo } from "@/lib/firebase";
import type { AnimeItem } from "@/data/animeData";
import { toast } from "sonner";
import { registerFCMToken } from "@/lib/fcm";
import { TELEGRAM_ADMIN_URL, TELEGRAM_CHANNEL_URL, SITE_NAME } from "@/lib/siteConfig";
import { useBranding } from "@/hooks/useBranding";
import AboutPage from "./AboutPage";
import PrivacyPolicyPage from "./PrivacyPolicyPage";

const VideoPlayer = lazy(() => import("@/components/VideoPlayer"));

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
      <Suspense fallback={<div className="fixed inset-0 bg-black flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>}>
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
      </Suspense>
    </div>
  );
};

interface ProfilePageProps {
  onClose: () => void;
  allAnime?: AnimeItem[];
  onCardClick?: (anime: AnimeItem) => void;
  onLogout?: () => void;
}

const MAX_PHOTO_SIZE = 2 * 1024 * 1024;

const AccessTimer = () => {
  const [timeLeft, setTimeLeft] = useState<string | null>(null);
  const [hasAccess, setHasAccess] = useState(false);
  const [paused, setPaused] = useState(false);
  const [globalFree, setGlobalFree] = useState<{ active: boolean; expiresAt: number } | null>(null);

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

  useEffect(() => {
    const tick = () => {
      // Check global free access first
      if (globalFree?.active && globalFree.expiresAt > Date.now()) {
        setHasAccess(true);
        const diff = globalFree.expiresAt - Date.now();
        const h = Math.floor(diff / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        setTimeLeft(`${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`);
        return;
      }
      const expiry = localStorage.getItem("rsanime_ad_access");
      if (!expiry) { setHasAccess(false); setTimeLeft(null); return; }
      const diff = parseInt(expiry) - Date.now();
      if (diff <= 0) { setHasAccess(false); setTimeLeft(null); return; }
      setHasAccess(true);
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setTimeLeft(`${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [globalFree]);

  return (
    <div className="mb-5">
      <div className={`glass-card p-4 rounded-xl flex items-center gap-3 ${hasAccess ? "border-primary/30 bg-primary/5" : "border-accent/30 bg-accent/5"}`}>
        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${hasAccess ? "gradient-primary" : "bg-muted"}`}>
          <Clock className={`w-5 h-5 ${hasAccess ? "text-primary-foreground" : "text-muted-foreground"}`} />
        </div>
        <div className="flex-1">
          <p className="text-xs text-muted-foreground">
            {paused ? "⏸ Timer Paused (Maintenance)" : hasAccess ? "Free Access Remaining" : "No Active Access"}
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
  const [playingVideo, setPlayingVideo] = useState<string | null>(null);
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);
  const [qualityUrls, setQualityUrls] = useState<{ label: string; src: string; downloadId: string }[]>([]);
  const videoPlayRef = useRef<HTMLVideoElement>(null);
  const [activeDownloads, setActiveDownloads] = useState<Map<string, any>>(new Map());

  const loadDownloads = async () => {
    try {
      const { getAllDownloads } = await import("@/lib/downloadStore");
      const items = await getAllDownloads();
      setDownloads(items);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { loadDownloads(); }, []);

  // Subscribe to global download manager
  useEffect(() => {
    let unsub: (() => void) | undefined;
    import("@/lib/downloadManager").then(({ downloadManager }) => {
      unsub = downloadManager.subscribe((map) => {
        setActiveDownloads(new Map(map));
        // Refresh completed downloads list
        const hasComplete = Array.from(map.values()).some(d => d.status === "complete");
        if (hasComplete) loadDownloads();
      });
    });
    return () => { unsub?.(); };
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
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Merge active downloads with saved downloads
  const activeList = Array.from(activeDownloads.values())
    .filter((d: any) => d.status === "downloading" || d.status === "paused")
    .sort((a: any) => a.status === "downloading" ? -1 : 1);

  return (
    <motion.div className="fixed inset-0 z-[200] bg-background overflow-y-auto pt-[70px] px-4 pb-24"
      initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
      transition={{ type: "tween", duration: 0.3 }}>
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

      {/* Active Downloads Section */}
      {activeList.length > 0 && (
        <div className="mb-4 space-y-2">
          <p className="text-xs font-semibold text-primary uppercase tracking-wider">Downloading now</p>
          {activeList.map((dl: any) => {
            const isDlPaused = dl.status === "paused";
            return (
            <div key={dl.id} className={`glass-card rounded-xl p-3 border ${isDlPaused ? "border-accent/20" : "border-primary/20"}`}>
              <div className="flex items-center gap-3 mb-2">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${isDlPaused ? "bg-accent/20" : "bg-primary/20"}`}>
                  {isDlPaused ? <PauseCircle className="w-5 h-5 text-accent" /> : <Loader2 className="w-5 h-5 text-primary animate-spin" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{dl.title}</p>
                  {dl.subtitle && <p className="text-xs text-primary truncate">{dl.subtitle}</p>}
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`text-xs font-mono ${isDlPaused ? "text-accent" : "text-primary"}`}>{dl.percent}% {isDlPaused ? "⏸" : ""}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {dl.loadedMB.toFixed(1)}/{dl.totalMB > 0 ? dl.totalMB.toFixed(1) : "??"} MB
                    </span>
                    {dl.quality !== "Auto" && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">{dl.quality}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {isDlPaused ? (
                    <button
                      onClick={async () => {
                        const { downloadManager } = await import("@/lib/downloadManager");
                        downloadManager.resumeDownload(dl.id);
                        toast.info("Download resumed");
                      }}
                      className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center hover:bg-primary/40 transition-colors"
                    >
                      <PlayCircle className="w-3.5 h-3.5 text-primary" />
                    </button>
                  ) : (
                    <button
                      onClick={async () => {
                        const { downloadManager } = await import("@/lib/downloadManager");
                        downloadManager.pauseDownload(dl.id);
                        toast.info("Download paused");
                      }}
                      className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center hover:bg-accent/40 transition-colors"
                    >
                      <PauseCircle className="w-3.5 h-3.5 text-accent" />
                    </button>
                  )}
                  <button
                    onClick={async () => {
                      const { downloadManager } = await import("@/lib/downloadManager");
                      downloadManager.cancelDownload(dl.id);
                      toast.info("Download cancelled");
                    }}
                    className="w-8 h-8 rounded-full bg-destructive/20 flex items-center justify-center hover:bg-destructive/40 transition-colors"
                  >
                    <X className="w-3.5 h-3.5 text-destructive" />
                  </button>
                </div>
              </div>
              <div className="w-full h-1.5 rounded-full bg-foreground/10 overflow-hidden">
                <div className="h-full rounded-full gradient-primary transition-all duration-300 ease-linear" style={{ width: `${dl.percent}%` }} />
              </div>
            </div>
            );
          })}
        </div>
      )}

      {loading ? (
        <div className="py-16 text-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Loading downloads...</p>
        </div>
      ) : downloads.length === 0 && activeList.length === 0 ? (
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

const ProfilePageInner = ({ onClose, allAnime = [], onCardClick, onLogout }: ProfilePageProps) => {
  const brandingCfg = useBranding();
  const [activePanel, setActivePanel] = useState<"main" | "settings" | "edit" | "language" | "quality" | "notification-settings" | "premium" | "change-password" | "downloads" | "about" | "privacy">("main");
  const [profilePhoto, setProfilePhoto] = useState<string | null>(() => {
    try { return localStorage.getItem("rs_profile_photo"); } catch { return null; }
  });
  const [displayName, setDisplayName] = useState(() => {
    try { return localStorage.getItem("rs_display_name") || "Guest User"; } catch { return "Guest User"; }
  });
  const [tempName, setTempName] = useState(displayName);
  const fileRef = useRef<HTMLInputElement>(null);

  // Settings state
  const [selectedLanguage, setSelectedLanguage] = useState(() => {
    try { return localStorage.getItem("rs_language") || "English"; } catch { return "English"; }
  });
  const [selectedQuality, setSelectedQuality] = useState(() => {
    try { return localStorage.getItem("rs_quality") || "Auto"; } catch { return "Auto"; }
  });

  // Watchlist & History from Firebase
  const [watchlist, setWatchlist] = useState<any[]>([]);
  const [watchHistory, setWatchHistory] = useState<any[]>([]);
  const [isPremium, setIsPremium] = useState(false);
  const [premiumExpiry, setPremiumExpiry] = useState<number | null>(null);
  const [premiumMaxDevices, setPremiumMaxDevices] = useState(1);
  const [premiumDeviceCount, setPremiumDeviceCount] = useState(0);
  const [redeemInput, setRedeemInput] = useState("");
  const [redeemLoading, setRedeemLoading] = useState(false);
  const [bkashSettings, setBkashSettings] = useState<any>(null);
  const [selectedPlan, setSelectedPlan] = useState<any>(null);
  const [trxInput, setTrxInput] = useState("");
  const [trxSubmitting, setTrxSubmitting] = useState(false);
  const [trxSubmitted, setTrxSubmitted] = useState(false);
  const [bkashSenderNumber, setBkashSenderNumber] = useState("");
  const [paymentTab, setPaymentTab] = useState<"bkash" | "redeem">("bkash");
  const [deviceExceeded, setDeviceExceeded] = useState(false);
  const [deviceCheckDone, setDeviceCheckDone] = useState(false);

  const getUserId = (): string | null => {
    try {
      const user = localStorage.getItem("rsanime_user");
      if (user) return JSON.parse(user).id;
    } catch {}
    return null;
  };

  const userId = getUserId();

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
    const wlRef = ref(db, `users/${userId}/watchlist`);
    const unsub1 = onValue(wlRef, (snapshot) => {
      const data = snapshot.val() || {};
      setWatchlist(Object.values(data));
    });
    // Per-device watch history
    import("@/lib/premiumDevice").then(({ getDeviceId }) => {
      const deviceId = getDeviceId();
      const whRef = ref(db, `users/${userId}/watchHistory/${deviceId}`);
      const unsub2 = onValue(whRef, (snapshot) => {
        const data = snapshot.val() || {};
        const items = Object.values(data) as any[];
        items.sort((a: any, b: any) => (b.watchedAt || 0) - (a.watchedAt || 0));
        setWatchHistory(items);
      });
      // Store for cleanup
      (window as any).__rs_wh_unsub = unsub2;
    });
    const premRef = ref(db, `users/${userId}/premium`);
    const unsub3 = onValue(premRef, (snap) => {
      const data = snap.val();
      if (data && data.expiresAt > Date.now()) {
        setIsPremium(true);
        setPremiumExpiry(data.expiresAt);
        setPremiumMaxDevices(data.maxDevices || 1);
        const devCount = data.devices ? Object.keys(data.devices).length : 0;
        setPremiumDeviceCount(devCount);
        // Device limit is enforced at login time, just mark check done
        setDeviceExceeded(false);
        setDeviceCheckDone(true);
      } else {
        setIsPremium(false);
        setPremiumExpiry(null);
        setDeviceExceeded(false);
        setDeviceCheckDone(true);
      }
    });
    // Load bKash settings
    const unsub4 = onValue(ref(db, "bkashSettings"), (snap) => {
      setBkashSettings(snap.val());
    });
    return () => { unsub1(); (window as any).__rs_wh_unsub?.(); unsub3(); unsub4(); };
  }, [userId]);

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_PHOTO_SIZE) { alert("Image must be under 2MB!"); return; }
    if (!file.type.startsWith("image/")) { alert("Please select an image file."); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = ev.target?.result as string;
      setProfilePhoto(result);
      localStorage.setItem("rs_profile_photo", result);
    };
    reader.readAsDataURL(file);
  };

  const removePhoto = () => {
    setProfilePhoto(null);
    localStorage.removeItem("rs_profile_photo");
  };

  const saveName = () => {
    setDisplayName(tempName);
    localStorage.setItem("rs_display_name", tempName);
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
    if (!onCardClick) return;
    const anime = allAnime.find(a => a.id === item.id);
    if (anime) {
      onClose();
      setTimeout(() => onCardClick(anime), 100);
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
        submittedAt: Date.now(),
      };
      const newRef = push(ref(db, "bkashPayments"));
      await set(newRef, paymentData);
      // Send notification to admin (both in-app and push)
      try {
        const adminSnap = await get(ref(db, "admin/userId"));
        const adminId = adminSnap.val();
        if (adminId) {
          // In-app notification to admin's actual user ID
          const adminNotifRef = push(ref(db, `notifications/${adminId}`));
          await set(adminNotifRef, {
            title: "💰 New Payment Request!",
            message: `${userName} — ৳${selectedPlan.price} (${selectedPlan.name}) — TrxID: ${trxInput.trim()}`,
            type: "payment",
            timestamp: Date.now(),
            read: false,
          });
          // FCM push
          const { sendPushToUsers } = await import("@/lib/fcm");
          sendPushToUsers([adminId], {
            title: "💰 New Payment!",
            body: `${userName} — ৳${selectedPlan.price} (TrxID: ${trxInput.trim()})`,
            url: "/admin",
            data: { type: "payment" },
          }).catch(() => {});
        } else {
          // Fallback: save to notifications/admin key
          const adminNotifRef = push(ref(db, "notifications/admin"));
          await set(adminNotifRef, {
            title: "💰 New Payment Request!",
            message: `${userName} — ৳${selectedPlan.price} (${selectedPlan.name}) — TrxID: ${trxInput.trim()}`,
            type: "payment",
            timestamp: Date.now(),
            read: false,
          });
        }
      } catch {}
      setTrxSubmitted(true);
      setTrxInput("");
      setBkashSenderNumber("");
      toast.success("Payment request submitted!");
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
          <div onClick={() => setActivePanel("notification-settings")} className="glass-card px-4 py-4 rounded-xl cursor-pointer transition-all hover:border-primary flex items-center gap-3">
            <Bell className="w-5 h-5 text-primary" />
            <div className="flex-1">
              <p className="text-sm font-medium">Notifications</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Manage notification preferences</p>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </div>
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

  // Notification Settings
  if (activePanel === "notification-settings") {
    return (
      <motion.div className="fixed inset-0 z-[200] bg-background overflow-y-auto pt-[70px] px-4 pb-24"
        initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
        transition={{ type: "tween", duration: 0.3 }}>
        <button onClick={() => setActivePanel("settings")} className="flex items-center gap-2 mb-5 text-sm text-secondary-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-5 h-5" />
          <span className="font-medium">Notifications</span>
        </button>
        <div className="space-y-3">
          <NotificationToggle label="Push Notifications" desc="Show browser popup notifications" defaultOn={true} storageKey="rs_notif_push" />
          <NotificationToggle label="New Episode Alerts" desc="Get notified for new episodes" defaultOn={true} storageKey="rs_notif_episodes" />
          <NotificationToggle label="Recommendations" desc="Personalized anime suggestions" defaultOn={true} storageKey="rs_notif_recs" />
          <NotificationToggle label="App Updates" desc="New features and improvements" defaultOn={false} storageKey="rs_notif_updates" />
        </div>

        {/* Push Debug Info */}
        <PushDebugInfo />
      </motion.div>
    );
  }

  // Premium Panel
  if (activePanel === "premium") {
    const activePlans = (bkashSettings?.plans || []).filter((p: any) => p.active !== false);
    const hasBkash = bkashSettings?.phoneNumber;

    return (
      <motion.div className="fixed inset-0 z-[200] overflow-y-auto pt-[70px] px-4 pb-24"
        style={{ background: isPremium ? "linear-gradient(180deg, hsl(30,20%,6%) 0%, hsl(215,35%,7%) 100%)" : "hsl(215,35%,7%)" }}
        initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
        transition={{ type: "tween", duration: 0.3 }}>
        <button onClick={() => { setActivePanel("main"); setTrxSubmitted(false); setSelectedPlan(null); }} className="flex items-center gap-2 mb-5 text-sm text-secondary-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-5 h-5" />
          <span className="font-medium">{isPremium ? "Premium Status" : "Get Premium"}</span>
        </button>

        {isPremium ? (
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
                  <p className="text-lg font-bold premium-text">{premiumExpiry ? Math.max(0, Math.ceil((premiumExpiry - Date.now()) / 86400000)) : 0}</p>
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
                আপনার প্রিমিয়াম সাবস্ক্রিপশন সর্বোচ্চ <strong>{premiumMaxDevices}টি</strong> ডিভাইসে চলবে।
              </p>
              <p className="text-xs text-muted-foreground">
                বর্তমানে {premiumDeviceCount}টি ডিভাইস অ্যাক্টিভ আছে। এই ডিভাইসটি নতুন।
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
                    <p className="text-[11px] text-muted-foreground">অন্য একটি ডিভাইস রিমুভ হয়ে এখানে অ্যাক্টিভ হবে</p>
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
                    <p className="text-sm font-semibold text-foreground">এই ফোন থেকে আইডি ডিলিট করে Logout করুন</p>
                    <p className="text-[11px] text-muted-foreground">ডিলিট করলে এই ফোনে অটো লগআউট হয়ে লগইন পেইজে চলে যাবে</p>
                  </div>
                </div>
              </button>
            </div>
          </div>
        ) : trxSubmitted ? (
          <div className="premium-card-glow p-6 rounded-2xl text-center mb-5">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: "hsla(142,70%,45%,0.15)", border: "1px solid hsla(142,70%,45%,0.3)" }}>
              <Clock className="w-8 h-8" style={{ color: "hsl(142,70%,45%)" }} />
            </div>
            <h3 className="text-lg font-bold mb-2" style={{ color: "hsl(142,70%,45%)" }}>রিকোয়েস্ট সাবমিট হয়েছে! ✅</h3>
            <p className="text-sm text-secondary-foreground mb-2">24 ঘন্টার মধ্যে আপনার সাবস্ক্রিপশন অ্যাক্টিভেট হয়ে যাবে।</p>
            <p className="text-xs text-muted-foreground">আমরা আপনার Transaction ID ভেরিফাই করছি। ভেরিফাই হলে নোটিফিকেশন পাবেন।</p>
            <button onClick={() => { setTrxSubmitted(false); setSelectedPlan(null); }}
              className="mt-4 py-2 px-6 rounded-xl bg-foreground/10 text-foreground text-sm font-medium transition-colors hover:bg-foreground/20">
              আবার কিনুন
            </button>
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
                  { icon: "🚫", text: "বিজ্ঞাপন ছাড়া দেখুন" },
                  { icon: "📺", text: "4K Ultra HD কোয়ালিটি" },
                  { icon: "⚡", text: "নিরবিচ্ছিন্ন স্ট্রিমিং" },
                  { icon: "💎", text: "ক্রিয়েটরদের সাপোর্ট করুন" },
                ].map((f, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm">
                    <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs" style={{ background: "hsla(45,90%,55%,0.15)" }}>{f.icon}</span>
                    <span className="text-foreground/90">{f.text}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Tab Switch */}
            {hasBkash && (
              <div className="flex gap-2 mb-4">
                <button onClick={() => setPaymentTab("bkash")}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors ${paymentTab === "bkash" ? "bg-[#E2136E] text-white" : "bg-foreground/10 text-foreground"}`}>
                  📱 bKash পেমেন্ট
                </button>
                <button onClick={() => setPaymentTab("redeem")}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors ${paymentTab === "redeem" ? "premium-gradient text-primary-foreground" : "bg-foreground/10 text-foreground"}`}>
                  🎁 Redeem Code
                </button>
              </div>
            )}

            {/* bKash Payment Tab */}
            {(paymentTab === "bkash" && hasBkash) ? (
              <div>
                {/* Select Plan with Device Limits */}
                <div className="premium-card p-4 rounded-2xl mb-4">
                  <h4 className="text-sm font-semibold mb-3 premium-text">📦 প্ল্যান সিলেক্ট করুন</h4>
                  <div className="space-y-2">
                    {activePlans.map((plan: any) => (
                      <div key={plan.id} onClick={() => setSelectedPlan(plan)}
                        className={`p-3.5 rounded-xl border-2 cursor-pointer transition-all ${selectedPlan?.id === plan.id ? "border-[#E2136E] bg-[#E2136E]/10" : "border-foreground/10 bg-foreground/5 hover:border-foreground/20"}`}>
                        <div className="flex justify-between items-center">
                          <div>
                            <p className="text-sm font-bold">{plan.name}</p>
                            <p className="text-[11px] text-muted-foreground">{plan.days} দিন Ad-Free</p>
                            {plan.maxDevices && (
                              <p className="text-[10px] mt-0.5 flex items-center gap-1" style={{ color: "hsl(45,90%,55%)" }}>
                                <Smartphone className="w-3 h-3" /> {plan.maxDevices} ডিভাইস পর্যন্ত
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
                    <h4 className="text-sm font-semibold mb-3 text-[#E2136E]">📲 পেমেন্ট করুন</h4>
                    
                    {/* bKash Info */}
                    <div className="bg-[#E2136E]/10 border border-[#E2136E]/30 rounded-xl p-3 mb-3">
                      <p className="text-xs text-muted-foreground mb-1">{bkashSettings.accountType} নাম্বার:</p>
                      <p className="text-lg font-bold text-[#E2136E] tracking-wider">{bkashSettings.phoneNumber}</p>
                      <p className="text-xs text-muted-foreground mt-1">পরিমাণ: <span className="font-bold text-foreground">৳{selectedPlan.price}</span></p>
                    </div>

                    {/* Instructions */}
                    {bkashSettings.instructions && (
                      <p className="text-xs text-muted-foreground mb-3 leading-relaxed">{bkashSettings.instructions}</p>
                    )}

                    {/* QR Code */}
                    {bkashSettings.qrCodeLink && (
                      <div className="text-center mb-3">
                        <p className="text-xs text-muted-foreground mb-2">QR কোড স্ক্যান করুন:</p>
                        <img src={bkashSettings.qrCodeLink} alt="bKash QR" className="w-40 h-40 mx-auto rounded-xl border border-foreground/10" />
                      </div>
                    )}

                    {/* bKash Sender Number */}
                    <div className="mb-3">
                      <label className="text-xs text-muted-foreground mb-1 block">আপনার bKash নাম্বার</label>
                      <input value={bkashSenderNumber} onChange={e => setBkashSenderNumber(e.target.value)}
                        placeholder="01XXXXXXXXX" maxLength={11}
                        className="w-full py-3 px-4 rounded-xl bg-foreground/10 border border-foreground/10 text-foreground text-sm focus:border-[#E2136E] focus:outline-none transition-colors" />
                    </div>

                    {/* Transaction ID */}
                    <div className="mb-3">
                      <label className="text-xs text-muted-foreground mb-1 block">Transaction ID</label>
                      <input value={trxInput} onChange={e => setTrxInput(e.target.value.toUpperCase())}
                        placeholder="যেমন: TrxID 0A1B2C3D4E"
                        className="w-full py-3 px-4 rounded-xl bg-foreground/10 border border-foreground/10 text-foreground text-sm font-mono tracking-wider focus:border-[#E2136E] focus:outline-none transition-colors" />
                    </div>

                    <button onClick={submitBkashPayment} disabled={trxSubmitting || !trxInput.trim() || !bkashSenderNumber.trim()}
                      className="w-full py-3 rounded-xl bg-[#E2136E] text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-50 transition-colors hover:bg-[#C8115F]">
                      {trxSubmitting ? "সাবমিট হচ্ছে..." : "✅ সাবমিট করুন"}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              /* Redeem Code Tab */
              <div className="premium-card p-4 rounded-2xl mb-4">
                <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <Gift className="w-4 h-4" style={{ color: "hsl(45,90%,55%)" }} /> Enter Redeem Code
                </h4>
                <input
                  value={redeemInput}
                  onChange={e => setRedeemInput(e.target.value.toUpperCase())}
                  placeholder="RS-XXXXXX-XXXX"
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
            <button onClick={() => fileRef.current?.click()} className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-primary flex items-center justify-center shadow-lg">
              <Camera className="w-4 h-4 text-primary-foreground" />
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">Max 2MB • JPG, PNG, WebP</p>
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
          <Lock className="w-4 h-4 text-primary" /> পাসওয়ার্ড সেটিংস
        </button>
      </motion.div>
    );
  }

  // Main Profile
  return (
    <motion.div className="fixed inset-0 z-[200] bg-background overflow-y-auto pt-[70px] px-4 pb-24"
      initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
      transition={{ type: "tween", duration: 0.4 }}>
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
          {(() => { try { const u = JSON.parse(localStorage.getItem("rsanime_user") || "{}"); return u.email || "guest@rsanime.com"; } catch { return "guest@rsanime.com"; } })()}
        </p>
      </div>

      {/* Access Timer */}
      {!isPremium && <AccessTimer />}

      {/* Watch History */}
      <div className="mb-7">
        <h3 className="text-base font-bold mb-3 flex items-center category-bar">Watch History</h3>
        {watchHistory.length === 0 ? (
          <div className="text-center py-8">
            <History className="w-10 h-10 text-muted-foreground/50 mx-auto mb-2.5" />
            <p className="text-sm text-secondary-foreground">No watch history yet</p>
          </div>
        ) : (
          <div className="flex gap-2.5 overflow-x-auto pb-2 scrollbar-hide">
            {watchHistory.slice(0, 20).map((item: any) => (
              <div key={item.id} onClick={() => handleAnimeClick(item)}
                className="flex-shrink-0 w-[100px] cursor-pointer">
                <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-card mb-1">
                  <img src={item.poster} alt={item.title} className="w-full h-full object-cover" loading="lazy" />
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
        <h3 className="text-base font-bold mb-3 flex items-center category-bar">My Watchlist</h3>
        {watchlist.length === 0 ? (
          <div className="text-center py-8">
            <Bookmark className="w-10 h-10 text-muted-foreground/50 mx-auto mb-2.5" />
            <p className="text-sm text-secondary-foreground">No items in watchlist</p>
          </div>
        ) : (
          <div className="flex gap-2.5 overflow-x-auto pb-2 scrollbar-hide">
            {watchlist.map((item: any) => (
              <div key={item.id} onClick={() => handleAnimeClick(item)}
                className="flex-shrink-0 w-[100px] cursor-pointer relative">
                <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-card mb-1">
                  <img src={item.poster} alt={item.title} className="w-full h-full object-cover" loading="lazy" />
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

      {/* Device warning */}
      {deviceExceeded && deviceCheckDone && (
        <div className="mb-4 rounded-xl border border-destructive/40 bg-destructive/10 p-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-destructive mt-0.5" />
            <div className="flex-1">
              <p className="text-xs font-semibold text-foreground">আপনার আইডিটি এই ফোনে লগইন করা আছে, কিন্তু এই ফোন প্রিমিয়াম প্লের জন্য অনুমোদিত নয়।</p>
              <p className="text-[11px] text-muted-foreground mt-1">চাইলে নিচের বাটন থেকে এই ফোন থেকে আইডি ডিলিট করে অটো লগআউট করতে পারবেন।</p>
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
          className={`flex items-center gap-3.5 px-4 py-4 cursor-pointer transition-all hover:translate-x-1 rounded-xl ${isPremium ? "premium-card-glow" : "glass-card border-foreground/20 bg-gradient-to-r from-foreground/5 to-transparent hover:border-primary"}`}>
          <Crown className="w-5 h-5" style={isPremium ? { color: "hsl(45,90%,55%)" } : { color: "hsl(var(--primary))" }} />
          <div className="flex-1">
            <span className={`text-[13px] font-medium ${isPremium ? "premium-text" : ""}`}>{isPremium ? "Premium Active ✨" : "Get Premium"}</span>
            {isPremium && premiumExpiry && (
              <p className="text-[10px] text-muted-foreground">Expires: {new Date(premiumExpiry).toLocaleDateString()} • {premiumDeviceCount}/{premiumMaxDevices} devices</p>
            )}
            {!isPremium && <p className="text-[10px] text-muted-foreground">bKash দিয়ে প্রিমিয়াম কিনুন</p>}
          </div>
          <ChevronRight className="w-3 h-3 text-muted-foreground" />
        </div>
        <div onClick={() => setActivePanel("settings")}
          className="glass-card flex items-center gap-3.5 px-4 py-4 cursor-pointer transition-all hover:border-primary hover:translate-x-1 rounded-xl">
          <Settings className="w-5 h-5 text-primary" />
          <span className="flex-1 text-[13px] font-medium">Settings</span>
          <ChevronRight className="w-3 h-3 text-muted-foreground" />
        </div>
        <div onClick={() => setActivePanel("downloads")}
          className="glass-card flex items-center gap-3.5 px-4 py-4 cursor-pointer transition-all hover:border-primary hover:translate-x-1 rounded-xl">
          <Download className="w-5 h-5 text-primary" />
          <span className="flex-1 text-[13px] font-medium">Downloads</span>
          <ChevronRight className="w-3 h-3 text-muted-foreground" />
        </div>
        <div onClick={() => { setTempName(displayName); setActivePanel("edit"); }}
          className="glass-card flex items-center gap-3.5 px-4 py-4 cursor-pointer transition-all hover:border-primary hover:translate-x-1 rounded-xl">
          <User className="w-5 h-5 text-primary" />
          <span className="flex-1 text-[13px] font-medium">Edit Profile</span>
          <ChevronRight className="w-3 h-3 text-muted-foreground" />
        </div>
        <div onClick={handleDeleteThisPhoneLogin}
          className="glass-card flex items-center gap-3.5 px-4 py-4 cursor-pointer transition-all hover:bg-accent/20 border-accent/30 bg-accent/15 rounded-xl">
          <LogOut className="w-5 h-5" />
          <span className="flex-1 text-[13px] font-medium">Logout</span>
          <ChevronRight className="w-3 h-3 text-muted-foreground" />
        </div>

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
      </div>
    </motion.div>
  );
};

// Change Password sub-component
const ChangePasswordPanel = ({ onBack }: { onBack: () => void }) => {
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hasExistingPassword, setHasExistingPassword] = useState<boolean | null>(null);
  const [checkingPassword, setCheckingPassword] = useState(true);

  // Check if user already has a password
  useEffect(() => {
    const checkPassword = async () => {
      try {
        const user = JSON.parse(localStorage.getItem("rsanime_user") || "{}");
        if (!user.email) { setHasExistingPassword(false); setCheckingPassword(false); return; }
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
      // Change password flow - need old password
      if (!oldPassword.trim() || !newPassword.trim()) { toast.error("সব ফিল্ড পূরণ করুন"); return; }
      if (newPassword.length < 4) { toast.error("নতুন পাসওয়ার্ড কমপক্ষে ৪ অক্ষরের হতে হবে"); return; }
      if (oldPassword === newPassword) { toast.error("নতুন পাসওয়ার্ড আগেরটার মতো হতে পারবে না"); return; }
      if (newPassword !== confirmPassword) { toast.error("পাসওয়ার্ড মিলছে না!"); return; }
    } else {
      // Set password flow - no old password needed
      if (!newPassword.trim()) { toast.error("পাসওয়ার্ড দিন"); return; }
      if (newPassword.length < 4) { toast.error("পাসওয়ার্ড কমপক্ষে ৪ অক্ষরের হতে হবে"); return; }
      if (newPassword !== confirmPassword) { toast.error("পাসওয়ার্ড মিলছে না!"); return; }
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
        // Create appUsers entry if not found
        foundKey = emailKey;
        userData = { id: user.id, name: user.name, email: user.email, createdAt: Date.now() };
      }

      if (hasExistingPassword) {
        if (userData.password !== oldPassword) {
          toast.error("পুরানো পাসওয়ার্ড ভুল!");
          setLoading(false); return;
        }
      }

      // Update password
      await update(ref(db, `appUsers/${foundKey}`), { password: newPassword });
      toast.success(hasExistingPassword ? "পাসওয়ার্ড পরিবর্তন হয়েছে! ✅" : "পাসওয়ার্ড সেট হয়েছে! ✅");
      setOldPassword(""); setNewPassword(""); setConfirmPassword("");
      onBack();
    } catch (err: any) { toast.error("Error: " + err.message); }
    setLoading(false);
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
        <span className="font-medium">{hasExistingPassword ? "Change Password" : "Set Password"}</span>
      </button>

      <div className="glass-card p-5 rounded-2xl mb-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
            <KeyRound className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-bold">{hasExistingPassword ? "পাসওয়ার্ড পরিবর্তন" : "পাসওয়ার্ড সেট করুন"}</h3>
            <p className="text-[10px] text-muted-foreground">
              {hasExistingPassword ? "পুরানো পাসওয়ার্ড দিয়ে নতুন পাসওয়ার্ড সেট করুন" : "আপনার অ্যাকাউন্টে এখনও পাসওয়ার্ড সেট করা হয়নি"}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {hasExistingPassword && (
            <div>
              <label className="text-xs text-muted-foreground mb-2 block">পুরানো পাসওয়ার্ড</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input type={showOld ? "text" : "password"} value={oldPassword} onChange={e => setOldPassword(e.target.value)}
                  placeholder="পুরানো পাসওয়ার্ড দিন"
                  className="w-full py-3 pl-10 pr-10 rounded-xl bg-foreground/10 border border-foreground/10 text-foreground text-sm focus:border-primary focus:outline-none focus:shadow-[0_0_20px_hsla(355,85%,55%,0.3)] transition-all placeholder:text-muted-foreground" />
                <button type="button" onClick={() => setShowOld(!showOld)} className="absolute right-3 top-1/2 -translate-y-1/2">
                  {showOld ? <EyeOff className="w-4 h-4 text-muted-foreground" /> : <Eye className="w-4 h-4 text-muted-foreground" />}
                </button>
              </div>
            </div>
          )}

          <div>
            <label className="text-xs text-muted-foreground mb-2 block">{hasExistingPassword ? "নতুন পাসওয়ার্ড" : "পাসওয়ার্ড"}</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input type={showNew ? "text" : "password"} value={newPassword} onChange={e => setNewPassword(e.target.value)}
                placeholder="পাসওয়ার্ড দিন"
                className="w-full py-3 pl-10 pr-10 rounded-xl bg-foreground/10 border border-foreground/10 text-foreground text-sm focus:border-primary focus:outline-none focus:shadow-[0_0_20px_hsla(355,85%,55%,0.3)] transition-all placeholder:text-muted-foreground" />
              <button type="button" onClick={() => setShowNew(!showNew)} className="absolute right-3 top-1/2 -translate-y-1/2">
                {showNew ? <EyeOff className="w-4 h-4 text-muted-foreground" /> : <Eye className="w-4 h-4 text-muted-foreground" />}
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-2 block">কনফার্ম পাসওয়ার্ড</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input type={showConfirm ? "text" : "password"} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                placeholder="আবার পাসওয়ার্ড দিন"
                className="w-full py-3 pl-10 pr-10 rounded-xl bg-foreground/10 border border-foreground/10 text-foreground text-sm focus:border-primary focus:outline-none focus:shadow-[0_0_20px_hsla(355,85%,55%,0.3)] transition-all placeholder:text-muted-foreground" />
              <button type="button" onClick={() => setShowConfirm(!showConfirm)} className="absolute right-3 top-1/2 -translate-y-1/2">
                {showConfirm ? <EyeOff className="w-4 h-4 text-muted-foreground" /> : <Eye className="w-4 h-4 text-muted-foreground" />}
              </button>
            </div>
          </div>

          {newPassword && confirmPassword && newPassword === confirmPassword && (
            <p className="text-xs text-green-500 flex items-center gap-1.5"><Check className="w-3.5 h-3.5" /> পাসওয়ার্ড মিলছে</p>
          )}
          {newPassword && confirmPassword && newPassword !== confirmPassword && (
            <p className="text-xs text-destructive">পাসওয়ার্ড মিলছে না!</p>
          )}
        </div>
      </div>

      <button onClick={handleSetOrChangePassword} disabled={loading}
        className="w-full py-3 rounded-xl gradient-primary text-primary-foreground font-semibold flex items-center justify-center gap-2 transition-all hover:opacity-90 disabled:opacity-50 mb-3">
        {loading ? <span className="animate-spin w-4 h-4 border-2 border-white/30 border-t-white rounded-full" /> : <><Save className="w-4 h-4" /> {hasExistingPassword ? "পাসওয়ার্ড পরিবর্তন করুন" : "পাসওয়ার্ড সেট করুন"}</>}
      </button>

      <a href={TELEGRAM_ADMIN_URL} target="_blank" rel="noopener noreferrer"
        className="w-full py-3 rounded-xl bg-[#0088cc] text-white font-medium flex items-center justify-center gap-2 text-sm transition-all hover:opacity-90">
        📩 সমস্যা হলে Contact Owner
      </a>
    </motion.div>
  );
};

// Push Debug Info sub-component
const PushDebugInfo = () => {
  const [debugInfo, setDebugInfo] = useState<Record<string, string>>({});
  const [reregistering, setReregistering] = useState(false);

  const loadDebugInfo = () => {
    const info: Record<string, string> = {};
    info["Origin"] = window.location.origin;
    info["Permission"] = "Notification" in window ? Notification.permission : "unsupported";
    info["Device ID"] = localStorage.getItem("rs_fcm_device_id") || "not set";
    
    try {
      const u = JSON.parse(localStorage.getItem("rsanime_user") || "{}");
      info["User ID"] = u.id || "none";
    } catch { info["User ID"] = "error"; }

    info["Push Pref"] = localStorage.getItem("rs_notif_push") || "default (true)";
    info["SW Support"] = "serviceWorker" in navigator ? "yes" : "no";
    
    // Check SW registration
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        const fcmSw = regs.find(r => r.active?.scriptURL?.includes("firebase-messaging-sw"));
        info["FCM SW"] = fcmSw ? `active (scope: ${fcmSw.scope})` : "not registered";
        info["Total SWs"] = String(regs.length);
        setDebugInfo({ ...info });
      });
    }

    // Load token count from Firebase
    try {
      const u = JSON.parse(localStorage.getItem("rsanime_user") || "{}");
      if (u.id) {
        import("@/lib/firebase").then(({ db, ref, get }) => {
          const emailKey = u.email ? String(u.email).replace(/\./g, ",") : null;
          Promise.all([
            get(ref(db, `fcmTokens/${u.id}`)),
            emailKey ? get(ref(db, `fcmTokens/${emailKey}`)) : Promise.resolve({ val: () => null }),
          ]).then(([idSnap, emailSnap]: any[]) => {
            const merged = {
              ...(idSnap?.val?.() || {}),
              ...(emailSnap?.val?.() || {}),
            };
            const entries = Object.values(merged) as any[];
            info["Token Count"] = String(entries.length);
            if (entries.length > 0) {
              const latest = entries.reduce((a: any, b: any) => (a.updatedAt || 0) > (b.updatedAt || 0) ? a : b);
              info["Last Token"] = latest.updatedAt ? new Date(latest.updatedAt).toLocaleString() : "unknown";
              // Check if current origin has a token
              const originMatch = entries.find((e: any) => e.origin === window.location.origin);
              info["This Origin"] = originMatch ? "✅ has token" : "❌ no token";
            }
            setDebugInfo({ ...info });
          }).catch(() => {});
        });
      }
    } catch {}
    
    setDebugInfo(info);
  };

  useEffect(() => { loadDebugInfo(); }, []);

  const handleForceReregister = async () => {
    setReregistering(true);
    try {
      const u = JSON.parse(localStorage.getItem("rsanime_user") || "{}");
      if (!u.id) {
        toast.error("No user ID found");
        setReregistering(false);
        return;
      }
      await registerFCMToken(u.id, true);
      // Reload debug info after re-register
      setTimeout(() => loadDebugInfo(), 1500);
    } catch (err: any) {
      toast.error("Re-register failed: " + err.message);
    }
    setReregistering(false);
  };

  return (
    <div className="mt-6 glass-card p-4 rounded-xl">
      <h4 className="text-xs font-bold text-primary mb-3 flex items-center gap-2">
        <Info className="w-3.5 h-3.5" /> Push Debug Info
      </h4>
      <div className="space-y-1.5">
        {Object.entries(debugInfo).map(([key, val]) => (
          <div key={key} className="flex justify-between text-[11px]">
            <span className="text-muted-foreground">{key}:</span>
            <span className="text-foreground font-mono text-right max-w-[60%] truncate">{val}</span>
          </div>
        ))}
      </div>
      <button 
        onClick={handleForceReregister} 
        disabled={reregistering}
        className="w-full mt-3 py-2.5 rounded-xl bg-primary/20 text-primary text-xs font-semibold flex items-center justify-center gap-2 transition-all hover:bg-primary/30 disabled:opacity-50"
      >
        {reregistering ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bell className="w-3.5 h-3.5" />}
        Force Re-register Push Token
      </button>
    </div>
  );
};


const NotificationToggle = ({ label, desc, defaultOn, storageKey }: { label: string; desc: string; defaultOn: boolean; storageKey: string }) => {
  const [enabled, setEnabled] = useState(() => {
    try { const v = localStorage.getItem(storageKey); return v !== null ? v === "true" : defaultOn; } catch { return defaultOn; }
  });
  const toggle = async () => {
    const next = !enabled;
    const u = JSON.parse(localStorage.getItem("rsanime_user") || "{}");

    if (storageKey === "rs_notif_push" && next) {
      try {
        // Force browser permission prompt first
        if ("Notification" in window && Notification.permission === "default") {
          const permission = await Notification.requestPermission();
          if (permission !== "granted") {
            toast.error("নোটিফিকেশন অনুমতি দেওয়া হয়নি। ব্রাউজার সেটিংস থেকে Allow করুন।");
            return; // Don't toggle on if not granted
          }
        } else if ("Notification" in window && Notification.permission === "denied") {
          toast.error("❌ নোটিফিকেশন ব্লক করা আছে! ব্রাউজার Settings → Notifications → Allow করুন।");
          return;
        }
        setEnabled(next);
        localStorage.setItem(storageKey, String(next));
        if (u?.id) await registerFCMToken(u.id, true);
      } catch {
        setEnabled(!next);
      }
    } else {
      setEnabled(next);
      localStorage.setItem(storageKey, String(next));
      if (storageKey === "rs_notif_push" && u?.id) {
        try {
          await update(ref(db, `users/${u.id}`), {
            id: u.id,
            pushEnabled: false,
            pushTokenState: "disabled",
            lastPushCheckAt: Date.now(),
          });
          await remove(ref(db, `fcmTokens/${u.id}`));
          if (u.email) {
            await remove(ref(db, `fcmTokens/${String(u.email).replace(/\./g, ",")}`)).catch(() => {});
          }
        } catch {
          toast.error("Push disable sync ব্যর্থ");
        }
      }
    }
  };
  return (
    <div onClick={() => { void toggle(); }} className="glass-card px-4 py-4 rounded-xl cursor-pointer transition-all hover:border-primary flex items-center justify-between">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">{desc}</p>
      </div>
      <div className={`w-11 h-6 rounded-full transition-all relative ${enabled ? "bg-primary" : "bg-foreground/20"}`}>
        <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${enabled ? "left-[22px]" : "left-0.5"}`} />
      </div>
    </div>
  );
};

const ProfilePage = forwardRef<HTMLDivElement, ProfilePageProps>((props, _ref) => {
  return <ProfilePageInner {...props} />;
});

ProfilePage.displayName = "ProfilePage";

export default ProfilePage;
