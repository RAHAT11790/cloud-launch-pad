import { useState, useEffect, useRef, useCallback, useMemo, forwardRef } from "react";
import { db, ref, onValue, push, set, remove, update, get, auth, googleProvider, signInWithPopup } from "@/lib/firebase";
import { supabase } from "@/integrations/supabase/client";
import { animeSaltApi } from '@/lib/animeSaltApi';
import { sendPushToUsers, type PushProgress } from "@/lib/fcm";
import { toast } from "sonner";
import {
  LayoutDashboard, FolderOpen, Film, Video, Users, Bell, Zap, PlusCircle, CloudDownload,
  Menu, X, MoreVertical, RefreshCw, Plus, Download, Trash2, Edit, Eye, EyeOff,
  Shield, LogOut, Search, Save, ChevronDown, Send, Link, ChevronLeft, ChevronRight,
  Lock, KeyRound, AlertTriangle, Power, Settings, MessageCircle, Reply, BarChart3, Activity, TrendingUp, Check, List, Star, Pin
} from "lucide-react";

import { TMDB_API_KEY, TMDB_BASE_URL, TMDB_IMG_BASE, SITE_URL, SITE_NAME, SITE_ICON_URL, TELEGRAM_CHANNEL, TELEGRAM_CHANNEL_URL, TELEGRAM_ADMIN_URL, CLOUDFLARE_CDN_URL, SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/siteConfig";
import { EDGE_FUNCTIONS, type EdgeFunctionName, type EdgeRouterConfig, checkFunctionStatus } from "@/lib/edgeFunctionRouter";

type Section = "dashboard" | "categories" | "webseries" | "movies" | "users" | "notifications" | "new-releases" | "tmdb-fetch" | "add-content" | "redeem-codes" | "bkash-payments" | "device-limits" | "maintenance" | "free-access" | "settings" | "comments" | "analytics" | "auto-import" | "animesalt-manager" | "telegram-post" | "live-support" | "ui-themes" | "hero-pinned" | "edge-router";

interface CastMember {
  name: string;
  character?: string;
  photo: string;
}

interface Episode {
  episodeNumber: number;
  title: string;
  link: string;
  link480?: string;
  link720?: string;
  link1080?: string;
  link4k?: string;
}

interface Season {
  name: string;
  seasonNumber: number;
  episodes: Episode[];
}

import { THEME_PRESETS, type ThemePreset } from "@/lib/themePresets";

// ==================== EDGE FUNCTION ROUTER SECTION ====================
const EdgeRouterSection = ({ glassCard, inputClass, btnPrimary, btnSecondary }: { glassCard: string; inputClass: string; btnPrimary: string; btnSecondary: string }) => {
  const [config, setConfig] = useState<EdgeRouterConfig>({ platform: "lovable", denoBaseUrl: "", perFunction: {} });
  const [denoUrlInput, setDenoUrlInput] = useState("");
  const [statuses, setStatuses] = useState<Record<string, { lovable: { alive: boolean; latency: number } | null; deno: { alive: boolean; latency: number } | null }>>({});
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const unsub = onValue(ref(db, "settings/edgeRouter"), (snap) => {
      const val = snap.val();
      if (val) {
        setConfig({ platform: val.platform || "lovable", denoBaseUrl: val.denoBaseUrl || "", perFunction: val.perFunction || {} });
        setDenoUrlInput(val.denoBaseUrl || "");
      }
    });
    return () => unsub();
  }, []);

  const saveConfig = async (updates: Partial<EdgeRouterConfig>) => {
    const newConfig = { ...config, ...updates };
    await set(ref(db, "settings/edgeRouter"), newConfig);
    toast.success("Edge Router config saved!");
  };

  const togglePlatform = () => {
    const next = config.platform === "lovable" ? "deno" : "lovable";
    saveConfig({ platform: next });
  };

  const setFunctionPlatform = (fn: string, platform: "lovable" | "deno" | "auto") => {
    const perFunction = { ...config.perFunction, [fn]: platform };
    saveConfig({ perFunction });
  };

  const checkAllStatuses = async () => {
    setChecking(true);
    const results: typeof statuses = {};
    const promises = EDGE_FUNCTIONS.map(async (fn) => {
      const [lovable, deno] = await Promise.all([
        checkFunctionStatus(fn, "lovable", ""),
        config.denoBaseUrl ? checkFunctionStatus(fn, "deno", config.denoBaseUrl) : Promise.resolve(null),
      ]);
      results[fn] = {
        lovable: { alive: lovable.alive, latency: lovable.latency },
        deno: deno ? { alive: deno.alive, latency: deno.latency } : null,
      };
    });
    await Promise.all(promises);
    setStatuses(results);
    setChecking(false);
    toast.success("Status check complete!");
  };

  const lovableActive = Object.values(config.perFunction).filter(v => v === "lovable" || v === "auto").length;
  const denoActive = Object.values(config.perFunction).filter(v => v === "deno").length;
  const autoCount = EDGE_FUNCTIONS.length - Object.keys(config.perFunction).length + Object.values(config.perFunction).filter(v => v === "auto").length;

  return (
    <div>
      {/* Global Platform Switch */}
      <div className={`${glassCard} p-4 mb-4`}>
        <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
          <Activity size={14} className="text-cyan-400" /> Edge Function Router
        </h3>
        <p className="text-[10px] text-zinc-400 mb-4">
          Lovable Cloud বন্ধ হলে Deno Deploy তে সুইচ করো। প্রতিটা function আলাদা করে কন্ট্রোল করতে পারবে।
        </p>

        {/* Stats Cards */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-lg p-2.5 text-center">
            <div className="text-lg font-bold text-indigo-400">{EDGE_FUNCTIONS.length}</div>
            <div className="text-[9px] text-zinc-400">Total Functions</div>
          </div>
          <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-2.5 text-center">
            <div className="text-lg font-bold text-green-400">{config.platform === "lovable" ? "LC" : "DD"}</div>
            <div className="text-[9px] text-zinc-400">Default Platform</div>
          </div>
          <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-2.5 text-center">
            <div className="text-lg font-bold text-orange-400">{denoActive}</div>
            <div className="text-[9px] text-zinc-400">Deno Override</div>
          </div>
        </div>

        {/* Global Toggle */}
        <div className="flex items-center justify-between bg-zinc-800/50 rounded-xl p-3 mb-4">
          <div>
            <div className="text-xs font-semibold text-white">ডিফল্ট প্ল্যাটফর্ম</div>
            <div className="text-[10px] text-zinc-400">"Auto" ফাংশনগুলো এখানে যাবে</div>
          </div>
          <button
            onClick={togglePlatform}
            className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${
              config.platform === "lovable"
                ? "bg-indigo-600 text-white"
                : "bg-emerald-600 text-white"
            }`}
          >
            {config.platform === "lovable" ? "☁️ Lovable Cloud" : "🦕 Deno Deploy"}
          </button>
        </div>

        {/* Deno Deploy Base URL */}
        <div className="mb-4">
          <label className="text-[10px] text-zinc-400 block mb-1">Deno Deploy Base URL</label>
          <div className="flex gap-2">
            <input
              value={denoUrlInput}
              onChange={(e) => setDenoUrlInput(e.target.value)}
              placeholder="https://your-project.deno.dev"
              className={`${inputClass} flex-1`}
            />
            <button
              onClick={() => saveConfig({ denoBaseUrl: denoUrlInput.trim() })}
              className={`${btnPrimary} !px-3`}
            >
              <Save size={12} /> Save
            </button>
          </div>
          {config.denoBaseUrl && (
            <div className="mt-1.5 text-[10px] text-green-400">✓ {config.denoBaseUrl}</div>
          )}
        </div>

        {/* Check Status Button */}
        <button
          onClick={checkAllStatuses}
          disabled={checking}
          className={`${btnPrimary} w-full !py-2.5 mb-4`}
        >
          {checking ? (
            <><RefreshCw size={14} className="animate-spin" /> Checking...</>
          ) : (
            <><Activity size={14} /> Live Status চেক করো</>
          )}
        </button>
      </div>

      {/* Per-Function Controls */}
      <div className={`${glassCard} p-4 mb-4`}>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Settings size={14} className="text-purple-400" /> Function-wise কন্ট্রোল
        </h3>
        <div className="space-y-2">
          {EDGE_FUNCTIONS.map((fn) => {
            const fnPlatform = config.perFunction[fn] || "auto";
            const lovableStatus = statuses[fn]?.lovable;
            const denoStatus = statuses[fn]?.deno;
            const activePlatform = fnPlatform === "auto" ? config.platform : fnPlatform;

            return (
              <div key={fn} className="bg-zinc-800/40 rounded-xl p-3 border border-zinc-700/40">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${
                      activePlatform === "lovable" ? "bg-indigo-500" : "bg-emerald-500"
                    }`} />
                    <span className="text-xs font-semibold text-white">{fn}</span>
                  </div>
                  <div className="flex gap-1">
                    {(["auto", "lovable", "deno"] as const).map((p) => (
                      <button
                        key={p}
                        onClick={() => setFunctionPlatform(fn, p)}
                        className={`px-2 py-0.5 rounded-full text-[9px] font-bold transition-all ${
                          fnPlatform === p
                            ? p === "lovable" ? "bg-indigo-600 text-white"
                              : p === "deno" ? "bg-emerald-600 text-white"
                              : "bg-zinc-600 text-white"
                            : "bg-zinc-700/50 text-zinc-400 hover:text-white"
                        }`}
                      >
                        {p === "auto" ? "Auto" : p === "lovable" ? "LC" : "Deno"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Live Status */}
                {(lovableStatus || denoStatus) && (
                  <div className="flex gap-3 mt-1">
                    {lovableStatus && (
                      <div className="flex items-center gap-1.5">
                        <div className={`w-1.5 h-1.5 rounded-full ${lovableStatus.alive ? "bg-green-400" : "bg-red-400"}`} />
                        <span className="text-[9px] text-zinc-400">LC: {lovableStatus.alive ? `${lovableStatus.latency}ms` : "Down"}</span>
                      </div>
                    )}
                    {denoStatus && (
                      <div className="flex items-center gap-1.5">
                        <div className={`w-1.5 h-1.5 rounded-full ${denoStatus.alive ? "bg-green-400" : "bg-red-400"}`} />
                        <span className="text-[9px] text-zinc-400">Deno: {denoStatus.alive ? `${denoStatus.latency}ms` : "Down"}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Guide */}
      <div className={`${glassCard} p-4`}>
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
          📖 Deno Deploy সেটআপ গাইড
        </h3>
        <div className="text-[10px] text-zinc-400 space-y-1.5">
          <p>১. <a href="https://dash.deno.com" target="_blank" rel="noopener noreferrer" className="text-cyan-400 underline">dash.deno.com</a> এ গিয়ে একাউন্ট খোলো</p>
          <p>২. GitHub রিপো কানেক্ট করো বা ম্যানুয়ালি ডিপ্লয় করো</p>
          <p>৩. প্রতিটা Edge Function আলাদা Deno Deploy প্রজেক্ট হিসেবে ডিপ্লয় করো</p>
          <p>৪. Environment Variables (TELEGRAM_BOT_TOKEN, FIREBASE_SERVICE_ACCOUNT_KEY ইত্যাদি) Deno Deploy ড্যাশবোর্ডে সেট করো</p>
          <p>৫. Base URL এখানে পেস্ট করে সেভ করো</p>
          <p className="text-yellow-400 mt-2">⚠️ Deno Deploy তে তোমার কোড হুবহু চলবে — কোনো পরিবর্তন লাগবে না!</p>
        </div>
      </div>
    </div>
  );
};

// ==================== UI THEMES SECTION ====================
const UIThemesSection = ({ glassCard, btnPrimary }: { glassCard: string; btnPrimary: string }) => {
  const [activeThemeId, setActiveThemeId] = useState("default");

  useEffect(() => {
    const unsub = onValue(ref(db, "settings/activeTheme"), (snap) => {
      setActiveThemeId(snap.val() || "default");
    });
    return () => unsub();
  }, []);

  const applyTheme = async (preset: ThemePreset) => {
    try {
      await set(ref(db, "settings/activeTheme"), preset.id);
      toast.success(`${preset.emoji} ${preset.name} থিম অ্যাক্টিভ হয়েছে!`);
    } catch {
      toast.error("থিম সেভ ব্যর্থ");
    }
  };

  return (
    <div>
      <div className={`${glassCard} p-4 mb-4`}>
        <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
          <Zap size={14} className="text-yellow-400" /> UI Theme Presets
        </h3>
        <p className="text-[11px] text-zinc-400 mb-4">
          ২০টি থিম থেকে পছন্দের থিম সিলেক্ট করো। সব ইউজারের UI একসাথে চেঞ্জ হবে।
        </p>
        <div className="grid grid-cols-2 gap-2.5">
          {THEME_PRESETS.map((preset) => {
            const isActive = activeThemeId === preset.id;
            return (
              <button
                key={preset.id}
                onClick={() => applyTheme(preset)}
                className={`relative rounded-xl p-3 text-left transition-all duration-300 border-2 ${
                  isActive
                    ? "border-green-500 ring-2 ring-green-500/30 shadow-lg"
                    : "border-zinc-700/50 hover:border-zinc-500"
                }`}
                style={{ background: "rgba(30,30,50,0.6)" }}
              >
                {isActive && (
                  <div className="absolute top-1.5 right-1.5 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                    <Check size={11} className="text-white" />
                  </div>
                )}
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xl">{preset.emoji}</span>
                  <span className="text-xs font-bold text-white">{preset.name}</span>
                </div>
                <p className="text-[10px] text-zinc-400 mb-2">{preset.description}</p>
                <div className="flex gap-1">
                  {Object.values(preset.colors).map((c, i) => (
                    <div
                      key={i}
                      className="w-5 h-5 rounded-full border border-zinc-600"
                      style={{ background: c }}
                    />
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ==================== FORCE NOTIFICATION TOGGLE ====================
const ForceNotifToggle = ({ glassCard }: { glassCard: string }) => {
  const [enabled, setEnabled] = useState(false);
  const [totalTokens, setTotalTokens] = useState(0);
  const [totalUsers, setTotalUsers] = useState(0);

  useEffect(() => {
    const unsub = onValue(ref(db, "settings/forceNotifPrompt"), (snap) => {
      setEnabled(snap.val() === true);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onValue(ref(db, "fcmTokens"), (snap) => {
      const data = snap.val() || {};
      const users = Object.keys(data).length;
      let tokens = 0;
      Object.values(data).forEach((ut: any) => { tokens += Object.keys(ut || {}).length; });
      setTotalUsers(users);
      setTotalTokens(tokens);
    });
    return () => unsub();
  }, []);

  const toggle = async () => {
    const next = !enabled;
    await set(ref(db, "settings/forceNotifPrompt"), next);
    toast.success(next ? "✅ সব ইউজারকে নোটিফিকেশন প্রম্পট দেখাবে" : "⏸ প্রম্পট বন্ধ করা হয়েছে");
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${enabled ? "bg-green-500 animate-pulse" : "bg-zinc-600"}`} />
          <span className="text-xs font-medium">{enabled ? "অ্যাক্টিভ" : "বন্ধ"}</span>
        </div>
        <button onClick={toggle}
          className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${enabled ? "bg-red-500/20 text-red-400 hover:bg-red-500/30" : "bg-green-500/20 text-green-400 hover:bg-green-500/30"}`}>
          {enabled ? "বন্ধ করুন" : "চালু করুন"}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 mt-2">
        <div className="bg-zinc-800/50 rounded-lg p-2.5 text-center">
          <p className="text-lg font-bold text-green-400">{totalUsers}</p>
          <p className="text-[10px] text-zinc-400">ইউজার (টোকেন আছে)</p>
        </div>
        <div className="bg-zinc-800/50 rounded-lg p-2.5 text-center">
          <p className="text-lg font-bold text-blue-400">{totalTokens}</p>
          <p className="text-[10px] text-zinc-400">মোট FCM টোকেন</p>
        </div>
      </div>
    </div>
  );
};

// ==================== CUSTOM FONTS LIST ====================
const CUSTOM_FONTS = [
  { id: "default", name: "Default", family: "" },
  { id: "serif", name: "Serif Classic", family: "'Georgia', serif" },
  { id: "impact", name: "Impact Bold", family: "'Impact', 'Arial Black', sans-serif" },
  { id: "cursive", name: "Cursive", family: "'Segoe Script', 'Comic Sans MS', cursive" },
  { id: "monospace", name: "Monospace", family: "'Courier New', monospace" },
  { id: "arabic", name: "Arabic Style", family: "'Amiri', 'Times New Roman', serif" },
  { id: "bangla", name: "Bangla", family: "'Noto Sans Bengali', 'SolaimanLipi', sans-serif" },
  { id: "fantasy", name: "Fantasy", family: "'Papyrus', fantasy" },
  { id: "elegant", name: "Elegant", family: "'Playfair Display', 'Didot', serif" },
  { id: "modern", name: "Modern Sans", family: "'Helvetica Neue', 'Arial', sans-serif" },
  { id: "condensed", name: "Condensed", family: "'Arial Narrow', 'Roboto Condensed', sans-serif" },
  { id: "handwriting", name: "Handwriting", family: "'Dancing Script', 'Brush Script MT', cursive" },
];

// ==================== HERO PINNED POSTS SECTION ====================
const HeroPinnedPostsSection = ({
  glassCard, inputClass, btnPrimary, btnSecondary,
  webseriesData, moviesData, animesaltSelectedData,
}: {
  glassCard: string; inputClass: string; btnPrimary: string; btnSecondary: string;
  webseriesData: any[]; moviesData: any[]; animesaltSelectedData: Record<string, any>;
}) => {
  const [pinnedPosts, setPinnedPosts] = useState<any[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [imagePreview, setImagePreview] = useState("");
  const [titleColor, setTitleColor] = useState("#ffffff");
  const [titleFont, setTitleFont] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // Custom background image
  const [bgImageUrl, setBgImageUrl] = useState("");
  const [bgImagePreview, setBgImagePreview] = useState("");
  const bgFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const unsub = onValue(ref(db, "settings/pinnedHeroPosts"), (snap) => {
      const data = snap.val();
      if (data) {
        const arr = Object.entries(data).map(([k, v]: any) => ({ _key: k, ...v }));
        arr.sort((a: any, b: any) => (b.pinnedAt || 0) - (a.pinnedAt || 0));
        setPinnedPosts(arr);
      } else {
        setPinnedPosts([]);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onValue(ref(db, "settings/customBgImage"), (snap) => {
      const val = snap.val() || "";
      setBgImageUrl(val);
      setBgImagePreview(val);
    });
    return () => unsub();
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = ev.target?.result as string;
      setImagePreview(result);
      setImageUrl(result);
    };
    reader.readAsDataURL(file);
  };

  const handleImageUrlChange = (url: string) => {
    setImageUrl(url);
    setImagePreview(url);
  };

  const handleBgFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = ev.target?.result as string;
      setBgImagePreview(result);
      setBgImageUrl(result);
    };
    reader.readAsDataURL(file);
  };

  const saveBgImage = async () => {
    try {
      await set(ref(db, "settings/customBgImage"), bgImageUrl.trim());
      toast.success(bgImageUrl.trim() ? "✅ ব্যাকগ্রাউন্ড ইমেজ সেট হয়েছে!" : "ব্যাকগ্রাউন্ড ইমেজ রিমুভ হয়েছে");
    } catch {
      toast.error("সেভ ব্যর্থ");
    }
  };

  const addCustomPost = async () => {
    if (!title.trim()) { toast.error("টাইটেল দিন"); return; }
    if (!imageUrl.trim()) { toast.error("ছবি দিন (URL বা আপলোড)"); return; }
    try {
      await push(ref(db, "settings/pinnedHeroPosts"), {
        id: `custom_${Date.now()}`,
        title: title.trim(),
        backdrop: imageUrl.trim(),
        description: description.trim(),
        type: "custom",
        isCustom: true,
        rating: "",
        year: "",
        titleColor: titleColor || "#ffffff",
        titleFont: titleFont || "",
        pinnedAt: Date.now(),
      });
      toast.success(`📌 "${title}" হিরো স্লাইডারে পোস্ট করা হয়েছে!`);
      setTitle("");
      setDescription("");
      setImageUrl("");
      setImagePreview("");
      setTitleColor("#ffffff");
      setTitleFont("");
    } catch {
      toast.error("পোস্ট করা ব্যর্থ");
    }
  };

  const unpinContent = async (key: string) => {
    try {
      await remove(ref(db, `settings/pinnedHeroPosts/${key}`));
      toast.success("পোস্ট ডিলিট হয়েছে!");
    } catch {
      toast.error("ডিলিট ব্যর্থ");
    }
  };

  return (
    <div>
      {/* Custom Background Image */}
      <div className={`${glassCard} p-4 mb-4`}>
        <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
          🖼️ কাস্টম ব্যাকগ্রাউন্ড ইমেজ
        </h3>
        <p className="text-[11px] text-zinc-400 mb-3">
          পুরো ওয়েবসাইটে ব্যাকগ্রাউন্ডে এই ছবিটি দেখাবে — কার্ডের পিছে, হিরো স্লাইডারের পিছে, প্রোফাইলে সব জায়গায়।
        </p>
        <div className="flex gap-2 mb-2">
          <input
            value={bgImageUrl.startsWith("data:") ? "" : bgImageUrl}
            onChange={(e) => { setBgImageUrl(e.target.value); setBgImagePreview(e.target.value); }}
            placeholder="ব্যাকগ্রাউন্ড ছবির URL..."
            className={`${inputClass} flex-1`}
          />
          <button onClick={() => bgFileRef.current?.click()} className={`${btnSecondary} !px-3 whitespace-nowrap`}>
            <Download size={14} /> Upload
          </button>
          <input ref={bgFileRef} type="file" accept="image/*" onChange={handleBgFileSelect} className="hidden" />
        </div>
        {bgImagePreview && (
          <div className="relative rounded-lg overflow-hidden mb-2">
            <img src={bgImagePreview} alt="BG Preview" className="w-full h-24 object-cover rounded-lg opacity-60" />
            <button onClick={() => { setBgImageUrl(""); setBgImagePreview(""); }} className="absolute top-1.5 right-1.5 bg-red-500/80 rounded-full p-1">
              <X size={12} className="text-white" />
            </button>
          </div>
        )}
        <button onClick={saveBgImage} className={`${btnPrimary} w-full justify-center`}>
          <Save size={14} /> ব্যাকগ্রাউন্ড সেভ করুন
        </button>
      </div>

      {/* Create Custom Post */}
      <div className={`${glassCard} p-4 mb-4`}>
        <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
          <Pin size={14} className="text-yellow-400" /> কাস্টম হিরো পোস্ট তৈরি করুন
        </h3>
        <p className="text-[11px] text-zinc-400 mb-4">
          ছবি আপলোড করুন বা লিংক দিন, টাইটেল ও বিবরণ লিখুন। কালার ও ফন্ট কাস্টমাইজ করুন।
        </p>

        {/* Image Input */}
        <div className="mb-3">
          <label className="text-[11px] text-zinc-400 mb-1.5 block">📷 ব্যানার ছবি</label>
          <div className="flex gap-2 mb-2">
            <input
              value={imageUrl.startsWith("data:") ? "" : imageUrl}
              onChange={(e) => handleImageUrlChange(e.target.value)}
              placeholder="ছবির URL দিন (https://...)"
              className={`${inputClass} flex-1`}
            />
            <button
              onClick={() => fileRef.current?.click()}
              className={`${btnSecondary} !px-3 whitespace-nowrap`}
            >
              <Download size={14} /> Upload
            </button>
            <input ref={fileRef} type="file" accept="image/*" onChange={handleFileSelect} className="hidden" />
          </div>
          {imagePreview && (
            <div className="relative rounded-lg overflow-hidden mb-2">
              <img src={imagePreview} alt="Preview" className="w-full h-32 object-cover rounded-lg" />
              <button
                onClick={() => { setImageUrl(""); setImagePreview(""); }}
                className="absolute top-1.5 right-1.5 bg-red-500/80 rounded-full p-1"
              >
                <X size={12} className="text-white" />
              </button>
            </div>
          )}
        </div>

        {/* Title */}
        <div className="mb-3">
          <label className="text-[11px] text-zinc-400 mb-1.5 block">📝 টাইটেল</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="পোস্টের টাইটেল..."
            className={inputClass}
          />
        </div>

        {/* Title Color */}
        <div className="mb-3">
          <label className="text-[11px] text-zinc-400 mb-1.5 block">🎨 টাইটেল কালার</label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={titleColor}
              onChange={(e) => setTitleColor(e.target.value)}
              className="w-10 h-10 rounded-lg border border-zinc-600 cursor-pointer bg-transparent"
            />
            <div className="flex flex-wrap gap-1.5">
              {["#ffffff", "#f59e0b", "#ef4444", "#22c55e", "#3b82f6", "#a855f7", "#ec4899", "#06b6d4", "#000000"].map(c => (
                <button
                  key={c}
                  onClick={() => setTitleColor(c)}
                  className={`w-7 h-7 rounded-full border-2 transition-all ${titleColor === c ? "border-white scale-110" : "border-zinc-600"}`}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>
          {title && (
            <p className="mt-2 text-lg font-bold" style={{ color: titleColor, fontFamily: titleFont || undefined }}>
              {title}
            </p>
          )}
        </div>

        {/* Title Font */}
        <div className="mb-3">
          <label className="text-[11px] text-zinc-400 mb-1.5 block">🔤 টাইটেল ফন্ট</label>
          <div className="grid grid-cols-2 gap-1.5 max-h-[200px] overflow-y-auto">
            {CUSTOM_FONTS.map(f => (
              <button
                key={f.id}
                onClick={() => setTitleFont(f.family)}
                className={`px-3 py-2 rounded-lg text-left text-xs transition-all border ${
                  titleFont === f.family
                    ? "border-green-500 bg-green-500/10 text-green-400"
                    : "border-zinc-700/50 text-zinc-300 hover:border-zinc-500"
                }`}
                style={{ fontFamily: f.family || undefined }}
              >
                {f.name}
              </button>
            ))}
          </div>
        </div>

        {/* Description */}
        <div className="mb-3">
          <label className="text-[11px] text-zinc-400 mb-1.5 block">📄 বিবরণ / ডেসক্রিপশন</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="বিস্তারিত বিবরণ লিখুন... (ক্লিক করলে ডিটেইল পেজে এটা দেখাবে)"
            className={`${inputClass} !h-24 resize-none`}
            rows={4}
          />
        </div>

        <button onClick={addCustomPost} className={`${btnPrimary} w-full justify-center`}>
          <Send size={14} /> পোস্ট করুন
        </button>
      </div>

      {/* Existing Posts */}
      <div className={`${glassCard} p-4 mb-4`}>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <List size={14} className="text-blue-400" /> পোস্ট করা আইটেম ({pinnedPosts.length})
        </h3>
        {pinnedPosts.length === 0 ? (
          <div className="text-center py-8">
            <Pin size={24} className="mx-auto text-zinc-600 mb-2" />
            <p className="text-xs text-zinc-500">কোনো পোস্ট নেই</p>
          </div>
        ) : (
          <div className="space-y-2">
            {pinnedPosts.map((post, idx) => (
              <div key={post._key} className="flex items-start gap-3 p-2.5 rounded-lg bg-zinc-800/50 border border-zinc-700/50">
                <span className="text-xs font-bold text-yellow-500 w-5 mt-1">#{idx + 1}</span>
                <img src={post.backdrop} alt="" className="w-16 h-10 rounded object-cover shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate" style={{ color: post.titleColor || "#fff", fontFamily: post.titleFont || undefined }}>{post.title}</p>
                  {post.description && (
                    <p className="text-[10px] text-zinc-400 line-clamp-2 mt-0.5">{post.description}</p>
                  )}
                  <p className="text-[10px] text-zinc-500 mt-0.5">
                    {post.isCustom ? "📌 Custom" : post.type === "webseries" ? "Series" : "Movie"} • {new Date(post.pinnedAt).toLocaleDateString()}
                  </p>
                </div>
                <button
                  onClick={() => unpinContent(post._key)}
                  className="p-1.5 rounded-lg hover:bg-red-500/20 text-red-400 transition-colors shrink-0"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const Admin = forwardRef<HTMLDivElement>((_, _ref) => {
  // Auth states
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    try {
      const stored = localStorage.getItem("rs_admin_session");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.ts && Date.now() - parsed.ts < 7 * 24 * 60 * 60 * 1000) {
          return true;
        }
        localStorage.removeItem("rs_admin_session");
      }
    } catch {}
    return false;
  });
  const [loginPinInput, setLoginPinInput] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [pinExists, setPinExists] = useState<boolean | null>(null); // null = loading
  const [createPinInput, setCreatePinInput] = useState("");
  const [createPinConfirm, setCreatePinConfirm] = useState("");
  const [showPinSetup, setShowPinSetup] = useState(false);
  const [newPinInput, setNewPinInput] = useState("");
  const [currentPin, setCurrentPin] = useState("");

  const [activeSection, setActiveSection] = useState<Section>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [firebaseConnected, setFirebaseConnected] = useState(false);
  const [fetchingOverlay, setFetchingOverlay] = useState(false);

  // Data state
  const [categoriesData, setCategoriesData] = useState<Record<string, any>>({});
  const [webseriesData, setWebseriesData] = useState<any[]>([]);
  const [moviesData, setMoviesData] = useState<any[]>([]);
  const [usersData, setUsersData] = useState<any[]>([]);
  const [notificationsData, setNotificationsData] = useState<any[]>([]);
  const [releasesData, setReleasesData] = useState<any[]>([]);
  const [commentsData, setCommentsData] = useState<any[]>([]);

  // Form states
  const [categoryInput, setCategoryInput] = useState("");
  const [seriesTab, setSeriesTab] = useState<"ws-list" | "ws-add">("ws-list");
  const [moviesTab, setMoviesTab] = useState<"mv-list" | "mv-add">("mv-list");
  const [fetchType, setFetchType] = useState<"movie" | "tv">("movie");
  const [quickTmdbId, setQuickTmdbId] = useState("");

  // Series form
  const [seriesForm, setSeriesForm] = useState<any>(null);
  const [seriesCast, setSeriesCast] = useState<CastMember[]>([]);
  const [seasonsData, setSeasonsData] = useState<Season[]>([]);
  const [seriesSearch, setSeriesSearch] = useState("");
  const [seriesResults, setSeriesResults] = useState<any[]>([]);
  const [seriesEditId, setSeriesEditId] = useState("");

  // Movie form
  const [movieForm, setMovieForm] = useState<any>(null);
  const [movieCast, setMovieCast] = useState<CastMember[]>([]);
  const [movieSearch, setMovieSearch] = useState("");
  const [movieResults, setMovieResults] = useState<any[]>([]);
  const [wsListSearch, setWsListSearch] = useState("");
  const [mvListSearch, setMvListSearch] = useState("");
  const [movieEditId, setMovieEditId] = useState("");

  // Notification form
  const [notifTitle, setNotifTitle] = useState("");
  const [notifMessage, setNotifMessage] = useState("");
  const [notifContent, setNotifContent] = useState("");
  const [notifType, setNotifType] = useState("info");
  const [notifTarget, setNotifTarget] = useState("all");
  const [contentOptions, setContentOptions] = useState<{ value: string; label: string; poster: string }[]>([]);
  const [notifDropdownOpen, setNotifDropdownOpen] = useState(false);
  const [releaseDropdownOpen, setReleaseDropdownOpen] = useState(false);
  const notifDropdownRef = useRef<HTMLDivElement>(null);
  const releaseDropdownRef = useRef<HTMLDivElement>(null);

  // New release form
  const [releaseContent, setReleaseContent] = useState("");
  const [releaseSeason, setReleaseSeason] = useState("");
  const [releaseEpisode, setReleaseEpisode] = useState("");
  const [releaseSeasons, setReleaseSeasons] = useState<any[]>([]);
  const [releaseEpisodes, setReleaseEpisodes] = useState<any[]>([]);
  const [showSeasonEpisode, setShowSeasonEpisode] = useState(false);
  const [releaseSearchQuery, setReleaseSearchQuery] = useState("");
  const [releaseContentSearch, setReleaseContentSearch] = useState("");

  // Redeem code state
  const [redeemCodesData, setRedeemCodesData] = useState<any[]>([]);
  const [newCodeDays, setNewCodeDays] = useState("30");
  const [newCodeNote, setNewCodeNote] = useState("");

  // bKash Payment states
  const [bkashSettings, setBkashSettings] = useState<any>({
    phoneNumber: "",
    accountType: "Agent",
    qrCodeLink: "",
    instructions: "Send Money করুন নিচের নাম্বারে এবং Transaction ID সাবমিট করুন।",
    plans: [
      { id: "plan1", name: "1 Month", days: 30, price: 100, active: true },
      { id: "plan2", name: "3 Months", days: 90, price: 250, active: true },
      { id: "plan3", name: "6 Months", days: 180, price: 450, active: true },
    ],
  });
  const [bkashPaymentRequests, setBkashPaymentRequests] = useState<any[]>([]);
  const [bkashSettingsLoaded, setBkashSettingsLoaded] = useState(false);

  // Free access users state
  const [freeAccessUsers, setFreeAccessUsers] = useState<any[]>([]);

  // Settings state
  const [tutorialLink, setTutorialLink] = useState("");
  const [tutorialLinkInput, setTutorialLinkInput] = useState("");
  const [adminUserIdInput, setAdminUserIdInput] = useState("");
  const [savedAdminUserId, setSavedAdminUserId] = useState("");

  // Maintenance state
  const [maintenanceActive, setMaintenanceActive] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState("Server is under maintenance. Please wait.");
  const [maintenanceResumeDate, setMaintenanceResumeDate] = useState("");
  const [currentMaintenance, setCurrentMaintenance] = useState<any>(null);

  // Global free access state
  const [globalFreeAccess, setGlobalFreeAccess] = useState<any>(null);
  const [globalFreeHours, setGlobalFreeHours] = useState("2");
  const [globalFreeMinutes, setGlobalFreeMinutes] = useState("0");

  // Analytics state
  const [analyticsViews, setAnalyticsViews] = useState<Record<string, any>>({});
  const [activeViewers, setActiveViewers] = useState<Record<string, any>>({});
  const [dailyActiveUsers, setDailyActiveUsers] = useState<Record<string, any>>({});

  // AnimeSalt selected data for content options
  const [animesaltSelectedData, setAnimesaltSelectedData] = useState<Record<string, any>>({});

  // Push progress state
  const [pushProgress, setPushProgress] = useState<PushProgress | null>(null);
  const [pushSending, setPushSending] = useState(false);
  const [fcmTokenStats, setFcmTokenStats] = useState<{ totalTokens: number; totalUsers: number; lastUpdated: number }>({
    totalTokens: 0,
    totalUsers: 0,
    lastUpdated: 0,
  });

  // Expanded episodes
  const [expandedSeasons, setExpandedSeasons] = useState<Record<number, boolean>>({});

  // JSON import for Web Series
  const [wsJsonImportMode, setWsJsonImportMode] = useState(false);
  const [wsJsonPasteText, setWsJsonPasteText] = useState("");
  const wsJsonFileRef = useRef<HTMLInputElement>(null);

  // Telegram post states
  const [tgChannelId, setTgChannelId] = useState(TELEGRAM_CHANNEL);
  const [tgSelectedRelease, setTgSelectedRelease] = useState("");
  const [tgTitle, setTgTitle] = useState("");
  const [tgSeason, setTgSeason] = useState("");
  const [tgTotalEpisodes, setTgTotalEpisodes] = useState("");
  const [tgQuality, setTgQuality] = useState("480p,720p,1080p");
  const [tgNewEpAdded, setTgNewEpAdded] = useState("");
  const [tgPosterUrl, setTgPosterUrl] = useState("");
  const [tgButtonLink, setTgButtonLink] = useState("");
  const [tgSending, setTgSending] = useState(false);
  const [tgDropdownOpen, setTgDropdownOpen] = useState(false);
  const [tgContentSearch, setTgContentSearch] = useState("");
  const tgDropdownRef = useRef<HTMLDivElement>(null);
  const [tgDubType, setTgDubType] = useState<"official" | "fandub">("official");

  // Category bulk assignment states
  const [catBulkSearch, setCatBulkSearch] = useState("");
  const [catBulkSelected, setCatBulkSelected] = useState<string[]>([]);
  const [catBulkCategory, setCatBulkCategory] = useState("");

  // Google auth for admin
  const [adminGoogleEmail, setAdminGoogleEmail] = useState("");
  const [googleAuthLoading, setGoogleAuthLoading] = useState(false);
  const wsSeasonJsonFileRef = useRef<HTMLInputElement>(null);
  const [wsSeasonJsonTarget, setWsSeasonJsonTarget] = useState<number>(-1);
  const [wsSeasonPasteTarget, setWsSeasonPasteTarget] = useState<number>(-1);
  const [wsSeasonPasteText, setWsSeasonPasteText] = useState("");

   // Save + Notify modal states
   const [wsSaveNotifyModal, setWsSaveNotifyModal] = useState(false);
   const [wsNotifyStep, setWsNotifyStep] = useState<"release" | "telegram">("release");
   const [wsNotifySeason, setWsNotifySeason] = useState("");
   const [wsNotifyEpisode, setWsNotifyEpisode] = useState("");
   // Captured context for Save+Notify (saveSeries resets form, so we save context before)
   const wsNotifyContextRef = useRef<{ seriesId: string; form: any; seasons: any[] } | null>(null);


  useEffect(() => {
    const connRef = ref(db, ".info/connected");
    const unsub = onValue(connRef, (snap) => {
      setFirebaseConnected(snap.val() === true);
    });
    return () => unsub();
  }, []);

  // Load PIN from Firebase
  useEffect(() => {
    const unsub = onValue(ref(db, "admin/pin"), (snap) => {
      const data = snap.val();
      if (data && data.enabled && data.code) {
        setPinExists(true);
        setCurrentPin(data.code);
      } else {
        setPinExists(false);
        setCurrentPin("");
      }
    });
    return () => unsub();
  }, []);

  // Auto-verify stored admin session against current PIN or Google
  useEffect(() => {
    if (isAuthenticated) {
      try {
        const stored = localStorage.getItem("rs_admin_session");
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Date.now() - (parsed.ts || 0) > 7 * 24 * 60 * 60 * 1000) {
            setIsAuthenticated(false);
            localStorage.removeItem("rs_admin_session");
            localStorage.removeItem("rs_admin_google");
            return;
          }
          // If PIN session, verify PIN still matches
          if (parsed.pin && currentPin && parsed.pin !== currentPin) {
            setIsAuthenticated(false);
            localStorage.removeItem("rs_admin_session");
          }
        }
      } catch {
        setIsAuthenticated(false);
        localStorage.removeItem("rs_admin_session");
      }
    }
  }, [currentPin]);

  // Load saved Telegram channel
  useEffect(() => {
    const unsub = onValue(ref(db, "admin/telegramChannel"), (snap) => {
      if (snap.val()) setTgChannelId(snap.val());
    });
    return () => unsub();
  }, []);

  // Load CORE data (always needed: categories, webseries, movies, maintenance)
  useEffect(() => {
    const unsubs: (() => void)[] = [];

    unsubs.push(onValue(ref(db, "categories"), (snap) => {
      setCategoriesData(snap.val() || {});
    }));

    unsubs.push(onValue(ref(db, "webseries"), (snap) => {
      const data = snap.val() || {};
      setWebseriesData(Object.entries(data).map(([id, item]: any) => ({ id, ...item })));
    }));

    unsubs.push(onValue(ref(db, "movies"), (snap) => {
      const data = snap.val() || {};
      setMoviesData(Object.entries(data).map(([id, item]: any) => ({ id, ...item })));
    }));

    unsubs.push(onValue(ref(db, "maintenance"), (snap) => {
      setCurrentMaintenance(snap.val());
      if (snap.val()?.active) setMaintenanceActive(true);
      else setMaintenanceActive(false);
    }));

    unsubs.push(onValue(ref(db, "globalFreeAccess"), (snap) => {
      setGlobalFreeAccess(snap.val() || null);
    }));

    unsubs.push(onValue(ref(db, "settings/tutorialLink"), (snap) => {
      const val = snap.val() || "";
      setTutorialLink(val);
      setTutorialLinkInput(val);
    }));

    unsubs.push(onValue(ref(db, "admin/userId"), (snap) => {
      const val = snap.val() || "";
      setSavedAdminUserId(val);
      setAdminUserIdInput(val);
    }));

    return () => unsubs.forEach(u => u());
  }, []);

  // Lazy-load USERS data (only when dashboard, users, notifications, or free-access section)
  useEffect(() => {
    const needsUsers = ["dashboard", "users", "notifications", "new-releases", "free-access", "analytics"].includes(activeSection);
    if (!needsUsers) return;

    const unsubs: (() => void)[] = [];

    unsubs.push(onValue(ref(db, "users"), (snap) => {
      const data = snap.val() || {};
      setUsersData(Object.entries(data).map(([id, user]: any) => ({ id, ...user })));
    }));

    unsubs.push(onValue(ref(db, "fcmTokens"), (snap) => {
      const data = snap.val() || {};
      let totalTokens = 0;
      Object.values(data).forEach((userTokens: any) => {
        totalTokens += Object.keys(userTokens || {}).length;
      });
      setFcmTokenStats({
        totalTokens,
        totalUsers: Object.keys(data).length,
        lastUpdated: Date.now(),
      });
    }));

    return () => unsubs.forEach(u => u());
  }, [activeSection]);

  // Lazy-load NOTIFICATIONS data
  useEffect(() => {
    if (activeSection !== "notifications") return;
    const unsub = onValue(ref(db, "notifications"), (snap) => {
      const data = snap.val() || {};
      const allNotifs: any[] = [];
      Object.entries(data).forEach(([uid, userNotifs]: any) => {
        Object.entries(userNotifs || {}).forEach(([notifId, notif]: any) => {
          allNotifs.push({ ...notif, id: notifId, oderId: uid, userId: uid });
        });
      });
      allNotifs.sort((a, b) => b.timestamp - a.timestamp);
      setNotificationsData(allNotifs);
    });
    return () => unsub();
  }, [activeSection]);

  // Lazy-load NEW RELEASES data
  useEffect(() => {
    if (activeSection !== "new-releases" && activeSection !== "dashboard" && activeSection !== "telegram-post") return;
    const unsub = onValue(ref(db, "newEpisodeReleases"), (snap) => {
      const data = snap.val() || {};
      const arr = Object.entries(data).map(([id, r]: any) => ({ id, ...r }));
      arr.sort((a, b) => b.timestamp - a.timestamp);
      setReleasesData(arr);
    });
    return () => unsub();
  }, [activeSection]);

  // Lazy-load AnimeSalt selected data for content options
  useEffect(() => {
    if (activeSection !== "new-releases" && activeSection !== "notifications" && activeSection !== "dashboard") return;
    const unsub = onValue(ref(db, 'animesaltSelected'), (snap) => {
      setAnimesaltSelectedData(snap.val() || {});
    });
    return () => unsub();
  }, [activeSection]);

  // Lazy-load REDEEM CODES data
  useEffect(() => {
    if (activeSection !== "redeem-codes") return;
    const unsub = onValue(ref(db, "redeemCodes"), (snap) => {
      const data = snap.val() || {};
      setRedeemCodesData(Object.entries(data).map(([id, item]: any) => ({ id, ...item })));
    });
    return () => unsub();
  }, [activeSection]);

  // Lazy-load FREE ACCESS USERS data
  useEffect(() => {
    if (activeSection !== "free-access") return;
    const unsub = onValue(ref(db, "freeAccessUsers"), (snap) => {
      const data = snap.val() || {};
      const now = Date.now();
      const activeUsers: any[] = [];
      Object.entries(data).forEach(([id, user]: [string, any]) => {
        if (user.expiresAt > now) {
          activeUsers.push({ id, ...user });
        } else {
          remove(ref(db, `freeAccessUsers/${id}`)).catch(() => {});
        }
      });
      activeUsers.sort((a, b) => b.unlockedAt - a.unlockedAt);
      setFreeAccessUsers(activeUsers);
    });
    return () => unsub();
  }, [activeSection]);

  // Lazy-load bKash settings & payment requests
  useEffect(() => {
    if (activeSection !== "bkash-payments" && activeSection !== "dashboard") return;
    const unsubs: (() => void)[] = [];
    unsubs.push(onValue(ref(db, "bkashSettings"), (snap) => {
      const data = snap.val();
      if (data) {
        setBkashSettings(data);
      }
      setBkashSettingsLoaded(true);
    }));
    unsubs.push(onValue(ref(db, "bkashPayments"), (snap) => {
      const data = snap.val() || {};
      setBkashPaymentRequests(Object.entries(data).map(([id, item]: any) => ({ id, ...item })).sort((a: any, b: any) => (b.submittedAt || 0) - (a.submittedAt || 0)));
    }));
    return () => unsubs.forEach(u => u());
  }, [activeSection]);

  // Lazy-load COMMENTS data
  useEffect(() => {
    if (activeSection !== "comments") return;
    const unsub = onValue(ref(db, "comments"), (snap) => {
      const data = snap.val() || {};
      const allComments: any[] = [];
      Object.entries(data).forEach(([animeId, comments]: any) => {
        Object.entries(comments || {}).forEach(([commentId, comment]: any) => {
          const replies = comment.replies ? Object.entries(comment.replies).map(([rId, r]: any) => ({
            id: rId, ...r
          })) : [];
          allComments.push({
            id: commentId, animeId, ...comment, replies,
          });
        });
      });
      allComments.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      setCommentsData(allComments);
    });
    return () => unsub();
  }, [activeSection]);

  // Lazy-load ANALYTICS data
  useEffect(() => {
    if (activeSection !== "analytics") return;
    const unsubs: (() => void)[] = [];
    unsubs.push(onValue(ref(db, "analytics/views"), (snap) => {
      setAnalyticsViews(snap.val() || {});
    }));
    unsubs.push(onValue(ref(db, "analytics/activeViewers"), (snap) => {
      setActiveViewers(snap.val() || {});
    }));
    unsubs.push(onValue(ref(db, "analytics/dailyActive"), (snap) => {
      setDailyActiveUsers(snap.val() || {});
    }));
    return () => unsubs.forEach(u => u());
  }, [activeSection]);

  // Build content options for notifications/releases (newest first by updatedAt/createdAt)
  useEffect(() => {
    const options: { value: string; label: string; poster: string; createdAt: number }[] = [];
    webseriesData.forEach(s => options.push({ value: `${s.id}|webseries`, label: `Series: ${s.title}`, poster: s.poster || "", createdAt: s.updatedAt || s.createdAt || 0 }));
    moviesData.forEach(m => options.push({ value: `${m.id}|movie`, label: `Movie: ${m.title}`, poster: m.poster || "", createdAt: m.updatedAt || m.createdAt || 0 }));
    // Sort by updatedAt/createdAt descending so newest edited/added items appear first
    options.sort((a, b) => b.createdAt - a.createdAt);
    setContentOptions(options);
  }, [webseriesData, moviesData]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (notifDropdownRef.current && !notifDropdownRef.current.contains(e.target as Node)) setNotifDropdownOpen(false);
      if (releaseDropdownRef.current && !releaseDropdownRef.current.contains(e.target as Node)) setReleaseDropdownOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Section history stack for back navigation
  const [sectionHistory, setSectionHistory] = useState<Section[]>(["dashboard"]);
  const savedScrollPos = useRef<number>(0);

  const showSection = (section: Section) => {
    setSectionHistory(prev => [...prev, section]);
    setActiveSection(section);
    setSidebarOpen(false);
    setDropdownOpen(false);
  };

  const handleAdminBack = useCallback(() => {
    // If in add/edit sub-tab, go back to list first and restore scroll
    if (activeSection === "webseries" && seriesTab === "ws-add") {
      setSeriesTab("ws-list");
      setSeriesEditId("");
      setTimeout(() => window.scrollTo({ top: savedScrollPos.current, behavior: "instant" as ScrollBehavior }), 50);
      return true;
    }
    if (activeSection === "movies" && moviesTab === "mv-add") {
      setMoviesTab("mv-list");
      setMovieEditId("");
      setTimeout(() => window.scrollTo({ top: savedScrollPos.current, behavior: "instant" as ScrollBehavior }), 50);
      return true;
    }
    if (sectionHistory.length > 1) {
      const newHistory = [...sectionHistory];
      newHistory.pop();
      const prevSection = newHistory[newHistory.length - 1];
      setSectionHistory(newHistory);
      setActiveSection(prevSection);
      return true;
    }
    return false;
  }, [sectionHistory, activeSection, seriesTab, moviesTab]);

  // Mobile back button handler for admin
  useEffect(() => {
    if (!isAuthenticated) return;
    window.history.pushState({ rsAdmin: true }, "");
    const onPopState = () => {
      window.history.pushState({ rsAdmin: true }, "");
      const handled = handleAdminBack();
      if (!handled) {
        // Go back to main site
        window.location.href = "/";
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [isAuthenticated, handleAdminBack]);

  const formatTime = (ts: number) => {
    if (!ts) return "";
    const diff = Date.now() - ts;
    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
    return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const sectionTitles: Record<Section, string> = {
    dashboard: "Dashboard",
    categories: "Categories",
    webseries: "Web Series",
    movies: "Movies",
    users: "Users",
    notifications: "Notifications",
    "new-releases": "New Releases",
    "tmdb-fetch": "TMDB Fetch",
    "add-content": "Add Content",
    "redeem-codes": "Redeem Codes",
    maintenance: "Server Maintenance",
    "free-access": "Free Access Users",
    settings: "Settings",
    comments: "Comments",
    analytics: "Analytics & Views",
    "auto-import": "Auto Import",
    "animesalt-manager": "AnimeSalt Manager",
    "bkash-payments": "bKash Payments",
    "device-limits": "Device Limits",
    "telegram-post": "Telegram Post",
    "live-support": "Live Support",
    "ui-themes": "UI Themes",
    "hero-pinned": "Hero Pinned Posts",
    "edge-router": "Edge Function Router",
  };

  // ==================== CATEGORIES ====================
  const saveCategory = () => {
    if (!categoryInput.trim()) { toast.error("Please enter category name"); return; }
    push(ref(db, "categories"), { name: categoryInput.trim(), createdAt: Date.now() })
      .then(() => { toast.success("Category saved!"); setCategoryInput(""); })
      .catch(err => toast.error("Error: " + err.message));
  };

  const editCategory = (id: string, oldName: string) => {
    const newName = prompt("Edit category name:", oldName);
    if (newName && newName.trim() && newName !== oldName) {
      update(ref(db, `categories/${id}`), { name: newName.trim(), updatedAt: Date.now() })
        .then(() => toast.success("Category updated!"))
        .catch(err => toast.error("Error: " + err.message));
    }
  };

  const deleteCategory = (id: string) => {
    if (confirm("Delete this category?")) {
      remove(ref(db, `categories/${id}`))
        .then(() => toast.success("Category deleted!"))
        .catch(err => toast.error("Error: " + err.message));
    }
  };

  // ==================== TMDB SEARCH ====================
  const searchTMDBSeries = async () => {
    if (!seriesSearch.trim()) { toast.error("Please enter search query"); return; }
    setFetchingOverlay(true);
    try {
      const res = await fetch(`${TMDB_BASE_URL}/search/tv?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(seriesSearch)}`);
      const data = await res.json();
      if (data.results?.length > 0) {
        setSeriesResults(data.results.slice(0, 9));
      } else {
        toast.error("No results found");
      }
    } catch { toast.error("Error searching TMDB"); }
    finally { setFetchingOverlay(false); }
  };

  const fetchSeriesDetails = async (id: number) => {
    // Check if this TMDB ID already exists
    const existing = webseriesData.find(s => s.tmdbId === id || s.tmdbId === String(id));
    if (existing) {
      toast.warning(`"${existing.title}" আগে থেকেই আছে!`, { duration: 5000 });
      // On second click (confirm), load existing data for editing
      if (seriesForm?.tmdbId === id || seriesForm?.tmdbId === String(id)) {
        editSeries(existing.id);
        setSeriesResults([]);
        return;
      }
      // Set form with TMDB ID so next click loads existing
      setSeriesForm({ tmdbId: id });
      return;
    }

    setFetchingOverlay(true);
    try {
      const res = await fetch(`${TMDB_BASE_URL}/tv/${id}?api_key=${TMDB_API_KEY}&append_to_response=credits,videos,images`);
      const data = await res.json();
      if (data.success === false) throw new Error("Not found");

      let trailerUrl = "";
      if (data.videos?.results) {
        const trailer = data.videos.results.find((v: any) => v.type === "Trailer" && v.site === "YouTube");
        if (trailer) trailerUrl = `https://www.youtube.com/watch?v=${trailer.key}`;
      }
      let logoUrl = "";
      if (data.images?.logos?.length > 0) {
        const logo = data.images.logos.find((l: any) => l.iso_639_1 === "en") || data.images.logos[0];
        logoUrl = TMDB_IMG_BASE + "w500" + logo.file_path;
      }
      const cast = data.credits?.cast?.slice(0, 10).map((c: any) => ({
        name: c.name, character: c.character, photo: c.profile_path ? TMDB_IMG_BASE + "w185" + c.profile_path : ""
      })) || [];

      // Auto-match TMDB genres with existing categories
      const catNames = Object.values(categoriesData).map((c: any) => c.name?.toLowerCase() || "");
      let autoCategory = "";
      if (data.genres) {
        for (const genre of data.genres) {
          const gName = (genre.name || "").toLowerCase();
          const matchIdx = catNames.findIndex(cn => cn.includes(gName) || gName.includes(cn.split(" / ")[0]) || gName.includes(cn.split("/")[0]?.trim()));
          if (matchIdx >= 0) {
            autoCategory = Object.values(categoriesData)[matchIdx]?.name || "";
            break;
          }
        }
      }

      setSeriesForm({
        tmdbId: data.id, title: data.name || "", logo: logoUrl, poster: data.poster_path ? TMDB_IMG_BASE + "original" + data.poster_path : "",
        backdrop: data.backdrop_path ? TMDB_IMG_BASE + "original" + data.backdrop_path : "", trailer: trailerUrl,
        year: data.first_air_date?.split("-")[0] || "", rating: data.vote_average?.toFixed(1) || "",
        language: "English", category: autoCategory, dubType: "official", storyline: data.overview || ""
      });
      if (autoCategory) toast.info(`অটো ক্যাটাগরি: ${autoCategory}`);
      setSeriesCast(cast);
      setSeriesResults([]);
      setSeriesEditId("");

      // Set seasons with episode names from TMDB
      const newSeasons: Season[] = [];
      if (data.seasons) {
        for (const season of data.seasons.filter((s: any) => s.season_number > 0)) {
          try {
            const seasonRes = await fetch(`${TMDB_BASE_URL}/tv/${data.id}/season/${season.season_number}?api_key=${TMDB_API_KEY}&language=en-US`);
            const seasonDetail = seasonRes.ok ? await seasonRes.json() : null;
            const episodes = seasonDetail?.episodes || [];
            newSeasons.push({
              name: season.name, seasonNumber: season.season_number,
              episodes: Array(season.episode_count).fill(null).map((_, i) => ({
                episodeNumber: i + 1,
                title: episodes[i]?.name || `Episode ${i + 1}`,
                link: ""
              }))
            });
          } catch {
            newSeasons.push({
              name: season.name, seasonNumber: season.season_number,
              episodes: Array(season.episode_count).fill(null).map((_, i) => ({
                episodeNumber: i + 1, title: `Episode ${i + 1}`, link: ""
              }))
            });
          }
        }
      }
      setSeasonsData(newSeasons);
      toast.success("Series details fetched! (এপিসোড নাম TMDB থেকে লোড হয়েছে)");
    } catch (err: any) { toast.error("Error: " + err.message); }
    finally { setFetchingOverlay(false); }
  };

  // Ref to store last saved series ID (for Save+Notify on new series)
  const lastSavedSeriesIdRef = useRef<string>("");

  const saveSeries = () => {
    if (!seriesForm) return;
    if (!seriesForm.title) { toast.error("Please enter title"); return; }
    if (!seriesForm.category) { toast.error("Please select category"); return; }

    const data = { ...seriesForm, cast: seriesCast, seasons: seasonsData, type: "webseries", updatedAt: Date.now() };
    let saveRef;
    let newId = seriesEditId || "";
    if (seriesEditId) {
      saveRef = ref(db, `webseries/${seriesEditId}`);
    } else {
      saveRef = push(ref(db, "webseries"));
      newId = saveRef.key || "";
      data.createdAt = Date.now();
    }
    lastSavedSeriesIdRef.current = newId;
    set(saveRef, data)
      .then(() => {
        toast.success(seriesEditId ? "Series updated!" : "Series saved!");
        setSeriesForm(null); setSeasonsData([]); setSeriesCast([]); setSeriesEditId(""); setSeriesTab("ws-list");
      })
      .catch(err => toast.error("Error: " + err.message));
  };

  const editSeries = async (id: string) => {
    savedScrollPos.current = window.scrollY;
    const snap = await get(ref(db, `webseries/${id}`));
    const data = snap.val();
    if (!data) return;
    setSeriesForm({
      tmdbId: data.tmdbId || "", title: data.title || "", logo: data.logo || "", poster: data.poster || "",
      backdrop: data.backdrop || "", trailer: data.trailer || "", year: data.year || "", rating: data.rating || "",
      language: data.language || "English", category: data.category || "", dubType: data.dubType || "official", storyline: data.storyline || ""
    });
    setSeriesCast(data.cast || []);
    setSeasonsData(data.seasons || []);
    setSeriesEditId(id);
    setActiveSection("webseries");
    setSeriesTab("ws-add");
    toast.info("Editing: " + data.title);
  };

  const deleteSeries = (id: string) => {
    if (confirm("Delete this series?")) {
      remove(ref(db, `webseries/${id}`)).then(() => toast.success("Deleted!")).catch(err => toast.error("Error: " + err.message));
    }
  };

  // ==================== MOVIES ====================
  const searchTMDBMovies = async () => {
    if (!movieSearch.trim()) { toast.error("Please enter search query"); return; }
    setFetchingOverlay(true);
    try {
      const res = await fetch(`${TMDB_BASE_URL}/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(movieSearch)}`);
      const data = await res.json();
      if (data.results?.length > 0) { setMovieResults(data.results.slice(0, 9)); }
      else { toast.error("No results found"); }
    } catch { toast.error("Error searching TMDB"); }
    finally { setFetchingOverlay(false); }
  };

  const fetchMovieDetails = async (id: number) => {
    // Check if this TMDB ID already exists
    const existing = moviesData.find(m => m.tmdbId === id || m.tmdbId === String(id));
    if (existing) {
      toast.warning(`"${existing.title}" আগে থেকেই আছে!`, { duration: 5000 });
      // On second click (confirm), load existing data for editing
      if (movieForm?.tmdbId === id || movieForm?.tmdbId === String(id)) {
        editMovie(existing.id);
        setMovieResults([]);
        return;
      }
      // Set form with TMDB ID so next click loads existing
      setMovieForm({ tmdbId: id });
      return;
    }

    setFetchingOverlay(true);
    try {
      const res = await fetch(`${TMDB_BASE_URL}/movie/${id}?api_key=${TMDB_API_KEY}&append_to_response=credits,videos,images`);
      const data = await res.json();
      if (data.success === false) throw new Error("Not found");

      let trailerUrl = "";
      if (data.videos?.results) {
        const trailer = data.videos.results.find((v: any) => v.type === "Trailer" && v.site === "YouTube");
        if (trailer) trailerUrl = `https://www.youtube.com/watch?v=${trailer.key}`;
      }
      let logoUrl = "";
      if (data.images?.logos?.length > 0) {
        const logo = data.images.logos.find((l: any) => l.iso_639_1 === "en") || data.images.logos[0];
        logoUrl = TMDB_IMG_BASE + "w500" + logo.file_path;
      }
      const cast = data.credits?.cast?.slice(0, 10).map((c: any) => ({
        name: c.name, character: c.character, photo: c.profile_path ? TMDB_IMG_BASE + "w185" + c.profile_path : ""
      })) || [];

      // Auto-match TMDB genres with existing categories
      const catNames = Object.values(categoriesData).map((c: any) => c.name?.toLowerCase() || "");
      let autoCategory = "";
      if (data.genres) {
        for (const genre of data.genres) {
          const gName = (genre.name || "").toLowerCase();
          const matchIdx = catNames.findIndex(cn => cn.includes(gName) || gName.includes(cn.split(" / ")[0]) || gName.includes(cn.split("/")[0]?.trim()));
          if (matchIdx >= 0) {
            autoCategory = Object.values(categoriesData)[matchIdx]?.name || "";
            break;
          }
        }
      }

      setMovieForm({
        tmdbId: data.id, title: data.title || "", logo: logoUrl, poster: data.poster_path ? TMDB_IMG_BASE + "original" + data.poster_path : "",
        backdrop: data.backdrop_path ? TMDB_IMG_BASE + "original" + data.backdrop_path : "", trailer: trailerUrl,
        year: data.release_date?.split("-")[0] || "", rating: data.vote_average?.toFixed(1) || "",
        language: "English", category: autoCategory, dubType: "official", storyline: data.overview || "", movieLink: "", downloadLink: ""
      });
      if (autoCategory) toast.info(`অটো ক্যাটাগরি: ${autoCategory}`);
      setMovieCast(cast);
      setMovieResults([]);
      setMovieEditId("");
      toast.success("Movie details fetched!");
    } catch (err: any) { toast.error("Error: " + err.message); }
    finally { setFetchingOverlay(false); }
  };

  const saveMovie = () => {
    if (!movieForm) return;
    if (!movieForm.title) { toast.error("Please enter title"); return; }
    if (!movieForm.category) { toast.error("Please select category"); return; }
    if (!movieForm.movieLink) { toast.error("Please enter movie link"); return; }

    const data = { ...movieForm, cast: movieCast, type: "movie", updatedAt: Date.now() };
    let saveRef;
    if (movieEditId) {
      saveRef = ref(db, `movies/${movieEditId}`);
    } else {
      saveRef = push(ref(db, "movies"));
      data.createdAt = Date.now();
    }
    set(saveRef, data)
      .then(() => {
        toast.success(movieEditId ? "Movie updated!" : "Movie saved!");
        setMovieForm(null); setMovieCast([]); setMovieEditId(""); setMoviesTab("mv-list");
      })
      .catch(err => toast.error("Error: " + err.message));
  };

  const editMovie = async (id: string) => {
    savedScrollPos.current = window.scrollY;
    const snap = await get(ref(db, `movies/${id}`));
    const data = snap.val();
    if (!data) return;
    setMovieForm({
      tmdbId: data.tmdbId || "", title: data.title || "", logo: data.logo || "", poster: data.poster || "",
      backdrop: data.backdrop || "", trailer: data.trailer || "", year: data.year || "", rating: data.rating || "",
      language: data.language || "English", category: data.category || "", dubType: data.dubType || "official", storyline: data.storyline || "",
      movieLink: data.movieLink || "", downloadLink: data.downloadLink || "",
      movieLink480: data.movieLink480 || "", movieLink720: data.movieLink720 || "",
      movieLink1080: data.movieLink1080 || "", movieLink4k: data.movieLink4k || ""
    });
    setMovieCast(data.cast || []);
    setMovieEditId(id);
    setActiveSection("movies");
    setMoviesTab("mv-add");
    toast.info("Editing: " + data.title);
  };

  const deleteMovie = (id: string) => {
    if (confirm("Delete this movie?")) {
      remove(ref(db, `movies/${id}`)).then(() => toast.success("Deleted!")).catch(err => toast.error("Error: " + err.message));
    }
  };

  // ==================== NOTIFICATIONS ====================
  const sendNotification = async () => {
    if (!notifTitle || !notifMessage) { toast.error("Please enter title and message"); return; }
    const savedTitle = notifTitle;
    const savedMessage = notifMessage;

    setPushSending(true);
    setPushProgress({ phase: "tokens", totalTokens: 0, sent: 0, success: 0, failed: 0, invalidRemoved: 0 });

    try {
      let contentId = "", contentType = "", contentPoster = "";
      if (notifContent) {
        const parts = notifContent.split("|");
        contentId = parts[0]; contentType = parts[1];
        contentPoster = contentOptions.find((o) => o.value === notifContent)?.poster || "";
      }

      const usersSnap = await get(ref(db, "users"));
      const users = usersSnap.val() || {};
      const targetUserIds: string[] = [];
      const userNotifUpdates: Record<string, any> = {};
      const seenUserIds = new Set<string>();

      Object.entries(users).forEach(([userKey, userData]: any) => {
        const effectiveUserId = String(userData?.id || userKey || "").trim();
        if (!effectiveUserId || seenUserIds.has(effectiveUserId)) return;
        if (notifTarget === "online" && !userData?.online) return;

        seenUserIds.add(effectiveUserId);
        targetUserIds.push(effectiveUserId);

        const notifKey = push(ref(db, `notifications/${effectiveUserId}`)).key;
        if (!notifKey) return;

        userNotifUpdates[`notifications/${effectiveUserId}/${notifKey}`] = {
          title: savedTitle,
          message: savedMessage,
          type: notifType,
          contentId,
          contentType,
          image: contentPoster,
          poster: contentPoster,
          timestamp: Date.now(),
          read: false,
        };
      });

      if (Object.keys(userNotifUpdates).length > 0) {
        await update(ref(db), userNotifUpdates);
      }
      toast.success(`In-app notification sent to ${targetUserIds.length} users`);
      setNotifTitle("");
      setNotifMessage("");

      if (targetUserIds.length === 0) {
        setPushSending(false); setPushProgress(null);
        return;
      }

      const pushPayload = {
        title: savedTitle || "RS ANIME",
        body: savedMessage,
        image: contentPoster || undefined,
        url: contentId ? `/?anime=${contentId}` : "/",
        data: { url: contentId ? `/?anime=${contentId}` : "/", type: notifType || "info", contentId },
      };

      const result = await sendPushToUsers(targetUserIds, pushPayload, (p) => setPushProgress({ ...p }));
      console.log("FCM result:", result);
      if ((result?.total || 0) === 0) {
        const reason = result?.reason ? ` [${result.reason}]` : "";
        toast.warning(`Push token পাওয়া যায়নি${reason} — শুধু in-app notification গেছে`);
      } else {
        toast.success(`Push: ${result?.success || 0} delivered, ${result?.failed || 0} failed`);
      }
    } catch (err: any) {
      console.warn("Notification send failed:", err);
      toast.error("Error: " + err.message);
    } finally {
      setTimeout(() => { setPushSending(false); setPushProgress(null); }, 6000);
    }
  };

  const deleteNotification = async (title: string, message: string, timestamp: number) => {
    if (!confirm("Delete this notification for all users?")) return;
    try {
      const snap = await get(ref(db, "notifications"));
      const allData = snap.val() || {};
      const deleteUpdates: Record<string, null> = {};

      Object.entries(allData).forEach(([uid, userNotifs]: any) => {
        Object.entries(userNotifs || {}).forEach(([nid, notif]: any) => {
          if (notif.title === title && notif.message === message) {
            deleteUpdates[`notifications/${uid}/${nid}`] = null;
          }
        });
      });

      const deleteCount = Object.keys(deleteUpdates).length;
      if (deleteCount > 0) {
        await update(ref(db), deleteUpdates);
        toast.success(`Deleted ${deleteCount} notifications`);
      } else {
        toast.error("Notification not found");
      }
    } catch (err: any) {
      console.error("Delete error:", err);
      toast.error("Error deleting notification");
    }
  };

  // ==================== NEW RELEASES ====================
  const handleReleaseContentChange = async (value: string) => {
    setReleaseContent(value);
    setReleaseSeason(""); setReleaseEpisode(""); setReleaseSeasons([]); setReleaseEpisodes([]);
    if (!value) { setShowSeasonEpisode(false); return; }
    const [contentId, contentType] = value.split("|");
    if (contentType === "webseries") {
      const series = webseriesData.find(s => s.id === contentId);
      if (series?.seasons?.length > 0) {
        setReleaseSeasons(series.seasons.map((s: any, i: number) => ({ index: i, name: s.name || `Season ${i + 1}` })));
        setShowSeasonEpisode(true);
      } else { toast.error("This series has no seasons"); setShowSeasonEpisode(false); }
    } else if (contentType === "movie") {
      setReleaseSeasons([{ index: 0, name: "Movie" }]);
      setReleaseEpisodes([{ index: 0, name: "Complete Movie" }]);
      setReleaseSeason("0"); setReleaseEpisode("0");
      setShowSeasonEpisode(true);
    }
  };

  const handleReleaseSeasonChange = (value: string) => {
    setReleaseSeason(value); setReleaseEpisode(""); setReleaseEpisodes([]);
    if (!releaseContent || value === "") return;
    const [contentId, contentType] = releaseContent.split("|");
    if (contentType === "animesalt") {
      // AnimeSalt no longer supported in releases - skip
      toast.error("AnimeSalt কন্টেন্ট New Release এ সাপোর্ট করা হয় না"); return;
    } else if (contentType === "webseries") {
      const series = webseriesData.find(s => s.id === contentId);
      if (series?.seasons?.[parseInt(value)]) {
        const season = series.seasons[parseInt(value)];
        if (season.episodes?.length > 0) {
          setReleaseEpisodes(season.episodes.map((ep: any, i: number) => ({ index: i, name: `Episode ${ep.episodeNumber || i + 1}` })));
        } else { toast.error("No episodes in this season"); }
      }
    } else if (contentType === "movie") {
      setReleaseEpisodes([{ index: 0, name: "Complete Movie" }]);
      setReleaseEpisode("0");
    }
  };

  const addNewRelease = async () => {
    if (!releaseContent || releaseSeason === "" || releaseEpisode === "") {
      toast.error("Please select content, season and episode"); return;
    }
    const [contentId, contentType] = releaseContent.split("|");
    let content: any; let episodeInfo: any = {};
    if (contentType === "webseries") {
      content = webseriesData.find(s => s.id === contentId);
      if (content?.seasons?.[parseInt(releaseSeason)]) {
        const season = content.seasons[parseInt(releaseSeason)];
        const episode = season.episodes?.[parseInt(releaseEpisode)];
        episodeInfo = {
          seasonNumber: parseInt(releaseSeason) + 1,
          episodeNumber: episode?.episodeNumber || parseInt(releaseEpisode) + 1,
          seasonName: season.name || `Season ${parseInt(releaseSeason) + 1}`
        };
      }
    } else {
      content = moviesData.find(m => m.id === contentId);
      episodeInfo = { type: "movie", seasonName: "Movie" };
    }
    if (!content) { toast.error("Content not found"); return; }

    const newRelease = {
      contentId, contentType, title: content.title, poster: content.poster || "",
      year: content.year || "N/A", rating: content.rating || "N/A",
      episodeInfo, timestamp: Date.now(), active: true
    };
    try {
      await set(push(ref(db, "newEpisodeReleases")), newRelease);
      toast.success("Added as New Release");
      // Send notification
      const usersSnap = await get(ref(db, "users"));
      const users = usersSnap.val() || {};
      const releaseNotifTitle = contentType === "webseries" ? `New Episode: ${content.title}` : `New Movie: ${content.title}`;
      const releaseNotifMsg = contentType === "webseries"
        ? `${episodeInfo.seasonName} - Episode ${episodeInfo.episodeNumber} is now available!`
        : `${content.title} (${content.year}) is now available!`;

      const userNotifUpdates: Record<string, any> = {};
      const seenUserIds = new Set<string>();
      Object.entries(users).forEach(([userKey, userData]: any) => {
        const effectiveUserId = String(userData?.id || userKey || "").trim();
        if (!effectiveUserId || seenUserIds.has(effectiveUserId)) return;
        seenUserIds.add(effectiveUserId);

        const notifKey = push(ref(db, `notifications/${effectiveUserId}`)).key;
        if (!notifKey) return;

        userNotifUpdates[`notifications/${effectiveUserId}/${notifKey}`] = {
          title: releaseNotifTitle,
          message: releaseNotifMsg,
          type: "new_episode",
          contentId,
          contentType,
          image: content.poster || "",
          poster: content.poster || "",
          timestamp: Date.now(),
          read: false,
        };
      });

      if (Object.keys(userNotifUpdates).length > 0) {
        await update(ref(db), userNotifUpdates);
      }
      toast.success("In-app notification sent to users");
      setReleaseContent(""); setShowSeasonEpisode(false);
      
      // Send FCM push WITH progress (foreground)
      const pushPayload = {
        title: releaseNotifTitle,
        body: releaseNotifMsg,
        image: content.poster || undefined,
        url: contentId ? `/?anime=${contentId}` : "/",
        data: { url: contentId ? `/?anime=${contentId}` : "/", type: "new_episode", contentId },
      };

      setPushSending(true);
      setPushProgress({ phase: "tokens", totalTokens: 0, sent: 0, success: 0, failed: 0, invalidRemoved: 0 });

      try {
        const targetUserIds = Array.from(new Set(
          Object.entries(users)
            .map(([userKey, userData]: any) => String(userData?.id || userKey || "").trim())
            .filter(Boolean)
        ));
        const result = await sendPushToUsers(targetUserIds, pushPayload, (p) => setPushProgress({ ...p }));
        console.log("FCM new release result:", result);
        if ((result?.total || 0) === 0) {
          const reason = result?.reason ? ` [${result.reason}]` : "";
          toast.warning(`Push token পাওয়া যায়নি${reason} — শুধু in-app notification গেছে`);
        } else {
          toast.success(`Push: ${result?.success || 0} delivered, ${result?.failed || 0} failed`);
        }
      } catch (err) {
        console.warn("FCM push failed:", err);
        toast.error("Push delivery failed");
      } finally {
        setTimeout(() => { setPushSending(false); setPushProgress(null); }, 6000);
      }
    } catch (err: any) { toast.error("Error: " + err.message); }
  };

  const toggleReleaseStatus = (id: string, current: boolean) => {
    set(ref(db, `newEpisodeReleases/${id}/active`), !current)
      .then(() => toast.success(!current ? "Activated" : "Deactivated"))
      .catch(() => toast.error("Error updating"));
  };

  const deleteRelease = (id: string) => {
    if (confirm("Delete this release?")) {
      remove(ref(db, `newEpisodeReleases/${id}`))
        .then(() => toast.success("Deleted"))
        .catch(() => toast.error("Error deleting"));
    }
  };

  // ==================== QUICK FETCH ====================
  const quickFetch = async () => {
    if (!quickTmdbId.trim()) { toast.error("Please enter TMDB ID"); return; }
    if (fetchType === "tv") {
      await fetchSeriesDetails(parseInt(quickTmdbId));
      setActiveSection("webseries"); setSeriesTab("ws-add");
    } else {
      await fetchMovieDetails(parseInt(quickTmdbId));
      setActiveSection("movies"); setMoviesTab("mv-add");
    }
  };

  // ==================== EXPORT / REFRESH ====================
  const refreshData = () => {
    toast.info("Data is auto-synced with Firebase!");
    setDropdownOpen(false);
  };

  const exportData = async () => {
    try {
      const [ws, mv, cat, us, rel, not] = await Promise.all([
        get(ref(db, "webseries")), get(ref(db, "movies")), get(ref(db, "categories")),
        get(ref(db, "users")), get(ref(db, "newEpisodeReleases")), get(ref(db, "notifications"))
      ]);
      const data = {
        webseries: ws.val(), movies: mv.val(), categories: cat.val(),
        users: us.val(), newEpisodeReleases: rel.val(), notifications: not.val(),
        exportedAt: new Date().toISOString()
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${SITE_NAME.toLowerCase().replace(/\s+/g, '-')}-backup-${Date.now()}.json`; a.click();
      toast.success("Data exported!");
    } catch (err: any) { toast.error("Error: " + err.message); }
    setDropdownOpen(false);
  };

  // Computed stats (memoized to prevent recalculation on every render)
  const totalCategories = useMemo(() => Object.keys(categoriesData).length, [categoriesData]);
  const onlineUsers = useMemo(() => usersData.filter(u => u.online).length, [usersData]);
  const offlineUsers = useMemo(() => usersData.length - onlineUsers, [usersData.length, onlineUsers]);
  const recentContent = useMemo(() => [...webseriesData, ...moviesData].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 3), [webseriesData, moviesData]);
  const categoryList = useMemo(() => Object.entries(categoriesData).map(([id, cat]: any) => ({ id, name: cat.name })), [categoriesData]);
  const languageOptions = useMemo(() => ["English", "Hindi", "Tamil", "Telugu", "Korean", "Japanese", "Spanish", "Multi"], []);

  // Season/Episode helpers
  const addSeason = (name = "", episodeCount = 1) => {
    setSeasonsData(prev => [...prev, {
      name: name || `Season ${prev.length + 1}`, seasonNumber: prev.length + 1,
      episodes: Array(episodeCount).fill(null).map((_, i) => ({ episodeNumber: i + 1, title: `Episode ${i + 1}`, link: "" }))
    }]);
  };

  const removeSeason = (idx: number) => {
    if (confirm("Remove this season?")) setSeasonsData(prev => prev.filter((_, i) => i !== idx));
  };

  const addEpisode = async (sIdx: number) => {
    const season = seasonsData[sIdx];
    const num = season.episodes.length + 1;
    let epTitle = `Episode ${num}`;

    // Auto-fetch episode name from TMDB if tmdbId is available
    if (seriesForm?.tmdbId) {
      try {
        const seasonNum = season.seasonNumber || sIdx + 1;
        const res = await fetch(`${TMDB_BASE_URL}/tv/${seriesForm.tmdbId}/season/${seasonNum}?api_key=${TMDB_API_KEY}&language=en-US`);
        if (res.ok) {
          const tmdbSeason = await res.json();
          const tmdbEp = tmdbSeason.episodes?.find((e: any) => e.episode_number === num);
          if (tmdbEp?.name) epTitle = tmdbEp.name;
        }
      } catch {}
    }

    setSeasonsData(prev => {
      const copy = [...prev];
      const s = { ...copy[sIdx], episodes: [...copy[sIdx].episodes] };
      s.episodes.push({ episodeNumber: num, title: epTitle, link: "", link480: "", link720: "", link1080: "", link4k: "" });
      copy[sIdx] = s;
      return copy;
    });
  };

  const removeEpisode = (sIdx: number, eIdx: number) => {
    if (!confirm("Remove this episode?")) return;
    setSeasonsData(prev => {
      const copy = [...prev];
      const s = { ...copy[sIdx], episodes: copy[sIdx].episodes.filter((_, i) => i !== eIdx) };
      // Re-number episodes
      s.episodes = s.episodes.map((ep, i) => ({ ...ep, episodeNumber: i + 1 }));
      copy[sIdx] = s;
      return copy;
    });
  };

  // JSON import for Web Series seasons
  const wsParseJsonEpisodes = (jsonData: any) => {
    try {
      let episodes: any[] = [];
      let seasonName = '';

      if (Array.isArray(jsonData)) {
        episodes = jsonData;
      } else if (jsonData.episodes && Array.isArray(jsonData.episodes)) {
        episodes = jsonData.episodes;
        seasonName = jsonData.name || jsonData.season || '';
      } else if (jsonData.seasons && Array.isArray(jsonData.seasons)) {
        const newSeasons = jsonData.seasons.map((s: any, sIdx: number) => ({
          name: s.name || `Season ${seasonsData.length + sIdx + 1}`,
          seasonNumber: seasonsData.length + sIdx + 1,
          episodes: (s.episodes || []).map((ep: any, eIdx: number) => ({
            episodeNumber: ep.episodeNumber || ep.number || eIdx + 1,
            title: ep.title || `Episode ${ep.episodeNumber || ep.number || eIdx + 1}`,
            link: ep.link || '',
            link480: ep.link480 || '',
            link720: ep.link720 || '',
            link1080: ep.link1080 || '',
            link4k: ep.link4k || '',
          })),
        }));
        setSeasonsData(prev => {
          const updated = [...prev, ...newSeasons];
          // Auto-expand all new seasons
          const expandMap: Record<number, boolean> = {};
          for (let i = prev.length; i < updated.length; i++) expandMap[i] = true;
          setExpandedSeasons(p => ({ ...p, ...expandMap }));
          return updated;
        });
        toast.success(`${newSeasons.length}টি সিজন JSON থেকে ইমপোর্ট হয়েছে!`);
        setWsJsonImportMode(false);
        setWsJsonPasteText('');
        return;
      } else {
        toast.error('অবৈধ JSON ফরম্যাট। episodes বা seasons array থাকা দরকার।');
        return;
      }

      if (episodes.length === 0) {
        toast.error('কোনো এপিসোড পাওয়া যায়নি JSON-এ');
        return;
      }

      const mappedEpisodes = episodes.map((ep: any, eIdx: number) => ({
        episodeNumber: ep.episodeNumber || ep.number || eIdx + 1,
        title: ep.title || `Episode ${ep.episodeNumber || ep.number || eIdx + 1}`,
        link: ep.link || '',
        link480: ep.link480 || '',
        link720: ep.link720 || '',
        link1080: ep.link1080 || '',
        link4k: ep.link4k || '',
      }));

      const newSeason: Season = {
        name: seasonName || `Season ${seasonsData.length + 1}`,
        seasonNumber: seasonsData.length + 1,
        episodes: mappedEpisodes,
      };
      setSeasonsData(prev => {
        const newIdx = prev.length;
        setExpandedSeasons(p => ({ ...p, [newIdx]: true }));
        return [...prev, newSeason];
      });
      toast.success(`${mappedEpisodes.length}টি এপিসোড JSON থেকে ইমপোর্ট হয়েছে!`);
      setWsJsonImportMode(false);
      setWsJsonPasteText('');
    } catch (err: any) {
      toast.error('JSON parse failed: ' + err.message);
    }
  };

  const wsHandleJsonPaste = () => {
    if (!wsJsonPasteText.trim()) { toast.error('JSON টেক্সট পেস্ট করুন'); return; }
    try {
      const parsed = JSON.parse(wsJsonPasteText.trim());
      wsParseJsonEpisodes(parsed);
    } catch {
      toast.error('Invalid JSON. Please provide valid JSON format.');
    }
  };

  const wsHandleJsonFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    let processed = 0, failed = 0;
    const totalFiles = files.length;
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const parsed = JSON.parse(ev.target?.result as string);
          wsParseJsonEpisodes(parsed);
          processed++;
        } catch {
          failed++;
        }
        if (processed + failed === totalFiles) {
          if (failed > 0) toast.error(`${failed} files failed to parse`);
          if (processed > 0) toast.success(`${processed} files imported successfully`);
        }
      };
      reader.readAsText(file);
    });
    if (wsJsonFileRef.current) wsJsonFileRef.current.value = '';
  };

  // Per-season JSON import for Web Series
  const wsImportJsonToSeason = (sIdx: number, jsonData: any) => {
    try {
      let episodes: any[] = [];
      if (Array.isArray(jsonData)) {
        episodes = jsonData;
      } else if (jsonData.episodes && Array.isArray(jsonData.episodes)) {
        episodes = jsonData.episodes;
      } else {
        toast.error('অবৈধ JSON। episodes array থাকা দরকার।');
        return;
      }
      if (episodes.length === 0) { toast.error('কোনো এপিসোড পাওয়া যায়নি'); return; }
      const mapped = episodes.map((ep: any, eIdx: number) => ({
        episodeNumber: ep.episodeNumber || ep.number || eIdx + 1,
        title: ep.title || `Episode ${ep.episodeNumber || ep.number || eIdx + 1}`,
        link: ep.link || '',
        link480: ep.link480 || '',
        link720: ep.link720 || '',
        link1080: ep.link1080 || '',
        link4k: ep.link4k || '',
      }));
      setSeasonsData(prev => {
        const copy = [...prev];
        const existing = [...(copy[sIdx]?.episodes || [])];
        // Merge: update matching episodeNumbers, append new ones
        mapped.forEach((newEp: any) => {
          const idx = existing.findIndex((e: any) => e.episodeNumber === newEp.episodeNumber);
          if (idx >= 0) {
            existing[idx] = newEp;
          } else {
            existing.push(newEp);
          }
        });
        existing.sort((a: any, b: any) => a.episodeNumber - b.episodeNumber);
        copy[sIdx] = { ...copy[sIdx], episodes: existing };
        return copy;
      });
      setExpandedSeasons(p => ({ ...p, [sIdx]: true }));
      toast.success(`${mapped.length} episodes imported to "${seasonsData[sIdx]?.name}" season!`);
    } catch (err: any) {
      toast.error('JSON parse failed: ' + err.message);
    }
  };

  const wsHandleSeasonJsonFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || wsSeasonJsonTarget < 0) return;
    const targetIdx = wsSeasonJsonTarget;
    let processed = 0, failed = 0;
    const totalFiles = files.length;
    // Collect all episodes first, then do ONE state update
    const allEpisodes: any[] = [];
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const parsed = JSON.parse(ev.target?.result as string);
          let eps: any[] = [];
          if (Array.isArray(parsed)) eps = parsed;
          else if (parsed.episodes && Array.isArray(parsed.episodes)) eps = parsed.episodes;
          eps.forEach((ep: any, eIdx: number) => {
            allEpisodes.push({
              episodeNumber: ep.episodeNumber || ep.number || eIdx + 1,
              title: ep.title || `Episode ${ep.episodeNumber || ep.number || eIdx + 1}`,
              link: ep.link || '',
              link480: ep.link480 || '',
              link720: ep.link720 || '',
              link1080: ep.link1080 || '',
              link4k: ep.link4k || '',
            });
          });
          processed++;
        } catch { failed++; }
        // When ALL files are done, do a single state update
        if (processed + failed === totalFiles) {
          if (allEpisodes.length > 0) {
            setSeasonsData(prev => {
              const copy = [...prev];
              const existing = [...(copy[targetIdx]?.episodes || [])];
              allEpisodes.forEach((newEp: any) => {
                const idx = existing.findIndex((e: any) => e.episodeNumber === newEp.episodeNumber);
                if (idx >= 0) existing[idx] = newEp;
                else existing.push(newEp);
              });
              existing.sort((a: any, b: any) => a.episodeNumber - b.episodeNumber);
              copy[targetIdx] = { ...copy[targetIdx], episodes: existing };
              return copy;
            });
            setExpandedSeasons(p => ({ ...p, [targetIdx]: true }));
          }
          if (failed > 0) toast.error(`${failed} files failed to parse`);
          toast.success(`${allEpisodes.length} episodes imported (from ${processed} files)`);
        }
      };
      reader.readAsText(file);
    });
    if (wsSeasonJsonFileRef.current) wsSeasonJsonFileRef.current.value = '';
    setWsSeasonJsonTarget(-1);
  };

  const updateSeasonName = (sIdx: number, name: string) => {
    setSeasonsData(prev => {
      const copy = [...prev]; copy[sIdx] = { ...copy[sIdx], name }; return copy;
    });
  };

  const updateEpisodeLink = (sIdx: number, eIdx: number, link: string) => {
    setSeasonsData(prev => {
      const copy = [...prev];
      const s = { ...copy[sIdx], episodes: [...copy[sIdx].episodes] };
      s.episodes[eIdx] = { ...s.episodes[eIdx], link };
      copy[sIdx] = s;
      return copy;
    });
  };

  const updateEpisodeQualityLink = (sIdx: number, eIdx: number, quality: string, link: string) => {
    setSeasonsData(prev => {
      const copy = [...prev];
      const s = { ...copy[sIdx], episodes: [...copy[sIdx].episodes] };
      s.episodes[eIdx] = { ...s.episodes[eIdx], [quality]: link };
      copy[sIdx] = s;
      return copy;
    });
  };

  // ==================== AUTH HANDLERS ====================
  const handlePinLogin = () => {
    if (!loginPinInput) { toast.error("Enter PIN"); return; }
    if (loginPinInput === currentPin) {
      setIsAuthenticated(true);
      try {
        localStorage.setItem("rs_admin_session", JSON.stringify({ pin: currentPin, ts: Date.now() }));
      } catch {}
      toast.success("Login successful!");
      setLoginPinInput("");
    } else {
      toast.error("Wrong PIN");
      setLoginPinInput("");
    }
  };

  const handleCreatePin = () => {
    if (createPinInput.length < 4) { toast.error("PIN must be at least 4 digits"); return; }
    if (createPinInput !== createPinConfirm) { toast.error("PINs don't match"); return; }
    set(ref(db, "admin/pin"), { enabled: true, code: createPinInput })
      .then(() => { 
        toast.success("PIN created! Please login now."); 
        setCreatePinInput(""); 
        setCreatePinConfirm(""); 
      });
  };

  const handleSetPin = () => {
    if (newPinInput.length < 4) { toast.error("PIN must be at least 4 digits"); return; }
    set(ref(db, "admin/pin"), { enabled: true, code: newPinInput })
      .then(() => { toast.success("PIN set!"); setNewPinInput(""); setShowPinSetup(false); });
  };

  const handleDisablePin = () => {
    if (confirm("Disable PIN security?")) {
      set(ref(db, "admin/pin"), { enabled: false, code: "" })
        .then(() => { toast.success("PIN disabled"); });
    }
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    localStorage.removeItem("rs_admin_session");
    localStorage.removeItem("rs_admin_google");
    toast.success("Logged out");
  };

  // Google Sign-In for Admin
  const handleGoogleAdminLogin = async () => {
    setGoogleAuthLoading(true);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const email = result.user.email;
      if (!email) { toast.error("Could not get email from Google account"); return; }
      // Check if this Google email is authorized as admin
      const adminSnap = await get(ref(db, "admin/authorizedEmails"));
      const authorizedEmails = adminSnap.val() || {};
      const isAuthorized = Object.values(authorizedEmails).some((e: any) => e === email);
      if (!isAuthorized) {
        toast.error("❌ This Google account is not authorized as admin");
        return;
      }
      setIsAuthenticated(true);
      setAdminGoogleEmail(email);
      try {
        localStorage.setItem("rs_admin_session", JSON.stringify({ google: email, ts: Date.now() }));
        localStorage.setItem("rs_admin_google", email);
      } catch {}
      toast.success(`✅ Google Login successful! (${email})`);
    } catch (err: any) {
      toast.error(err.message || "Google Login failed");
    } finally {
      setGoogleAuthLoading(false);
    }
  };

  // Send Telegram Post
  const sendTelegramPost = async () => {
    if (!tgTitle.trim()) { toast.error("Enter a title"); return; }
    if (!tgChannelId.trim()) { toast.error("Enter channel ID(s)"); return; }
    setTgSending(true);
    try {
      const caption = `Tɪᴛʟᴇ'- <b>${tgTitle}</b>
╭━━━━━━━━━━━━━━━━━━➣
┣✧ Sᴇᴀsᴏɴ : ${tgSeason || 'N/A'}
┣✧ Eᴘɪsᴏᴅᴇs: ${tgTotalEpisodes || 'N/A'}
┣✧ Qᴜᴀʟɪᴛʏ : ${tgQuality} ˚.⋆
┣✧ Aᴜᴅɪᴏ : Hɪɴᴅɪ Dᴜʙ ! ${tgDubType === "fandub" ? "#ғᴀɴᴅᴜʙ" : "#ᴏғғɪᴄɪᴀʟ"}
┣✧ Eᴘɪsᴏᴅᴇ Aᴅᴅᴇᴅ : ${tgNewEpAdded || 'N/A'}
╰━━━━━━━━━━━━━━━━━━➣
Pᴏᴡᴇʀ Bʏ : 
𓆩 ${TELEGRAM_CHANNEL} 𓆪`;

      // Support multiple channel IDs separated by comma, newline, or space
      const channelIds = tgChannelId
        .split(/[,\n]+/)
        .map(id => id.trim())
        .filter(id => id.length > 0);

      if (channelIds.length === 0) { toast.error("Enter at least one channel ID"); setTgSending(false); return; }

      const results: { id: string; ok: boolean; error?: string }[] = [];

      for (const chatId of channelIds) {
        const payload = {
          chatId,
          caption,
          photoUrl: tgPosterUrl || undefined,
          buttonText: tgButtonLink ? "📥 𝐖𝐀𝐓𝐂𝐇 𝐀𝐍𝐃 𝐃𝐎𝐖𝐍𝐋𝐎𝐀𝐃 📥" : undefined,
          buttonUrl: tgButtonLink || undefined,
        };
        try {
          const response = await fetch(
            `${SUPABASE_URL}/functions/v1/send-telegram-post`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
              },
              body: JSON.stringify(payload),
            }
          );
          const data = await response.json();
          if (!response.ok || data?.error) {
            results.push({ id: chatId, ok: false, error: data?.error || 'API error' });
          } else {
            results.push({ id: chatId, ok: true });
          }
        } catch (err: any) {
          results.push({ id: chatId, ok: false, error: err.message });
        }
      }

      const successCount = results.filter(r => r.ok).length;
      const failedResults = results.filter(r => !r.ok);
      if (failedResults.length === 0) {
        toast.success(`✅ ${successCount} চ্যানেলে পোস্ট পাঠানো হয়েছে!`);
      } else if (successCount > 0) {
        toast.success(`✅ ${successCount}/${channelIds.length} চ্যানেলে পাঠানো হয়েছে`);
        failedResults.forEach(r => toast.error(`❌ ${r.id}: ${r.error}`));
      } else {
        toast.error("সব চ্যানেলে পোস্ট ব্যর্থ হয়েছে");
        failedResults.forEach(r => toast.error(`❌ ${r.id}: ${r.error}`));
      }
    } catch (err: any) {
      toast.error("Telegram post failed: " + (err.message || "Unknown error"));
    } finally {
      setTgSending(false);
    }
  };

  // Fill telegram fields from release
  const fillTelegramFromRelease = async (releaseId: string) => {
    const release = releasesData.find(r => r.id === releaseId);
    if (!release) return;
    setTgSelectedRelease(releaseId);
    setTgTitle(release.title || "");
    // Use backdrop (landscape 16:9) instead of poster for Telegram
    const posterUrl = release.poster || "";
    // Try to get backdrop from content data for 16:9 image
    const [cId, cType] = [release.contentId, release.contentType || "webseries"];
    let backdropUrl = "";
    if (cType === "webseries") {
      const ws = webseriesData.find(s => s.id === cId);
      if (ws?.backdrop) backdropUrl = ws.backdrop;
    } else if (cType === "movie") {
      const mv = moviesData.find(m => m.id === cId);
      if (mv?.backdrop) backdropUrl = mv.backdrop;
    }
    // Use backdrop if available (16:9), else fallback to poster with w500
    if (backdropUrl) {
      setTgPosterUrl(backdropUrl.replace('/original/', '/w1280/').replace('/w780/', '/w1280/'));
    } else {
      setTgPosterUrl(posterUrl.replace('/original/', '/w500/').replace('/w780/', '/w500/'));
    }
    if (release.episodeInfo) {
      if (release.episodeInfo.type === "movie") {
        setTgSeason("Movie");
        setTgNewEpAdded("Full Movie");
      } else {
        // Extract just the season number (e.g., "01", "02")
        const seasonNum = release.episodeInfo.seasonNumber || '';
        setTgSeason(String(seasonNum).padStart(2, '0'));
        setTgNewEpAdded(String(release.episodeInfo.episodeNumber || '').padStart(2, '0'));
      }
    }
    // Get quality info from content
    const [contentId, contentType] = (release.contentId + "|" + release.contentType).split("|").length >= 2 
      ? [release.contentId, release.contentType] : [release.contentId, "webseries"];
    let qualities: string[] = [];
    if (contentType === "webseries") {
      const ws = webseriesData.find(s => s.id === contentId);
      if (ws?.seasons) {
        ws.seasons.forEach((s: any) => {
          s.episodes?.forEach((ep: any) => {
            if (ep.link480) qualities.push("480p");
            if (ep.link720) qualities.push("720p");
            if (ep.link1080) qualities.push("1080p");
            if (ep.link4k) qualities.push("4K");
          });
        });
      }
    } else if (contentType === "movie") {
      const mv = moviesData.find(m => m.id === contentId);
      if (mv?.link480) qualities.push("480p");
      if (mv?.link720) qualities.push("720p");
      if (mv?.link1080) qualities.push("1080p");
      if (mv?.link4k) qualities.push("4K");
    }
    if (qualities.length > 0) {
      setTgQuality([...new Set(qualities)].join(","));
    }
    // Count total episodes per-season using TMDB
    if (contentType === "webseries") {
      const ws = webseriesData.find(s => s.id === contentId);
      const seasonNum = release.episodeInfo?.seasonNumber || 1;
      const tmdbId = ws?.tmdbId;
      if (tmdbId) {
        try {
          const tmdbRes = await fetch(`${TMDB_BASE_URL}/tv/${tmdbId}/season/${seasonNum}?api_key=${TMDB_API_KEY}&language=en-US`);
          const tmdbData = await tmdbRes.json();
          if (tmdbData?.episodes?.length) {
            setTgTotalEpisodes(String(tmdbData.episodes.length));
          } else {
            // Fallback to counting linked episodes in that specific season
            const seasonIdx = (release.episodeInfo?.seasonNumber || 1) - 1;
            const seasonEps = ws?.seasons?.[seasonIdx]?.episodes?.length || 0;
            setTgTotalEpisodes(String(seasonEps));
          }
        } catch {
          const seasonIdx = (release.episodeInfo?.seasonNumber || 1) - 1;
          const seasonEps = ws?.seasons?.[seasonIdx]?.episodes?.length || 0;
          setTgTotalEpisodes(String(seasonEps));
        }
      } else if (ws?.seasons) {
        const seasonIdx = (release.episodeInfo?.seasonNumber || 1) - 1;
        const seasonEps = ws?.seasons?.[seasonIdx]?.episodes?.length || 0;
        setTgTotalEpisodes(String(seasonEps));
      }
    } else {
      setTgTotalEpisodes("Movie");
    }
    // Set button link with deep link to the specific anime
    const animeId = release.contentId || release.id;
    setTgButtonLink(`${SITE_URL}?anime=${encodeURIComponent(animeId)}`);
    // Auto-set dub type from content
    if (cType === "webseries") {
      const ws = webseriesData.find(s => s.id === cId);
      setTgDubType(ws?.dubType === "fandub" ? "fandub" : "official");
    } else if (cType === "movie") {
      const mv = moviesData.find(m => m.id === cId);
      setTgDubType(mv?.dubType === "fandub" ? "fandub" : "official");
    } else if (cType === "animesalt") {
      setTgDubType("official"); // AnimeSalt always official
    }
  };

  // ==================== RENDER HELPERS ====================
  const inputClass = "w-full px-3.5 py-2.5 bg-[#141422] border border-white/8 rounded-lg text-white text-sm focus:border-indigo-500 focus:outline-none transition-colors placeholder:text-zinc-500";
  const selectClass = inputClass + " cursor-pointer";
  const btnPrimary = "bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-lg transition-colors cursor-pointer border-none";
  const btnSecondary = "bg-[#1E1E32] border border-white/8 text-white rounded-lg hover:bg-[#252540] transition-colors cursor-pointer";
  const glassCard = "bg-[#16162A] border border-white/6 rounded-xl";

  const menuItems: { section: Section; icon: React.ReactNode; label: string; group?: string }[] = [
    { section: "dashboard", icon: <LayoutDashboard size={16} />, label: "Dashboard", group: "Main Menu" },
    { section: "categories", icon: <FolderOpen size={16} />, label: "Categories" },
    { section: "webseries", icon: <Film size={16} />, label: "Web Series" },
    { section: "movies", icon: <Video size={16} />, label: "Movies" },
    { section: "users", icon: <Users size={16} />, label: "Users" },
    { section: "comments", icon: <MessageCircle size={16} />, label: "Comments", group: "New Features" },
    { section: "live-support", icon: <MessageCircle size={16} />, label: "Live Support" },
    { section: "notifications", icon: <Bell size={16} />, label: "Notifications" },
    { section: "new-releases", icon: <Zap size={16} />, label: "New Releases" },
    { section: "add-content", icon: <PlusCircle size={16} />, label: "Add Content", group: "Quick Actions" },
    { section: "auto-import", icon: <Zap size={16} />, label: "Auto Import" },
    { section: "animesalt-manager", icon: <CloudDownload size={16} />, label: "AnimeSalt" },
    { section: "tmdb-fetch", icon: <CloudDownload size={16} />, label: "TMDB Fetch" },
    { section: "redeem-codes", icon: <Shield size={16} />, label: "Redeem Codes" },
    { section: "bkash-payments", icon: <KeyRound size={16} />, label: "bKash Payments" },
    { section: "device-limits", icon: <Lock size={16} />, label: "Device Limits" },
    { section: "telegram-post", icon: <Send size={16} />, label: "Telegram Post", group: "Sharing" },
    { section: "free-access", icon: <Eye size={16} />, label: "Free Access", group: "Tracking" },
    { section: "analytics", icon: <BarChart3 size={16} />, label: "Analytics & Views" },
    { section: "maintenance", icon: <Power size={16} />, label: "Maintenance", group: "Server" },
    { section: "edge-router", icon: <Activity size={16} />, label: "Edge Router" },
    { section: "ui-themes", icon: <Zap size={16} />, label: "UI Themes", group: "Customization" },
    { section: "hero-pinned", icon: <Star size={16} />, label: "Hero Pinned" },
    { section: "settings", icon: <Settings size={16} />, label: "Settings" },
  ];

  // ==================== LOADING STATE ====================
  if (pinExists === null) {
    return (
      <div className="min-h-screen bg-[#0D0D1A] flex items-center justify-center">
        <div className="w-10 h-10 border-3 border-[#1E1E32] border-t-indigo-500 rounded-full animate-spin" />
      </div>
    );
  }

  // ==================== CREATE PIN SCREEN (first time) ====================
  if (!pinExists && !isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#0D0D1A] flex items-center justify-center p-4">
        <div className={`${glassCard} p-8 w-full max-w-[400px]`}>
          <div className="text-center mb-8">
            <div className="w-14 h-14 bg-indigo-600 rounded-2xl flex items-center justify-center text-2xl font-black mx-auto mb-4">RS</div>
            <h1 className="text-xl font-bold text-white">Create Admin PIN</h1>
            <p className="text-sm text-zinc-400 mt-1">Set up your admin PIN</p>
          </div>
          <div className="space-y-4">
            <input value={createPinInput} onChange={e => setCreatePinInput(e.target.value.replace(/\D/g, ""))}
              className={`${inputClass} text-center text-2xl tracking-[10px] font-bold`}
              placeholder="PIN" type="password" maxLength={8} />
            <input value={createPinConfirm} onChange={e => setCreatePinConfirm(e.target.value.replace(/\D/g, ""))}
              className={`${inputClass} text-center text-2xl tracking-[10px] font-bold`}
              placeholder="Confirm PIN" type="password" maxLength={8}
              onKeyDown={e => e.key === "Enter" && handleCreatePin()} />
            <button onClick={handleCreatePin}
              className={`${btnPrimary} w-full py-3 flex items-center justify-center gap-2`}>
              <KeyRound size={16} />
              Create PIN
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ==================== LOGIN SCREEN (PIN + Email/Pass + Google) ====================
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#0D0D1A] flex items-center justify-center p-4">
        <div className={`${glassCard} p-8 w-full max-w-[400px]`}>
          <div className="text-center mb-8">
            <div className="w-14 h-14 bg-indigo-600 rounded-2xl flex items-center justify-center text-2xl font-black mx-auto mb-4">RS</div>
            <h1 className="text-xl font-bold text-white">Admin Login</h1>
            <p className="text-sm text-zinc-400 mt-1">RS ANIME Control Panel</p>
          </div>
          <div className="space-y-4">
            <input value={loginPinInput} onChange={e => setLoginPinInput(e.target.value.replace(/\D/g, ""))}
              className={`${inputClass} text-center text-2xl tracking-[10px] font-bold`}
              placeholder="Enter PIN" type="password" maxLength={8}
              onKeyDown={e => e.key === "Enter" && handlePinLogin()} />
            <button onClick={handlePinLogin}
              className={`${btnPrimary} w-full py-3 flex items-center justify-center gap-2`}>
              <Lock size={16} />
              Login with PIN
            </button>

            <div className="relative flex items-center my-2">
              <div className="flex-1 h-px bg-white/10" />
              <span className="px-3 text-[11px] text-zinc-500">or</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>

            <button onClick={handleGoogleAdminLogin} disabled={googleAuthLoading}
              className="w-full py-3 flex items-center justify-center gap-2.5 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-colors text-sm font-medium text-white disabled:opacity-50">
              {googleAuthLoading ? (
                <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
              )}
              Login with Google
            </button>

            <p className="text-[10px] text-zinc-600 text-center mt-2">
              🔒 Login with PIN or authorized Google account.
              <br />If Google login doesn't work, add your email in Settings → Authorized Emails.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0D0D1A] text-white font-['Poppins',sans-serif]">
      {/* Fetching Overlay */}
      {fetchingOverlay && (
        <div className="fixed inset-0 bg-black/90 z-[5000] flex flex-col items-center justify-center">
          <div className="w-10 h-10 border-3 border-[#1E1E32] border-t-indigo-500 rounded-full animate-spin" />
          <p className="mt-4 text-sm text-zinc-400">Fetching data from TMDB...</p>
        </div>
      )}

      {/* Push Progress Overlay */}
      {pushSending && pushProgress && (
        <div className="fixed bottom-4 right-4 left-4 sm:left-auto sm:w-[380px] z-[6000]">
          <div className="bg-[#16162A] border border-white/10 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-white flex items-center gap-2">
                <Send size={14} className="text-indigo-400" />
                Push Notification Delivery
              </span>
              {pushProgress.phase === "done" ? (
                <span className={`text-xs px-2 py-0.5 rounded-full ${pushProgress.totalTokens > 0 ? "bg-green-500/20 text-green-400" : "bg-yellow-500/20 text-yellow-300"}`}>
                  {pushProgress.totalTokens > 0 ? "Complete" : "No tokens"}
                </span>
              ) : (
                <span className="text-xs bg-indigo-500/20 text-indigo-400 px-2 py-0.5 rounded-full">
                  {pushProgress.phase === "tokens" ? "Fetching tokens..." : pushProgress.phase === "cleanup" ? "Cleanup..." : "Sending..."}
                </span>
              )}
            </div>
            
            {/* Progress bar */}
            <div className="w-full h-2 bg-[#0D0D1A] rounded-full overflow-hidden mb-2">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  pushProgress.phase === "done" ? "bg-green-500" : "bg-indigo-500"
                }`}
                style={{ width: `${pushProgress.phase === "done" ? 100 : pushProgress.phase === "sending" && pushProgress.totalTokens > 0 ? Math.min(100, (pushProgress.sent / pushProgress.totalTokens) * 100) : pushProgress.phase === "tokens" ? 0 : 50}%` }}
              />
            </div>

            {/* Stats */}
            <div className="flex items-center justify-between text-xs text-zinc-500 gap-2 flex-wrap">
              {typeof pushProgress.totalUsers === "number" && pushProgress.totalUsers > 0 && <span>👥 {pushProgress.totalUsers} users</span>}
              <span>📡 {pushProgress.phase === "done" ? pushProgress.totalTokens : (pushProgress.totalTokens || fcmTokenStats.totalTokens)} tokens</span>
              {pushProgress.phase === "done" && (
                <>
                  <span className="text-green-400">✓ {pushProgress.success} sent</span>
                  {pushProgress.failed > 0 && <span className="text-red-400">✗ {pushProgress.failed} failed</span>}
                  {pushProgress.invalidRemoved > 0 && <span className="text-yellow-400">🗑 {pushProgress.invalidRemoved} removed</span>}
                </>
              )}
              {pushProgress.phase === "sending" && (
                <span className="text-indigo-400">Processing on server...</span>
              )}
              {pushProgress.phase === "tokens" && (
                <span className="text-indigo-400">Loading tokens...</span>
              )}
            </div>

            {pushProgress.phase === "done" && pushProgress.failReasons && pushProgress.failed > 0 && (
              <div className="mt-2 flex items-center gap-3 text-[11px] flex-wrap">
                {pushProgress.failReasons.invalid > 0 && <span className="text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full">Invalid: {pushProgress.failReasons.invalid}</span>}
                {pushProgress.failReasons.transient > 0 && <span className="text-yellow-400 bg-yellow-500/10 px-2 py-0.5 rounded-full">Transient: {pushProgress.failReasons.transient}</span>}
                {pushProgress.failReasons.other > 0 && <span className="text-orange-400 bg-orange-500/10 px-2 py-0.5 rounded-full">Other: {pushProgress.failReasons.other}</span>}
              </div>
            )}
            {pushProgress.phase === "done" && (
              <div className={`mt-2 text-xs text-center ${pushProgress.totalTokens > 0 ? "text-green-400/80" : "text-yellow-300"}`}>
                {pushProgress.totalTokens > 0
                  ? `Delivery: ${pushProgress.success} sent${pushProgress.failed > 0 ? `, ${pushProgress.failed} failed` : ""}${pushProgress.invalidRemoved > 0 ? `, ${pushProgress.invalidRemoved} invalid removed` : ""}`
                  : "No active push tokens found"}
              </div>
            )}
          </div>
        </div>
      )}

      {showPinSetup && (
        <div className="fixed inset-0 bg-black/80 z-[5000] flex items-center justify-center p-4" onClick={() => setShowPinSetup(false)}>
          <div className={`${glassCard} p-6 w-full max-w-[350px]`} onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
              <KeyRound size={18} className="text-indigo-500" /> {pinExists ? "Change PIN" : "Set PIN"}
            </h3>
            <input value={newPinInput} onChange={e => setNewPinInput(e.target.value.replace(/\D/g, ""))}
              className={`${inputClass} text-center text-xl tracking-[8px] font-bold mb-4`}
              placeholder="Enter PIN" type="password" maxLength={8} onKeyDown={e => e.key === "Enter" && handleSetPin()} />
            <div className="flex gap-2">
              <button onClick={() => setShowPinSetup(false)} className={`${btnSecondary} flex-1 py-2.5 text-sm`}>Cancel</button>
              <button onClick={handleSetPin} className={`${btnPrimary} flex-1 py-2.5 text-sm`}>Save PIN</button>
            </div>
          </div>
        </div>
      )}

      {/* Overlay */}
      {sidebarOpen && <div className="fixed inset-0 bg-black/60 z-[999]" onClick={() => setSidebarOpen(false)} />}

      {/* Sidebar */}
      <div className={`fixed top-0 ${sidebarOpen ? "left-0" : "-left-[260px]"} w-[260px] h-screen bg-[#111120] z-[1000] transition-all duration-200 border-r border-white/6 flex flex-col`}>
        <div className="p-4 border-b border-white/6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-lg font-black">RS</div>
            <div>
              <h2 className="text-base font-bold text-white">Admin Panel</h2>
              <p className="text-[10px] text-zinc-500">RS ANIME</p>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-3">
          {menuItems.map((item, i) => (
            <div key={item.section}>
              {item.group && <p className="px-4 py-2 text-[10px] text-zinc-600 uppercase tracking-[2px] font-semibold">{item.group}</p>}
              <div
                onClick={() => showSection(item.section)}
                className={`px-4 py-2.5 flex items-center gap-3 cursor-pointer border-l-[3px] transition-colors mx-0 my-0.5 ${
                  activeSection === item.section ? "bg-indigo-500/10 border-l-indigo-500 text-indigo-400" : "border-l-transparent hover:bg-white/3 text-zinc-400"
                }`}
              >
                <span>{item.icon}</span>
                <span className="text-[13px]">{item.label}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="p-3 border-t border-white/6">
          <div className="flex items-center gap-2 p-2.5 bg-black/20 rounded-lg">
            <div className={`w-2 h-2 rounded-full ${firebaseConnected ? "bg-green-500" : "bg-red-500"}`} />
            <span className={`text-[11px] ${firebaseConnected ? "text-green-400" : "text-zinc-500"}`}>
              Firebase: {firebaseConnected ? "Connected" : "Disconnected"}
            </span>
          </div>
        </div>
      </div>

      {/* Header */}
      <header className="fixed top-0 left-0 right-0 h-[56px] bg-[#0D0D1A]/95 z-[100] flex items-center justify-between px-3 border-b border-white/6">
        <div className="flex items-center gap-2.5">
          <button onClick={() => setSidebarOpen(true)} className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center hover:bg-indigo-500/20 transition-colors">
            <Menu size={18} />
          </button>
          <span className="text-xl font-black text-indigo-500">RS</span>
          <h1 className="text-sm font-semibold text-zinc-200">{sectionTitles[activeSection]}</h1>
        </div>
        <div className="flex items-center gap-2 relative">
          <div className="bg-indigo-600/20 border border-indigo-500/30 px-2.5 py-1 rounded-full text-[11px] font-semibold flex items-center gap-1.5 text-indigo-300">
            <Shield size={11} />
            Admin
          </div>
          <button onClick={() => setDropdownOpen(!dropdownOpen)} className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors">
            <MoreVertical size={16} />
          </button>
          {dropdownOpen && (
            <div className="absolute right-0 top-[48px] w-[200px] bg-[#16162A] border border-white/8 rounded-lg overflow-hidden z-[200]">
              <div onClick={refreshData} className="px-3.5 py-3 flex items-center gap-2.5 text-[13px] hover:bg-white/5 cursor-pointer transition-colors">
                <RefreshCw size={14} className="text-indigo-400" /> Refresh Data
              </div>
              <div onClick={() => { showSection("add-content"); setDropdownOpen(false); }} className="px-3.5 py-3 flex items-center gap-2.5 text-[13px] hover:bg-white/5 cursor-pointer transition-colors">
                <Plus size={14} className="text-indigo-400" /> Add Content
              </div>
              <div onClick={exportData} className="px-3.5 py-3 flex items-center gap-2.5 text-[13px] hover:bg-white/5 cursor-pointer transition-colors">
                <Download size={14} className="text-indigo-400" /> Export Data
              </div>
              <div onClick={() => { setShowPinSetup(true); setDropdownOpen(false); }} className="px-3.5 py-3 flex items-center gap-2.5 text-[13px] hover:bg-white/5 cursor-pointer transition-colors">
                <KeyRound size={14} className="text-indigo-400" /> {pinExists ? "Change PIN" : "Set PIN"}
              </div>
              {pinExists && (
                <div onClick={() => { handleDisablePin(); setDropdownOpen(false); }} className="px-3.5 py-3 flex items-center gap-2.5 text-[13px] hover:bg-white/5 cursor-pointer transition-colors text-yellow-400">
                  <Lock size={14} /> Disable PIN
                </div>
              )}
              <div onClick={() => { if (confirm("Clear cache?")) { localStorage.clear(); toast.success("Cache cleared!"); setTimeout(() => window.location.reload(), 1500); } setDropdownOpen(false); }}
                className="px-3.5 py-3 flex items-center gap-2.5 text-[13px] hover:bg-white/5 cursor-pointer transition-colors text-red-400">
                <Trash2 size={14} /> Clear Cache
              </div>
              <div onClick={() => { handleLogout(); setDropdownOpen(false); }}
                className="px-3.5 py-3 flex items-center gap-2.5 text-[13px] hover:bg-white/5 cursor-pointer transition-colors text-red-400 border-t border-white/6">
                <LogOut size={14} /> Logout
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="pt-[64px] px-3 pb-[80px] min-h-screen">
        {/* ==================== DASHBOARD ==================== */}
        {activeSection === "dashboard" && (
          <div>
            <div className="grid grid-cols-2 gap-2.5 mb-4">
              {[
                { icon: <Film size={18} />, value: webseriesData.length, label: "Web Series", color: "text-indigo-400" },
                { icon: <Video size={18} />, value: moviesData.length, label: "Movies", color: "text-emerald-400" },
                { icon: <FolderOpen size={18} />, value: totalCategories, label: "Categories", color: "text-amber-400" },
                { icon: <Users size={18} />, value: usersData.length, label: "Total Users", color: "text-sky-400" },
              ].map((stat, i) => (
                <div key={i} className="bg-[#141422] border border-white/5 rounded-xl p-4">
                  <div className={`w-9 h-9 bg-white/5 rounded-lg flex items-center justify-center mb-2.5 ${stat.color}`}>{stat.icon}</div>
                  <div className="text-2xl font-bold text-white">{stat.value}</div>
                  <div className="text-[11px] text-zinc-500 mt-0.5">{stat.label}</div>
                </div>
              ))}
            </div>

            <div className={`${glassCard} p-4 mb-3`}>
              <h3 className="text-sm font-semibold mb-2.5">User Activity</h3>
              <div className="flex gap-4 items-center">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-green-500" />
                  <span className="text-[13px] text-zinc-300">Online: <strong>{onlineUsers}</strong></span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-red-500" />
                  <span className="text-[13px] text-zinc-300">Offline: <strong>{offlineUsers}</strong></span>
                </div>
              </div>
            </div>

            <div className={`${glassCard} p-4 mb-3`}>
              <h3 className="text-sm font-semibold mb-3">Recent Content</h3>
              {recentContent.length === 0 ? (
                <p className="text-zinc-500 text-[13px] text-center py-4">No recent content</p>
              ) : (
                recentContent.map((item, i) => (
                  <div key={i} className="flex items-center gap-3 p-2.5 bg-black/20 rounded-lg mb-2">
                    <img src={item.poster || ""} className="w-10 h-[55px] rounded-md object-cover" onError={(e) => { (e.target as HTMLImageElement).src = "https://via.placeholder.com/40x55/141422/6366f1?text=N"; }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium truncate">{item.title || "Untitled"}</p>
                      <p className="text-[11px] text-zinc-500">{item.type || (item.seasons ? "Series" : "Movie")} • {item.year || "N/A"}</p>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="grid grid-cols-2 gap-2.5 mt-4">
              <button onClick={() => { showSection("webseries"); setSeriesTab("ws-add"); }} className={`${btnPrimary} py-4 px-4 flex flex-col items-center gap-2 text-[13px]`}>
                <Plus size={22} /> Add Series
              </button>
              <button onClick={() => { showSection("movies"); setMoviesTab("mv-add"); }} className={`${btnSecondary} py-4 px-4 flex flex-col items-center gap-2 text-[13px]`}>
                <Plus size={22} /> Add Movie
              </button>
            </div>
          </div>
        )}

        {/* ==================== CATEGORIES ==================== */}
        {activeSection === "categories" && (
          <div>
            <div className={`${glassCard} p-4 mb-4`}>
              <h3 className="text-sm font-semibold mb-3.5">Add New Category</h3>
              <div className="flex gap-2.5">
                <input value={categoryInput} onChange={e => setCategoryInput(e.target.value)} onKeyDown={e => e.key === "Enter" && saveCategory()}
                  className={`${inputClass} flex-1`} placeholder="Category name" />
                <button onClick={saveCategory} className={`${btnPrimary} px-5 py-3.5`}><Plus size={18} /></button>
              </div>
            </div>
            <div className={`${glassCard} p-4`}>
              <h3 className="text-sm font-semibold mb-3.5">All Categories</h3>
              {categoryList.length === 0 ? (
                <p className="text-[#957DAD] text-[13px] text-center py-5">No categories yet</p>
              ) : categoryList.map(cat => (
                <div key={cat.id} className="bg-[#1A1A2E] border border-white/5 rounded-[14px] p-3.5 flex justify-between items-center mb-2">
                  <span className="text-sm font-medium">{cat.name}</span>
                  <div className="flex gap-2">
                    <button onClick={() => editCategory(cat.id, cat.name)} className="bg-blue-500/20 text-blue-400 p-2 rounded-lg"><Edit size={14} /></button>
                    <button onClick={() => deleteCategory(cat.id)} className="bg-pink-500/20 text-pink-500 p-2 rounded-lg"><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
            </div>

            {/* Bulk Category Assignment */}
            <div className={`${glassCard} p-4 mt-4`}>
              <h3 className="text-sm font-semibold mb-3.5 flex items-center gap-2">
                <List size={14} className="text-indigo-400" /> সব এনিমে ক্যাটাগরি অ্যাসাইন
              </h3>
              <p className="text-[11px] text-zinc-400 mb-3">একাধিক এনিমে সিলেক্ট করে একসাথে ক্যাটাগরি সেট করুন।</p>
              <div className="flex gap-2 mb-3">
                <div className="relative flex-1">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                  <input value={catBulkSearch} onChange={e => setCatBulkSearch(e.target.value)}
                    className={`${inputClass} pl-9`} placeholder="এনিমে সার্চ..." />
                </div>
                <select value={catBulkCategory} onChange={e => setCatBulkCategory(e.target.value)} className={`${selectClass} w-[140px]`}>
                  <option value="">ক্যাটাগরি</option>
                  {categoryList.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
              </div>
              {catBulkSelected.length > 0 && catBulkCategory && (
                <button onClick={() => {
                  const updates: Record<string, any> = {};
                  catBulkSelected.forEach(id => {
                    const isWs = webseriesData.find(w => w.id === id);
                    const path = isWs ? `webseries/${id}/category` : `movies/${id}/category`;
                    updates[path] = catBulkCategory;
                  });
                  update(ref(db), updates)
                    .then(() => { toast.success(`${catBulkSelected.length}টি এনিমে "${catBulkCategory}" ক্যাটাগরিতে সেট হয়েছে!`); setCatBulkSelected([]); })
                    .catch(err => toast.error("Error: " + err.message));
                }} className={`${btnPrimary} w-full py-2.5 text-[12px] mb-3 flex items-center justify-center gap-2`}>
                  <Save size={14} /> {catBulkSelected.length}টি সিলেক্টেড → "{catBulkCategory}" সেট করুন
                </button>
              )}
              {catBulkSelected.length > 0 && (
                <button onClick={() => setCatBulkSelected([])} className="text-[11px] text-zinc-500 hover:text-zinc-300 mb-2 underline">সব সিলেকশন বাতিল</button>
              )}
              <div className="max-h-[400px] overflow-y-auto space-y-1.5">
                {(() => {
                  const allItems = [...webseriesData.map(w => ({ ...w, _type: "series" })), ...moviesData.map(m => ({ ...m, _type: "movie" }))];
                  const filtered = catBulkSearch.trim()
                    ? allItems.filter(item => item.title?.toLowerCase().includes(catBulkSearch.toLowerCase()))
                    : allItems;
                  return filtered.length === 0 ? (
                    <p className="text-zinc-500 text-[12px] text-center py-4">কোনো এনিমে নেই</p>
                  ) : filtered.map(item => {
                    const isSelected = catBulkSelected.includes(item.id);
                    return (
                      <div key={item.id} onClick={() => setCatBulkSelected(prev => isSelected ? prev.filter(id => id !== item.id) : [...prev, item.id])}
                        className={`flex items-center gap-2.5 p-2 rounded-lg cursor-pointer transition-all ${isSelected ? "bg-indigo-600/20 border border-indigo-500/40" : "bg-[#141422] border border-transparent hover:border-white/10"}`}>
                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${isSelected ? "bg-indigo-600 border-indigo-500" : "border-zinc-600"}`}>
                          {isSelected && <Check size={12} />}
                        </div>
                        <img src={item.poster || ""} className="w-8 h-11 rounded object-cover flex-shrink-0 bg-[#1E1E32]"
                          onError={e => { (e.target as HTMLImageElement).src = "https://via.placeholder.com/32x44/141422/6366f1?text=N"; }} />
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] font-medium truncate">{item.title || "Untitled"}</p>
                          <p className="text-[10px] text-zinc-500">{item._type === "series" ? "Series" : "Movie"} • {item.category || "No Category"}</p>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          </div>
        )}

        {/* ==================== WEB SERIES ==================== */}
        {activeSection === "webseries" && (
          <div>
            <div className="flex gap-2 overflow-x-auto pb-2 mb-3 scrollbar-hide">
              <button onClick={() => setSeriesTab("ws-list")} className={`flex-shrink-0 px-4 py-2 rounded-lg text-[13px] font-medium transition-colors ${seriesTab === "ws-list" ? "bg-indigo-600 text-white" : "bg-[#141422] border border-white/8 text-zinc-400"}`}>
                All Series
              </button>
              <button onClick={() => setSeriesTab("ws-add")} className={`flex-shrink-0 px-4 py-2 rounded-lg text-[13px] font-medium transition-colors ${seriesTab === "ws-add" ? "bg-indigo-600 text-white" : "bg-[#141422] border border-white/8 text-zinc-400"}`}>
                Add New
              </button>
            </div>

            {seriesTab === "ws-list" && (
              <div>
                {/* Search bar */}
                <div className="mb-3">
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-purple-500" />
                    <input value={wsListSearch} onChange={e => setWsListSearch(e.target.value)}
                      className={`${inputClass} pl-9`} placeholder="Search series..." />
                  </div>
                </div>
                {(() => {
                  const filtered = wsListSearch.trim()
                    ? webseriesData.filter(item => item.title?.toLowerCase().includes(wsListSearch.toLowerCase()))
                    : webseriesData;
                  return filtered.length === 0 ? (
                    <p className="text-[#957DAD] text-[13px] text-center py-8">{wsListSearch.trim() ? "No matching series" : "No web series yet"}</p>
                  ) : filtered.map(item => (
                  <div key={item.id} className="bg-[#1A1A2E] border border-white/5 rounded-[14px] p-3.5 mb-3 hover:border-purple-500/30 transition-all">
                    <div className="flex gap-3.5">
                      <img src={item.poster || ""} className="w-20 h-[115px] rounded-[10px] object-cover flex-shrink-0"
                        onError={e => { (e.target as HTMLImageElement).src = "https://via.placeholder.com/80x115/1A1A2E/9D4EDD?text=N"; }} />
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-semibold mb-1 truncate">{item.title || "Untitled"}</h4>
                        <p className="text-[11px] text-[#D1C4E9] mb-2">{item.year || "N/A"} • {item.rating || "N/A"}⭐ • {item.language || "N/A"}</p>
                        <p className="text-[11px] text-[#D1C4E9]">{item.seasons?.length || 0} Seasons • {item.category || "Uncategorized"}</p>
                        <div className="flex gap-2 mt-2.5">
                          <button onClick={() => editSeries(item.id)} className={`${btnSecondary} px-3.5 py-2 text-[11px] font-semibold flex items-center gap-1.5`}>
                            <Edit size={12} /> Edit
                          </button>
                          <button onClick={() => deleteSeries(item.id)} className="bg-red-500/20 border border-red-500/30 text-pink-500 px-3.5 py-2 rounded-xl text-[11px] font-semibold flex items-center gap-1.5">
                            <Trash2 size={12} /> Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                  ));
                })()}
              </div>
            )}

            {seriesTab === "ws-add" && (
              <div>
                <div className={`${glassCard} p-4 mb-4`}>
                  <h3 className="text-sm font-semibold mb-3.5 flex items-center gap-2"><Search size={14} className="text-purple-500" /> Search Web Series</h3>
                  <div className="flex gap-2.5 mb-3.5">
                    <input value={seriesSearch} onChange={e => setSeriesSearch(e.target.value)} onKeyDown={e => e.key === "Enter" && searchTMDBSeries()}
                      className={`${inputClass} flex-1`} placeholder="Search series name..." />
                    <button onClick={searchTMDBSeries} className={`${btnPrimary} px-4 py-3.5`}><Search size={16} /></button>
                  </div>
                  {seriesResults.length > 0 && (
                    <div>
                      <p className="text-xs text-[#D1C4E9] mb-2.5">Click to fetch details:</p>
                      <div className="grid grid-cols-3 gap-3">
                        {seriesResults.map(item => (
                          <div key={item.id} onClick={() => fetchSeriesDetails(item.id)}
                            className="bg-[#1A1A2E] rounded-xl overflow-hidden cursor-pointer border-2 border-transparent hover:border-purple-500 hover:scale-[1.03] transition-all">
                            <img src={item.poster_path ? TMDB_IMG_BASE + "w342" + item.poster_path : ""} className="w-full aspect-[2/3] object-cover"
                              onError={e => { (e.target as HTMLImageElement).src = "https://via.placeholder.com/200x300/1A1A2E/9D4EDD?text=No+Image"; }} />
                            <div className="p-2.5">
                              <p className="text-[11px] font-semibold leading-tight line-clamp-2">{item.name}</p>
                              <p className="text-[10px] text-purple-500 mt-1 font-semibold">{item.first_air_date?.split("-")[0] || "N/A"}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {seriesForm && (
                  <>
                    {seriesForm.backdrop && (
                      <div className="relative rounded-[14px] overflow-hidden mb-5">
                        <img src={seriesForm.backdrop || seriesForm.poster} className="w-full aspect-video object-cover" />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent" />
                        <div className="absolute bottom-4 left-4 right-4">
                          <div className="text-lg font-bold">{seriesForm.title}</div>
                          <div className="text-xs text-[#D1C4E9] mt-1">{seriesForm.year} • {seriesForm.rating} ⭐</div>
                        </div>
                      </div>
                    )}

                    <div className={`${glassCard} p-4 mb-4`}>
                      <div className="text-base font-semibold mb-4 flex items-center gap-2.5"><span className="text-purple-500">ℹ️</span> Series Details</div>
                      {["title", "logo", "poster", "backdrop", "trailer"].map(field => (
                        <div key={field} className="mb-4">
                          <label className="block text-xs text-[#D1C4E9] mb-2 font-medium capitalize">{field === "logo" ? "Title Logo URL" : field === "trailer" ? "Trailer (YouTube Link)" : field.charAt(0).toUpperCase() + field.slice(1) + " URL"}</label>
                          <input value={seriesForm[field] || ""} onChange={e => setSeriesForm({ ...seriesForm, [field]: e.target.value })}
                            className={inputClass} placeholder={`${field}...`} />
                        </div>
                      ))}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="mb-4">
                          <label className="block text-xs text-[#D1C4E9] mb-2 font-medium">Year</label>
                          <input value={seriesForm.year || ""} onChange={e => setSeriesForm({ ...seriesForm, year: e.target.value })} className={inputClass} placeholder="Year" />
                        </div>
                        <div className="mb-4">
                          <label className="block text-xs text-[#D1C4E9] mb-2 font-medium">Rating</label>
                          <input value={seriesForm.rating || ""} onChange={e => setSeriesForm({ ...seriesForm, rating: e.target.value })} className={inputClass} placeholder="Rating" />
                        </div>
                      </div>
                      <div className="mb-4">
                        <label className="block text-xs text-[#D1C4E9] mb-2 font-medium">Language</label>
                        <select value={seriesForm.language || "English"} onChange={e => setSeriesForm({ ...seriesForm, language: e.target.value })} className={selectClass}>
                          {languageOptions.map(l => <option key={l} value={l}>{l}</option>)}
                        </select>
                      </div>
                      <div className="mb-4">
                        <label className="block text-xs text-[#D1C4E9] mb-2 font-medium">Category</label>
                        <select value={seriesForm.category || ""} onChange={e => setSeriesForm({ ...seriesForm, category: e.target.value })} className={selectClass}>
                          <option value="">Select Category</option>
                          {categoryList.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                        </select>
                      </div>
                      <div className="mb-4">
                        <label className="block text-xs text-[#D1C4E9] mb-2 font-medium">ডাব টাইপ</label>
                        <div className="flex gap-2">
                          <button type="button" onClick={() => setSeriesForm({ ...seriesForm, dubType: "official" })}
                            className={`flex-1 py-2.5 rounded-lg text-[12px] font-semibold border transition-all ${(seriesForm.dubType || "official") === "official" ? "bg-indigo-600 border-indigo-500 text-white" : "bg-[#141422] border-white/8 text-zinc-400"}`}>
                            𝐎𝐟𝐟𝐢𝐜𝐢𝐚𝐥𝐝𝐮𝐛
                          </button>
                          <button type="button" onClick={() => setSeriesForm({ ...seriesForm, dubType: "fandub" })}
                            className={`flex-1 py-2.5 rounded-lg text-[12px] font-semibold border transition-all ${seriesForm.dubType === "fandub" ? "bg-orange-600 border-orange-500 text-white" : "bg-[#141422] border-white/8 text-zinc-400"}`}>
                            𝐅𝐚𝐧𝐝𝐮𝐛
                          </button>
                        </div>
                      </div>
                      <div className="mb-4">
                        <label className="block text-xs text-[#D1C4E9] mb-2 font-medium">Storyline</label>
                        <textarea value={seriesForm.storyline || ""} onChange={e => setSeriesForm({ ...seriesForm, storyline: e.target.value })}
                          className={`${inputClass} min-h-[100px] resize-y`} placeholder="Storyline" />
                      </div>
                      {seriesCast.length > 0 && (
                        <div className="mb-4">
                          <label className="block text-xs text-[#D1C4E9] mb-2 font-medium">Cast (Auto-fetched)</label>
                          <div className="flex gap-3 overflow-x-auto pb-2.5 scrollbar-hide">
                            {seriesCast.map((c, i) => (
                              <div key={i} className="flex-shrink-0 w-[70px] text-center">
                                <img src={c.photo || ""} className="w-[60px] h-[60px] rounded-[10px] object-cover mb-1.5 mx-auto"
                                  onError={e => { (e.target as HTMLImageElement).src = "https://via.placeholder.com/60x60/1A1A2E/9D4EDD?text=N"; }} />
                                <p className="text-[10px] font-medium truncate">{c.name}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className={`${glassCard} p-4 mb-4`}>
                      <div className="flex justify-between items-center mb-3.5">
                        <div className="text-base font-semibold flex items-center gap-2.5">📋 Seasons & Episodes</div>
                        <div className="flex gap-1.5 items-center">
                          <button onClick={() => setWsJsonImportMode(prev => !prev)}
                            className={`px-3 py-2 rounded-xl text-[11px] font-bold border transition-all flex items-center gap-1.5 ${wsJsonImportMode ? 'bg-blue-500/30 border-blue-500/50 text-blue-300' : 'bg-blue-500/20 border-blue-500/30 text-blue-400 hover:bg-blue-500/40'}`}>
                            <FolderOpen size={12} /> JSON Import
                          </button>
                          <button onClick={() => addSeason()} className={`${btnSecondary} px-3 py-2 text-[11px]`}><Plus size={12} className="mr-1" /> Season</button>
                        </div>
                      </div>

                      {/* JSON Import Section - Beautiful Panel */}
                      {wsJsonImportMode && (
                        <div className="bg-gradient-to-br from-blue-900/30 to-indigo-900/20 rounded-2xl border border-blue-500/20 p-4 mb-4 space-y-3">
                          <div className="flex items-center gap-2 mb-1">
                            <div className="w-7 h-7 rounded-lg bg-blue-500/20 flex items-center justify-center">
                              <FolderOpen size={14} className="text-blue-400" />
                            </div>
                            <div>
                              <p className="text-[12px] font-semibold text-blue-200">JSON Import</p>
                              <p className="text-[9px] text-blue-400/70">Upload file or paste JSON text</p>
                            </div>
                          </div>

                          {/* Two columns: Upload & Paste side by side */}
                          <div className="grid grid-cols-2 gap-3">
                            {/* File Upload */}
                            <div className="bg-black/20 rounded-xl border border-blue-500/10 p-3 flex flex-col items-center justify-center gap-2 min-h-[120px] cursor-pointer hover:bg-blue-500/10 hover:border-blue-500/30 transition-all"
                              onClick={() => wsJsonFileRef.current?.click()}>
                              <input type="file" ref={wsJsonFileRef} accept=".json,application/json" multiple onChange={wsHandleJsonFileUpload} className="hidden" />
                              <div className="w-10 h-10 rounded-full bg-blue-500/15 flex items-center justify-center">
                                <Download size={18} className="text-blue-400" />
                              </div>
                              <p className="text-[11px] font-semibold text-blue-300 text-center">Upload .json</p>
                              <p className="text-[9px] text-blue-400/50 text-center">Click to browse</p>
                            </div>

                            {/* Paste JSON */}
                            <div className="bg-black/20 rounded-xl border border-blue-500/10 p-3 flex flex-col gap-2">
                              <textarea
                                value={wsJsonPasteText}
                                onChange={e => setWsJsonPasteText(e.target.value)}
                                placeholder='{ "episodes": [...] }'
                                className="w-full flex-1 bg-black/30 border border-white/5 rounded-lg px-2.5 py-2 text-[10px] text-white placeholder:text-blue-400/30 focus:border-blue-500/50 focus:outline-none min-h-[70px] resize-none font-mono"
                              />
                              <button onClick={wsHandleJsonPaste} disabled={!wsJsonPasteText.trim()}
                                className="w-full py-2 rounded-lg text-[10px] font-bold bg-gradient-to-r from-blue-600 to-indigo-600 text-white disabled:opacity-30 flex items-center justify-center gap-1.5 hover:from-blue-500 hover:to-indigo-500 transition-all">
                                <Download size={11} /> Import
                              </button>
                            </div>
                          </div>

                          <p className="text-[9px] text-blue-400/50 text-center">
                            Format: <code className="bg-black/30 px-1.5 py-0.5 rounded text-blue-300/70">episodes: [...]</code> or <code className="bg-black/30 px-1.5 py-0.5 rounded text-blue-300/70">seasons: [...]</code>
                          </p>
                        </div>
                      )}
                      {/* Hidden file input for per-season JSON import */}
                      <input type="file" ref={wsSeasonJsonFileRef} accept=".json,application/json" multiple onChange={wsHandleSeasonJsonFile} className="hidden" />
                      {seasonsData.map((season, sIdx) => (
                        <div key={sIdx} className="bg-black/30 rounded-xl p-3.5 mb-3 border border-white/5">
                          <div className="flex items-center gap-2.5 mb-3">
                            <input value={season.name} onChange={e => updateSeasonName(sIdx, e.target.value)} className={`${inputClass} flex-1`} />
                            <button onClick={() => removeSeason(sIdx)} className="bg-red-500/20 text-pink-500 p-2.5 rounded-lg"><Trash2 size={14} /></button>
                          </div>
                          <div className="mb-2.5 flex justify-between items-center">
                            <span className="text-xs text-[#D1C4E9]">Episodes: {season.episodes.length}</span>
                            <div className="flex gap-1.5 items-center">
                              <button onClick={() => { setWsSeasonJsonTarget(sIdx); wsSeasonJsonFileRef.current?.click(); }}
                                className="px-2 py-1.5 rounded-lg text-[10px] font-bold bg-blue-500/20 border border-blue-500/30 text-blue-400 hover:bg-blue-500/40 transition-all flex items-center gap-1">
                                <FolderOpen size={10} /> File
                              </button>
                              <button onClick={() => { setWsSeasonPasteTarget(sIdx); setWsSeasonPasteText(""); }}
                                className="px-2 py-1.5 rounded-lg text-[10px] font-bold bg-green-500/20 border border-green-500/30 text-green-400 hover:bg-green-500/40 transition-all flex items-center gap-1">
                                <Download size={10} /> Paste
                              </button>
                              <button onClick={() => setExpandedSeasons(prev => ({ ...prev, [sIdx]: !prev[sIdx] }))}
                                className={`${btnSecondary} px-3 py-1.5 text-[11px]`}><ChevronDown size={12} className={`mr-1 transition-transform ${expandedSeasons[sIdx] ? 'rotate-180' : ''}`} /> Episodes</button>
                            </div>
                          </div>
                          {wsSeasonPasteTarget === sIdx && (
                            <div className="mb-3 bg-black/20 rounded-xl border border-green-500/20 p-3">
                              <textarea
                                value={wsSeasonPasteText}
                                onChange={e => setWsSeasonPasteText(e.target.value)}
                                placeholder='{ "episodes": [...] } অথবা [{ "episodeNumber": 1, "link": "..." }]'
                                className="w-full bg-black/30 border border-white/5 rounded-lg px-2.5 py-2 text-[10px] text-white placeholder:text-green-400/30 focus:border-green-500/50 focus:outline-none min-h-[70px] resize-none font-mono mb-2"
                              />
                              <div className="flex gap-2">
                                <button onClick={() => {
                                  if (!wsSeasonPasteText.trim()) { toast.error('JSON টেক্সট পেস্ট করুন'); return; }
                                  try {
                                    const parsed = JSON.parse(wsSeasonPasteText.trim());
                                    wsImportJsonToSeason(sIdx, parsed);
                                    setWsSeasonPasteTarget(-1);
                                    setWsSeasonPasteText("");
                                  } catch { toast.error('Invalid JSON'); }
                                }} disabled={!wsSeasonPasteText.trim()}
                                  className="flex-1 py-2 rounded-lg text-[10px] font-bold bg-gradient-to-r from-green-600 to-emerald-600 text-white disabled:opacity-30 flex items-center justify-center gap-1.5">
                                  <Download size={11} /> Import
                                </button>
                                <button onClick={() => { setWsSeasonPasteTarget(-1); setWsSeasonPasteText(""); }}
                                  className="px-3 py-2 rounded-lg text-[10px] font-bold bg-white/5 text-zinc-400 hover:bg-white/10">
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                          {expandedSeasons[sIdx] && (
                            <div>
                              {season.episodes.map((ep, eIdx) => (
                                <div key={eIdx} className="mb-3 bg-white/[0.03] px-3 py-3 rounded-lg border border-white/5">
                                  <div className="flex items-center justify-between mb-2">
                                    <span className="text-xs font-semibold text-purple-400">Episode {ep.episodeNumber}</span>
                                    <button onClick={() => removeEpisode(sIdx, eIdx)} className="bg-red-500/20 text-pink-500 p-1.5 rounded-lg hover:bg-red-500/40 transition-all">
                                      <Trash2 size={12} />
                                    </button>
                                  </div>
                                  <div className="space-y-2.5">
                                    <div>
                                      <span className="text-[10px] text-[#D1C4E9] font-medium mb-1 block">Default</span>
                                      <textarea value={ep.link} onChange={e => updateEpisodeLink(sIdx, eIdx, e.target.value)}
                                        className={`${inputClass} w-full !py-2 !text-[10px] min-h-[44px] resize-none break-all`} placeholder="Default link" rows={2} />
                                    </div>
                                    {["link480", "link720", "link1080", "link4k"].map(q => (
                                      <div key={q}>
                                        <span className="text-[10px] text-[#D1C4E9] font-medium mb-1 block">
                                          {q === "link480" ? "480p" : q === "link720" ? "720p" : q === "link1080" ? "1080p" : "4K"}
                                        </span>
                                        <textarea value={(ep as any)[q] || ""} onChange={e => updateEpisodeQualityLink(sIdx, eIdx, q, e.target.value)}
                                          className={`${inputClass} w-full !py-2 !text-[10px] min-h-[44px] resize-none break-all`} placeholder={`${q === "link480" ? "480p" : q === "link720" ? "720p" : q === "link1080" ? "1080p" : "4K"} link (optional)`} rows={2} />
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ))}
                              <button onClick={() => addEpisode(sIdx)} className={`${btnSecondary} w-full py-2.5 text-xs mt-2`}><Plus size={12} className="mr-1" /> Add Episode</button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Inline Link Checker for current series */}
                    <WsInlineLinkChecker
                      seasonsData={seasonsData}
                      seriesTitle={seriesForm?.title || ""}
                      glassCard={glassCard}
                      btnPrimary={btnPrimary}
                    />

                    <div className="flex gap-2">
                      <button onClick={saveSeries} className={`${btnPrimary} flex-1 py-4 text-[14px] font-semibold flex items-center justify-center gap-2`}>
                        <Save size={16} /> Normal Save
                      </button>
                      <button onClick={() => {
                        // Capture context BEFORE saveSeries resets it
                        const capturedForm = seriesForm ? { ...seriesForm } : null;
                        const capturedSeasons = seasonsData.map(s => ({ ...s, episodes: [...(s.episodes || [])] }));
                        wsNotifyContextRef.current = {
                          seriesId: seriesEditId || "__pending__",
                          form: capturedForm,
                          seasons: capturedSeasons,
                        };
                        saveSeries();
                        // After save, update seriesId from lastSavedSeriesIdRef for new series
                        setTimeout(() => {
                          if (wsNotifyContextRef.current && (wsNotifyContextRef.current.seriesId === "__pending__" || !wsNotifyContextRef.current.seriesId)) {
                            wsNotifyContextRef.current.seriesId = lastSavedSeriesIdRef.current || "";
                          }
                          setWsSaveNotifyModal(true);
                        }, 800);
                      }} className="flex-1 py-4 text-[14px] font-semibold flex items-center justify-center gap-2 bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white rounded-lg transition-colors cursor-pointer border-none">
                        <Bell size={16} /> Save + Notify
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Save + Notify Modal */}
        {wsSaveNotifyModal && (() => {
          const ctx = wsNotifyContextRef.current;
          const ctxSeasons = ctx?.seasons || [];
          const ctxForm = ctx?.form;
          const ctxSeriesId = ctx?.seriesId || "";
          return (
          <div className="fixed inset-0 z-[500] bg-black/80 flex items-center justify-center p-4" onClick={() => setWsSaveNotifyModal(false)}>
            <div className="bg-[#16162A] border border-white/10 rounded-2xl w-full max-w-[440px] max-h-[80vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
              {wsNotifyStep === "release" ? (
                <div>
                  <h3 className="text-sm font-bold mb-3 flex items-center gap-2"><Zap size={14} className="text-pink-500" /> New Release তৈরি করুন</h3>
                  <p className="text-[11px] text-zinc-400 mb-4">{ctxForm?.title ? `"${ctxForm.title}" — সিজন ও এপিসোড সিলেক্ট করুন` : "সিজন ও এপিসোড সিলেক্ট করে New Release পোস্ট করুন"}</p>
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div>
                      <label className="block text-xs text-zinc-400 mb-1.5">Season</label>
                      <select value={wsNotifySeason} onChange={e => { setWsNotifySeason(e.target.value); setWsNotifyEpisode(""); }} className={selectClass}>
                        <option value="">Select</option>
                        {ctxSeasons.map((s: any, i: number) => <option key={i} value={String(i)}>{s.name || `Season ${i + 1}`}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-400 mb-1.5">Episode</label>
                      <select value={wsNotifyEpisode} onChange={e => setWsNotifyEpisode(e.target.value)} className={selectClass}>
                        <option value="">Select</option>
                        {wsNotifySeason !== "" && ctxSeasons[parseInt(wsNotifySeason)]?.episodes?.map((ep: any, i: number) => (
                          <option key={i} value={String(i)}>EP {ep.episodeNumber || i + 1}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <button onClick={async () => {
                    if (wsNotifySeason === "" || wsNotifyEpisode === "") { toast.error("সিজন ও এপিসোড সিলেক্ট করুন"); return; }
                    if (!ctxSeriesId || !ctxForm?.title) { toast.error("সিরিজ কন্টেক্সট পাওয়া যায়নি"); return; }
                    const season = ctxSeasons[parseInt(wsNotifySeason)];
                    const episode = season?.episodes?.[parseInt(wsNotifyEpisode)];
                    const newRelease = {
                      contentId: ctxSeriesId,
                      contentType: "webseries",
                      title: ctxForm.title,
                      poster: ctxForm.poster || "",
                      year: ctxForm.year || "N/A",
                      rating: ctxForm.rating || "N/A",
                      episodeInfo: {
                        seasonNumber: parseInt(wsNotifySeason) + 1,
                        episodeNumber: episode?.episodeNumber || parseInt(wsNotifyEpisode) + 1,
                        seasonName: season?.name || `Season ${parseInt(wsNotifySeason) + 1}`
                      },
                      timestamp: Date.now(),
                      active: true
                    };
                    try {
                      await set(push(ref(db, "newEpisodeReleases")), newRelease);
                      toast.success("✅ New Release যোগ হয়েছে!");
                      // Send FCM + in-app notifications
                      const usersSnap = await get(ref(db, "users"));
                      const users = usersSnap.val() || {};
                      const notifTitle = `New Episode: ${ctxForm.title}`;
                      const notifMsg = `${season?.name || "New Season"} - Episode ${episode?.episodeNumber || parseInt(wsNotifyEpisode) + 1} is now available!`;
                      const userNotifUpdates: Record<string, any> = {};
                      const seenUserIds = new Set<string>();
                      const targetUserIds: string[] = [];
                      Object.entries(users).forEach(([userKey, userData]: any) => {
                        const uid = String(userData?.id || userKey || "").trim();
                        if (!uid || seenUserIds.has(uid)) return;
                        seenUserIds.add(uid);
                        targetUserIds.push(uid);
                        const nKey = push(ref(db, `notifications/${uid}`)).key;
                        if (!nKey) return;
                        userNotifUpdates[`notifications/${uid}/${nKey}`] = {
                          title: notifTitle, message: notifMsg, type: "new_episode",
                          contentId: ctxSeriesId, contentType: "webseries",
                          image: ctxForm.poster || "", poster: ctxForm.poster || "",
                          timestamp: Date.now(), read: false,
                        };
                      });
                      if (Object.keys(userNotifUpdates).length > 0) await update(ref(db), userNotifUpdates);
                      toast.success("In-app নোটিফিকেশন পাঠানো হয়েছে!");
                      // Send FCM push
                      try {
                        const pushPayload = {
                          title: notifTitle, body: notifMsg,
                          image: ctxForm.poster || undefined,
                          url: `/?anime=${ctxSeriesId}`,
                          data: { url: `/?anime=${ctxSeriesId}`, type: "new_episode", contentId: ctxSeriesId },
                        };
                        setPushSending(true);
                        setPushProgress({ phase: "tokens", totalTokens: 0, sent: 0, success: 0, failed: 0, invalidRemoved: 0 });
                        const result = await sendPushToUsers(targetUserIds, pushPayload, (p) => setPushProgress({ ...p }));
                        if ((result?.total || 0) > 0) toast.success(`Push: ${result?.success || 0} delivered`);
                        setTimeout(() => { setPushSending(false); setPushProgress(null); }, 4000);
                      } catch { toast.warning("Push delivery failed - শুধু in-app notification গেছে"); setPushSending(false); setPushProgress(null); }
                      // Auto-fill telegram fields
                      setTgTitle(ctxForm.title);
                      const backdropUrl = ctxForm.backdrop || ctxForm.poster || "";
                      setTgPosterUrl(backdropUrl.replace('/original/', '/w1280/').replace('/w780/', '/w1280/'));
                      setTgSeason(String(parseInt(wsNotifySeason) + 1).padStart(2, '0'));
                      setTgNewEpAdded(String(episode?.episodeNumber || parseInt(wsNotifyEpisode) + 1).padStart(2, '0'));
                      // Get per-season total episodes from TMDB
                      const seasonNum = parseInt(wsNotifySeason) + 1;
                      try {
                        const tmdbId = ctxForm.tmdbId;
                        if (tmdbId) {
                          const tmdbRes = await fetch(`${TMDB_BASE_URL}/tv/${tmdbId}/season/${seasonNum}?api_key=${TMDB_API_KEY}&language=en-US`);
                          const tmdbData = await tmdbRes.json();
                          if (tmdbData?.episodes?.length) {
                            setTgTotalEpisodes(String(tmdbData.episodes.length));
                          } else {
                            setTgTotalEpisodes(String(season?.episodes?.length || 0));
                          }
                        } else {
                          setTgTotalEpisodes(String(season?.episodes?.length || 0));
                        }
                      } catch {
                        setTgTotalEpisodes(String(season?.episodes?.length || 0));
                      }
                      setTgDubType(ctxForm.dubType === "fandub" ? "fandub" : "official");
                      // Get quality info
                      const quals: string[] = [];
                      ctxSeasons.forEach((s: any) => s.episodes?.forEach((ep: any) => {
                        if (ep.link480) quals.push("480p");
                        if (ep.link720) quals.push("720p");
                        if (ep.link1080) quals.push("1080p");
                        if (ep.link4k) quals.push("4K");
                      }));
                      if (quals.length > 0) setTgQuality([...new Set(quals)].join(","));
                      setTgButtonLink(`${SITE_URL}?anime=${encodeURIComponent(ctxSeriesId)}`);
                      setWsNotifyStep("telegram");
                    } catch (err: any) { toast.error("Error: " + err.message); }
                  }} className="w-full py-3 rounded-lg text-sm font-bold bg-gradient-to-r from-pink-600 to-purple-600 text-white flex items-center justify-center gap-2">
                    <Zap size={14} /> Release + Notify
                  </button>
                </div>
              ) : (
                <div>
                  <h3 className="text-sm font-bold mb-3 flex items-center gap-2"><Send size={14} className="text-blue-400" /> টেলিগ্রামে পোস্ট করুন</h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs text-zinc-400 mb-1.5">চ্যানেল আইডি</label>
                      <textarea value={tgChannelId} onChange={e => setTgChannelId(e.target.value)} className={`${inputClass} min-h-[50px] resize-y`} placeholder="@channel" rows={2} />
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-400 mb-1.5">টাইটেল</label>
                      <input value={tgTitle} onChange={e => setTgTitle(e.target.value)} className={inputClass} placeholder="Title" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-zinc-400 mb-1.5">সিজন</label>
                        <input value={tgSeason} onChange={e => setTgSeason(e.target.value)} className={inputClass} placeholder="01" />
                      </div>
                      <div>
                        <label className="block text-xs text-zinc-400 mb-1.5">নতুন EP</label>
                        <input value={tgNewEpAdded} onChange={e => setTgNewEpAdded(e.target.value)} className={inputClass} placeholder="02" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-400 mb-1.5">পোস্টার URL</label>
                      <input value={tgPosterUrl} onChange={e => setTgPosterUrl(e.target.value)} className={inputClass} placeholder="https://..." />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => { setWsSaveNotifyModal(false); setWsNotifyStep("release"); setWsNotifySeason(""); setWsNotifyEpisode(""); wsNotifyContextRef.current = null; }} className="flex-1 py-3 rounded-lg text-sm font-bold bg-zinc-700 text-white flex items-center justify-center gap-2">
                        <X size={14} /> বাদ দিন
                      </button>
                      <button onClick={async () => {
                        await sendTelegramPost();
                        setWsSaveNotifyModal(false);
                        setWsNotifyStep("release");
                        setWsNotifySeason("");
                        setWsNotifyEpisode("");
                        wsNotifyContextRef.current = null;
                      }} disabled={tgSending || !tgTitle.trim()} className="flex-1 py-3 rounded-lg text-sm font-bold bg-gradient-to-r from-blue-600 to-indigo-600 text-white flex items-center justify-center gap-2 disabled:opacity-50">
                        {tgSending ? <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" /> : <Send size={14} />}
                        পাঠান
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
          );
        })()}


        {activeSection === "movies" && (
          <div>
            <div className="flex gap-2 overflow-x-auto pb-2 mb-3 scrollbar-hide">
              <button onClick={() => setMoviesTab("mv-list")} className={`flex-shrink-0 px-4 py-2 rounded-lg text-[13px] font-medium transition-colors ${moviesTab === "mv-list" ? "bg-indigo-600 text-white" : "bg-[#141422] border border-white/8 text-zinc-400"}`}>
                All Movies
              </button>
              <button onClick={() => setMoviesTab("mv-add")} className={`flex-shrink-0 px-4 py-2 rounded-lg text-[13px] font-medium transition-colors ${moviesTab === "mv-add" ? "bg-indigo-600 text-white" : "bg-[#141422] border border-white/8 text-zinc-400"}`}>
                Add New
              </button>
            </div>

            {moviesTab === "mv-list" && (
              <div>
                {/* Search bar */}
                <div className="mb-3">
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-purple-500" />
                    <input value={mvListSearch} onChange={e => setMvListSearch(e.target.value)}
                      className={`${inputClass} pl-9`} placeholder="Search movies..." />
                  </div>
                </div>
                {(() => {
                  const filtered = mvListSearch.trim()
                    ? moviesData.filter(item => item.title?.toLowerCase().includes(mvListSearch.toLowerCase()))
                    : moviesData;
                  return filtered.length === 0 ? (
                    <p className="text-[#957DAD] text-[13px] text-center py-8">{mvListSearch.trim() ? "No matching movies" : "No movies yet"}</p>
                  ) : filtered.map(item => (
                  <div key={item.id} className="bg-[#1A1A2E] border border-white/5 rounded-[14px] p-3.5 mb-3 hover:border-purple-500/30 transition-all">
                    <div className="flex gap-3.5">
                      <img src={item.poster || ""} className="w-20 h-[115px] rounded-[10px] object-cover flex-shrink-0"
                        onError={e => { (e.target as HTMLImageElement).src = "https://via.placeholder.com/80x115/1A1A2E/9D4EDD?text=N"; }} />
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-semibold mb-1 truncate">{item.title || "Untitled"}</h4>
                        <p className="text-[11px] text-[#D1C4E9] mb-2">{item.year || "N/A"} • {item.rating || "N/A"}⭐ • {item.language || "N/A"}</p>
                        <p className="text-[11px] text-[#D1C4E9]">{item.category || "Uncategorized"}</p>
                        <div className="flex gap-2 mt-2.5">
                          <button onClick={() => editMovie(item.id)} className={`${btnSecondary} px-3.5 py-2 text-[11px] font-semibold flex items-center gap-1.5`}>
                            <Edit size={12} /> Edit
                          </button>
                          <button onClick={() => deleteMovie(item.id)} className="bg-red-500/20 border border-red-500/30 text-pink-500 px-3.5 py-2 rounded-xl text-[11px] font-semibold flex items-center gap-1.5">
                            <Trash2 size={12} /> Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                  ));
                })()}
              </div>
            )}

            {moviesTab === "mv-add" && (
              <div>
                <div className={`${glassCard} p-4 mb-4`}>
                  <h3 className="text-sm font-semibold mb-3.5 flex items-center gap-2"><Search size={14} className="text-purple-500" /> Search Movie</h3>
                  <div className="flex gap-2.5 mb-3.5">
                    <input value={movieSearch} onChange={e => setMovieSearch(e.target.value)} onKeyDown={e => e.key === "Enter" && searchTMDBMovies()}
                      className={`${inputClass} flex-1`} placeholder="Search movie name..." />
                    <button onClick={searchTMDBMovies} className={`${btnPrimary} px-4 py-3.5`}><Search size={16} /></button>
                  </div>
                  {movieResults.length > 0 && (
                    <div>
                      <p className="text-xs text-[#D1C4E9] mb-2.5">Click to fetch details:</p>
                      <div className="grid grid-cols-3 gap-3">
                        {movieResults.map(item => (
                          <div key={item.id} onClick={() => fetchMovieDetails(item.id)}
                            className="bg-[#1A1A2E] rounded-xl overflow-hidden cursor-pointer border-2 border-transparent hover:border-purple-500 hover:scale-[1.03] transition-all">
                            <img src={item.poster_path ? TMDB_IMG_BASE + "w342" + item.poster_path : ""} className="w-full aspect-[2/3] object-cover"
                              onError={e => { (e.target as HTMLImageElement).src = "https://via.placeholder.com/200x300/1A1A2E/9D4EDD?text=No+Image"; }} />
                            <div className="p-2.5">
                              <p className="text-[11px] font-semibold leading-tight line-clamp-2">{item.title}</p>
                              <p className="text-[10px] text-purple-500 mt-1 font-semibold">{item.release_date?.split("-")[0] || "N/A"}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {movieForm && (
                  <>
                    {movieForm.backdrop && (
                      <div className="relative rounded-[14px] overflow-hidden mb-5">
                        <img src={movieForm.backdrop || movieForm.poster} className="w-full aspect-video object-cover" />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent" />
                        <div className="absolute bottom-4 left-4 right-4">
                          <div className="text-lg font-bold">{movieForm.title}</div>
                          <div className="text-xs text-[#D1C4E9] mt-1">{movieForm.year} • {movieForm.rating} ⭐</div>
                        </div>
                      </div>
                    )}

                    <div className={`${glassCard} p-4 mb-4`}>
                      <div className="text-base font-semibold mb-4 flex items-center gap-2.5"><span className="text-purple-500">ℹ️</span> Movie Details</div>
                      {["title", "logo", "poster", "backdrop", "trailer"].map(field => (
                        <div key={field} className="mb-4">
                          <label className="block text-xs text-[#D1C4E9] mb-2 font-medium capitalize">{field === "logo" ? "Title Logo URL" : field === "trailer" ? "Trailer (YouTube Link)" : field.charAt(0).toUpperCase() + field.slice(1) + " URL"}</label>
                          <input value={movieForm[field] || ""} onChange={e => setMovieForm({ ...movieForm, [field]: e.target.value })}
                            className={inputClass} placeholder={`${field}...`} />
                        </div>
                      ))}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="mb-4">
                          <label className="block text-xs text-[#D1C4E9] mb-2 font-medium">Year</label>
                          <input value={movieForm.year || ""} onChange={e => setMovieForm({ ...movieForm, year: e.target.value })} className={inputClass} placeholder="Year" />
                        </div>
                        <div className="mb-4">
                          <label className="block text-xs text-[#D1C4E9] mb-2 font-medium">Rating</label>
                          <input value={movieForm.rating || ""} onChange={e => setMovieForm({ ...movieForm, rating: e.target.value })} className={inputClass} placeholder="Rating" />
                        </div>
                      </div>
                      <div className="mb-4">
                        <label className="block text-xs text-[#D1C4E9] mb-2 font-medium">Language</label>
                        <select value={movieForm.language || "English"} onChange={e => setMovieForm({ ...movieForm, language: e.target.value })} className={selectClass}>
                          {languageOptions.map(l => <option key={l} value={l}>{l}</option>)}
                        </select>
                      </div>
                      <div className="mb-4">
                        <label className="block text-xs text-[#D1C4E9] mb-2 font-medium">Category</label>
                        <select value={movieForm.category || ""} onChange={e => setMovieForm({ ...movieForm, category: e.target.value })} className={selectClass}>
                          <option value="">Select Category</option>
                          {categoryList.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                        </select>
                      </div>
                      <div className="mb-4">
                        <label className="block text-xs text-[#D1C4E9] mb-2 font-medium">ডাব টাইপ</label>
                        <div className="flex gap-2">
                          <button type="button" onClick={() => setMovieForm({ ...movieForm, dubType: "official" })}
                            className={`flex-1 py-2.5 rounded-lg text-[12px] font-semibold border transition-all ${(movieForm.dubType || "official") === "official" ? "bg-indigo-600 border-indigo-500 text-white" : "bg-[#141422] border-white/8 text-zinc-400"}`}>
                            𝐎𝐟𝐟𝐢𝐜𝐢𝐚𝐥𝐝𝐮𝐛
                          </button>
                          <button type="button" onClick={() => setMovieForm({ ...movieForm, dubType: "fandub" })}
                            className={`flex-1 py-2.5 rounded-lg text-[12px] font-semibold border transition-all ${movieForm.dubType === "fandub" ? "bg-orange-600 border-orange-500 text-white" : "bg-[#141422] border-white/8 text-zinc-400"}`}>
                            𝐅𝐚𝐧𝐝𝐮𝐛
                          </button>
                        </div>
                      </div>
                      <div className="mb-4">
                        <label className="block text-xs text-[#D1C4E9] mb-2 font-medium">Storyline</label>
                        <textarea value={movieForm.storyline || ""} onChange={e => setMovieForm({ ...movieForm, storyline: e.target.value })}
                          className={`${inputClass} min-h-[100px] resize-y`} placeholder="Storyline" />
                      </div>
                      {movieCast.length > 0 && (
                        <div className="mb-4">
                          <label className="block text-xs text-[#D1C4E9] mb-2 font-medium">Cast (Auto-fetched)</label>
                          <div className="flex gap-3 overflow-x-auto pb-2.5 scrollbar-hide">
                            {movieCast.map((c, i) => (
                              <div key={i} className="flex-shrink-0 w-[70px] text-center">
                                <img src={c.photo || ""} className="w-[60px] h-[60px] rounded-[10px] object-cover mb-1.5 mx-auto"
                                  onError={e => { (e.target as HTMLImageElement).src = "https://via.placeholder.com/60x60/1A1A2E/9D4EDD?text=N"; }} />
                                <p className="text-[10px] font-medium truncate">{c.name}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="mb-4">
                        <label className="block text-xs text-[#D1C4E9] mb-2 font-medium">Movie Link (Default) <span className="text-purple-500">*</span></label>
                        <input value={movieForm.movieLink || ""} onChange={e => setMovieForm({ ...movieForm, movieLink: e.target.value })}
                          className={inputClass} placeholder="Movie streaming/embed link" />
                      </div>
                      {/* Quality Links */}
                      <div className="mb-4 space-y-2">
                        <label className="block text-xs text-[#D1C4E9] mb-1 font-medium">Quality Links (Optional)</label>
                        {[
                          { key: "movieLink480", label: "480p" },
                          { key: "movieLink720", label: "720p" },
                          { key: "movieLink1080", label: "1080p" },
                          { key: "movieLink4k", label: "4K" },
                        ].map(q => (
                          <div key={q.key} className="flex items-center gap-2">
                            <span className="text-[10px] text-[#D1C4E9] w-12 flex-shrink-0">{q.label}</span>
                            <input value={movieForm[q.key] || ""} onChange={e => setMovieForm({ ...movieForm, [q.key]: e.target.value })}
                              className={`${inputClass} flex-1 !py-2 !text-xs`} placeholder={`${q.label} link (optional)`} />
                          </div>
                        ))}
                      </div>
                      <div className="mb-4">
                        <label className="block text-xs text-[#D1C4E9] mb-2 font-medium">Download Link (Manual)</label>
                        <input value={movieForm.downloadLink || ""} onChange={e => setMovieForm({ ...movieForm, downloadLink: e.target.value })}
                          className={inputClass} placeholder="Download link" />
                      </div>
                    </div>

                    <button onClick={saveMovie} className={`${btnPrimary} w-full py-4 text-[15px] font-semibold flex items-center justify-center gap-2`}>
                      <Save size={18} /> Save Movie
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* ==================== USERS ==================== */}
        {activeSection === "users" && (
          <div>
            {/* Password Lookup */}
            <div className={`${glassCard} p-4 mb-4`}>
              <h3 className="text-sm font-semibold mb-3.5 flex items-center gap-2">
                <Search size={14} className="text-purple-500" /> 🔍 User Password Lookup
              </h3>
              <UserPasswordLookup inputClass={inputClass} btnPrimary={btnPrimary} />
            </div>

            <div className={`${glassCard} p-4 mb-4`}>
              <div className="flex justify-between items-center mb-3.5">
                <h3 className="text-sm font-semibold">User Statistics</h3>
                <button onClick={() => toast.info("Users auto-synced!")} className="text-purple-500"><RefreshCw size={16} /></button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-green-500/10 p-4 rounded-xl border border-green-500/20">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-xs text-green-400">Online</span>
                  </div>
                  <div className="text-2xl font-bold">{onlineUsers}</div>
                </div>
                <div className="bg-red-500/10 p-4 rounded-xl border border-red-500/20">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
                    <span className="text-xs text-red-400">Offline</span>
                  </div>
                  <div className="text-2xl font-bold">{offlineUsers}</div>
                </div>
              </div>
            </div>
            <div className={`${glassCard} p-4`}>
              <h3 className="text-sm font-semibold mb-3.5">All Users</h3>
              {usersData.length === 0 ? (
                <p className="text-[#957DAD] text-[13px] text-center py-5">No users found</p>
              ) : usersData.map(user => (
                <div key={user.id} className="bg-[#1A1A2E] rounded-xl p-3.5 flex items-center gap-3 mb-2.5 border border-white/5">
                  <div className="w-[45px] h-[45px] rounded-full bg-gradient-to-br from-purple-500 to-purple-800 flex items-center justify-center font-bold text-lg">
                    {(user.name || user.email || "U")[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold">{user.name || "Anonymous"}</p>
                    <p className="text-[11px] text-[#D1C4E9] truncate">{user.email || user.id.substring(0, 20)}...</p>
                  </div>
                  <div className={`w-2.5 h-2.5 rounded-full ${user.online ? "bg-green-500 animate-pulse" : "bg-red-500"}`} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ==================== NOTIFICATIONS ==================== */}
        {activeSection === "notifications" && (
          <div>
            <div className={`${glassCard} p-4 mb-4`}>
              <h3 className="text-sm font-semibold mb-3.5 flex items-center gap-2">
                <Bell size={14} className="text-purple-500" /> Send Notification to Users
              </h3>
              <div className="mb-4">
                <label className="block text-xs text-[#D1C4E9] mb-2 font-medium">Notification Title</label>
                <input value={notifTitle} onChange={e => setNotifTitle(e.target.value)} className={inputClass} placeholder="Enter notification title" />
              </div>
              <div className="mb-4">
                <label className="block text-xs text-[#D1C4E9] mb-2 font-medium">Notification Message</label>
                <textarea value={notifMessage} onChange={e => setNotifMessage(e.target.value)}
                  className={`${inputClass} min-h-[80px] resize-y`} placeholder="Enter notification message" rows={3} />
              </div>
              <div className="mb-4" ref={notifDropdownRef}>
                <label className="block text-xs text-[#D1C4E9] mb-2 font-medium">Select Content (Optional)</label>
                <div className="relative">
                  <button type="button" onClick={() => setNotifDropdownOpen(!notifDropdownOpen)}
                    className={`${selectClass} w-full text-left flex items-center gap-2`}>
                    {notifContent ? (
                      <>
                        <img src={contentOptions.find(o => o.value === notifContent)?.poster} alt="" className="w-7 h-10 rounded object-cover flex-shrink-0" />
                        <span className="truncate text-sm">{contentOptions.find(o => o.value === notifContent)?.label}</span>
                      </>
                    ) : <span className="text-[#957DAD]">No specific content</span>}
                    <ChevronDown size={14} className="ml-auto flex-shrink-0" />
                  </button>
                  {notifDropdownOpen && (
                    <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-[#1A1A2E] border border-purple-500/40 rounded-xl max-h-[280px] overflow-y-auto shadow-xl">
                      <div className="p-2 cursor-pointer hover:bg-purple-500/20 rounded-lg m-1 text-sm text-[#957DAD]"
                        onClick={() => { setNotifContent(""); setNotifDropdownOpen(false); }}>No specific content</div>
                      {contentOptions.map(o => (
                        <div key={o.value} className={`flex items-center gap-2.5 p-2 cursor-pointer hover:bg-purple-500/20 rounded-lg m-1 ${notifContent === o.value ? "bg-purple-500/30" : ""}`}
                          onClick={() => { setNotifContent(o.value); setNotifDropdownOpen(false); }}>
                          <img src={o.poster} alt="" className="w-8 h-11 rounded object-cover flex-shrink-0 bg-[#2A2A3E]" />
                          <span className="text-sm truncate">{o.label}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="mb-4">
                <label className="block text-xs text-[#D1C4E9] mb-2 font-medium">Notification Type</label>
                <select value={notifType} onChange={e => setNotifType(e.target.value)} className={selectClass}>
                  <option value="info">Info</option>
                  <option value="new_episode">New Episode</option>
                  <option value="update">Update</option>
                  <option value="announcement">Announcement</option>
                </select>
              </div>
              <div className="mb-4">
                <label className="block text-xs text-[#D1C4E9] mb-2 font-medium">Send to</label>
                <select value={notifTarget} onChange={e => setNotifTarget(e.target.value)} className={selectClass}>
                  <option value="all">All Users</option>
                  <option value="online">Online Users Only</option>
                </select>
              </div>
              <button onClick={sendNotification} className={`${btnPrimary} w-full py-4 text-[15px] font-semibold flex items-center justify-center gap-2 mt-2.5`}>
                <Send size={18} /> Send Notification
              </button>
            </div>

            <div className={`${glassCard} p-4`}>
              <h3 className="text-sm font-semibold mb-3.5 flex items-center gap-2">
                <RefreshCw size={14} className="text-purple-500" /> Recent Notifications
              </h3>
              {(() => {
                // Deduplicate notifications - group by title+message, show unique ones only
                const seen = new Set<string>();
                const uniqueNotifs = notificationsData.filter(notif => {
                  const key = `${notif.title}||${notif.message}`;
                  if (seen.has(key)) return false;
                  seen.add(key);
                  return true;
                });
                return uniqueNotifs.length === 0 ? (
                  <p className="text-[#957DAD] text-[13px] text-center py-5">No notifications sent yet</p>
                ) : uniqueNotifs.slice(0, 15).map((notif, idx) => (
                  <div key={`notif-${idx}-${notif.timestamp}`} className="bg-[#1A1A2E] border border-purple-500/30 rounded-xl p-4 mb-3">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <span className="bg-gradient-to-r from-pink-500 to-pink-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-[10px] inline-flex items-center gap-1">
                          <Bell size={10} /> {notif.type}
                        </span>
                        <span className="text-[11px] text-[#957DAD] ml-2.5">{formatTime(notif.timestamp)}</span>
                      </div>
                      <button onClick={() => deleteNotification(notif.title, notif.message, notif.timestamp)} className="text-[#957DAD] hover:text-red-400 transition-colors">
                        <X size={14} />
                      </button>
                    </div>
                    <h4 className="text-[13px] font-semibold mb-1.5">{notif.title}</h4>
                    <p className="text-xs text-[#D1C4E9]">{notif.message}</p>
                    {notif.contentId && (
                      <div className="mt-2 text-[11px] text-purple-500 flex items-center gap-1">
                        <Link size={10} /> Linked to content
                      </div>
                    )}
                  </div>
                ));
              })()}
            </div>
          </div>
        )}

        {/* ==================== NEW RELEASES ==================== */}
        {activeSection === "new-releases" && (
          <div>
            <div className={`${glassCard} relative z-[120] overflow-visible p-4 mb-4`}>
              <h3 className="text-sm font-semibold mb-3.5 flex items-center gap-2">
                <Zap size={14} className="text-pink-500" /> Manage New Episode Releases
              </h3>
              <div className="mb-4" ref={releaseDropdownRef}>
                <label className="block text-xs text-[#D1C4E9] mb-2 font-medium">Select Content to Add as New Release</label>
                <div className="relative z-[130]">
                  <button type="button" onClick={() => setReleaseDropdownOpen(!releaseDropdownOpen)}
                    className={`${selectClass} w-full text-left flex items-center gap-2`}>
                    {releaseContent ? (
                      <>
                        <img src={contentOptions.find(o => o.value === releaseContent)?.poster} alt="" className="w-7 h-10 rounded object-cover flex-shrink-0" />
                        <span className="truncate text-sm">{contentOptions.find(o => o.value === releaseContent)?.label}</span>
                      </>
                    ) : <span className="text-[#957DAD]">Select Content</span>}
                    <ChevronDown size={14} className="ml-auto flex-shrink-0" />
                  </button>
                  {releaseDropdownOpen && (
                    <div className="absolute z-[200] top-full left-0 right-0 mt-1 bg-[#1A1A2E] border border-purple-500/40 rounded-xl max-h-[320px] overflow-hidden shadow-xl flex flex-col">
                      <div className="p-2 border-b border-white/10 flex-shrink-0">
                        <div className="relative">
                          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-purple-500" />
                          <input
                            value={releaseContentSearch}
                            onChange={e => setReleaseContentSearch(e.target.value)}
                            className="w-full pl-8 pr-3 py-2 bg-[#151521] border border-white/10 rounded-lg text-white text-[12px] focus:border-purple-500 focus:outline-none placeholder:text-[#957DAD]"
                            placeholder="🔍 কন্টেন্ট সার্চ করুন..."
                            autoFocus
                            onClick={e => e.stopPropagation()}
                          />
                        </div>
                      </div>
                      <div className="overflow-y-auto max-h-[260px]">
                      {(() => {
                        const filtered = releaseContentSearch.trim()
                          ? contentOptions.filter(o => o.label.toLowerCase().includes(releaseContentSearch.toLowerCase()))
                          : contentOptions;
                        return filtered.length === 0 ? (
                          <p className="text-[#957DAD] text-[11px] text-center py-4">কোনো কন্টেন্ট পাওয়া যায়নি</p>
                        ) : filtered.map(o => (
                        <div key={o.value} className={`flex items-center gap-2.5 p-2 cursor-pointer hover:bg-purple-500/20 rounded-lg m-1 ${releaseContent === o.value ? "bg-purple-500/30" : ""}`}
                          onClick={() => { handleReleaseContentChange(o.value); setReleaseDropdownOpen(false); setReleaseContentSearch(''); }}>
                          <img src={o.poster} alt="" className="w-8 h-11 rounded object-cover flex-shrink-0 bg-[#2A2A3E]" />
                          <span className="text-sm truncate">{o.label}</span>
                        </div>
                        ));
                      })()}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              {showSeasonEpisode && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="mb-4">
                      <label className="block text-xs text-[#D1C4E9] mb-2 font-medium">Season</label>
                      <select value={releaseSeason} onChange={e => handleReleaseSeasonChange(e.target.value)} className={selectClass}>
                        <option value="">Select Season</option>
                        {releaseSeasons.map(s => <option key={s.index} value={s.index}>{s.name}</option>)}
                      </select>
                    </div>
                    <div className="mb-4">
                      <label className="block text-xs text-[#D1C4E9] mb-2 font-medium">Episode</label>
                      <select value={releaseEpisode} onChange={e => setReleaseEpisode(e.target.value)} className={selectClass}>
                        <option value="">Select Episode</option>
                        {releaseEpisodes.map(ep => <option key={ep.index} value={ep.index}>{ep.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <button onClick={addNewRelease} className={`${btnPrimary} w-full py-4 text-[15px] font-semibold flex items-center justify-center gap-2 mt-2.5`}>
                    <Plus size={18} /> Add as New Episode Release
                  </button>
                </>
              )}
            </div>

            <div className={`${glassCard} relative z-10 p-4`}>
              <h3 className="text-sm font-semibold mb-3.5 flex items-center gap-2">
                📋 Active New Releases ({releasesData.length})
              </h3>
              <div className="relative mb-3">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-purple-500" />
                <input
                  value={releaseSearchQuery}
                  onChange={e => setReleaseSearchQuery(e.target.value)}
                  className={`${inputClass} pl-9`}
                  placeholder="🔍 সার্চ করুন (টাইটেল, এপিসোড)..."
                />
              </div>
              {(() => {
                const filtered = releasesData.filter(r => {
                  if (!releaseSearchQuery.trim()) return true;
                  const q = releaseSearchQuery.toLowerCase();
                  const title = (r.title || '').toLowerCase();
                  const epInfo = r.episodeInfo ? `${r.episodeInfo.seasonName || ''} episode ${r.episodeInfo.episodeNumber || ''}`.toLowerCase() : '';
                  return title.includes(q) || epInfo.includes(q);
                });
                return filtered.length === 0 ? (
                <p className="text-[#957DAD] text-[13px] text-center py-5">{releaseSearchQuery ? 'কোনো রিলিজ পাওয়া যায়নি' : 'No new releases yet'}</p>
              ) : filtered.map(release => {
                let episodeText = "";
                if (release.episodeInfo) {
                  episodeText = release.episodeInfo.type === "movie" ? "Movie" : `${release.episodeInfo.seasonName} - Episode ${release.episodeInfo.episodeNumber}`;
                }
                return (
                  <div key={release.id} className="bg-[#1A1A2E] border border-purple-500/30 rounded-xl p-4 mb-3">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <span className="bg-gradient-to-r from-pink-500 to-pink-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-[10px] inline-flex items-center gap-1">
                          <Zap size={10} /> NEW
                        </span>
                        <span className="text-[11px] text-[#957DAD] ml-2.5">{formatTime(release.timestamp)}</span>
                      </div>
                      <div className="flex gap-1.5">
                        <button onClick={() => toggleReleaseStatus(release.id, release.active)} className={`${release.active ? "text-purple-500" : "text-[#957DAD]"}`}>
                          {release.active ? <Eye size={14} /> : <EyeOff size={14} />}
                        </button>
                        <button onClick={() => deleteRelease(release.id)} className="text-[#957DAD] hover:text-red-400 transition-colors">
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                    <div className="flex gap-3 items-center">
                      <img src={release.poster || ""} className="w-[50px] h-[75px] rounded-lg object-cover"
                        onError={e => { (e.target as HTMLImageElement).src = "https://via.placeholder.com/50x75/1A1A2E/9D4EDD?text=N"; }} />
                      <div className="flex-1">
                        <h4 className="text-[13px] font-semibold mb-1">{release.title || "Untitled"}</h4>
                        <p className="text-[11px] text-[#D1C4E9]">{release.year || "N/A"} • {release.rating || "N/A"}★</p>
                        {episodeText && <p className="text-[11px] text-pink-500 mt-0.5">{episodeText}</p>}
                      </div>
                    </div>
                  </div>
                );
              });
              })()}
            </div>
          </div>
        )}

        {/* ==================== TMDB FETCH ==================== */}
        {activeSection === "tmdb-fetch" && (
          <div>
            <div className={`${glassCard} p-4 mb-4`}>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <CloudDownload size={14} className="text-indigo-400" /> Quick TMDB Fetch by ID
              </h3>
              <div className="flex gap-2 mb-3">
                <button onClick={() => setFetchType("movie")} className={`flex-shrink-0 px-4 py-2 rounded-lg text-[13px] font-medium transition-colors ${fetchType === "movie" ? "bg-indigo-600 text-white" : "bg-[#141422] border border-white/8 text-zinc-400"}`}>
                  Movie
                </button>
                <button onClick={() => setFetchType("tv")} className={`flex-shrink-0 px-4 py-2 rounded-lg text-[13px] font-medium transition-colors ${fetchType === "tv" ? "bg-indigo-600 text-white" : "bg-[#141422] border border-white/8 text-zinc-400"}`}>
                  TV Series
                </button>
              </div>
              <div className="flex gap-2.5">
                <input value={quickTmdbId} onChange={e => setQuickTmdbId(e.target.value)} onKeyDown={e => e.key === "Enter" && quickFetch()}
                  className={`${inputClass} flex-1`} placeholder="Enter TMDB ID" />
                <button onClick={quickFetch} className={`${btnPrimary} px-4 py-3.5`}><Download size={16} /></button>
              </div>
            </div>
          </div>
        )}

        {/* ==================== AUTO IMPORT ==================== */}
        {activeSection === "auto-import" && (
          <AutoImportSection
            glassCard={glassCard}
            inputClass={inputClass}
            btnPrimary={btnPrimary}
            btnSecondary={btnSecondary}
            categoryList={categoryList}
            languageOptions={languageOptions}
            webseriesData={webseriesData}
            moviesData={moviesData}
            selectClass={selectClass}
          />
        )}

        {activeSection === "animesalt-manager" && (
          <AnimeSaltManagerSection
            glassCard={glassCard}
            inputClass={inputClass}
            btnPrimary={btnPrimary}
            btnSecondary={btnSecondary}
            categoryList={categoryList}
            selectClass={selectClass}
          />
        )}

        {/* ==================== ADD CONTENT ==================== */}
        {activeSection === "add-content" && (
          <div>
            <div className={`${glassCard} p-6 mb-4`}>
              <h3 className="text-base font-semibold text-center mb-6">What would you like to add?</h3>
              <div className="flex flex-col gap-3">
                {[
                  { icon: <Film size={20} />, label: "Web Series", desc: "Add TV shows with seasons & episodes", action: () => { showSection("webseries"); setSeriesTab("ws-add"); } },
                  { icon: <Video size={20} />, label: "Movie", desc: "Add movies with streaming links", action: () => { showSection("movies"); setMoviesTab("mv-add"); } },
                  { icon: <FolderOpen size={20} />, label: "Category", desc: "Manage content categories", action: () => showSection("categories") },
                ].map((item, i) => (
                  <button key={i} onClick={item.action} className={`${btnSecondary} p-5 rounded-[14px] flex items-center gap-4 text-left`}>
                    <div className="w-[50px] h-[50px] bg-purple-500/20 rounded-xl flex items-center justify-center text-purple-500">{item.icon}</div>
                    <div>
                      <div className="text-[15px] font-semibold">{item.label}</div>
                      <div className="text-[11px] text-[#D1C4E9]">{item.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ==================== REDEEM CODES ==================== */}
        {activeSection === "redeem-codes" && (
          <div>
            <div className={`${glassCard} p-4 mb-4`}>
              <h3 className="text-sm font-semibold mb-3.5 flex items-center gap-2">
                <Shield size={14} className="text-purple-500" /> Generate Redeem Code
              </h3>
              <div className="space-y-3">
                <div>
                  <label className="text-[11px] text-[#D1C4E9] mb-1 block">Duration (Days)</label>
                  <input value={newCodeDays} onChange={e => setNewCodeDays(e.target.value)} className={inputClass} placeholder="30" type="number" />
                </div>
                <div>
                  <label className="text-[11px] text-[#D1C4E9] mb-1 block">Note (Optional)</label>
                  <input value={newCodeNote} onChange={e => setNewCodeNote(e.target.value)} className={inputClass} placeholder="e.g. For user XYZ" />
                </div>
                <button onClick={() => {
                  const days = parseInt(newCodeDays) || 30;
                  const code = "RS-" + Math.random().toString(36).substring(2, 8).toUpperCase() + "-" + Math.random().toString(36).substring(2, 6).toUpperCase();
                  const codeData = {
                    code,
                    days,
                    note: newCodeNote,
                    used: false,
                    usedBy: null,
                    createdAt: Date.now(),
                  };
                  set(push(ref(db, "redeemCodes")), codeData)
                    .then(() => { toast.success(`Code generated: ${code}`); setNewCodeNote(""); })
                    .catch(err => toast.error("Error: " + err.message));
                }} className={`${btnPrimary} w-full py-3.5 flex items-center justify-center gap-2`}>
                  <PlusCircle size={16} /> Generate Code
                </button>
              </div>
            </div>

            <div className={`${glassCard} p-4`}>
              <h3 className="text-sm font-semibold mb-3.5">All Codes ({redeemCodesData.length})</h3>
              <div className="space-y-2.5">
                {redeemCodesData.length === 0 && <p className="text-center text-[#957DAD] text-sm py-6">No redeem codes yet</p>}
                {redeemCodesData.sort((a, b) => b.createdAt - a.createdAt).map(code => (
                  <div key={code.id} className={`p-3 rounded-xl border transition-all ${code.used ? "bg-red-500/10 border-red-500/30" : "bg-green-500/10 border-green-500/30"}`}>
                    <div className="flex justify-between items-start mb-1.5">
                      <span className="text-sm font-mono font-bold tracking-wider">{code.code}</span>
                      <div className="flex gap-1.5">
                        <button onClick={() => { navigator.clipboard.writeText(code.code); toast.success("Copied!"); }}
                          className="text-[10px] bg-purple-500/20 px-2 py-1 rounded-full hover:bg-purple-500/40 transition-all">Copy</button>
                        <button onClick={() => { if (confirm("Delete this code?")) remove(ref(db, `redeemCodes/${code.id}`)).then(() => toast.success("Deleted")); }}
                          className="text-[10px] bg-red-500/20 px-2 py-1 rounded-full hover:bg-red-500/40 transition-all text-red-400">
                          <Trash2 size={10} />
                        </button>
                      </div>
                    </div>
                    <div className="text-[10px] text-[#D1C4E9] space-y-0.5">
                      <p>{code.days} days • {code.used ? `Used by ${code.usedBy}` : "Available"}</p>
                      {code.note && <p>Note: {code.note}</p>}
                      <p>{formatTime(code.createdAt)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ==================== BKASH PAYMENTS ==================== */}
        {activeSection === "bkash-payments" && (
          <div>
            {/* Settings Card */}
            <div className={`${glassCard} p-4 mb-4`}>
              <h3 className="text-sm font-semibold mb-3.5 flex items-center gap-2">
                <Settings size={14} className="text-pink-500" /> bKash সেটিংস
              </h3>
              <div className="space-y-3">
                <div>
                  <label className="text-[11px] text-zinc-400 mb-1 block">bKash নাম্বার</label>
                  <input value={bkashSettings.phoneNumber || ""} onChange={e => setBkashSettings((p: any) => ({ ...p, phoneNumber: e.target.value }))} className={inputClass} placeholder="01XXXXXXXXX" />
                </div>
                <div>
                  <label className="text-[11px] text-zinc-400 mb-1 block">অ্যাকাউন্ট টাইপ</label>
                  <select value={bkashSettings.accountType || "Agent"} onChange={e => setBkashSettings((p: any) => ({ ...p, accountType: e.target.value }))} className={selectClass}>
                    <option value="Agent">Agent</option>
                    <option value="Personal">Personal</option>
                    <option value="Merchant">Merchant</option>
                  </select>
                </div>
                <div>
                  <label className="text-[11px] text-zinc-400 mb-1 block">QR কোড লিংক (ছবির URL)</label>
                  <input value={bkashSettings.qrCodeLink || ""} onChange={e => setBkashSettings((p: any) => ({ ...p, qrCodeLink: e.target.value }))} className={inputClass} placeholder="https://example.com/qr.png" />
                </div>
                <div>
                  <label className="text-[11px] text-zinc-400 mb-1 block">নির্দেশনা (ইউজারদের জন্য)</label>
                  <textarea value={bkashSettings.instructions || ""} onChange={e => setBkashSettings((p: any) => ({ ...p, instructions: e.target.value }))} className={inputClass + " min-h-[80px] resize-none"} placeholder="Send Money করুন..." />
                </div>

                {/* Plans */}
                <div>
                  <label className="text-[11px] text-zinc-400 mb-2 block font-semibold">সাবস্ক্রিপশন প্ল্যান (৩টি)</label>
                  {(bkashSettings.plans || []).map((plan: any, idx: number) => (
                    <div key={plan.id || idx} className="bg-[#141422] rounded-lg p-3 mb-2 border border-white/6">
                      <div className="grid grid-cols-2 gap-2 mb-2">
                        <div>
                          <label className="text-[10px] text-zinc-500 block">প্ল্যান নাম</label>
                          <input value={plan.name} onChange={e => {
                            const plans = [...(bkashSettings.plans || [])];
                            plans[idx] = { ...plans[idx], name: e.target.value };
                            setBkashSettings((p: any) => ({ ...p, plans }));
                          }} className={inputClass + " !py-1.5 !text-xs"} />
                        </div>
                        <div>
                          <label className="text-[10px] text-zinc-500 block">দাম (৳)</label>
                          <input type="number" value={plan.price} onChange={e => {
                            const plans = [...(bkashSettings.plans || [])];
                            plans[idx] = { ...plans[idx], price: Number(e.target.value) };
                            setBkashSettings((p: any) => ({ ...p, plans }));
                          }} className={inputClass + " !py-1.5 !text-xs"} />
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="text-[10px] text-zinc-500 block">দিন</label>
                          <input type="number" value={plan.days} onChange={e => {
                            const plans = [...(bkashSettings.plans || [])];
                            plans[idx] = { ...plans[idx], days: Number(e.target.value) };
                            setBkashSettings((p: any) => ({ ...p, plans }));
                          }} className={inputClass + " !py-1.5 !text-xs"} />
                        </div>
                        <div>
                          <label className="text-[10px] text-zinc-500 block">ডিভাইস</label>
                          <input type="number" value={plan.maxDevices || 1} onChange={e => {
                            const plans = [...(bkashSettings.plans || [])];
                            plans[idx] = { ...plans[idx], maxDevices: Number(e.target.value) || 1 };
                            setBkashSettings((p: any) => ({ ...p, plans }));
                          }} className={inputClass + " !py-1.5 !text-xs"} min="1" max="10" />
                        </div>
                        <div className="flex items-end">
                          <label className="flex items-center gap-2 cursor-pointer text-xs">
                            <input type="checkbox" checked={plan.active !== false} onChange={e => {
                              const plans = [...(bkashSettings.plans || [])];
                              plans[idx] = { ...plans[idx], active: e.target.checked };
                              setBkashSettings((p: any) => ({ ...p, plans }));
                            }} className="accent-indigo-500" />
                            সক্রিয়
                          </label>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <button onClick={() => {
                  set(ref(db, "bkashSettings"), bkashSettings)
                    .then(() => toast.success("bKash সেটিংস সেভ হয়েছে"))
                    .catch(err => toast.error("Error: " + err.message));
                }} className={`${btnPrimary} w-full py-3.5 flex items-center justify-center gap-2`}>
                  <Save size={16} /> সেটিংস সেভ করুন
                </button>
              </div>
            </div>

            {/* Payment Requests */}
            <div className={`${glassCard} p-4`}>
              <h3 className="text-sm font-semibold mb-3.5 flex items-center gap-2">
                <List size={14} className="text-green-500" /> পেমেন্ট রিকোয়েস্ট ({bkashPaymentRequests.filter((r: any) => r.status === "pending").length} পেন্ডিং)
              </h3>
              <div className="space-y-2.5">
                {bkashPaymentRequests.length === 0 && <p className="text-center text-zinc-500 text-sm py-6">কোন পেমেন্ট রিকোয়েস্ট নেই</p>}
                {bkashPaymentRequests.map((req: any) => (
                  <div key={req.id} className={`p-3 rounded-xl border transition-colors ${
                    req.status === "approved" ? "bg-green-500/10 border-green-500/30" :
                    req.status === "rejected" ? "bg-red-500/10 border-red-500/30" :
                    "bg-yellow-500/10 border-yellow-500/30"
                  }`}>
                    <div className="flex justify-between items-start mb-1.5">
                      <div>
                        <p className="text-sm font-semibold">{req.userName || "Unknown User"}</p>
                        <p className="text-[10px] text-zinc-400">{req.userEmail || req.userId}</p>
                      </div>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                        req.status === "approved" ? "bg-green-500/20 text-green-400" :
                        req.status === "rejected" ? "bg-red-500/20 text-red-400" :
                        "bg-yellow-500/20 text-yellow-400"
                      }`}>{req.status === "approved" ? "✅ Approved" : req.status === "rejected" ? "❌ Rejected" : "⏳ Pending"}</span>
                    </div>
                    <div className="text-[11px] text-zinc-400 space-y-0.5 mb-2">
                      <p>📱 TrxID: <span className="font-mono font-bold text-white">{req.transactionId}</span></p>
                      <p>💰 প্ল্যান: {req.planName} — ৳{req.planPrice}</p>
                      <p>📅 {new Date(req.submittedAt).toLocaleString("bn-BD")}</p>
                      {req.bkashNumber && <p>📞 bKash: {req.bkashNumber}</p>}
                    </div>
                    {req.status === "pending" && (
                      <div className="flex gap-2">
                        <button onClick={async () => {
                          const days = req.planDays || 30;
                          const maxDevices = (() => {
                            const plan = (bkashSettings.plans || []).find((p: any) => p.id === req.planId);
                            return plan?.maxDevices || (days <= 30 ? 1 : days <= 90 ? 3 : 4);
                          })();
                          const expiresAt = Date.now() + days * 24 * 60 * 60 * 1000;
                          await set(ref(db, `users/${req.userId}/premium`), { active: true, expiresAt, redeemedAt: Date.now(), method: "bkash", transactionId: req.transactionId, maxDevices });
                          await update(ref(db, `bkashPayments/${req.id}`), { status: "approved", approvedAt: Date.now() });
                          // Send notification to user
                          const userNotifRef = push(ref(db, `notifications/${req.userId}`));
                          await set(userNotifRef, {
                            title: "Premium Activated! 🎉",
                            message: `আপনার ${req.planName} প্ল্যান অ্যাক্টিভেট হয়েছে। ${days} দিন Ad-free উপভোগ করুন!`,
                            type: "success",
                            timestamp: Date.now(),
                            read: false,
                          });
                          toast.success(`${req.userName} এর প্রিমিয়াম অ্যাক্টিভেট হয়েছে (${days} দিন)`);
                        }} className="flex-1 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white text-xs font-semibold flex items-center justify-center gap-1 transition-colors">
                          <Check size={12} /> Approve
                        </button>
                        <button onClick={async () => {
                          await update(ref(db, `bkashPayments/${req.id}`), { status: "rejected", rejectedAt: Date.now() });
                          const userNotifRef = push(ref(db, `notifications/${req.userId}`));
                          await set(userNotifRef, {
                            title: "Payment Rejected ❌",
                            message: "আপনার পেমেন্ট রিকোয়েস্ট গ্রহণ হয়নি। সঠিক Transaction ID দিয়ে আবার চেষ্টা করুন।",
                            type: "error",
                            timestamp: Date.now(),
                            read: false,
                          });
                          toast.success("রিকোয়েস্ট রিজেক্ট করা হয়েছে");
                        }} className="flex-1 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-semibold flex items-center justify-center gap-1 transition-colors">
                          <X size={12} /> Reject
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ==================== DEVICE LIMITS ==================== */}
        {activeSection === "device-limits" && (
          <DeviceLimitsSection glassCard={glassCard} inputClass={inputClass} btnPrimary={btnPrimary} btnSecondary={btnSecondary} usersData={usersData} formatTime={formatTime} />
        )}

        {/* ==================== TELEGRAM POST ==================== */}
        {activeSection === "telegram-post" && (
          <div>
            <div className={`${glassCard} relative z-[120] overflow-visible p-4 mb-4`}>
              <h3 className="text-sm font-semibold mb-3.5 flex items-center gap-2">
                <Send size={14} className="text-blue-400" /> টেলিগ্রাম পোস্ট তৈরি করুন
              </h3>
              <p className="text-[11px] text-zinc-400 mb-4">
                নিউ রিলিজ থেকে সিলেক্ট করুন অথবা ম্যানুয়ালি ফিল্ড পূরণ করুন।
              </p>
              <div className="mb-4" ref={tgDropdownRef}>
                <label className="block text-xs text-zinc-400 mb-2 font-medium">রিলিজ থেকে সিলেক্ট (ঐচ্ছিক)</label>
                <div className="relative z-[130]">
                  <button type="button" onClick={() => setTgDropdownOpen(!tgDropdownOpen)}
                    className={`${selectClass} w-full text-left flex items-center gap-2`}>
                    {tgSelectedRelease ? (
                      <span className="truncate text-sm">{releasesData.find(r => r.id === tgSelectedRelease)?.title || "Selected"}</span>
                    ) : <span className="text-zinc-500">রিলিজ সিলেক্ট করুন...</span>}
                    <ChevronDown size={14} className="ml-auto flex-shrink-0" />
                  </button>
                  {tgDropdownOpen && (
                    <div className="absolute z-[200] top-full left-0 right-0 mt-1 bg-[#16162A] border border-white/10 rounded-xl max-h-[280px] overflow-hidden flex flex-col">
                      <div className="p-2 border-b border-white/10 flex-shrink-0">
                        <input value={tgContentSearch} onChange={e => setTgContentSearch(e.target.value)}
                          className="w-full px-3 py-2 bg-[#141422] border border-white/10 rounded-lg text-white text-[12px] focus:border-blue-500 focus:outline-none placeholder:text-zinc-500"
                          placeholder="🔍 সার্চ করুন..." autoFocus onClick={e => e.stopPropagation()} />
                      </div>
                      <div className="overflow-y-auto max-h-[220px]">
                        {releasesData.filter(r => !tgContentSearch.trim() || (r.title || '').toLowerCase().includes(tgContentSearch.toLowerCase())).map(r => (
                          <div key={r.id} className={`flex items-center gap-2.5 p-2 cursor-pointer hover:bg-blue-500/20 rounded-lg m-1 ${tgSelectedRelease === r.id ? "bg-blue-500/30" : ""}`}
                            onClick={() => { fillTelegramFromRelease(r.id); setTgDropdownOpen(false); setTgContentSearch(''); }}>
                            <img src={r.poster} alt="" className="w-8 h-11 rounded object-cover flex-shrink-0 bg-[#1E1E32]" />
                            <div className="flex-1 min-w-0">
                              <span className="text-sm truncate block">{r.title}</span>
                              {r.episodeInfo && <span className="text-[10px] text-zinc-500">{r.episodeInfo.seasonName} EP{r.episodeInfo.episodeNumber}</span>}
                            </div>
                          </div>
                        ))}
                        {releasesData.length === 0 && <p className="text-zinc-500 text-[11px] text-center py-4">কোনো রিলিজ নেই</p>}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1.5">চ্যানেল আইডি (কমা দিয়ে একাধিক)</label>
                  <textarea value={tgChannelId} onChange={e => setTgChannelId(e.target.value)} onBlur={e => { try { set(ref(db, "admin/telegramChannel"), e.target.value.trim()); } catch {} }} className={`${inputClass} min-h-[60px] resize-y`} placeholder={`${TELEGRAM_CHANNEL}, @channel2, -1001234567890`} rows={2} />
                  <p className="text-[10px] text-zinc-500 mt-1">একাধিক চ্যানেলে পাঠাতে কমা দিয়ে আলাদা করুন</p>
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1.5">টাইটেল *</label>
                  <input value={tgTitle} onChange={e => setTgTitle(e.target.value)} className={inputClass} placeholder="Anime Title" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1.5">সিজন</label>
                    <input value={tgSeason} onChange={e => setTgSeason(e.target.value)} className={inputClass} placeholder="Season 01" />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1.5">মোট এপিসোড</label>
                    <input value={tgTotalEpisodes} onChange={e => setTgTotalEpisodes(e.target.value)} className={inputClass} placeholder="12" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1.5">কোয়ালিটি</label>
                    <input value={tgQuality} onChange={e => setTgQuality(e.target.value)} className={inputClass} placeholder="480p,720p,1080p" />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1.5">নতুন এপিসোড</label>
                    <input value={tgNewEpAdded} onChange={e => setTgNewEpAdded(e.target.value)} className={inputClass} placeholder="02" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1.5">অডিও টাইপ</label>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setTgDubType("official")}
                      className={`flex-1 py-2.5 rounded-lg text-[12px] font-semibold border transition-all ${tgDubType === "official" ? "bg-indigo-600 border-indigo-500 text-white" : "bg-[#141422] border-white/8 text-zinc-400"}`}>
                      𝐎𝐟𝐟𝐢𝐜𝐢𝐚𝐥𝐝𝐮𝐛
                    </button>
                    <button type="button" onClick={() => setTgDubType("fandub")}
                      className={`flex-1 py-2.5 rounded-lg text-[12px] font-semibold border transition-all ${tgDubType === "fandub" ? "bg-orange-600 border-orange-500 text-white" : "bg-[#141422] border-white/8 text-zinc-400"}`}>
                      𝐅𝐚𝐧𝐝𝐮𝐛
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1.5">পোস্টার URL (ঐচ্ছিক)</label>
                  <input value={tgPosterUrl} onChange={e => setTgPosterUrl(e.target.value)} className={inputClass} placeholder="https://image.tmdb.org/..." />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1.5">ডাউনলোড/ওয়াচ লিংক (ঐচ্ছিক)</label>
                  <input value={tgButtonLink} onChange={e => setTgButtonLink(e.target.value)} className={inputClass} placeholder={SITE_URL} />
                </div>
              </div>
            </div>

            {/* Preview */}
            <div className={`${glassCard} p-4 mb-4`}>
              <h3 className="text-sm font-semibold mb-3.5 flex items-center gap-2">
                <Eye size={14} className="text-green-400" /> প্রিভিউ
              </h3>
              <div className="bg-[#0E1621] rounded-xl p-4 border border-white/5">
                {tgPosterUrl && (
                  <img src={tgPosterUrl} alt="poster" className="w-full h-[200px] object-cover rounded-lg mb-3"
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                )}
                <div className="font-mono text-[12px] text-zinc-300 whitespace-pre-line leading-relaxed">
{`Tɪᴛʟᴇ'- ${tgTitle || '{title}'}
╭━━━━━━━━━━━━━━━━━━➣
┣✧ Sᴇᴀsᴏɴ : ${tgSeason || '{season}'}
┣✧ Eᴘɪsᴏᴅᴇs: ${tgTotalEpisodes || '{total}'}
┣✧ Qᴜᴀʟɪᴛʏ : ${tgQuality || '{quality}'} ˚.⋆
┣✧ Aᴜᴅɪᴏ : Hɪɴᴅɪ Dᴜʙ ! ${tgDubType === "fandub" ? "#ғᴀɴᴅᴜʙ" : "#ᴏғғɪᴄɪᴀʟ"}
┣✧ Eᴘɪsᴏᴅᴇ Aᴅᴅᴇᴅ : ${tgNewEpAdded || '{new}'}
╰━━━━━━━━━━━━━━━━━━➣
Pᴏᴡᴇʀ Bʏ : 
𓆩 ${TELEGRAM_CHANNEL} 𓆪`}
                </div>
                {tgButtonLink && (
                  <div className="mt-3 bg-blue-500/20 border border-blue-500/40 rounded-lg py-2.5 text-center text-[12px] font-bold text-blue-300">
                    📥 𝐖𝐀𝐓𝐂𝐇 𝐀𝐍𝐃 𝐃𝐎𝐖𝐍𝐋𝐎𝐀𝐃 📥
                  </div>
                )}
              </div>
            </div>

            <button onClick={sendTelegramPost} disabled={tgSending || !tgTitle.trim()}
              className={`${btnPrimary} w-full py-4 text-[15px] font-semibold flex items-center justify-center gap-2 disabled:opacity-50`}>
              {tgSending ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                  পাঠানো হচ্ছে...
                </>
              ) : (
                <>
                  <Send size={18} /> টেলিগ্রামে পোস্ট পাঠান
                </>
              )}
            </button>
          </div>
        )}

        {activeSection === "free-access" && (
          <div>
            {/* Global Free Access for All */}
            <div className={`${glassCard} p-4 mb-4`}>
              <h3 className="text-sm font-semibold mb-3.5 flex items-center gap-2">
                <Zap size={14} className="text-yellow-500" /> Free Access for All Users
              </h3>
              <p className="text-[11px] text-[#D1C4E9] mb-4">
                সব ইউজারকে নির্দিষ্ট সময়ের জন্য ফ্রী এক্সেস দিন। এই সময়ের মধ্যে কোনো অ্যাড গেট থাকবে না।
              </p>

              {/* Current status */}
              {globalFreeAccess?.active && globalFreeAccess?.expiresAt > Date.now() ? (
                <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-green-400 flex items-center gap-2">
                      <Zap size={14} /> গ্লোবাল ফ্রী এক্সেস অ্যাক্টিভ
                    </span>
                    <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">LIVE</span>
                  </div>
                  <div className="text-[11px] text-[#D1C4E9] space-y-1">
                    <p>শুরু: {new Date(globalFreeAccess.activatedAt).toLocaleString("bn-BD", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
                    <p>শেষ: {new Date(globalFreeAccess.expiresAt).toLocaleString("bn-BD", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
                    {(() => {
                      const rem = globalFreeAccess.expiresAt - Date.now();
                      const h = Math.floor(rem / 3600000);
                      const m = Math.floor((rem % 3600000) / 60000);
                      return <p className="text-green-400 font-semibold">বাকি: {h}h {m}m</p>;
                    })()}
                  </div>
                  <button
                    onClick={() => {
                      if (confirm("গ্লোবাল ফ্রী এক্সেস বন্ধ করতে চান?")) {
                        set(ref(db, "globalFreeAccess"), { active: false, expiresAt: 0, activatedAt: 0 })
                          .then(() => toast.success("গ্লোবাল ফ্রী এক্সেস বন্ধ করা হয়েছে"))
                          .catch((err) => toast.error("Error: " + err.message));
                      }
                    }}
                    className={`${btnSecondary} mt-3 w-full py-2.5 text-sm flex items-center justify-center gap-2 text-red-400 border-red-500/30 hover:border-red-500`}
                  >
                    <X size={14} /> ফ্রী এক্সেস বন্ধ করুন
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="text-[11px] text-[#957DAD] mb-1 block">ঘন্টা</label>
                      <input
                        type="number"
                        min="0"
                        max="720"
                        value={globalFreeHours}
                        onChange={(e) => setGlobalFreeHours(e.target.value)}
                        className={inputClass}
                        placeholder="2"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="text-[11px] text-[#957DAD] mb-1 block">মিনিট</label>
                      <input
                        type="number"
                        min="0"
                        max="59"
                        value={globalFreeMinutes}
                        onChange={(e) => setGlobalFreeMinutes(e.target.value)}
                        className={inputClass}
                        placeholder="0"
                      />
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      const hours = parseInt(globalFreeHours) || 0;
                      const minutes = parseInt(globalFreeMinutes) || 0;
                      const totalMs = (hours * 3600000) + (minutes * 60000);
                      if (totalMs < 60000) {
                        toast.error("কমপক্ষে ১ মিনিট সময় দিন");
                        return;
                      }
                      if (!confirm(`সব ইউজারকে ${hours > 0 ? hours + " ঘন্টা " : ""}${minutes > 0 ? minutes + " মিনিট " : ""}ফ্রী এক্সেস দিতে চান?`)) return;
                      const now = Date.now();
                      set(ref(db, "globalFreeAccess"), {
                        active: true,
                        activatedAt: now,
                        expiresAt: now + totalMs,
                      })
                        .then(() => toast.success("গ্লোবাল ফ্রী এক্সেস চালু হয়েছে!"))
                        .catch((err) => toast.error("Error: " + err.message));
                    }}
                    className={`${btnPrimary} w-full py-3 text-sm flex items-center justify-center gap-2`}
                  >
                    <Zap size={14} /> সব ইউজারকে ফ্রী এক্সেস দিন
                  </button>
                </div>
              )}
            </div>

            <div className={`${glassCard} p-4 mb-4`}>
              <h3 className="text-sm font-semibold mb-3.5 flex items-center gap-2">
                <Eye size={14} className="text-green-500" /> Active Free Access Users ({freeAccessUsers.length})
              </h3>
              <p className="text-[11px] text-[#D1C4E9] mb-4">
                যারা AroLinks অ্যাড গেট দিয়ে ফ্রী ২৪ ঘন্টার এক্সেস নিয়েছে তাদের লিস্ট। এক্সেস শেষ হলে স্বয়ংক্রিয়ভাবে মুছে যাবে।
              </p>
              {freeAccessUsers.length === 0 ? (
                <p className="text-[#957DAD] text-[13px] text-center py-8">কোনো অ্যাক্টিভ ফ্রী এক্সেস ইউজার নেই</p>
              ) : (
                <div className="space-y-2.5">
                  {freeAccessUsers.map((user) => {
                    const remaining = user.expiresAt - Date.now();
                    const hours = Math.floor(remaining / 3600000);
                    const minutes = Math.floor((remaining % 3600000) / 60000);
                    return (
                      <div key={user.id} className="bg-[#1A1A2E] border border-green-500/20 rounded-xl p-4">
                        <div className="flex items-center gap-3">
                          <div className="w-[42px] h-[42px] rounded-full bg-gradient-to-br from-green-500 to-green-700 flex items-center justify-center font-bold text-lg flex-shrink-0">
                            {(user.name || "U")[0].toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold truncate">{user.name || "Unknown"}</p>
                            <p className="text-[11px] text-[#D1C4E9] truncate">{user.email || "No email"}</p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <div className="bg-green-500/15 border border-green-500/30 px-2.5 py-1 rounded-full">
                              <span className="text-[11px] font-bold text-green-400">{hours}h {minutes}m</span>
                            </div>
                          </div>
                        </div>
                        <div className="mt-2.5 flex justify-between items-center text-[10px] text-[#957DAD]">
                          <span>আনলক: {new Date(user.unlockedAt).toLocaleString("bn-BD", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                          <span>শেষ: {new Date(user.expiresAt).toLocaleString("bn-BD", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ==================== UI THEMES ==================== */}
        {activeSection === "ui-themes" && (
          <UIThemesSection glassCard={glassCard} btnPrimary={btnPrimary} />
        )}

        {/* ==================== HERO PINNED POSTS ==================== */}
        {activeSection === "hero-pinned" && (
          <HeroPinnedPostsSection
            glassCard={glassCard}
            inputClass={inputClass}
            btnPrimary={btnPrimary}
            btnSecondary={btnSecondary}
            webseriesData={webseriesData}
            moviesData={moviesData}
            animesaltSelectedData={animesaltSelectedData}
          />
        )}

        {/* ==================== SETTINGS ==================== */}
        {activeSection === "settings" && (
          <div>
            {/* Admin User ID for Notifications */}
            <div className={`${glassCard} p-4 mb-4`}>
              <h3 className="text-sm font-semibold mb-3.5 flex items-center gap-2">
                <Bell size={14} className="text-yellow-500" /> অ্যাডমিন নোটিফিকেশন সেটিং
              </h3>
              <p className="text-[11px] text-[#D1C4E9] mb-4">
                ইউজার bKash পেমেন্ট সাবমিট করলে আপনার কাছে পুশ নোটিফিকেশন আসবে। আপনার User ID দিন (Firebase Auth UID)।
                এটি পেতে Users সেকশনে গিয়ে আপনার একাউন্ট খুঁজুন।
              </p>
              <div className="flex gap-2">
                <input
                  value={adminUserIdInput}
                  onChange={(e) => setAdminUserIdInput(e.target.value)}
                  placeholder="আপনার User ID (Firebase UID)"
                  className={`${inputClass} flex-1`}
                />
                <button
                  onClick={async () => {
                    if (!adminUserIdInput.trim()) {
                      toast.error("User ID দিন");
                      return;
                    }
                    try {
                      await set(ref(db, "admin/userId"), adminUserIdInput.trim());
                      toast.success("Admin User ID সেভ হয়েছে! এখন পেমেন্ট নোটিফিকেশন পাবেন।");
                    } catch (err) {
                      toast.error("Failed to save");
                    }
                  }}
                  className={`${btnPrimary} !px-4`}
                >
                  <Save size={14} /> Save
                </button>
              </div>
              {savedAdminUserId && (
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-[11px] text-green-400">✓ Active:</span>
                  <span className="text-[11px] text-zinc-400 font-mono truncate max-w-[250px]">{savedAdminUserId}</span>
                </div>
              )}
              {!savedAdminUserId && (
                <div className="mt-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
                  <p className="text-[11px] text-yellow-400 flex items-center gap-1.5">
                    <AlertTriangle size={12} /> Admin User ID সেট না করলে পেমেন্ট নোটিফিকেশন আসবে না!
                  </p>
                </div>
              )}
            </div>

            <div className={`${glassCard} p-4 mb-4`}>
              <h3 className="text-sm font-semibold mb-3.5 flex items-center gap-2">
                <Link size={14} className="text-purple-400" /> Tutorial Video URL
              </h3>
              <p className="text-[11px] text-[#D1C4E9] mb-4">
                ফ্রি ইউজারদের Unlock বাটনের নিচে "How to open my link" বাটনে এই ভিডিওটি প্লে হবে। ভিডিও URL দিন (MP4 বা embed link)।
              </p>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={tutorialLinkInput}
                  onChange={(e) => setTutorialLinkInput(e.target.value)}
                  placeholder="https://example.com/tutorial-video.mp4"
                  className={`${inputClass} flex-1`}
                />
                <button
                  onClick={async () => {
                    if (!tutorialLinkInput.trim()) {
                      toast.error("Please enter a valid URL");
                      return;
                    }
                    try {
                      await set(ref(db, "settings/tutorialLink"), tutorialLinkInput.trim());
                      toast.success("Tutorial video link saved!");
                    } catch (err) {
                      console.error("Save failed:", err);
                      toast.error("Failed to save. Check Firebase rules.");
                    }
                  }}
                  className={`${btnPrimary} !px-4`}
                >
                  <Save size={14} /> Save
                </button>
              </div>
              {tutorialLink && (
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-[11px] text-green-400">✓ Active:</span>
                  <a href={tutorialLink} target="_blank" rel="noopener noreferrer" className="text-[11px] text-purple-400 underline truncate max-w-[250px]">{tutorialLink}</a>
                  <button
                    onClick={() => {
                      set(ref(db, "settings/tutorialLink"), null);
                      setTutorialLinkInput("");
                      toast.success("Tutorial link removed!");
                    }}
                    className="text-red-400 hover:text-red-300 ml-auto"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              )}
            </div>

            {/* Authorized Google Emails for Admin */}
            <div className={`${glassCard} p-4 mb-4`}>
              <h3 className="text-sm font-semibold mb-3.5 flex items-center gap-2">
                <Shield size={14} className="text-green-500" /> অ্যাডমিন Google অ্যাকাউন্ট
              </h3>
              <p className="text-[11px] text-zinc-400 mb-4">
                যেসব Google ইমেইল অ্যাডমিন প্যানেলে লগইন করতে পারবে সেগুলো এখানে যোগ করুন।
              </p>
              <AdminAuthorizedEmails glassCard={glassCard} inputClass={inputClass} btnPrimary={btnPrimary} btnSecondary={btnSecondary} />
            </div>

            {/* Telegram Channel Settings */}
            <div className={`${glassCard} p-4 mb-4`}>
              <h3 className="text-sm font-semibold mb-3.5 flex items-center gap-2">
                <Send size={14} className="text-blue-400" /> টেলিগ্রাম চ্যানেল সেটিং
              </h3>
              <div className="flex gap-2">
                <input
                  value={tgChannelId}
                  onChange={(e) => setTgChannelId(e.target.value)}
                  placeholder={TELEGRAM_CHANNEL}
                  className={`${inputClass} flex-1`}
                />
                <button
                  onClick={async () => {
                    try {
                      await set(ref(db, "admin/telegramChannel"), tgChannelId.trim());
                      toast.success("চ্যানেল সেভ হয়েছে!");
                    } catch { toast.error("সেভ ব্যর্থ"); }
                  }}
                  className={`${btnPrimary} !px-4`}
                >
                  <Save size={14} /> Save
                </button>
              </div>
            </div>

            {/* Force Notification Re-Prompt */}
            <div className={`${glassCard} p-4 mb-4`}>
              <h3 className="text-sm font-semibold mb-3.5 flex items-center gap-2">
                <Bell size={14} className="text-red-400" /> রি-নোটিফিকেশন প্রম্পট
              </h3>
              <p className="text-[11px] text-zinc-400 mb-3">
                এটি অন করলে সাইটে ভিজিট করা সব লগইনড ইউজারকে ব্রাউজার নোটিফিকেশন পারমিশন প্রম্পট দেখাবে। Allow করলে সাথে সাথে FCM টোকেন সেভ হবে এবং পুশ নোটিফিকেশন পাবে।
              </p>
              <ForceNotifToggle glassCard={glassCard} />
            </div>

            {/* Cloudflare CDN Toggle */}
            <div className={`${glassCard} p-4 mb-4`}>
              <h3 className="text-sm font-semibold mb-3.5 flex items-center gap-2">
                <Zap size={14} className="text-orange-400" /> Cloudflare CDN প্রক্সি
              </h3>
              <p className="text-[11px] text-zinc-400 mb-4">
                ভিডিও স্ট্রিমিং Cloudflare CDN দিয়ে প্রক্সি করা হবে কিনা। অন করলে সব ভিডিও Cloudflare Workers দিয়ে যাবে, অফ করলে সরাসরি সোর্স থেকে প্লে হবে।
              </p>
              <CdnToggle glassCard={glassCard} />
            </div>

            {/* Proxy Server Selector */}
            <div className={`${glassCard} p-4 mb-4`}>
              <h3 className="text-sm font-semibold mb-3.5 flex items-center gap-2">
                <Activity size={14} className="text-cyan-400" /> ভিডিও প্রক্সি সার্ভার
              </h3>
              <p className="text-[11px] text-zinc-400 mb-4">
                CDN বন্ধ থাকলে কোন প্রক্সি সার্ভার দিয়ে ভিডিও স্ট্রিম হবে সেটা সিলেক্ট করো। বিভিন্ন সার্ভার টেস্ট করে দেখো কোনটাতে ভালো স্পিড পাও।
              </p>
              <ProxyServerSelector glassCard={glassCard} />
            </div>

            {/* Image Refresh from TMDB */}
            <ImageRefreshSection
              glassCard={glassCard}
              btnPrimary={btnPrimary}
              webseriesData={webseriesData}
              moviesData={moviesData}
            />

            {/* Episode Name Refresh from TMDB */}
            <EpisodeNameRefreshSection
              glassCard={glassCard}
              btnPrimary={btnPrimary}
              webseriesData={webseriesData}
            />

            {/* Link Checker */}
            <LinkCheckerSection
              glassCard={glassCard}
              btnPrimary={btnPrimary}
              webseriesData={webseriesData}
              moviesData={moviesData}
            />
          </div>
        )}

        {/* ==================== EDGE FUNCTION ROUTER ==================== */}
        {activeSection === "edge-router" && (
          <EdgeRouterSection glassCard={glassCard} inputClass={inputClass} btnPrimary={btnPrimary} btnSecondary={btnSecondary} />
        )}

        {/* ==================== COMMENTS ==================== */}
        {activeSection === "comments" && (
          <AdminCommentsSection
            commentsData={commentsData}
            glassCard={glassCard}
            inputClass={inputClass}
            btnPrimary={btnPrimary}
            webseriesData={webseriesData}
            moviesData={moviesData}
          />
        )}

        {/* ==================== LIVE SUPPORT ==================== */}
        {activeSection === "live-support" && (
          <AdminLiveSupportSection glassCard={glassCard} inputClass={inputClass} btnPrimary={btnPrimary} />
        )}

        {/* ==================== MAINTENANCE ==================== */}
        {activeSection === "maintenance" && (
          <MaintenanceSection
            glassCard={glassCard}
            inputClass={inputClass}
            btnPrimary={btnPrimary}
            maintenanceActive={maintenanceActive}
            currentMaintenance={currentMaintenance}
            maintenanceMessage={maintenanceMessage}
            setMaintenanceMessage={setMaintenanceMessage}
            maintenanceResumeDate={maintenanceResumeDate}
            setMaintenanceResumeDate={setMaintenanceResumeDate}
          />
        )}

        {/* ==================== ANALYTICS ==================== */}
        {activeSection === "analytics" && (() => {
          const today = new Date().toISOString().split("T")[0];
          const todayViewers = dailyActiveUsers[today] ? Object.keys(dailyActiveUsers[today]).length : 0;

          const currentViewersList: { animeId: string; title: string; viewers: { uid: string; userName: string; startedAt: number }[] }[] = [];
          let totalCurrentViewers = 0;
          Object.entries(activeViewers).forEach(([aId, users]: [string, any]) => {
            const viewerArr: { uid: string; userName: string; startedAt: number }[] = [];
            Object.entries(users || {}).forEach(([uid, data]: [string, any]) => {
              viewerArr.push({ uid, userName: data.userName || "User", startedAt: data.startedAt || 0 });
            });
            if (viewerArr.length > 0) {
              const ws = webseriesData.find(w => w.id === aId);
              const mv = moviesData.find(m => m.id === aId);
              const cTitle = ws?.title || mv?.title || aId;
              currentViewersList.push({ animeId: aId, title: cTitle, viewers: viewerArr });
              totalCurrentViewers += viewerArr.length;
            }
          });
          currentViewersList.sort((a, b) => b.viewers.length - a.viewers.length);

          const contentViewStats: { animeId: string; title: string; viewCount: number; poster: string }[] = [];
          Object.entries(analyticsViews).forEach(([aId, dates]: [string, any]) => {
            const todayData = dates?.[today];
            if (todayData) {
              const count = Object.keys(todayData).length;
              const ws = webseriesData.find(w => w.id === aId);
              const mv = moviesData.find(m => m.id === aId);
              contentViewStats.push({ animeId: aId, title: ws?.title || mv?.title || aId, viewCount: count, poster: ws?.poster || mv?.poster || "" });
            }
          });
          contentViewStats.sort((a, b) => b.viewCount - a.viewCount);

          const allTimeStats: { animeId: string; title: string; totalViews: number; poster: string }[] = [];
          Object.entries(analyticsViews).forEach(([aId, dates]: [string, any]) => {
            let total = 0;
            Object.values(dates || {}).forEach((dayUsers: any) => { total += Object.keys(dayUsers || {}).length; });
            if (total > 0) {
              const ws = webseriesData.find(w => w.id === aId);
              const mv = moviesData.find(m => m.id === aId);
              allTimeStats.push({ animeId: aId, title: ws?.title || mv?.title || aId, totalViews: total, poster: ws?.poster || mv?.poster || "" });
            }
          });
          allTimeStats.sort((a, b) => b.totalViews - a.totalViews);

          const last7Days: { date: string; count: number }[] = [];
          for (let i = 6; i >= 0; i--) {
            const d = new Date(); d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().split("T")[0];
            const dayUsers = dailyActiveUsers[dateStr];
            last7Days.push({ date: dateStr, count: dayUsers ? Object.keys(dayUsers).length : 0 });
          }
          const maxDayCount = Math.max(...last7Days.map(d => d.count), 1);

          return (
            <div>
              {/* Summary Cards */}
              <div className="grid grid-cols-3 gap-3 mb-5">
                <div className="bg-gradient-to-br from-[#1A1A2E] to-[#151521] border border-green-500/20 rounded-2xl p-4">
                  <div className="w-10 h-10 bg-green-500/15 rounded-xl flex items-center justify-center mb-2 text-green-500">
                    <Activity size={18} />
                  </div>
                  <div className="text-2xl font-extrabold text-green-400">{totalCurrentViewers}</div>
                  <div className="text-[10px] text-[#D1C4E9] mt-1">Watching Now</div>
                </div>
                <div className="bg-gradient-to-br from-[#1A1A2E] to-[#151521] border border-purple-500/20 rounded-2xl p-4">
                  <div className="w-10 h-10 bg-purple-500/15 rounded-xl flex items-center justify-center mb-2 text-purple-500">
                    <Eye size={18} />
                  </div>
                  <div className="text-2xl font-extrabold bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-transparent">{todayViewers}</div>
                  <div className="text-[10px] text-[#D1C4E9] mt-1">Today's Viewers</div>
                </div>
                <div className="bg-gradient-to-br from-[#1A1A2E] to-[#151521] border border-blue-500/20 rounded-2xl p-4">
                  <div className="w-10 h-10 bg-blue-500/15 rounded-xl flex items-center justify-center mb-2 text-blue-500">
                    <TrendingUp size={18} />
                  </div>
                  <div className="text-2xl font-extrabold text-blue-400">{contentViewStats.length}</div>
                  <div className="text-[10px] text-[#D1C4E9] mt-1">Active Content</div>
                </div>
              </div>

              {/* Currently Watching - Live */}
              <div className={`${glassCard} p-4 mb-4`}>
                <h3 className="text-sm font-semibold mb-3.5 flex items-center gap-2">
                  <Activity size={14} className="text-green-500 animate-pulse" /> Currently Watching (Live)
                </h3>
                {currentViewersList.length === 0 ? (
                  <p className="text-[#957DAD] text-[13px] text-center py-5">No one watching right now</p>
                ) : (
                  <div className="space-y-3">
                    {currentViewersList.map(item => (
                      <div key={item.animeId} className="bg-[#1A1A2E] border border-green-500/20 rounded-xl p-3.5">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[13px] font-semibold truncate flex-1">{item.title}</span>
                          <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full font-bold ml-2 flex items-center gap-1">
                            <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                            {item.viewers.length}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {item.viewers.map(v => (
                            <span key={v.uid} className="text-[10px] bg-green-500/10 text-green-300 px-2 py-1 rounded-lg">
                              👤 {v.userName} ({formatTime(v.startedAt)})
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 7-Day Trend Chart */}
              <div className={`${glassCard} p-4 mb-4`}>
                <h3 className="text-sm font-semibold mb-3.5 flex items-center gap-2">
                  <TrendingUp size={14} className="text-blue-500" /> Last 7 Days - Daily Viewers
                </h3>
                <div className="flex items-end gap-2 h-[120px]">
                  {last7Days.map((day) => (
                    <div key={day.date} className="flex-1 flex flex-col items-center justify-end h-full">
                      <span className="text-[10px] text-purple-400 font-bold mb-1">{day.count}</span>
                      <div
                        className="w-full rounded-t-lg bg-gradient-to-t from-purple-600 to-purple-400 transition-all duration-500"
                        style={{ height: `${Math.max((day.count / maxDayCount) * 90, 4)}px` }}
                      />
                      <span className="text-[9px] text-[#957DAD] mt-1.5">
                        {new Date(day.date).toLocaleDateString("en", { weekday: "short" })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Today's Top Content */}
              <div className={`${glassCard} p-4 mb-4`}>
                <h3 className="text-sm font-semibold mb-3.5 flex items-center gap-2">
                  <BarChart3 size={14} className="text-purple-500" /> Today's Views by Content
                </h3>
                {contentViewStats.length === 0 ? (
                  <p className="text-[#957DAD] text-[13px] text-center py-5">No views today yet</p>
                ) : (
                  <div className="space-y-2.5">
                    {contentViewStats.slice(0, 20).map((item, idx) => (
                      <div key={item.animeId} className="flex items-center gap-3 bg-[#1A1A2E] rounded-xl p-3 border border-white/5">
                        <span className="text-[11px] text-[#957DAD] font-bold w-5">#{idx + 1}</span>
                        {item.poster && (
                          <img src={item.poster} className="w-9 h-[52px] rounded-lg object-cover flex-shrink-0"
                            onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] font-semibold truncate">{item.title}</p>
                          <div className="w-full h-1.5 bg-[#0F0F1A] rounded-full mt-1.5 overflow-hidden">
                            <div className="h-full rounded-full bg-gradient-to-r from-purple-600 to-pink-500 transition-all"
                              style={{ width: `${Math.min(100, (item.viewCount / (contentViewStats[0]?.viewCount || 1)) * 100)}%` }} />
                          </div>
                        </div>
                        <span className="text-sm font-bold text-purple-400 flex-shrink-0">{item.viewCount}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* All-Time Top Content */}
              <div className={`${glassCard} p-4 mb-4`}>
                <h3 className="text-sm font-semibold mb-3.5 flex items-center gap-2">
                  <TrendingUp size={14} className="text-pink-500" /> All-Time Most Watched
                </h3>
                {allTimeStats.length === 0 ? (
                  <p className="text-[#957DAD] text-[13px] text-center py-5">No data yet</p>
                ) : (
                  <div className="space-y-2.5">
                    {allTimeStats.slice(0, 15).map((item, idx) => (
                      <div key={item.animeId} className="flex items-center gap-3 bg-[#1A1A2E] rounded-xl p-3 border border-white/5">
                        <span className={`text-[11px] font-bold w-5 ${idx === 0 ? "text-yellow-400" : idx === 1 ? "text-gray-300" : idx === 2 ? "text-orange-400" : "text-[#957DAD]"}`}>
                          #{idx + 1}
                        </span>
                        {item.poster && (
                          <img src={item.poster} className="w-9 h-[52px] rounded-lg object-cover flex-shrink-0"
                            onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] font-semibold truncate">{item.title}</p>
                        </div>
                        <span className="text-sm font-bold text-pink-400 flex-shrink-0">{item.totalViews} views</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Today's Active Users */}
              <div className={`${glassCard} p-4 mb-4`}>
                <h3 className="text-sm font-semibold mb-3.5 flex items-center gap-2">
                  <Users size={14} className="text-purple-500" /> Today's Active Users ({todayViewers})
                </h3>
                {!dailyActiveUsers[today] ? (
                  <p className="text-[#957DAD] text-[13px] text-center py-5">No active users today</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(dailyActiveUsers[today]).map(([uid, data]: [string, any]) => (
                      <span key={uid} className="text-[11px] bg-purple-500/10 text-purple-300 px-3 py-1.5 rounded-full border border-purple-500/20">
                        👤 {data.userName || uid.substring(0, 8)} • {formatTime(data.lastSeen)}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Full Content Library - All Anime with Views */}
              <div className={`${glassCard} p-4`}>
                <h3 className="text-sm font-semibold mb-3.5 flex items-center gap-2">
                  <Film size={14} className="text-purple-500" /> Full Content Library Views ({webseriesData.length + moviesData.length} items)
                </h3>
                <div className="space-y-2">
                  {(() => {
                    // Build full list of ALL content with their view counts
                    const fullList = [
                      ...webseriesData.map(ws => {
                        let todayViews = 0;
                        let totalViews = 0;
                        const viewData = analyticsViews[ws.id];
                        if (viewData) {
                          if (viewData[today]) todayViews = Object.keys(viewData[today]).length;
                          Object.values(viewData).forEach((dayUsers: any) => { totalViews += Object.keys(dayUsers || {}).length; });
                        }
                        return { id: ws.id, title: ws.title || "Untitled", poster: ws.poster || "", type: "Series", todayViews, totalViews };
                      }),
                      ...moviesData.map(mv => {
                        let todayViews = 0;
                        let totalViews = 0;
                        const viewData = analyticsViews[mv.id];
                        if (viewData) {
                          if (viewData[today]) todayViews = Object.keys(viewData[today]).length;
                          Object.values(viewData).forEach((dayUsers: any) => { totalViews += Object.keys(dayUsers || {}).length; });
                        }
                        return { id: mv.id, title: mv.title || "Untitled", poster: mv.poster || "", type: "Movie", todayViews, totalViews };
                      }),
                    ];
                    fullList.sort((a, b) => b.totalViews - a.totalViews || b.todayViews - a.todayViews);
                    const maxTotal = fullList[0]?.totalViews || 1;

                    return fullList.map((item, idx) => (
                      <div key={item.id} className="flex items-center gap-3 bg-[#1A1A2E] rounded-xl p-3 border border-white/5">
                        <span className={`text-[11px] font-bold w-5 flex-shrink-0 ${idx === 0 ? "text-yellow-400" : idx === 1 ? "text-gray-300" : idx === 2 ? "text-orange-400" : "text-[#957DAD]"}`}>
                          {idx + 1}
                        </span>
                        <img src={item.poster} className="w-8 h-[46px] rounded-lg object-cover flex-shrink-0 bg-[#0F0F1A]"
                          onError={e => { (e.target as HTMLImageElement).src = "https://via.placeholder.com/32x46/1A1A2E/9D4EDD?text=N"; }} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <p className="text-[11px] font-semibold truncate">{item.title}</p>
                            <span className="text-[9px] bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded flex-shrink-0">{item.type}</span>
                          </div>
                          <div className="w-full h-1 bg-[#0F0F1A] rounded-full overflow-hidden">
                            <div className="h-full rounded-full bg-gradient-to-r from-purple-600 to-pink-500 transition-all"
                              style={{ width: `${item.totalViews > 0 ? Math.max(3, (item.totalViews / maxTotal) * 100) : 0}%` }} />
                          </div>
                        </div>
                        <div className="flex flex-col items-end flex-shrink-0">
                          <span className="text-[11px] font-bold text-purple-400">{item.totalViews}</span>
                          <span className="text-[9px] text-green-400">{item.todayViews > 0 ? `+${item.todayViews} today` : "—"}</span>
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              </div>
            </div>
          );
        })()}
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 h-[58px] bg-[#0D0D1A]/95 border-t border-white/6 flex items-center justify-around z-[100] px-2">
        {[
          { section: "dashboard" as Section, icon: <LayoutDashboard size={19} />, label: "Dashboard" },
          { section: "webseries" as Section, icon: <Film size={19} />, label: "Series" },
          { section: "movies" as Section, icon: <Video size={19} />, label: "Movies" },
          { section: "notifications" as Section, icon: <Bell size={19} />, label: "Notify" },
        ].map(item => (
          <div key={item.section} onClick={() => showSection(item.section)}
            className={`flex flex-col items-center gap-0.5 py-2 px-3.5 cursor-pointer relative transition-colors ${
              activeSection === item.section ? "text-indigo-400" : "text-zinc-600"
            }`}>
            {activeSection === item.section && <div className="absolute -top-px left-1/2 -translate-x-1/2 w-7 h-[2px] bg-indigo-500 rounded-b" />}
            {item.icon}
            <span className="text-[10px] font-medium">{item.label}</span>
          </div>
        ))}
      </nav>
    </div>
  );
});

Admin.displayName = "Admin";

// Maintenance Section sub-component
const MaintenanceSection = ({
  glassCard, inputClass, btnPrimary, maintenanceActive, currentMaintenance,
  maintenanceMessage, setMaintenanceMessage, maintenanceResumeDate, setMaintenanceResumeDate,
}: {
  glassCard: string; inputClass: string; btnPrimary: string; maintenanceActive: boolean;
  currentMaintenance: any; maintenanceMessage: string; setMaintenanceMessage: (v: string) => void;
  maintenanceResumeDate: string; setMaintenanceResumeDate: (v: string) => void;
}) => {
  const [countdown, setCountdown] = useState("");
  const [hasCountdown, setHasCountdown] = useState(false);

  useEffect(() => {
    if (!currentMaintenance?.active || !currentMaintenance?.resumeDate) {
      setHasCountdown(false);
      setCountdown("");
      return;
    }

    const updateCountdown = () => {
      const resumeTime = new Date(currentMaintenance.resumeDate).getTime() + 86400000; // end of that day
      const diff = resumeTime - Date.now();
      if (diff <= 0) {
        // Auto turn on server - extend timers first
        const duration = currentMaintenance?.startedAt ? Date.now() - currentMaintenance.startedAt : 0;
        if (duration > 0) extendAllUserTimers(duration);
        update(ref(db, "maintenance"), { active: false, resumeDate: null })
          .then(() => toast.success("Server auto-started! ✅"))
          .catch(() => {});
        setHasCountdown(false);
        setCountdown("");
        return;
      }
      setHasCountdown(true);
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      if (d > 0) setCountdown(`${d}d ${h.toString().padStart(2, "0")}h ${m.toString().padStart(2, "0")}m ${s.toString().padStart(2, "0")}s`);
      else setCountdown(`${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`);
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [currentMaintenance]);

  const handleShutdown = () => {
    if (!maintenanceMessage.trim()) { toast.error("Please enter a message"); return; }
    if (confirm("Shut down the server? All users will be blocked!")) {
      update(ref(db, "maintenance"), {
        active: true,
        message: maintenanceMessage,
        resumeDate: maintenanceResumeDate || null,
        startedAt: Date.now(),
      }).then(() => toast.success("Server shut down!"))
        .catch(err => toast.error("Error: " + err.message));
    }
  };

  const extendAllUserTimers = async (duration: number) => {
    try {
      // Extend premium users' expiresAt
      const usersSnap = await get(ref(db, "users"));
      if (usersSnap.exists()) {
        const allUsers = usersSnap.val();
        const updates: Record<string, any> = {};
        Object.entries(allUsers).forEach(([uid, userData]: [string, any]) => {
          if (userData?.premium?.active && userData?.premium?.expiresAt) {
            updates[`users/${uid}/premium/expiresAt`] = userData.premium.expiresAt + duration;
          }
        });
        if (Object.keys(updates).length > 0) {
          await update(ref(db), updates);
          toast.success(`Extended ${Object.keys(updates).length} premium user(s) timers!`);
        }
      }
      // Store last maintenance info for client-side free access adjustment
      await update(ref(db, "maintenance"), {
        lastPauseDuration: duration,
        lastResumedAt: Date.now(),
      });
    } catch (err: any) {
      toast.error("Error extending timers: " + err.message);
    }
  };

  const handleStartNow = async () => {
    if (confirm("Start the server immediately?")) {
      const duration = currentMaintenance?.startedAt ? Date.now() - currentMaintenance.startedAt : 0;
      if (duration > 0) await extendAllUserTimers(duration);
      update(ref(db, "maintenance"), { active: false, resumeDate: null })
        .then(() => { toast.success("Server is online! ✅"); setMaintenanceResumeDate(""); })
        .catch(err => toast.error("Error: " + err.message));
    }
  };

  return (
    <div>
      <div className={`${glassCard} p-4 mb-4`}>
        <h3 className="text-sm font-semibold mb-3.5 flex items-center gap-2">
          <Power size={14} className={maintenanceActive ? "text-red-500" : "text-green-500"} />
          Server Status: {maintenanceActive ? "🔴 Offline (Maintenance)" : "🟢 Online"}
        </h3>

        {currentMaintenance?.active && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-4">
            <p className="text-sm text-red-400 font-medium mb-1">Server is currently offline</p>
            <p className="text-xs text-[#D1C4E9]">{currentMaintenance.message}</p>
            {currentMaintenance.resumeDate && (
              <p className="text-xs text-yellow-400 mt-1">
                Resume Date: {new Date(currentMaintenance.resumeDate).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
              </p>
            )}

            {/* Countdown Timer */}
            {hasCountdown && countdown && (
              <div className="mt-3 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-xl text-center">
                <p className="text-[10px] text-yellow-400 uppercase tracking-wider mb-1">Auto-start in</p>
                <p className="text-2xl font-bold font-mono text-yellow-300 tracking-wider">{countdown}</p>
              </div>
            )}

            {/* Start Server Now Button */}
            <button onClick={handleStartNow}
              className="w-full mt-3 py-3 bg-gradient-to-r from-green-600 to-green-800 text-white font-semibold rounded-xl flex items-center justify-center gap-2 shadow-[0_4px_15px_rgba(34,197,94,0.3)] hover:shadow-[0_6px_25px_rgba(34,197,94,0.5)] transition-all">
              <Power size={16} /> Start Server Now
            </button>
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="text-[11px] text-[#D1C4E9] mb-1 block">Maintenance Message</label>
            <textarea value={maintenanceMessage} onChange={e => setMaintenanceMessage(e.target.value)}
              className={`${inputClass} min-h-[80px] resize-none`}
              placeholder="Write a message for users..." />
          </div>
          <div>
            <label className="text-[11px] text-[#D1C4E9] mb-1 block">Resume Date</label>
            <input type="date" value={maintenanceResumeDate} onChange={e => setMaintenanceResumeDate(e.target.value)}
              className={inputClass} />
          </div>

          {!maintenanceActive ? (
            <button onClick={handleShutdown}
              className="w-full py-3.5 bg-gradient-to-r from-red-600 to-red-800 text-white font-semibold rounded-xl flex items-center justify-center gap-2 shadow-[0_4px_15px_rgba(239,68,68,0.3)] hover:shadow-[0_6px_25px_rgba(239,68,68,0.5)] transition-all">
              <AlertTriangle size={16} /> Shut Down Server
            </button>
          ) : (
            <button onClick={handleStartNow}
              className={`${btnPrimary} w-full py-3.5 flex items-center justify-center gap-2`}>
              <Power size={16} /> Start Server
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// User Password Lookup sub-component
const UserPasswordLookup = ({ inputClass, btnPrimary }: { inputClass: string; btnPrimary: string }) => {
  const [searchInput, setSearchInput] = useState("");
  const [searchResult, setSearchResult] = useState<any>(null);
  const [searching, setSearching] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const lookupUser = async () => {
    if (!searchInput.trim()) { toast.error("Enter user email or username"); return; }
    setSearching(true);
    setSearchResult(null);
    setShowPassword(false);
    try {
      const input = searchInput.trim().toLowerCase();
      const commaKey = input.replace(/\./g, ",").replace(/[^a-z0-9@,_-]/g, "_");
      const legacyKey = input.replace(/[^a-z0-9]/g, "_");

      // Search by key
      for (const key of [commaKey, legacyKey]) {
        const snap = await get(ref(db, `appUsers/${key}`));
        if (snap.exists()) {
          setSearchResult({ ...snap.val(), _key: key });
          setSearching(false);
          return;
        }
      }

      // Search by name/email fields
      const allSnap = await get(ref(db, "appUsers"));
      if (allSnap.exists()) {
        const allData = allSnap.val();
        for (const key of Object.keys(allData)) {
          const u = allData[key];
          if (u && typeof u === 'object') {
            const nameMatch = u.name && u.name.toLowerCase() === input;
            const emailMatch = u.email && u.email.toLowerCase() === input;
            if (nameMatch || emailMatch) {
              setSearchResult({ ...u, _key: key });
              setSearching(false);
              return;
            }
          }
        }
      }

      toast.error("User not found!");
    } catch (err: any) { toast.error("Error: " + err.message); }
    setSearching(false);
  };

  return (
    <div>
      <div className="flex gap-2.5 mb-3">
        <input value={searchInput} onChange={e => setSearchInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && lookupUser()}
          className={`${inputClass} flex-1`} placeholder="Enter email or username" />
        <button onClick={lookupUser} disabled={searching}
          className={`${btnPrimary} px-4 py-3 flex items-center gap-1.5`}>
          {searching ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
        </button>
      </div>
      {searchResult && (
        <div className="bg-[#1A1A2E] border border-purple-500/30 rounded-xl p-4 mt-3">
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-[11px] text-[#957DAD]">Name:</span>
              <span className="text-[13px] font-medium">{searchResult.name || "N/A"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[11px] text-[#957DAD]">Email:</span>
              <span className="text-[13px] font-medium">{searchResult.email || "N/A"}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[11px] text-[#957DAD]">Password:</span>
              {searchResult.password ? (
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-mono font-bold text-green-400">
                    {showPassword ? searchResult.password : "••••••••"}
                  </span>
                  <button onClick={() => setShowPassword(!showPassword)}
                    className="text-purple-500 hover:text-purple-400 transition-colors">
                    {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                  <button onClick={() => { navigator.clipboard.writeText(searchResult.password); toast.success("Copied!"); }}
                    className="text-[10px] bg-purple-500/20 px-2 py-1 rounded-full hover:bg-purple-500/40 transition-all">Copy</button>
                </div>
              ) : (
                <span className="text-[13px] text-yellow-400">
                  {searchResult.googleAuth ? "Google Login (No password)" : "Password not set"}
                </span>
              )}
            </div>
            <div className="flex justify-between">
              <span className="text-[11px] text-[#957DAD]">ID:</span>
              <span className="text-[11px] font-mono text-[#D1C4E9]">{searchResult.id || searchResult._key}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Admin Live Support Section sub-component
const AdminLiveSupportSection = ({
  glassCard, inputClass, btnPrimary,
}: {
  glassCard: string; inputClass: string; btnPrimary: string;
}) => {
  const [chats, setChats] = useState<any[]>([]);
  const [selectedChat, setSelectedChat] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [replyText, setReplyText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load all support chats
  useEffect(() => {
    const unsub = onValue(ref(db, "supportChats"), (snap) => {
      const data = snap.val() || {};
      const chatList = Object.entries(data).map(([userId, chat]: any) => ({
        userId,
        userName: chat.meta?.userName || "Unknown",
        lastMessage: chat.meta?.lastMessage || "",
        lastTimestamp: chat.meta?.lastTimestamp || 0,
        unread: chat.meta?.unread || false,
      }));
      chatList.sort((a, b) => b.lastTimestamp - a.lastTimestamp);
      setChats(chatList);
    });
    return () => unsub();
  }, []);

  // Load messages for selected chat
  useEffect(() => {
    if (!selectedChat) { setChatMessages([]); return; }
    // Mark as read
    update(ref(db, `supportChats/${selectedChat}/meta`), { unread: false }).catch(() => {});
    const unsub = onValue(ref(db, `supportChats/${selectedChat}/messages`), (snap) => {
      const data = snap.val() || {};
      const msgs = Object.entries(data).map(([id, msg]: any) => ({ id, ...msg }));
      msgs.sort((a, b) => a.timestamp - b.timestamp);
      setChatMessages(msgs);
    });
    return () => unsub();
  }, [selectedChat]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  const sendAdminReply = async () => {
    if (!replyText.trim() || !selectedChat) return;
    try {
      const msgRef = push(ref(db, `supportChats/${selectedChat}/messages`));
      await set(msgRef, {
        role: "admin",
        content: replyText.trim(),
        timestamp: Date.now(),
        userName: "Admin (RS)",
      });
      await update(ref(db, `supportChats/${selectedChat}/meta`), {
        lastMessage: `Admin: ${replyText.trim()}`,
        lastTimestamp: Date.now(),
      });
      setReplyText("");
      toast.success("রিপ্লাই পাঠানো হয়েছে");
    } catch {
      toast.error("রিপ্লাই পাঠাতে ব্যর্থ");
    }
  };

  const deleteChat = async (userId: string) => {
    if (!confirm("এই চ্যাট মুছে ফেলবেন?")) return;
    try {
      await remove(ref(db, `supportChats/${userId}`));
      if (selectedChat === userId) setSelectedChat(null);
      toast.success("চ্যাট মুছে ফেলা হয়েছে");
    } catch {
      toast.error("মুছতে ব্যর্থ");
    }
  };

  const formatTime = (ts: number) => {
    if (!ts) return "";
    const d = new Date(ts);
    return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="space-y-4">
      <div className={`${glassCard} p-4`}>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <MessageCircle size={14} className="text-indigo-400" /> Live Support Chats ({chats.length})
        </h3>

        {selectedChat ? (
          <div>
            {/* Back button + chat header */}
            <button
              onClick={() => setSelectedChat(null)}
              className="text-xs text-indigo-400 hover:text-indigo-300 mb-3 flex items-center gap-1"
            >
              <ChevronLeft size={14} /> সব চ্যাটে ফিরুন
            </button>
            <div className="text-sm font-medium mb-3 text-white/80">
              {chats.find(c => c.userId === selectedChat)?.userName || selectedChat}
            </div>

            {/* Messages */}
            <div className="space-y-2 max-h-[400px] overflow-y-auto mb-3 p-2 bg-black/20 rounded-lg">
              {chatMessages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.role === "admin" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[80%] rounded-xl px-3 py-2 text-xs ${
                    msg.role === "admin"
                      ? "bg-emerald-600/30 text-emerald-100"
                      : msg.role === "assistant"
                      ? "bg-indigo-600/20 text-indigo-100"
                      : "bg-zinc-700/50 text-white/90"
                  }`}>
                    <span className="text-[10px] font-bold opacity-60 block mb-0.5">
                      {msg.role === "admin" ? "🛡️ Admin" : msg.role === "assistant" ? "🤖 AI Bot" : `👤 ${msg.userName || "User"}`}
                    </span>
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                    <span className="text-[9px] opacity-40 block text-right mt-1">{formatTime(msg.timestamp)}</span>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Reply input */}
            <div className="flex gap-2">
              <input
                value={replyText}
                onChange={e => setReplyText(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendAdminReply(); } }}
                placeholder="অ্যাডমিন রিপ্লাই লিখুন..."
                className={`${inputClass} flex-1`}
              />
              <button
                onClick={sendAdminReply}
                disabled={!replyText.trim()}
                className={`${btnPrimary} px-4 py-2 text-xs disabled:opacity-40`}
              >
                <Send size={14} />
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {chats.length === 0 && (
              <p className="text-xs text-zinc-500 text-center py-6">কোনো সাপোর্ট মেসেজ নেই</p>
            )}
            {chats.map((chat) => (
              <div
                key={chat.userId}
                className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-all ${
                  chat.unread
                    ? "bg-indigo-600/15 border border-indigo-500/30"
                    : "bg-zinc-800/30 border border-zinc-700/30 hover:border-zinc-600"
                }`}
                onClick={() => setSelectedChat(chat.userId)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium truncate">{chat.userName}</span>
                    {chat.unread && <span className="w-2 h-2 bg-indigo-400 rounded-full animate-pulse" />}
                  </div>
                  <p className="text-[10px] text-zinc-400 truncate mt-0.5">{chat.lastMessage}</p>
                  <span className="text-[9px] text-zinc-500">{formatTime(chat.lastTimestamp)}</span>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteChat(chat.userId); }}
                  className="p-1.5 text-red-400/60 hover:text-red-400 transition-colors"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// Admin Comments Section sub-component
const AdminCommentsSection = ({
  commentsData, glassCard, inputClass, btnPrimary, webseriesData, moviesData,
}: {
  commentsData: any[]; glassCard: string; inputClass: string; btnPrimary: string;
  webseriesData: any[]; moviesData: any[];
}) => {
  const [replyText, setReplyText] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const getContentTitle = (animeId: string) => {
    const ws = webseriesData.find(s => s.id === animeId);
    if (ws) return ws.title;
    const mv = moviesData.find(m => m.id === animeId);
    if (mv) return mv.title;
    return animeId;
  };

  const formatTime = (ts: number) => {
    if (!ts) return "";
    const diff = Date.now() - ts;
    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const postAdminReply = async (animeId: string, commentId: string) => {
    if (!replyText.trim()) return;

    const text = replyText.trim();
    const targetComment = commentsData.find((c) => c.animeId === animeId && c.id === commentId);

    try {
      const now = Date.now();
      const replyRef = push(ref(db, `comments/${animeId}/${commentId}/replies`));
      await set(replyRef, {
        userId: "admin",
        userName: "Admin (RS)",
        text,
        timestamp: now,
      });

      if (targetComment?.userId && targetComment.userId !== "admin") {
        const title = "Admin replied to your comment";
        const message = `Admin replied on ${getContentTitle(animeId)}`;

        await set(push(ref(db, `notifications/${targetComment.userId}`)), {
          title,
          message,
          type: "admin_reply",
          contentId: animeId,
          image: targetComment.poster || "",
          poster: targetComment.poster || "",
          timestamp: now,
          read: false,
        });

        sendPushToUsers([targetComment.userId], {
          title,
          body: message,
          image: targetComment.poster || undefined,
          url: `/?anime=${animeId}`,
          data: { type: "admin_reply", animeId, commentId },
        }).catch((err) => console.warn("Admin reply push failed:", err));
      }

      setReplyText("");
      setReplyingTo(null);
      toast.success("Reply posted!");
    } catch {
      toast.error("Error posting reply");
    }
  };

  const deleteComment = (animeId: string, commentId: string) => {
    if (confirm("Delete this comment?")) {
      remove(ref(db, `comments/${animeId}/${commentId}`))
        .then(() => toast.success("Comment deleted"))
        .catch(() => toast.error("Error deleting"));
    }
  };

  const deleteReply = (animeId: string, commentId: string, replyId: string) => {
    if (confirm("Delete this reply?")) {
      remove(ref(db, `comments/${animeId}/${commentId}/replies/${replyId}`))
        .then(() => toast.success("Reply deleted"))
        .catch(() => toast.error("Error deleting"));
    }
  };

  const filteredComments = filter
    ? commentsData.filter(c => getContentTitle(c.animeId).toLowerCase().includes(filter.toLowerCase()) || c.userName?.toLowerCase().includes(filter.toLowerCase()) || c.text?.toLowerCase().includes(filter.toLowerCase()))
    : commentsData;

  return (
    <div>
      <div className={`${glassCard} p-4 mb-4`}>
        <h3 className="text-sm font-semibold mb-3.5 flex items-center gap-2">
          <MessageCircle size={14} className="text-purple-500" /> All Comments ({commentsData.length})
        </h3>
        <input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className={`${inputClass} mb-4`}
          placeholder="🔍 Search comments by content, user, or text..."
        />
        {filteredComments.length === 0 ? (
          <p className="text-[#957DAD] text-[13px] text-center py-8">No comments found</p>
        ) : (
          <div className="space-y-3 max-h-[600px] overflow-y-auto">
            {filteredComments.slice(0, 50).map((comment) => (
              <div key={comment.id} className="bg-[#1A1A2E] border border-white/5 rounded-xl p-3.5">
                {/* Content label */}
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[10px] bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded-full font-medium truncate max-w-[200px]">
                    📺 {getContentTitle(comment.animeId)}
                  </span>
                  <span className="text-[10px] text-[#957DAD]">{formatTime(comment.timestamp)}</span>
                </div>
                {/* Comment */}
                <div className="flex justify-between items-start">
                  <div className="flex-1 min-w-0">
                    <span className="text-[12px] font-semibold text-purple-400">{comment.userName}</span>
                    <p className="text-[12px] text-[#D1C4E9] mt-0.5 break-words">{comment.text}</p>
                  </div>
                  <button onClick={() => deleteComment(comment.animeId, comment.id)}
                    className="text-[#957DAD] hover:text-red-400 transition-colors flex-shrink-0 ml-2">
                    <Trash2 size={12} />
                  </button>
                </div>

                {/* Replies */}
                {comment.replies?.length > 0 && (
                  <div className="ml-4 mt-2 border-l-2 border-purple-500/20 pl-3 space-y-1.5">
                    {comment.replies.map((r: any) => (
                      <div key={r.id} className="bg-black/20 rounded-lg p-2 flex justify-between items-start">
                        <div className="flex-1 min-w-0">
                          <span className={`text-[11px] font-semibold ${r.userId === "admin" ? "text-green-400" : "text-[#957DAD]"}`}>
                            {r.userName} {r.userId === "admin" && "✓"}
                          </span>
                          <p className="text-[11px] text-[#D1C4E9] break-words">{r.text}</p>
                          <span className="text-[9px] text-[#957DAD]">{formatTime(r.timestamp)}</span>
                        </div>
                        <button onClick={() => deleteReply(comment.animeId, comment.id, r.id)}
                          className="text-[#957DAD] hover:text-red-400 transition-colors flex-shrink-0 ml-2">
                          <Trash2 size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Reply input */}
                <div className="mt-2 flex gap-2">
                  {replyingTo === comment.id ? (
                    <div className="flex gap-2 w-full items-end">
                      <textarea
                        value={replyText}
                        onChange={e => setReplyText(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); postAdminReply(comment.animeId, comment.id); } }}
                        placeholder="Admin reply..."
                        rows={1}
                        className={`${inputClass} flex-1 !py-2 !text-xs resize-none min-h-[36px] max-h-[80px]`}
                        onInput={(e: any) => { e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 80) + "px"; }}
                        autoFocus
                      />
                      <button onClick={() => postAdminReply(comment.animeId, comment.id)}
                        className="bg-gradient-to-r from-green-600 to-green-800 text-white px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-1">
                        <Send size={12} /> Send
                      </button>
                      <button onClick={() => { setReplyingTo(null); setReplyText(""); }}
                        className="text-[#957DAD] hover:text-red-400 p-2">
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setReplyingTo(comment.id); setReplyText(""); }}
                      className="text-[10px] text-purple-400 hover:text-purple-300 flex items-center gap-1 transition-colors"
                    >
                      <Reply size={12} /> Reply as Admin
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// Auto Import Section sub-component
const AutoImportSection = ({
  glassCard, inputClass, btnPrimary, btnSecondary, categoryList, languageOptions,
  webseriesData, moviesData, selectClass,
}: {
  glassCard: string; inputClass: string; btnPrimary: string; btnSecondary: string;
  categoryList: { id: string; name: string }[]; languageOptions: string[];
  webseriesData: any[]; moviesData: any[]; selectClass: string;
}) => {
  const [browseType, setBrowseType] = useState<"trending_tv" | "trending_movie" | "popular_tv" | "popular_movie" | "top_tv" | "top_movie">("trending_tv");
  const [browseResults, setBrowseResults] = useState<any[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browsePage, setBrowsePage] = useState(1);
  const [importingId, setImportingId] = useState<number | null>(null);
  const [importLanguage, setImportLanguage] = useState("Hindi");
  const [importCategory, setImportCategory] = useState("");
  const [autoImportMode, setAutoImportMode] = useState(false);

  const browseLabels: Record<string, string> = {
    trending_tv: "🔥 Trending TV",
    trending_movie: "🔥 Trending Movies",
    popular_tv: "⭐ Popular TV",
    popular_movie: "⭐ Popular Movies",
    top_tv: "🏆 Top Rated TV",
    top_movie: "🏆 Top Rated Movies",
  };

  const fetchBrowse = async (page = 1) => {
    setBrowseLoading(true);
    try {
      let url = "";
      if (browseType === "trending_tv") url = `${TMDB_BASE_URL}/trending/tv/week?api_key=${TMDB_API_KEY}&page=${page}`;
      else if (browseType === "trending_movie") url = `${TMDB_BASE_URL}/trending/movie/week?api_key=${TMDB_API_KEY}&page=${page}`;
      else if (browseType === "popular_tv") url = `${TMDB_BASE_URL}/tv/popular?api_key=${TMDB_API_KEY}&page=${page}`;
      else if (browseType === "popular_movie") url = `${TMDB_BASE_URL}/movie/popular?api_key=${TMDB_API_KEY}&page=${page}`;
      else if (browseType === "top_tv") url = `${TMDB_BASE_URL}/tv/top_rated?api_key=${TMDB_API_KEY}&page=${page}&with_genres=16`;
      else if (browseType === "top_movie") url = `${TMDB_BASE_URL}/movie/top_rated?api_key=${TMDB_API_KEY}&page=${page}&with_genres=16`;

      const res = await fetch(url);
      const data = await res.json();
      if (page === 1) setBrowseResults(data.results || []);
      else setBrowseResults(prev => [...prev, ...(data.results || [])]);
      setBrowsePage(page);
    } catch { toast.error("Error fetching from TMDB"); }
    setBrowseLoading(false);
  };

  useEffect(() => { fetchBrowse(1); }, [browseType]);

  const isAlreadyAdded = (tmdbId: number): boolean => {
    const isTV = browseType.includes("tv");
    if (isTV) return webseriesData.some(s => s.tmdbId === tmdbId || s.tmdbId === String(tmdbId));
    return moviesData.some(m => m.tmdbId === tmdbId || m.tmdbId === String(tmdbId));
  };

  const autoImportItem = async (item: any) => {
    const isTV = browseType.includes("tv");
    const tmdbId = item.id;
    
    if (isAlreadyAdded(tmdbId)) {
      toast.info(`"${item.name || item.title}" আগে থেকেই আছে!`);
      return;
    }

    if (!importCategory) {
      toast.error("Please select a category first!");
      return;
    }

    setImportingId(tmdbId);
    try {
      const endpoint = isTV ? `tv/${tmdbId}` : `movie/${tmdbId}`;
      const res = await fetch(`${TMDB_BASE_URL}/${endpoint}?api_key=${TMDB_API_KEY}&append_to_response=credits,videos,images`);
      const data = await res.json();
      if (data.success === false) throw new Error("Not found");

      let trailerUrl = "";
      if (data.videos?.results) {
        const trailer = data.videos.results.find((v: any) => v.type === "Trailer" && v.site === "YouTube");
        if (trailer) trailerUrl = `https://www.youtube.com/watch?v=${trailer.key}`;
      }
      let logoUrl = "";
      if (data.images?.logos?.length > 0) {
        const logo = data.images.logos.find((l: any) => l.iso_639_1 === "en") || data.images.logos[0];
        logoUrl = TMDB_IMG_BASE + "w500" + logo.file_path;
      }
      const cast = data.credits?.cast?.slice(0, 10).map((c: any) => ({
        name: c.name, character: c.character, photo: c.profile_path ? TMDB_IMG_BASE + "w185" + c.profile_path : ""
      })) || [];

      if (isTV) {
        const seasons: any[] = [];
        if (data.seasons) {
          data.seasons.filter((s: any) => s.season_number > 0).forEach((season: any) => {
            seasons.push({
              name: season.name, seasonNumber: season.season_number,
              episodes: Array(season.episode_count).fill(null).map((_, i) => ({
                episodeNumber: i + 1, title: `Episode ${i + 1}`, link: ""
              }))
            });
          });
        }

        const seriesData = {
          tmdbId: data.id,
          title: data.name || "",
          logo: logoUrl,
          poster: data.poster_path ? TMDB_IMG_BASE + "original" + data.poster_path : "",
          backdrop: data.backdrop_path ? TMDB_IMG_BASE + "original" + data.backdrop_path : "",
          trailer: trailerUrl,
          year: data.first_air_date?.split("-")[0] || "",
          rating: data.vote_average?.toFixed(1) || "",
          language: importLanguage,
          category: importCategory,
          storyline: data.overview || "",
          cast,
          seasons,
          type: "webseries",
          createdAt: Date.now(),
        };
        await set(push(ref(db, "webseries")), seriesData);
        toast.success(`✅ "${data.name}" auto-imported as Series!`);
      } else {
        const movieData = {
          tmdbId: data.id,
          title: data.title || "",
          logo: logoUrl,
          poster: data.poster_path ? TMDB_IMG_BASE + "original" + data.poster_path : "",
          backdrop: data.backdrop_path ? TMDB_IMG_BASE + "original" + data.backdrop_path : "",
          trailer: trailerUrl,
          year: data.release_date?.split("-")[0] || "",
          rating: data.vote_average?.toFixed(1) || "",
          language: importLanguage,
          category: importCategory,
          storyline: data.overview || "",
          cast,
          movieLink: "",
          type: "movie",
          createdAt: Date.now(),
        };
        await set(push(ref(db, "movies")), movieData);
        toast.success(`✅ "${data.title}" auto-imported as Movie!`);
      }
    } catch (err: any) {
      toast.error("Import failed: " + err.message);
    }
    setImportingId(null);
  };

  return (
    <div>
      {/* Settings Card */}
      <div className={`${glassCard} p-4 mb-4`}>
        <h3 className="text-sm font-semibold mb-3.5 flex items-center gap-2">
          <Zap size={14} className="text-yellow-500" /> Auto Import Settings
        </h3>
        <p className="text-[11px] text-[#D1C4E9] mb-4">
          TMDB থেকে এনিমে ব্রাউজ করুন এবং এক ক্লিকে Firebase-এ অটো ইম্পোর্ট করুন। ভিডিও লিঙ্ক পরে ম্যানুয়ালি এড করতে হবে।
        </p>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="text-[11px] text-[#957DAD] mb-1 block">Language</label>
            <select value={importLanguage} onChange={e => setImportLanguage(e.target.value)} className={selectClass}>
              {languageOptions.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] text-[#957DAD] mb-1 block">Category <span className="text-red-400">*</span></label>
            <select value={importCategory} onChange={e => setImportCategory(e.target.value)} className={selectClass}>
              <option value="">Select</option>
              {categoryList.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Browse Type Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2.5 mb-4 scrollbar-hide">
        {Object.entries(browseLabels).map(([key, label]) => (
          <button key={key} onClick={() => setBrowseType(key as any)}
            className={`flex-shrink-0 px-4 py-2 rounded-full text-[12px] font-medium transition-all ${
              browseType === key
                ? "bg-gradient-to-r from-purple-500 to-purple-800 text-white shadow-[0_4px_15px_rgba(157,78,221,0.4)]"
                : "bg-[#151521] border border-white/10 text-[#D1C4E9]"
            }`}>
            {label}
          </button>
        ))}
      </div>

      {/* Results Grid */}
      {browseLoading && browseResults.length === 0 ? (
        <div className="flex justify-center py-12">
          <div className="w-10 h-10 border-4 border-[#151521] border-t-purple-500 rounded-full animate-spin" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            {browseResults.map(item => {
              const added = isAlreadyAdded(item.id);
              const importing = importingId === item.id;
              return (
                <div key={item.id} className={`relative rounded-xl overflow-hidden border-2 transition-all ${
                  added ? "border-green-500/50 opacity-60" : "border-transparent hover:border-purple-500"
                }`}>
                  <img
                    src={item.poster_path ? TMDB_IMG_BASE + "w342" + item.poster_path : ""}
                    className="w-full aspect-[2/3] object-cover"
                    onError={e => { (e.target as HTMLImageElement).src = "https://via.placeholder.com/200x300/1A1A2E/9D4EDD?text=No+Image"; }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
                  
                  {added && (
                    <div className="absolute top-2 right-2 bg-green-500 text-white text-[9px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                      <Check size={10} /> Added
                    </div>
                  )}

                  {item.vote_average > 0 && (
                    <div className="absolute top-2 left-2 bg-yellow-500/90 text-black text-[10px] font-bold px-1.5 py-0.5 rounded">
                      ⭐ {item.vote_average?.toFixed(1)}
                    </div>
                  )}

                  <div className="absolute bottom-0 left-0 right-0 p-2">
                    <p className="text-[11px] font-semibold leading-tight line-clamp-2 mb-1.5">
                      {item.name || item.title}
                    </p>
                    <p className="text-[9px] text-[#D1C4E9] mb-2">
                      {(item.first_air_date || item.release_date || "").split("-")[0] || "N/A"}
                    </p>
                    
                    {!added && (
                      <button
                        onClick={() => autoImportItem(item)}
                        disabled={importing || !importCategory}
                        className={`w-full py-1.5 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1 transition-all ${
                          importing
                            ? "bg-purple-500/30 text-purple-300 cursor-wait"
                            : !importCategory
                            ? "bg-gray-500/30 text-gray-400 cursor-not-allowed"
                            : "bg-gradient-to-r from-purple-600 to-purple-800 text-white hover:shadow-[0_2px_10px_rgba(157,78,221,0.5)]"
                        }`}
                      >
                        {importing ? (
                          <><RefreshCw size={10} className="animate-spin" /> Importing...</>
                        ) : (
                          <><Download size={10} /> Auto Import</>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Load More */}
          <div className="flex justify-center mt-5 mb-4">
            <button
              onClick={() => fetchBrowse(browsePage + 1)}
              disabled={browseLoading}
              className={`${btnPrimary} px-8 py-3 text-sm flex items-center gap-2`}
            >
              {browseLoading ? <RefreshCw size={14} className="animate-spin" /> : <ChevronDown size={14} />}
              Load More
            </button>
          </div>
        </>
      )}
    </div>
  );
};

// AnimeSalt Manager Section sub-component
const AnimeSaltManagerSection = ({
  glassCard, inputClass, btnPrimary, btnSecondary, categoryList, selectClass,
}: {
  glassCard: string; inputClass: string; btnPrimary: string; btnSecondary: string;
  categoryList: { id: string; name: string }[]; selectClass: string;
}) => {
  const [allItems, setAllItems] = useState<any[]>([]);
  const [selectedItems, setSelectedItems] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<"all" | "series" | "movies" | "added">("all");
  const [addCategory, setAddCategory] = useState("");
  const [addingSlug, setAddingSlug] = useState<string | null>(null);
  const [removingSlug, setRemovingSlug] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // TMDB selection modal
  const [tmdbResults, setTmdbResults] = useState<any[]>([]);
  const [tmdbModalItem, setTmdbModalItem] = useState<any>(null);
  const [tmdbSearching, setTmdbSearching] = useState(false);

  // Edit modal
  const [editItem, setEditItem] = useState<any>(null);
  const [editForm, setEditForm] = useState({ title: '', poster: '', backdrop: '', logo: '', storyline: '', year: '', rating: '', trailer: '' });

  // TMDB photo refresh inside edit modal
  const [editTmdbResults, setEditTmdbResults] = useState<any[]>([]);
  const [editTmdbSearching, setEditTmdbSearching] = useState(false);

  // URL import state
  const [urlInput, setUrlInput] = useState("");
  const [urlFetching, setUrlFetching] = useState(false);
  const [urlFetchedItem, setUrlFetchedItem] = useState<any>(null);

  // Episode editor modal
  const [epEditorSlug, setEpEditorSlug] = useState<string | null>(null);
  const [epEditorLoading, setEpEditorLoading] = useState(false);
  const [epEditorSeasons, setEpEditorSeasons] = useState<{ name: string; episodes: { number: number; title: string; slug: string; hasAnimeSaltLink: boolean; link: string; link480: string; link720: string; link1080: string; link4k: string }[] }[]>([]);
  const [epEditorExpandedSeason, setEpEditorExpandedSeason] = useState<number>(-1);
  const [epEditorSaving, setEpEditorSaving] = useState(false);
  const [jsonImportMode, setJsonImportMode] = useState(false);
  const [jsonPasteText, setJsonPasteText] = useState("");
  const jsonFileRef = useRef<HTMLInputElement>(null);
  const epSeasonJsonFileRef = useRef<HTMLInputElement>(null);
  const [epSeasonJsonTarget, setEpSeasonJsonTarget] = useState<number>(-1);

  const loadItems = async () => {
    setLoading(true);
    try {
      const result = await animeSaltApi.browseAll();
      if (result.success && result.items) {
        setAllItems(result.items);
      }
    } catch (err) {
      console.error('AnimeSalt load failed:', err);
      toast.error('AnimeSalt ডাটা লোড করতে সমস্যা');
    }
    setLoading(false);
  };

  useEffect(() => { loadItems(); }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    // Clear cache to force fresh fetch
    try { localStorage.removeItem('animesalt_all_v3'); } catch {}
    await loadItems();
    setRefreshing(false);
    toast.success('AnimeSalt ডাটা রিফ্রেশ হয়েছে!');
  };

  useEffect(() => {
    const unsub = onValue(ref(db, 'animesaltSelected'), (snap) => {
      setSelectedItems(snap.val() || {});
    });
    return () => unsub();
  }, []);

  const isAdded = (slug: string) => !!selectedItems[slug];

  const addItem = async (item: any) => {
    if (!addCategory) {
      toast.error('ক্যাটাগরি সিলেক্ট করুন!');
      return;
    }
    setAddingSlug(item.slug);
    try {
      const searchTitle = item.title.replace(/\s*\(.*?\)\s*/g, '').replace(/Season\s*\d+/i, '').trim();
      const isTV = item.type === 'series';
      const tmdbType = isTV ? 'tv' : 'movie';

      // Search TMDB
      setTmdbSearching(true);
      try {
        const res = await fetch(`${TMDB_BASE_URL}/search/${tmdbType}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(searchTitle)}`);
        const tmdbData = await res.json();
        setTmdbSearching(false);

        if (tmdbData.results?.length > 1) {
          // Multiple results - show selection modal
          setTmdbResults(tmdbData.results.slice(0, 10));
          setTmdbModalItem(item);
          setAddingSlug(null);
          return;
        } else if (tmdbData.results?.length === 1) {
          // Single result - auto select
          await saveWithTmdb(item, tmdbData.results[0]);
          return;
        }
      } catch {
        setTmdbSearching(false);
      }

      // No TMDB result - save with original data
      await saveWithTmdb(item, null);
    } catch (err: any) {
      toast.error('Error: ' + err.message);
    }
    setAddingSlug(null);
  };

  const saveWithTmdb = async (item: any, tmdbMatch: any) => {
    setAddingSlug(item.slug);
    try {
      let poster = item.poster || '';
      let backdrop = '';
      let storyline = '';
      let year = item.year || '';
      let rating = '';
      let tmdbId = null;

      if (tmdbMatch) {
        tmdbId = tmdbMatch.id;
        if (tmdbMatch.poster_path) poster = TMDB_IMG_BASE + 'w500' + tmdbMatch.poster_path;
        if (tmdbMatch.backdrop_path) backdrop = TMDB_IMG_BASE + 'w1280' + tmdbMatch.backdrop_path;
        storyline = tmdbMatch.overview || '';
        year = (tmdbMatch.first_air_date || tmdbMatch.release_date || '').split('-')[0] || year;
        rating = tmdbMatch.vote_average?.toFixed(1) || '';
      }

      if (!backdrop) backdrop = poster;

      await set(ref(db, `animesaltSelected/${item.slug}`), {
        title: item.title,
        poster,
        backdrop,
        storyline,
        year,
        rating,
        category: item._rematch ? (item._savedCategory || addCategory) : addCategory,
        type: item.type || 'series',
        tmdbId,
        addedAt: item._rematch ? (selectedItems[item.slug]?.addedAt || Date.now()) : Date.now(),
      });
      toast.success(item._rematch ? `✅ "${item.title}" TMDB আপডেট হয়েছে!` : `✅ "${item.title}" যোগ করা হয়েছে!`);
      setTmdbResults([]);
      setTmdbModalItem(null);
    } catch (err: any) {
      toast.error('Error: ' + err.message);
    }
    setAddingSlug(null);
  };

  const openEditModal = (slug: string) => {
    const saved = selectedItems[slug];
    if (!saved) return;
    setEditForm({
      title: saved.title || '',
      poster: saved.poster || '',
      backdrop: saved.backdrop || '',
      logo: saved.logo || '',
      storyline: saved.storyline || '',
      year: saved.year || '',
      rating: saved.rating || '',
      trailer: saved.trailer || '',
    });
    setEditTmdbResults([]);
    setEditItem({ slug, ...saved });
  };

  // TMDB photo refresh for edit modal
  const searchTmdbForEdit = async () => {
    if (!editForm.title.trim()) return;
    setEditTmdbSearching(true);
    setEditTmdbResults([]);
    try {
      const searchTitle = editForm.title.replace(/\s*\(.*?\)\s*/g, '').trim();
      const isTV = editItem?.type === 'series';
      const tmdbType = isTV ? 'tv' : 'movie';
      const res = await fetch(`${TMDB_BASE_URL}/search/${tmdbType}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(searchTitle)}`);
      const data = await res.json();
      if (data.results?.length > 0) {
        setEditTmdbResults(data.results.slice(0, 12));
      } else {
        toast.info('TMDB তে কোনো রেজাল্ট পাওয়া যায়নি');
      }
    } catch {
      toast.error('TMDB সার্চ ব্যর্থ');
    }
    setEditTmdbSearching(false);
  };

  const applyTmdbToEdit = (tmdbItem: any) => {
    setEditForm(f => ({
      ...f,
      poster: tmdbItem.poster_path ? TMDB_IMG_BASE + 'w500' + tmdbItem.poster_path : f.poster,
      backdrop: tmdbItem.backdrop_path ? TMDB_IMG_BASE + 'w1280' + tmdbItem.backdrop_path : f.backdrop,
      storyline: tmdbItem.overview || f.storyline,
      year: (tmdbItem.first_air_date || tmdbItem.release_date || '').split('-')[0] || f.year,
      rating: tmdbItem.vote_average?.toFixed(1) || f.rating,
    }));
    setEditTmdbResults([]);
    toast.success('✅ TMDB ডাটা প্রয়োগ হয়েছে! সেভ করুন।');
  };

  const saveEditForm = async () => {
    if (!editItem) return;
    try {
      await update(ref(db, `animesaltSelected/${editItem.slug}`), {
        title: editForm.title,
        poster: editForm.poster,
        backdrop: editForm.backdrop,
        logo: editForm.logo,
        storyline: editForm.storyline,
        year: editForm.year,
        rating: editForm.rating,
        trailer: editForm.trailer,
      });
      toast.success('✅ আপডেট সেভ হয়েছে!');
      setEditItem(null);
    } catch (err: any) {
      toast.error('Error: ' + err.message);
    }
  };

  // ==================== EPISODE EDITOR ====================
  const openEpisodeEditor = async (slug: string) => {
    setEpEditorSlug(slug);
    setEpEditorLoading(true);
    setEpEditorSeasons([]);
    setEpEditorExpandedSeason(-1);

    // Load existing custom seasons from Firebase
    try {
      const snap = await get(ref(db, `animesaltSelected/${slug}/customSeasons`));
      const saved = snap.val();
      if (saved && Array.isArray(saved) && saved.length > 0) {
        setEpEditorSeasons(saved);
        setEpEditorLoading(false);
        return;
      }
    } catch {}

    // Load episodes from AnimeSalt API as default
    try {
      const item = allItems.find(i => i.slug === slug) || selectedItems[slug];
      const isMovie = item?.type === 'movies';
      let result: any;
      if (isMovie) {
        result = await animeSaltApi.getMovie(slug);
        if (!result.success || !result.data) result = await animeSaltApi.getSeries(slug);
      } else {
        result = await animeSaltApi.getSeries(slug);
        if (!result.success || !result.data?.seasons?.length) result = await animeSaltApi.getMovie(slug);
      }

      if (result?.success && result.data?.seasons?.length > 0) {
        setEpEditorSeasons(result.data.seasons.map((s: any, sIdx: number) => ({
          name: s.name || `Season ${sIdx + 1}`,
          episodes: s.episodes.map((ep: any, eIdx: number) => ({
            number: ep.number || eIdx + 1,
            title: ep.title || `Episode ${ep.number || eIdx + 1}`,
            slug: ep.slug || '',
            hasAnimeSaltLink: !!ep.slug,
            link: '', link480: '', link720: '', link1080: '', link4k: '',
          })),
        })));
      } else {
        toast.error('কোনো এপিসোড পাওয়া যায়নি');
      }
    } catch (err: any) {
      toast.error('এপিসোড লোড ব্যর্থ: ' + err.message);
    }
    setEpEditorLoading(false);
  };

  const loadAnimeSaltSeason = async (slug: string) => {
    // Load from AnimeSalt API and add as a new season
    try {
      const result = await animeSaltApi.getSeries(slug);
      if (result?.success && result.data?.seasons?.length > 0) {
        const apiSeasons = result.data.seasons.map((s: any, sIdx: number) => ({
          name: s.name || `Season ${sIdx + 1}`,
          episodes: s.episodes.map((ep: any, eIdx: number) => ({
            number: ep.number || eIdx + 1,
            title: ep.title || `Episode ${ep.number || eIdx + 1}`,
            slug: ep.slug || '',
            hasAnimeSaltLink: !!ep.slug,
            link: '', link480: '', link720: '', link1080: '', link4k: '',
          })),
        }));
        // Merge: add only seasons not already present by name
        setEpEditorSeasons(prev => {
          const existingNames = new Set(prev.map(s => s.name));
          const newSeasons = apiSeasons.filter((s: any) => !existingNames.has(s.name));
          if (newSeasons.length === 0) {
            toast.info('সব সিজন আগে থেকেই আছে');
            return prev;
          }
          toast.success(`${newSeasons.length}টি সিজন লোড হয়েছে!`);
          return [...prev, ...newSeasons];
        });
      } else {
        toast.error('AnimeSalt থেকে সিজন পাওয়া যায়নি');
      }
    } catch {
      toast.error('AnimeSalt লোড ব্যর্থ');
    }
  };

  const epAddSeason = () => {
    setEpEditorSeasons(prev => [...prev, {
      name: `Season ${prev.length + 1}`,
      episodes: [{ number: 1, title: 'Episode 1', slug: '', hasAnimeSaltLink: false, link: '', link480: '', link720: '', link1080: '', link4k: '' }],
    }]);
  };

  // JSON import: parse episodes from JSON data
  const parseJsonEpisodes = (jsonData: any) => {
    try {
      let episodes: any[] = [];
      let seasonName = '';

      // Support: { episodes: [...] } or { seasons: [...] } or direct array [...]
      if (Array.isArray(jsonData)) {
        episodes = jsonData;
      } else if (jsonData.episodes && Array.isArray(jsonData.episodes)) {
        episodes = jsonData.episodes;
        seasonName = jsonData.name || jsonData.season || '';
      } else if (jsonData.seasons && Array.isArray(jsonData.seasons)) {
        // Multiple seasons
        const newSeasons = jsonData.seasons.map((s: any, sIdx: number) => ({
          name: s.name || `Season ${sIdx + 1}`,
          episodes: (s.episodes || []).map((ep: any, eIdx: number) => ({
            number: ep.episodeNumber || ep.number || eIdx + 1,
            title: ep.title || `Episode ${ep.episodeNumber || ep.number || eIdx + 1}`,
            slug: '',
            hasAnimeSaltLink: false,
            link: ep.link || '',
            link480: ep.link480 || '',
            link720: ep.link720 || '',
            link1080: ep.link1080 || '',
            link4k: ep.link4k || '',
          })),
        }));
        setEpEditorSeasons(prev => {
          const updated = [...prev, ...newSeasons];
          // Auto-expand first new season
          setEpEditorExpandedSeason(prev.length);
          return updated;
        });
        toast.success(`${newSeasons.length}টি সিজন JSON থেকে ইমপোর্ট হয়েছে!`);
        setJsonImportMode(false);
        setJsonPasteText('');
        return;
      } else {
        toast.error('অবৈধ JSON ফরম্যাট। episodes বা seasons array থাকা দরকার।');
        return;
      }

      if (episodes.length === 0) {
        toast.error('কোনো এপিসোড পাওয়া যায়নি JSON-এ');
        return;
      }

      const mappedEpisodes = episodes.map((ep: any, eIdx: number) => ({
        number: ep.episodeNumber || ep.number || eIdx + 1,
        title: ep.title || `Episode ${ep.episodeNumber || ep.number || eIdx + 1}`,
        slug: '',
        hasAnimeSaltLink: false,
        link: ep.link || '',
        link480: ep.link480 || '',
        link720: ep.link720 || '',
        link1080: ep.link1080 || '',
        link4k: ep.link4k || '',
      }));

      const newSeason = {
        name: seasonName || `Season ${epEditorSeasons.length + 1}`,
        episodes: mappedEpisodes,
      };
      setEpEditorSeasons(prev => {
        const newIdx = prev.length;
        setEpEditorExpandedSeason(newIdx);
        return [...prev, newSeason];
      });
      toast.success(`${mappedEpisodes.length}টি এপিসোড JSON থেকে ইমপোর্ট হয়েছে!`);
      setJsonImportMode(false);
      setJsonPasteText('');
    } catch (err: any) {
      toast.error('JSON পার্স ব্যর্থ: ' + err.message);
    }
  };

  const handleJsonPaste = () => {
    if (!jsonPasteText.trim()) { toast.error('JSON টেক্সট পেস্ট করুন'); return; }
    try {
      const parsed = JSON.parse(jsonPasteText.trim());
      parseJsonEpisodes(parsed);
    } catch {
      toast.error('অবৈধ JSON। সঠিক JSON ফরম্যাটে দিন।');
    }
  };

  const handleJsonFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    let processed = 0, failed = 0;
    const totalFiles = files.length;
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const parsed = JSON.parse(ev.target?.result as string);
          parseJsonEpisodes(parsed);
          processed++;
        } catch {
          failed++;
        }
        if (processed + failed === totalFiles) {
          if (failed > 0) toast.error(`${failed}টি ফাইল পার্স ব্যর্থ`);
          if (processed > 0) toast.success(`${processed}টি ফাইল সফলভাবে ইমপোর্ট হয়েছে`);
        }
      };
      reader.readAsText(file);
    });
    if (jsonFileRef.current) jsonFileRef.current.value = '';
  };

  // Per-season JSON import for AnimeSalt episode editor
  const epImportJsonToSeason = (sIdx: number, jsonData: any) => {
    try {
      let episodes: any[] = [];
      if (Array.isArray(jsonData)) {
        episodes = jsonData;
      } else if (jsonData.episodes && Array.isArray(jsonData.episodes)) {
        episodes = jsonData.episodes;
      } else {
        toast.error('অবৈধ JSON। episodes array থাকা দরকার।');
        return;
      }
      if (episodes.length === 0) { toast.error('কোনো এপিসোড পাওয়া যায়নি'); return; }
      const mapped = episodes.map((ep: any, eIdx: number) => ({
        number: ep.episodeNumber || ep.number || eIdx + 1,
        title: ep.title || `Episode ${ep.episodeNumber || ep.number || eIdx + 1}`,
        slug: '',
        hasAnimeSaltLink: false,
        link: ep.link || '',
        link480: ep.link480 || '',
        link720: ep.link720 || '',
        link1080: ep.link1080 || '',
        link4k: ep.link4k || '',
      }));
      setEpEditorSeasons(prev => {
        const copy = [...prev];
        const existing = [...(copy[sIdx]?.episodes || [])];
        // Merge: update matching episode numbers, append new ones
        mapped.forEach((newEp: any) => {
          const idx = existing.findIndex((e: any) => e.number === newEp.number);
          if (idx >= 0) {
            existing[idx] = newEp;
          } else {
            existing.push(newEp);
          }
        });
        existing.sort((a: any, b: any) => a.number - b.number);
        copy[sIdx] = { ...copy[sIdx], episodes: existing };
        return copy;
      });
      setEpEditorExpandedSeason(sIdx);
      toast.success(`${mapped.length}টি এপিসোড "${epEditorSeasons[sIdx]?.name}" সিজনে ইমপোর্ট হয়েছে!`);
    } catch (err: any) {
      toast.error('JSON পার্স ব্যর্থ: ' + err.message);
    }
  };

  const epHandleSeasonJsonFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || epSeasonJsonTarget < 0) return;
    const targetIdx = epSeasonJsonTarget;
    let processed = 0, failed = 0;
    const totalFiles = files.length;
    const allEpisodes: any[] = [];
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const parsed = JSON.parse(ev.target?.result as string);
          let eps: any[] = [];
          if (Array.isArray(parsed)) eps = parsed;
          else if (parsed.episodes && Array.isArray(parsed.episodes)) eps = parsed.episodes;
          eps.forEach((ep: any, eIdx: number) => {
            allEpisodes.push({
              number: ep.episodeNumber || ep.number || eIdx + 1,
              title: ep.title || `Episode ${ep.episodeNumber || ep.number || eIdx + 1}`,
              slug: '',
              hasAnimeSaltLink: false,
              link: ep.link || '',
              link480: ep.link480 || '',
              link720: ep.link720 || '',
              link1080: ep.link1080 || '',
              link4k: ep.link4k || '',
            });
          });
          processed++;
        } catch { failed++; }
        if (processed + failed === totalFiles) {
          if (allEpisodes.length > 0) {
            setEpEditorSeasons(prev => {
              const copy = [...prev];
              const existing = [...(copy[targetIdx]?.episodes || [])];
              allEpisodes.forEach((newEp: any) => {
                const idx = existing.findIndex((e: any) => e.number === newEp.number);
                if (idx >= 0) existing[idx] = newEp;
                else existing.push(newEp);
              });
              existing.sort((a: any, b: any) => a.number - b.number);
              copy[targetIdx] = { ...copy[targetIdx], episodes: existing };
              return copy;
            });
            setEpEditorExpandedSeason(targetIdx);
          }
          if (failed > 0) toast.error(`${failed}টি ফাইল পার্স ব্যর্থ`);
          toast.success(`${allEpisodes.length}টি এপিসোড ইমপোর্ট হয়েছে (${processed}টি ফাইল থেকে)`);
        }
      };
      reader.readAsText(file);
    });
    if (epSeasonJsonFileRef.current) epSeasonJsonFileRef.current.value = '';
    setEpSeasonJsonTarget(-1);
  };

  const epRemoveSeason = (sIdx: number) => {
    if (!confirm(`"${epEditorSeasons[sIdx]?.name}" সিজন ডিলিট করতে চান?`)) return;
    setEpEditorSeasons(prev => prev.filter((_, i) => i !== sIdx));
    if (epEditorExpandedSeason === sIdx) setEpEditorExpandedSeason(-1);
    else if (epEditorExpandedSeason > sIdx) setEpEditorExpandedSeason(prev => prev - 1);
  };

  const epUpdateSeasonName = (sIdx: number, name: string) => {
    setEpEditorSeasons(prev => {
      const copy = [...prev]; copy[sIdx] = { ...copy[sIdx], name }; return copy;
    });
  };

  const epAddEpisode = (sIdx: number) => {
    setEpEditorSeasons(prev => {
      const copy = [...prev];
      const s = { ...copy[sIdx], episodes: [...copy[sIdx].episodes] };
      const num = s.episodes.length + 1;
      s.episodes.push({ number: num, title: `Episode ${num}`, slug: '', hasAnimeSaltLink: false, link: '', link480: '', link720: '', link1080: '', link4k: '' });
      copy[sIdx] = s;
      return copy;
    });
  };

  const epRemoveEpisode = (sIdx: number, eIdx: number) => {
    if (!confirm('এই এপিসোড ডিলিট করতে চান?')) return;
    setEpEditorSeasons(prev => {
      const copy = [...prev];
      const s = { ...copy[sIdx], episodes: copy[sIdx].episodes.filter((_: any, i: number) => i !== eIdx) };
      s.episodes = s.episodes.map((ep: any, i: number) => ({ ...ep, number: i + 1 }));
      copy[sIdx] = s;
      return copy;
    });
  };

  const epUpdateEpisodeField = (sIdx: number, eIdx: number, field: string, value: string) => {
    setEpEditorSeasons(prev => {
      const copy = [...prev];
      const s = { ...copy[sIdx], episodes: [...copy[sIdx].episodes] };
      s.episodes[eIdx] = { ...s.episodes[eIdx], [field]: value };
      copy[sIdx] = s;
      return copy;
    });
  };

  const saveEpisodeData = async () => {
    if (!epEditorSlug) return;
    setEpEditorSaving(true);
    try {
      // Save full custom seasons data to Firebase
      await set(ref(db, `animesaltSelected/${epEditorSlug}/customSeasons`), epEditorSeasons);
      // Also generate episodeOverrides for backward compatibility with playback
      const overrides: Record<string, any> = {};
      epEditorSeasons.forEach((season, sIdx) => {
        season.episodes.forEach((ep: any, eIdx: number) => {
          if (ep.link || ep.link480 || ep.link720 || ep.link1080 || ep.link4k) {
            overrides[`s${sIdx}_e${eIdx}`] = {
              link: ep.link || '', link480: ep.link480 || '', link720: ep.link720 || '', link1080: ep.link1080 || '', link4k: ep.link4k || '',
            };
          }
        });
      });
      await set(ref(db, `animesaltSelected/${epEditorSlug}/episodeOverrides`), Object.keys(overrides).length > 0 ? overrides : null);
      toast.success('✅ এপিসোড ডাটা সেভ হয়েছে!');
    } catch (err: any) {
      toast.error('Error: ' + err.message);
    }
    setEpEditorSaving(false);
  };

  const deleteAllEpisodeData = async () => {
    if (!epEditorSlug) return;
    if (!confirm('সব সিজন ও এপিসোড ডিলিট করে AnimeSalt ডিফল্টে ফিরতে চান?')) return;
    try {
      await remove(ref(db, `animesaltSelected/${epEditorSlug}/customSeasons`));
      await remove(ref(db, `animesaltSelected/${epEditorSlug}/episodeOverrides`));
      setEpEditorSeasons([]);
      toast.success('সব ডিলিট হয়েছে! পরের বার ওপেন করলে AnimeSalt থেকে লোড হবে।');
    } catch (err: any) {
      toast.error('Error: ' + err.message);
    }
  };

  const removeItem = async (slug: string) => {
    if (!confirm('এই আইটেমটি রিমুভ করতে চান?')) return;
    setRemovingSlug(slug);
    try {
      // Remove entire node including customSeasons and episodeOverrides
      await remove(ref(db, `animesaltSelected/${slug}`));
      toast.success('রিমুভ করা হয়েছে! এখন আবার এড করতে পারবেন।');
    } catch {
      toast.error('Error removing');
    }
    setRemovingSlug(null);
  };

  // URL-based import
  const fetchFromUrl = async () => {
    if (!urlInput.trim()) { toast.error('লিংক দিন!'); return; }
    // Parse URL: https://animesalt.ac/series/slug/ or https://animesalt.ac/movies/slug/ (also supports old .top domain)
    const urlMatch = urlInput.trim().match(/animesalt\.(?:top|ac)\/(series|movies)\/([^/?#]+)/);
    if (!urlMatch) { toast.error('ভুল লিংক! AnimeSalt সিরিজ বা মুভির লিংক দিন।'); return; }
    const urlType = urlMatch[1]; // 'series' or 'movies'
    const urlSlug = urlMatch[2];

    setUrlFetching(true);
    setUrlFetchedItem(null);
    try {
      let result: any;
      if (urlType === 'movies') {
        result = await animeSaltApi.getMovie(urlSlug);
      } else {
        result = await animeSaltApi.getSeries(urlSlug);
      }
      if (result?.success && result.data) {
        setUrlFetchedItem({
          ...result.data,
          slug: urlSlug,
          type: urlType,
          poster: result.data.poster || '',
          title: result.data.title || urlSlug.replace(/-/g, ' '),
          year: result.data.year || '',
        });
        toast.success(`"${result.data.title || urlSlug}" পাওয়া গেছে!`);
      } else {
        toast.error('এই লিংক থেকে ডাটা পাওয়া যায়নি');
      }
    } catch (err: any) {
      toast.error('ফেচ ব্যর্থ: ' + err.message);
    }
    setUrlFetching(false);
  };

  const addFetchedItem = async () => {
    if (!urlFetchedItem) return;
    if (!addCategory) { toast.error('ক্যাটাগরি সিলেক্ট করুন!'); return; }
    // Use same addItem flow with TMDB
    const item = {
      slug: urlFetchedItem.slug,
      title: urlFetchedItem.title,
      poster: urlFetchedItem.poster,
      type: urlFetchedItem.type,
      year: urlFetchedItem.year,
    };
    await addItem(item);
    // Also add to allItems so it shows in the grid
    setAllItems(prev => {
      if (prev.some(i => i.slug === item.slug)) return prev;
      return [item, ...prev];
    });
    setUrlFetchedItem(null);
    setUrlInput("");
  };

  const updateItemCategory = async (slug: string, category: string) => {
    try {
      await update(ref(db, `animesaltSelected/${slug}`), { category });
      toast.success('ক্যাটাগরি আপডেট!');
    } catch {
      toast.error('Error updating');
    }
  };

  const filteredItems = useMemo(() => {
    let items = allItems;
    if (filterType === 'series') items = items.filter(i => i.type === 'series');
    else if (filterType === 'movies') items = items.filter(i => i.type === 'movies');
    else if (filterType === 'added') items = items.filter(i => isAdded(i.slug));

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter(i => i.title?.toLowerCase().includes(q));
    }
    return items;
  }, [allItems, filterType, searchQuery, selectedItems]);

  const addedCount = Object.keys(selectedItems).length;

  return (
    <div>
      {/* TMDB Selection Modal */}
      {tmdbModalItem && tmdbResults.length > 0 && (
        <div className="fixed inset-0 z-[300] bg-black/80 flex items-center justify-center p-4" onClick={() => { setTmdbModalItem(null); setTmdbResults([]); }}>
          <div className="bg-[#1A1A2E] border border-purple-500/40 rounded-2xl max-w-md w-full max-h-[80vh] overflow-y-auto p-4" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-sm font-semibold">🎯 সঠিক ছবি সিলেক্ট করুন</h3>
              <button onClick={() => { setTmdbModalItem(null); setTmdbResults([]); }} className="text-[#957DAD] hover:text-white"><X size={18} /></button>
            </div>
            <p className="text-[11px] text-[#D1C4E9] mb-3">"{tmdbModalItem.title}" এর জন্য {tmdbResults.length}টি রেজাল্ট পাওয়া গেছে:</p>
            <div className="grid grid-cols-2 gap-3">
              {tmdbResults.map((r: any) => (
                <button key={r.id} onClick={() => saveWithTmdb(tmdbModalItem, r)}
                  className="text-left rounded-xl overflow-hidden border-2 border-transparent hover:border-purple-500 transition-all bg-[#151521]">
                  <img src={r.poster_path ? TMDB_IMG_BASE + 'w342' + r.poster_path : 'https://via.placeholder.com/200x300/1A1A2E/9D4EDD?text=No+Image'}
                    className="w-full aspect-[2/3] object-cover" />
                  <div className="p-2">
                    <p className="text-[11px] font-semibold line-clamp-2">{r.name || r.title}</p>
                    <p className="text-[9px] text-[#957DAD]">{(r.first_air_date || r.release_date || '').split('-')[0]} • ⭐ {r.vote_average?.toFixed(1)}</p>
                  </div>
                </button>
              ))}
            </div>
            <button onClick={() => saveWithTmdb(tmdbModalItem, null)}
              className="w-full mt-3 py-2 rounded-lg text-[11px] bg-[#151521] border border-white/10 text-[#D1C4E9] hover:bg-purple-500/20 transition-all">
              TMDB ছাড়া এড করুন (অরিজিনাল ছবি)
            </button>
          </div>
        </div>
      )}

      {/* Edit Details Modal */}
      {editItem && (
        <div className="fixed inset-0 z-[300] bg-black/80 flex items-center justify-center p-4" onClick={() => setEditItem(null)}>
          <div className="bg-[#1A1A2E] border border-purple-500/40 rounded-2xl max-w-md w-full max-h-[85vh] overflow-y-auto p-4" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-semibold flex items-center gap-2">📝 Edit Details</h3>
              <button onClick={() => setEditItem(null)} className="text-[#957DAD] hover:text-white"><X size={18} /></button>
            </div>

            {/* Preview */}
            <div className="flex gap-3 mb-3">
              {editForm.poster && <img src={editForm.poster} className="w-16 h-24 object-cover rounded-lg" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
              {editForm.backdrop && <img src={editForm.backdrop} className="flex-1 h-24 object-cover rounded-lg" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
              {editForm.logo && <img src={editForm.logo} className="w-20 h-12 object-contain rounded-lg bg-black/30" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
            </div>

            {/* TMDB Photo Refresh */}
            <button onClick={searchTmdbForEdit} disabled={editTmdbSearching}
              className="w-full py-2 mb-3 rounded-lg text-[11px] font-bold bg-gradient-to-r from-cyan-500/20 to-blue-500/20 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/30 transition-all flex items-center justify-center gap-1.5">
              {editTmdbSearching ? <RefreshCw size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              🔍 TMDB থেকে ছবি রিফ্রেশ করুন
            </button>

            {/* TMDB Results Grid */}
            {editTmdbResults.length > 0 && (
              <div className="mb-3 bg-[#151521] rounded-xl border border-cyan-500/20 p-3">
                <p className="text-[10px] text-cyan-400 mb-2 font-semibold">সঠিক ছবি সিলেক্ট করুন ({editTmdbResults.length}টি রেজাল্ট):</p>
                <div className="grid grid-cols-3 gap-2 max-h-[200px] overflow-y-auto">
                  {editTmdbResults.map((r: any) => (
                    <button key={r.id} onClick={() => applyTmdbToEdit(r)}
                      className="text-left rounded-lg overflow-hidden border-2 border-transparent hover:border-cyan-500 transition-all bg-black/30">
                      <img src={r.poster_path ? TMDB_IMG_BASE + 'w185' + r.poster_path : 'https://via.placeholder.com/100x150/1A1A2E/9D4EDD?text=N/A'}
                        className="w-full aspect-[2/3] object-cover" />
                      <div className="p-1">
                        <p className="text-[9px] font-semibold line-clamp-1">{r.name || r.title}</p>
                        <p className="text-[8px] text-[#957DAD]">{(r.first_air_date || r.release_date || '').split('-')[0]}</p>
                      </div>
                    </button>
                  ))}
                </div>
                <button onClick={() => setEditTmdbResults([])} className="w-full mt-2 py-1 rounded text-[10px] text-[#957DAD] hover:text-white transition-all">
                  বন্ধ করুন
                </button>
              </div>
            )}

            <div className="space-y-3">
              {[
                { label: 'Title', key: 'title' },
                { label: 'Poster URL', key: 'poster' },
                { label: 'Backdrop URL', key: 'backdrop' },
                { label: 'Logo URL', key: 'logo' },
                { label: 'Year', key: 'year' },
                { label: 'Rating', key: 'rating' },
                { label: 'Trailer (YouTube)', key: 'trailer' },
              ].map(field => (
                <div key={field.key}>
                  <label className="text-[11px] text-purple-400 mb-1 block">{field.label}</label>
                  <input
                    value={(editForm as any)[field.key]}
                    onChange={e => setEditForm(f => ({ ...f, [field.key]: e.target.value }))}
                    className={inputClass}
                    placeholder={field.label}
                  />
                </div>
              ))}
              <div>
                <label className="text-[11px] text-purple-400 mb-1 block">Storyline</label>
                <textarea
                  value={editForm.storyline}
                  onChange={e => setEditForm(f => ({ ...f, storyline: e.target.value }))}
                  className={`${inputClass} min-h-[80px] resize-y`}
                  placeholder="Storyline"
                />
              </div>
            </div>

            <div className="flex gap-2 mt-4">
              <button onClick={saveEditForm} className="flex-1 py-2 rounded-lg text-[12px] font-bold bg-gradient-to-r from-purple-600 to-purple-800 text-white flex items-center justify-center gap-1.5">
                <Save size={12} /> সেভ করুন
              </button>
              <button onClick={() => setEditItem(null)} className="px-4 py-2 rounded-lg text-[12px] bg-[#151521] border border-white/10 text-[#D1C4E9]">
                বাতিল
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Episode Editor Modal */}
      {epEditorSlug && (
        <div className="fixed inset-0 z-[300] bg-black/80 flex items-end sm:items-center justify-center" onClick={() => setEpEditorSlug(null)}>
          <div className="bg-[#1A1A2E] border border-purple-500/40 rounded-t-2xl sm:rounded-2xl max-w-lg w-full max-h-[85vh] flex flex-col p-4" onClick={e => e.stopPropagation()}>
            {/* Fixed header */}
            <div className="flex justify-between items-center mb-3 flex-shrink-0">
              <h3 className="text-sm font-semibold flex items-center gap-2">🎬 এপিসোড এডিটর - {selectedItems[epEditorSlug]?.title || epEditorSlug}</h3>
              <button onClick={() => setEpEditorSlug(null)} className="text-[#957DAD] hover:text-white"><X size={18} /></button>
            </div>
            <p className="text-[10px] text-[#D1C4E9] mb-3 flex-shrink-0">
              <span className="text-yellow-400">AnimeSalt লিংক</span> = ওদের সার্ভার থেকে প্লে হবে (SaltPlayer)।
              <span className="text-green-400 ml-1">কাস্টম লিংক</span> = আপনার ভিডিও প্লেয়ারে প্লে হবে।
            </p>

            {epEditorLoading ? (
              <div className="flex justify-center py-12">
                <div className="w-10 h-10 border-4 border-[#151521] border-t-purple-500 rounded-full animate-spin" />
              </div>
            ) : (
              <>
                <div className="flex-1 overflow-y-auto min-h-0">
                  {/* Seasons & Episodes Header */}
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-[13px] font-semibold flex items-center gap-2">📋 Seasons & Episodes</h4>
                    <div className="flex gap-1.5 items-center">
                      <button onClick={() => setJsonImportMode(prev => !prev)}
                        className={`px-3 py-2 rounded-xl text-[11px] font-bold border transition-all flex items-center gap-1.5 ${jsonImportMode ? 'bg-blue-500/30 border-blue-500/50 text-blue-300' : 'bg-blue-500/20 border-blue-500/30 text-blue-400 hover:bg-blue-500/40'}`}>
                        <FolderOpen size={12} /> JSON Import
                      </button>
                      <button onClick={() => epEditorSlug && loadAnimeSaltSeason(epEditorSlug)}
                        className="px-3 py-2 rounded-xl text-[11px] font-bold bg-yellow-500/20 border border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/40 transition-all flex items-center gap-1.5">
                        <Download size={12} /> AnimeSalt
                      </button>
                      <button onClick={epAddSeason}
                        className="px-3 py-2 rounded-xl text-[11px] font-bold bg-purple-500/20 border border-purple-500/30 text-purple-400 hover:bg-purple-500/40 transition-all flex items-center gap-1.5">
                        <Plus size={12} /> Season
                      </button>
                    </div>
                  </div>

                  {/* JSON Import Section - Beautiful Panel */}
                  {jsonImportMode && (
                    <div className="bg-gradient-to-br from-blue-900/30 to-indigo-900/20 rounded-2xl border border-blue-500/20 p-4 mb-4 space-y-3">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="w-7 h-7 rounded-lg bg-blue-500/20 flex items-center justify-center">
                          <FolderOpen size={14} className="text-blue-400" />
                        </div>
                        <div>
                          <p className="text-[12px] font-semibold text-blue-200">JSON Import</p>
                          <p className="text-[9px] text-blue-400/70">Upload file or paste JSON text</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        {/* File Upload */}
                        <div className="bg-black/20 rounded-xl border border-blue-500/10 p-3 flex flex-col items-center justify-center gap-2 min-h-[120px] cursor-pointer hover:bg-blue-500/10 hover:border-blue-500/30 transition-all"
                          onClick={() => jsonFileRef.current?.click()}>
                          <input type="file" ref={jsonFileRef} accept=".json,application/json" multiple onChange={handleJsonFileUpload} className="hidden" />
                          <div className="w-10 h-10 rounded-full bg-blue-500/15 flex items-center justify-center">
                            <Download size={18} className="text-blue-400" />
                          </div>
                          <p className="text-[11px] font-semibold text-blue-300 text-center">Upload .json</p>
                          <p className="text-[9px] text-blue-400/50 text-center">Click to browse</p>
                        </div>

                        {/* Paste JSON */}
                        <div className="bg-black/20 rounded-xl border border-blue-500/10 p-3 flex flex-col gap-2">
                          <textarea
                            value={jsonPasteText}
                            onChange={e => setJsonPasteText(e.target.value)}
                            placeholder='{ "episodes": [...] }'
                            className="w-full flex-1 bg-black/30 border border-white/5 rounded-lg px-2.5 py-2 text-[10px] text-white placeholder:text-blue-400/30 focus:border-blue-500/50 focus:outline-none min-h-[70px] resize-none font-mono"
                          />
                          <button onClick={handleJsonPaste} disabled={!jsonPasteText.trim()}
                            className="w-full py-2 rounded-lg text-[10px] font-bold bg-gradient-to-r from-blue-600 to-indigo-600 text-white disabled:opacity-30 flex items-center justify-center gap-1.5 hover:from-blue-500 hover:to-indigo-500 transition-all">
                            <Download size={11} /> Import
                          </button>
                        </div>
                      </div>

                      <p className="text-[9px] text-blue-400/50 text-center">
                        Format: <code className="bg-black/30 px-1.5 py-0.5 rounded text-blue-300/70">episodes: [...]</code> or <code className="bg-black/30 px-1.5 py-0.5 rounded text-blue-300/70">seasons: [...]</code>
                      </p>
                    </div>
                  )}

                  {/* Hidden file input for per-season JSON import */}
                  <input type="file" ref={epSeasonJsonFileRef} accept=".json,application/json" multiple onChange={epHandleSeasonJsonFile} className="hidden" />

                  {epEditorSeasons.length === 0 ? (
                    <p className="text-[#957DAD] text-[13px] text-center py-8">কোনো সিজন নেই। "JSON ইমপোর্ট", "+ Season" বা "AnimeSalt লোড" ক্লিক করুন।</p>
                  ) : (
                    <div className="space-y-3">
                      {epEditorSeasons.map((season, sIdx) => (
                        <div key={sIdx} className="bg-[#151521] rounded-xl border border-white/5 overflow-hidden">
                          {/* Season header */}
                          <div className="flex items-center gap-2 p-3">
                            <input
                              value={season.name}
                              onChange={e => epUpdateSeasonName(sIdx, e.target.value)}
                              className="flex-1 min-w-0 bg-transparent border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none"
                            />
                            <button onClick={() => epRemoveSeason(sIdx)}
                              className="bg-red-500/20 text-red-400 p-2 rounded-lg hover:bg-red-500/40 transition-all flex-shrink-0">
                              <Trash2 size={14} />
                            </button>
                          </div>
                          <div className="px-3 pb-3 flex items-center justify-between">
                            <span className="text-[11px] text-[#D1C4E9]">Episodes: {season.episodes.length}</span>
                            <div className="flex gap-1.5 items-center">
                              <button onClick={() => { setEpSeasonJsonTarget(sIdx); epSeasonJsonFileRef.current?.click(); }}
                                className="px-2.5 py-1.5 rounded-lg text-[10px] font-bold bg-blue-500/20 border border-blue-500/30 text-blue-400 hover:bg-blue-500/40 transition-all flex items-center gap-1">
                                <FolderOpen size={10} /> JSON
                              </button>
                              <button onClick={() => setEpEditorExpandedSeason(prev => prev === sIdx ? -1 : sIdx)}
                                className="px-3 py-1.5 rounded-lg text-[10px] font-medium bg-[#1A1A2E] border border-white/10 text-[#D1C4E9] hover:border-purple-500/40 transition-all flex items-center gap-1">
                                <ChevronDown size={12} className={`transition-transform ${epEditorExpandedSeason === sIdx ? 'rotate-180' : ''}`} /> Episodes
                              </button>
                            </div>
                          </div>

                          {/* Episodes expanded */}
                          {epEditorExpandedSeason === sIdx && (
                            <div className="px-3 pb-3 space-y-2">
                              {season.episodes.map((ep: any, eIdx: number) => {
                                const hasCustomLink = !!(ep.link || ep.link480 || ep.link720 || ep.link1080 || ep.link4k);
                                return (
                                  <div key={eIdx} className={`bg-[#1A1A2E] rounded-xl p-3 border ${hasCustomLink ? 'border-green-500/30' : 'border-white/5'}`}>
                                    <div className="flex items-center justify-between mb-2">
                                      <span className="text-xs font-semibold text-purple-400">Episode {ep.number}</span>
                                      <div className="flex items-center gap-1.5">
                                        {ep.hasAnimeSaltLink && (
                                          <span className="text-[9px] bg-yellow-500/15 text-yellow-400 px-2 py-0.5 rounded-full">
                                            AnimeSalt লিংক আছে
                                          </span>
                                        )}
                                        {hasCustomLink && (
                                          <span className="text-[9px] bg-green-500/15 text-green-400 px-2 py-0.5 rounded-full">
                                            কাস্টম লিংক
                                          </span>
                                        )}
                                        <button onClick={() => epRemoveEpisode(sIdx, eIdx)}
                                          className="bg-red-500/20 text-red-400 p-1.5 rounded-lg hover:bg-red-500/40 transition-all">
                                          <Trash2 size={12} />
                                        </button>
                                      </div>
                                    </div>
                                    <div className="space-y-2">
                                      <div>
                                        <span className="text-[9px] text-[#957DAD] font-medium mb-1 block">Default</span>
                                        <textarea
                                          value={ep.link || ''}
                                          onChange={e => epUpdateEpisodeField(sIdx, eIdx, 'link', e.target.value)}
                                          className={`${inputClass} w-full !py-2 !text-[10px] min-h-[44px] resize-none break-all`}
                                          placeholder={ep.hasAnimeSaltLink ? 'AnimeSalt লিংক ব্যবহার হবে' : 'লিংক দিন...'}
                                          rows={2}
                                        />
                                      </div>
                                      {['480p', '720p', '1080p', '4K'].map(q => {
                                        const qKey = `link${q === '4K' ? '4k' : q}`;
                                        return (
                                          <div key={q}>
                                            <span className="text-[9px] text-[#957DAD] font-medium mb-1 block">{q}</span>
                                            <textarea
                                              value={ep[qKey] || ''}
                                              onChange={e => epUpdateEpisodeField(sIdx, eIdx, qKey, e.target.value)}
                                              className={`${inputClass} w-full !py-2 !text-[10px] min-h-[44px] resize-none break-all`}
                                              placeholder={`${q} link (optional)`}
                                              rows={2}
                                            />
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                );
                              })}
                              <button onClick={() => epAddEpisode(sIdx)}
                                className={`${btnSecondary} w-full py-2.5 text-xs mt-1 flex items-center justify-center gap-1`}>
                                <Plus size={12} /> Add Episode
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Action buttons - sticky at bottom */}
                <div className="flex gap-2 mt-4 flex-shrink-0 pt-2 border-t border-white/5">
                  <button onClick={saveEpisodeData} disabled={epEditorSaving}
                    className="flex-1 py-2.5 rounded-lg text-[12px] font-bold bg-gradient-to-r from-purple-600 to-purple-800 text-white flex items-center justify-center gap-1.5">
                    {epEditorSaving ? <RefreshCw size={12} className="animate-spin" /> : <Save size={12} />} সেভ করুন
                  </button>
                  <button onClick={deleteAllEpisodeData}
                    className="px-4 py-2.5 rounded-lg text-[12px] font-bold bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/40 transition-all flex items-center gap-1">
                    <Trash2 size={12} /> সব ডিলিট
                  </button>
                  <button onClick={() => setEpEditorSlug(null)}
                    className="px-4 py-2.5 rounded-lg text-[12px] bg-[#151521] border border-white/10 text-[#D1C4E9]">
                    বন্ধ
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div className={`${glassCard} p-4 mb-4`}>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Zap size={14} className="text-yellow-500" /> AnimeSalt Manager
          </h3>
          <button onClick={handleRefresh} disabled={refreshing}
            className={`px-3 py-1.5 rounded-full text-[11px] font-medium flex items-center gap-1.5 transition-all ${
              refreshing ? 'bg-purple-500/30 text-purple-300' : 'bg-purple-500/20 text-purple-400 hover:bg-purple-500/40'
            }`}>
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? 'রিফ্রেশ...' : 'রিফ্রেশ'}
          </button>
        </div>
        <p className="text-[11px] text-[#D1C4E9] mb-3">
          AnimeSalt থেকে কন্টেন্ট ব্রাউজ করুন, যেটা পছন্দ সেটা এড করুন। TMDB থেকে সঠিক পোস্টার ও মেটাডাটা অটো আসবে।
        </p>
        <div className="flex items-center gap-3 mb-3">
          <div className="bg-purple-500/20 text-purple-400 px-3 py-1.5 rounded-full text-xs font-bold">
            মোট: {allItems.length}
          </div>
          <div className="bg-green-500/20 text-green-400 px-3 py-1.5 rounded-full text-xs font-bold">
            এড করা: {addedCount}
          </div>
        </div>
        <div className="mb-3">
          <label className="text-[11px] text-[#957DAD] mb-1 block">ক্যাটাগরি (এড করার জন্য) <span className="text-red-400">*</span></label>
          <select value={addCategory} onChange={e => setAddCategory(e.target.value)} className={selectClass}>
            <option value="">সিলেক্ট করুন</option>
            {categoryList.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
          </select>
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-purple-500" />
          <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            className={`${inputClass} pl-9`} placeholder="সার্চ করুন..." />
        </div>
      </div>

      {/* URL Import Section */}
      <div className={`${glassCard} p-4 mb-4`}>
        <h4 className="text-[13px] font-semibold flex items-center gap-2 mb-2">
          <Link size={14} className="text-cyan-400" /> লিংক দিয়ে এড করুন
        </h4>
        <p className="text-[10px] text-[#D1C4E9] mb-2">
          AnimeSalt ওয়েবসাইট থেকে সিরিজ/মুভির লিংক পেস্ট করুন। যেসব এনিমে ক্যাটালগে নেই সেগুলো এভাবে এড করুন।
        </p>
        <div className="flex gap-2 mb-2">
          <input
            value={urlInput}
            onChange={e => setUrlInput(e.target.value)}
            className={`${inputClass} flex-1`}
            placeholder="https://animesalt.ac/series/anime-name/"
            onKeyDown={e => e.key === 'Enter' && fetchFromUrl()}
          />
          <button onClick={fetchFromUrl} disabled={urlFetching}
            className="px-4 py-2 rounded-lg text-[11px] font-bold bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/40 transition-all flex items-center gap-1.5 flex-shrink-0">
            {urlFetching ? <RefreshCw size={12} className="animate-spin" /> : <Search size={12} />}
            {urlFetching ? 'ফেচিং...' : 'ফেচ'}
          </button>
        </div>

        {/* Fetched item preview */}
        {urlFetchedItem && (
          <div className="bg-[#151521] rounded-xl border border-cyan-500/20 p-3 flex gap-3 items-start">
            {urlFetchedItem.poster && (
              <img src={urlFetchedItem.poster} className="w-16 h-24 object-cover rounded-lg flex-shrink-0"
                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-white line-clamp-2">{urlFetchedItem.title}</p>
              <p className="text-[10px] text-[#D1C4E9] mt-0.5">
                {urlFetchedItem.type === 'movies' ? '🎬 Movie' : '📺 Series'} • {urlFetchedItem.year || 'N/A'}
                {urlFetchedItem.seasons?.length > 0 && ` • ${urlFetchedItem.seasons.length} Seasons`}
              </p>
              {urlFetchedItem.storyline && (
                <p className="text-[10px] text-[#957DAD] mt-1 line-clamp-2">{urlFetchedItem.storyline}</p>
              )}
              {isAdded(urlFetchedItem.slug) ? (
                <div className="mt-2 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-[11px] text-green-400">
                    <Check size={12} /> আগে থেকেই এড করা আছে
                  </div>
                  <div className="flex gap-1.5">
                    <button onClick={() => { openEditModal(urlFetchedItem.slug); }}
                      className="flex-1 py-1.5 rounded-lg text-[10px] font-bold bg-blue-500/20 border border-blue-500/30 text-blue-400 hover:bg-blue-500/40 flex items-center justify-center gap-1">
                      <Edit size={10} /> Edit
                    </button>
                    <button onClick={() => removeItem(urlFetchedItem.slug)}
                      className="flex-1 py-1.5 rounded-lg text-[10px] font-bold bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/40 flex items-center justify-center gap-1">
                      <Trash2 size={10} /> ডিলিট করে আবার এড করুন
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={addFetchedItem} disabled={!addCategory || addingSlug === urlFetchedItem.slug}
                  className={`mt-2 w-full py-2 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all ${
                    !addCategory ? 'bg-gray-500/30 text-gray-400 cursor-not-allowed' :
                    addingSlug === urlFetchedItem.slug ? 'bg-purple-500/30 text-purple-300 cursor-wait' :
                    'bg-gradient-to-r from-purple-600 to-purple-800 text-white hover:shadow-[0_2px_10px_rgba(157,78,221,0.5)]'
                  }`}>
                  {addingSlug === urlFetchedItem.slug ? <><RefreshCw size={10} className="animate-spin" /> Adding...</> :
                   !addCategory ? <><AlertTriangle size={10} /> প্রথমে ক্যাটাগরি সিলেক্ট করুন</> :
                   <><Download size={10} /> এড করুন</>}
                </button>
              )}
            </div>
            <button onClick={() => { setUrlFetchedItem(null); setUrlInput(""); }}
              className="text-[#957DAD] hover:text-white flex-shrink-0"><X size={16} /></button>
          </div>
        )}
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2.5 mb-4 scrollbar-hide">
        {([
          { key: "all", label: "📋 সব", count: allItems.length },
          { key: "series", label: "📺 সিরিজ", count: allItems.filter(i => i.type === 'series').length },
          { key: "movies", label: "🎬 মুভি", count: allItems.filter(i => i.type === 'movies').length },
          { key: "added", label: "✅ এড করা", count: addedCount },
        ] as const).map(tab => (
          <button key={tab.key} onClick={() => setFilterType(tab.key as any)}
            className={`flex-shrink-0 px-4 py-2 rounded-full text-[12px] font-medium transition-all ${
              filterType === tab.key
                ? "bg-gradient-to-r from-purple-500 to-purple-800 text-white shadow-[0_4px_15px_rgba(157,78,221,0.4)]"
                : "bg-[#151521] border border-white/10 text-[#D1C4E9]"
            }`}>
            {tab.label} ({tab.count})
          </button>
        ))}
      </div>

      {/* Content Grid */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-10 h-10 border-4 border-[#151521] border-t-purple-500 rounded-full animate-spin" />
        </div>
      ) : filteredItems.length === 0 ? (
        <p className="text-[#957DAD] text-[13px] text-center py-8">কোনো আইটেম পাওয়া যায়নি</p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {filteredItems.map(item => {
            const added = isAdded(item.slug);
            const importing = addingSlug === item.slug;
            const removing = removingSlug === item.slug;
            const savedData = selectedItems[item.slug];

            return (
              <div key={item.slug} className={`relative rounded-xl overflow-hidden border-2 transition-all ${
                added ? "border-green-500/50" : "border-transparent hover:border-purple-500/50"
              }`}>
                <img
                  src={added && savedData?.poster ? savedData.poster : (item.poster || '')}
                  className="w-full aspect-[2/3] object-cover"
                  onError={e => { (e.target as HTMLImageElement).src = "https://via.placeholder.com/200x300/1A1A2E/9D4EDD?text=No+Image"; }}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />

                {added && (
                  <div className="absolute top-2 right-2 bg-green-500 text-white text-[9px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                    <Check size={10} /> Added
                  </div>
                )}

                <div className="absolute top-2 left-2 bg-purple-500/80 text-white text-[9px] font-bold px-2 py-0.5 rounded">
                  {item.type === 'series' ? '📺 Series' : '🎬 Movie'}
                </div>

                <div className="absolute bottom-0 left-0 right-0 p-2.5">
                  <p className="text-[11px] font-semibold leading-tight line-clamp-2 mb-1">{item.title}</p>
                  <p className="text-[9px] text-[#D1C4E9] mb-2">{item.year || 'N/A'}</p>

                  {added ? (
                    <div className="space-y-1.5">
                      <select
                        value={savedData?.category || ''}
                        onChange={e => updateItemCategory(item.slug, e.target.value)}
                        className="w-full bg-black/60 border border-green-500/30 rounded-lg text-[10px] text-white px-2 py-1.5"
                      >
                        <option value="">No Category</option>
                        {categoryList.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                      </select>
                      <button
                        onClick={() => openEditModal(item.slug)}
                        className="w-full py-1.5 rounded-lg text-[10px] font-bold bg-blue-500/20 border border-blue-500/30 text-blue-400 hover:bg-blue-500/40 transition-all flex items-center justify-center gap-1"
                      >
                        <Edit size={10} /> Edit Details
                      </button>
                      {item.type === 'series' && (
                        <button
                          onClick={() => openEpisodeEditor(item.slug)}
                          className="w-full py-1.5 rounded-lg text-[10px] font-bold bg-yellow-500/20 border border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/40 transition-all flex items-center justify-center gap-1"
                        >
                          <List size={10} /> Edit Episodes
                        </button>
                      )}
                      <button
                        onClick={() => removeItem(item.slug)}
                        disabled={removing}
                        className="w-full py-1.5 rounded-lg text-[10px] font-bold bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/40 transition-all flex items-center justify-center gap-1"
                      >
                        {removing ? <RefreshCw size={10} className="animate-spin" /> : <Trash2 size={10} />}
                        বাতিল করুন
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => addItem(item)}
                      disabled={importing || !addCategory}
                      className={`w-full py-1.5 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1 transition-all ${
                        importing
                          ? "bg-purple-500/30 text-purple-300 cursor-wait"
                          : !addCategory
                          ? "bg-gray-500/30 text-gray-400 cursor-not-allowed"
                          : "bg-gradient-to-r from-purple-600 to-purple-800 text-white hover:shadow-[0_2px_10px_rgba(157,78,221,0.5)]"
                      }`}
                    >
                      {importing ? (
                        <><RefreshCw size={10} className="animate-spin" /> Adding...</>
                      ) : (
                        <><Download size={10} /> এড করুন</>
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// Device Limits Section
const DeviceLimitsSection = ({ glassCard, inputClass, btnPrimary, btnSecondary, usersData, formatTime }: {
  glassCard: string; inputClass: string; btnPrimary: string; btnSecondary: string; usersData: any[]; formatTime: (ts: number) => string;
}) => {
  const [premiumUsers, setPremiumUsers] = useState<any[]>([]);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [userDevices, setUserDevices] = useState<Record<string, any[]>>({});
  const [loadingDevices, setLoadingDevices] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [editingExpiry, setEditingExpiry] = useState<string | null>(null);
  const [expiryDaysInput, setExpiryDaysInput] = useState("");

  const [appUsersMap, setAppUsersMap] = useState<Record<string, any>>({});

  useEffect(() => {
    const pUsers = usersData.filter(u => u.premium?.active && u.premium?.expiresAt > Date.now());
    setPremiumUsers(pUsers);
  }, [usersData]);

  // Load appUsers to get names/emails/photos for users whose data might be stored with comma keys
  useEffect(() => {
    const unsub = onValue(ref(db, "appUsers"), (snap) => {
      const data = snap.val() || {};
      const map: Record<string, any> = {};
      Object.values(data).forEach((u: any) => {
        if (u.id) map[u.id] = u;
      });
      setAppUsersMap(map);
    });
    return () => unsub();
  }, []);

  const loadDevices = async (userId: string) => {
    if (expandedUser === userId) { setExpandedUser(null); return; }
    setExpandedUser(userId);
    setLoadingDevices(userId);
    try {
      const { getUserDevices } = await import("@/lib/premiumDevice");
      const devices = await getUserDevices(userId);
      setUserDevices(prev => ({ ...prev, [userId]: devices }));
    } catch {}
    setLoadingDevices(null);
  };

  const removeDeviceHandler = async (userId: string, deviceId: string) => {
    if (!confirm("এই ডিভাইস রিমুভ করতে চান?")) return;
    try {
      const { removeDevice: rmDev } = await import("@/lib/premiumDevice");
      await rmDev(userId, deviceId);
      setUserDevices(prev => ({ ...prev, [userId]: (prev[userId] || []).filter(d => d.id !== deviceId) }));
      toast.success("ডিভাইস রিমুভ হয়েছে");
    } catch { toast.error("Error removing device"); }
  };

  const cancelSubscription = async (userId: string, userName: string) => {
    if (!confirm(`"${userName}" এর সাবস্ক্রিপশন বাতিল করতে চান? ডিভাইস লিস্টও ক্লিয়ার হবে।`)) return;
    try {
      await remove(ref(db, `users/${userId}/premium`));
      setUserDevices(prev => { const copy = { ...prev }; delete copy[userId]; return copy; });
      const notifRef = push(ref(db, `notifications/${userId}`));
      await set(notifRef, {
        title: "Subscription Cancelled ❌",
        message: "আপনার প্রিমিয়াম সাবস্ক্রিপশন অ্যাডমিন কর্তৃক বাতিল করা হয়েছে।",
        type: "warning",
        timestamp: Date.now(),
        read: false,
      });
      toast.success("সাবস্ক্রিপশন বাতিল ও ইউজারকে নোটিফাই করা হয়েছে");
    } catch { toast.error("Error cancelling"); }
  };

  const setDeviceAsOnly = async (userId: string, allowedDeviceId: string) => {
    if (!confirm("শুধুমাত্র এই ডিভাইসে অ্যাক্সেস দিতে চান? বাকি সব ডিভাইস রিমুভ হবে।")) return;
    try {
      const devices = userDevices[userId] || [];
      for (const dev of devices) {
        if (dev.id !== allowedDeviceId) {
          await remove(ref(db, `users/${userId}/premium/devices/${dev.id}`));
        }
      }
      setUserDevices(prev => ({
        ...prev,
        [userId]: (prev[userId] || []).filter(d => d.id === allowedDeviceId),
      }));
      toast.success("শুধুমাত্র নির্বাচিত ডিভাইসে অ্যাক্সেস দেওয়া হয়েছে");
    } catch { toast.error("Error updating devices"); }
  };

  const updateMaxDevices = async (userId: string, maxDevices: number) => {
    try {
      await update(ref(db, `users/${userId}/premium`), { maxDevices });
      toast.success(`ডিভাইস লিমিট ${maxDevices} এ আপডেট হয়েছে`);
    } catch { toast.error("Error updating"); }
  };

  const updateExpiryDays = async (userId: string) => {
    const days = parseInt(expiryDaysInput);
    if (isNaN(days) || days < 0) { toast.error("সঠিক দিন সংখ্যা দিন"); return; }
    try {
      const newExpiry = Date.now() + days * 86400000;
      await update(ref(db, `users/${userId}/premium`), { expiresAt: newExpiry });
      toast.success(`প্রিমিয়াম ${days} দিনে আপডেট হয়েছে`);
      setEditingExpiry(null);
      setExpiryDaysInput("");
    } catch { toast.error("Error updating expiry"); }
  };

  const filteredPremiumUsers = searchQuery.trim()
    ? premiumUsers.filter(u =>
        (u.name || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (u.email || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        u.id.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : premiumUsers;

  return (
    <div>
      <div className={`${glassCard} p-4 mb-4`}>
        <h3 className="text-sm font-semibold mb-3.5 flex items-center gap-2">
          <Lock size={14} className="text-yellow-500" /> Premium Device Limits ({premiumUsers.length} active)
        </h3>
        <p className="text-[11px] text-[#D1C4E9] mb-4">
          প্রিমিয়াম ইউজারদের ডিভাইস লিমিট ম্যানেজ করুন। নির্দিষ্ট ডিভাইসে অ্যাক্সেস দিন, বাকিগুলো ব্লক করুন, বা সাবস্ক্রিপশন বাতিল করুন।
        </p>

        {premiumUsers.length > 0 && (
          <div className="relative mb-3">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-yellow-500" />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className={`${inputClass} pl-9`}
              placeholder="ইউজার সার্চ করুন (নাম, ইমেইল)..."
            />
          </div>
        )}

        {filteredPremiumUsers.length === 0 ? (
          <p className="text-[#957DAD] text-[13px] text-center py-8">
            {searchQuery ? "কোন ইউজার পাওয়া যায়নি" : "কোন প্রিমিয়াম ইউজার নেই"}
          </p>
        ) : (
          <div className="space-y-2.5">
            {filteredPremiumUsers.map(rawUser => {
              // Merge with appUsers data for better name/email/photo
              const appData = appUsersMap[rawUser.id] || {};
              const user = {
                ...rawUser,
                name: rawUser.name || appData.name || rawUser.email?.split("@")[0] || "",
                email: rawUser.email || appData.email || "",
                photoURL: rawUser.photoURL || appData.photoURL || appData.photo || "",
              };
              const prem = user.premium || {};
              const devices = prem.devices ? Object.keys(prem.devices).length : 0;
              const maxDev = prem.maxDevices || 1;
              const daysLeft = Math.max(0, Math.ceil((prem.expiresAt - Date.now()) / 86400000));
              const isExpanded = expandedUser === user.id;

              return (
                <div key={user.id} className={`rounded-xl border transition-colors ${isExpanded ? "bg-yellow-500/5 border-yellow-500/30" : "bg-[#1A1A2E] border-white/5"}`}>
                  <div className="p-3 cursor-pointer" onClick={() => loadDevices(user.id)}>
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {user.photoURL || user.photo ? (
                          <img src={user.photoURL || user.photo} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-yellow-500/20 flex items-center justify-center flex-shrink-0 text-[11px] font-bold text-yellow-400">
                            {(user.name || user.email || "?").charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="text-sm font-semibold truncate">{user.name || user.email || "Unknown User"}</p>
                          <p className="text-[10px] text-zinc-400 truncate">{user.email || ""}</p>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0 ml-2">
                        <div className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${devices >= maxDev ? "bg-red-500/20 text-red-400" : "bg-green-500/20 text-green-400"}`}>
                          📱 {devices}/{maxDev}
                        </div>
                      </div>
                    </div>
                    {/* Prominent days remaining */}
                    <div className="flex items-center gap-3 mt-2">
                      <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold ${
                        daysLeft <= 3 ? "bg-red-500/20 text-red-400" : daysLeft <= 7 ? "bg-yellow-500/20 text-yellow-400" : "bg-green-500/20 text-green-400"
                      }`}>
                        ⏳ {daysLeft} দিন বাকি
                      </div>
                      <span className="text-[9px] text-zinc-500">{prem.method || "redeem"} • {new Date(prem.expiresAt).toLocaleDateString("bn-BD")}</span>
                      <ChevronDown size={12} className={`text-zinc-500 transition-transform ml-auto ${isExpanded ? "rotate-180" : ""}`} />
                    </div>
                    <div className="flex items-center gap-2 mt-1.5">
                      <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${devices >= maxDev ? "bg-red-500" : "bg-yellow-500"}`} style={{ width: `${Math.min(100, (devices / maxDev) * 100)}%` }} />
                      </div>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="px-3 pb-3 border-t border-white/5 pt-2">
                      {loadingDevices === user.id ? (
                        <div className="text-center py-3"><div className="w-5 h-5 border-2 border-zinc-700 border-t-yellow-500 rounded-full animate-spin mx-auto" /></div>
                      ) : (
                        <>
                          {/* Expiry Edit */}
                          <div className="mb-3 bg-black/20 rounded-lg p-2">
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-[10px] text-zinc-400 font-semibold">⏳ প্রিমিয়াম মেয়াদ: {daysLeft} দিন বাকি</span>
                              <button 
                                onClick={(e) => { e.stopPropagation(); setEditingExpiry(editingExpiry === user.id ? null : user.id); setExpiryDaysInput(String(daysLeft)); }}
                                className="text-[10px] text-yellow-400 hover:text-yellow-300 font-semibold"
                              >
                                {editingExpiry === user.id ? "বাতিল" : "✏️ এডিট"}
                              </button>
                            </div>
                            {editingExpiry === user.id && (
                              <div className="flex items-center gap-2 mt-1.5">
                                <input
                                  type="number"
                                  value={expiryDaysInput}
                                  onChange={e => setExpiryDaysInput(e.target.value)}
                                  onClick={e => e.stopPropagation()}
                                  className={`${inputClass} !py-1.5 flex-1`}
                                  placeholder="দিন সংখ্যা..."
                                  min="0"
                                />
                                <span className="text-[10px] text-zinc-500">দিন</span>
                                <button
                                  onClick={(e) => { e.stopPropagation(); updateExpiryDays(user.id); }}
                                  className="px-3 py-1.5 rounded-lg bg-yellow-500/20 text-yellow-400 text-[10px] font-bold hover:bg-yellow-500/40 transition-colors"
                                >
                                  সেভ
                                </button>
                              </div>
                            )}
                          </div>

                          {/* Device Limit Control */}
                          <div className="flex items-center gap-2 mb-3 bg-black/20 rounded-lg p-2">
                            <span className="text-[10px] text-zinc-400 flex-shrink-0">Max Devices:</span>
                            <div className="flex gap-1">
                              {[1, 2, 3, 4, 5].map(n => (
                                <button key={n} onClick={(e) => { e.stopPropagation(); updateMaxDevices(user.id, n); }}
                                  className={`w-7 h-7 rounded-lg text-[11px] font-bold transition-colors ${
                                    maxDev === n ? "bg-yellow-500 text-black" : "bg-white/5 text-zinc-400 hover:bg-white/10"
                                  }`}>{n}</button>
                              ))}
                            </div>
                          </div>

                          <p className="text-[10px] text-zinc-400 mb-2 font-semibold">রেজিস্টার্ড ডিভাইস ({(userDevices[user.id] || []).length}):</p>
                          {(userDevices[user.id] || []).length === 0 ? (
                            <p className="text-[10px] text-zinc-500 text-center py-2">কোন ডিভাইস রেজিস্টার্ড নেই</p>
                          ) : (
                            <div className="space-y-1.5 mb-3">
                              {(userDevices[user.id] || []).map((dev, idx) => (
                                <div key={dev.id} className="flex items-center gap-2 bg-black/20 rounded-lg p-2.5">
                                  <span className="text-lg">{dev.type === "mobile" ? "📱" : dev.type === "tablet" ? "📋" : "💻"}</span>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-[11px] font-medium truncate">{dev.name}</p>
                                    <p className="text-[9px] text-zinc-500">
                                      {idx === 0 ? "🥇 First Device" : `#${idx + 1}`} • Last: {formatTime(dev.lastSeen)}
                                    </p>
                                    <p className="text-[8px] text-zinc-600 font-mono truncate">{dev.id}</p>
                                  </div>
                                  <div className="flex gap-1 flex-shrink-0">
                                    <button onClick={(e) => { e.stopPropagation(); setDeviceAsOnly(user.id, dev.id); }}
                                      title="শুধু এই ডিভাইসে অ্যাক্সেস দিন"
                                      className="bg-green-500/20 text-green-400 p-1.5 rounded-lg hover:bg-green-500/40 transition-colors">
                                      <Check size={12} />
                                    </button>
                                    <button onClick={(e) => { e.stopPropagation(); removeDeviceHandler(user.id, dev.id); }}
                                      title="এই ডিভাইস রিমুভ করুন"
                                      className="bg-red-500/20 text-red-400 p-1.5 rounded-lg hover:bg-red-500/40 transition-colors">
                                      <Trash2 size={12} />
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Action buttons */}
                          <div className="flex gap-2">
                            <button onClick={(e) => { e.stopPropagation(); cancelSubscription(user.id, user.name || user.id); }}
                              className="flex-1 py-2 rounded-lg bg-red-500/20 border border-red-500/30 text-red-400 text-[10px] font-semibold hover:bg-red-500/40 transition-colors flex items-center justify-center gap-1">
                              <X size={11} /> সাবস্ক্রিপশন বাতিল
                            </button>
                            <button onClick={(e) => {
                              e.stopPropagation();
                              if (!confirm("সব ডিভাইস রিমুভ করতে চান?")) return;
                              const devices = userDevices[user.id] || [];
                              Promise.all(devices.map(d => remove(ref(db, `users/${user.id}/premium/devices/${d.id}`))))
                                .then(() => {
                                  setUserDevices(prev => ({ ...prev, [user.id]: [] }));
                                  toast.success("সব ডিভাইস রিমুভ হয়েছে");
                                }).catch(() => toast.error("Error"));
                            }}
                              className="flex-1 py-2 rounded-lg bg-yellow-500/20 border border-yellow-500/30 text-yellow-400 text-[10px] font-semibold hover:bg-yellow-500/40 transition-colors flex items-center justify-center gap-1">
                              <Trash2 size={11} /> সব ডিভাইস ক্লিয়ার
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

// Admin Authorized Emails sub-component
const AdminAuthorizedEmails = ({ glassCard, inputClass, btnPrimary, btnSecondary }: { glassCard: string; inputClass: string; btnPrimary: string; btnSecondary: string }) => {
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [newEmail, setNewEmail] = useState("");

  useEffect(() => {
    const unsub = onValue(ref(db, "admin/authorizedEmails"), (snap) => {
      setEmails(snap.val() || {});
    });
    return () => unsub();
  }, []);

  const addEmail = async () => {
    if (!newEmail.trim() || !newEmail.includes("@")) { toast.error("সঠিক ইমেইল দিন"); return; }
    const key = push(ref(db, "admin/authorizedEmails")).key;
    if (!key) return;
    await set(ref(db, `admin/authorizedEmails/${key}`), newEmail.trim());
    setNewEmail("");
    toast.success("ইমেইল যোগ হয়েছে!");
  };

  const removeEmail = async (key: string) => {
    await remove(ref(db, `admin/authorizedEmails/${key}`));
    toast.success("ইমেইল মুছে ফেলা হয়েছে");
  };

  return (
    <div>
      <div className="flex gap-2 mb-3">
        <input value={newEmail} onChange={e => setNewEmail(e.target.value)} className={`${inputClass} flex-1`}
          placeholder="admin@gmail.com" onKeyDown={e => e.key === "Enter" && addEmail()} />
        <button onClick={addEmail} className={`${btnPrimary} !px-4`}>
          <Plus size={14} /> Add
        </button>
      </div>
      {Object.entries(emails).length === 0 ? (
        <p className="text-[11px] text-zinc-500 text-center py-3">কোনো Google ইমেইল যোগ করা হয়নি</p>
      ) : (
        <div className="space-y-2">
          {Object.entries(emails).map(([key, email]) => (
            <div key={key} className="flex items-center justify-between bg-[#141422] border border-white/6 rounded-lg px-3 py-2">
              <span className="text-[12px] text-zinc-300 truncate">{email}</span>
              <button onClick={() => removeEmail(key)} className="text-red-400 hover:text-red-300 ml-2 flex-shrink-0">
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// CDN Toggle sub-component
const CdnToggle = ({ glassCard }: { glassCard: string }) => {
  const [cdnEnabled, setCdnEnabled] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onValue(ref(db, "settings/cdnEnabled"), (snap) => {
      const val = snap.val();
      setCdnEnabled(val !== false); // default true
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const toggle = async () => {
    const newVal = !cdnEnabled;
    try {
      await set(ref(db, "settings/cdnEnabled"), newVal);
      setCdnEnabled(newVal);
      toast.success(newVal ? "Cloudflare CDN চালু হয়েছে" : "Cloudflare CDN বন্ধ হয়েছে");
    } catch {
      toast.error("সেভ ব্যর্থ");
    }
  };

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className={`w-3 h-3 rounded-full ${cdnEnabled ? 'bg-green-500' : 'bg-red-500'}`} />
        <span className="text-sm font-medium">{cdnEnabled ? 'CDN চালু আছে' : 'CDN বন্ধ আছে'}</span>
      </div>
      <button
        onClick={toggle}
        disabled={loading}
        className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${cdnEnabled ? 'bg-green-600' : 'bg-zinc-600'}`}
      >
        <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${cdnEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
      </button>
    </div>
  );
};

// Proxy Server presets - only range-safe proxies for reliable seek/skip
const PROXY_SERVERS = [
  { id: 'supabase', name: 'Supabase Edge (Default)', region: '🌐 Auto Region • Range ✓', url: '' },
];

// Proxy Server Selector sub-component
const ProxyServerSelector = ({ glassCard }: { glassCard: string }) => {
  const [activeProxy, setActiveProxy] = useState('supabase');
  const [customUrl, setCustomUrl] = useState('');
  const [customProxies, setCustomProxies] = useState<{ id: string; name: string; url: string }[]>([]);
  const [newProxyName, setNewProxyName] = useState('');
  const [newProxyUrl, setNewProxyUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { speed: number; status: 'ok' | 'fail' }>>({});
  const [showAddForm, setShowAddForm] = useState(false);

  useEffect(() => {
    const unsub1 = onValue(ref(db, "settings/proxyServer"), async (snap) => {
      const val = snap.val();
      const incomingId = val?.id || 'supabase';
      if (incomingId === 'supabase' || String(incomingId).startsWith('custom_')) {
        setActiveProxy(incomingId);
      } else {
        // Auto-heal old unsupported proxy selections
        await set(ref(db, "settings/proxyServer"), { id: 'supabase', url: '' });
        setActiveProxy('supabase');
      }
      setLoading(false);
    });
    const unsub2 = onValue(ref(db, "settings/customProxies"), (snap) => {
      const val = snap.val();
      if (val) {
        const list = Object.entries(val).map(([key, v]: any) => ({ id: key, name: v.name, url: v.url }));
        setCustomProxies(list);
      } else {
        setCustomProxies([]);
      }
    });
    return () => { unsub1(); unsub2(); };
  }, []);

  const allProxies = [...PROXY_SERVERS, ...customProxies.map(c => ({ ...c, region: '⚙️ Custom' }))];

  const selectProxy = async (id: string) => {
    try {
      const proxy = allProxies.find(p => p.id === id);
      const url = proxy?.url || '';
      await set(ref(db, "settings/proxyServer"), { id, url });
      setActiveProxy(id);
      toast.success(`প্রক্সি: ${proxy?.name || id}`);
    } catch {
      toast.error("সেভ ব্যর্থ");
    }
  };

  const addCustomProxy = async () => {
    if (!newProxyName.trim() || !newProxyUrl.trim()) { toast.error("নাম ও URL দাও"); return; }
    try {
      const id = `custom_${Date.now()}`;
      await set(ref(db, `settings/customProxies/${id}`), { name: newProxyName.trim(), url: newProxyUrl.trim() });
      setNewProxyName('');
      setNewProxyUrl('');
      setShowAddForm(false);
      toast.success("কাস্টম প্রক্সি যোগ হয়েছে");
    } catch {
      toast.error("সেভ ব্যর্থ");
    }
  };

  const removeCustomProxy = async (id: string) => {
    try {
      await remove(ref(db, `settings/customProxies/${id}`));
      if (activeProxy === id) {
        await set(ref(db, "settings/proxyServer"), { id: 'supabase', url: '' });
        setActiveProxy('supabase');
      }
      toast.success("প্রক্সি মুছে ফেলা হয়েছে");
    } catch {
      toast.error("মুছতে ব্যর্থ");
    }
  };

  const testProxy = async (proxy: { id: string; url: string }) => {
    setTesting(proxy.id);
    const testUrl = 'https://www.google.com/favicon.ico';
    const start = performance.now();
    try {
      let fetchUrl = proxy.id === 'supabase'
        ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/video-proxy?url=${encodeURIComponent(testUrl)}`
        : `${proxy.url}${encodeURIComponent(testUrl)}`;

      const res = await fetch(fetchUrl, { method: 'GET', signal: AbortSignal.timeout(10000) });
      const elapsed = Math.round(performance.now() - start);
      setTestResults(prev => ({ ...prev, [proxy.id]: { speed: elapsed, status: res.ok ? 'ok' : 'fail' } }));
    } catch {
      const elapsed = Math.round(performance.now() - start);
      setTestResults(prev => ({ ...prev, [proxy.id]: { speed: elapsed, status: 'fail' } }));
    }
    setTesting(null);
  };

  if (loading) return <div className="text-xs text-zinc-500">লোড হচ্ছে...</div>;

  return (
    <div className="space-y-2">
      {allProxies.map(proxy => (
        <div
          key={proxy.id}
          className={`flex items-center justify-between p-2.5 rounded-lg border transition-all cursor-pointer ${
            activeProxy === proxy.id
              ? 'border-cyan-500/50 bg-cyan-500/10'
              : 'border-zinc-700/50 bg-zinc-800/30 hover:border-zinc-600'
          }`}
          onClick={() => selectProxy(proxy.id)}
        >
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${activeProxy === proxy.id ? 'bg-cyan-400' : 'bg-zinc-600'}`} />
            <div className="min-w-0">
              <div className="text-xs font-medium truncate">{proxy.name}</div>
              <div className="text-[10px] text-zinc-500">{'region' in proxy ? (proxy as any).region : '⚙️ Custom'}</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {testResults[proxy.id] && (
              <span className={`text-[10px] font-mono ${testResults[proxy.id].status === 'ok' ? 'text-green-400' : 'text-red-400'}`}>
                {testResults[proxy.id].status === 'ok' ? `${testResults[proxy.id].speed}ms` : 'ব্যর্থ'}
              </span>
            )}
            {proxy.id.startsWith('custom_') && (
              <button
                onClick={(e) => { e.stopPropagation(); removeCustomProxy(proxy.id); }}
                className="p-1 text-red-400 hover:text-red-300"
              >
                <Trash2 size={12} />
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); testProxy(proxy); }}
              disabled={testing === proxy.id}
              className="px-2 py-1 text-[10px] rounded bg-zinc-700 hover:bg-zinc-600 transition-colors disabled:opacity-50"
            >
              {testing === proxy.id ? '...' : 'টেস্ট'}
            </button>
          </div>
        </div>
      ))}

      {/* Add custom proxy */}
      {showAddForm ? (
        <div className="p-3 rounded-lg border border-dashed border-zinc-600 space-y-2">
          <input
            type="text"
            value={newProxyName}
            onChange={e => setNewProxyName(e.target.value)}
            placeholder="প্রক্সি নাম (যেমন: My Proxy)"
            className="w-full text-xs bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white placeholder-zinc-500 focus:border-cyan-500 outline-none"
          />
          <input
            type="text"
            value={newProxyUrl}
            onChange={e => setNewProxyUrl(e.target.value)}
            placeholder="প্রক্সি URL (যেমন: https://proxy.com/?url=)"
            className="w-full text-xs bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white placeholder-zinc-500 focus:border-cyan-500 outline-none"
          />
          <div className="flex gap-2">
            <button onClick={addCustomProxy} className="flex-1 py-2 text-xs bg-cyan-600 hover:bg-cyan-500 rounded-lg transition-colors">
              ✅ যোগ করো
            </button>
            <button onClick={() => { setShowAddForm(false); setNewProxyName(''); setNewProxyUrl(''); }} className="px-3 py-2 text-xs bg-zinc-700 hover:bg-zinc-600 rounded-lg transition-colors">
              বাতিল
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowAddForm(true)}
          className="w-full py-2 text-xs font-medium border border-dashed border-zinc-600 hover:border-cyan-500 rounded-lg transition-colors flex items-center justify-center gap-1.5"
        >
          <Plus size={12} /> কাস্টম প্রক্সি যোগ করো
        </button>
      )}

      {/* Test All button */}
      <button
        onClick={async () => {
          for (const p of allProxies) {
            await testProxy(p);
          }
        }}
        disabled={testing !== null}
        className="w-full mt-2 py-2 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors disabled:opacity-50"
      >
        {testing ? 'টেস্ট চলছে...' : '🚀 সব প্রক্সি টেস্ট করো'}
      </button>
    </div>
  );
};

// Image Refresh Section - re-fetch all poster/backdrop from TMDB
const ImageRefreshSection = ({
  glassCard, btnPrimary, webseriesData, moviesData,
}: {
  glassCard: string; btnPrimary: string;
  webseriesData: any[]; moviesData: any[];
}) => {
  const [refreshing, setRefreshing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, currentTitle: "" });
  const [errors, setErrors] = useState<string[]>([]);
  const [successCount, setSuccessCount] = useState(0);
  const [done, setDone] = useState(false);
  const [mode, setMode] = useState<"rs" | "animesalt" | "all">("animesalt");
  const [animesaltData, setAnimesaltData] = useState<Record<string, any>>({});

  useEffect(() => {
    const unsub = onValue(ref(db, 'animesaltSelected'), (snap) => {
      setAnimesaltData(snap.val() || {});
    });
    return () => unsub();
  }, []);

  const asCount = Object.keys(animesaltData).length;
  const rsCount = webseriesData.length + moviesData.length;

  const startRefresh = async () => {
    setRefreshing(true);
    setErrors([]);
    setSuccessCount(0);
    setDone(false);

    const allContent: { title: string; fbPath: string; searchType: string; source: string }[] = [];

    if (mode === "rs" || mode === "all") {
      webseriesData.forEach(w => allContent.push({ title: w.title, fbPath: `webseries/${w.id}`, searchType: "tv", source: "RS" }));
      moviesData.forEach(m => allContent.push({ title: m.title, fbPath: `movies/${m.id}`, searchType: "movie", source: "RS" }));
    }

    if (mode === "animesalt" || mode === "all") {
      Object.entries(animesaltData).forEach(([slug, item]: [string, any]) => {
        allContent.push({
          title: item.title || slug,
          fbPath: `animesaltSelected/${slug}`,
          searchType: item.type === "movies" ? "movie" : "tv",
          source: "AS",
        });
      });
    }

    setProgress({ current: 0, total: allContent.length, currentTitle: "" });
    const errorList: string[] = [];
    let success = 0;

    for (let i = 0; i < allContent.length; i++) {
      const item = allContent[i];
      setProgress({ current: i + 1, total: allContent.length, currentTitle: item.title });

      try {
        const searchRes = await fetch(
          `${TMDB_BASE_URL}/search/${item.searchType}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(item.title)}&language=en-US&page=1`
        );
        const searchData = await searchRes.json();
        const result = searchData.results?.[0];

        if (!result) {
          errorList.push(`❌ [${item.source}] ${item.title} — TMDB তে পাওয়া যায়নি`);
          setErrors([...errorList]);
          continue;
        }

        const poster = result.poster_path ? `https://image.tmdb.org/t/p/w500${result.poster_path}` : "";
        const backdrop = result.backdrop_path ? `https://image.tmdb.org/t/p/w1280${result.backdrop_path}` : "";

        const updates: Record<string, any> = {};
        if (poster) updates.poster = poster;
        if (backdrop) updates.backdrop = backdrop;

        if (Object.keys(updates).length > 0) {
          await update(ref(db, item.fbPath), updates);
          success++;
          setSuccessCount(success);
        }

        await new Promise(r => setTimeout(r, 300));
      } catch (err: any) {
        errorList.push(`⚠️ [${item.source}] ${item.title} — ${err.message || "Unknown error"}`);
        setErrors([...errorList]);
      }
    }

    setDone(true);
    setRefreshing(false);
    toast.success(`ইমেজ রিফ্রেশ সম্পন্ন! ${success}/${allContent.length} আপডেট হয়েছে`);
  };

  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
  const totalCount = mode === "rs" ? rsCount : mode === "animesalt" ? asCount : rsCount + asCount;

  return (
    <div className={`${glassCard} p-4 mb-4`}>
      <h3 className="text-sm font-semibold mb-3.5 flex items-center gap-2">
        <RefreshCw size={14} className="text-emerald-400" /> ইমেজ রিফ্রেশ (TMDB)
      </h3>
      <p className="text-[11px] text-zinc-400 mb-3">
        সব কন্টেন্টের Poster ও Backdrop ইমেজ TMDB থেকে নতুন করে আপডেট করবে।
      </p>

      {!refreshing && !done && (
        <div className="space-y-3">
          <div className="flex gap-2">
            {(["animesalt", "rs", "all"] as const).map(m => (
              <button key={m} onClick={() => setMode(m)}
                className={`flex-1 py-2 text-xs font-semibold rounded-lg border transition-colors ${mode === m ? "bg-indigo-600 border-indigo-500 text-white" : "bg-[#141422] border-white/8 text-zinc-400 hover:text-white"}`}>
                {m === "animesalt" ? `P2 (${asCount})` : m === "rs" ? `RS (${rsCount})` : `সব (${rsCount + asCount})`}
              </button>
            ))}
          </div>
          <button onClick={startRefresh} className={`${btnPrimary} w-full py-3 flex items-center justify-center gap-2 text-sm`}>
            <RefreshCw size={16} /> রিফ্রেশ শুরু ({totalCount}টি কন্টেন্ট)
          </button>
        </div>
      )}

      {refreshing && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>{progress.current}/{progress.total}</span>
            <span>{pct}%</span>
          </div>
          <div className="w-full h-3 bg-[#141422] rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-emerald-500 to-cyan-400 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-[11px] text-zinc-300 truncate">🔄 {progress.currentTitle}</p>
          <p className="text-[10px] text-zinc-500 animate-pulse">⏳ ব্রাউজার বন্ধ করবেন না...</p>
        </div>
      )}

      {done && (
        <div className="space-y-3">
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3">
            <p className="text-sm text-emerald-400 font-semibold flex items-center gap-2">
              <Check size={16} /> সম্পন্ন! {successCount}/{progress.total} আপডেট হয়েছে
            </p>
          </div>
          <button onClick={() => { setDone(false); setErrors([]); }} className={`${btnPrimary} w-full py-2.5 text-sm flex items-center justify-center gap-2`}>
            <RefreshCw size={14} /> আবার রিফ্রেশ করুন
          </button>
        </div>
      )}

      {errors.length > 0 && (
        <div className="mt-3 bg-red-500/10 border border-red-500/20 rounded-lg p-3 max-h-[200px] overflow-y-auto">
          <p className="text-xs text-red-400 font-semibold mb-2">⚠️ {errors.length}টি সমস্যা:</p>
          {errors.map((err, i) => (
            <p key={i} className="text-[11px] text-red-300/80 py-0.5">{err}</p>
          ))}
        </div>
      )}
    </div>
  );
};

// Episode Name Refresh Section - fetch episode names from TMDB (RS only)
const EpisodeNameRefreshSection = ({
  glassCard, btnPrimary, webseriesData,
}: {
  glassCard: string; btnPrimary: string;
  webseriesData: any[];
}) => {
  const [refreshing, setRefreshing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, currentTitle: "" });
  const [errors, setErrors] = useState<string[]>([]);
  const [successCount, setSuccessCount] = useState(0);
  const [done, setDone] = useState(false);
  const [updatedEps, setUpdatedEps] = useState(0);
  const [mode, setMode] = useState<"all" | "single">("all");
  const [selectedId, setSelectedId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredSeries = useMemo(() => {
    if (!searchQuery.trim()) return webseriesData;
    const q = searchQuery.toLowerCase();
    return webseriesData.filter(w => w.title?.toLowerCase().includes(q));
  }, [webseriesData, searchQuery]);

  const startRefresh = async () => {
    const targetList = mode === "single" && selectedId
      ? webseriesData.filter(w => w.id === selectedId)
      : webseriesData;

    if (targetList.length === 0) { toast.error("কন্টেন্ট সিলেক্ট করুন"); return; }

    setRefreshing(true);
    setErrors([]);
    setSuccessCount(0);
    setUpdatedEps(0);
    setDone(false);

    const total = targetList.length;
    setProgress({ current: 0, total, currentTitle: "" });
    const errorList: string[] = [];
    let success = 0;
    let totalEpsUpdated = 0;

    for (let i = 0; i < targetList.length; i++) {
      const ws = targetList[i];
      setProgress({ current: i + 1, total, currentTitle: ws.title });

      try {
        const searchRes = await fetch(
          `${TMDB_BASE_URL}/search/tv?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(ws.title)}&language=en-US&page=1`
        );
        const searchData = await searchRes.json();
        const tmdbShow = searchData.results?.[0];

        if (!tmdbShow) {
          errorList.push(`❌ ${ws.title} — TMDB তে পাওয়া যায়নি`);
          setErrors([...errorList]);
          continue;
        }

        const tmdbId = tmdbShow.id;
        if (!ws.seasons) { continue; }

        const seasonEntries = Object.entries(ws.seasons);
        let seriesUpdated = false;

        for (let sIdx = 0; sIdx < seasonEntries.length; sIdx++) {
          const [seasonKey, seasonData] = seasonEntries[sIdx] as [string, any];
          const seasonNum = seasonData.seasonNumber || sIdx + 1;

          try {
            const seasonRes = await fetch(
              `${TMDB_BASE_URL}/tv/${tmdbId}/season/${seasonNum}?api_key=${TMDB_API_KEY}&language=en-US`
            );
            if (!seasonRes.ok) continue;
            const tmdbSeason = await seasonRes.json();

            if (!tmdbSeason.episodes || !seasonData.episodes) continue;

            const epEntries = Object.entries(seasonData.episodes);
            for (const [epKey, epData] of epEntries) {
              const ep = epData as any;
              const epNum = ep.episodeNumber || 0;
              const tmdbEp = tmdbSeason.episodes.find((e: any) => e.episode_number === epNum);

              if (tmdbEp && tmdbEp.name) {
                const currentTitle = ep.title || "";
                if (!currentTitle || currentTitle === `Episode ${epNum}` || currentTitle === ep.episodeNumber?.toString()) {
                  await update(ref(db, `webseries/${ws.id}/seasons/${seasonKey}/episodes/${epKey}`), {
                    title: tmdbEp.name,
                  });
                  totalEpsUpdated++;
                  setUpdatedEps(totalEpsUpdated);
                  seriesUpdated = true;
                }
              }
            }

            await new Promise(r => setTimeout(r, 250));
          } catch {
            // skip season errors silently
          }
        }

        if (seriesUpdated) {
          success++;
          setSuccessCount(success);
        }

        await new Promise(r => setTimeout(r, 300));
      } catch (err: any) {
        errorList.push(`⚠️ ${ws.title} — ${err.message || "Unknown error"}`);
        setErrors([...errorList]);
      }
    }

    setDone(true);
    setRefreshing(false);
    toast.success(`এপিসোড নাম রিফ্রেশ সম্পন্ন! ${totalEpsUpdated}টি এপিসোড আপডেট হয়েছে`);
  };

  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <div className={`${glassCard} p-4 mb-4`}>
      <h3 className="text-sm font-semibold mb-3.5 flex items-center gap-2">
        <List size={14} className="text-amber-400" /> এপিসোড নাম রিফ্রেশ (TMDB)
      </h3>
      <p className="text-[11px] text-zinc-400 mb-3">
        RS ওয়েবসিরিজের এপিসোডের নাম TMDB থেকে আপডেট করবে। শুধু খালি বা জেনেরিক নাম আপডেট হবে।
      </p>

      {!refreshing && !done && (
        <div className="space-y-3">
          {/* Mode selector */}
          <div className="flex gap-2">
            <button onClick={() => setMode("all")}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg border transition-colors ${mode === "all" ? "bg-amber-600 border-amber-500 text-white" : "bg-[#141422] border-white/8 text-zinc-400 hover:text-white"}`}>
              সব সিরিজ ({webseriesData.length})
            </button>
            <button onClick={() => setMode("single")}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg border transition-colors ${mode === "single" ? "bg-amber-600 border-amber-500 text-white" : "bg-[#141422] border-white/8 text-zinc-400 hover:text-white"}`}>
              নির্দিষ্ট সিরিজ
            </button>
          </div>

          {/* Content selector for single mode */}
          {mode === "single" && (
            <div className="space-y-2">
              <div className="relative">
                <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="সিরিজ সার্চ করুন..."
                  className="w-full text-xs bg-zinc-800 border border-zinc-700 rounded-lg pl-8 pr-3 py-2.5 text-white placeholder-zinc-500 focus:border-amber-500 outline-none"
                />
              </div>
              <div className="max-h-[200px] overflow-y-auto space-y-1 rounded-lg border border-zinc-700/50 p-1.5">
                {filteredSeries.map(ws => (
                  <button
                    key={ws.id}
                    onClick={() => setSelectedId(ws.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors flex items-center gap-2 ${
                      selectedId === ws.id ? 'bg-amber-600/20 border border-amber-500/40 text-amber-300' : 'hover:bg-zinc-700/50 text-zinc-300'
                    }`}
                  >
                    {ws.poster && <img src={ws.poster} className="w-6 h-8 rounded object-cover flex-shrink-0" />}
                    <span className="truncate">{ws.title}</span>
                  </button>
                ))}
                {filteredSeries.length === 0 && <p className="text-[11px] text-zinc-500 text-center py-3">কোনো সিরিজ পাওয়া যায়নি</p>}
              </div>
            </div>
          )}

          <button
            onClick={startRefresh}
            disabled={mode === "single" && !selectedId}
            className={`${btnPrimary} w-full py-3 flex items-center justify-center gap-2 text-sm disabled:opacity-40`}
          >
            <RefreshCw size={16} /> রিফ্রেশ শুরু ({mode === "single" ? (selectedId ? "1টি" : "সিলেক্ট করুন") : `${webseriesData.length}টি`} সিরিজ)
          </button>
        </div>
      )}

      {refreshing && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>{progress.current}/{progress.total} সিরিজ</span>
            <span>{pct}%</span>
          </div>
          <div className="w-full h-3 bg-[#141422] rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-amber-500 to-orange-400 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-[11px] text-zinc-300 truncate">🔄 {progress.currentTitle}</p>
          <p className="text-[10px] text-emerald-400">{updatedEps}টি এপিসোড আপডেট হয়েছে</p>
          <p className="text-[10px] text-zinc-500 animate-pulse">⏳ ব্রাউজার বন্ধ করবেন না...</p>
        </div>
      )}

      {done && (
        <div className="space-y-3">
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
            <p className="text-sm text-amber-400 font-semibold flex items-center gap-2">
              <Check size={16} /> সম্পন্ন! {successCount}টি সিরিজে মোট {updatedEps}টি এপিসোড আপডেট হয়েছে
            </p>
          </div>
          <button onClick={() => { setDone(false); setErrors([]); setSelectedId(""); }} className={`${btnPrimary} w-full py-2.5 text-sm flex items-center justify-center gap-2`}>
            <RefreshCw size={14} /> আবার রিফ্রেশ করুন
          </button>
        </div>
      )}

      {errors.length > 0 && (
        <div className="mt-3 bg-red-500/10 border border-red-500/20 rounded-lg p-3 max-h-[200px] overflow-y-auto">
          <p className="text-xs text-red-400 font-semibold mb-2">⚠️ {errors.length}টি সমস্যা:</p>
          {errors.map((err, i) => (
            <p key={i} className="text-[11px] text-red-300/80 py-0.5">{err}</p>
          ))}
        </div>
      )}
    </div>
  );
};

// Link Checker Section - real video playback validation with grouped results
const LinkCheckerSection = ({
  glassCard, btnPrimary, webseriesData, moviesData,
}: {
  glassCard: string; btnPrimary: string;
  webseriesData: any[]; moviesData: any[];
}) => {
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, currentTitle: "" });
  const [brokenLinks, setBrokenLinks] = useState<{ contentTitle: string; contentId: string; contentType: 'webseries' | 'movies'; seasonKey?: string; seasonNum?: number; epKey?: string; epNum?: number; quality: string; qualityField: string; url: string; fbPath: string }[]>([]);
  const [done, setDone] = useState(false);
  const [mode, setMode] = useState<"all" | "single">("all");
  const [selectedId, setSelectedId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [deleting, setDeleting] = useState<Record<string, boolean>>({});
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editUrl, setEditUrl] = useState("");
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonInput, setJsonInput] = useState("");
  const [expandedContent, setExpandedContent] = useState<Set<string>>(new Set());
  const abortRef = useRef(false);

  const allContent = useMemo(() => [
    ...webseriesData.map(w => ({ ...w, _type: 'webseries' as const })),
    ...moviesData.map(m => ({ ...m, _type: 'movies' as const })),
  ], [webseriesData, moviesData]);

  const filteredContent = useMemo(() => {
    if (!searchQuery.trim()) return allContent;
    const q = searchQuery.toLowerCase();
    return allContent.filter(c => c.title?.toLowerCase().includes(q));
  }, [allContent, searchQuery]);

  const qualityFields = ['link', 'link480', 'link720', 'link1080', 'link4k'] as const;
  const qualityLabels: Record<string, string> = { link: 'Default', link480: '480p', link720: '720p', link1080: '1080p', link4k: '4K' };

  const PROXY_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/video-proxy`;
  const CLOUDFLARE_CDN = CLOUDFLARE_CDN_URL;
  const [cdnEnabled, setCdnEnabled] = useState(true);
  const [proxyUrl, setProxyUrl] = useState('');

  useEffect(() => {
    const unsub1 = onValue(ref(db, "settings/cdnEnabled"), (snap) => {
      const val = snap.val();
      setCdnEnabled(val !== false);
    });
    const unsub2 = onValue(ref(db, "settings/proxyServer"), (snap) => {
      const val = snap.val();
      setProxyUrl(val?.url || '');
    });
    return () => {
      unsub1();
      unsub2();
    };
  }, []);

  const isRangeSafeProxy = (serverUrl?: string) => {
    if (!serverUrl) return true;
    return serverUrl.includes('/functions/v1/video-proxy') || serverUrl.includes('workers.dev');
  };

  const buildPlaybackCandidates = (url: string): string[] => {
    if (!url) return [];
    const encoded = encodeURIComponent(url);
    const candidates: string[] = [];
    const addCandidate = (candidate?: string | null) => {
      if (!candidate || candidates.includes(candidate)) return;
      candidates.push(candidate);
    };

    const supabaseCandidate = `${PROXY_URL}?url=${encoded}`;
    const cloudflareCandidate = `${CLOUDFLARE_CDN}/?url=${encoded}`;
    const customProxyCandidate = proxyUrl && isRangeSafeProxy(proxyUrl)
      ? `${proxyUrl}${encoded}`
      : null;

    if (url.startsWith('http://')) {
      if (cdnEnabled) addCandidate(cloudflareCandidate);
      addCandidate(customProxyCandidate);
      addCandidate(supabaseCandidate);
      return candidates;
    }

    if (url.startsWith('https://')) {
      if (cdnEnabled) addCandidate(cloudflareCandidate);
      addCandidate(customProxyCandidate);
      addCandidate(url);
      addCandidate(supabaseCandidate);
      return candidates;
    }

    addCandidate(url);
    return candidates;
  };

  const testPlayable = async (testUrl: string): Promise<boolean> => {
    return await new Promise<boolean>((resolve) => {
      const vid = document.createElement('video');
      vid.preload = 'auto';
      vid.muted = true;
      vid.playsInline = true;
      vid.style.position = 'fixed';
      vid.style.left = '-9999px';
      vid.style.width = '1px';
      vid.style.height = '1px';
      document.body?.appendChild(vid);

      let done = false;
      const timeout = setTimeout(() => cleanup(false), 14000);

      const cleanup = (result: boolean) => {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        vid.onloadedmetadata = null;
        vid.oncanplay = null;
        vid.onplaying = null;
        vid.ontimeupdate = null;
        vid.onerror = null;
        try { vid.pause(); } catch {}
        try { vid.removeAttribute('src'); vid.load(); } catch {}
        try { vid.remove(); } catch {}
        resolve(result);
      };

      const tryStart = () => {
        const p = vid.play();
        if (p && typeof p.then === 'function') p.catch(() => {});
      };

      vid.onloadedmetadata = tryStart;
      vid.oncanplay = () => cleanup(true);
      vid.onplaying = () => cleanup(true);
      vid.ontimeupdate = () => {
        if (vid.currentTime > 0.1) cleanup(true);
      };
      vid.onerror = () => cleanup(false);
      vid.src = testUrl;
      vid.load();
    });
  };

  // Check link with same routing strategy as real player
  const checkLink = async (url: string): Promise<boolean> => {
    const candidates = buildPlaybackCandidates(url);
    for (const candidate of candidates) {
      const ok = await testPlayable(candidate);
      if (ok) return true;
    }
    return false;
  };

  const startCheck = async () => {
    const targetContent = mode === "single" && selectedId
      ? allContent.filter(c => c.id === selectedId)
      : allContent;

    if (targetContent.length === 0) { toast.error("কন্টেন্ট সিলেক্ট করুন"); return; }

    abortRef.current = false;
    setChecking(true);
    setBrokenLinks([]);
    setDone(false);
    setExpandedContent(new Set());

    const broken: typeof brokenLinks = [];
    let totalLinks = 0;

    for (const content of targetContent) {
      if (content._type === 'webseries' && content.seasons) {
        for (const [, season] of Object.entries(content.seasons as Record<string, any>)) {
          if (season.episodes) {
            for (const [, ep] of Object.entries(season.episodes as Record<string, any>)) {
              for (const q of qualityFields) {
                if (ep[q] && typeof ep[q] === 'string' && ep[q].trim()) totalLinks++;
              }
            }
          }
        }
      } else if (content._type === 'movies') {
        for (const q of qualityFields) {
          if (content[q] && typeof content[q] === 'string' && content[q].trim()) totalLinks++;
        }
      }
    }

    setProgress({ current: 0, total: totalLinks, currentTitle: "" });
    let checked = 0;

    for (const content of targetContent) {
      if (content._type === 'webseries' && content.seasons) {
        for (const [seasonKey, season] of Object.entries(content.seasons as Record<string, any>)) {
          if (!season.episodes) continue;
          for (const [epKey, ep] of Object.entries(season.episodes as Record<string, any>)) {
            for (const q of qualityFields) {
              const url = ep[q];
              if (!url || typeof url !== 'string' || !url.trim()) continue;
              if (abortRef.current) break;

              checked++;
              setProgress({ current: checked, total: totalLinks, currentTitle: `${content.title} S${season.seasonNumber || '?'}E${ep.episodeNumber || '?'} (${qualityLabels[q]})` });

              const ok = await checkLink(url.trim());
              if (abortRef.current) break;
              if (!ok) {
                broken.push({
                  contentTitle: content.title,
                  contentId: content.id,
                  contentType: 'webseries',
                  seasonKey,
                  seasonNum: season.seasonNumber,
                  epKey,
                  epNum: ep.episodeNumber,
                  quality: qualityLabels[q],
                  qualityField: q,
                  url: url.trim(),
                  fbPath: `webseries/${content.id}/seasons/${seasonKey}/episodes/${epKey}/${q}`,
                });
                setBrokenLinks([...broken]);
              }
              await new Promise(r => setTimeout(r, 80));
            }
          }
        }
      } else if (content._type === 'movies') {
        for (const q of qualityFields) {
          const url = content[q];
          if (!url || typeof url !== 'string' || !url.trim()) continue;
          if (abortRef.current) break;

          checked++;
          setProgress({ current: checked, total: totalLinks, currentTitle: `${content.title} (${qualityLabels[q]})` });

          const ok = await checkLink(url.trim());
          if (abortRef.current) break;
          if (!ok) {
            broken.push({
              contentTitle: content.title,
              contentId: content.id,
              contentType: 'movies',
              quality: qualityLabels[q],
              qualityField: q,
              url: url.trim(),
              fbPath: `movies/${content.id}/${q}`,
            });
            setBrokenLinks([...broken]);
          }
          await new Promise(r => setTimeout(r, 80));
        }
      }
    }

    if (abortRef.current) {
      setChecking(false);
      setDone(true);
      const contentIds = new Set(broken.map(b => b.contentId));
      setExpandedContent(contentIds);
      toast.info(`চেক বাতিল হয়েছে। ${broken.length}টি ব্রোকেন লিংক পাওয়া গেছে`);
      return;
    }

    setDone(true);
    setChecking(false);
    // Auto expand all content groups
    const contentIds = new Set(broken.map(b => b.contentId));
    setExpandedContent(contentIds);
    toast.success(`লিংক চেক সম্পন্ন! ${broken.length}টি ব্রোকেন লিংক পাওয়া গেছে`);
  };

  const deleteBrokenLink = async (item: typeof brokenLinks[0], idx: number) => {
    const key = `${idx}`;
    setDeleting(prev => ({ ...prev, [key]: true }));
    try {
      await set(ref(db, item.fbPath), null);
      setBrokenLinks(prev => prev.filter((_, i) => i !== idx));
      toast.success(`লিংক মুছে ফেলা হয়েছে`);
    } catch (err: any) {
      toast.error(`মুছতে ব্যর্থ: ${err.message}`);
    }
    setDeleting(prev => ({ ...prev, [key]: false }));
  };

  const deleteAllBroken = async () => {
    if (!confirm(`${brokenLinks.length}টি ব্রোকেন লিংক মুছে ফেলতে চান?`)) return;
    let deleted = 0;
    for (const item of brokenLinks) {
      try { await set(ref(db, item.fbPath), null); deleted++; } catch {}
    }
    setBrokenLinks([]);
    toast.success(`${deleted}টি ব্রোকেন লিংক মুছে ফেলা হয়েছে`);
  };

  const saveEditedUrl = async (item: typeof brokenLinks[0], idx: number) => {
    if (!editUrl.trim()) return;
    try {
      await set(ref(db, item.fbPath), editUrl.trim());
      setBrokenLinks(prev => prev.map((b, i) => i === idx ? { ...b, url: editUrl.trim() } : b));
      setEditingIdx(null);
      setEditUrl("");
      toast.success("লিংক আপডেট হয়েছে");
    } catch (err: any) {
      toast.error(`আপডেট ব্যর্থ: ${err.message}`);
    }
  };

  const applyJsonFix = async () => {
    try {
      const fixes = JSON.parse(jsonInput.trim());
      if (!Array.isArray(fixes)) { toast.error("JSON অবশ্যই একটি Array হতে হবে"); return; }
      let applied = 0;
      for (const fix of fixes) {
        if (fix.fbPath && fix.newUrl) {
          try {
            await set(ref(db, fix.fbPath), fix.newUrl.trim());
            applied++;
          } catch {}
        }
      }
      setBrokenLinks(prev => {
        const fixMap = new Map(fixes.map((f: any) => [f.fbPath, f.newUrl]));
        return prev.map(b => fixMap.has(b.fbPath) ? { ...b, url: fixMap.get(b.fbPath) || b.url } : b);
      });
      setJsonMode(false);
      setJsonInput("");
      toast.success(`${applied}টি লিংক আপডেট হয়েছে`);
    } catch {
      toast.error("Invalid JSON format");
    }
  };

  // Group broken links by content
  const groupedBroken = useMemo(() => {
    const map = new Map<string, { title: string; id: string; type: string; items: (typeof brokenLinks[number] & { originalIdx: number })[] }>();
    brokenLinks.forEach((item, idx) => {
      if (!map.has(item.contentId)) {
        map.set(item.contentId, { title: item.contentTitle, id: item.contentId, type: item.contentType, items: [] });
      }
      map.get(item.contentId)!.items.push({ ...item, originalIdx: idx });
    });
    return Array.from(map.values());
  }, [brokenLinks]);

  const toggleContentExpand = (id: string) => {
    setExpandedContent(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const exportBrokenJson = () => {
    const exportData = brokenLinks.map(b => ({
      fbPath: b.fbPath,
      contentTitle: b.contentTitle,
      episode: b.epNum || null,
      season: b.seasonNum || null,
      quality: b.quality,
      brokenUrl: b.url,
      newUrl: "",
    }));
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "broken-links.json";
    a.click();
  };

  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <div className={`${glassCard} p-4 mb-4`}>
      <h3 className="text-sm font-semibold mb-3.5 flex items-center gap-2">
        <Link size={14} className="text-red-400" /> লিংক চেকার (RS)
      </h3>
      <p className="text-[11px] text-zinc-400 mb-3">
        ইউজার প্লেয়ারের মতো CDN/Direct/Proxy রুটে ভিডিও চালিয়ে রিয়েল প্লেব্যাক টেস্ট করবে। যেগুলো কোনো রুটেই প্লে হবে না সেগুলোই ব্রোকেন দেখাবে।
      </p>

      {!checking && !done && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <button onClick={() => setMode("all")}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg border transition-colors ${mode === "all" ? "bg-red-600 border-red-500 text-white" : "bg-[#141422] border-white/8 text-zinc-400 hover:text-white"}`}>
              সব কন্টেন্ট ({allContent.length})
            </button>
            <button onClick={() => setMode("single")}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg border transition-colors ${mode === "single" ? "bg-red-600 border-red-500 text-white" : "bg-[#141422] border-white/8 text-zinc-400 hover:text-white"}`}>
              নির্দিষ্ট কন্টেন্ট
            </button>
          </div>

          {mode === "single" && (
            <div className="space-y-2">
              <div className="relative">
                <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="কন্টেন্ট সার্চ করুন..."
                  className="w-full text-xs bg-zinc-800 border border-zinc-700 rounded-lg pl-8 pr-3 py-2.5 text-white placeholder-zinc-500 focus:border-red-500 outline-none"
                />
              </div>
              <div className="max-h-[200px] overflow-y-auto space-y-1 rounded-lg border border-zinc-700/50 p-1.5">
                {filteredContent.map(c => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors flex items-center gap-2 ${
                      selectedId === c.id ? 'bg-red-600/20 border border-red-500/40 text-red-300' : 'hover:bg-zinc-700/50 text-zinc-300'
                    }`}
                  >
                    {c.poster && <img src={c.poster} className="w-6 h-8 rounded object-cover flex-shrink-0" />}
                    <span className="truncate">{c.title}</span>
                    <span className="text-[10px] text-zinc-500 ml-auto flex-shrink-0">{c._type === 'webseries' ? '📺' : '🎬'}</span>
                  </button>
                ))}
                {filteredContent.length === 0 && <p className="text-[11px] text-zinc-500 text-center py-3">কোনো কন্টেন্ট পাওয়া যায়নি</p>}
              </div>
            </div>
          )}

          <button
            onClick={startCheck}
            disabled={mode === "single" && !selectedId}
            className={`${btnPrimary} w-full py-3 flex items-center justify-center gap-2 text-sm disabled:opacity-40`}
          >
            <Link size={16} /> লিংক চেক শুরু
          </button>
        </div>
      )}

      {checking && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>{progress.current}/{progress.total} লিংক</span>
            <span>{pct}%</span>
          </div>
          <div className="w-full h-3 bg-[#141422] rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-red-500 to-orange-400 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-[11px] text-zinc-300 truncate">🔍 {progress.currentTitle}</p>
          {brokenLinks.length > 0 && (
            <p className="text-[10px] text-red-400">❌ {brokenLinks.length}টি ব্রোকেন লিংক পাওয়া গেছে</p>
          )}
          <p className="text-[10px] text-zinc-500 animate-pulse">⏳ ভিডিও প্লেব্যাক টেস্ট চলছে, ব্রাউজার বন্ধ করবেন না...</p>
          <button
            onClick={() => { abortRef.current = true; }}
            className="w-full py-2 text-xs font-semibold bg-red-600/80 hover:bg-red-500 rounded-lg transition-colors flex items-center justify-center gap-1.5 mt-2"
          >
            <X size={12} /> চেক বাতিল করুন
          </button>
        </div>
      )}

      {done && (
        <div className="space-y-3">
          <div className={`${brokenLinks.length > 0 ? 'bg-red-500/10 border-red-500/30' : 'bg-emerald-500/10 border-emerald-500/30'} border rounded-lg p-3 flex items-center justify-between`}>
            <p className={`text-sm font-semibold flex items-center gap-2 ${brokenLinks.length > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
              <Check size={16} />
              {brokenLinks.length > 0
                ? `${brokenLinks.length}টি ব্রোকেন লিংক পাওয়া গেছে (${groupedBroken.length}টি কন্টেন্টে)`
                : 'সব লিংক ঠিক আছে! ✅'}
            </p>
            <button onClick={() => { setDone(false); setBrokenLinks([]); setSelectedId(""); setExpandedContent(new Set()); }} className="p-1.5 rounded-lg hover:bg-zinc-700/50 transition-colors text-zinc-400 hover:text-white">
              <X size={16} />
            </button>
          </div>

          {brokenLinks.length > 0 && (
            <>
              {/* Action buttons */}
              <div className="flex gap-2">
                <button
                  onClick={deleteAllBroken}
                  className="flex-1 py-2.5 text-xs font-semibold bg-red-600 hover:bg-red-500 rounded-lg transition-colors flex items-center justify-center gap-1.5"
                >
                  <Trash2 size={12} /> সব মুছুন ({brokenLinks.length})
                </button>
                <button
                  onClick={exportBrokenJson}
                  className="flex-1 py-2.5 text-xs font-semibold bg-zinc-700 hover:bg-zinc-600 rounded-lg transition-colors flex items-center justify-center gap-1.5"
                >
                  <Download size={12} /> JSON Export
                </button>
              </div>

              {/* JSON Import Fix */}
              <button
                onClick={() => setJsonMode(!jsonMode)}
                className="w-full py-2 text-xs font-semibold bg-indigo-600/20 border border-indigo-500/30 hover:bg-indigo-600/30 rounded-lg transition-colors flex items-center justify-center gap-1.5 text-indigo-300"
              >
                <Edit size={12} /> JSON দিয়ে ফিক্স করুন
              </button>
              {jsonMode && (
                <div className="space-y-2 bg-zinc-800/50 border border-zinc-700/50 rounded-lg p-3">
                  <p className="text-[10px] text-zinc-400">
                    নিচে JSON পেস্ট করুন — ফরম্যাট: [&#123;"fbPath":"...", "newUrl":"..."&#125;]
                  </p>
                  <textarea
                    value={jsonInput}
                    onChange={e => setJsonInput(e.target.value)}
                    rows={5}
                    placeholder='[{"fbPath":"webseries/.../link","newUrl":"https://..."}]'
                    className="w-full text-xs bg-zinc-900 border border-zinc-700 rounded-lg p-2.5 text-white placeholder-zinc-600 focus:border-indigo-500 outline-none resize-none font-mono"
                  />
                  <button onClick={applyJsonFix} className="w-full py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors">
                    JSON Apply করুন
                  </button>
                </div>
              )}

              {/* Grouped broken links by content */}
              <div className="max-h-[500px] overflow-y-auto space-y-2">
                {groupedBroken.map((group) => (
                  <div key={group.id} className="bg-zinc-800/40 border border-zinc-700/40 rounded-xl overflow-hidden">
                    {/* Content header */}
                    <button
                      onClick={() => toggleContentExpand(group.id)}
                      className="w-full flex items-center gap-2.5 p-3 hover:bg-zinc-700/30 transition-colors"
                    >
                      <div className="w-8 h-8 rounded-lg bg-red-600/20 flex items-center justify-center text-red-400 font-bold text-xs flex-shrink-0">
                        {group.items.length}
                      </div>
                      <div className="flex-1 min-w-0 text-left">
                        <p className="text-xs font-semibold text-white truncate">{group.title}</p>
                        <p className="text-[10px] text-zinc-500">
                          {group.type === 'webseries' ? '📺 Series' : '🎬 Movie'} • {group.items.length}টি ব্রোকেন লিংক
                        </p>
                      </div>
                      <ChevronDown size={14} className={`text-zinc-500 transition-transform ${expandedContent.has(group.id) ? 'rotate-180' : ''}`} />
                    </button>

                    {/* Expanded episodes */}
                    {expandedContent.has(group.id) && (
                      <div className="px-3 pb-3 space-y-1.5">
                        {group.items.map((item) => (
                          <div key={item.originalIdx} className="bg-zinc-900/60 border border-zinc-700/30 rounded-lg p-2.5">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <p className="text-[11px] font-semibold text-zinc-200">
                                  {item.contentType === 'webseries' && item.epNum
                                    ? `S${item.seasonNum || '?'} E${item.epNum} — ${item.quality}`
                                    : item.quality
                                  }
                                </p>
                                <p className="text-[9px] text-zinc-500 mt-0.5 truncate break-all">{item.url}</p>
                              </div>
                              <div className="flex gap-1 flex-shrink-0">
                                <button
                                  onClick={() => { setEditingIdx(item.originalIdx); setEditUrl(item.url); }}
                                  className="px-2 py-1 text-[9px] font-semibold bg-indigo-600/60 hover:bg-indigo-500 rounded-md transition-colors flex items-center gap-0.5"
                                >
                                  <Edit size={9} /> এডিট
                                </button>
                                <button
                                  onClick={() => deleteBrokenLink(item, item.originalIdx)}
                                  disabled={deleting[`${item.originalIdx}`]}
                                  className="px-2 py-1 text-[9px] font-semibold bg-red-600/60 hover:bg-red-500 rounded-md transition-colors flex items-center gap-0.5 disabled:opacity-50"
                                >
                                  <Trash2 size={9} /> মুছুন
                                </button>
                              </div>
                            </div>
                            {/* Inline edit */}
                            {editingIdx === item.originalIdx && (
                              <div className="mt-2 flex gap-1.5">
                                <input
                                  value={editUrl}
                                  onChange={e => setEditUrl(e.target.value)}
                                  className="flex-1 text-[10px] bg-zinc-800 border border-zinc-600 rounded-md px-2 py-1.5 text-white focus:border-indigo-500 outline-none"
                                  placeholder="নতুন URL দিন..."
                                />
                                <button onClick={() => saveEditedUrl(item, item.originalIdx)} className="px-2.5 py-1.5 text-[9px] bg-emerald-600 hover:bg-emerald-500 rounded-md font-semibold">সেভ</button>
                                <button onClick={() => { setEditingIdx(null); setEditUrl(""); }} className="px-2 py-1.5 text-[9px] bg-zinc-700 hover:bg-zinc-600 rounded-md">✕</button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          <button onClick={() => { setDone(false); setBrokenLinks([]); setSelectedId(""); setExpandedContent(new Set()); }} className={`${btnPrimary} w-full py-2.5 text-sm flex items-center justify-center gap-2`}>
            <RefreshCw size={14} /> আবার চেক করুন
          </button>
        </div>
      )}
    </div>
  );
};


// Inline Link Checker for Web Series editor - checks all links in current seasonsData
const WsInlineLinkChecker = ({
  seasonsData, seriesTitle, glassCard, btnPrimary,
}: {
  seasonsData: any[]; seriesTitle: string; glassCard: string; btnPrimary: string;
}) => {
  const [checking, setChecking] = useState(false);
  const [brokenLinks, setBrokenLinks] = useState<{ season: string; episode: number; quality: string; url: string }[]>([]);
  const [goodCount, setGoodCount] = useState(0);
  const [progress, setProgress] = useState({ current: 0, total: 0, currentTitle: "" });
  const [done, setDone] = useState(false);
  const abortRef = useRef(false);

  const PROXY_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/video-proxy`;
  const CLOUDFLARE_CDN = CLOUDFLARE_CDN_URL;
  const qualityFields = ['link', 'link480', 'link720', 'link1080', 'link4k'] as const;
  const qualityLabels: Record<string, string> = { link: 'Default', link480: '480p', link720: '720p', link1080: '1080p', link4k: '4K' };

  const testPlayable = async (testUrl: string): Promise<boolean> => {
    return await new Promise<boolean>((resolve) => {
      const vid = document.createElement('video');
      vid.preload = 'auto'; vid.muted = true; vid.playsInline = true;
      vid.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px';
      document.body?.appendChild(vid);
      let done = false;
      const timeout = setTimeout(() => cleanup(false), 10000);
      const cleanup = (result: boolean) => {
        if (done) return; done = true; clearTimeout(timeout);
        vid.onloadedmetadata = vid.oncanplay = vid.onplaying = vid.ontimeupdate = vid.onerror = null;
        try { vid.pause(); } catch {} try { vid.removeAttribute('src'); vid.load(); } catch {} try { vid.remove(); } catch {}
        resolve(result);
      };
      vid.onloadedmetadata = () => { const p = vid.play(); if (p?.then) p.catch(() => {}); };
      vid.oncanplay = () => cleanup(true); vid.onplaying = () => cleanup(true);
      vid.ontimeupdate = () => { if (vid.currentTime > 0.1) cleanup(true); };
      vid.onerror = () => cleanup(false);
      vid.src = testUrl; vid.load();
    });
  };

  const checkLink = async (url: string): Promise<boolean> => {
    if (!url) return false;
    const encoded = encodeURIComponent(url);
    const candidates: string[] = [];
    if (url.startsWith('http://')) {
      candidates.push(`${CLOUDFLARE_CDN}/?url=${encoded}`, `${PROXY_URL}?url=${encoded}`);
    } else {
      candidates.push(`${CLOUDFLARE_CDN}/?url=${encoded}`, url, `${PROXY_URL}?url=${encoded}`);
    }
    for (const c of candidates) {
      const ok = await testPlayable(c);
      if (ok) return true;
    }
    return false;
  };

  const startCheck = async () => {
    abortRef.current = false; setChecking(true); setBrokenLinks([]); setGoodCount(0); setDone(false);
    const broken: typeof brokenLinks = [];
    let totalLinks = 0, checked = 0, good = 0;
    seasonsData.forEach(s => s.episodes?.forEach((ep: any) => {
      for (const q of qualityFields) if (ep[q] && typeof ep[q] === 'string' && ep[q].trim()) totalLinks++;
    }));
    setProgress({ current: 0, total: totalLinks, currentTitle: "" });
    for (let sIdx = 0; sIdx < seasonsData.length; sIdx++) {
      const season = seasonsData[sIdx];
      for (let eIdx = 0; eIdx < (season.episodes?.length || 0); eIdx++) {
        const ep = season.episodes[eIdx];
        for (const q of qualityFields) {
          const url = ep[q];
          if (!url || typeof url !== 'string' || !url.trim()) continue;
          if (abortRef.current) break;
          checked++;
          setProgress({ current: checked, total: totalLinks, currentTitle: `${season.name} EP${ep.episodeNumber || eIdx + 1} (${qualityLabels[q]})` });
          const ok = await checkLink(url.trim());
          if (abortRef.current) break;
          if (!ok) {
            broken.push({ season: season.name || `Season ${sIdx + 1}`, episode: ep.episodeNumber || eIdx + 1, quality: qualityLabels[q], url: url.trim() });
            setBrokenLinks([...broken]);
          } else { good++; setGoodCount(good); }
          await new Promise(r => setTimeout(r, 50));
        }
      }
    }
    setDone(true); setChecking(false);
    if (broken.length === 0 && !abortRef.current) toast.success("✅ সব লিংক ঠিক আছে!");
    else if (broken.length > 0) toast.warning(`⚠️ ${broken.length}টি ব্রোকেন লিংক পাওয়া গেছে`);
  };

  // Count total links
  let totalLinks = 0;
  seasonsData.forEach(s => s.episodes?.forEach((ep: any) => {
    for (const q of qualityFields) if (ep[q] && typeof ep[q] === 'string' && ep[q].trim()) totalLinks++;
  }));

  if (totalLinks === 0) return null;

  return (
    <div className={`${glassCard} p-4 mb-4`}>
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs font-bold flex items-center gap-2"><Link size={12} className="text-amber-400" /> Link Checker ({totalLinks} লিংক)</h4>
        {!checking && !done && (
          <button onClick={startCheck} className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-amber-500/20 border border-amber-500/30 text-amber-400 hover:bg-amber-500/40 flex items-center gap-1">
            <Search size={10} /> চেক করুন
          </button>
        )}
        {checking && (
          <button onClick={() => { abortRef.current = true; }} className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/40 flex items-center gap-1">
            <X size={10} /> বাতিল
          </button>
        )}
      </div>
      {checking && (
        <div className="mb-3">
          <div className="flex justify-between text-[10px] text-zinc-400 mb-1">
            <span>{progress.currentTitle}</span>
            <span>{progress.current}/{progress.total}</span>
          </div>
          <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all duration-300 rounded-full" style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }} />
          </div>
        </div>
      )}
      {done && brokenLinks.length === 0 && (
        <div className="text-center py-3">
          <p className="text-emerald-400 text-xs font-semibold">✅ সব লিংক কাজ করছে! ({goodCount}/{goodCount + brokenLinks.length})</p>
        </div>
      )}
      {brokenLinks.length > 0 && (
        <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
          <p className="text-[10px] text-red-400 font-bold mb-1">❌ {brokenLinks.length}টি ব্রোকেন লিংক:</p>
          {brokenLinks.map((b, i) => (
            <div key={i} className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-[10px]">
              <span className="text-white font-semibold">{b.season} EP{b.episode}</span>
              <span className="text-zinc-400 ml-2">({b.quality})</span>
              <p className="text-red-300/60 truncate mt-0.5 font-mono text-[9px]">{b.url}</p>
            </div>
          ))}
        </div>
      )}
      {done && (
        <button onClick={() => { setDone(false); setBrokenLinks([]); setGoodCount(0); }} className="mt-2 w-full py-2 rounded-lg text-[10px] font-bold bg-zinc-700 text-zinc-300 hover:bg-zinc-600 flex items-center justify-center gap-1">
          <RefreshCw size={10} /> আবার চেক করুন
        </button>
      )}
    </div>
  );
};

export default Admin;
