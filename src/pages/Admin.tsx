import { useState, useEffect, useRef, useCallback, useMemo, forwardRef, memo } from "react";
import CachedImg from "@/components/CachedImg";
import { db, ref, onValue, push, set, remove, update, get, auth, googleProvider, signInWithPopup } from "@/lib/firebase";
import { supabase } from "@/integrations/supabase/client";
import { animeSaltApi } from '@/lib/animeSaltApi';
import { useBranding } from "@/hooks/useBranding";
// FCM removed — notifications now go via Telegram posts only. Stubs preserved so legacy callers no-op silently.
type PushProgress = { phase: string; totalTokens?: number; totalUsers?: number; sent: number; success: number; failed: number; invalidRemoved: number; failReasons?: Record<string, number> };
const sendPushToUsers = async (..._args: any[]) => ({ total: 0, success: 0, failed: 0 });
const sendPushToAllUsers = async (..._args: any[]) => ({ total: 0, success: 0, failed: 0 });
import { toast } from "sonner";
import {
 LayoutDashboard, FolderOpen, Film, Video, Users, Bell, Zap, PlusCircle, CloudDownload,
 Menu, X, MoreVertical, RefreshCw, Plus, Download, Trash2, Edit, Eye, EyeOff,
 Shield, LogOut, Search, Save, ChevronDown, Send, Link, ChevronLeft, ChevronRight,
 Lock, Unlock, KeyRound, AlertTriangle, Power, Settings, MessageCircle, Reply, BarChart3, Activity, TrendingUp, Check, List, Star, Pin,
 Upload, Loader2, CheckCircle, XCircle, Clock, Image, Mail, Sparkles, Bot, CalendarDays, Database
} from "lucide-react";

import { TMDB_API_KEY, TMDB_BASE_URL, TMDB_IMG_BASE, SITE_URL, SITE_NAME, SITE_ICON_URL, TELEGRAM_CHANNEL, TELEGRAM_CHANNEL_URL, TELEGRAM_ADMIN_URL, CLOUDFLARE_CDN_URL, SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/siteConfig";
import { EDGE_FUNCTIONS, DEFAULT_CF_FUNCTIONS, type EdgeFunctionName, type EdgeRouterConfig, type CloudFunction, checkFunctionStatus, getAllFunctions, getEdgeFunctionUrl } from "@/lib/edgeFunctionRouter";
import {
 buildAdminContentIndexItem,
 fetchAdminCount,
 fetchAdminContentIndex,
 fetchRecentAdminContentList,
 mergeAdminContentLists,
 primeAdminContentIndexFromList,
 readCachedAdminContentList,
 removeAdminContentIndex,
 sortAdminContentList,
 upsertAdminContentIndex,
 writeCachedAdminContentList,
 type AdminContentKind,
} from "@/lib/adminContentIndex";
const WeeklyEpTabButton = () => null;
const WeeklyEpManager = () => null;
// AdminNotificationBell removed

import EgdManager from "@/components/admin/EgdManager";
import { EDGE_FUNCTION_LIBRARY } from "@/lib/edgeFunctionCodeLibrary";
import AdsterraConfig from "@/components/admin/AdsterraConfig";
import BackdropAiReplacer from "@/components/admin/BackdropAiReplacer";
import ApkDownloadCenter from "@/components/admin/ApkDownloadCenter";
import FirebaseMultiManager from "@/components/admin/FirebaseMultiManager";
import AnimeNameExporter from "@/components/admin/AnimeNameExporter";

import AnSeriesManager from "@/components/admin/AnSeriesManager";
import WeeklyEpisodeManager from "@/components/admin/WeeklyEpisodeManager";
import SecurityCenter from "@/components/admin/SecurityCenter";
import { logAdminAccess, isBlocked, isOwnerEmail, rememberDeviceName } from "@/lib/securityGuard";

const buildEpisodeShareUrl = (animeId: string, seasonIdx?: number, epIdx?: number) => {
 const params = new URLSearchParams();
 if (seasonIdx !== undefined) params.set("s", String(seasonIdx));
 if (epIdx !== undefined) params.set("e", String(epIdx));
 const qs = params.toString();
 return `${SITE_URL}/watch/${encodeURIComponent(animeId)}${qs ? `?${qs}` : ""}`;
};

type Section = "dashboard" | "categories" | "webseries" | "weekly-episode" | "movies" | "users" | "notifications" | "new-releases" | "tmdb-fetch" | "add-content" | "redeem-codes" | "bkash-payments" | "device-limits" | "maintenance" | "free-access" | "settings" | "comments" | "analytics" | "auto-import" | "animesalt-manager" | "telegram-post" | "tg-url-changer" | "live-support" | "ui-themes" | "hero-pinned" | "edge-router" | "branding" | "ai-config" | "live-tv" | "url-changer" | "link-checker" | "video-servers" | "unlock-duration" | "email-service" | "apk-dw" | "egd-manager" | "fb-cleanup" | "adsterra" | "backdrop-ai" | "security-center";

const ADMIN_BN_TRANSLATIONS: Array<[RegExp, string]> = [
 [/AI সেটিংস সেভ হয়েছে/g, "AI settings saved"], [/AI চালু হয়েছে/g, "AI enabled"], [/AI বন্ধ হয়েছে/g, "AI disabled"], [/AI চালু আছে/g, "AI is enabled"], [/AI বন্ধ আছে/g, "AI is disabled"], [/AI URL enter আগে/g, "Enter the AI URL first"],
 [/থিম অ্যাক্টিভ হয়েছে/g, "theme activated"], [/থিম সেভ ব্যর্থ/g, "Theme save failed"], [/২০টি থিম থেকে পছন্র থিম সিলেক্ট করো। all ইউজারের UI together চেঞ্জ will be।/g, "Choose a theme preset. The UI updates for every user instantly."],
 [/ব্যাকগ্রাউন্ড ইমেজ সেট হয়েছে/g, "Background image set"], [/ব্যাকগ্রাউন্ড ইমেজ রিমুভ হয়েছে/g, "Background image removed"], [/ব্যাকগ্রাউন্ড ছবির URL/g, "Background image URL"], [/কাস্টম ব্যাকগ্রাউন্ড ইমেজ/g, "Custom Background Image"], [/ব্যাকগ্রাউন্ড সেভ করুন/g, "Save Background"],
 [/সেভ ব্যর্থ/g, "Save failed"], [/টাইটেল enter/g, "Enter a title"], [/ছবি enter \(URL বা আপলোড\)/g, "Add an image URL or upload an image"], [/হিরো স্লাইডারে পোস্ট করা হয়েছে/g, "posted to the hero slider"], [/পোস্ট করা ব্যর্থ/g, "Post failed"], [/পোস্ট ডিলিট হয়েছে/g, "Post deleted"], [/ডিলিট ব্যর্থ/g, "Delete failed"],
 [/কাস্টম হিরো পোস্ট তৈরি করুন/g, "Create Custom Hero Post"], [/ছবি আপলোড করুন বা লিংক enter, টাইটেল ও বিবরণ লিখুন। কালার ও ফন্ট কাস্টমাইজ করুন।/g, "Upload an image or paste a link, then add title, description, colors, and font."], [/ব্যাNoর ছবি/g, "Banner Image"], [/ছবির URL enter/g, "Enter image URL"], [/টাইটেল কালার/g, "Title Color"], [/টাইটেল ফন্ট/g, "Title Font"], [/বিবরণ \/ ডেসক্রিপশন/g, "Description"], [/পোস্টের টাইটেল/g, "Post title"], [/বিস্তারিত বিবরণ লিখুন\.\.\. \(click করলে ডিটেইল পেজে এটা খাবে\)/g, "Write the full description shown on the detail page"], [/পোস্ট করুন/g, "Post"], [/পোস্ট করা item/g, "Posted Items"], [/no পোস্ট নেই/g, "No posts yet"],
 [/all এনিমে category অ্যাসাইন/g, "Bulk Anime Category Assignment"], [/এmultiple এনিমে সিলেক্ট করে together category সেট করুন।/g, "Select multiple anime and set their category together."], [/এনিমে সার্চ/g, "Search anime"], [/category/g, "Category"], [/টি সিলেক্টেড/g, "selected"], [/সেট করুন/g, "Set"], [/all সিলেকশন বাতিল/g, "Clear all selections"], [/no এনিমে নেই/g, "No anime found"], [/category সেট হয়েছে/g, "category set"],
 [/টেলিগ্রামে পোস্ট করুন/g, "Post to Telegram"], [/চ্যানেল আইডি/g, "Channel ID"], [/সিজন/g, "Season"], [/নতুন EP/g, "New EP"], [/পোস্টার URL/g, "Poster URL"], [/বাদ enter/g, "Cancel"], [/পোস্টে যান/g, "Go to Post"], [/চ্যানেলে পোস্ট sendো হয়েছে/g, "channel posts sent"], [/চ্যানেলে sendো হয়েছে/g, "channels sent"], [/all চ্যানেলে পোস্ট ব্যর্থ হয়েছে/g, "Posting failed for all channels"], [/all চ্যানেলে ব্যর্থ/g, "All channels failed"], [/চ্যানেলে সফল/g, "channels succeeded"],
 [/Send Money করুন নিচের Noম্বারে এবং Transaction ID সাবমিট করুন।/g, "Send Money to the number below and submit the Transaction ID."], [/Anime-specific genres ও rating লোড হয়েছে/g, "Anime-specific genres and rating loaded"], [/এthis ID থেকে genre data পাওয়া যায়নি/g, "No genre data found for this ID"],
 [/all active free access cancel করতে want\?/g, "Cancel all active free access?"], [/all free access বাতিল করা হয়েছে/g, "All free access has been canceled"], [/এর free access বাতিল করতে want\?/g, "free access should be canceled?"], [/নির্দিষ্ট user's free access বাতিল করা হয়েছে/g, "Selected user's free access has been canceled"],
 [/এপিসোড Noম TMDB থেকে লোড হয়েছে/g, "episode names loaded from TMDB"], [/অটো category/g, "Auto category"], [/আগে থেকেthis আছে/g, "already exists"], [/AnimeSalt contেন্ট New Release এ সাপোর্ট করা হয় No/g, "AnimeSalt content is not supported in New Releases"],
 [/JSON টেক্সট Paste করুন/g, "Paste JSON text"], [/অবৈধ JSON ফরম্যাট। episodes বা seasons array থাকা needed।/g, "Invalid JSON format. An episodes or seasons array is required."], [/অবৈধ JSON। episodes array থাকা needed।/g, "Invalid JSON. An episodes array is required."], [/no এপিসোড পাওয়া যায়নি JSON-এ/g, "No episodes found in the JSON"], [/টি সিজন JSON থেকে ইমপোর্ট হয়েছে/g, "seasons imported from JSON"], [/টি এপিসোড JSON থেকে ইমপোর্ট হয়েছে/g, "episodes imported from JSON"],
 [/এthis সিরিজের all লিংকে ডোমেইন রিপ্লেস করো। সেভ করলেthis Firebase-এ যাবে।/g, "Replace domains in every link for this series. Saving writes the changes to the database."], [/লিংক থেকে ডোমেইন বের করো/g, "extract domain from links"], [/রিপ্লেস হয়েছে/g, "replaced"], [/এthis সিরিজের all সিজন ও এপিসোডের JSON ডাউনলোড করো।/g, "Download JSON for all seasons and episodes in this series."],
 [/New Release তৈরি করুন/g, "Create New Release"], [/সিজন ও এপিসোড সিলেক্ট করুন/g, "select season and episode"], [/মোট FCM টোকেন/g, "Total FCM Tokens"], [/পিং/g, "Ping"], [/জন/g, "users"], [/all মুছুন/g, "Clear All"], [/anyone এখনো পাসওয়ার্ড পরিবর্তন করেনি/g, "No password reset logs yet"],
 [/এthis লিংক যেno জায়গায় শেয়ার করুন। প্রতিটি ইউজার ওপেন করলে different different র‍্যান্ডম সময় পাবে \(২৪h - ৪৮h\)।/g, "Share this link anywhere. Each user gets a different random free-access duration (24h–48h)."], [/chance/g, "chance"], [/ঘন্টা/g, "hours"], [/টি/g, ""],
 [/Webhook সেট করলে anyone বটে \/start দিলে সুন্দর Welcome মেসেজ পাবে — ওয়েবসাইটের ডিটেলস, চ্যানেল লিংক সহ।/g, "Set the webhook so /start sends a polished welcome message with website details and channel links."], [/এখানে only Telegram Post function URL থাকবে। বাকি cutা ওয়া all router block বাদ ওয়া হয়েছে।/g, "Only the Telegram Post function URL stays here. The old router blocks were removed."], [/function হিসেবে এটা use করো/g, "function"],
 [/all সিরিজ/g, "All Series"], [/রিফ্রেশ শুরু/g, "Start Refresh"], [/সিলেক্ট করুন/g, "Select"], [/সিরিজ/g, "series"], [/এনিমে/g, "anime"], [/বাকি/g, "remaining"], [/sendো হয়ে গেছে/g, "already sent"], [/Reset করলে all এনিমে আবার sendো যাবে। নিশ্চিত\?/g, "Reset lets every anime be sent again. Continue?"], [/all এনিমে আবার sendো যাবে/g, "all anime can be sent again"],
 [/০/g, "0"], [/১/g, "1"], [/২/g, "2"], [/৩/g, "3"], [/৪/g, "4"], [/৫/g, "5"], [/৬/g, "6"], [/৭/g, "7"], [/৮/g, "8"], [/৯/g, "9"],
];

const translateAdminText = (value: string) => ADMIN_BN_TRANSLATIONS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
const applyAdminEnglish = (root: ParentNode) => {
 const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
 const textNodes: Text[] = [];
 while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
 textNodes.forEach((node) => {
 const next = translateAdminText(node.nodeValue || "");
 if (next !== node.nodeValue) node.nodeValue = next;
 });
 if (root instanceof Element || root instanceof Document) {
 root.querySelectorAll?.("input, textarea, button, [title], [aria-label]").forEach((el) => {
 ["placeholder", "title", "aria-label"].forEach((attr) => {
 const current = el.getAttribute(attr);
 if (!current) return;
 const next = translateAdminText(current);
 if (next !== current) el.setAttribute(attr, next);
 });
 });
 }
};

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
 qualityLinks?: { default?: string; p480?: string; p720?: string; p1080?: string; p4k?: string };
 audioTracks?: { language: string; label: string; link: string; audioUrl?: string; rawAudioUrl?: string; link480?: string; link720?: string; link1080?: string; link4k?: string; isDefault?: boolean }[];
 defaultAudio?: { language: string; label: string; link: string; audioUrl?: string; rawAudioUrl?: string; isDefault?: boolean } | null;
 subtitleTracks?: { language?: string; label: string; url: string }[];
}

interface Season {
 name: string;
 seasonNumber: number;
 episodes: Episode[];
}

type SeasonsByLanguage = Record<string, Season[]>;

import { THEME_PRESETS, type ThemePreset } from "@/lib/themePresets";

// ==================== FCM PROVIDER TOGGLE SECTION ====================
const FcmProviderSection = ({ glassCard, inputClass, btnPrimary, btnSecondary }: { glassCard: string; inputClass: string; btnPrimary: string; btnSecondary: string }) => {
 const [activeProvider, setActiveProvider] = useState<"cloudflare" | "supabase">("cloudflare");
 const [cfUrl, setCfUrl] = useState("");
 const [cfUrlInput, setCfUrlInput] = useState("");
 const [sbUrl, setSbUrl] = useState("");
 const [sbUrlInput, setSbUrlInput] = useState("");
 const [testing, setTesting] = useState<string | null>(null);
 const [testResults, setTestResults] = useState<Record<string, { alive: boolean; latency: number } | null>>({});

 useEffect(() => {
 const unsub = onValue(ref(db, "settings/fcmProvider"), (snap) => {
 const val = snap.val();
 if (val) {
 setActiveProvider(val.active || "cloudflare");
 setCfUrl(val.cloudflareUrl || "");
 setCfUrlInput(val.cloudflareUrl || "");
 setSbUrl(val.supabaseUrl || "");
 setSbUrlInput(val.supabaseUrl || "");
 }
 });
 return () => unsub();
 }, []);

 const switchProvider = async (provider: "cloudflare" | "supabase") => {
 const url = provider === "cloudflare" ? cfUrl : sbUrl;
 if (!url) {
 toast.error(`Set the ${provider === "cloudflare" ? "Cloudflare" : "Supabase"} URL first.`);
 return;
 }
 setActiveProvider(provider);
 await update(ref(db, "settings/fcmProvider"), { active: provider, url });
 toast.success(`🔔 FCM Provider: ${provider === "cloudflare" ? "☁️ Cloudflare" : "🟢 Supabase"} enabled.`);
 };

 const saveCfUrl = async () => {
 const url = cfUrlInput.trim();
 setCfUrl(url);
 const updates: Record<string, any> = { cloudflareUrl: url };
 if (activeProvider === "cloudflare") updates.url = url;
 await update(ref(db, "settings/fcmProvider"), updates);
 toast.success("✅ Cloudflare FCM URL saved.");
 };

 const saveSbUrl = async () => {
 const url = sbUrlInput.trim();
 setSbUrl(url);
 const updates: Record<string, any> = { supabaseUrl: url };
 if (activeProvider === "supabase") updates.url = url;
 await update(ref(db, "settings/fcmProvider"), updates);
 toast.success("✅ Supabase FCM URL saved.");
 };

 const testProvider = async (provider: "cloudflare" | "supabase") => {
 const url = provider === "cloudflare" ? cfUrl : sbUrl;
 if (!url) { toast.error("Enter a URL first."); return; }
 setTesting(provider);
 const start = Date.now();
 try {
 const controller = new AbortController();
 const t = setTimeout(() => controller.abort(), 10000);
 const res = await fetch(url, {
 method: "POST",
 headers: {
 "Content-Type": "application/json",
 ...(provider === "supabase" && SUPABASE_ANON_KEY ? { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } : {}),
 },
 body: JSON.stringify({ tokens: [], title: "test", body: "test" }),
 signal: controller.signal,
 });
 clearTimeout(t);
 const latency = Date.now() - start;
 const text = await res.text().catch(() => "");
 const alive = text.includes('"error"') || text.includes('"success"') || text.includes('"totalTokens"') || res.status < 500;
 setTestResults(prev => ({ ...prev, [provider]: { alive, latency } }));
 } catch {
 setTestResults(prev => ({ ...prev, [provider]: { alive: false, latency: Date.now() - start } }));
 }
 setTesting(null);
 };

 return (
 <div className={`${glassCard} p-4 mb-4`}>
 <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
 <Bell size={14} className="text-yellow-400" /> 🔔 FCM Push Provider
 </h3>
 <p className="text-[10px] text-zinc-400 mb-4">
 Choose Cloudflare or Supabase as your push notification provider. Only one active at a time.
 </p>

 {/* Provider Toggle */}
 <div className="grid grid-cols-2 gap-2 mb-4">
 <button
 onClick={() => switchProvider("cloudflare")}
 className={`p-3 rounded-xl border-2 transition-all text-center ${
 activeProvider === "cloudflare"
 ? "border-cyan-500 bg-cyan-500/10"
 : "border-zinc-700/40 bg-zinc-800/40 opacity-60"
 }`}
 >
 <div className="text-lg mb-1">☁️</div>
 <div className="text-[11px] font-semibold text-white">Cloudflare</div>
 {activeProvider === "cloudflare" && (
 <div className="flex items-center justify-center gap-1 mt-1">
 <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
 <span className="text-[9px] text-green-400">Active</span>
 </div>
 )}
 </button>
 <button
 onClick={() => switchProvider("supabase")}
 className={`p-3 rounded-xl border-2 transition-all text-center ${
 activeProvider === "supabase"
 ? "border-emerald-500 bg-emerald-500/10"
 : "border-zinc-700/40 bg-zinc-800/40 opacity-60"
 }`}
 >
 <div className="text-lg mb-1">🟢</div>
 <div className="text-[11px] font-semibold text-white">Supabase</div>
 {activeProvider === "supabase" && (
 <div className="flex items-center justify-center gap-1 mt-1">
 <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
 <span className="text-[9px] text-green-400">Active</span>
 </div>
 )}
 </button>
 </div>

 {/* Cloudflare URL */}
 <div className={`p-3 rounded-xl border mb-3 ${activeProvider === "cloudflare" ? "border-cyan-500/40 bg-zinc-800/60" : "border-zinc-700/30 bg-zinc-800/20 opacity-50"}`}>
 <div className="flex items-center gap-2 mb-2">
 <span className="text-[11px] font-semibold">☁️ Cloudflare FCM URL</span>
 {testResults.cloudflare && (
 <span className={`text-[9px] font-mono ${testResults.cloudflare.alive ? "text-green-400" : "text-red-400"}`}>
 {testResults.cloudflare.alive ? `✓ ${testResults.cloudflare.latency}ms` : "✕ Down"}
 </span>
 )}
 </div>
 <div className="flex gap-1.5">
 <input value={cfUrlInput} onChange={(e) => setCfUrlInput(e.target.value)}
 placeholder="https://worker.workers.dev/send-fcm" className={`${inputClass} !text-[10px] !py-1.5 flex-1`} />
 <button onClick={saveCfUrl} className={`${btnSecondary} !px-2 !py-1 !text-[10px]`}><Save size={10} /></button>
 <button onClick={() => testProvider("cloudflare")} disabled={testing === "cloudflare"} className={`${btnSecondary} !px-2 !py-1 !text-[10px]`}>
 {testing === "cloudflare" ? <RefreshCw size={10} className="animate-spin" /> : <Activity size={10} />}
 </button>
 </div>
 </div>

 {/* Supabase URL */}
 <div className={`p-3 rounded-xl border ${activeProvider === "supabase" ? "border-emerald-500/40 bg-zinc-800/60" : "border-zinc-700/30 bg-zinc-800/20 opacity-50"}`}>
 <div className="flex items-center gap-2 mb-2">
 <span className="text-[11px] font-semibold">🟢 Supabase FCM URL 1</span>
 {testResults.supabase && (
 <span className={`text-[9px] font-mono ${testResults.supabase.alive ? "text-green-400" : "text-red-400"}`}>
 {testResults.supabase.alive ? `✓ ${testResults.supabase.latency}ms` : "✕ Down"}
 </span>
 )}
 </div>
 <div className="flex gap-1.5 mb-2">
 <input value={sbUrlInput} onChange={(e) => setSbUrlInput(e.target.value)}
 placeholder="https://xxx.supabase.co/functions/v1/send-fcm" className={`${inputClass} !text-[10px] !py-1.5 flex-1`} />
 <button onClick={saveSbUrl} className={`${btnSecondary} !px-2 !py-1 !text-[10px]`}><Save size={10} /></button>
 <button onClick={() => testProvider("supabase")} disabled={testing === "supabase"} className={`${btnSecondary} !px-2 !py-1 !text-[10px]`}>
 {testing === "supabase" ? <RefreshCw size={10} className="animate-spin" /> : <Activity size={10} />}
 </button>
 </div>
 </div>
 </div>
 );
};



// Legacy Telegram URL/webhook panels removed: EGD Router → telegram-post is the single URL source.

// ==================== EMAIL SERVICE SECTION ====================
const EmailServiceSection = ({ glassCard, inputClass, btnPrimary, btnSecondary }: { glassCard: string; inputClass: string; btnPrimary: string; btnSecondary: string }) => {
 const [otpUrl, setOtpUrl] = useState("");
 const [otpUrlInput, setOtpUrlInput] = useState("");
 const [testing, setTesting] = useState(false);
 const [testResult, setTestResult] = useState<{ alive: boolean; latency: number } | null>(null);
 const [resetLogs, setResetLogs] = useState<any[]>([]);
 const [loadingLogs, setLoadingLogs] = useState(true);

 useEffect(() => {
 const unsub = onValue(ref(db, "settings/emailService"), (snap) => {
 const val = snap.val();
 if (val) {
 setOtpUrl(val.otpFunctionUrl || "");
 setOtpUrlInput(val.otpFunctionUrl || "");
 }
 });
 return () => unsub();
 }, []);

 useEffect(() => {
 const unsub = onValue(ref(db, "passwordResets"), (snap) => {
 const val = snap.val();
 if (val) {
 const arr = Object.entries(val).map(([k, v]: any) => ({ id: k, ...v }));
 arr.sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0));
 setResetLogs(arr);
 } else {
 setResetLogs([]);
 }
 setLoadingLogs(false);
 });
 return () => unsub();
 }, []);

 const saveUrl = async () => {
 await set(ref(db, "settings/emailService/otpFunctionUrl"), otpUrlInput.trim());
 toast.success("✅ Email Service URL saved!");
 };

 const testUrl = async () => {
 if (!otpUrl) { toast.error("Set the URL first."); return; }
 setTesting(true);
 setTestResult(null);
 const start = Date.now();
 try {
 const controller = new AbortController();
 const t = setTimeout(() => controller.abort(), 8000);
 const res = await fetch(otpUrl, { method: "GET", signal: controller.signal });
 clearTimeout(t);
 setTestResult({ alive: res.status < 500, latency: Date.now() - start });
 } catch {
 setTestResult({ alive: false, latency: Date.now() - start });
 }
 setTesting(false);
 };

 const clearLogs = async () => {
 if (!confirm("Delete all password reset logs?")) return;
 await remove(ref(db, "passwordResets"));
 toast.success("Logs cleared.");
 };

 return (
 <div className="space-y-4">
 <h2 className="text-lg font-bold text-white flex items-center gap-2"><Mail size={18} className="text-indigo-400" /> Email Service</h2>

 {/* OTP Function URL */}
 <div className={`${glassCard} p-4 space-y-3`}>
 <h3 className="text-sm font-semibold text-zinc-300 flex items-center gap-2">
 <Link size={14} className="text-cyan-400" /> OTP Email Function URL
 </h3>
 <p className="text-[10px] text-zinc-500">
 Enter the send-otp-email function URL here. If you later deploy on another platform, updating this URL will be enough.
 </p>
 <div className="flex gap-2">
 <input value={otpUrlInput} onChange={e => setOtpUrlInput(e.target.value)}
 placeholder="https://your-project.supabase.co/functions/v1/send-otp-email"
 className={inputClass + " flex-1 text-[11px] font-mono"} />
 <button onClick={saveUrl} className={`${btnPrimary} px-3 py-2 text-xs`}><Save size={12} /></button>
 </div>
 <div className="flex items-center gap-3">
 <button onClick={testUrl} disabled={testing || !otpUrl} className={`${btnSecondary} px-3 py-1.5 text-[10px] flex items-center gap-1.5 disabled:opacity-40`}>
 {testing ? <Loader2 size={10} className="animate-spin" /> : <Activity size={10} />} Ping
 </button>
 {testResult && (
 <span className={`text-[10px] font-mono ${testResult.alive ? "text-emerald-400" : "text-red-400"}`}>
 {testResult.alive ? "✅" : "❌"} {testResult.latency}ms
 </span>
 )}
 {otpUrl && (
 <span className="text-[10px] text-emerald-400/60 font-mono truncate max-w-[200px]">{otpUrl}</span>
 )}
 </div>
 </div>

 {/* Password Reset Logs */}
 <div className={`${glassCard} p-4 space-y-3`}>
 <div className="flex items-center justify-between">
 <h3 className="text-sm font-semibold text-zinc-300 flex items-center gap-2">
 <KeyRound size={14} className="text-amber-400" /> Password Reset Logs
 </h3>
 <div className="flex items-center gap-2">
 <span className="text-[10px] text-zinc-500">{resetLogs.length} users</span>
 {resetLogs.length > 0 && (
 <button onClick={clearLogs} className={`${btnSecondary} px-2 py-1 text-[9px] flex items-center gap-1`}>
 <Trash2 size={9} /> Clear All
 </button>
 )}
 </div>
 </div>

 {loadingLogs ? (
 <div className="text-center py-4"><Loader2 size={16} className="animate-spin text-zinc-500 mx-auto" /></div>
 ) : resetLogs.length === 0 ? (
 <p className="text-[11px] text-zinc-600 text-center py-4">No password reset logs yet</p>
 ) : (
 <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
 {resetLogs.map((log: any) => (
 <div key={log.id} className="bg-white/3 border border-white/5 rounded-lg px-3 py-2 flex items-center justify-between">
 <div className="flex-1 min-w-0">
 <p className="text-[11px] text-white font-medium truncate">{log.email}</p>
 <p className="text-[9px] text-zinc-500">{log.name || "—"}</p>
 </div>
 <div className="text-right flex-shrink-0 ml-2">
 <p className="text-[9px] text-zinc-400">{log.timestamp ? new Date(log.timestamp).toLocaleString("bn-BD") : "—"}</p>
 <p className="text-[9px] text-emerald-400/60">{log.method || "supabase-otp"}</p>
 </div>
 </div>
 ))}
 </div>
 )}
 </div>
 </div>
 );
};

// ==================== CLOUDFLARE WORKER ROUTER SECTION ====================
// ==================== FUNCTION URL OVERRIDES — admin paste OR Lovable-deployed default ====================
// Every library function is ALSO deployed on Lovable Cloud (this project). The
// "Default" button pastes the Lovable-hosted URL so admin can fall back when
// self-hosted credits run out, and switch back to their own URL anytime.
const LOVABLE_DEFAULT_BASE = "https://kqxpzqegtvaiwgdusrin.supabase.co/functions/v1";
const ROUTER_FUNCTIONS: Array<{ slug: string; label: string; isNew?: boolean; badgeText?: string; badgeTone?: "emerald" | "cyan" | "amber"; defaultUrl: string }> = EDGE_FUNCTION_LIBRARY.map(
 (e) => ({ slug: e.slug, label: e.label, isNew: e.isNew, badgeText: e.badgeText, badgeTone: e.badgeTone, defaultUrl: `${LOVABLE_DEFAULT_BASE}/${e.slug}` })
);


const FunctionUrlOverrides = ({ glassCard, inputClass, btnPrimary, btnSecondary }: { glassCard: string; inputClass: string; btnPrimary: string; btnSecondary: string }) => {
 const [urls, setUrls] = useState<Record<string, string>>({});
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
 const [saving, setSaving] = useState<string | null>(null);
 const [testing, setTesting] = useState<string | null>(null);
 const [testResult, setTestResult] = useState<Record<string, { ok: boolean; ms: number }>>({});

 useEffect(() => {
 const unsub = onValue(ref(db, "settings/functionOverrides"), (snap) => {
 const v = snap.val() || {};
 const u: Record<string, string> = {};
 const e: Record<string, boolean> = {};
 ROUTER_FUNCTIONS.forEach(({ slug }) => {
 u[slug] = String(v?.[slug]?.customUrl || "");
 e[slug] = v?.[slug]?.enabled === true;
 });
 setUrls(u);
 setEnabled(e);
 });
 return () => unsub();
 }, []);

  const save = async (slug: string) => {
   setSaving(slug);
   try {
   const url = (urls[slug] || "").trim();
    if (url && !/^https?:\/\//i.test(url)) { toast.error("Paste a valid http/https function URL"); return; }
     const active = Boolean(url) && enabled[slug] === true;
   await set(ref(db, `settings/functionOverrides/${slug}`), {
    enabled: active,
   customUrl: url,
    updatedAt: Date.now(),
    source: "egd-router",
   });
   if (slug === "video-proxy") {
    await remove(ref(db, "egdManager/config/playerProxyUrl"));
   }
    toast.success(active ? `Activated · ${slug}` : `Disabled · ${slug}`);
   } catch (e: any) { toast.error(e?.message || "Save failed"); }
   finally { setSaving(null); }
  };

 const clearLocal = (slug: string) => {
 setUrls((p) => ({ ...p, [slug]: "" }));
 setEnabled((p) => ({ ...p, [slug]: false }));
 };

 const ping = async (slug: string) => {
 const u = (urls[slug] || "").trim();
 if (!u) { toast.error("Paste and save a deployed URL first"); return; }
 setTesting(slug);
 const start = Date.now();
 try {
 const ctrl = new AbortController();
 const t = setTimeout(() => ctrl.abort(), 6000);
 const r = await fetch(u, { method: "OPTIONS", signal: ctrl.signal });
 clearTimeout(t);
 setTestResult((p) => ({ ...p, [slug]: { ok: r.status < 500, ms: Date.now() - start } }));
 } catch {
 setTestResult((p) => ({ ...p, [slug]: { ok: false, ms: Date.now() - start } }));
 } finally { setTesting(null); }
 };

 return (
 <div className={`${glassCard} p-4 mb-4`}>
 <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
 <div className="min-w-0">
 <h3 className="text-sm font-semibold flex items-center gap-2">
  <Link size={14} className="text-emerald-400" /> EGD Router — Deployed URLs
 </h3>
 <p className="text-[10px] text-zinc-400 mt-1 break-words">
  Paste your self-deployed URL, or hit <b>Default</b> to fall back to the Lovable-hosted copy. Empty or disabled rows are ignored.
 </p>
 </div>
 </div>

 <div className="space-y-2">
  {ROUTER_FUNCTIONS.map(({ slug, label, isNew, badgeText, badgeTone, defaultUrl }) => {
 const res = testResult[slug];
 const isVideoProxy = slug === "video-proxy";
 const isDefault = (urls[slug] || "").trim() === defaultUrl;
 const badgeClass = badgeTone === "cyan" ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40"
   : badgeTone === "amber" ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
   : "bg-emerald-500/20 text-emerald-300 border-emerald-500/40";
 return (
 <div key={slug} className="rounded-xl border bg-zinc-900/40 p-3 min-w-0 border-zinc-700/50">
 <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
 <div className="min-w-0 flex items-center gap-2">
 <div className="min-w-0">
 <div className="text-xs font-semibold text-white truncate flex items-center gap-1.5">
 {label}
  {(badgeText || isNew) && (
  <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded border tracking-wider ${badgeClass}`}>
  {badgeText || "NEW"}
  </span>
  )}
 {isVideoProxy && (
 <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 tracking-wider">
 PLAYER PROXY
 </span>
 )}
 </div>
 <div className="text-[10px] text-zinc-500 truncate">{slug}</div>
 </div>
 </div>
 <button
  onClick={() => setEnabled((p) => ({ ...p, [slug]: !(p[slug] === true) }))}
  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 ${enabled[slug] === true ? 'bg-emerald-600' : 'bg-zinc-600'}`}
  title={enabled[slug] === true ? "Enabled" : "Disabled"}
 >
  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${enabled[slug] === true ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
 </button>
 </div>
 <input
 value={urls[slug] || ""}
  onChange={(e) => {
  const value = e.target.value;
  setUrls((p) => ({ ...p, [slug]: value }));
  setEnabled((p) => ({ ...p, [slug]: Boolean(value.trim()) }));
  }}
  placeholder={`Paste deployed ${slug} URL here`}
 className={inputClass + " w-full text-[11px]"}
 />
 <div className="flex flex-wrap gap-1.5 mt-2">
  <button onClick={() => clearLocal(slug)} className={`${btnSecondary} !px-2 !py-1 !text-[10px]`}>
  Clear
 </button>
 <button
   onClick={() => {
     setUrls((p) => ({ ...p, [slug]: defaultUrl }));
     setEnabled((p) => ({ ...p, [slug]: true }));
     toast.success("Default URL pasted — hit Save to activate");
   }}
   className={`${btnSecondary} !px-2 !py-1 !text-[10px] inline-flex items-center gap-1 ${isDefault ? '!border-cyan-500/50 !text-cyan-300' : ''}`}
   title="Use the Lovable-deployed copy of this function"
 >
   ⭐ Default{isDefault ? " ✓" : ""}
 </button>
 <button onClick={() => save(slug)} disabled={saving === slug} className={`${btnPrimary} !px-2 !py-1 !text-[10px] inline-flex items-center gap-1`}>
 {saving === slug ? <Loader2 className="animate-spin" size={10} /> : <Save size={10} />} Save
 </button>
 <button onClick={() => ping(slug)} disabled={testing === slug} className={`${btnSecondary} !px-2 !py-1 !text-[10px] inline-flex items-center gap-1`}>
 {testing === slug ? <Loader2 className="animate-spin" size={10} /> : <span>📡</span>} Ping
 </button>
 {res && (
 <span className={`text-[10px] px-1.5 py-1 rounded ${res.ok ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"}`}>
 {res.ok ? "✓" : "✕"} {res.ms}ms
 </span>
 )}
 </div>
 </div>
 );
 })}
 </div>
 </div>
 );
};

const EdgeRouterSection = ({ glassCard, inputClass, btnPrimary, btnSecondary }: { glassCard: string; inputClass: string; btnPrimary: string; btnSecondary: string }) => (
 <FunctionUrlOverrides glassCard={glassCard} inputClass={inputClass} btnPrimary={btnPrimary} btnSecondary={btnSecondary} />
);

// ==================== AD GATE COOLDOWN CONFIG ====================
const AdGateCooldownConfig = ({ glassCard, inputClass, btnPrimary }: { glassCard: string; inputClass: string; btnPrimary: string }) => {
 const [minutes, setMinutes] = useState<number>(0);
 const [saving, setSaving] = useState(false);
 useEffect(() => {
 const r = ref(db, "settings/adGateCooldownMinutes");
 const unsub = onValue(r, (snap) => {
 const v = Number(snap.val());
 setMinutes(Number.isFinite(v) && v >= 0 ? v : 0);
 });
 return () => unsub();
 }, []);
 const save = async () => {
 setSaving(true);
 try {
 await set(ref(db, "settings/adGateCooldownMinutes"), Math.max(0, Number(minutes) || 0));
 toast.success("Ad gate cooldown saved");
 } catch (e: any) { toast.error(e?.message || "Save failed"); }
 finally { setSaving(false); }
 };
 return (
 <div className={`${glassCard} p-4 mb-4`}>
 <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
 <Clock size={14} className="text-amber-400" /> Ad Gate Cooldown
 </h3>
 <p className="text-[11px] text-zinc-400 mb-3">
 Minimum gap (in minutes) between two ad gates for the same user. Set to <b>0</b> to show the ad gate every time the user starts a video.
 </p>
 <div className="flex gap-2 items-end">
 <div className="flex-1">
 <label className="text-[10px] text-zinc-400 mb-1 block">Cooldown (minutes)</label>
 <input type="number" min={0} max={1440} value={minutes}
 onChange={e => setMinutes(Math.max(0, Number(e.target.value) || 0))}
 className={inputClass} />
 </div>
 <button onClick={save} disabled={saving} className={`${btnPrimary} px-4 py-2 text-xs flex items-center justify-center gap-2`}>
 <Save size={12} /> {saving ? "..." : "Save"}
 </button>
 </div>
 </div>
 );
};

// ==================== TELEGRAM POST FREE-ACCESS CONFIG ====================
const TelegramFreeAccessConfig = ({ glassCard, inputClass, btnPrimary, btnSecondary }: { glassCard: string; inputClass: string; btnPrimary: string; btnSecondary: string }) => {
 const [enabled, setEnabled] = useState(false);
 const [hours, setHours] = useState<number>(24);
 const [label, setLabel] = useState<string>("🔓 Free Access (24h)");
 const [saving, setSaving] = useState(false);

 useEffect(() => {
 const r = ref(db, "settings/telegramFreeAccess");
 const unsub = onValue(r, (snap) => {
 const v = snap.val() || {};
 setEnabled(v.enabled === true);
 setHours(Number(v.hours) > 0 ? Number(v.hours) : 24);
 setLabel(String(v.label || "🔓 Free Access (24h)"));
 });
 return () => unsub();
 }, []);

 const save = async () => {
 setSaving(true);
 try {
 await set(ref(db, "settings/telegramFreeAccess"), { enabled, hours, label });
 toast.success("Saved");
 } catch (e: any) { toast.error(e?.message || "Save failed"); }
 finally { setSaving(false); }
 };

 return (
 <div className={`${glassCard} p-4 mb-4`}>
 <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
 <Send size={14} className="text-cyan-400" /> Telegram Post — Free Access Button
 </h3>
 <p className="text-[11px] text-zinc-400 mb-3">
 Auto-attach a "Free Access" button to <b>every</b> Telegram post. Users tap it → bot DM → finish shortener → get access token (paste-able in player).
 </p>
 <div className="space-y-2.5">
 <div className="flex items-center justify-between bg-zinc-800/40 rounded-lg p-2.5">
 <span className="text-xs text-white">Enabled on every post</span>
 <button onClick={() => setEnabled(v => !v)}
 className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${enabled ? 'bg-green-600' : 'bg-zinc-600'}`}>
 <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
 </button>
 </div>
 <div>
 <label className="text-[10px] text-zinc-400 mb-1 block">Access duration (hours)</label>
 <input type="number" min={1} max={720} value={hours}
 onChange={e => setHours(Math.max(1, Number(e.target.value) || 24))}
 className={inputClass} />
 </div>
 <div>
 <label className="text-[10px] text-zinc-400 mb-1 block">Button label (shown under each TG post)</label>
 <input type="text" value={label} onChange={e => setLabel(e.target.value)} className={inputClass} placeholder="🔓 Free Access (24h)" />
 </div>
 <button onClick={save} disabled={saving} className={`${btnPrimary} w-full py-2 text-xs flex items-center justify-center gap-2`}>
 <Save size={12} /> {saving ? "Saving..." : "Save"}
 </button>
 </div>
 </div>
 );
};

// ==================== TELEGRAM POST — GLOBAL PERMANENT CUSTOM BUTTON ====================
const TelegramGlobalButtonConfig = ({ glassCard, inputClass, btnPrimary }: { glassCard: string; inputClass: string; btnPrimary: string; btnSecondary: string }) => {
 const [enabled, setEnabled] = useState(false);
 const [text, setText] = useState("");
 const [url, setUrl] = useState("");
 const [saving, setSaving] = useState(false);

 useEffect(() => {
 const r = ref(db, "settings/telegramGlobalButton");
 const unsub = onValue(r, (snap) => {
 const v = snap.val() || {};
 setEnabled(v.enabled === true);
 setText(String(v.text || ""));
 setUrl(String(v.url || ""));
 });
 return () => unsub();
 }, []);

 const save = async () => {
 setSaving(true);
 try {
 await set(ref(db, "settings/telegramGlobalButton"), { enabled, text: text.trim(), url: url.trim() });
 toast.success("Global button saved");
 } catch (e: any) { toast.error(e?.message || "Save failed"); }
 finally { setSaving(false); }
 };

 return (
 <div className={`${glassCard} p-4 mb-4`}>
 <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
 <Send size={14} className="text-pink-400" /> Telegram Post — Global Permanent Button
 </h3>
 <p className="text-[11px] text-zinc-400 mb-3">
 This button will be attached to <b>every</b> Telegram post automatically. Turn it off anytime to stop sending.
 </p>
 <div className="space-y-2.5">
 <div className="flex items-center justify-between bg-zinc-800/40 rounded-lg p-2.5">
 <span className="text-xs text-white">Enabled on every post</span>
 <button onClick={() => setEnabled(v => !v)}
 className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${enabled ? 'bg-green-600' : 'bg-zinc-600'}`}>
 <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
 </button>
 </div>
 <div>
 <label className="text-[10px] text-zinc-400 mb-1 block">Button label</label>
 <input type="text" value={text} onChange={e => setText(e.target.value)} className={inputClass} placeholder="🌐 Visit Website" />
 </div>
 <div>
 <label className="text-[10px] text-zinc-400 mb-1 block">Button URL</label>
 <input type="text" value={url} onChange={e => setUrl(e.target.value)} className={inputClass} placeholder="https://rsanime03.lovable.app" />
 </div>
 <button onClick={save} disabled={saving} className={`${btnPrimary} w-full py-2 text-xs flex items-center justify-center gap-2`}>
 <Save size={12} /> {saving ? "Saving..." : "Save Global Button"}
 </button>
 </div>
 </div>
 );
};

// ==================== AD SERVICES SECTION ====================
const AdServicesSection = ({ glassCard, inputClass, btnPrimary, btnSecondary }: { glassCard: string; inputClass: string; btnPrimary: string; btnSecondary: string }) => {
 const [services, setServices] = useState<Record<string, any>>({});
 const [newName, setNewName] = useState("");
 const [newShortenerUrl, setNewShortenerUrl] = useState("");
 const [newBotUrl, setNewBotUrl] = useState("");
 const [newIcon, setNewIcon] = useState("🔓");
 const [newColor, setNewColor] = useState("linear-gradient(135deg, #6366f1, #8b5cf6)");
 const [newMode, setNewMode] = useState<"shortener" | "miniapp">("shortener");
 const [testing, setTesting] = useState<string | null>(null);
 const [testResults, setTestResults] = useState<Record<string, { alive: boolean; latency: number } | null>>({});
 const [gateEnabled, setGateEnabled] = useState<boolean>(true);

 useEffect(() => {
 const unsub = onValue(ref(db, "settings/adServices"), (snap) => {
 setServices(snap.val() || {});
 });
 const unsubGate = onValue(ref(db, "settings/unlockGateEnabled"), (snap) => {
 setGateEnabled(snap.val() !== false);
 });
 return () => { unsub(); unsubGate(); };
 }, []);

 const toggleGate = async () => {
 await set(ref(db, "settings/unlockGateEnabled"), !gateEnabled);
 toast.success(!gateEnabled ? "✅ Unlock gate enabled" : "🚫 Unlock gate disabled — all videos play free");
 };

 const pickPrimaryUrl = (mode: "shortener" | "miniapp", shortenerUrl?: string, botUrl?: string) => {
 return mode === "miniapp" ? (botUrl || "telegram://verify-bot") : (shortenerUrl || "");
 };

 const addService = async () => {
 const name = newName.trim();
 const shortenerUrl = newShortenerUrl.trim();
 const botUrl = newBotUrl.trim();
 if (!name) { toast.error("Service name required"); return; }
 if (newMode === "shortener" && !shortenerUrl) { toast.error("Shortener Edge Function URL required"); return; }
 if (newMode === "miniapp" && !botUrl) { toast.error("Telegram Bot Edge Function URL required"); return; }

 const id = `ad_${Date.now()}`;
 const primary = pickPrimaryUrl(newMode, shortenerUrl, botUrl);
 await set(ref(db, `settings/adServices/${id}`), {
 id, name,
 functionUrl: primary, // legacy compat
 shortenerFunctionUrl: shortenerUrl || null,
 telegramBotFunctionUrl: botUrl || null,
 enabled: true,
 icon: newIcon || "🔓",
 color: newColor || "",
 mode: newMode,
 });
 setNewName(""); setNewShortenerUrl(""); setNewBotUrl("");
 setNewIcon("🔓"); setNewMode("shortener");
 toast.success(`✅ "${name}" added!`);
 };

 const updateField = async (id: string, key: string, value: any) => {
 const svc = services[id] || {};
 const nextValue = value || null;
 const nextShortenerUrl = key === "shortenerFunctionUrl" ? (nextValue || "") : (svc.shortenerFunctionUrl || "");
 const nextBotUrl = key === "telegramBotFunctionUrl" ? (nextValue || "") : (svc.telegramBotFunctionUrl || "");
 const nextMode = (svc.mode || "shortener") as "shortener" | "miniapp";
 await update(ref(db, `settings/adServices/${id}`), {
 [key]: nextValue,
 functionUrl: pickPrimaryUrl(nextMode, nextShortenerUrl, nextBotUrl),
 updatedAt: Date.now(),
 });
 toast.success("Saved");
 };

 const setServiceMode = async (id: string, mode: "shortener" | "miniapp") => {
 const svc = services[id] || {};
 await update(ref(db, `settings/adServices/${id}`), {
 mode,
 functionUrl: pickPrimaryUrl(mode, svc.shortenerFunctionUrl || "", svc.telegramBotFunctionUrl || ""),
 updatedAt: Date.now(),
 });
 toast.success(mode === "miniapp" ? "Telegram Bot mode" : "Shortener mode");
 };

 const toggleService = async (id: string) => {
 const svc = services[id];
 if (!svc) return;
 await set(ref(db, `settings/adServices/${id}/enabled`), !svc.enabled);
 };

 const deleteService = async (id: string) => {
 await remove(ref(db, `settings/adServices/${id}`));
 toast.success("🗑️ Deleted");
 };

 const testService = async (id: string, url: string) => {
 if (!url) { toast.error("No URL set"); return; }
 setTesting(id);
 const start = Date.now();
 try {
 const controller = new AbortController();
 const t = setTimeout(() => controller.abort(), 8000);
 const res = await fetch(url, {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ url: "https://google.com" }),
 signal: controller.signal,
 });
 clearTimeout(t);
 const data = await res.json().catch(() => ({}));
 const alive = res.ok || !!data?.shortenedUrl || !!data?.success || !!data?.ok;
 setTestResults(prev => ({ ...prev, [id]: { alive, latency: Date.now() - start } }));
 } catch {
 setTestResults(prev => ({ ...prev, [id]: { alive: false, latency: Date.now() - start } }));
 }
 setTesting(null);
 };

 const serviceList = Object.values(services);

 return (
 <div className={`${glassCard} p-4 mb-4`}>
 <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
 <Link size={14} className="text-amber-400" /> 📢 Ad Link Services (Unlock Buttons)
 </h3>
 <p className="text-[10px] text-zinc-400 mb-4">
 Manage the ad-link unlock buttons users click to unlock videos. Each service has a Shortener URL and a Telegram Bot URL — pick which one is active per service.
 </p>

 <div className={`mb-4 rounded-xl p-3 border ${gateEnabled ? "bg-green-500/10 border-green-500/30" : "bg-zinc-800/40 border-zinc-700/40"}`}>
 <div className="flex items-center justify-between">
 <div>
 <p className="text-xs font-bold text-white">🌐 Unlock Gate (Global)</p>
 <p className="text-[10px] text-zinc-400 mt-0.5">
 {gateEnabled
 ? "ON — users must verify via the unlock page"
 : "OFF — all videos play free, no flash/redirect"}
 </p>
 </div>
 <button onClick={toggleGate}
 className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${gateEnabled ? 'bg-green-600' : 'bg-zinc-600'}`}>
 <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${gateEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
 </button>
 </div>
 </div>

 <div className="space-y-3 mb-4">
 {serviceList.length === 0 && (
 <p className="text-[10px] text-zinc-500 text-center py-3">No services yet. Add one below.</p>
 )}
 {serviceList.map((svc: any) => {
 const tr = testResults[svc.id];
 const activeMode = svc.mode || "shortener";
 const activeUrl = activeMode === "miniapp"
 ? (svc.telegramBotFunctionUrl || svc.functionUrl)
 : (svc.shortenerFunctionUrl || svc.functionUrl);
 return (
 <div key={svc.id} className={`bg-zinc-800/40 rounded-xl p-3 border ${svc.enabled ? "border-green-500/30" : "border-zinc-700/40 opacity-60"}`}>
 <div className="flex items-center justify-between mb-2">
 <div className="flex items-center gap-2">
 <span className="text-base">{svc.icon || "🔓"}</span>
 <span className="text-xs font-semibold text-white">{svc.name}</span>
 {tr && (
 <span className={`text-[9px] font-mono ${tr.alive ? "text-green-400" : "text-red-400"}`}>
 {tr.alive ? `✓ ${tr.latency}ms` : "✕ Down"}
 </span>
 )}
 </div>
 <div className="flex items-center gap-1.5">
 <button onClick={() => testService(svc.id, activeUrl)} disabled={testing === svc.id}
 className={`${btnSecondary} !px-2 !py-1 !text-[10px]`}>
 {testing === svc.id ? <RefreshCw size={10} className="animate-spin" /> : <Activity size={10} />}
 </button>
 <button onClick={() => toggleService(svc.id)}
 className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${svc.enabled ? 'bg-green-600' : 'bg-zinc-600'}`}>
 <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${svc.enabled ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
 </button>
 <button onClick={() => deleteService(svc.id)} className={`${btnSecondary} !px-2 !py-1 !text-[10px] text-red-400`}>
 <Trash2 size={10} />
 </button>
 </div>
 </div>

 {/* Mode selector */}
 <div className="flex items-center gap-2 bg-zinc-900/50 rounded-lg p-2 mb-2">
 <span className="text-[10px] text-zinc-400">Active mode:</span>
 <button
 onClick={() => setServiceMode(svc.id, "shortener")}
 className={`px-2 py-0.5 rounded text-[10px] font-semibold ${activeMode === "shortener" ? "bg-amber-500 text-black" : "bg-zinc-700 text-zinc-300"}`}>
 🔗 Shortener
 </button>
 <button
 onClick={() => setServiceMode(svc.id, "miniapp")}
 className={`px-2 py-0.5 rounded text-[10px] font-semibold ${activeMode === "miniapp" ? "bg-cyan-500 text-black" : "bg-zinc-700 text-zinc-300"}`}>
 🤖 Telegram Bot
 </button>
 </div>

 {/* Dual URL fields */}
 <div className="space-y-1.5">
 <div>
 <label className="text-[9px] text-amber-300">🔗 Shortener Edge Function URL</label>
 <input
 defaultValue={svc.shortenerFunctionUrl || (activeMode === "shortener" ? svc.functionUrl : "") || ""}
 onBlur={(e) => updateField(svc.id, "shortenerFunctionUrl", e.target.value.trim())}
 placeholder="https://xxx.supabase.co/functions/v1/shorten-arolinks"
 className={`${inputClass} !text-[10px]`} />
 </div>
 <div>
 <label className="text-[9px] text-cyan-300">🤖 Telegram Bot Edge Function URL</label>
 <input
 defaultValue={svc.telegramBotFunctionUrl || (activeMode === "miniapp" ? svc.functionUrl : "") || ""}
 onBlur={(e) => updateField(svc.id, "telegramBotFunctionUrl", e.target.value.trim())}
 placeholder="https://xxx.supabase.co/functions/v1/link-share-bot"
 className={`${inputClass} !text-[10px]`} />
 </div>
 </div>
 </div>
 );
 })}
 </div>

 {/* Add New Service */}
 <div className="bg-zinc-800/30 rounded-xl p-3 border border-dashed border-zinc-600/50">
 <h4 className="text-[11px] font-semibold text-white mb-2 flex items-center gap-1.5">
 <PlusCircle size={12} className="text-green-400" /> Add New Service
 </h4>
 <div className="space-y-2">
 <div className="flex items-center gap-2 bg-zinc-900/50 rounded-lg p-2">
 <span className="text-[10px] text-zinc-400">Default mode:</span>
 <button type="button" onClick={() => setNewMode("shortener")}
 className={`px-2 py-0.5 rounded text-[10px] font-semibold ${newMode === "shortener" ? "bg-amber-500 text-black" : "bg-zinc-700 text-zinc-300"}`}>
 🔗 Shortener
 </button>
 <button type="button" onClick={() => setNewMode("miniapp")}
 className={`px-2 py-0.5 rounded text-[10px] font-semibold ${newMode === "miniapp" ? "bg-cyan-500 text-black" : "bg-zinc-700 text-zinc-300"}`}>
 🤖 Telegram Bot
 </button>
 </div>
 <div className="flex gap-2">
 <input value={newIcon} onChange={(e) => setNewIcon(e.target.value)} placeholder="🔓" className={`${inputClass} !w-12 !text-center`} />
 <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Service name (e.g. AroLinks)" className={`${inputClass} flex-1`} />
 </div>
 <div>
 <label className="text-[9px] text-amber-300">🔗 Shortener Edge Function URL</label>
 <input value={newShortenerUrl} onChange={(e) => setNewShortenerUrl(e.target.value)}
 placeholder="https://xxx.supabase.co/functions/v1/shorten-arolinks" className={inputClass} />
 </div>
 <div>
 <label className="text-[9px] text-cyan-300">🤖 Telegram Bot Edge Function URL</label>
 <input value={newBotUrl} onChange={(e) => setNewBotUrl(e.target.value)}
 placeholder="https://xxx.supabase.co/functions/v1/link-share-bot" className={inputClass} />
 </div>
 <input value={newColor} onChange={(e) => setNewColor(e.target.value)}
 placeholder="Button color CSS (e.g. linear-gradient(135deg, #f59e0b, #ef4444))" className={inputClass} />
 <button onClick={addService} className={`${btnPrimary} w-full`}>
 <PlusCircle size={12} /> Add Service
 </button>
 </div>
 </div>
 </div>
 );
};

// ==================== AI CONFIG SECTION ====================
const AiConfigSection = ({ glassCard, inputClass, btnPrimary }: { glassCard: string; inputClass: string; btnPrimary: string }) => {
 const [aiEnabled, setAiEnabled] = useState(false);
 const [aiUrl, setAiUrl] = useState("");
 const [aiUrlInput, setAiUrlInput] = useState("");
 const [testing, setTesting] = useState(false);
 const [testResult, setTestResult] = useState<{ alive: boolean; latency: number } | null>(null);

 useEffect(() => {
 const unsub = onValue(ref(db, "settings/aiChat"), (snap) => {
 const val = snap.val();
 setAiEnabled(val?.enabled === true);
 setAiUrl(val?.url || "");
 setAiUrlInput(val?.url || "");
 });
 return () => unsub();
 }, []);

 const save = async () => {
 await set(ref(db, "settings/aiChat"), { enabled: aiEnabled, url: aiUrlInput.trim() });
 setAiUrl(aiUrlInput.trim());
 toast.success("✅ AI settings saved!");
 };

 const toggle = async () => {
 const next = !aiEnabled;
 setAiEnabled(next);
 await set(ref(db, "settings/aiChat/enabled"), next);
 toast.success(next ? "🤖 AI enabled" : "AI disabled");
 };

 const testAi = async () => {
 const url = aiUrlInput.trim();
 if (!url) { toast.error("Enter the AI URL first"); return; }
 setTesting(true);
 setTestResult(null);
 const start = Date.now();
 try {
 const controller = new AbortController();
 const t = setTimeout(() => controller.abort(), 10000);
 const res = await fetch(url, {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({
 messages: [{ role: "user", content: "ping" }],
 animeContext: "",
 userContext: "",
 }),
 signal: controller.signal,
 });
 clearTimeout(t);
 const latency = Date.now() - start;
 const data = await res.json().catch(() => ({}));
 setTestResult({ alive: res.ok && !!data?.reply, latency });
 } catch {
 setTestResult({ alive: false, latency: Date.now() - start });
 }
 setTesting(false);
 };

 return (
 <div>
 <div className={`${glassCard} p-4 mb-4`}>
 <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
 🤖 AI Chat Config
 </h3>
 <p className="text-[10px] text-zinc-400 mb-4">
 Turning AI Chat off hides the AI button from users. Save a URL to enable it.
 </p>

 {/* On/Off Toggle */}
 <div className="flex items-center justify-between mb-4 bg-zinc-800/40 rounded-xl p-3 border border-zinc-700/40">
 <div className="flex items-center gap-3">
 <div className={`w-3 h-3 rounded-full ${aiEnabled ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
 <span className="text-xs font-medium">{aiEnabled ? 'AI is enabled' : 'AI is disabled'}</span>
 </div>
 <button onClick={toggle}
 className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${aiEnabled ? 'bg-green-600' : 'bg-zinc-600'}`}>
 <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${aiEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
 </button>
 </div>

 {/* AI URL */}
 <div className="mb-3">
 <label className="text-[10px] text-zinc-400 block mb-1">AI Endpoint URL</label>
 <input value={aiUrlInput} onChange={(e) => setAiUrlInput(e.target.value)}
 placeholder="https://your-worker.workers.dev/ai-chat" className={inputClass} />
 </div>

 <div className="flex gap-2">
 <button onClick={save} className={`${btnPrimary} !px-4 !py-2 flex-1`}>
 <Save size={14} /> Save
 </button>
 <button onClick={testAi} disabled={testing || !aiUrlInput.trim()}
 className={`${btnPrimary} !px-4 !py-2 bg-cyan-700 hover:bg-cyan-600`}>
 {testing ? <RefreshCw size={14} className="animate-spin" /> : <Activity size={14} />} Test
 </button>
 </div>

 {testResult && (
 <div className={`mt-3 p-2.5 rounded-lg text-xs font-medium ${testResult.alive ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
 {testResult.alive ? `✅ AI is responding (${testResult.latency}ms)` : `❌ AI is not responding`}
 </div>
 )}
 </div>
 </div>
 );
};

// ==================== BRANDING CONFIG SECTION ====================
const BrandingSection = ({ glassCard, inputClass, btnPrimary }: { glassCard: string; inputClass: string; btnPrimary: string }) => {
 const [config, setConfig] = useState<Record<string, string>>({});
 const [saving, setSaving] = useState(false);

 const FIELDS = [
 { key: "siteName", label: "Site name", placeholder: "" },
 { key: "siteDescription", label: "Site description", placeholder: "Your ultimate destination..." },
 { key: "siteTagline", label: "Tagline", placeholder: "Premium Anime Streaming" },
 { key: "loginTitle", label: "Login page title", placeholder: "" },
 { key: "loginSubtitle", label: "Login subtitle", placeholder: "Premium Anime Streaming" },
 { key: "premiumTitle", label: "Premium title", placeholder: "" },
 { key: "footerText", label: "Footer text", placeholder: "Unlimited Anime Series & Movies" },
 { key: "footerCopyright", label: "Copyright text", placeholder: "" },
 { key: "splashText", label: "Splash screen text", placeholder: "" },
 { key: "adminTitle", label: "Admin panel title", placeholder: "" },
 { key: "aboutTitle", label: "About page title", placeholder: "" },
 // playerName removed — player no longer renders a header title
 { key: "rsCardLabel", label: "Card label", placeholder: "" },
 { key: "anCardLabel", label: "AnimeSalt card label", placeholder: "AN" },
 ];

 const LOGO_FIELDS: { key: string; label: string; placeholder: string; preview: "square" | "wide" }[] = [
 { key: "logoUrl", label: "Default Logo (header + splash)", placeholder: "https://... or upload", preview: "square" },
 ];

 const [uploadingKey, setUploadingKey] = useState<string | null>(null);

 useEffect(() => {
 const unsub = onValue(ref(db, "settings/branding"), (snap) => {
 setConfig(snap.val() || {});
 });
 return () => unsub();
 }, []);

 const updateField = (key: string, value: string) => {
 setConfig(prev => ({ ...prev, [key]: value }));
 };

 const handleUpload = async (key: string, file: File | null) => {
 if (!file) return;
 setUploadingKey(key);
 try {
 const { uploadToImgbb } = await import("@/lib/imgbbUpload");
 const url = await uploadToImgbb(file);
 // Update and persist immediately so the URL is saved even without clicking Save
 setConfig(prev => {
 const next = { ...prev, [key]: url };
 update(ref(db, "settings/branding"), { [key]: url }).catch(() => {});
 return next;
 });
 toast.success("✅ Uploaded & saved");
 } catch (e: any) {
 toast.error(`Upload failed: ${e?.message || e}`);
 }
 setUploadingKey(null);
 };

 const saveAll = async () => {
 setSaving(true);
 try {
 const cleaned: Record<string, string> = {};
 Object.entries(config).forEach(([k, v]) => {
 if (v && String(v).trim()) cleaned[k] = String(v).trim();
 });
 await set(ref(db, "settings/branding"), cleaned);
 toast.success("✅ Branding saved — applied everywhere.");
 } catch {
 toast.error("Save failed");
 }
 setSaving(false);
 };

 return (
 <div>
 <div className={`${glassCard} p-4 mb-4`}>
 <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
 <Edit size={14} className="text-purple-400" /> 🏷️ UI + Branding
 </h3>
 <p className="text-[10px] text-zinc-400 mb-4">
 All site names and logos are managed from here — no code edits needed.
 </p>
 </div>

 {/* Logo / Image Settings */}
 <div className={`${glassCard} p-4 mb-4`}>
 <h4 className="text-xs font-bold text-white mb-3 flex items-center gap-2">🎨 Logo & Image Settings</h4>
 <div className="space-y-4">
 {LOGO_FIELDS.map(({ key, label, placeholder, preview }) => {
 const val = config[key] || "";
 const isUploading = uploadingKey === key;
 return (
 <div key={key} className="bg-zinc-900/40 border border-zinc-700/40 rounded-xl p-3">
 <label className="text-[11px] text-zinc-300 font-medium block mb-2">{label}</label>
 <div className="flex gap-2">
 <input
 value={val}
 onChange={(e) => updateField(key, e.target.value)}
 placeholder={placeholder}
 className={`${inputClass} flex-1 min-w-0`}
 />
 <label className={`${btnPrimary} !px-3 !py-2 cursor-pointer flex items-center gap-1.5 shrink-0 ${isUploading ? 'opacity-60 pointer-events-none' : ''}`}>
 {isUploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
 <span className="text-[11px]">{isUploading ? "..." : "Upload"}</span>
 <input
 type="file"
 accept="image/*"
 className="hidden"
 onChange={(e) => handleUpload(key, e.target.files?.[0] || null)}
 />
 </label>
 </div>
 {val && (
 <div className="mt-2.5">
 <img
 src={val}
 alt="preview"
 className={preview === "wide"
 ? "w-full max-h-32 object-cover rounded-lg bg-zinc-800 border border-zinc-700/40"
 : "w-14 h-14 rounded-lg object-cover bg-zinc-800 border border-zinc-700/40"}
 onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
 />
 </div>
 )}
 </div>
 );
 })}
 </div>
 </div>


 {/* Text Fields */}
 <div className={`${glassCard} p-4 mb-4`}>
 <h4 className="text-xs font-bold text-white mb-3 flex items-center gap-2">📝 Name settings</h4>
 <div className="space-y-3">
 {FIELDS.map(({ key, label, placeholder }) => (
 <div key={key}>
 <label className="text-[10px] text-zinc-400 block mb-1">{label}</label>
 <input
 value={config[key] || ""}
 onChange={(e) => updateField(key, e.target.value)}
 placeholder={placeholder}
 className={inputClass}
 />
 </div>
 ))}
 </div>
 </div>

 {/* APK Download URLs */}
 <div className={`${glassCard} p-4 mb-4`}>
 <h4 className="text-xs font-bold text-white mb-3 flex items-center gap-2">📦 APK download links</h4>
 <p className="text-[10px] text-zinc-400 mb-3">
 The User APK link appears in the user panel. The Admin APK link appears only in this admin panel. Keep them as separate versions.
 </p>
 <div className="space-y-3">
 <div>
 <label className="text-[10px] text-zinc-400 block mb-1">User App APK URL (shown in the user panel)</label>
 <input
 value={config["userApkUrl"] || ""}
 onChange={(e) => updateField("userApkUrl", e.target.value)}
 placeholder="https://example.com/rsanime-user.apk"
 className={inputClass}
 />
 {config["userApkUrl"] && (
 <a
 href={config["userApkUrl"]}
 target="_blank"
 rel="noopener noreferrer"
 download
 className="inline-flex items-center gap-2 mt-2 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold"
 >
 <Download size={12} /> Download User APK
 </a>
 )}
 </div>
 <div>
 <label className="text-[10px] text-zinc-400 block mb-1">Admin App APK URL (shown only in the admin panel)</label>
 <input
 value={config["adminApkUrl"] || ""}
 onChange={(e) => updateField("adminApkUrl", e.target.value)}
 placeholder="https://example.com/rsanime-admin.apk"
 className={inputClass}
 />
 {config["adminApkUrl"] && (
 <a
 href={config["adminApkUrl"]}
 target="_blank"
 rel="noopener noreferrer"
 download
 className="inline-flex items-center gap-2 mt-2 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
 >
 <Download size={12} /> Download Admin APK
 </a>
 )}
 </div>
 </div>
 </div>

 {/* Auto-Fill + Save Buttons */}
 <div className="flex gap-2">
 <button
 onClick={async () => {
 try {
 const snap = await get(ref(db, "settings/branding"));
 const val = snap.val() || {};
 setConfig(val);
 toast.success("✅ Auto-fill complete. Current saved values have been loaded.");
 } catch {
 toast.error("Auto-fill failed");
 }
 }}
 className="flex-1 py-3 rounded-xl text-sm font-bold bg-gradient-to-r from-cyan-500/20 to-blue-500/20 border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/30 transition-all flex items-center justify-center gap-2"
 >
 <RefreshCw size={14} /> Auto fill
 </button>
 <button onClick={saveAll} disabled={saving} className={`${btnPrimary} flex-1 !py-3 text-sm`}>
 {saving ? <><RefreshCw size={14} className="animate-spin" /> Saving...</> : <><Save size={14} /> Save all</>}
 </button>
 </div>
 </div>
 );
};
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
 toast.success(`${preset.emoji} ${preset.name} theme activated!`);
 } catch {
 toast.error("Theme save failed");
 }
 };

 return (
 <div>
 <div className={`${glassCard} p-4 mb-4`}>
 <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
 <Zap size={14} className="text-yellow-400" /> UI Theme Presets
 </h3>
 <p className="text-[11px] text-zinc-400 mb-4">
 Choose a theme preset. The UI updates for every user instantly.
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
 toast.success(next ? "✅ Notification prompts will be shown to all users" : "⏸ Notification prompt disabled");
 };

 return (
 <div>
 <div className="flex items-center justify-between mb-3">
 <div className="flex items-center gap-2">
 <span className={`w-2.5 h-2.5 rounded-full ${enabled ? "bg-green-500 animate-pulse" : "bg-zinc-600"}`} />
 <span className="text-xs font-medium">{enabled ? "Active" : "Off"}</span>
 </div>
 <button onClick={toggle}
 className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${enabled ? "bg-red-500/20 text-red-400 hover:bg-red-500/30" : "bg-green-500/20 text-green-400 hover:bg-green-500/30"}`}>
 {enabled ? "Disable" : "Enable"}
 </button>
 </div>
 <div className="grid grid-cols-2 gap-2 mt-2">
 <div className="bg-zinc-800/50 rounded-lg p-2.5 text-center">
 <p className="text-lg font-bold text-green-400">{totalUsers}</p>
 <p className="text-[10px] text-zinc-400">Users with tokens</p>
 </div>
 <div className="bg-zinc-800/50 rounded-lg p-2.5 text-center">
 <p className="text-lg font-bold text-blue-400">{totalTokens}</p>
 <p className="text-[10px] text-zinc-400">Total FCM Tokens</p>
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
 toast.success(bgImageUrl.trim() ? "✅ Background image set!" : "Background image removed");
 } catch {
 toast.error("Save failed");
 }
 };

 const addCustomPost = async () => {
 if (!title.trim()) { toast.error("Enter a title"); return; }
 if (!imageUrl.trim()) { toast.error("Add an image URL or upload an image"); return; }
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
 toast.success(`📌 "${title}" posted to the hero slider!`);
 setTitle("");
 setDescription("");
 setImageUrl("");
 setImagePreview("");
 setTitleColor("#ffffff");
 setTitleFont("");
 } catch {
 toast.error("Post failed");
 }
 };

 const unpinContent = async (key: string) => {
 try {
 await remove(ref(db, `settings/pinnedHeroPosts/${key}`));
 toast.success("Post deleted!");
 } catch {
 toast.error("Delete failed");
 }
 };

 return (
 <div>
 {/* Custom Background Image */}
 <div className={`${glassCard} p-4 mb-4`}>
 <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
 🖼️ Custom Background Image
 </h3>
 <p className="text-[11px] text-zinc-400 mb-3">
 This image becomes the background across the whole site — behind cards, the hero slider, and the profile page.
 </p>
 <div className="flex gap-2 mb-2">
 <input
 value={bgImageUrl.startsWith("data:") ? "" : bgImageUrl}
 onChange={(e) => { setBgImageUrl(e.target.value); setBgImagePreview(e.target.value); }}
 placeholder="Background image URL..."
 className={`${inputClass} flex-1`}
 />
 <button onClick={() => bgFileRef.current?.click()} className={`${btnSecondary} !px-3 whitespace-nowrap`}>
 <Download size={14} /> Upload
 </button>
 <input ref={bgFileRef} type="file" accept="image/*" onChange={handleBgFileSelect} className="hidden" />
 </div>
 {bgImagePreview && (
 <div className="relative rounded-lg overflow-hidden mb-2">
 <CachedImg src={bgImagePreview} alt="BG Preview" className="w-full h-24 object-cover rounded-lg opacity-60" loading="lazy" decoding="async" />
 <button onClick={() => { setBgImageUrl(""); setBgImagePreview(""); }} className="absolute top-1.5 right-1.5 bg-red-500/80 rounded-full p-1">
 <X size={12} className="text-white" />
 </button>
 </div>
 )}
 <button onClick={saveBgImage} className={`${btnPrimary} w-full justify-center`}>
 <Save size={14} /> Save Background
 </button>
 </div>

 {/* Create Custom Post */}
 <div className={`${glassCard} p-4 mb-4`}>
 <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
 <Pin size={14} className="text-yellow-400" /> Create Custom Hero Post
 </h3>
 <p className="text-[11px] text-zinc-400 mb-4">
 Upload an image or paste a link, then add title, description, colors, and font.
 </p>

 {/* Image Input */}
 <div className="mb-3">
 <label className="text-[11px] text-zinc-400 mb-1.5 block">📷 Banner Image</label>
 <div className="flex gap-2 mb-2">
 <input
 value={imageUrl.startsWith("data:") ? "" : imageUrl}
 onChange={(e) => handleImageUrlChange(e.target.value)}
 placeholder="Enter image URL (https://...)"
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
 <CachedImg src={imagePreview} alt="Preview" className="w-full h-32 object-cover rounded-lg" loading="lazy" decoding="async" />
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
 <label className="text-[11px] text-zinc-400 mb-1.5 block">📝 Title</label>
 <input
 value={title}
 onChange={(e) => setTitle(e.target.value)}
 placeholder="Post title..."
 className={inputClass}
 />
 </div>

 {/* Title Color */}
 <div className="mb-3">
 <label className="text-[11px] text-zinc-400 mb-1.5 block">🎨 Title Color</label>
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
 <label className="text-[11px] text-zinc-400 mb-1.5 block">🔤 Title Font</label>
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
 <label className="text-[11px] text-zinc-400 mb-1.5 block">📄 Description</label>
 <textarea
 value={description}
 onChange={(e) => setDescription(e.target.value)}
 placeholder="Write the full description shown on the detail page"
 className={`${inputClass} !h-24 resize-none`}
 rows={4}
 />
 </div>

 <button onClick={addCustomPost} className={`${btnPrimary} w-full justify-center`}>
 <Send size={14} /> Post
 </button>
 </div>

 {/* Existing Posts */}
 <div className={`${glassCard} p-4 mb-4`}>
 <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
 <List size={14} className="text-blue-400" /> Posted Items ({pinnedPosts.length})
 </h3>
 {pinnedPosts.length === 0 ? (
 <div className="text-center py-8">
 <Pin size={24} className="mx-auto text-zinc-600 mb-2" />
 <p className="text-xs text-zinc-500">No posts yet</p>
 </div>
 ) : (
 <div className="space-y-2">
 {pinnedPosts.map((post, idx) => (
 <div key={post._key} className="flex items-start gap-3 p-2.5 rounded-lg bg-zinc-800/50 border border-zinc-700/50">
 <span className="text-xs font-bold text-yellow-500 w-5 mt-1">#{idx + 1}</span>
 <CachedImg src={post.backdrop} alt="" className="w-16 h-10 rounded object-cover shrink-0" loading="lazy" decoding="async" />
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

// ==================== RANDOM PRIZE LINK GENERATOR ====================
const RandomPrizeLinkGenerator = ({ glassCard, inputClass, btnPrimary }: { glassCard: string; inputClass: string; btnPrimary: string }) => {
 const [generating, setGenerating] = useState(false);
 const [generatedLink, setGeneratedLink] = useState<string | null>(null);

 const generatePrizeLink = async () => {
 setGenerating(true);
 setGeneratedLink(null);
 try {
 const { createRandomPrizeLink } = await import("@/lib/unlockAccess");
 const result = await createRandomPrizeLink();
 if (result.ok && result.shortUrl) {
 setGeneratedLink(result.shortUrl);
 toast.success("🎁 Prize link generated!");
 } else {
 toast.error("Failed: " + (result.error || "Unknown error"));
 }
 } catch (err: any) {
 toast.error("Error: " + err.message);
 }
 setGenerating(false);
 };

 return (
 <div className={`${glassCard} p-4 mb-4`}>
 <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
 <Star size={14} className="text-yellow-400" /> 🎁 Random Prize Link
 </h3>
 <p className="text-[11px] text-muted-foreground mb-2">
 Share this link anywhere. Each user gets a different random free-access duration (24h–48h).
 </p>
 <div className="text-[10px] text-muted-foreground mb-3 space-y-0.5">
 <p>🟢 70% chance: 24-26 hours</p>
 <p>🔵 18% chance: 27-30 hours</p>
 <p>🟣 7% chance: 31-35 hours</p>
 <p>🟡 3% chance: 36-41 hours</p>
 <p>🔴 1.5% chance: 42-47 hours</p>
 <p>🏆 0.5% chance: 48 hours (JACKPOT!)</p>
 </div>
 <div className="space-y-3">
 <button
 onClick={generatePrizeLink}
 disabled={generating}
 className={`${btnPrimary} w-full py-3.5 flex items-center justify-center gap-2 disabled:opacity-50`}
 >
 {generating ? (
 <><RefreshCw size={16} className="animate-spin" /> Generating...</>
 ) : (
 <><Star size={16} /> Generate Prize Link</>
 )}
 </button>

 {generatedLink && (
 <div className="space-y-2">
 <div className="text-center py-2 px-3 rounded-lg bg-gradient-to-r from-purple-500/20 to-pink-500/20 border border-purple-500/30">
 <span className="text-xs font-semibold">
 🎲 Each user gets a different random duration!
 </span>
 </div>
 <div className="relative">
 <input
 value={generatedLink}
 readOnly
 className={inputClass + " pr-16 text-xs font-mono"}
 onClick={(e) => (e.target as HTMLInputElement).select()}
 />
 <button
 onClick={() => {
 navigator.clipboard.writeText(generatedLink);
 toast.success("Link copied!");
 }}
 className="absolute right-1 top-1/2 -translate-y-1/2 text-[10px] bg-primary/20 hover:bg-primary/40 px-2.5 py-1.5 rounded-lg font-semibold transition-all"
 >
 Copy
 </button>
 </div>
 <p className="text-[10px] text-muted-foreground text-center">
 ♾️ This link can be used unlimited times. Generating a new one disables the previous link.
 </p>
 </div>
 )}
 </div>
 </div>
 );
};

const Admin = forwardRef<HTMLDivElement>((_, _ref) => {
 const adminBranding = useBranding();
 useEffect(() => {
 const nativeConfirm = window.confirm.bind(window);
 const nativeAlert = window.alert.bind(window);
 window.confirm = (message?: string) => nativeConfirm(translateAdminText(String(message ?? "")));
 window.alert = (message?: any) => nativeAlert(typeof message === "string" ? translateAdminText(message) : message);
 applyAdminEnglish(document.body);
 const observer = new MutationObserver((mutations) => {
 mutations.forEach((mutation) => {
 if (mutation.type === "characterData" && mutation.target.parentNode) {
 applyAdminEnglish(mutation.target.parentNode);
 }
 if (mutation.type === "attributes") {
 applyAdminEnglish(mutation.target as Element);
 }
 mutation.addedNodes.forEach((node) => {
 if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE) {
 applyAdminEnglish(node.nodeType === Node.TEXT_NODE ? node.parentNode || document.body : (node as Element));
 }
 });
 });
 });
 observer.observe(document.body, { childList: true, characterData: true, attributes: true, attributeFilter: ["placeholder", "title", "aria-label"], subtree: true });
 return () => {
 observer.disconnect();
 window.confirm = nativeConfirm;
 window.alert = nativeAlert;
 };
 }, []);
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


 // Persist admin section
 useEffect(() => {
 try { sessionStorage.setItem("rs_adminSection", activeSection); } catch {}
 }, [activeSection]);
 const [sidebarOpen, setSidebarOpen] = useState(false);
 const [dropdownOpen, setDropdownOpen] = useState(false);
 const [firebaseConnected, setFirebaseConnected] = useState(false);
 const [fetchingOverlay, setFetchingOverlay] = useState(false);

 // Data state
 const [categoriesData, setCategoriesData] = useState<Record<string, any>>({});
 const [webseriesData, setWebseriesData] = useState<any[]>([]);
 const [moviesData, setMoviesData] = useState<any[]>([]);
 const [adminFastCounts, setAdminFastCounts] = useState({ webseries: 0, movies: 0, users: 0 });
 const upsertAdminContentListItem = useCallback((kind: AdminContentKind, id: string, item: any) => {
  const listItem = buildAdminContentIndexItem(id, item, kind);
  const setter = kind === "movies" ? setMoviesData : setWebseriesData;
  setter(prev => {
   const next = mergeAdminContentLists(prev, [listItem]);
   writeCachedAdminContentList(kind, next);
   return next;
  });
 }, []);
 const removeAdminContentListItem = useCallback((kind: AdminContentKind, id: string) => {
  const setter = kind === "movies" ? setMoviesData : setWebseriesData;
  setter(prev => {
   const next = sortAdminContentList(prev.filter((item: any) => item.id !== id));
   writeCachedAdminContentList(kind, next);
   return next;
  });
 }, []);
 const getFullAdminContentItem = useCallback(async (kind: AdminContentKind, id: string) => {
  const snap = await get(ref(db, `${kind}/${id}`));
  const data = snap.val();
  if (!data) return null;
  upsertAdminContentListItem(kind, id, data);
  return { id, ...data };
 }, [upsertAdminContentListItem]);
 const [usersData, setUsersData] = useState<any[]>([]);
 const [appUsersGlobal, setAppUsersGlobal] = useState<Record<string, any>>({});
 const [userSearchQuery, setUserSearchQuery] = useState("");
 const [debouncedUserSearch, setDebouncedUserSearch] = useState("");
 useEffect(() => {
 const t = setTimeout(() => setDebouncedUserSearch(userSearchQuery), 150);
 return () => clearTimeout(t);
 }, [userSearchQuery]);
 const filteredUsersList = useMemo(() => {
 const q = debouncedUserSearch.trim().toLowerCase();
 if (!q) return usersData;
 return usersData.filter(u => {
 const name = String(u.name || "").toLowerCase();
 const email = String(u.email || "").toLowerCase();
 const id = String(u.id || "").toLowerCase();
 return name.includes(q) || email.includes(q) || id.includes(q);
 });
 }, [usersData, debouncedUserSearch]);
 const [notificationsData, setNotificationsData] = useState<any[]>([]);
 const [releasesData, setReleasesData] = useState<any[]>([]);
 const [commentsData, setCommentsData] = useState<any[]>([]);

 // Form states
 const [categoryInput, setCategoryInput] = useState("");
 const [seriesTab, setSeriesTab] = useState<"ws-list" | "ws-add" | "ws-manual" | "ws-weekly" | "ws-an">("ws-list");
 const [moviesTab, setMoviesTab] = useState<"mv-list" | "mv-add" | "mv-manual" | "mv-an">("mv-list");
 const [fetchType, setFetchType] = useState<"movie" | "tv">("movie");
 const [quickTmdbId, setQuickTmdbId] = useState("");

 // Series form
 const [seriesForm, setSeriesForm] = useState<any>(null);
 const [seriesCast, setSeriesCast] = useState<CastMember[]>([]);
 const [seasonsData, setSeasonsData] = useState<Season[]>([]);
 const [seriesSeasonsByLanguage, setSeriesSeasonsByLanguage] = useState<SeasonsByLanguage>({});
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
 const [releaseEpisodeEnd, setReleaseEpisodeEnd] = useState("");
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
 instructions: "Send Money to the number below and submit the Transaction ID.",
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
 const [prizePoolUsers, setPrizePoolUsers] = useState<any[]>([]);
 const [freeAccessBusy, setFreeAccessBusy] = useState<string | null>(null);

 // Settings state
 const [tutorialLink, setTutorialLink] = useState("");
 const [tutorialLinkInput, setTutorialLinkInput] = useState("");
 const [tutorialVideos, setTutorialVideos] = useState<{ title: string; url: string }[]>([]);
 const [newTutorialTitle, setNewTutorialTitle] = useState("");
 const [newTutorialUrl, setNewTutorialUrl] = useState("");
 const [adminUserIdInput, setAdminUserIdInput] = useState("");
 const [savedAdminUserId, setSavedAdminUserId] = useState("");
 const [adminFcmTokensInput, setAdminFcmTokensInput] = useState("");
 const [savedAdminFcmTokens, setSavedAdminFcmTokens] = useState<string[]>([]);

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
 const [allTimeTotals, setAllTimeTotals] = useState<Record<string, { count: number; title?: string; lastSeen?: number }>>({});

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
 const [tgQuality, setTgQuality] = useState("480p,720p,1080p,4K");
 const [tgNewEpAdded, setTgNewEpAdded] = useState("");
 const [tgPosterUrl, setTgPosterUrl] = useState("");
 const [tgButtonLink, setTgButtonLink] = useState("");
 const [tgButtons, setTgButtons] = useState<{ name: string; url: string }[]>([]);
 const [tgDefaultButtonName, setTgDefaultButtonName] = useState("📥 𝐖𝐀𝐓𝐂𝐇 𝐀𝐍𝐃 𝐃𝐎𝐖𝐍𝐋𝐎𝐀𝐃 📥");
 // Currently-selected anime (for per-anime button persistence)
 const [tgSelectedAnimeId, setTgSelectedAnimeId] = useState<string>("");
 // Auto-save per-anime telegram custom buttons whenever the admin edits them
 useEffect(() => {
 if (!tgSelectedAnimeId) return;
 const safeId = String(tgSelectedAnimeId).replace(/[^a-zA-Z0-9_-]/g, "_");
 const t = setTimeout(() => {
 const cleanedButtons = tgButtons
 .map(b => ({ name: String(b?.name || "").trim(), url: String(b?.url || "").trim() }))
 .filter(b => b.name && b.url);
 set(ref(db, `telegramPerAnimeButtons/${safeId}`), {
 defaultButtonName: tgDefaultButtonName || "",
 buttons: cleanedButtons,
 updatedAt: Date.now(),
 }).catch(() => {});
 }, 600);
 return () => clearTimeout(t);
 }, [tgSelectedAnimeId, tgButtons, tgDefaultButtonName]);
 const [tgSending, setTgSending] = useState(false);
 // Bulk catalog broadcaster — sends random 20 anime per post, no duplicates across sends
 const [tgBulkSending, setTgBulkSending] = useState(false);
 const [tgBulkBatchSize, setTgBulkBatchSize] = useState(20);
 const [tgBulkHeader, setTgBulkHeader] = useState("🎌 𝗥𝗦 𝗔𝗡𝗜𝗠𝗘 — 𝗙𝗥𝗘𝗦𝗛 𝗗𝗥𝗢𝗣");
 const [tgBulkFooter, setTgBulkFooter] = useState("🔗 Watch Free • Daily Updates");
 const [tgBulkSentIds, setTgBulkSentIds] = useState<Record<string, number>>({});
 const [tgBulkProgress, setTgBulkProgress] = useState<{ done: number; total: number } | null>(null);
 useEffect(() => {
 const unsub = onValue(ref(db, "telegramBulkBroadcast/sentIds"), (snap) => {
 setTgBulkSentIds(snap.val() || {});
 });
 return () => unsub();
 }, []);
 const [tgDropdownOpen, setTgDropdownOpen] = useState(false);
 const [tgContentSearch, setTgContentSearch] = useState("");
 const tgDropdownRef = useRef<HTMLDivElement>(null);
 const [tgDubType, setTgDubType] = useState<"official" | "fandub">("official");
 const [tgLanguages, setTgLanguages] = useState("Hindi");
 const [tgStatus, setTgStatus] = useState<"ongoing" | "complete">("ongoing");
 const [tgStatusAuto, setTgStatusAuto] = useState(true);
 const [tgRating, setTgRating] = useState("8.5");
 const [tgGenres, setTgGenres] = useState("Animation, Action & Adventure, Sci-Fi & Fantasy");
 const [tgImdbId, setTgImdbId] = useState("");
 const [tgImdbLoading, setTgImdbLoading] = useState(false);
 const [tgSeasonEpLabel, setTgSeasonEpLabel] = useState("#all");
 // Telegram footer links (admin-managed)
 const [tgFooterLinks, setTgFooterLinks] = useState<{ label: string; url: string; emoji: string }[]>([]);
 const [tgHashtags, setTgHashtags] = useState("#ɪᴄғᴀɴɪᴍᴇ #ᴀɴɪᴍᴇ #ᴏғғɪᴄɪᴀʟ");

 // Auto-derive Ongoing/Complete from total vs latest added episode (live)
 useEffect(() => {
 if (!tgStatusAuto) return;
 const total = parseInt(String(tgTotalEpisodes).replace(/[^\d]/g, ""), 10);
 const parts = String(tgNewEpAdded || "").split("-").map(v => parseInt(v.replace(/[^\d]/g, ""), 10));
 const latest = parts.filter(n => !isNaN(n)).pop();
 if (!isFinite(total) || total <= 0 || latest === undefined || isNaN(latest)) {
 setTgStatus("ongoing");
 return;
 }
 setTgStatus(latest >= total ? "complete" : "ongoing");
 }, [tgStatusAuto, tgTotalEpisodes, tgNewEpAdded]);

 // 🎯 Auto-derive Telegram watch button link as a DEEP LINK to the FIRST episode
 // of the newly-added range. Example: tgNewEpAdded="37-39", tgSeason="02" →
 // link points to season 2 episode 37 so users land directly on that episode in
 // the video player. For single episodes it points to that one. For movies it
 // omits season/episode params.
 useEffect(() => {
 if (!tgSelectedAnimeId) return;
 const seasonNum = parseInt(String(tgSeason).replace(/[^\d]/g, ""), 10);
 const epStartRaw = String(tgNewEpAdded || "").split("-")[0] || "";
 const epStart = parseInt(epStartRaw.replace(/[^\d]/g, ""), 10);
 const isMovie = /movie/i.test(String(tgSeason)) || /movie|full/i.test(String(tgNewEpAdded));
 if (isMovie || !isFinite(seasonNum) || !isFinite(epStart)) {
 setTgButtonLink(buildEpisodeShareUrl(tgSelectedAnimeId));
 return;
 }
 setTgButtonLink(buildEpisodeShareUrl(tgSelectedAnimeId, Math.max(0, seasonNum - 1), Math.max(0, epStart - 1)));
 }, [tgSelectedAnimeId, tgSeason, tgNewEpAdded]);

 // Load saved TG footer links from Firebase
 useEffect(() => {
 const unsub = onValue(ref(db, "admin/tgFooterLinks"), (snap) => {
 const data = snap.val();
 if (data) {
 setTgFooterLinks(Object.values(data));
 } else {
 // Default links
 setTgFooterLinks([
 { label: "Jᴏɪɴ Mᴀɪɴ Cʜᴀɴɴᴇʟ", url: "https://t.me/CARTOONFUNNY03", emoji: "🔰" },
 { label: "Jᴏɪɴ Cʜᴀᴛ Gʀᴏᴜᴘ", url: "https://t.me/HINDIANIME03", emoji: "🔰" },
 { label: "Sᴜᴘᴘᴏʀᴛ & Cᴏɴᴛᴀᴄᴛ", url: "https://t.me/ADMIN", emoji: "🔰" },
 ]);
 }
 });
 const unsub2 = onValue(ref(db, "admin/tgHashtags"), (snap) => {
 if (snap.val()) setTgHashtags(snap.val());
 });
 return () => { unsub(); unsub2(); };
 }, []);

 // Resolve anime-accurate genres + rating using TMDB ID/IMDB ID, with AniList fallback for anime-specific genres
 const resolveTelegramGenresAndRating = async (tmdbIdOrImdb: string, fallbackTitle?: string) => {
 if (!tmdbIdOrImdb.trim()) return { genres: [] as string[], rating: "" };

 let tmdbData: any = null;
 const idTrimmed = tmdbIdOrImdb.trim();
 if (idTrimmed.startsWith("tt")) {
 const findRes = await fetch(`${TMDB_BASE_URL}/find/${idTrimmed}?api_key=${TMDB_API_KEY}&external_source=imdb_id`);
 const findData = await findRes.json();
 const tvResult = findData.tv_results?.[0];
 const movieResult = findData.movie_results?.[0];
 if (tvResult?.id) {
 const detailRes = await fetch(`${TMDB_BASE_URL}/tv/${tvResult.id}?api_key=${TMDB_API_KEY}&language=en-US`);
 if (detailRes.ok) tmdbData = await detailRes.json();
 } else if (movieResult?.id) {
 const detailRes = await fetch(`${TMDB_BASE_URL}/movie/${movieResult.id}?api_key=${TMDB_API_KEY}&language=en-US`);
 if (detailRes.ok) tmdbData = await detailRes.json();
 }
 } else {
 const tvRes = await fetch(`${TMDB_BASE_URL}/tv/${idTrimmed}?api_key=${TMDB_API_KEY}&language=en-US`);
 if (tvRes.ok) {
 tmdbData = await tvRes.json();
 } else {
 const movieRes = await fetch(`${TMDB_BASE_URL}/movie/${idTrimmed}?api_key=${TMDB_API_KEY}&language=en-US`);
 if (movieRes.ok) tmdbData = await movieRes.json();
 }
 }

 const tmdbGenres = Array.isArray(tmdbData?.genres)
 ? tmdbData.genres.map((g: any) => String(g?.name || "").trim()).filter(Boolean)
 : [];
 const genericGenreSet = new Set(["Animation", "Action & Adventure", "Sci-Fi & Fantasy", "Comedy", "Drama", "Mystery", "Family"]);
 const isTooGenericTmdb = tmdbGenres.length > 0 && tmdbGenres.every((name: string) => genericGenreSet.has(name));
 const animeTitle = (fallbackTitle || tmdbData?.name || tmdbData?.title || tmdbData?.original_name || tmdbData?.original_title || "").trim();

 let animeGenres: string[] = [];
 let aniListRating = "";

 if (animeTitle) {
 try {
 const aniRes = await fetch("https://graphql.anilist.co", {
 method: "POST",
 headers: { "Content-Type": "application/json", Accept: "application/json" },
 body: JSON.stringify({
 query: `query ($search: String) { Media(search: $search, type: ANIME) { genres averageScore title { romaji english native } } }`,
 variables: { search: animeTitle },
 }),
 });
 const aniData = await aniRes.json();
 const media = aniData?.data?.Media;
 if (Array.isArray(media?.genres) && media.genres.length > 0) {
 animeGenres = media.genres.map((g: any) => String(g || "").trim()).filter(Boolean);
 }
 if (media?.averageScore) {
 aniListRating = (Number(media.averageScore) / 10).toFixed(1);
 }
 } catch {}
 }

 const finalGenres = animeGenres.length > 0
 ? animeGenres
 : (tmdbGenres.length > 0 && !isTooGenericTmdb ? tmdbGenres : tmdbGenres);

 return {
 genres: [...new Set(finalGenres)],
 rating: tmdbData?.vote_average ? Number(tmdbData.vote_average).toFixed(1) : aniListRating,
 };
 };

 // Fetch anime-accurate genres + rating using TMDB ID/IMDB ID, with AniList fallback for anime-specific genres
 const fetchTmdbGenres = async (tmdbIdOrImdb: string, fallbackTitle?: string) => {
 if (!tmdbIdOrImdb.trim()) return;
 setTgImdbLoading(true);
 try {
 const { genres, rating } = await resolveTelegramGenresAndRating(tmdbIdOrImdb, fallbackTitle);

 if (genres.length > 0) {
 setTgGenres(genres.join(", "));
 }
 if (rating) {
 setTgRating(rating);
 }

 if (genres.length > 0 || rating) {
 toast.success("✅ Anime-specific genres and rating loaded");
 } else {
 toast.error("No genre data found for this ID");
 }
 } catch {
 toast.error("Genre fetch failed");
 } finally {
 setTgImdbLoading(false);
 }
 };

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
 const [wsNotifyEpisodeEnd, setWsNotifyEpisodeEnd] = useState("");
 // Captured context for Save+Notify (saveSeries resets form, so we save context before)
 const wsNotifyContextRef = useRef<{ seriesId: string; form: any; seasons: any[] } | null>(null);
 // Baseline of episodes when series was loaded for edit. Used to auto-detect new episodes for Save+Notify.
 // Shape: { [seasonIdx: number]: Set<episodeNumber> }
 const wsBaselineRef = useRef<Record<number, Set<number>>>({});
 // Auto-detected ranges shown in modal (read-only hint). Filled when Save+Notify is clicked.
 const [wsAutoRanges, setWsAutoRanges] = useState<Array<{ seasonIdx: number; seasonName: string; startEp: number; endEp: number }>>([]);

 const formatEpisodeRangeLabel = useCallback((seasonValue?: string | number, start?: string | number, end?: string | number) => {
 const seasonText = String(seasonValue ?? "").trim() || "01";
 const startText = String(start ?? "").trim() || "01";
 const endText = String(end ?? "").trim();
 return endText && endText !== startText
 ? `Sᴇᴀsᴏɴ #${seasonText} • Eᴘɪsᴏᴅᴇ #${startText}-${endText} Aᴅᴅᴇᴅ`
 : `Sᴇᴀsᴏɴ #${seasonText} • Eᴘɪsᴏᴅᴇ #${startText} Aᴅᴅᴇᴅ`;
 }, []);


 useEffect(() => {
 const connRef = ref(db, ".info/connected");
 const unsub = onValue(connRef, (snap) => {
 setFirebaseConnected(snap.val() === true);
 });
 return () => unsub();
 }, []);

 // PIN is verified server-side via the verify-admin-pin edge function
 // (PIN is stored only as the ADMIN_PIN Lovable Cloud secret, never in
 // Firebase RTDB which is world-readable to authenticated users).
 useEffect(() => {
 setPinExists(true);
 setCurrentPin("");
 }, []);

 // Auto-verify stored admin session timestamp (PIN re-verification happens
 // on each login submit — the session cookie just tracks expiry).
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
 sessionStorage.removeItem("rs_admin_pin");
 return;
 }
 }
 } catch {
 setIsAuthenticated(false);
 localStorage.removeItem("rs_admin_session");
 }
 }
 }, [isAuthenticated]);

 // Load saved Telegram channel
 useEffect(() => {
 const unsub = onValue(ref(db, "admin/telegramChannel"), (snap) => {
 if (snap.val()) setTgChannelId(snap.val());
 });
 return () => unsub();
 }, []);

 // Load CORE data. Heavy content collections are loaded from a tiny admin index
 // + a small recent window, never full onValue subscriptions. This stops Admin
 // from downloading every season/episode/audio URL on every open.
 useEffect(() => {
 const unsubs: (() => void)[] = [];

 unsubs.push(onValue(ref(db, "categories"), (snap) => {
 setCategoriesData(snap.val() || {});
 }));

 const loadContentList = async (kind: AdminContentKind) => {
  const setter = kind === "movies" ? setMoviesData : setWebseriesData;
  const cached = readCachedAdminContentList(kind);
  if (cached.length) setter(sortAdminContentList(cached));
  try {
   const [indexed, recent] = await Promise.all([
    fetchAdminContentIndex(kind).catch(() => []),
    fetchRecentAdminContentList(kind).catch(() => []),
   ]);
   const merged = mergeAdminContentLists(cached, indexed, recent);
   setter(merged);
   writeCachedAdminContentList(kind, merged);
   if (!indexed.length && recent.length) primeAdminContentIndexFromList(kind, recent).catch(() => {});
  } catch (err) {
   console.warn(`[Admin] ${kind} light index load failed`, err);
  }
 };

 loadContentList("webseries");
 loadContentList("movies");

  let countsCancelled = false;
  Promise.all([
   fetchAdminCount("webseries").catch(() => webseriesData.length),
   fetchAdminCount("movies").catch(() => moviesData.length),
   fetchAdminCount("users").catch(() => usersData.length),
  ]).then(([webseries, movies, users]) => {
   if (!countsCancelled) setAdminFastCounts({ webseries, movies, users });
  });

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

 unsubs.push(onValue(ref(db, "settings/tutorialVideos"), (snap) => {
 const val = snap.val();
 if (val && typeof val === "object") {
 const list = Object.entries(val).map(([k, v]: any) => ({ id: k, title: v.title || "", url: v.url || "" }));
 setTutorialVideos(list);
 } else {
 setTutorialVideos([]);
 }
 }));

 unsubs.push(onValue(ref(db, "admin"), (snap) => {
 const val = snap.val() || {};
 const targetConfig = typeof val === "object" ? val?.notificationTargets || {} : {};
 const userIds = [...new Set([
 typeof val === "string" ? val : "",
 typeof val === "object" ? val?.userId || "" : "",
 ...(Array.isArray(targetConfig?.userIds) ? targetConfig.userIds : []),
 ].map((item) => String(item || "").trim()).filter((item): item is string => Boolean(item)))] as string[];
 const tokens = [...new Set((Array.isArray(targetConfig?.tokens) ? targetConfig.tokens : [])
 .map((item: any) => String(item || "").trim())
 .filter((item): item is string => Boolean(item)))] as string[];
 setSavedAdminUserId(userIds.join("\n"));
 setAdminUserIdInput(userIds.join("\n"));
 setSavedAdminFcmTokens(tokens);
 setAdminFcmTokensInput(tokens.join("\n"));
 }));

  return () => { countsCancelled = true; unsubs.forEach(u => u()); };
 }, []);

 // Lazy-load USERS data (only when dashboard, users, notifications, or free-access section)
 useEffect(() => {
  const needsUsers = ["users", "free-access", "device-limits"].includes(activeSection);
 if (!needsUsers) return;

 const unsubs: (() => void)[] = [];

 unsubs.push(onValue(ref(db, "users"), (snap) => {
 const data = snap.val() || {};
 setUsersData(Object.entries(data).map(([id, user]: any) => ({ id, ...user })));
 }));

 unsubs.push(onValue(ref(db, "appUsers"), (snap) => {
 setAppUsersGlobal(snap.val() || {});
 }));

 // FCM token stats listener removed

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
 if (activeSection !== "new-releases" && activeSection !== "telegram-post") return;
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
 if (activeSection !== "new-releases" && activeSection !== "notifications") return;
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

 // Lazy-load FREE ACCESS USERS data — merges freeAccessUsers + users/*/freeAccess (Mini App)
 useEffect(() => {
 if (activeSection !== "free-access") return;

 // Instant render from cache
 try {
 const cached = sessionStorage.getItem("admin_freeAccessUsers_cache");
 if (cached) setFreeAccessUsers(JSON.parse(cached));
 } catch {}

 let faData: Record<string, any> = {};
 let usersData: Record<string, any> = {};
 let usersLoaded = false;
 let faLoaded = false;

 const merge = () => {
 if (!usersLoaded || !faLoaded) return;
 const now = Date.now();
 const map: Record<string, any> = {};

 // 1) Direct freeAccessUsers entries (browser unlock + mini-app mirror)
 Object.entries(faData || {}).forEach(([id, user]: [string, any]) => {
 if (!user) return;
 if (user.expiresAt > now) {
 map[id] = { id, ...user };
 } else {
 remove(ref(db, `freeAccessUsers/${id}`)).catch(() => {});
 }
 });

 // 2) Backfill from users/*/freeAccess (covers older Mini App users)
 Object.entries(usersData || {}).forEach(([uid, u]: [string, any]) => {
 const fa = u?.freeAccess;
 if (!fa || !fa.active || !fa.expiresAt || fa.expiresAt <= now) return;
 if (map[uid]) {
 if (fa.suspiciousBypass === true) {
 map[uid] = {
 ...map[uid],
 suspiciousBypass: true,
 suspiciousBypassAt: fa.suspiciousBypassAt || 0,
 };
 }
 return;
 }
 const isMini = fa.viaToken === "mini-app" || fa.viaToken === "mini-app-fallback" || (typeof fa.source === "string" && fa.source.includes("telegram"));
 map[uid] = {
 id: uid,
 userId: uid,
 name: u.name || u.username || (isMini ? `Telegram ${uid}` : "Unknown"),
 email: u.email || "",
 unlockedAt: fa.grantedAt || now,
 expiresAt: fa.expiresAt,
 prizeHours: Math.max(0, Math.floor((fa.expiresAt - (fa.grantedAt || now)) / 3600000)),
 prizeMinutes: 0,
 mode: isMini ? "miniapp" : "normal",
 source: fa.source || fa.viaToken || "",
 suspiciousBypass: fa.suspiciousBypass === true,
 suspiciousBypassAt: fa.suspiciousBypassAt || 0,
 };
 });

 const list = Object.values(map).sort((a: any, b: any) => b.unlockedAt - a.unlockedAt);
 setFreeAccessUsers(list);
 try { sessionStorage.setItem("admin_freeAccessUsers_cache", JSON.stringify(list)); } catch {}
 };

 const unsub1 = onValue(ref(db, "freeAccessUsers"), (snap) => {
 faData = snap.val() || {};
 faLoaded = true;
 merge();
 });
 const unsub2 = onValue(ref(db, "users"), (snap) => {
 usersData = snap.val() || {};
 usersLoaded = true;
 merge();
 });

 return () => { unsub1(); unsub2(); };
 }, [activeSection]);

 const clearAllFreeAccess = async () => {
 if (!confirm("Cancel all active free access?")) return;
 setFreeAccessBusy("all");
 try {
 const usersSnap = await get(ref(db, "users"));
 const usersVal = usersSnap.val() || {};
 await Promise.all([
 set(ref(db, "freeAccessUsers"), null),
 ...Object.keys(usersVal).map((uid) => set(ref(db, `users/${uid}/freeAccess`), null).catch(() => {})),
 ]);
 toast.success("All free access has been canceled");
 } catch (e: any) {
 toast.error(e?.message || "Clear all failed");
 } finally {
 setFreeAccessBusy(null);
 }
 };

 const clearSingleFreeAccess = async (user: any) => {
 const uid = String(user?.userId || user?.id || "").trim();
 if (!uid) return;
 if (!confirm(`${user?.name || uid} free access should be canceled?`)) return;
 setFreeAccessBusy(uid);
 try {
 await Promise.all([
 remove(ref(db, `freeAccessUsers/${uid}`)).catch(() => {}),
 set(ref(db, `users/${uid}/freeAccess`), null),
 ]);
 toast.success("Selected user's free access has been canceled");
 } catch (e: any) {
 toast.error(e?.message || "Remove failed");
 } finally {
 setFreeAccessBusy(null);
 }
 };

 // Lazy-load PRIZE POOL data
 useEffect(() => {
 if (activeSection !== "free-access") return;
 const unsub = onValue(ref(db, "prizePool"), (snap) => {
 const data = snap.val() || {};
 const list: any[] = [];
 Object.entries(data).forEach(([id, item]: [string, any]) => {
 list.push({ id, ...item });
 });
 list.sort((a, b) => (b.claimedAt || 0) - (a.claimedAt || 0));
 setPrizePoolUsers(list);
 });
 return () => unsub();
 }, [activeSection]);

 // Lazy-load bKash settings & payment requests + SMS feed + global auto-matcher
 const [bkashSmsFeed, setBkashSmsFeed] = useState<any[]>([]);
 useEffect(() => {
 if (activeSection !== "bkash-payments" && activeSection !== "dashboard") return;

 // Instant render from sessionStorage cache (avoids 'loading forever' feel)
 try {
 const cs = sessionStorage.getItem("admin_bkashSettings_cache");
 if (cs) { setBkashSettings(JSON.parse(cs)); setBkashSettingsLoaded(true); }
 const cp = sessionStorage.getItem("admin_bkashPayments_cache");
 if (cp) setBkashPaymentRequests(JSON.parse(cp));
 const cf = sessionStorage.getItem("admin_bkashSmsFeed_cache");
 if (cf) setBkashSmsFeed(JSON.parse(cf));
 } catch {}

 const unsubs: (() => void)[] = [];
 unsubs.push(onValue(ref(db, "bkashSettings"), (snap) => {
 const data = snap.val();
 if (data) {
 setBkashSettings(data);
 try { sessionStorage.setItem("admin_bkashSettings_cache", JSON.stringify(data)); } catch {}
 }
 setBkashSettingsLoaded(true);
 }));
 unsubs.push(onValue(ref(db, "bkashPayments"), (snap) => {
 const data = snap.val() || {};
 const list = Object.entries(data).map(([id, item]: any) => ({ id, ...item })).sort((a: any, b: any) => (b.submittedAt || 0) - (a.submittedAt || 0));
 setBkashPaymentRequests(list);
 try { sessionStorage.setItem("admin_bkashPayments_cache", JSON.stringify(list.slice(0, 200))); } catch {}
 }));
 unsubs.push(onValue(ref(db, "XNXANIKPAY"), (snap) => {
 const data = snap.val() || {};
 const list = Object.entries(data).map(([txid, item]: any) => ({ txid, ...item }))
 .sort((a: any, b: any) => (b.receivedAt || b.consumedAt || 0) - (a.receivedAt || a.consumedAt || 0));
 setBkashSmsFeed(list);
 try { sessionStorage.setItem("admin_bkashSmsFeed_cache", JSON.stringify(list.slice(0, 100))); } catch {}
 }));
 // 🔁 Start GLOBAL auto-matcher while admin panel is open on bkash section
 let stopMatcher: (() => void) | null = null;
 if (activeSection === "bkash-payments") {
 import("@/lib/bkashAutoMatcher").then(({ startGlobalAutoMatcher }) => {
 stopMatcher = startGlobalAutoMatcher();
 }).catch(() => {});
 }
 return () => {
 unsubs.forEach(u => u());
 if (stopMatcher) stopMatcher();
 };
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

 // Lazy-load ANALYTICS data — fast subscription, deferred one-shot cleanup.
 useEffect(() => {
 if (activeSection !== "analytics") return;
 const unsubs: (() => void)[] = [];
 const today = new Date().toISOString().split("T")[0];

 // Throttle setState so a rapid burst of Firebase updates doesn't trash React.
 let viewsRaf: number | null = null;
 let viewsPending: any = null;
 const flushViews = () => {
 viewsRaf = null;
 if (viewsPending) {
 setAnalyticsViews(viewsPending);
 viewsPending = null;
 }
 };
 unsubs.push(onValue(ref(db, "analytics/views"), (snap) => {
 viewsPending = snap.val() || {};
 if (viewsRaf == null) viewsRaf = requestAnimationFrame(flushViews);
 }));
 unsubs.push(onValue(ref(db, "analytics/activeViewers"), (snap) => {
 setActiveViewers(snap.val() || {});
 }));
 unsubs.push(onValue(ref(db, "analytics/dailyActive"), (snap) => {
 setDailyActiveUsers(snap.val() || {});
 }));
 unsubs.push(onValue(ref(db, "analytics/totals/views"), (snap) => {
 setAllTimeTotals(snap.val() || {});
 }));

 // Defer cleanup completely off the render path — runs once when browser is idle.
 const idle: any = (window as any).requestIdleCallback || ((fn: any) => setTimeout(fn, 2000));
 const idleCancel: any = (window as any).cancelIdleCallback || clearTimeout;
 const idleId = idle(async () => {
 try {
 const [vSnap, daSnap] = await Promise.all([
 get(ref(db, "analytics/views")),
 get(ref(db, "analytics/dailyActive")),
 ]);
 const v = vSnap.val() || {};
 const d = daSnap.val() || {};
 // Chunk deletes so we never block the main thread.
 const ops: Array<() => Promise<any>> = [];
 Object.entries(v).forEach(([animeId, byDate]: any) => {
 if (!byDate || typeof byDate !== "object") return;
 Object.keys(byDate).forEach((dk) => {
 if (dk !== today) ops.push(() => remove(ref(db, `analytics/views/${animeId}/${dk}`)));
 });
 });
 Object.keys(d).forEach((dk) => {
 if (dk !== today) ops.push(() => remove(ref(db, `analytics/dailyActive/${dk}`)));
 });
 // Fire in small batches so the UI stays smooth.
 for (let i = 0; i < ops.length; i += 20) {
 await Promise.all(ops.slice(i, i + 20).map(fn => fn().catch(() => {})));
 await new Promise(r => setTimeout(r, 0));
 }
 } catch {}
 }, { timeout: 5000 });

 return () => {
 unsubs.forEach(u => u());
 if (viewsRaf != null) cancelAnimationFrame(viewsRaf);
 try { idleCancel(idleId); } catch {}
 };
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
 if (activeSection === "webseries" && (seriesTab === "ws-add" || seriesTab === "ws-manual")) {
 setSeriesTab("ws-list");
 setSeriesEditId("");
 setTimeout(() => window.scrollTo({ top: savedScrollPos.current, behavior: "instant" as ScrollBehavior }), 50);
 return true;
 }
 if (activeSection === "movies" && (moviesTab === "mv-add" || moviesTab === "mv-manual")) {
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
 "weekly-episode": "Weekly Episode",
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
 "branding": "UI+AD Branding",
 "ai-config": "AI Chat Config",
 "live-tv": "Live TV Channels",
 "url-changer": "URL Changer",
 "link-checker": "Link Checker",
 "tg-url-changer": "TG URL Changer",
 "video-servers": "Video Servers",
 "unlock-duration": "Unlock Duration",
 "email-service": "Email Service",
 
 "apk-dw": "APK Download Center",
 "egd-manager": "EGD MANAGER",
 "fb-cleanup": "Firebase Add",
  "adsterra": "Adsterra Ads",
  "backdrop-ai": "Backdrop AI Replacer",
  "security-center": "Security & Access",
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
 toast.warning(`"${existing.title}" already exists!`, { duration: 5000 });
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

 const nextSeriesForm = {
 tmdbId: data.id, title: data.name || "", logo: logoUrl, poster: data.poster_path ? TMDB_IMG_BASE + "original" + data.poster_path : "",
 backdrop: data.backdrop_path ? TMDB_IMG_BASE + "original" + data.backdrop_path : "", trailer: trailerUrl,
 year: data.first_air_date?.split("-")[0] || "", rating: data.vote_average?.toFixed(1) || "",
 language: "Hindi", baseLanguage: "Hindi", selectedAdminLanguage: "Hindi", availableLanguages: ["Hindi"], category: autoCategory, dubType: "official", storyline: data.overview || "", visibility: "public", weeklyEnabled: false, weeklyEveryDays: 7, audioTracks: []
 };
 if (autoCategory) toast.info(`auto Category: ${autoCategory}`);
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
 const epCount = episodes.length > 0 ? Math.max(season.episode_count, episodes.length) : season.episode_count;
 newSeasons.push({
 name: season.name, seasonNumber: season.season_number,
 episodes: Array(epCount).fill(null).map((_, i) => ({
 episodeNumber: i + 1,
 title: episodes[i]?.name || `Episode ${i + 1}`,
 link: "",
 audioTracks: []
 }))
 });
 } catch {
 newSeasons.push({
 name: season.name, seasonNumber: season.season_number,
 episodes: Array(season.episode_count).fill(null).map((_, i) => ({
 episodeNumber: i + 1, title: `Episode ${i + 1}`, link: "", audioTracks: []
 }))
 });
 }
 }
 }
 const nextMap = { Hindi: cloneSeasonList(newSeasons) };
 setSeriesForm(syncSeriesLanguageSummary(nextSeriesForm, nextMap));
 setSeriesSeasonsByLanguage(nextMap);
 setSeasonsData(cloneSeasonList(newSeasons));
 toast.success("Series details fetched! (episode names loaded from TMDB)");
 } catch (err: any) { toast.error("Error: " + err.message); }
 finally { setFetchingOverlay(false); }
 };

 // Ref to store last saved series ID (for Save+Notify on new series)
 const lastSavedSeriesIdRef = useRef<string>("");

 const saveSeries = () => {
 if (!seriesForm) return;
 if (!seriesForm.title) { toast.error("Please enter title"); return; }
 if (!seriesForm.category) { toast.error("Please select category"); return; }

 const nextMap = sanitizeSeasonLanguageMap({
 ...seriesSeasonsByLanguage,
 [normalizeLanguageValue(seriesForm?.selectedAdminLanguage || seriesForm?.baseLanguage || seriesForm?.language || "Hindi") || "Hindi"]: cloneSeasonList(seasonsData),
 });
 const syncedForm = syncSeriesLanguageSummary(seriesForm, nextMap);
 setSeriesForm(syncedForm);
 const data: any = {
 ...syncedForm,
 cast: seriesCast,
 audioTracks: Array.isArray(syncedForm.audioTracks)
 ? syncedForm.audioTracks.filter((track: any) => String(track?.label || track?.language || track?.link || "").trim())
 : [],
 seasons: cloneSeasonList(nextMap[syncedForm.baseLanguage || "Hindi"] || []),
 seasonsByLanguage: nextMap,
 type: "webseries",
 weeklyEnabled: seriesForm.weeklyEnabled === true,
 weeklyEveryDays: Math.max(1, Number(seriesForm.weeklyEveryDays) || 7),
 visibility: seriesForm.visibility === "private" ? "private" : "public",
 // Per-series Telegram custom button (auto-attached by telegram-post edge function)
 telegramCustomButton: (seriesForm.telegramCustomButtonText && seriesForm.telegramCustomButtonUrl)
 ? { text: String(seriesForm.telegramCustomButtonText).trim(), url: String(seriesForm.telegramCustomButtonUrl).trim() }
 : null,
 updatedAt: Date.now(),
 };
 const isAnSeriesSave = !!(syncedForm?.anSlug || syncedForm?.animeSaltSlug || /animesalt/i.test(String(syncedForm?.sourceName || "")));
 if (isAnSeriesSave) {
 const normalizedSeasons = cloneSeasonList(seasonsData);
 const anLanguages = new Set<string>();
 normalizedSeasons.forEach((season: any) => {
 (Array.isArray(season?.episodes) ? season.episodes : []).forEach((ep: any) => {
 ep.audioTracks = normalizeAudioTrackList(ep.audioTracks);
 const defaultTrack = ep.audioTracks.find((track: any) => track?.isDefault) || ep.audioTracks[0] || null;
 ep.defaultAudio = defaultTrack ? { ...defaultTrack, isDefault: true } : null;
 if (ep.defaultAudio) ep.audioTracks = ep.audioTracks.map((track: any) => ({ ...track, isDefault: track === defaultTrack }));
 ep.qualityLinks = {
 default: ep.link || ep.link1080 || ep.link720 || ep.link480 || "",
 p480: ep.link480 || "",
 p720: ep.link720 || "",
 p1080: ep.link1080 || ep.link || "",
 p4k: ep.link4k || "",
 };
 ep.audioTracks.forEach((track: any) => {
 const label = normalizeLanguageValue(track?.label || track?.language);
 if (label) anLanguages.add(label);
 });
 });
 });
 const orderedAnLanguages = Array.from(anLanguages);
 const anBaseLanguage = orderedAnLanguages[0] || syncedForm.baseLanguage || "Multi";
 data.seasons = normalizedSeasons;
 data.seasonsByLanguage = { [anBaseLanguage]: normalizedSeasons };
 data.baseLanguage = anBaseLanguage;
 data.selectedAdminLanguage = anBaseLanguage;
 data.availableLanguages = orderedAnLanguages.length ? orderedAnLanguages : [anBaseLanguage];
 data.language = orderedAnLanguages.length > 2 ? "Multiple" : orderedAnLanguages.length === 2 ? "Dual" : anBaseLanguage;
 data.audioTracks = orderedAnLanguages.map((lang) => ({ language: lang, label: lang, link: "" }));
 data.source = "animesalt";
 data.sourceName = "AnimeSalt";
 }
 setSeriesSeasonsByLanguage(isAnSeriesSave ? data.seasonsByLanguage : nextMap);
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
 .then(async () => {
  upsertAdminContentListItem("webseries", newId, data);
  await upsertAdminContentIndex("webseries", newId, data).catch(() => {});
 toast.success(seriesEditId ? "Series updated!" : "Series saved!");
 // Weekly EP feature removed — no sync needed
 setSeriesForm(null); setSeasonsData([]); setSeriesCast([]); setSeriesEditId(""); setSeriesTab("ws-list");
 })
 .catch(err => toast.error("Error: " + err.message));
 };

 const editSeries = async (id: string) => {
 savedScrollPos.current = window.scrollY;
 const item = await getFullAdminContentItem("webseries", id);
 const data = item ? { ...item } : null;
 if (!data) return;
 const loadedMap = sanitizeSeasonLanguageMap(data.seasonsByLanguage && typeof data.seasonsByLanguage === "object"
 ? data.seasonsByLanguage
 : { [data.baseLanguage || data.language || "Hindi"]: data.seasons || [] });
 const initialLanguage = normalizeLanguageValue(data.selectedAdminLanguage || data.baseLanguage || data.language || "Hindi") || "Hindi";
 const loadedSeasons = cloneSeasonList(loadedMap[initialLanguage] || loadedMap[data.baseLanguage || data.language || "Hindi"] || []);
 setSeriesForm(syncSeriesLanguageSummary({
 tmdbId: data.tmdbId || "", title: data.title || "", logo: data.logo || "", poster: data.poster || "",
 backdrop: data.backdrop || "", trailer: data.trailer || "", year: data.year || "", rating: data.rating || "",
  anSlug: data.anSlug || "", animeSaltSlug: data.animeSaltSlug || "", source: data.source || "", sourceName: data.sourceName || "", displayAs: data.displayAs || "",
 language: data.language || "Hindi", baseLanguage: data.baseLanguage || data.language || "Hindi", selectedAdminLanguage: data.selectedAdminLanguage || data.baseLanguage || data.language || "Hindi", availableLanguages: Array.isArray(data.availableLanguages) ? data.availableLanguages : [], category: data.category || "", dubType: data.dubType || "official", storyline: data.storyline || "", visibility: data.visibility || "public",
 weeklyEnabled: data.weeklyEnabled === true, weeklyEveryDays: Math.max(1, Number(data.weeklyEveryDays) || 7), weeklyDaysSinceLast: 0,
 telegramCustomButtonText: data.telegramCustomButton?.text || "",
 telegramCustomButtonUrl: data.telegramCustomButton?.url || "",
 audioTracks: Array.isArray(data.audioTracks) ? data.audioTracks : data.audioTracks ? Object.values(data.audioTracks) : [],
 }, loadedMap));
 setSeriesCast(data.cast || []);
 setSeriesSeasonsByLanguage(loadedMap);
 setSeasonsData(loadedSeasons);
 // Auto-expand only the LATEST (running) season; collapse earlier finished seasons
 {
 const latestIdx = Math.max(0, loadedSeasons.length - 1);
 const expandMap: Record<number, boolean> = {};
 if (loadedSeasons.length > 0) expandMap[latestIdx] = true;
 setExpandedSeasons(expandMap);
 }
 // Snapshot baseline episodes per season for auto-detect on Save+Notify
 {
 const base: Record<number, Set<number>> = {};
 (data.seasons || []).forEach((s: any, i: number) => {
 base[i] = new Set((s.episodes || []).map((e: any) => Number(e.episodeNumber || 0)).filter((n: number) => n > 0));
 });
 wsBaselineRef.current = base;
 }
 setSeriesEditId(id);
 setActiveSection("webseries");
 setSeriesTab("ws-add");
 toast.info("Editing: " + data.title);
 // Auto-scroll to Seasons & Episodes section for quick episode editing
 setTimeout(() => {
 document.getElementById("seasons-episodes-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
 }, 250);
 };

 const deleteSeries = (id: string) => {
 if (confirm("Delete this series?")) {
 remove(ref(db, `webseries/${id}`)).then(async () => {
 removeAdminContentListItem("webseries", id);
 await removeAdminContentIndex("webseries", id).catch(() => {});
 toast.success("Deleted!");
 }).catch(err => toast.error("Error: " + err.message));
 }
 };

 const updateSeriesVisibility = async (id: string, visibility: "public" | "private") => {
 try {
 await update(ref(db, `webseries/${id}`), { visibility, updatedAt: Date.now() });
 toast.success(visibility === "private" ? "Series moved to Private" : "Series moved to Public");
 } catch (err: any) {
 toast.error("Error: " + err.message);
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
 toast.warning(`"${existing.title}" already exists!`, { duration: 5000 });
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
 language: "Hindi", category: autoCategory, dubType: "official", storyline: data.overview || "", movieLink: "", downloadLink: "", visibility: "public", audioTracks: []
 });
 if (autoCategory) toast.info(`auto Category: ${autoCategory}`);
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

 const data = {
 ...movieForm,
 cast: movieCast,
 audioTracks: Array.isArray(movieForm.audioTracks)
 ? movieForm.audioTracks.filter((track: any) => String(track?.label || track?.language || track?.link || "").trim())
 : [],
 type: "movie",
 visibility: movieForm.visibility === "private" ? "private" : "public",
 telegramCustomButton: (movieForm.telegramCustomButtonText && movieForm.telegramCustomButtonUrl)
 ? { text: String(movieForm.telegramCustomButtonText).trim(), url: String(movieForm.telegramCustomButtonUrl).trim() }
 : null,
 updatedAt: Date.now(),
 };
 let saveRef;
 let newMovieId = movieEditId || "";
 if (movieEditId) {
 saveRef = ref(db, `movies/${movieEditId}`);
 } else {
 saveRef = push(ref(db, "movies"));
  newMovieId = saveRef.key || "";
 data.createdAt = Date.now();
 }
 set(saveRef, data)
 .then(async () => {
  upsertAdminContentListItem("movies", newMovieId, data);
  await upsertAdminContentIndex("movies", newMovieId, data).catch(() => {});
 toast.success(movieEditId ? "Movie updated!" : "Movie saved!");
 setMovieForm(null); setMovieCast([]); setMovieEditId(""); setMoviesTab("mv-list");
 })
 .catch(err => toast.error("Error: " + err.message));
 };

 const editMovie = async (id: string) => {
 savedScrollPos.current = window.scrollY;
 const item = await getFullAdminContentItem("movies", id);
 const data = item ? { ...item } : null;
 if (!data) return;
 setMovieForm({
 tmdbId: data.tmdbId || "", title: data.title || "", logo: data.logo || "", poster: data.poster || "",
 backdrop: data.backdrop || "", trailer: data.trailer || "", year: data.year || "", rating: data.rating || "",
 language: data.language || "Hindi", category: data.category || "", dubType: data.dubType || "official", storyline: data.storyline || "",
 movieLink: data.movieLink || "", downloadLink: data.downloadLink || "",
 movieLink480: data.movieLink480 || "", movieLink720: data.movieLink720 || "",
 movieLink1080: data.movieLink1080 || "", movieLink4k: data.movieLink4k || "", visibility: data.visibility || "public",
 telegramCustomButtonText: data.telegramCustomButton?.text || "",
 telegramCustomButtonUrl: data.telegramCustomButton?.url || "",
 audioTracks: Array.isArray(data.audioTracks) ? data.audioTracks : data.audioTracks ? Object.values(data.audioTracks) : [],
 });
 setMovieCast(data.cast || []);
 setMovieEditId(id);
 setActiveSection("movies");
 setMoviesTab("mv-add");
 toast.info("Editing: " + data.title);
 };

 const deleteMovie = (id: string) => {
 if (confirm("Delete this movie?")) {
 remove(ref(db, `movies/${id}`)).then(async () => {
 removeAdminContentListItem("movies", id);
 await removeAdminContentIndex("movies", id).catch(() => {});
 toast.success("Deleted!");
 }).catch(err => toast.error("Error: " + err.message));
 }
 };

 const updateMovieVisibility = async (id: string, visibility: "public" | "private") => {
 try {
 await update(ref(db, `movies/${id}`), { visibility, updatedAt: Date.now() });
 toast.success(visibility === "private" ? "Movie moved to Private" : "Movie moved to Public");
 } catch (err: any) {
 toast.error("Error: " + err.message);
 }
 };

 // ==================== NOTIFICATIONS ====================
 const sendNotification = async () => {
 if (!notifTitle || !notifMessage) { toast.error("Please enter title and message"); return; }
 const savedTitle = notifTitle;
 const savedMessage = notifMessage;

 // Push delivery removed — only in-app notifications below

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

 // FCM push removed — only in-app notifications were sent above
 } catch (err: any) {
 console.warn("Notification send failed:", err);
 toast.error("Error: " + err.message);
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
 const series = (await getFullAdminContentItem("webseries", contentId)) || webseriesData.find(s => s.id === contentId);
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

 const handleReleaseSeasonChange = async (value: string) => {
 setReleaseSeason(value); setReleaseEpisode(""); setReleaseEpisodes([]);
 if (!releaseContent || value === "") return;
 const [contentId, contentType] = releaseContent.split("|");
 if (contentType === "animesalt") {
 // AnimeSalt no longer supported in releases - skip
 toast.error("AnimeSalt content is not supported in New Releases"); return;
 } else if (contentType === "webseries") {
 const series = (await getFullAdminContentItem("webseries", contentId)) || webseriesData.find(s => s.id === contentId);
 if (series?.seasons?.[parseInt(value)]) {
 const season = series.seasons[parseInt(value)];
  const safeEpisodes = Array.isArray(season?.episodes) ? season.episodes : [];
  if (safeEpisodes.length > 0) {
  setReleaseEpisodes(safeEpisodes.map((ep: any, i: number) => ({ index: i, name: `Episode ${ep?.episodeNumber || i + 1}` })));
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
 content = (await getFullAdminContentItem("webseries", contentId)) || webseriesData.find(s => s.id === contentId);
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
 content = (await getFullAdminContentItem("movies", contentId)) || moviesData.find(m => m.id === contentId);
 episodeInfo = { type: "movie", seasonName: "Movie" };
 }
 if (!content) { toast.error("Content not found"); return; }

 const newRelease = {
 contentId, contentType, title: content.title, poster: content.poster || "",
 year: content.year || "N/A", rating: content.rating || "N/A",
 visibility: content.visibility || "public",
 episodeInfo, timestamp: Date.now(), active: true,
 weeklyEnabled: content.weeklyEnabled === true,
 weeklyEveryDays: Math.max(1, Number(content.weeklyEveryDays) || 7)
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
 
 // FCM push removed — in-app notifications above are sufficient
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

 // Strict guest detection (per user spec):
 // A REAL user MUST have a valid email address (Firebase Email or Google sign-in always provides one).
 // Anything else — entries whose id looks like `user_1773xxx...` and have no email — is a guest.
 const isValidEmail = (val: any): boolean => {
 if (!val || typeof val !== "string") return false;
 const s = val.trim().toLowerCase();
 if (!s) return false;
 return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
 };
 const guestUidSet = useMemo(() => {
 const guests = new Set<string>();
 usersData.forEach((u: any) => {
 if (!u || !u.id) return;
 if (isValidEmail(u.email)) return; // real user (email or Google sign-in)
 guests.add(String(u.id));
 });
 return guests;
 }, [usersData]);
 const recentContent = useMemo(() => [
 ...webseriesData.map((item) => ({ ...item, _adminKind: "series" as const })),
 ...moviesData.map((item) => ({ ...item, _adminKind: "movie" as const })),
 ].sort((a, b) => (b.createdAt || b.updatedAt || 0) - (a.createdAt || a.updatedAt || 0)).slice(0, 3), [webseriesData, moviesData]);

 // Weekly schedule (for dashboard preview)
 const [weeklyScheduleData, setWeeklyScheduleData] = useState<Record<string, any>>({});
 useEffect(() => {
 const unsub = onValue(ref(db, "weeklySchedule"), snap => setWeeklyScheduleData(snap.val() || {}));
 return () => unsub();
 }, []);
 const todayDayName = useMemo(() => new Date().toLocaleDateString("en-US", { weekday: "long" }), []);
 const todayScheduled = useMemo(
 () => Object.values(weeklyScheduleData).filter((s: any) => s?.day === todayDayName || s?.day === "AllDay"),
 [weeklyScheduleData, todayDayName]
 );
 const categoryList = useMemo(() => Object.entries(categoriesData).map(([id, cat]: any) => ({ id, name: cat.name })), [categoriesData]);
 const languageOptions = useMemo(() => ["English", "Hindi", "Tamil", "Telugu", "Korean", "Japanese", "Spanish", "Multi"], []);

 const buildEmptyAudioTrack = useCallback(() => ({
 language: "",
 label: "",
 link: "",
  audioUrl: "",
  rawAudioUrl: "",
  isDefault: false,
 }), []);

 const normalizeLanguageValue = useCallback((value?: string | null) => String(value || "").trim(), []);

 const normalizeAudioTrackList = useCallback((tracks?: any[] | Record<string, any> | null) => {
 const list = Array.isArray(tracks) ? tracks : tracks && typeof tracks === "object" ? Object.values(tracks) : [];
 const cleaned = list
 .map((track: any, index: number) => {
 const label = normalizeLanguageValue(track?.label || track?.language || track?.name || `Audio ${index + 1}`) || `Audio ${index + 1}`;
 const language = normalizeLanguageValue(track?.language || track?.label || label) || label;
 const link = String(track?.link || track?.audioUrl || track?.rawAudioUrl || track?.uri || track?.url || "").trim();
 return {
 language,
 label,
 link,
 audioUrl: String(track?.audioUrl || link || "").trim(),
 rawAudioUrl: String(track?.rawAudioUrl || link || "").trim(),
 isDefault: track?.isDefault === true,
 };
 })
 .filter((track: any) => String(track.label || track.language || track.link || "").trim());
 if (cleaned.length > 0 && !cleaned.some((track: any) => track.isDefault)) {
 cleaned[0].isDefault = true;
 }
 return cleaned;
 }, [normalizeLanguageValue]);

 const normalizeEpisodeStructure = useCallback((episode: any, index = 0): Episode => {
 const audioTracks = normalizeAudioTrackList(
  Array.isArray(episode?.audioTracks) && episode.audioTracks.length > 0
   ? episode.audioTracks
   : episode?.defaultAudio
    ? [episode.defaultAudio]
    : [],
 );
 const defaultAudioIndex = audioTracks.findIndex((track: any) => track?.isDefault);
 const resolvedAudioTracks = audioTracks.map((track: any, idx: number) => ({
  ...track,
  isDefault: defaultAudioIndex >= 0 ? idx === defaultAudioIndex : idx === 0,
 }));
 const defaultAudio = resolvedAudioTracks.find((track: any) => track?.isDefault) || resolvedAudioTracks[0] || null;
 const link = String(episode?.link || episode?.link1080 || episode?.directUrl || episode?.movieLink || "").trim();
 const link480 = String(episode?.link480 || episode?.qualityLinks?.p480 || "").trim();
 const link720 = String(episode?.link720 || episode?.qualityLinks?.p720 || "").trim();
 const link1080 = String(episode?.link1080 || episode?.qualityLinks?.p1080 || link || "").trim();
 const link4k = String(episode?.link4k || episode?.qualityLinks?.p4k || "").trim();
 return {
 episodeNumber: Number(episode?.episodeNumber || episode?.number || index + 1),
 title: episode?.title || `Episode ${Number(episode?.episodeNumber || episode?.number || index + 1)}`,
 link,
 link480,
 link720,
 link1080,
 link4k,
 qualityLinks: {
 default: link || link1080 || link720 || link480 || "",
 p480: link480,
 p720: link720,
 p1080: link1080 || link,
 p4k: link4k,
 },
 audioTracks: resolvedAudioTracks,
 defaultAudio,
 subtitleTracks: Array.isArray(episode?.subtitleTracks) ? episode.subtitleTracks : [],
 };
 }, [normalizeAudioTrackList]);

 const cloneSeasonList = useCallback((seasons?: Season[]) => {
 try {
 const cloned = JSON.parse(JSON.stringify(seasons || [])) as Season[];
 return cloned.map((season: any, sIdx: number) => ({
 ...season,
 name: season?.name || `Season ${sIdx + 1}`,
 seasonNumber: Number(season?.seasonNumber || sIdx + 1),
 episodes: Array.isArray(season?.episodes) ? season.episodes.map((episode: any, eIdx: number) => normalizeEpisodeStructure(episode, eIdx)) : [],
 })) as Season[];
 } catch {
 return Array.isArray(seasons) ? seasons.map((season: any, sIdx: number) => ({
 ...season,
 name: season?.name || `Season ${sIdx + 1}`,
 seasonNumber: Number(season?.seasonNumber || sIdx + 1),
 episodes: Array.isArray(season?.episodes) ? season.episodes.map((episode: any, eIdx: number) => normalizeEpisodeStructure(episode, eIdx)) : [],
 })) as Season[] : [];
 }
 }, [normalizeEpisodeStructure]);

 const sanitizeSeasonLanguageMap = useCallback((map?: SeasonsByLanguage | null) => {
 const cleaned: SeasonsByLanguage = {};
 Object.entries(map || {}).forEach(([language, seasons]) => {
 const key = normalizeLanguageValue(language);
 if (!key) return;
 cleaned[key] = cloneSeasonList(Array.isArray(seasons) ? seasons : []);
 });
 return cleaned;
 }, [cloneSeasonList, normalizeLanguageValue]);

 const getCardLanguageLabel = useCallback((languages: string[]) => {
 const cleaned = Array.from(new Set(languages.map((item) => normalizeLanguageValue(item)).filter(Boolean)));
 if (cleaned.length === 0) return "Hindi";
 if (cleaned.length === 1) return cleaned[0];
 if (cleaned.length === 2) return "Dual";
 return "Multiple";
 }, [normalizeLanguageValue]);

 const getEpisodeTrackForLanguage = useCallback((episode: any, language: string) => {
 const key = normalizeLanguageValue(language).toLowerCase();
 const tracks = Array.isArray(episode?.audioTracks) ? episode.audioTracks : episode?.audioTracks && typeof episode.audioTracks === "object" ? Object.values(episode.audioTracks) : [];
 return (tracks as any[]).find((track) => {
 const label = normalizeLanguageValue(track?.label || track?.language).toLowerCase();
 return !!label && label === key;
 });
 }, [normalizeLanguageValue]);

 const ensureEpisodeTrackForLanguage = useCallback((episode: any, language: string) => {
 const existing = getEpisodeTrackForLanguage(episode, language);
 if (existing) return existing;
 const normalized = normalizeLanguageValue(language);
 const created = buildEmptyAudioTrack();
 created.language = normalized;
 created.label = normalized;
 if (!Array.isArray(episode.audioTracks)) episode.audioTracks = [];
 episode.audioTracks.push(created);
 return created;
 }, [buildEmptyAudioTrack, getEpisodeTrackForLanguage, normalizeLanguageValue]);

 const buildLanguageSummaryFromTracks = useCallback((tracks?: any[]) => {
 const langs = Array.from(new Set(((tracks || []) as any[])
 .map((track) => normalizeLanguageValue(track?.label || track?.language))
 .filter(Boolean)));
 return {
 list: langs,
 label: getCardLanguageLabel(langs),
 };
 }, [getCardLanguageLabel, normalizeLanguageValue]);

 const syncSeriesLanguageSummary = useCallback((form: any, seasonsByLanguage: SeasonsByLanguage) => {
 const normalizedMap = sanitizeSeasonLanguageMap(seasonsByLanguage);
 const seasonLanguages = new Set<string>();
 Object.entries(normalizedMap).forEach(([language, seasons]) => {
 if (Array.isArray(seasons) && seasons.length > 0) {
 seasonLanguages.add(language);
 }
 });
 const selectedBase = normalizeLanguageValue(form?.selectedAdminLanguage);
 const fallbackBase = normalizeLanguageValue(form?.baseLanguage || form?.language || Array.from(seasonLanguages)[0] || "Hindi");
 const resolvedBase = fallbackBase || "Hindi";
 const summaryLanguages = Array.from(new Set([resolvedBase, ...Array.from(seasonLanguages)].filter(Boolean)));
 const ordered = Array.from(new Set([resolvedBase, ...Array.from(seasonLanguages), selectedBase].filter(Boolean)));

 return {
 ...form,
 baseLanguage: resolvedBase,
 selectedAdminLanguage: selectedBase || resolvedBase,
 availableLanguages: ordered,
 language: getCardLanguageLabel(summaryLanguages),
 audioTracks: ordered.map((lang) => ({ language: lang, label: lang, link: "" })),
 };
 }, [getCardLanguageLabel, normalizeLanguageValue, sanitizeSeasonLanguageMap]);

 const updateSeriesEpisodeLanguageLink = useCallback((sIdx: number, eIdx: number, field: string, value: string, language?: string) => {
 setSeasonsData((prev) => {
  const copy = Array.isArray(prev) ? [...prev] : [];
  const rawSeason = copy[sIdx] || { name: `Season ${sIdx + 1}`, seasonNumber: sIdx + 1, episodes: [] };
  const season = { ...rawSeason, episodes: Array.isArray((rawSeason as any).episodes) ? [...(rawSeason as any).episodes] : [] } as any;
  const episode = { ...(season.episodes[eIdx] || normalizeEpisodeStructure({ episodeNumber: eIdx + 1 }, eIdx)) } as any;
 episode[field] = value;
 const currentQualityLinks = episode.qualityLinks || {};
 episode.qualityLinks = {
 ...currentQualityLinks,
 default: field === "link" ? value : (episode.link || currentQualityLinks.default || ""),
 p480: field === "link480" ? value : (episode.link480 || currentQualityLinks.p480 || ""),
 p720: field === "link720" ? value : (episode.link720 || currentQualityLinks.p720 || ""),
 p1080: field === "link1080" ? value : (episode.link1080 || episode.link || currentQualityLinks.p1080 || ""),
 p4k: field === "link4k" ? value : (episode.link4k || currentQualityLinks.p4k || ""),
 };

 season.episodes[eIdx] = episode;
 copy[sIdx] = season;
 return copy;
 });
  }, [normalizeEpisodeStructure]);

 const updateSeriesEpisodeAudioTrack = useCallback((sIdx: number, eIdx: number, tIdx: number, field: string, value: string) => {
 setSeasonsData((prev) => {
  const copy = Array.isArray(prev) ? [...prev] : [];
  const rawSeason = copy[sIdx] || { name: `Season ${sIdx + 1}`, seasonNumber: sIdx + 1, episodes: [] };
  const season = { ...rawSeason, episodes: Array.isArray((rawSeason as any).episodes) ? [...(rawSeason as any).episodes] : [] } as any;
  const episode = { ...(season.episodes[eIdx] || normalizeEpisodeStructure({ episodeNumber: eIdx + 1 }, eIdx)) } as any;
 const tracks = Array.isArray(episode.audioTracks) ? [...episode.audioTracks] : [];
 const nextTrack: any = { ...(tracks[tIdx] || buildEmptyAudioTrack()), [field]: value };
 if (field === "link") {
  nextTrack.audioUrl = value;
  nextTrack.rawAudioUrl = value;
 }
 tracks[tIdx] = nextTrack;
 if (!tracks.some((track: any) => track?.isDefault)) tracks[0] = { ...(tracks[0] || buildEmptyAudioTrack()), isDefault: true };
 episode.defaultAudio = tracks.find((track: any) => track?.isDefault) || tracks[0] || null;
 episode.audioTracks = tracks;
 season.episodes[eIdx] = episode;
 copy[sIdx] = season;
 return copy;
 });
  }, [buildEmptyAudioTrack, normalizeEpisodeStructure]);

 const addSeriesEpisodeAudioTrack = useCallback((sIdx: number, eIdx: number) => {
 setSeasonsData((prev) => {
  const copy = Array.isArray(prev) ? [...prev] : [];
  const rawSeason = copy[sIdx] || { name: `Season ${sIdx + 1}`, seasonNumber: sIdx + 1, episodes: [] };
  const season = { ...rawSeason, episodes: Array.isArray((rawSeason as any).episodes) ? [...(rawSeason as any).episodes] : [] } as any;
  const episode = { ...(season.episodes[eIdx] || normalizeEpisodeStructure({ episodeNumber: eIdx + 1 }, eIdx)) } as any;
 const existingTracks = Array.isArray(episode.audioTracks) ? episode.audioTracks : [];
 const nextTrack = { ...buildEmptyAudioTrack(), isDefault: existingTracks.length === 0 };
 episode.audioTracks = [...existingTracks, nextTrack];
 episode.defaultAudio = episode.audioTracks.find((track: any) => track?.isDefault) || episode.audioTracks[0] || null;
 season.episodes[eIdx] = episode;
 copy[sIdx] = season;
 return copy;
 });
  }, [buildEmptyAudioTrack, normalizeEpisodeStructure]);

 const removeSeriesEpisodeAudioTrack = useCallback((sIdx: number, eIdx: number, tIdx: number) => {
 setSeasonsData((prev) => {
  const copy = Array.isArray(prev) ? [...prev] : [];
  const rawSeason = copy[sIdx] || { name: `Season ${sIdx + 1}`, seasonNumber: sIdx + 1, episodes: [] };
  const season = { ...rawSeason, episodes: Array.isArray((rawSeason as any).episodes) ? [...(rawSeason as any).episodes] : [] } as any;
  const episode = { ...(season.episodes[eIdx] || normalizeEpisodeStructure({ episodeNumber: eIdx + 1 }, eIdx)) } as any;
 const tracks = (Array.isArray(episode.audioTracks) ? episode.audioTracks : []).filter((_: any, idx: number) => idx !== tIdx);
 if (tracks.length > 0 && !tracks.some((track: any) => track?.isDefault)) tracks[0] = { ...tracks[0], isDefault: true };
 episode.audioTracks = tracks;
 episode.defaultAudio = tracks.find((track: any) => track?.isDefault) || tracks[0] || null;
 season.episodes[eIdx] = episode;
 copy[sIdx] = season;
 return copy;
 });
  }, [normalizeEpisodeStructure]);

 const setSeriesEpisodeDefaultAudioTrack = useCallback((sIdx: number, eIdx: number, tIdx: number) => {
 setSeasonsData((prev) => {
  const copy = Array.isArray(prev) ? [...prev] : [];
  const rawSeason = copy[sIdx] || { name: `Season ${sIdx + 1}`, seasonNumber: sIdx + 1, episodes: [] };
  const season = { ...rawSeason, episodes: Array.isArray((rawSeason as any).episodes) ? [...(rawSeason as any).episodes] : [] } as any;
  const episode = { ...(season.episodes[eIdx] || normalizeEpisodeStructure({ episodeNumber: eIdx + 1 }, eIdx)) } as any;
 const tracks = (Array.isArray(episode.audioTracks) ? episode.audioTracks : []).map((track: any, idx: number) => ({ ...track, isDefault: idx === tIdx }));
 episode.audioTracks = tracks;
 episode.defaultAudio = tracks[tIdx] || tracks[0] || null;
 season.episodes[eIdx] = episode;
 copy[sIdx] = season;
 return copy;
 });
  }, [normalizeEpisodeStructure]);

 const updateSeriesEpisodeSubtitle = useCallback((sIdx: number, eIdx: number, value: string) => {
 setSeasonsData((prev) => {
  const copy = Array.isArray(prev) ? [...prev] : [];
  const rawSeason = copy[sIdx] || { name: `Season ${sIdx + 1}`, seasonNumber: sIdx + 1, episodes: [] };
  const season = { ...rawSeason, episodes: Array.isArray((rawSeason as any).episodes) ? [...(rawSeason as any).episodes] : [] } as any;
  const episode = { ...(season.episodes[eIdx] || normalizeEpisodeStructure({ episodeNumber: eIdx + 1 }, eIdx)) } as any;
 const url = value.trim();
 episode.subtitleTracks = url ? [{ label: "Default", language: "", url }] : [];
 season.episodes[eIdx] = episode;
 copy[sIdx] = season;
 return copy;
 });
  }, [normalizeEpisodeStructure]);

 const ensureSeriesLanguageTab = useCallback((language: string) => {
 const normalized = normalizeLanguageValue(language);
 if (!normalized) return;
 const currentLanguage = normalizeLanguageValue(seriesForm?.selectedAdminLanguage || seriesForm?.baseLanguage || seriesForm?.language || "Hindi") || "Hindi";
 const nextMap = sanitizeSeasonLanguageMap({
 ...seriesSeasonsByLanguage,
 [currentLanguage]: cloneSeasonList(seasonsData),
 });
 const nextSeasons = cloneSeasonList(nextMap[normalized] || []);
 if (!(normalized in nextMap)) nextMap[normalized] = [];
 setSeriesSeasonsByLanguage(nextMap);
 setSeasonsData(cloneSeasonList(nextSeasons));
 setSeriesForm((prev: any) => syncSeriesLanguageSummary({ ...(prev || {}), selectedAdminLanguage: normalized }, nextMap));
 }, [cloneSeasonList, normalizeLanguageValue, seasonsData, seriesForm, seriesSeasonsByLanguage, syncSeriesLanguageSummary, sanitizeSeasonLanguageMap]);

 // Season/Episode helpers
 const addSeason = (name = "", episodeCount = 1) => {
 setSeasonsData(prev => [...prev, {
 name: name || `Season ${prev.length + 1}`, seasonNumber: prev.length + 1,
 episodes: Array(episodeCount).fill(null).map((_, i) => normalizeEpisodeStructure({ episodeNumber: i + 1, title: `Episode ${i + 1}`, link: "" }, i))
 }]);
 };

 const removeSeason = (idx: number) => {
 if (confirm("Remove this season?")) setSeasonsData(prev => prev.filter((_, i) => i !== idx));
 };

 const addEpisode = async (sIdx: number) => {
 const season = { ...(seasonsData[sIdx] as any), episodes: Array.isArray((seasonsData[sIdx] as any)?.episodes) ? (seasonsData[sIdx] as any).episodes : [] } as Season;
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
 const s = { ...copy[sIdx], episodes: Array.isArray(copy[sIdx]?.episodes) ? [...copy[sIdx].episodes] : [] };
 s.episodes.push(normalizeEpisodeStructure({ episodeNumber: num, title: epTitle, link: "", link480: "", link720: "", link1080: "", link4k: "", audioTracks: [] }, num - 1));
 copy[sIdx] = s;
 return copy;
 });
 };

 const removeEpisode = (sIdx: number, eIdx: number) => {
 if (!confirm("Remove this episode?")) return;
 setSeasonsData(prev => {
  const copy = Array.isArray(prev) ? [...prev] : [];
  const rawSeason = copy[sIdx] || { name: `Season ${sIdx + 1}`, seasonNumber: sIdx + 1, episodes: [] };
  const s = { ...rawSeason, episodes: (Array.isArray((rawSeason as any).episodes) ? (rawSeason as any).episodes : []).filter((_: any, i: number) => i !== eIdx) };
 // Re-number episodes
  s.episodes = s.episodes.map((ep: any, i: number) => ({ ...ep, episodeNumber: i + 1 }));
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
 qualityLinks: ep.qualityLinks || {},
 audioTracks: normalizeAudioTrackList(ep.audioTracks),
 defaultAudio: normalizeAudioTrackList(ep.audioTracks).find((track: any) => track?.isDefault) || normalizeAudioTrackList(ep.audioTracks)[0] || null,
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
 toast.success(`${newSeasons.length} Season JSON from import done!`);
 setWsJsonImportMode(false);
 setWsJsonPasteText('');
 return;
 } else {
 toast.error('Invalid JSON format. An episodes or seasons array is required.');
 return;
 }

 if (episodes.length === 0) {
 toast.error('No episodes found in the JSON');
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
 qualityLinks: ep.qualityLinks || {},
 audioTracks: normalizeAudioTrackList(ep.audioTracks),
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
 toast.success(`${mappedEpisodes.length} episodes imported from JSON!`);
 setWsJsonImportMode(false);
 setWsJsonPasteText('');
 } catch (err: any) {
 toast.error('JSON parse failed: ' + err.message);
 }
 };

 const wsHandleJsonPaste = () => {
 if (!wsJsonPasteText.trim()) { toast.error('Paste JSON text'); return; }
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
 toast.error('Invalid JSON. An episodes array is required.');
 return;
 }
 if (episodes.length === 0) { toast.error('No episodes found'); return; }
 const mapped = episodes.map((ep: any, eIdx: number) => ({
 episodeNumber: ep.episodeNumber || ep.number || eIdx + 1,
 title: ep.title || `Episode ${ep.episodeNumber || ep.number || eIdx + 1}`,
 link: ep.link || '',
 link480: ep.link480 || '',
 link720: ep.link720 || '',
 link1080: ep.link1080 || '',
 link4k: ep.link4k || '',
 qualityLinks: ep.qualityLinks || {},
 audioTracks: normalizeAudioTrackList(ep.audioTracks),
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
 updateSeriesEpisodeLanguageLink(sIdx, eIdx, "link", link);
 };

 const updateEpisodeQualityLink = (sIdx: number, eIdx: number, quality: string, link: string) => {
 updateSeriesEpisodeLanguageLink(sIdx, eIdx, quality, link);
 };

 // ==================== AUTH HANDLERS ====================
    const handlePinLogin = async () => {
    if (!loginPinInput) { toast.error("Enter PIN"); return; }
    // PIN-only login is allowed without prior Google verification.
    // Google sign-in remains available as an optional alternative.
   const blk = await isBlocked(null);
   if (blk.blocked) {
     await logAdminAccess({ method: "pin", success: false, reason: "blocked: " + (blk.reason || "") });
     toast.error("Access denied: " + (blk.reason || "blocked"));
     setLoginPinInput("");
     return;
   }
   try {
     // Route through EGD Router so the admin's own deployed verify-admin-pin
     // URL (with their private ADMIN_PIN) takes precedence over the project
     // default. Falls back to the Lovable Cloud default automatically.
     let ok = false;
     try {
       const url = await getEdgeFunctionUrl("verify-admin-pin");
       if (url) {
         const res = await fetch(url, {
           method: "POST",
           headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
           body: JSON.stringify({ pin: loginPinInput }),
         });
         const j = await res.json().catch(() => ({}));
         ok = !!j?.ok;
       }
     } catch {}
     if (!ok) {
       // Hard fallback to direct Supabase invoke if router lookup failed.
       const { data } = await supabase.functions.invoke("verify-admin-pin", { body: { pin: loginPinInput } });
       ok = !!(data as any)?.ok;
     }
     if (!ok) {
       logAdminAccess({ method: "pin", success: false, reason: "wrong-pin" });
       toast.error("Wrong PIN");
       setLoginPinInput("");
       return;
     }
     setIsAuthenticated(true);
     try {
       sessionStorage.setItem("rs_admin_pin", loginPinInput);
       localStorage.setItem("rs_admin_session", JSON.stringify({ method: "pin", ts: Date.now() }));
     } catch {}
     logAdminAccess({ method: "pin", success: true });
     toast.success("Login successful!");
     setLoginPinInput("");
   } catch (e: any) {
     logAdminAccess({ method: "pin", success: false, reason: "verify-error" });
     toast.error("PIN verification failed");
     setLoginPinInput("");
   }
   };

 const handleCreatePin = () => {
 toast.info("PIN is now managed via the ADMIN_PIN Lovable Cloud secret. Update it in project settings.");
 };

 const handleSetPin = () => {
 toast.info("PIN is now managed via the ADMIN_PIN Lovable Cloud secret. Update it in project settings.");
 setShowPinSetup(false);
 };

 const handleDisablePin = () => {
 toast.info("PIN is enforced via the ADMIN_PIN secret and cannot be disabled from the UI.");
 };

 const handleLogout = () => {
 setIsAuthenticated(false);
 localStorage.removeItem("rs_admin_session");
 localStorage.removeItem("rs_admin_google");
 try { sessionStorage.removeItem("rs_admin_pin"); } catch {}
 toast.success("Logged out");
 };

  // Google Sign-In for Admin
  const handleGoogleAdminLogin = async () => {
  setGoogleAuthLoading(true);
  try {
  const result = await signInWithPopup(auth, googleProvider);
  const email = result.user.email;
  if (!email) { toast.error("Could not get email from Google account"); return; }
  // Block check — owner emails skip the block list.
  const blk = await isBlocked(email);
  if (blk.blocked) {
    await logAdminAccess({ email, method: "google", success: false, reason: "blocked: " + (blk.reason || "") });
    toast.error("Access denied: " + (blk.reason || "blocked"));
    return;
  }
  // Check if this Google email is authorized as admin (owners always allowed)
  const adminSnap = await get(ref(db, "admin/authorizedEmails"));
  const authorizedEmails = adminSnap.val() || {};
  const isAuthorized = isOwnerEmail(email) || Object.values(authorizedEmails).some((e: any) => e === email);
  if (!isAuthorized) {
  await logAdminAccess({ email, method: "google", success: false, reason: "not-authorized" });
  toast.error("❌ This Google account is not authorized as admin");
  return;
  }
   setIsAuthenticated(true);
   setAdminGoogleEmail(email);
   const displayName = result.user.displayName || email.split("@")[0];
   try {
   localStorage.setItem("rs_admin_session", JSON.stringify({ google: email, ts: Date.now() }));
   localStorage.setItem("rs_admin_google", email);
   localStorage.setItem("rs_admin_google_name", displayName);
   } catch {}
   // Persist device → name mapping so SecurityCenter can show a human name
   // alongside the device fingerprint in subsequent PIN logins.
   rememberDeviceName(displayName, email);
   logAdminAccess({ email, name: displayName, method: "google", success: true });
   toast.success(`✅ Google Login successful! (${email})`);
  } catch (err: any) {
  logAdminAccess({ method: "google", success: false, reason: err?.message || "google-error" });
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
 // Build footer links HTML
 const footerLinksHtml = tgFooterLinks.map(l =>
 `๏ ${l.emoji} <a href="${l.url}">${l.label}</a> ${l.emoji}`
 ).join("\n");

 const caption = `♨️ <b>Tɪᴛᴇʟ;-</b> ${tgTitle}
┌──────────────────
│ ✦ <b>Sᴇᴀsᴏɴ :</b> ${tgSeason || 'N/A'}
│ ✦ <b>Eᴘɪsᴏᴅᴇs :</b> ${tgTotalEpisodes || 'N/A'}
│ ✦ <b>Aᴜᴅɪᴏ :</b> 🎧 ${tgLanguages} ${tgDubType === "fandub" ? "𝐅𝐚𝐧𝐝𝐮𝐛" : "𝐎𝐟𝐟𝐢𝐜𝐢𝐚𝐥"}
│ ✦ <b>Qᴜᴀʟɪᴛʏ :</b> ${tgQuality}
│ ✦ <b>Rᴀᴛɪɴɢ :</b> ⭐ ${tgRating}/10
│ ✦ <b>Gᴇɴʀᴇs :</b> ${tgGenres}
│ ✦ <b>Sᴛᴀᴛᴜs :</b> ${tgStatus === "complete" ? "Cᴏᴍᴘʟᴇᴛᴇ ✅" : "Oɴɢᴏɪɴɢ 🟢"}
└──────────────────
▰▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▰
📌 ${formatEpisodeRangeLabel(tgSeason, ...(String(tgNewEpAdded || '01').split('-').map(v => v.trim()) as [string, string?]))}
▰▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▰
${footerLinksHtml}
▰▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▰
${sanitizeTelegramHashtags(tgHashtags, tgTitle)}`;

 // Support multiple channel IDs separated by comma, newline, or space
 const channelIds = tgChannelId
 .split(/[,\n]+/)
 .map(id => id.trim())
 .filter(id => id.length > 0);

 if (channelIds.length === 0) { toast.error("Enter at least one channel ID"); setTgSending(false); return; }

 const results: { id: string; ok: boolean; error?: string; messageId?: number }[] = [];

 // Build inline keyboard buttons array
 const inlineButtons: { text: string; url: string }[] = [];
 if (tgButtonLink) {
 inlineButtons.push({ text: tgDefaultButtonName || "📥 𝐖𝐀𝐓𝐂𝐇 𝐀𝐍𝐃 𝐃𝐎𝐖𝐍𝐋𝐎𝐀𝐃 📥", url: tgButtonLink });
 }
 tgButtons.forEach(btn => {
 if (btn.name.trim() && btn.url.trim()) {
 inlineButtons.push({ text: btn.name.trim(), url: btn.url.trim() });
 }
 });

 for (const chatId of channelIds) {
 const payload = {
 chatId,
 caption,
 photoUrl: tgPosterUrl || undefined,
 inlineButtons: inlineButtons.length > 0 ? inlineButtons : undefined,
 // Free Access button is controlled ENTIRELY by the global toggle at
 // settings/telegramFreeAccess.enabled (read inside the edge function).
 // Do NOT force-include here — that would bypass the OFF switch.
 freeAccessUserId: "telegram_post",
 };
 try {
 const endpoint = await getEdgeFunctionUrl('telegram-post');
 const response = await fetch(endpoint, {
 method: 'POST',
 headers: {
 'Content-Type': 'application/json',
 ...(SUPABASE_ANON_KEY ? { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } : {}),
 },
 body: JSON.stringify(payload),
 });
 const rawText = await response.text();
 const data = (() => {
 if (!rawText) return {};
 try {
 return JSON.parse(rawText);
 } catch {
 return { rawText };
 }
 })();
 if (!response.ok || data?.error) {
 results.push({ id: chatId, ok: false, error: data?.error || 'API error' });
 } else {
 results.push({ id: chatId, ok: true, messageId: data?.result?.message_id || data?.message_id });
 // Save to Firebase for future button URL editing
 const msgId = data?.result?.message_id || data?.message_id;
 if (msgId) {
                const postRecord = {
 chatId,
 messageId: msgId,
 title: tgTitle,
 poster: tgPosterUrl || "",
 caption,
 buttons: inlineButtons,
 sentAt: Date.now(),
 };
 try { await set(ref(db, `telegramPosts/${chatId.replace(/[^a-zA-Z0-9_-]/g, '_')}_${msgId}`), postRecord); } catch {}
 }
 }
 } catch (err: any) {
 results.push({ id: chatId, ok: false, error: err.message });
 }
 }

 const successCount = results.filter(r => r.ok).length;
 const failedResults = results.filter(r => !r.ok);
 if (failedResults.length === 0) {
 toast.success(`✅ ${successCount} channel posts sent!`);
 } else if (successCount > 0) {
 toast.success(`✅ ${successCount}/${channelIds.length} channels sent`);
 failedResults.forEach(r => toast.error(`❌ ${r.id}: ${r.error}`));
 } else {
 toast.error("Posting failed for all channels");
 failedResults.forEach(r => toast.error(`❌ ${r.id}: ${r.error}`));
 }
 } catch (err: any) {
 toast.error("Telegram post failed: " + (err.message || "Unknown error"));
 } finally {
 setTgSending(false);
 }
 };

 // ============= BULK CATALOG BROADCAST =============
 // Sends one Telegram message per channel containing N random anime (title + clickable link).
 // Tracks sent IDs in Firebase so the SAME anime is never re-sent (no duplicates).
 const sendBulkCatalogPost = async () => {
 if (!tgChannelId.trim()) { toast.error("Enter channel ID(s)"); return; }
 const batchSize = Math.max(1, Math.min(50, tgBulkBatchSize || 20));

 // Build pool from admin-added webseries + movies
 const pool = [
 ...webseriesData.map((s: any) => ({ id: String(s.id), title: String(s.title || "").trim(), type: "webseries" as const })),
 ...moviesData.map((m: any) => ({ id: String(m.id), title: String(m.title || "").trim(), type: "movie" as const })),
 ].filter(it => it.id && it.title);

 const remaining = pool.filter(it => !tgBulkSentIds[it.id]);
 if (remaining.length === 0) {
 toast.error("All anime already sent! Reset or add new anime।");
 return;
 }

 // Random pick (no duplicate within batch + not previously sent)
 const shuffled = [...remaining].sort(() => Math.random() - 0.5);
 const picked = shuffled.slice(0, batchSize);

 // Build professional HTML body — each anime in its own blockquote "box"
 // Telegram renders <blockquote> with a colored left bar, giving each item a card-like feel.
 const boxes = picked.map((it, i) => {
 const num = String(i + 1).padStart(2, "0");
 const url = `${SITE_URL}?anime=${encodeURIComponent(it.id)}`;
 const icon = it.type === "movie" ? "🎬" : "📺";
 const tag = it.type === "movie" ? "MOVIE" : "SERIES";
 const title = escapeHtmlBasic(it.title);
 return `<blockquote>${icon} <b>#${num}</b> • <i>${tag}</i>
🎯 <a href="${url}"><b>${title}</b></a>
▶️ <a href="${url}">Tap to Watch Now</a></blockquote>`;
 }).join("\n\n");

 const headerText = escapeHtmlBasic(String(tgBulkHeader || "").replace(/<[^>]+>/g, "").trim()) || "Daily Drops";
 const caption = `✨ <b>${headerText}</b> ✨
━━━━━━━━━━━━━━━━━━━

${boxes}

━━━━━━━━━━━━━━━━━━━
${tgBulkFooter}
🌐 <a href="${SITE_URL}"><b>${SITE_URL.replace(/^https?:\/\//, "")}</b></a>`;

 const channelIds = tgChannelId.split(/[,\n]+/).map(id => id.trim()).filter(Boolean);
 if (channelIds.length === 0) { toast.error("Enter at least one channel ID"); return; }

 setTgBulkSending(true);
 setTgBulkProgress({ done: 0, total: channelIds.length });

 let okCount = 0;
 const failures: string[] = [];

 try {
 const endpoint = await getEdgeFunctionUrl('telegram-post');
 for (let i = 0; i < channelIds.length; i++) {
 const chatId = channelIds[i];
 try {
 const res = await fetch(endpoint, {
 method: 'POST',
 headers: {
 'Content-Type': 'application/json',
 ...(SUPABASE_ANON_KEY ? { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } : {}),
 },
 body: JSON.stringify({ chatId, caption, freeAccessUserId: "telegram_bulk" }),
 });
 const data = await res.json().catch(() => ({}));
 if (!res.ok || data?.error) {
 failures.push(`${chatId}: ${data?.error || 'API error'}`);
 } else {
 okCount++;
 }
 } catch (err: any) {
 failures.push(`${chatId}: ${err.message || 'network error'}`);
 }
 setTgBulkProgress({ done: i + 1, total: channelIds.length });
 }

 // Persist sent IDs (only if at least one channel succeeded)
 if (okCount > 0) {
 const now = Date.now();
 const updates: Record<string, number> = { ...tgBulkSentIds };
 picked.forEach(it => { updates[it.id] = now; });
 try { await set(ref(db, "telegramBulkBroadcast/sentIds"), updates); } catch {}
 }

 if (failures.length === 0) {
 toast.success(`✅ ${picked.length} anime, ${okCount} channels sent! (${remaining.length - picked.length} remaining)`);
 } else if (okCount > 0) {
 toast.success(`✅ ${okCount}/${channelIds.length} channels succeeded`);
 failures.slice(0, 3).forEach(f => toast.error(f));
 } else {
 toast.error("All channels failed");
 failures.slice(0, 3).forEach(f => toast.error(f));
 }
 } finally {
 setTgBulkSending(false);
 setTimeout(() => setTgBulkProgress(null), 1500);
 }
 };

 const resetBulkSentIds = async () => {
 if (!confirm("Reset করলে all anime again send will go। Are you sure?")) return;
 try {
 await set(ref(db, "telegramBulkBroadcast/sentIds"), null);
 toast.success("✅ Reset complete — all anime again send will go");
 } catch (err: any) {
 toast.error("Reset failed: " + (err.message || ""));
 }
 };

 function escapeHtmlBasic(s: string): string {
 return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
 }

 function normalizeTelegramTitleKey(s: string): string {
  return String(s || "")
   .toLowerCase()
   .replace(/#/g, " ")
   .replace(/[^a-z0-9\u0980-\u09ff]+/g, " ")
   .replace(/\s+/g, " ")
   .trim();
 }

 function sanitizeTelegramHashtags(tags: string, title: string): string {
  const titleKey = normalizeTelegramTitleKey(title);
  return String(tags || "")
   .split(/\s+/)
   .map(tag => tag.trim())
   .filter(Boolean)
   .filter(tag => !/(official|fandub|ᴏғғɪᴄɪᴀʟ|ғᴀɴᴅᴜʙ)/i.test(tag))
   .filter(tag => normalizeTelegramTitleKey(tag) !== titleKey)
   .join(" ");
 }

 function sanitizeTelegramCaption(caption: string, title: string): string {
  return String(caption || "")
   .replace(/#ғᴀɴᴅᴜʙ/gi, "𝐅𝐚𝐧𝐝𝐮𝐛")
   .replace(/#ᴏғғɪᴄɪᴀʟ/gi, "𝐎𝐟𝐟𝐢𝐜𝐢𝐚𝐥")
   .split("\n")
   .map(line => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("#")) return line;
    return sanitizeTelegramHashtags(trimmed, title);
   })
   .filter(line => line.trim().length > 0)
   .join("\n")
   .trim();
 }


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
 const ws = (await getFullAdminContentItem("webseries", cId)) || webseriesData.find(s => s.id === cId);
 if (ws?.backdrop) backdropUrl = ws.backdrop;
 } else if (cType === "movie") {
 const mv = (await getFullAdminContentItem("movies", cId)) || moviesData.find(m => m.id === cId);
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
 const startEp = String(release.episodeInfo.episodeNumber || '').padStart(2, '0');
 const endEpRaw = release.episodeInfo.episodeNumberEnd;
 const endEp = endEpRaw ? String(endEpRaw).padStart(2, '0') : '';
 setTgNewEpAdded(endEp && endEp !== startEp ? `${startEp}-${endEp}` : startEp);
 }
 }
 // Get quality info from content
 const [contentId, contentType] = (release.contentId + "|" + release.contentType).split("|").length >= 2 
 ? [release.contentId, release.contentType] : [release.contentId, "webseries"];
 let qualities: string[] = [];
 if (contentType === "webseries") {
 const ws = (await getFullAdminContentItem("webseries", contentId)) || webseriesData.find(s => s.id === contentId);
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
 const mv = (await getFullAdminContentItem("movies", contentId)) || moviesData.find(m => m.id === contentId);
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
 const ws = (await getFullAdminContentItem("webseries", contentId)) || webseriesData.find(s => s.id === contentId);
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
 // Set button link with deep link to the exact episode when available
 const animeId = release.contentId || release.id;
 const shareSeasonIdx = release.episodeInfo?.type === "movie" ? undefined : Math.max(0, Number(release.episodeInfo?.seasonNumber || 1) - 1);
 const shareEpIdx = release.episodeInfo?.type === "movie" ? undefined : Math.max(0, Number(release.episodeInfo?.episodeNumber || 1) - 1);
 setTgButtonLink(buildEpisodeShareUrl(animeId, shareSeasonIdx, shareEpIdx));
 setTgSelectedAnimeId(String(animeId));
 // Load saved per-anime custom buttons (if any)
 try {
 const safeId = String(animeId).replace(/[^a-zA-Z0-9_-]/g, "_");
 const savedSnap = await get(ref(db, `telegramPerAnimeButtons/${safeId}`));
 const saved = savedSnap.val();
 if (saved && typeof saved === "object") {
 if (typeof saved.defaultButtonName === "string" && saved.defaultButtonName.trim()) {
 setTgDefaultButtonName(saved.defaultButtonName);
 }
 if (Array.isArray(saved.buttons)) {
 setTgButtons(saved.buttons.filter((b: any) => b && typeof b === "object").map((b: any) => ({
 name: String(b.name || ""),
 url: String(b.url || ""),
 })));
 } else {
 setTgButtons([]);
 }
 } else {
 // No saved data → reset to empty extras (keep default name as-is)
 setTgButtons([]);
 }
 } catch {}
 // Auto-set dub type from content
 if (cType === "webseries") {
 const ws = (await getFullAdminContentItem("webseries", cId)) || webseriesData.find(s => s.id === cId);
 setTgDubType(ws?.dubType === "fandub" ? "fandub" : "official");
 // Auto-set language from content
 if (ws?.language) setTgLanguages(String(ws.language).replace(/\s*\/\s*/g, ", ").replace(/\s*\|\s*/g, ", "));
 // Auto-fetch exact genres/rating from TMDB/AniList if tmdbId available
 if (ws?.tmdbId) {
 setTgImdbId(String(ws.tmdbId));
 const { genres, rating } = await resolveTelegramGenresAndRating(String(ws.tmdbId), ws.title || release.title || "");
 if (genres.length > 0) setTgGenres(genres.join(", "));
 if (rating) setTgRating(rating);
 } else {
 if (ws?.category) setTgGenres(ws.category);
 if (ws?.rating) setTgRating(String(ws.rating));
 }
 } else if (cType === "movie") {
 const mv = (await getFullAdminContentItem("movies", cId)) || moviesData.find(m => m.id === cId);
 setTgDubType(mv?.dubType === "fandub" ? "fandub" : "official");
 if (mv?.language) setTgLanguages(String(mv.language).replace(/\s*\/\s*/g, ", ").replace(/\s*\|\s*/g, ", "));
 if (mv?.tmdbId) {
 setTgImdbId(String(mv.tmdbId));
 const { genres, rating } = await resolveTelegramGenresAndRating(String(mv.tmdbId), mv.title || release.title || "");
 if (genres.length > 0) setTgGenres(genres.join(", "));
 if (rating) setTgRating(rating);
 } else {
 if (mv?.category) setTgGenres(mv.category);
 if (mv?.rating) setTgRating(String(mv.rating));
 }
 } else if (cType === "animesalt") {
 setTgDubType("official");
 }
 };

 // ==================== RENDER HELPERS ====================
 const inputClass = "w-full px-3.5 py-2.5 bg-[#141422] border border-white/8 rounded-lg text-white text-sm focus:border-indigo-500 focus:outline-none transition-colors placeholder:text-zinc-500";
 const selectClass = inputClass + " cursor-pointer";
 const btnPrimary = "bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-lg transition-colors cursor-pointer border-none px-4 py-3 min-h-[44px] inline-flex items-center justify-center";
 const btnSecondary = "bg-[#1E1E32] border border-white/8 text-white rounded-lg hover:bg-[#252540] transition-colors cursor-pointer";
 const glassCard = "bg-[#16162A] border border-white/6 rounded-xl";

 const menuItems: { section: Section; icon: React.ReactNode; label: string; group?: string }[] = [
 { section: "dashboard", icon: <LayoutDashboard size={16} />, label: "Dashboard" },
 { section: "categories", icon: <FolderOpen size={16} />, label: "Categories" },
 { section: "webseries", icon: <Film size={16} />, label: "Web Series" },
 { section: "weekly-episode", icon: <CalendarDays size={16} />, label: "Weekly Episode" },
 { section: "movies", icon: <Video size={16} />, label: "Movies" },
 { section: "users", icon: <Users size={16} />, label: "Users" },
 { section: "comments", icon: <MessageCircle size={16} />, label: "Comments", group: "New Features" },
 { section: "live-support", icon: <MessageCircle size={16} />, label: "Live Support" },
 { section: "new-releases", icon: <Zap size={16} />, label: "New Releases" },
 { section: "add-content", icon: <PlusCircle size={16} />, label: "Add Content", group: "Quick Actions" },
 { section: "animesalt-manager", icon: <CloudDownload size={16} />, label: "AnimeSalt" },
 { section: "tmdb-fetch", icon: <CloudDownload size={16} />, label: "TMDB Fetch" },
 { section: "redeem-codes", icon: <Shield size={16} />, label: "Redeem Codes" },
 { section: "bkash-payments", icon: <KeyRound size={16} />, label: "bKash Payments" },
 { section: "device-limits", icon: <Lock size={16} />, label: "Device Limits" },
 { section: "telegram-post", icon: <Send size={16} />, label: "Telegram Post", group: "Sharing" },
 { section: "tg-url-changer", icon: <RefreshCw size={16} />, label: "TG URL Changer" },
 { section: "free-access", icon: <Eye size={16} />, label: "Free Access", group: "Tracking" },
 
 { section: "analytics", icon: <BarChart3 size={16} />, label: "Analytics & Views" },
 { section: "maintenance", icon: <Power size={16} />, label: "Maintenance", group: "Server" },
 { section: "edge-router", icon: <Activity size={16} />, label: "Edge Router" },
 { section: "email-service", icon: <Mail size={16} />, label: "Email Service" },
 
 { section: "egd-manager", icon: <Bot size={16} />, label: "EGD MANAGER" },
 { section: "adsterra", icon: <Activity size={16} />, label: "Adsterra Ads" },
 { section: "backdrop-ai", icon: <Activity size={16} />, label: "Backdrop AI" },
 { section: "apk-dw", icon: <Download size={16} />, label: "APK DW" },
 { section: "fb-cleanup", icon: <Database size={16} />, label: "FB Add" },
 { section: "ai-config", icon: <MessageCircle size={16} />, label: "AI Config" },
 { section: "branding", icon: <Edit size={16} />, label: "UI+AD Branding" },
 { section: "live-tv", icon: <Activity size={16} />, label: "Live TV" },
 { section: "url-changer", icon: <Link size={16} />, label: "URL Changer" },
 { section: "link-checker", icon: <Search size={16} />, label: "Link Checker" },
 { section: "video-servers", icon: <Activity size={16} />, label: "Video Servers" },
 { section: "ui-themes", icon: <Zap size={16} />, label: "UI Themes", group: "Customization" },
 { section: "hero-pinned", icon: <Star size={16} />, label: "Hero Pinned" },
 { section: "settings", icon: <Settings size={16} />, label: "Settings" },
 { section: "security-center", icon: <Shield size={16} />, label: "Security & Access", group: "Security" },
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
 <div className="w-14 h-14 bg-indigo-600 rounded-2xl flex items-center justify-center text-2xl font-black mx-auto mb-4"></div>
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
 {adminBranding.logoUrl ? (
 <CachedImg src={adminBranding.logoUrl} alt={adminBranding.siteName || "Logo"} className="w-14 h-14 rounded-2xl object-cover mx-auto mb-4 ring-1 ring-white/10" loading="lazy" decoding="async" />
 ) : (
 <div className="w-14 h-14 bg-indigo-600 rounded-2xl flex items-center justify-center text-2xl font-black mx-auto mb-4">{(adminBranding.siteName || "A").charAt(0)}</div>
 )}
  <h1 className="text-xl font-bold text-white">Admin Login</h1>
  <p className="text-sm text-zinc-400 mt-1">{adminBranding.adminTitle || "Admin Panel"}</p>
  </div>
   {(() => {
     const googleVerified = (() => { try { return !!localStorage.getItem("rs_admin_google"); } catch { return false; } })();
     const verifiedName = (() => { try { return localStorage.getItem("rs_admin_google_name") || localStorage.getItem("rs_admin_google") || ""; } catch { return ""; } })();
     return (
   <div className="space-y-4">
     {googleVerified && (
       <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
         <div className="flex items-center gap-2 min-w-0">
           <Shield size={14} className="text-emerald-400 shrink-0" />
           <span className="text-[11px] text-emerald-300 truncate">Device verified · {verifiedName}</span>
         </div>
         <button
           type="button"
           onClick={() => { try { localStorage.removeItem("rs_admin_google"); localStorage.removeItem("rs_admin_google_name"); } catch {} ; window.location.reload(); }}
           className="text-[10px] text-zinc-400 hover:text-white underline">Reset</button>
       </div>
     )}
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
   Sign in with Google (optional)
   </button>

   <p className="text-[10px] text-zinc-600 text-center mt-2">
   🔒 PIN login is enabled by default. Google sign-in is optional.
   </p>
   </div>
     );
   })()}
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

 {/* Push progress overlay removed — FCM disabled site-wide */}

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
 {adminBranding.logoUrl ? (
 <CachedImg src={adminBranding.logoUrl} alt={adminBranding.siteName || "Logo"} className="w-10 h-10 rounded-xl object-cover ring-1 ring-white/10" loading="lazy" decoding="async" />
 ) : (
 <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-lg font-black">{(adminBranding.siteName || "A").charAt(0)}</div>
 )}
 <div>
 <h2 className="text-base font-bold text-white">Admin Panel</h2>
 <p className="text-[10px] text-zinc-500">{adminBranding.siteName}</p>
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
 <span className="text-xl font-black text-indigo-500"></span>
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
 <main className="pt-[64px] px-3 pb-[220px] min-h-screen">
 {/* ==================== DASHBOARD ==================== */}
 {activeSection === "dashboard" && (
 <div>
 {/* Quick action: Telegram Post (replaces removed FCM notification bell) */}
 <button
 onClick={() => showSection("telegram-post")}
 className="w-full mb-3 p-3 rounded-xl bg-gradient-to-r from-blue-600/20 to-cyan-600/20 border border-blue-500/40 flex items-center gap-3 hover:from-blue-600/30 hover:to-cyan-600/30 transition-all"
 >
 <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center text-blue-300">
 <Send size={18} />
 </div>
 <div className="flex-1 text-left">
 <p className="text-[13px] font-bold text-white">Telegram Post</p>
 <p className="text-[10.5px] text-zinc-400">Quick post to your channel</p>
 </div>
 <ChevronRight size={16} className="text-blue-300" />
 </button>

 <div className="grid grid-cols-2 gap-2.5 mb-4">
 {[
 { icon: <Film size={18} />, value: Math.max(adminFastCounts.webseries, webseriesData.length), label: "Web Series", color: "text-indigo-400" },
 { icon: <Video size={18} />, value: Math.max(adminFastCounts.movies, moviesData.length), label: "Movies", color: "text-emerald-400" },
 { icon: <FolderOpen size={18} />, value: totalCategories, label: "Categories", color: "text-amber-400" },
 { icon: <Users size={18} />, value: Math.max(adminFastCounts.users, usersData.length), label: "Total Users", color: "text-sky-400" },
 ].map((stat, i) => (
 <div key={i} className="bg-[#141422] border border-white/5 rounded-xl p-4">
 <div className={`w-9 h-9 bg-white/5 rounded-lg flex items-center justify-center mb-2.5 ${stat.color}`}>{stat.icon}</div>
 <div className="text-2xl font-bold text-white">{stat.value}</div>
 <div className="text-[11px] text-zinc-500 mt-0.5">{stat.label}</div>
 </div>
 ))}
 </div>

 {/* Weekly Episode preview (between Series stats and Telegram quick action area) */}
 <div className={`${glassCard} p-4 mb-3 relative overflow-hidden`}>
 <div className="absolute -top-10 -right-10 w-32 h-32 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
 <div className="relative">
 <div className="flex items-center justify-between mb-3">
 <div className="flex items-center gap-2">
 <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/30">
 <CalendarDays size={16} className="text-white" />
 </div>
 <div>
 <h3 className="text-sm font-bold text-white">Weekly Episode</h3>
 <p className="text-[10.5px] text-zinc-400">Today ({todayDayName}) — {todayScheduled.length} scheduled</p>
 </div>
 </div>
 <button onClick={() => showSection("weekly-episode")}
 className="text-[11px] font-semibold text-indigo-300 bg-indigo-500/15 border border-indigo-500/30 px-2.5 py-1.5 rounded-lg flex items-center gap-1 hover:bg-indigo-500/25 transition">
 Manage <ChevronRight size={12} />
 </button>
 </div>

 {todayScheduled.length === 0 ? (
 <button onClick={() => showSection("weekly-episode")}
 className="w-full text-[12px] text-zinc-400 bg-[#141422] border border-dashed border-white/10 hover:border-indigo-500/40 rounded-lg py-4">
 No anime scheduled for today — tap to add
 </button>
 ) : (
 <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1 pb-1">
 {todayScheduled.slice(0, 8).map((it: any) => (
 <button key={it.seriesId} onClick={() => editSeries(it.seriesId)}
 className="flex-shrink-0 w-[78px] group">
 <CachedImg src={it.poster || ""} className="w-[78px] h-[108px] rounded-lg object-cover border border-white/8 group-hover:border-indigo-500/50 transition"
 onError={e => { (e.target as HTMLImageElement).src = "https://via.placeholder.com/78x108/141422/6366f1?text=N"; }} />
 <p className="text-[10px] text-zinc-300 truncate mt-1">{it.title}</p>
 </button>
 ))}
 </div>
 )}
 </div>
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
 <button
 type="button"
 key={`${item._adminKind}-${item.id || i}`}
 onClick={() => item._adminKind === "movie" ? editMovie(item.id) : editSeries(item.id)}
 className="w-full text-left flex items-center gap-3 p-2.5 bg-black/20 rounded-lg mb-2 border border-transparent hover:border-indigo-500/35 hover:bg-indigo-500/10 active:scale-[0.99] transition-all"
 >
 <CachedImg src={item.poster || ""} alt={item.title || "Recent content"} className="w-10 h-[55px] rounded-md object-cover flex-shrink-0" onError={(e) => { (e.target as HTMLImageElement).src = "https://via.placeholder.com/40x55/141422/6366f1?text=N"; }} />
 <div className="flex-1 min-w-0">
 <p className="text-[13px] font-medium truncate">{item.title || "Untitled"}</p>
 <p className="text-[11px] text-zinc-500">{item._adminKind === "movie" ? "Movie" : "Series"} • {item.year || "N/A"}</p>
 </div>
 <ChevronRight size={14} className="text-zinc-500 flex-shrink-0" />
 </button>
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
 <List size={14} className="text-indigo-400" /> Bulk Anime Category Assignment
 </h3>
 <p className="text-[11px] text-zinc-400 mb-3">Select multiple anime and set their category together.</p>
 <div className="flex gap-2 mb-3">
 <div className="relative flex-1">
 <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
 <input value={catBulkSearch} onChange={e => setCatBulkSearch(e.target.value)}
 className={`${inputClass} pl-9`} placeholder="Search anime..." />
 </div>
 <select value={catBulkCategory} onChange={e => setCatBulkCategory(e.target.value)} className={`${selectClass} w-[140px]`}>
 <option value="">Category</option>
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
 .then(() => { toast.success(`${catBulkSelected.length} anime "${catBulkCategory}" category set done!`); setCatBulkSelected([]); })
 .catch(err => toast.error("Error: " + err.message));
 }} className={`${btnPrimary} w-full py-2.5 text-[12px] mb-3 flex items-center justify-center gap-2`}>
 <Save size={14} /> {catBulkSelected.length} selected → "{catBulkCategory}" Set
 </button>
 )}
 {catBulkSelected.length > 0 && (
 <button onClick={() => setCatBulkSelected([])} className="text-[11px] text-zinc-500 hover:text-zinc-300 mb-2 underline">Clear all selections</button>
 )}
 <div className="max-h-[400px] overflow-y-auto space-y-1.5">
 {(() => {
 const allItems = [...webseriesData.map(w => ({ ...w, _type: "series" })), ...moviesData.map(m => ({ ...m, _type: "movie" }))];
 const filtered = catBulkSearch.trim()
 ? allItems.filter(item => item.title?.toLowerCase().includes(catBulkSearch.toLowerCase()))
 : allItems;
 return filtered.length === 0 ? (
 <p className="text-zinc-500 text-[12px] text-center py-4">No anime found</p>
 ) : filtered.map(item => {
 const isSelected = catBulkSelected.includes(item.id);
 return (
 <div key={item.id} onClick={() => setCatBulkSelected(prev => isSelected ? prev.filter(id => id !== item.id) : [...prev, item.id])}
 className={`flex items-center gap-2.5 p-2 rounded-lg cursor-pointer transition-all ${isSelected ? "bg-indigo-600/20 border border-indigo-500/40" : "bg-[#141422] border border-transparent hover:border-white/10"}`}>
 <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${isSelected ? "bg-indigo-600 border-indigo-500" : "border-zinc-600"}`}>
 {isSelected && <Check size={12} />}
 </div>
 <CachedImg src={item.poster || ""} className="w-8 h-11 rounded object-cover flex-shrink-0 bg-[#1E1E32]"
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
 <button onClick={() => { setSeriesTab("ws-manual"); setSeriesEditId(""); const initialSeasons = [{ name: "Season 1", seasonNumber: 1, episodes: [] }]; const initialMap = { Hindi: initialSeasons }; setSeriesForm(syncSeriesLanguageSummary({ title: "", poster: "", backdrop: "", year: "", rating: "", language: "Hindi", baseLanguage: "Hindi", selectedAdminLanguage: "Hindi", availableLanguages: ["Hindi"], category: "", storyline: "", visibility: "public", dubType: "official", weeklyEnabled: false, weeklyEveryDays: 7, weeklyDaysSinceLast: 0, audioTracks: [] }, initialMap)); setSeriesSeasonsByLanguage(initialMap); setSeasonsData(cloneSeasonList(initialSeasons)); setSeriesCast([]); }} className={`flex-shrink-0 px-4 py-2 rounded-lg text-[13px] font-medium transition-colors ${seriesTab === "ws-manual" ? "bg-emerald-600 text-white" : "bg-[#141422] border border-white/8 text-zinc-400"}`}>
 Manual
 </button>
  <button onClick={() => setSeriesTab("ws-an")} className={`flex-shrink-0 px-4 py-2 rounded-lg text-[13px] font-medium transition-colors ${seriesTab === "ws-an" ? "bg-emerald-600 text-white" : "bg-[#141422] border border-white/8 text-zinc-400"}`}>
  AN Series
  </button>
  {/* Weekly EP feature removed */}
  </div>

  {seriesTab === "ws-an" && (
  <AnSeriesManager glassCard={glassCard} btnPrimary={btnPrimary} btnSecondary={btnSecondary} inputClass={inputClass} onEditSeries={editSeries} onSaved={upsertAdminContentListItem} />
  )}

 {seriesTab === "ws-list" && (
 <div>
 {/* Search bar — pinned to the very top of the admin viewport */}
 <div className="sticky top-0 z-40 -mx-3 px-3 py-2 mb-3 bg-[#0D0D1A]/95 backdrop-blur-md border-b border-white/5">
 <div className="relative">
 <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-purple-500" />
 <input value={wsListSearch} onChange={e => setWsListSearch(e.target.value)}
 className={`${inputClass} pl-9`} placeholder="Search series" />
 </div>
 </div>
 {(() => {
 // Latest-first ordering (newest createdAt/updatedAt at top)
 const latestFirst = [...webseriesData].sort((a: any, b: any) => {
 const ta = Number(a?.updatedAt || a?.createdAt || 0);
 const tb = Number(b?.updatedAt || b?.createdAt || 0);
 return tb - ta;
 });
 const q = wsListSearch.trim().toLowerCase();
 let filtered = latestFirst;
 if (q) {
 // 50%-similarity fuzzy match (bigram Dice coefficient) + substring fast path
 const bigrams = (s: string) => {
 const out = new Set<string>();
 for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
 return out;
 };
 const qb = bigrams(q);
 const similarity = (title: string) => {
 const t = title.toLowerCase();
 if (!t) return 0;
 if (t.includes(q)) return 1;
 if (q.length < 2 || t.length < 2) return 0;
 const tb = bigrams(t);
 let inter = 0;
 qb.forEach(g => { if (tb.has(g)) inter++; });
 return (2 * inter) / (qb.size + tb.size);
 };
 filtered = latestFirst
 .map((item: any) => ({ item, score: similarity(item.title || "") }))
 .filter(x => x.score >= 0.5)
 .sort((a, b) => b.score - a.score)
 .map(x => x.item);
 }
 return filtered.length === 0 ? (
 <p className="text-[#957DAD] text-[13px] text-center py-8">{q ? "No matching series" : "No web series yet"}</p>
 ) : filtered.map(item => (
 <div key={item.id} className="bg-[#1A1A2E] border border-white/5 rounded-[14px] p-3.5 mb-3 hover:border-purple-500/30 transition-all">
 <div className="flex gap-3.5">
 <CachedImg src={item.poster || ""} className="w-20 h-[115px] rounded-[10px] object-cover flex-shrink-0"
 onError={e => { (e.target as HTMLImageElement).src = "https://via.placeholder.com/80x115/1A1A2E/9D4EDD?text=N"; }} />
 <div className="flex-1 min-w-0">
 <h4 className="text-sm font-semibold mb-1 truncate">{item.title || "Untitled"}</h4>
 <p className="text-[11px] text-[#D1C4E9] mb-2">{item.year || "N/A"} • {item.rating || "N/A"}⭐ • {item.language || "N/A"}</p>
 <div className="flex items-center gap-2 flex-wrap">
 <p className="text-[11px] text-[#D1C4E9]">{item.seasonCount ?? item.seasons?.length ?? 0} Seasons • {item.episodeCount ? `${item.episodeCount} Episodes • ` : ""}{item.category || "Uncategorized"}</p>
 </div>
 <div className="flex flex-wrap gap-2 mt-2.5">
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

 {/* Weekly EP manager removed */}

 {(seriesTab === "ws-add" || seriesTab === "ws-manual") && (
 <div>
 {seriesTab === "ws-add" && (
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
 <CachedImg src={item.poster_path ? TMDB_IMG_BASE + "w342" + item.poster_path : ""} className="w-full aspect-[2/3] object-cover"
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
 )}

 {seriesForm && (
 <>
 {seriesForm.backdrop && (
 <div className="relative rounded-[14px] overflow-hidden mb-5">
 <CachedImg src={seriesForm.backdrop || seriesForm.poster} className="w-full aspect-video object-cover" loading="lazy" decoding="async" />
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
 <div className="flex gap-2">
 <input value={seriesForm[field] || ""} onChange={e => setSeriesForm({ ...seriesForm, [field]: e.target.value })}
 className={`${inputClass} flex-1`} placeholder={`${field}...`} />
 {(field === "poster" || field === "backdrop") && (
 <label className={`${btnSecondary} !px-3 cursor-pointer flex items-center gap-1`}>
 <Image size={14} />
 <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
 const file = e.target.files?.[0];
 if (!file) return;
 try {
 toast.info("Uploading...");
 const { uploadToImgbb } = await import("@/lib/imgbbUpload");
 const url = await uploadToImgbb(file);
 setSeriesForm(f => ({ ...f, [field]: url }));
 toast.success(`${field} uploaded!`);
 } catch { toast.error("Upload failed"); }
 }} />
 </label>
 )}
 </div>
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
 <label className="block text-xs text-[#D1C4E9] mb-2 font-medium flex items-center justify-between">
 <span>Language</span>
 <span className="text-[10px] text-cyan-300/80 font-normal">Episode links below show only this language</span>
 </label>
 <select
 value={seriesForm.selectedAdminLanguage || seriesForm.language || "Hindi"}
 onChange={e => ensureSeriesLanguageTab(e.target.value)}
 className={selectClass}
 >
 {Array.from(new Set([
 ...languageOptions,
 ...(seriesForm.availableLanguages || []),
 seriesForm.baseLanguage,
 seriesForm.language,
 ])).filter(Boolean).map((lang: string) => (
 <option key={lang} value={lang}>{lang}</option>
 ))}
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
 <label className="block text-xs text-[#D1C4E9] mb-2 font-medium">Dub Type</label>
 <div className="flex gap-2">
 <button type="button" onClick={() => setSeriesForm({ ...seriesForm, dubType: "official" })}
 className={`flex-1 py-2.5 rounded-lg text-[12px] font-semibold border transition-all ${(seriesForm.dubType || "official") === "official" ? "bg-indigo-600 border-indigo-500 text-white" : "bg-[#141422] border-white/8 text-zinc-400"}`}>
 Official Dub
 </button>
 <button type="button" onClick={() => setSeriesForm({ ...seriesForm, dubType: "fandub" })}
 className={`flex-1 py-2.5 rounded-lg text-[12px] font-semibold border transition-all ${seriesForm.dubType === "fandub" ? "bg-orange-600 border-orange-500 text-white" : "bg-[#141422] border-white/8 text-zinc-400"}`}>
 Fandub
 </button>
 </div>
 </div>
 <div className="mb-4">
 <label className="block text-xs text-[#D1C4E9] mb-2 font-medium">Storyline</label>
 <textarea value={seriesForm.storyline || ""} onChange={e => setSeriesForm({ ...seriesForm, storyline: e.target.value })}
 className={`${inputClass} min-h-[100px] resize-y`} placeholder="Storyline" />
 </div>
 {/* Weekly EP tracking removed */}

 {/* Per-series Telegram Custom Button moved to Telegram Post section */}
 {seriesCast.length > 0 && (
 <div className="mb-4">
 <label className="block text-xs text-[#D1C4E9] mb-2 font-medium">Cast (Auto-fetched)</label>
 <div className="flex gap-3 overflow-x-auto pb-2.5 scrollbar-hide">
 {seriesCast.map((c, i) => (
 <div key={i} className="flex-shrink-0 w-[70px] text-center">
 <CachedImg src={c.photo || ""} className="w-[60px] h-[60px] rounded-[10px] object-cover mb-1.5 mx-auto"
 onError={e => { (e.target as HTMLImageElement).src = "https://via.placeholder.com/60x60/1A1A2E/9D4EDD?text=N"; }} />
 <p className="text-[10px] font-medium truncate">{c.name}</p>
 </div>
 ))}
 </div>
 </div>
 )}
 </div>

 <div id="seasons-episodes-section" className={`${glassCard} p-4 mb-4 scroll-mt-4`}>
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
 {(Array.isArray(seasonsData) ? seasonsData : []).map((rawSeason, sIdx) => {
 const season = { ...(rawSeason as any), episodes: Array.isArray((rawSeason as any)?.episodes) ? (rawSeason as any).episodes : [] } as Season;
 return (
 <div key={sIdx} className="bg-black/30 rounded-xl p-3.5 mb-3 border border-white/5">
 <div className="flex items-center gap-2.5 mb-3">
 <input value={season.name} onChange={e => updateSeasonName(sIdx, e.target.value)} className={`${inputClass} flex-1`} />
 <button onClick={() => removeSeason(sIdx)} className="bg-red-500/20 text-pink-500 p-2.5 rounded-lg"><Trash2 size={14} /></button>
 </div>
 <div className="mb-2.5 flex justify-between items-center">
  <span className="text-xs text-[#D1C4E9]">Episodes: {(Array.isArray(season.episodes) ? season.episodes : []).length}</span>
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
 placeholder='{ "episodes": [...] } or [{ "episodeNumber": 1, "link": "..." }]'
 className="w-full bg-black/30 border border-white/5 rounded-lg px-2.5 py-2 text-[10px] text-white placeholder:text-green-400/30 focus:border-green-500/50 focus:outline-none min-h-[70px] resize-none font-mono mb-2"
 />
 <div className="flex gap-2">
 <button onClick={() => {
 if (!wsSeasonPasteText.trim()) { toast.error('Paste JSON text'); return; }
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
 {/* Quick Add Episode (TOP) — fast workflow: add new ep without scrolling */}
 <button onClick={() => addEpisode(sIdx)}
 className="w-full mb-3 py-3 rounded-lg text-[12px] font-bold bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white flex items-center justify-center gap-1.5 shadow-lg shadow-indigo-500/20">
 <Plus size={13} /> Add Episode {(season.episodes?.length || 0) + 1} (Quick)
 </button>
  {(Array.isArray(season.episodes) ? season.episodes : []).length > 0 && (
 <p className="text-[10px] text-zinc-500 mb-2 px-1">
  Showing newest first • {(Array.isArray(season.episodes) ? season.episodes : []).length} episode{(Array.isArray(season.episodes) ? season.episodes : []).length === 1 ? "" : "s"}
 </p>
 )}
  {(Array.isArray(season.episodes) ? season.episodes : [])
 .map((ep, eIdx) => ({ ep, eIdx }))
 .slice()
 .reverse()
 .map(({ ep, eIdx }) => {
 const selectedAdminLanguage = normalizeLanguageValue(seriesForm?.selectedAdminLanguage || seriesForm?.baseLanguage || seriesForm?.language || "Hindi");
 const baseLanguage = normalizeLanguageValue(seriesForm?.baseLanguage || seriesForm?.language || "Hindi");
  const isAnSeries = !!(seriesForm?.anSlug || seriesForm?.animeSaltSlug || /animesalt/i.test(String(seriesForm?.sourceName || "")));
  const episodeAudioTracks = Array.isArray((ep as any).audioTracks) ? ((ep as any).audioTracks as any[]) : [];
   const explicitDefaultAudioIdx = episodeAudioTracks.findIndex((track: any) => track?.isDefault === true);
   const resolvedDefaultAudioIdx = explicitDefaultAudioIdx >= 0 ? explicitDefaultAudioIdx : (episodeAudioTracks.length > 0 ? 0 : -1);
   const defaultAudioTrack = resolvedDefaultAudioIdx >= 0 ? episodeAudioTracks[resolvedDefaultAudioIdx] : null;
 const currentLanguageFields = {
 link: ep.link ?? "",
 link480: ep.link480 ?? "",
 link720: ep.link720 ?? "",
 link1080: ep.link1080 ?? "",
 link4k: ep.link4k ?? "",
 };

 return (
 <div key={eIdx} className="mb-3 bg-white/[0.03] px-3 py-3 rounded-lg border border-white/5">
 <div className="flex items-center justify-between mb-2">
 <span className="text-xs font-semibold text-purple-400">Episode {ep.episodeNumber}</span>
 <button onClick={() => removeEpisode(sIdx, eIdx)} className="bg-red-500/20 text-pink-500 p-1.5 rounded-lg hover:bg-red-500/40 transition-all">
 <Trash2 size={12} />
 </button>
 </div>

 {isAnSeries ? (
   // AN entries: ONE video-quality block. AN video URLs are language-agnostic;
   // each language only differs in its audio rendition (handled below).
   // Saved against baseLanguage so the existing loader keeps reading them.
   <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/5 px-2.5 py-2">
   <p className="text-[10px] font-semibold text-indigo-200">Video qualities</p>
   <p className="mt-0.5 text-[9px] text-indigo-100/60">AN video URLs are shared across every language — only audio differs.</p>
   <div className="mt-2 space-y-2.5">
     <div>
       <span className="text-[10px] text-[#D1C4E9] font-medium mb-1 block">Default (1080p)</span>
       <textarea value={ep.link ?? ""} onChange={e => updateSeriesEpisodeLanguageLink(sIdx, eIdx, "link", e.target.value, baseLanguage)}
         className={`${inputClass} w-full !py-2 !text-[10px] min-h-[44px] resize-none break-all`} placeholder="Default video link (fallback when no quality picked)" rows={2} />
     </div>
     {(["link480", "link720", "link1080", "link4k"] as const).map(q => (
       <div key={`an-video-${q}`}>
         <span className="text-[10px] text-[#D1C4E9] font-medium mb-1 block">
           {q === "link480" ? "480p" : q === "link720" ? "720p" : q === "link1080" ? "1080p" : "4K"}
         </span>
         <textarea value={(ep as any)[q] || ""} onChange={e => updateSeriesEpisodeLanguageLink(sIdx, eIdx, q, e.target.value, baseLanguage)}
           className={`${inputClass} w-full !py-2 !text-[10px] min-h-[44px] resize-none break-all`} placeholder={`${q === "link480" ? "480p" : q === "link720" ? "720p" : q === "link1080" ? "1080p" : "4K"} video link${q === "link4k" ? " (optional)" : ""}`} rows={2} />
       </div>
     ))}
   </div>
   </div>
 ) : (
 <div className="rounded-lg border border-cyan-500/15 bg-cyan-500/5 px-2.5 py-2">
 <p className="text-[10px] font-semibold text-cyan-300">Language: {selectedAdminLanguage}</p>
 <p className="mt-0.5 text-[9px] text-cyan-100/60">
 {selectedAdminLanguage.toLowerCase() === baseLanguage.toLowerCase() ? "This is the base language." : "This language has its own separate seasons and episode links."}
 </p>
 {selectedAdminLanguage.toLowerCase() !== baseLanguage.toLowerCase() && !currentLanguageFields.link && !currentLanguageFields.link480 && !currentLanguageFields.link720 && !currentLanguageFields.link1080 && !currentLanguageFields.link4k && (
 <p className="mt-1 text-[9px] text-white/50">No links yet for this language. Add them below.</p>
 )}

 <div className="mt-2 space-y-2.5">
 <div>
 <span className="text-[10px] text-[#D1C4E9] font-medium mb-1 block">Default</span>
 <textarea value={currentLanguageFields.link} onChange={e => updateSeriesEpisodeLanguageLink(sIdx, eIdx, "link", e.target.value, selectedAdminLanguage)}
 className={`${inputClass} w-full !py-2 !text-[10px] min-h-[44px] resize-none break-all`} placeholder="Default link" rows={2} />
 </div>
 {["link480", "link720", "link1080", "link4k"].map(q => (
 <div key={`${selectedAdminLanguage}-${q}`}>
 <span className="text-[10px] text-[#D1C4E9] font-medium mb-1 block">
 {q === "link480" ? "480p" : q === "link720" ? "720p" : q === "link1080" ? "1080p" : "4K"}
 </span>
 <textarea value={(currentLanguageFields as any)[q] || ""} onChange={e => updateSeriesEpisodeLanguageLink(sIdx, eIdx, q, e.target.value, selectedAdminLanguage)}
 className={`${inputClass} w-full !py-2 !text-[10px] min-h-[44px] resize-none break-all`} placeholder={`${q === "link480" ? "480p" : q === "link720" ? "720p" : q === "link1080" ? "1080p" : "4K"} link (optional)`} rows={2} />
 </div>
 ))}
 </div>
 </div>
 )}

  {isAnSeries && (
  <div className="mt-3 rounded-xl border-2 border-amber-500/35 bg-gradient-to-b from-amber-500/10 to-orange-500/5 p-3 shadow-[0_0_18px_rgba(245,158,11,0.08)]">
  <div className="mb-3 flex items-start justify-between gap-2">
  <div>
  <p className="text-[12px] font-black uppercase tracking-wide text-amber-100">🎧 AN AUDIO URL ROOMS</p>
   <p className="text-[9px] leading-relaxed text-amber-100/70">RS নয়: উপরের 480/720/1080 video-only link + নিচের প্রতিটা audio URL একসাথে player এ যাবে। যত audio আছে, তত row/ঘর এখানে থাকবে।</p>
   <p className="mt-1 text-[9px] font-bold text-emerald-200">Saved audio rows: {episodeAudioTracks.length}</p>
  </div>
  <div className="flex flex-col gap-1.5 shrink-0">
  <button type="button" onClick={() => addSeriesEpisodeAudioTrack(sIdx, eIdx)} className="rounded-lg bg-amber-500/20 px-2.5 py-1.5 text-[10px] font-bold text-amber-100 hover:bg-amber-500/30">
  <Plus size={10} className="mr-1 inline" /> Add audio row
  </button>
  <button type="button" onClick={() => { addSeriesEpisodeAudioTrack(sIdx, eIdx); addSeriesEpisodeAudioTrack(sIdx, eIdx); addSeriesEpisodeAudioTrack(sIdx, eIdx); addSeriesEpisodeAudioTrack(sIdx, eIdx); }} className="rounded-lg bg-white/5 px-2.5 py-1.5 text-[9px] font-bold text-zinc-300 hover:bg-white/10">
  +4 empty rooms
  </button>
  </div>
  </div>
   {defaultAudioTrack && (
   <div className="mb-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2.5">
   <div className="mb-2 flex items-center justify-between gap-2">
   <span className="text-[10px] font-bold text-emerald-100">Default audio room: {(defaultAudioTrack as any)?.label || (defaultAudioTrack as any)?.language || `Audio ${resolvedDefaultAudioIdx + 1}`}</span>
   <span className="rounded-md bg-emerald-500/25 px-2 py-0.5 text-[9px] font-black text-emerald-100">DEFAULT</span>
   </div>
   <textarea value={(defaultAudioTrack as any)?.link || (defaultAudioTrack as any)?.audioUrl || (defaultAudioTrack as any)?.rawAudioUrl || ""} onChange={e => updateSeriesEpisodeAudioTrack(sIdx, eIdx, resolvedDefaultAudioIdx, "link", e.target.value)}
   className={`${inputClass} w-full !py-2 !text-[10px] min-h-[54px] resize-none break-all font-mono`} placeholder="Default audio .m3u8 URL" rows={2} />
   </div>
   )}
  <div className="space-y-2.5">
  {(episodeAudioTracks.length > 0 ? episodeAudioTracks : [{ label: "", language: "", link: "", audioUrl: "", rawAudioUrl: "", isDefault: true }]).map((track, tIdx) => {
  const isPlaceholderAudio = episodeAudioTracks.length === 0;
  const isHindi = /hindi|हिन्दी|हिंदी|\bhin\b/i.test(`${(track as any)?.language || ""} ${(track as any)?.label || ""}`);
  const audioValue = (track as any)?.link || (track as any)?.audioUrl || (track as any)?.rawAudioUrl || "";
  return (
  <div key={`an-audio-${tIdx}`} className="rounded-xl border border-amber-300/15 bg-black/35 p-2.5">
  <div className="mb-2 flex items-center justify-between gap-2">
   <span className="text-[10px] font-black text-amber-100">Audio room {tIdx + 1}{isPlaceholderAudio ? " • empty" : tIdx === resolvedDefaultAudioIdx ? " • default" : isHindi ? " • Hindi" : ""}</span>
   <div className="flex items-center gap-1.5">
   {!isPlaceholderAudio && <button type="button" onClick={() => setSeriesEpisodeDefaultAudioTrack(sIdx, eIdx, tIdx)} className={`rounded-md px-2 py-1 text-[9px] font-bold ${tIdx === resolvedDefaultAudioIdx ? "bg-emerald-500/25 text-emerald-100" : "bg-white/5 text-zinc-400 hover:bg-emerald-500/15 hover:text-emerald-200"}`}>Default</button>}
  {!isPlaceholderAudio && <button type="button" onClick={() => removeSeriesEpisodeAudioTrack(sIdx, eIdx, tIdx)} className="rounded-md bg-red-500/15 p-1 text-pink-400 hover:bg-red-500/25"><Trash2 size={10} /></button>}
   </div>
  </div>
  <div className="grid grid-cols-2 gap-2 mb-2">
  <input value={(track as any)?.label || ""} onChange={e => updateSeriesEpisodeAudioTrack(sIdx, eIdx, tIdx, "label", e.target.value)} className={`${inputClass} !py-1.5 !text-[10px]`} placeholder="Audio name: Japanese / Telugu / Tamil / Hindi" />
  <input value={(track as any)?.language || ""} onChange={e => updateSeriesEpisodeAudioTrack(sIdx, eIdx, tIdx, "language", e.target.value)} className={`${inputClass} !py-1.5 !text-[10px]`} placeholder="Language label/code" />
  </div>
  <textarea value={audioValue} onChange={e => updateSeriesEpisodeAudioTrack(sIdx, eIdx, tIdx, "link", e.target.value)}
  className={`${inputClass} w-full !py-2 !text-[10px] min-h-[58px] resize-none break-all font-mono`} placeholder="Paste separate audio-only .m3u8 URL here (not video master)" rows={2} />
  </div>
  );
  })}
  </div>
  </div>
  )}

 </div>
 );
 })}
 </div>
 )}
 </div>
 );
 })}
 </div>

 {/* Inline URL Changer for current series */}
 {seasonsData.length > 0 && (() => {
 const InlineUrlChanger = () => {
 const [inlineOldDomain, setInlineOldDomain] = useState("");
 const [inlineNewDomain, setInlineNewDomain] = useState("");
 const [inlineResult, setInlineResult] = useState<{ total: number; replaced: number } | null>(null);
 const [inlineQP, setInlineQP] = useState("");
 const [showInlineQP, setShowInlineQP] = useState(false);

 const handleInlineQP = () => {
 const t = inlineQP.trim();
 if (!t) { toast.error("link Paste!"); return; }
 try {
 const u = new URL(t.split('\n')[0].trim());
 setInlineOldDomain(`${u.protocol}//${u.host}`);
 toast.success(`✅ domain set: ${u.protocol}//${u.host}`);
 setShowInlineQP(false); setInlineQP("");
 } catch { toast.error("valid URL Paste!"); }
 };

 const replaceInSeasonsData = () => {
 if (!inlineOldDomain.trim() || !inlineNewDomain.trim()) { toast.error("দুটো domainthis দিতে will be!"); return; }
 const old = inlineOldDomain.trim();
 const nw = inlineNewDomain.trim();
 let totalLinks = 0, replacedLinks = 0;

  const updatedSeasons = (Array.isArray(seasonsData) ? seasonsData : []).map(season => ({
 ...season,
  episodes: (Array.isArray((season as any).episodes) ? (season as any).episodes : []).map(ep => {
 const updatedEp = { ...ep } as any;
 ["link", "link480", "link720", "link1080", "link4k"].forEach(field => {
 if (updatedEp[field]) { totalLinks++; if (updatedEp[field].includes(old)) { updatedEp[field] = updatedEp[field].replace(old, nw); replacedLinks++; } }
 });
  if (updatedEp.audioTracks) {
  updatedEp.audioTracks = normalizeAudioTrackList(updatedEp.audioTracks).map((at: any) => {
 const u = { ...at };
 ["link", "link480", "link720", "link1080", "link4k"].forEach(f => { if (u[f]) { totalLinks++; if (u[f].includes(old)) { u[f] = u[f].replace(old, nw); replacedLinks++; } } });
 return u;
 });
 }
 return updatedEp;
 }),
 }));

 setSeasonsData(updatedSeasons);
 setInlineResult({ total: totalLinks, replaced: replacedLinks });
 toast.success(`✅ ${replacedLinks}/${totalLinks} link replaced! (save to do don't forget)`);
 };

 return (
 <div className={`${glassCard} p-4 mb-4`}>
 <h4 className="text-xs font-bold text-white mb-2 flex items-center gap-2"><Link size={12} className="text-cyan-400" /> 🔗 URL Replace</h4>
 <p className="text-[9px] text-zinc-400 mb-3">Replace domains in every link for this series. Saving writes the changes to the database.</p>
 
 {/* Quick Paste */}
 <button onClick={() => setShowInlineQP(!showInlineQP)}
 className="mb-2 text-[10px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1">
 <Download size={10} /> Quick Paste (extract domain from links)
 </button>
 {showInlineQP && (
 <div className="mb-3 bg-black/20 rounded-xl border border-cyan-500/20 p-2.5">
 <textarea value={inlineQP} onChange={e => setInlineQP(e.target.value)}
 placeholder="any video link Paste — domain auto set will be"
 className={`${inputClass} w-full min-h-[50px] resize-none text-[10px] font-mono mb-2`} />
 <button onClick={handleInlineQP} disabled={!inlineQP.trim()}
 className={`${btnPrimary} w-full py-1.5 text-[10px] flex items-center justify-center gap-1 disabled:opacity-30`}>
 <Check size={11} /> domain set 
 </button>
 </div>
 )}

 <div className="grid grid-cols-1 gap-2 mb-3">
 <input value={inlineOldDomain} onChange={e => setInlineOldDomain(e.target.value)} placeholder="old: http://fi3.bot-hosting.net:22854" className={`${inputClass} !text-[10px]`} />
 <input value={inlineNewDomain} onChange={e => setInlineNewDomain(e.target.value)} placeholder="new: https://rahat1102-video-hosting-bot.hf.space" className={`${inputClass} !text-[10px]`} />
 </div>
 <button onClick={replaceInSeasonsData} className={`${btnPrimary} w-full py-2 text-[11px] flex items-center justify-center gap-1.5`}>
 <RefreshCw size={12} /> replace 
 </button>
 {inlineResult && <p className="text-[10px] text-green-400 mt-2">✅ {inlineResult.replaced}/{inlineResult.total} replaced</p>}
 
 {/* Quick Presets */}
 <div className="mt-3 pt-3 border-t border-zinc-700/30">
 <p className="text-[9px] text-zinc-500 mb-2">⚡ Quick Presets</p>
 <div className="grid grid-cols-2 gap-1.5">
 <button onClick={() => { setInlineOldDomain("http://fi3.bot-hosting.net:22854"); setInlineNewDomain("https://rahat1102-video-hosting-bot.hf.space"); }}
 className="text-left p-2 rounded-lg bg-zinc-800/40 border border-zinc-700/40 hover:border-cyan-500/30 transition-all">
 <p className="text-[9px] font-semibold text-white">Bot → HF</p>
 <p className="text-[8px] text-zinc-500">fi3.bot → hf.space</p>
 </button>
 <button onClick={() => { setInlineOldDomain("https://rahat1102-video-hosting-bot.hf.space"); setInlineNewDomain("http://fi3.bot-hosting.net:22854"); }}
 className="text-left p-2 rounded-lg bg-zinc-800/40 border border-zinc-700/40 hover:border-cyan-500/30 transition-all">
 <p className="text-[9px] font-semibold text-white">HF → Bot</p>
 <p className="text-[8px] text-zinc-500">hf.space → fi3.bot</p>
 </button>
 </div>
 </div>
 </div>
 );
 };
 return <InlineUrlChanger />;
 })()}

 {/* Export JSON for current series */}
 {seasonsData.length > 0 && (
 <div className={`${glassCard} p-4 mb-4`}>
 <h4 className="text-xs font-bold text-white mb-2 flex items-center gap-2"><Download size={12} className="text-green-400" /> 📦 Export JSON</h4>
 <p className="text-[9px] text-zinc-400 mb-3">this series all Season and episode JSON download ।</p>
 <button onClick={() => {
 const exportData = {
 title: seriesForm?.title || "Unknown",
  seasons: (Array.isArray(seasonsData) ? seasonsData : []).map(s => ({
 name: s.name,
 seasonNumber: s.seasonNumber,
  episodes: (Array.isArray((s as any).episodes) ? (s as any).episodes : []).map(ep => {
 const epData: any = {
 episodeNumber: ep.episodeNumber,
 title: ep.title,
 link: ep.link,
 };
 if (ep.link480) epData.link480 = ep.link480;
 if (ep.link720) epData.link720 = ep.link720;
 if (ep.link1080) epData.link1080 = ep.link1080;
 if (ep.link4k) epData.link4k = ep.link4k;
 if ((ep as any).qualityLinks) epData.qualityLinks = (ep as any).qualityLinks;
 if ((ep as any).audioTracks?.length) epData.audioTracks = (ep as any).audioTracks;
 if ((ep as any).defaultAudio) epData.defaultAudio = (ep as any).defaultAudio;
 return epData;
 }),
 })),
 };
 const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
 const url = URL.createObjectURL(blob);
 const a = document.createElement("a");
 a.href = url;
 a.download = `${(seriesForm?.title || "series").replace(/[^a-zA-Z0-9]/g, "_")}_export.json`;
 a.click();
 URL.revokeObjectURL(url);
 toast.success("✅ JSON download done!");
 }} className={`${btnPrimary} w-full py-2.5 text-[11px] flex items-center justify-center gap-1.5 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500`}>
 <Download size={12} /> Export JSON
 </button>
 </div>
 )}

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

 // ===== AUTO-DETECT new episode ranges per season =====
 const baseline = wsBaselineRef.current || {};
 const detected: Array<{ seasonIdx: number; seasonName: string; startEp: number; endEp: number }> = [];
 capturedSeasons.forEach((s: any, sIdx: number) => {
 const baseSet = baseline[sIdx] || new Set<number>();
 const currentNums = (s.episodes || [])
 .map((e: any) => Number(e.episodeNumber || 0))
 .filter((n: number) => n > 0)
 .sort((a: number, b: number) => a - b);
 const newNums = currentNums.filter((n: number) => !baseSet.has(n));
 if (newNums.length === 0) return;
 // Group contiguous ranges
 let rangeStart = newNums[0];
 let prev = newNums[0];
 for (let i = 1; i < newNums.length; i++) {
 const cur = newNums[i];
 if (cur === prev + 1) { prev = cur; continue; }
 detected.push({ seasonIdx: sIdx, seasonName: s.name || `Season ${sIdx + 1}`, startEp: rangeStart, endEp: prev });
 rangeStart = cur; prev = cur;
 }
 detected.push({ seasonIdx: sIdx, seasonName: s.name || `Season ${sIdx + 1}`, startEp: rangeStart, endEp: prev });
 });
 setWsAutoRanges(detected);

 // Pre-fill the largest detected range for the modal
 if (detected.length > 0) {
 const biggest = [...detected].sort((a, b) => (b.endEp - b.startEp) - (a.endEp - a.startEp))[0];
 setWsNotifySeason(String(biggest.seasonIdx));
 // Episode dropdown is indexed by array position — find ep with that number
 const epList = capturedSeasons[biggest.seasonIdx]?.episodes || [];
 const startIdx = epList.findIndex((e: any) => Number(e.episodeNumber) === biggest.startEp);
 const endIdx = epList.findIndex((e: any) => Number(e.episodeNumber) === biggest.endEp);
 if (startIdx >= 0) setWsNotifyEpisode(String(startIdx));
 if (endIdx >= 0) setWsNotifyEpisodeEnd(String(endIdx));
 }

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
 <h3 className="text-sm font-bold mb-3 flex items-center gap-2"><Zap size={14} className="text-pink-500" /> Create New Release</h3>
 <p className="text-[11px] text-zinc-400 mb-3">{ctxForm?.title ? `"${ctxForm.title}" — Season and episode Select` : "Season and episode select করে New Release Post"}</p>

 {/* Auto-detected ranges hint (filled by Save+Notify diff) */}
 {wsAutoRanges.length > 0 && (
 <div className="mb-3 p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 space-y-1">
 <p className="text-[10px] font-bold text-emerald-300 uppercase tracking-wider">⚡ Auto-detected new episodes</p>
 {wsAutoRanges.map((r, i) => (
 <p key={i} className="text-[11px] text-emerald-100">
 • <b>{r.seasonName}</b> — EP {r.startEp}{r.endEp !== r.startEp ? `–${r.endEp}` : ''}
 </p>
 ))}
 {wsAutoRanges.length > 1 && (
 <p className="text-[10px] text-emerald-200/80 pt-1">Each range will be sent as a separate notification.</p>
 )}
 </div>
 )}

 <div className="grid grid-cols-3 gap-2 mb-4">
 <div>
 <label className="block text-xs text-zinc-400 mb-1.5">Season</label>
 <select value={wsNotifySeason} onChange={e => { setWsNotifySeason(e.target.value); setWsNotifyEpisode(""); setWsNotifyEpisodeEnd(""); }} className={selectClass}>
 <option value="">Select</option>
 {ctxSeasons.map((s: any, i: number) => <option key={i} value={String(i)}>{s.name || `Season ${i + 1}`}</option>)}
 </select>
 </div>
 <div>
 <label className="block text-xs text-zinc-400 mb-1.5">EP Start</label>
 <select value={wsNotifyEpisode} onChange={e => setWsNotifyEpisode(e.target.value)} className={selectClass}>
 <option value="">Select</option>
 {wsNotifySeason !== "" && ctxSeasons[parseInt(wsNotifySeason)]?.episodes?.map((ep: any, i: number) => (
 <option key={i} value={String(i)}>EP {ep.episodeNumber || i + 1}</option>
 ))}
 </select>
 </div>
 <div>
 <label className="block text-xs text-zinc-400 mb-1.5">EP End</label>
 <select value={wsNotifyEpisodeEnd} onChange={e => setWsNotifyEpisodeEnd(e.target.value)} className={selectClass}>
 <option value="">Same</option>
 {wsNotifySeason !== "" && ctxSeasons[parseInt(wsNotifySeason)]?.episodes?.map((ep: any, i: number) => (
 <option key={i} value={String(i)}>EP {ep.episodeNumber || i + 1}</option>
 ))}
 </select>
 </div>
 </div>
 <button onClick={async () => {
 if (wsNotifySeason === "" || wsNotifyEpisode === "") { toast.error("Season and episode Select"); return; }
 if (!ctxSeriesId || !ctxForm?.title) { toast.error("series context পা যায়নি"); return; }
 const season = ctxSeasons[parseInt(wsNotifySeason)];
 const episode = season?.episodes?.[parseInt(wsNotifyEpisode)];
 const episodeEnd = wsNotifyEpisodeEnd !== "" ? season?.episodes?.[parseInt(wsNotifyEpisodeEnd)] : null;

 // Build the list of ranges to publish.
 // - If wsAutoRanges has multiple entries → publish each as separate notification (multi-targeting).
 // - Otherwise just one range from selectors.
 const usingMulti = wsAutoRanges.length > 1;
 const rangesToPublish = usingMulti
 ? wsAutoRanges.map(r => ({
 seasonIdxNum: r.seasonIdx + 1,
 seasonName: r.seasonName,
 startEp: r.startEp,
 endEp: r.endEp,
 }))
 : [{
 seasonIdxNum: parseInt(wsNotifySeason) + 1,
 seasonName: season?.name || `Season ${parseInt(wsNotifySeason) + 1}`,
 startEp: episode?.episodeNumber || parseInt(wsNotifyEpisode) + 1,
 endEp: episodeEnd?.episodeNumber || episode?.episodeNumber || parseInt(wsNotifyEpisode) + 1,
 }];

 try {
 for (const r of rangesToPublish) {
 const newRelease: any = {
 contentId: ctxSeriesId,
 contentType: "webseries",
 title: ctxForm.title,
 poster: ctxForm.poster || "",
 year: ctxForm.year || "N/A",
 rating: ctxForm.rating || "N/A",
 visibility: ctxForm.visibility || "public",
 episodeInfo: {
 seasonNumber: r.seasonIdxNum,
 episodeNumber: r.startEp,
 episodeNumberEnd: r.endEp,
 seasonName: r.seasonName,
 },
 timestamp: Date.now(),
 active: true,
 weeklyEnabled: ctxForm.weeklyEnabled === true,
 weeklyEveryDays: Math.max(1, Number(ctxForm.weeklyEveryDays) || 7),
 };
 await set(push(ref(db, "newEpisodeReleases")), newRelease);
 }
 toast.success(rangesToPublish.length > 1
 ? `✅ ${rangesToPublish.length} new release entries added (multi-range)!`
 : "✅ New Release added!");
 // Clear so a future Save+Notify on the same form starts fresh
 setWsAutoRanges([]);
 // FCM removed — notifications go through Telegram only.
 // Skip straight to telegram step (no in-app push, no FCM).
 // Auto-fill telegram fields
 setTgTitle(ctxForm.title);
 const backdropUrl = ctxForm.backdrop || ctxForm.poster || "";
 setTgPosterUrl(backdropUrl.replace('/original/', '/w1280/').replace('/w780/', '/w1280/'));
 const wsStartEp = String(episode?.episodeNumber || parseInt(wsNotifyEpisode) + 1).padStart(2, '0');
 const wsEndEp = String(episodeEnd?.episodeNumber || episode?.episodeNumber || parseInt(wsNotifyEpisode) + 1).padStart(2, '0');
 setTgSeason(String(parseInt(wsNotifySeason) + 1).padStart(2, '0'));
 setTgNewEpAdded(wsEndEp !== wsStartEp ? `${wsStartEp}-${wsEndEp}` : wsStartEp);
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
 if (ctxForm.language) setTgLanguages(String(ctxForm.language).replace(/\s*\/\s*/g, ", ").replace(/\s*\|\s*/g, ", "));
 if (ctxForm.category) setTgGenres(ctxForm.category);
 if (ctxForm.rating) setTgRating(String(ctxForm.rating));
 if (ctxForm.tmdbId) {
 try {
 setTgImdbId(String(ctxForm.tmdbId));
 const { genres, rating } = await resolveTelegramGenresAndRating(String(ctxForm.tmdbId), ctxForm.title || "");
 if (genres.length > 0) setTgGenres(genres.join(", "));
 if (rating) setTgRating(rating);
 } catch {}
 }
 // Get quality info
 const quals: string[] = [];
 ctxSeasons.forEach((s: any) => s.episodes?.forEach((ep: any) => {
 if (ep.link480) quals.push("480p");
 if (ep.link720) quals.push("720p");
 if (ep.link1080) quals.push("1080p");
 if (ep.link4k) quals.push("4K");
 }));
 if (quals.length > 0) setTgQuality([...new Set(quals)].join(","));
 setTgButtonLink(buildEpisodeShareUrl(ctxSeriesId, parseInt(wsNotifySeason), parseInt(wsNotifyEpisode)));
 setTgSelectedAnimeId(String(ctxSeriesId));
 // Load any saved per-anime custom buttons
 try {
 const safeId = String(ctxSeriesId).replace(/[^a-zA-Z0-9_-]/g, "_");
 const savedSnap = await get(ref(db, `telegramPerAnimeButtons/${safeId}`));
 const saved = savedSnap.val();
 if (saved && typeof saved === "object") {
 if (typeof saved.defaultButtonName === "string" && saved.defaultButtonName.trim()) setTgDefaultButtonName(saved.defaultButtonName);
 if (Array.isArray(saved.buttons)) setTgButtons(saved.buttons.map((b: any) => ({ name: String(b?.name || ""), url: String(b?.url || "") })));
 else setTgButtons([]);
 } else { setTgButtons([]); }
 } catch {}
 setWsNotifyStep("telegram");
 } catch (err: any) { toast.error("Error: " + err.message); }
 }} className="w-full py-3 rounded-lg text-sm font-bold bg-gradient-to-r from-pink-600 to-purple-600 text-white flex items-center justify-center gap-2">
 <Zap size={14} /> Release + Notify
 </button>
 </div>
 ) : (
 <div>
 <h3 className="text-sm font-bold mb-3 flex items-center gap-2"><Send size={14} className="text-blue-400" /> Telegramে Post</h3>
 <div className="space-y-3">
 <div>
 <label className="block text-xs text-zinc-400 mb-1.5">Channel ID</label>
 <textarea value={tgChannelId} onChange={e => setTgChannelId(e.target.value)} className={`${inputClass} min-h-[50px] resize-y`} placeholder="@channel" rows={2} />
 </div>
 <div>
 <label className="block text-xs text-zinc-400 mb-1.5">Title</label>
 <input value={tgTitle} onChange={e => setTgTitle(e.target.value)} className={inputClass} placeholder="Title" />
 </div>
 <div className="grid grid-cols-2 gap-3">
 <div>
 <label className="block text-xs text-zinc-400 mb-1.5">Season</label>
 <input value={tgSeason} onChange={e => setTgSeason(e.target.value)} className={inputClass} placeholder="01" />
 </div>
 <div>
 <label className="block text-xs text-zinc-400 mb-1.5">New EP</label>
 <input value={tgNewEpAdded} onChange={e => setTgNewEpAdded(e.target.value)} className={inputClass} placeholder="02" />
 </div>
 </div>
 <div>
 <label className="block text-xs text-zinc-400 mb-1.5">Poster URL</label>
 <input value={tgPosterUrl} onChange={e => setTgPosterUrl(e.target.value)} className={inputClass} placeholder="https://..." />
 </div>
 <div className="flex gap-2">
 <button onClick={() => { setWsSaveNotifyModal(false); setWsNotifyStep("release"); setWsNotifySeason(""); setWsNotifyEpisode(""); setWsNotifyEpisodeEnd(""); setWsAutoRanges([]); wsNotifyContextRef.current = null; }} className="flex-1 py-3 rounded-lg text-sm font-bold bg-zinc-700 text-white flex items-center justify-center gap-2">
 <X size={14} /> Cancel
 </button>
 <button onClick={async () => {
 // Step 1: Send the in-app notification first (existing flow already added the release entry)
 // Step 2: Auto-redirect to Telegram Post section with anime preselected
 const ctx = wsNotifyContextRef.current;
 const seriesId = ctx?.seriesId || "";
 toast.success("✅ Notification sent — redirecting to Telegram post...");
 setWsSaveNotifyModal(false);
 setWsNotifyStep("release");
 setWsNotifySeason("");
 setWsNotifyEpisode("");
 setWsNotifyEpisodeEnd("");
 setWsAutoRanges([]);
 wsNotifyContextRef.current = null;
 // Switch section then preselect — find the matching release (most recent for this seriesId)
 setActiveSection("telegram-post");
 setTimeout(() => {
 const matching = releasesData.find(r => r.contentId === seriesId);
 if (matching) {
 fillTelegramFromRelease(matching.id);
 } else if (seriesId) {
 // Fallback: fill directly from webseries data
 const ws = webseriesData.find(s => s.id === seriesId);
 if (ws) {
 setTgSelectedRelease(seriesId);
 setTgTitle(ws.title || "");
 const backdrop = ws.backdrop || ws.poster || "";
 setTgPosterUrl(backdrop.replace('/original/', '/w1280/').replace('/w780/', '/w1280/'));
 if (ws.rating) setTgRating(String(ws.rating));
 if (ws.category) setTgGenres(ws.category);
 if (ws.language) setTgLanguages(String(ws.language).replace(/\s*\/\s*/g, ", ").replace(/\s*\|\s*/g, ", "));
 setTgDubType(ws.dubType === "fandub" ? "fandub" : "official");
 setTgButtonLink(buildEpisodeShareUrl(seriesId));
 setTgSelectedAnimeId(String(seriesId));
 (async () => {
 try {
 const safeId = String(seriesId).replace(/[^a-zA-Z0-9_-]/g, "_");
 const savedSnap = await get(ref(db, `telegramPerAnimeButtons/${safeId}`));
 const saved = savedSnap.val();
 if (saved && typeof saved === "object") {
 if (typeof saved.defaultButtonName === "string" && saved.defaultButtonName.trim()) setTgDefaultButtonName(saved.defaultButtonName);
 if (Array.isArray(saved.buttons)) setTgButtons(saved.buttons.map((b: any) => ({ name: String(b?.name || ""), url: String(b?.url || "") })));
 else setTgButtons([]);
 } else { setTgButtons([]); }
 } catch {}
 })();
 }
 }
 }, 350);
 }} disabled={!tgTitle.trim()} className="flex-1 py-3 rounded-lg text-sm font-bold bg-gradient-to-r from-blue-600 to-indigo-600 text-white flex items-center justify-center gap-2 disabled:opacity-50">
 <Send size={14} /> Go to Post
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
 <button onClick={() => { setMoviesTab("mv-manual"); setMovieEditId(""); setMovieForm({ title: "", poster: "", backdrop: "", year: "", rating: "", language: "Hindi", category: "", storyline: "", visibility: "public", dubType: "official", movieLink: "" }); setMovieCast([]); }} className={`flex-shrink-0 px-4 py-2 rounded-lg text-[13px] font-medium transition-colors ${moviesTab === "mv-manual" ? "bg-emerald-600 text-white" : "bg-[#141422] border border-white/8 text-zinc-400"}`}>
 Manual
 </button>
 <button onClick={() => setMoviesTab("mv-an")} className={`flex-shrink-0 px-4 py-2 rounded-lg text-[13px] font-medium transition-colors ${moviesTab === "mv-an" ? "bg-emerald-600 text-white" : "bg-[#141422] border border-white/8 text-zinc-400"}`}>
 AN Movies
 </button>
 </div>

 {moviesTab === "mv-an" && (
 <AnSeriesManager glassCard={glassCard} btnPrimary={btnPrimary} btnSecondary={btnSecondary} inputClass={inputClass} mode="movie" onEditMovie={editMovie} onSaved={upsertAdminContentListItem} />
 )}

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
 <CachedImg src={item.poster || ""} className="w-20 h-[115px] rounded-[10px] object-cover flex-shrink-0"
 onError={e => { (e.target as HTMLImageElement).src = "https://via.placeholder.com/80x115/1A1A2E/9D4EDD?text=N"; }} />
 <div className="flex-1 min-w-0">
 <h4 className="text-sm font-semibold mb-1 truncate">{item.title || "Untitled"}</h4>
 <p className="text-[11px] text-[#D1C4E9] mb-2">{item.year || "N/A"} • {item.rating || "N/A"}⭐ • {item.language || "N/A"}</p>
 <div className="flex items-center gap-2 flex-wrap">
 <p className="text-[11px] text-[#D1C4E9]">{item.category || "Uncategorized"}</p>
 </div>
 <div className="flex flex-wrap gap-2 mt-2.5">
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

 {(moviesTab === "mv-add" || moviesTab === "mv-manual") && (
 <div>
 {moviesTab === "mv-add" && (
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
 <CachedImg src={item.poster_path ? TMDB_IMG_BASE + "w342" + item.poster_path : ""} className="w-full aspect-[2/3] object-cover"
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
 )}

 {movieForm && (
 <>
 {movieForm.backdrop && (
 <div className="relative rounded-[14px] overflow-hidden mb-5">
 <CachedImg src={movieForm.backdrop || movieForm.poster} className="w-full aspect-video object-cover" loading="lazy" decoding="async" />
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
 <div className="flex gap-2">
 <input value={movieForm[field] || ""} onChange={e => setMovieForm({ ...movieForm, [field]: e.target.value })}
 className={`${inputClass} flex-1`} placeholder={`${field}...`} />
 {(field === "poster" || field === "backdrop") && (
 <label className={`${btnSecondary} !px-3 cursor-pointer flex items-center gap-1`}>
 <Image size={14} />
 <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
 const file = e.target.files?.[0];
 if (!file) return;
 try {
 toast.info("Uploading...");
 const { uploadToImgbb } = await import("@/lib/imgbbUpload");
 const url = await uploadToImgbb(file);
 setMovieForm(f => ({ ...f, [field]: url }));
 toast.success(`${field} uploaded!`);
 } catch { toast.error("Upload failed"); }
 }} />
 </label>
 )}
 </div>
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
 <select value={movieForm.language || "Hindi"} onChange={e => setMovieForm({ ...movieForm, language: e.target.value })} className={selectClass}>
 {languageOptions.map(l => <option key={l} value={l}>{l}</option>)}
 </select>
 </div>
 {(() => { const isAnMovie = !!(movieForm.anSlug || movieForm.animeSaltSlug || /animesalt/i.test(String(movieForm.sourceName || ""))); return (
 <div className={`mb-4 rounded-xl border p-3 ${isAnMovie ? "border-amber-500/20 bg-amber-500/5" : "border-cyan-500/20 bg-cyan-500/5"}`}>
 <div className="flex items-center justify-between mb-2">
 <div>
 <label className={`block text-xs font-medium ${isAnMovie ? "text-amber-200" : "text-cyan-300"}`}>{isAnMovie ? "Audio tracks (per language)" : "Movie Language Links"}</label>
 {isAnMovie && <p className="text-[9px] text-amber-100/60 mt-0.5">One audio URL per language — video stream is shared; player selects audio with decoder-level sync.</p>}
 </div>
 <button type="button" onClick={() => setMovieForm({ ...movieForm, audioTracks: [...(movieForm.audioTracks || []), buildEmptyAudioTrack()] })} className={`text-[10px] hover:opacity-80 flex items-center gap-1 ${isAnMovie ? "text-amber-200" : "text-cyan-300"}`}>
 <Plus size={10} /> Add Language
 </button>
 </div>
 <div className="space-y-2">
 {((movieForm.audioTracks || []) as any[]).map((track, index) => (
 <div key={`movie-audio-${index}`} className="rounded-lg border border-white/10 bg-black/20 p-2.5">
 <div className="flex gap-2 mb-2">
 <input value={track.label || ""} onChange={e => setMovieForm((prev: any) => {
 const next = [...(prev.audioTracks || [])];
 next[index] = { ...next[index], label: e.target.value };
 return { ...prev, audioTracks: next };
 })} className={`${inputClass} flex-1 !py-1.5 !text-[10px]`} placeholder={isAnMovie ? "Label (e.g. Hindi)" : "Label (Hindi dub)"} />
 <input value={track.language || ""} onChange={e => setMovieForm((prev: any) => {
 const next = [...(prev.audioTracks || [])];
 next[index] = { ...next[index], language: e.target.value };
 return { ...prev, audioTracks: next };
 })} className={`${inputClass} w-24 !py-1.5 !text-[10px]`} placeholder={isAnMovie ? "hi/ta/te/en" : "Language"} />
 <button type="button" onClick={() => setMovieForm((prev: any) => ({ ...prev, audioTracks: (prev.audioTracks || []).filter((_: any, i: number) => i !== index) }))} className="text-red-400 hover:text-red-300 p-1"><Trash2 size={10} /></button>
 </div>
 <textarea value={track.link || ""} onChange={e => setMovieForm((prev: any) => {
 const next = [...(prev.audioTracks || [])];
 next[index] = { ...next[index], link: e.target.value };
 return { ...prev, audioTracks: next };
 })} className={`${inputClass} w-full !py-1.5 !text-[10px] mb-2 ${isAnMovie ? "min-h-[44px] resize-none break-all font-mono" : ""}`} placeholder={isAnMovie ? "Audio HLS URL for this language" : "Default language link"} rows={isAnMovie ? 2 : 1} />
 {!isAnMovie && (
 <div className="grid grid-cols-2 gap-1">
 {[
 ["link480", "480p"],
 ["link720", "720p"],
 ["link1080", "1080p"],
 ["link4k", "4K"],
 ].map(([field, label]) => (
 <input key={field} value={track[field] || ""} onChange={e => setMovieForm((prev: any) => {
 const next = [...(prev.audioTracks || [])];
 next[index] = { ...next[index], [field]: e.target.value };
 return { ...prev, audioTracks: next };
 })} className={`${inputClass} !py-1 !text-[9px]`} placeholder={`${label} link`} />
 ))}
 </div>
 )}
 </div>
 ))}
 </div>
 </div>
  ); })()}
 <div className="mb-4">
 <label className="block text-xs text-[#D1C4E9] mb-2 font-medium">Category</label>
 <select value={movieForm.category || ""} onChange={e => setMovieForm({ ...movieForm, category: e.target.value })} className={selectClass}>
 <option value="">Select Category</option>
 {categoryList.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
 </select>
 </div>
 <div className="mb-4">
 <label className="block text-xs text-[#D1C4E9] mb-2 font-medium">Dub Type</label>
 <div className="flex gap-2">
 <button type="button" onClick={() => setMovieForm({ ...movieForm, dubType: "official" })}
 className={`flex-1 py-2.5 rounded-lg text-[12px] font-semibold border transition-all ${(movieForm.dubType || "official") === "official" ? "bg-indigo-600 border-indigo-500 text-white" : "bg-[#141422] border-white/8 text-zinc-400"}`}>
 Official Dub
 </button>
 <button type="button" onClick={() => setMovieForm({ ...movieForm, dubType: "fandub" })}
 className={`flex-1 py-2.5 rounded-lg text-[12px] font-semibold border transition-all ${movieForm.dubType === "fandub" ? "bg-orange-600 border-orange-500 text-white" : "bg-[#141422] border-white/8 text-zinc-400"}`}>
 Fandub
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
 <CachedImg src={c.photo || ""} className="w-[60px] h-[60px] rounded-[10px] object-cover mb-1.5 mx-auto"
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
 <div className={`${glassCard} p-4 mb-4`}>
 <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
 <Trash2 size={14} className="text-red-400" /> Delete All Guest Users
 </h3>
 <p className="text-[11px] text-[#957DAD] mb-3">
 Real users = those registered in Firebase Auth (Email or Google). Everyone else in the database is a guest and will be removed in one click.
 </p>
 {(() => {
 const guestList = usersData.filter(u => guestUidSet.has(String(u.id)));
 return (
 <>
 <div className="text-xs text-[#D1C4E9] mb-3">
 Guest accounts found: <span className="text-red-400 font-bold">{guestList.length}</span>
 <span className="block text-[10px] text-[#957DAD] mt-1">
 Email & Google sign-ins are protected and will never be deleted.
 </span>
 </div>
 <button
 onClick={async () => {
 if (guestList.length === 0) { toast.info("No guest users to delete"); return; }
 if (!window.confirm(`Delete ${guestList.length} guest user(s)? They will be auto-logged out.`)) return;
 try {
 await Promise.all(guestList.map(u =>
 update(ref(db), {
 [`users/${u.id}`]: null,
 [`deletedAccounts/${u.id}`]: { at: Date.now(), reason: "guest-bulk-delete" },
 })
 ));
 toast.success(`✅ Deleted ${guestList.length} guest user(s)`);
 } catch (e: any) {
 toast.error(`Failed: ${e?.message || "unknown"}`);
 }
 }}
 disabled={guestList.length === 0}
 className="w-full py-2.5 rounded-xl bg-gradient-to-r from-red-600 to-red-500 text-white text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
 >
 <Trash2 size={14} /> Delete All Guest Users ({guestList.length})
 </button>
 </>
 );
 })()}
 </div>

 <div className={`${glassCard} p-4`}>
 <div className="flex justify-between items-center mb-3">
 <h3 className="text-sm font-semibold">All Users ({usersData.length})</h3>
 </div>
 <div className="relative mb-3">
 <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-purple-500" />
 <input
 value={userSearchQuery}
 onChange={e => setUserSearchQuery(e.target.value)}
 className={`${inputClass} pl-9`}
 placeholder="🔍 Search by name, email or UID..."
 />
 </div>
 {(() => {
 const q = debouncedUserSearch.trim();
 const filtered = filteredUsersList;
 if (usersData.length === 0) {
 return <p className="text-[#957DAD] text-[13px] text-center py-5">No users found</p>;
 }
 if (filtered.length === 0) {
 return <p className="text-[#957DAD] text-[13px] text-center py-5">No matching users for "{q}"</p>;
 }
 // Cap rendering when not searching to avoid lag with hundreds of users
 const displayList = q ? filtered : filtered.slice(0, 100);
 return (
 <>
 <p className="text-[11px] text-[#957DAD] mb-2">
 {q
 ? `Showing ${filtered.length} match${filtered.length === 1 ? "" : "es"} for "${q}"`
 : `Showing first ${displayList.length} of ${usersData.length} (search to find more)`}
 </p>
 {displayList.map(user => (
 <div key={user.id} className="bg-[#1A1A2E] rounded-xl p-3.5 flex items-center gap-3 mb-2.5 border border-white/5">
 <div className="w-[45px] h-[45px] rounded-full bg-gradient-to-br from-purple-500 to-purple-800 flex items-center justify-center font-bold text-lg flex-shrink-0">
 {(user.name || user.email || "U")[0].toUpperCase()}
 </div>
 <div className="flex-1 min-w-0">
 <p className="text-sm font-semibold truncate">{user.name || "Anonymous"}</p>
 <p className="text-[11px] text-[#D1C4E9] truncate">{user.email || user.id}</p>
 <p className="text-[9px] text-[#957DAD] truncate font-mono">{user.id}</p>
 </div>
 {guestUidSet.has(String(user.id)) && (
 <span className="text-[9px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded font-bold flex-shrink-0">GUEST</span>
 )}
 <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${user.online ? "bg-green-500 animate-pulse" : "bg-red-500"}`} />
 <button
 onClick={async () => {
 if (!user.email) { toast.error("User has no email — can't grant admin"); return; }
 try {
 const snap = await get(ref(db, "admin/authorizedEmails"));
 const cur = snap.val() || {};
 const isAlready = Object.values(cur).some((e: any) => e === user.email);
 if (isAlready) {
 // Revoke
 const entry = Object.entries(cur).find(([_, v]) => v === user.email);
 if (entry) await remove(ref(db, `admin/authorizedEmails/${entry[0]}`));
 await remove(ref(db, `users/${user.id}/coAdmin`));
 toast.success(`🚫 Admin revoked: ${user.email}`);
 } else {
 await set(ref(db, `admin/authorizedEmails/${user.id}`), user.email);
 await set(ref(db, `users/${user.id}/coAdmin`), { enabled: true, grantedAt: Date.now() });
 toast.success(`👑 Admin granted: ${user.email}`);
 }
 } catch (e: any) { toast.error(`Failed: ${e?.message || "unknown"}`); }
 }}
 className="flex-shrink-0 px-2 h-8 rounded-lg bg-yellow-500/15 hover:bg-yellow-500/30 text-yellow-300 text-[10px] font-bold flex items-center gap-1 transition-colors"
 title="Toggle co-admin (Google sign-in to /admin)"
 >
 👑
 </button>
 <button
 onClick={async () => {
 const label = user.email || user.name || user.id;
 if (!window.confirm(`Delete user "${label}"?\n\nThis will remove them from the database and they will be auto-logged out. This action cannot be undone.`)) return;
 try {
 await update(ref(db), {
 [`users/${user.id}`]: null,
 [`deletedAccounts/${user.id}`]: { at: Date.now(), reason: "admin-manual-delete", email: user.email || null, name: user.name || null },
 });
 toast.success(`✅ Deleted user: ${label}`);
 } catch (e: any) {
 toast.error(`Failed: ${e?.message || "unknown"}`);
 }
 }}
 className="flex-shrink-0 w-8 h-8 rounded-lg bg-red-500/15 hover:bg-red-500/30 text-red-400 flex items-center justify-center transition-colors"
 title="Delete user"
 >
 <Trash2 size={14} />
 </button>
 </div>
 ))}
 </>
 );
 })()}
 </div>
 </div>
 )}

 {/* NOTIFICATIONS section fully removed — Telegram posts handle release announcements now */}

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
 <CachedImg src={contentOptions.find(o => o.value === releaseContent)?.poster} alt="" className="w-7 h-10 rounded object-cover flex-shrink-0" />
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
 placeholder="🔍 content search ..."
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
 <p className="text-[#957DAD] text-[11px] text-center py-4">any content পা যায়নি</p>
 ) : filtered.map(o => (
 <div key={o.value} className={`flex items-center gap-2.5 p-2 cursor-pointer hover:bg-purple-500/20 rounded-lg m-1 ${releaseContent === o.value ? "bg-purple-500/30" : ""}`}
 onClick={() => { handleReleaseContentChange(o.value); setReleaseDropdownOpen(false); setReleaseContentSearch(''); }}>
 <CachedImg src={o.poster} alt="" className="w-8 h-11 rounded object-cover flex-shrink-0 bg-[#2A2A3E]" loading="lazy" decoding="async" />
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
 placeholder="🔍 search (Title, episode)..."
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
 <p className="text-[#957DAD] text-[13px] text-center py-5">{releaseSearchQuery ? 'any রিলিজ পা যায়নি' : 'No new releases yet'}</p>
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
 <CachedImg src={release.poster || ""} className="w-[50px] h-[75px] rounded-lg object-cover"
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
 {/* Generate Redeem Code */}
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
 const code = ""+"" + Math.random().toString(36).substring(2, 8).toUpperCase() + "-" + Math.random().toString(36).substring(2, 6).toUpperCase();
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

 {/* ===== Random Prize Link Generator ===== */}
 <RandomPrizeLinkGenerator glassCard={glassCard} inputClass={inputClass} btnPrimary={btnPrimary} />

 {/* All Codes */}
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
 <Settings size={14} className="text-pink-500" /> bKash settings
 </h3>
 <div className="space-y-3">
 <div>
 <label className="text-[11px] text-zinc-400 mb-1 block">bKash name্</label>
 <input value={bkashSettings.phoneNumber || ""} onChange={e => setBkashSettings((p: any) => ({ ...p, phoneNumber: e.target.value }))} className={inputClass} placeholder="01XXXXXXXXX" />
 </div>
 <div>
 <label className="text-[11px] text-zinc-400 mb-1 block">account type</label>
 <select value={bkashSettings.accountType || "Agent"} onChange={e => setBkashSettings((p: any) => ({ ...p, accountType: e.target.value }))} className={selectClass}>
 <option value="Agent">Agent</option>
 <option value="Personal">Personal</option>
 <option value="Merchant">Merchant</option>
 </select>
 </div>
 <div>
 <label className="text-[11px] text-zinc-400 mb-1 block">QR code link (imageর URL)</label>
 <input value={bkashSettings.qrCodeLink || ""} onChange={e => setBkashSettings((p: any) => ({ ...p, qrCodeLink: e.target.value }))} className={inputClass} placeholder="https://example.com/qr.png" />
 </div>
 <div>
 <label className="text-[11px] text-zinc-400 mb-1 block">নির্শNo (userদ for users)</label>
 <textarea value={bkashSettings.instructions || ""} onChange={e => setBkashSettings((p: any) => ({ ...p, instructions: e.target.value }))} className={inputClass + " min-h-[80px] resize-none"} placeholder="Send Money ..." />
 </div>

 {/* Plans */}
 <div>
 <label className="text-[11px] text-zinc-400 mb-2 block font-semibold">subscription plan (3)</label>
 {(bkashSettings.plans || []).map((plan: any, idx: number) => (
 <div key={plan.id || idx} className="bg-[#141422] rounded-lg p-3 mb-2 border border-white/6">
 <div className="grid grid-cols-2 gap-2 mb-2">
 <div>
 <label className="text-[10px] text-zinc-500 block">plan name</label>
 <input value={plan.name} onChange={e => {
 const plans = [...(bkashSettings.plans || [])];
 plans[idx] = { ...plans[idx], name: e.target.value };
 setBkashSettings((p: any) => ({ ...p, plans }));
 }} className={inputClass + " !py-1.5 !text-xs"} />
 </div>
 <div>
 <label className="text-[10px] text-zinc-500 block">price (৳)</label>
 <input type="number" value={plan.price} onChange={e => {
 const plans = [...(bkashSettings.plans || [])];
 plans[idx] = { ...plans[idx], price: Number(e.target.value) };
 setBkashSettings((p: any) => ({ ...p, plans }));
 }} className={inputClass + " !py-1.5 !text-xs"} />
 </div>
 </div>
 <div className="grid grid-cols-3 gap-2">
 <div>
 <label className="text-[10px] text-zinc-500 block">day</label>
 <input type="number" value={plan.days} onChange={e => {
 const plans = [...(bkashSettings.plans || [])];
 plans[idx] = { ...plans[idx], days: Number(e.target.value) };
 setBkashSettings((p: any) => ({ ...p, plans }));
 }} className={inputClass + " !py-1.5 !text-xs"} />
 </div>
 <div>
 <label className="text-[10px] text-zinc-500 block">device</label>
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
 active
 </label>
 </div>
 </div>
 </div>
 ))}
 </div>

 <button onClick={() => {
 set(ref(db, "bkashSettings"), bkashSettings)
 .then(() => toast.success("bKash settings save done"))
 .catch(err => toast.error("Error: " + err.message));
 }} className={`${btnPrimary} w-full py-3.5 flex items-center justify-center gap-2`}>
 <Save size={16} /> settings save 
 </button>
 </div>
 </div>

 {/* Payment Requests */}
 <div className={`${glassCard} p-4`}>
 <h3 className="text-sm font-semibold mb-3.5 flex items-center gap-2">
 <List size={14} className="text-green-500" /> payment request ({bkashPaymentRequests.filter((r: any) => r.status === "pending").length} pending)
 </h3>
 <div className="space-y-2.5">
 {bkashPaymentRequests.length === 0 && <p className="text-center text-zinc-500 text-sm py-6">any payment request none</p>}
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
 <p>💰 plan: {req.planName} — ৳{req.planPrice}</p>
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
 const premiumSnap = await get(ref(db, `users/${req.userId}/premium`));
 const currentPremium = premiumSnap.val() || {};
 const baseExpiry = currentPremium?.active && currentPremium?.expiresAt > Date.now() ? currentPremium.expiresAt : Date.now();
 const expiresAt = baseExpiry + days * 24 * 60 * 60 * 1000;
 await set(ref(db, `users/${req.userId}/premium`), {
 ...currentPremium,
 active: true,
 expiresAt,
 redeemedAt: Date.now(),
 method: "bkash",
 transactionId: req.transactionId,
 maxDevices,
 devices: currentPremium?.devices || {},
 });
 await update(ref(db, `bkashPayments/${req.id}`), { status: "approved", approvedAt: Date.now() });
 // Send in-app notification to user
 const userNotifRef = push(ref(db, `notifications/${req.userId}`));
 await set(userNotifRef, {
 title: "Premium Activated! 🎉",
 message: `your ${req.planName} plan অ্যাক্ভেট done। ${days} day Ad-free enjoy !`,
 type: "success",
 timestamp: Date.now(),
 read: false,
 });
 // FCM push removed — in-app notification (above) is enough
 toast.success(`${req.userName} of premium অ্যাক্ভেট done (${days} day)`);
 }} className="flex-1 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white text-xs font-semibold flex items-center justify-center gap-1 transition-colors">
 <Check size={12} /> Approve
 </button>
 <button onClick={async () => {
 await update(ref(db, `bkashPayments/${req.id}`), { status: "rejected", rejectedAt: Date.now() });
 const userNotifRef = push(ref(db, `notifications/${req.userId}`));
 await set(userNotifRef, {
 title: "Payment Rejected ❌",
 message: "your payment request গ্রহণ not done। valid Transaction ID with again চেষ্ ।",
 type: "error",
 timestamp: Date.now(),
 read: false,
 });
 // FCM push removed — in-app notification (above) is enough
 toast.success("request reject done");
 }} className="flex-1 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-semibold flex items-center justify-center gap-1 transition-colors">
 <X size={12} /> Reject
 </button>
 </div>
 )}
 </div>
 ))}
 </div>
 </div>

 {/* ==================== LIVE SMS FEED (Auto Payment) ==================== */}
 <div className={`${glassCard} p-4 mt-4`}>
 <div className="flex items-center justify-between mb-3.5">
 <h3 className="text-sm font-semibold flex items-center gap-2">
 <span className="relative flex h-2.5 w-2.5">
 <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
 <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
 </span>
 Live SMS Feed (Auto-Match)
 </h3>
 <button
 onClick={async () => {
 const { pruneOldSmsEntries } = await import("@/lib/bkashAutoMatcher");
 const n = await pruneOldSmsEntries(30);
 toast.success(`Pruned ${n} old SMS entries`);
 }}
 className="text-[10px] px-2 py-1 rounded-md bg-white/10 hover:bg-white/20"
 >
 🧹 Prune (30d+)
 </button>
 </div>
 <p className="text-[11px] text-zinc-400 mb-3">
 Android SMS-forwarder app from incoming SMS খানে shows। User TrxID submit করলেthis auto-match will be।
 Total: <span className="text-white font-semibold">{bkashSmsFeed.length}</span> ·
 Consumed: <span className="text-green-400 font-semibold">{bkashSmsFeed.filter((s:any)=>s.consumed).length}</span> ·
 Unmatched: <span className="text-yellow-400 font-semibold">{bkashSmsFeed.filter((s:any)=>!s.consumed).length}</span>
 </p>
 <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
 {bkashSmsFeed.length === 0 && (
 <div className="text-center py-8 text-zinc-500 text-xs">
 <p>📭 any SMS খনো forward not done।</p>
 <p className="mt-1 text-[10px]">Android app phones — install and enable Auto Add Money Service।</p>
 </div>
 )}
 {bkashSmsFeed.slice(0, 50).map((sms: any) => {
 const typeMap: Record<string, { label: string; color: string }> = {
 B: { label: "bKash", color: "bg-pink-500/20 text-pink-300 border-pink-500/40" },
 N: { label: "Nagad", color: "bg-orange-500/20 text-orange-300 border-orange-500/40" },
 R: { label: "Rocket", color: "bg-purple-500/20 text-purple-300 border-purple-500/40" },
 };
 const t = typeMap[sms.type] || { label: sms.type || "Unknown", color: "bg-zinc-500/20 text-zinc-300 border-zinc-500/40" };
 return (
 <div key={sms.txid} className={`p-2.5 rounded-lg border text-[11px] ${
 sms.consumed ? "bg-green-500/5 border-green-500/20 opacity-70" : "bg-white/5 border-white/10"
 }`}>
 <div className="flex items-center gap-2 mb-1.5">
 <span className={`px-1.5 py-0.5 rounded border text-[9px] font-bold ${t.color}`}>{t.label}</span>
 <span className="font-mono font-bold text-white">{sms.txid}</span>
 <span className="ml-auto font-bold text-green-400">৳{sms.amount}</span>
 </div>
 <div className="flex items-center justify-between text-zinc-400">
 <span>📞 {sms.agent || "—"}</span>
 {sms.consumed ? (
 <span className="text-green-400">✅ Matched</span>
 ) : (
 <span className="text-yellow-400">⏳ Awaiting user submit</span>
 )}
 </div>
 </div>
 );
 })}
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
 <div className="pb-52 scroll-mb-52">
 <div className={`${glassCard} relative z-[80] overflow-visible p-4 mb-4`}>
 <h3 className="text-sm font-semibold mb-3.5 flex items-center gap-2">
 <Send size={14} className="text-blue-400" /> Telegram post তৈরি 
 </h3>
 <p className="text-[11px] text-zinc-400 mb-4">
 New Release from Select or manually field fill ।
 </p>
 <div className="mb-4" ref={tgDropdownRef}>
 <label className="block text-xs text-zinc-400 mb-2 font-medium">anime / movie Select (latest update টপে)</label>
 <div className="relative z-[130]">
 <button type="button" onClick={() => setTgDropdownOpen(!tgDropdownOpen)}
 className={`${selectClass} w-full text-left flex items-center gap-2`}>
 {tgSelectedRelease ? (
 <span className="truncate text-sm">{
 webseriesData.find(s => s.id === tgSelectedRelease)?.title
 || moviesData.find(m => m.id === tgSelectedRelease)?.title
 || releasesData.find(r => r.id === tgSelectedRelease)?.title
 || "Selected"
 }</span>
 ) : <span className="text-zinc-500">anime Select...</span>}
 <ChevronDown size={14} className="ml-auto flex-shrink-0" />
 </button>
 {tgDropdownOpen && (() => {
 // Merged list — ALL webseries + movies, sorted by latest update first
 const merged = [
 ...webseriesData.map((s: any) => ({ id: s.id, title: s.title, poster: s.poster, type: "webseries" as const, updatedAt: s.updatedAt || s.createdAt || 0 })),
 ...moviesData.map((m: any) => ({ id: m.id, title: m.title, poster: m.poster, type: "movie" as const, updatedAt: m.updatedAt || m.createdAt || 0 })),
 ].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
 const filtered = merged.filter(r => !tgContentSearch.trim() || (r.title || '').toLowerCase().includes(tgContentSearch.toLowerCase()));
 return (
 <div className="absolute z-[200] top-full left-0 right-0 mt-1 bg-[#16162A] border border-white/10 rounded-xl max-h-[320px] overflow-hidden flex flex-col">
 <div className="p-2 border-b border-white/10 flex-shrink-0">
 <input value={tgContentSearch} onChange={e => setTgContentSearch(e.target.value)}
 className="w-full px-3 py-2 bg-[#141422] border border-white/10 rounded-lg text-white text-[12px] focus:border-blue-500 focus:outline-none placeholder:text-zinc-500"
 placeholder="🔍 search ..." autoFocus onClick={e => e.stopPropagation()} />
 </div>
 <div className="overflow-y-auto max-h-[260px]">
 {filtered.map(r => {
 // Build a synthetic release object so existing fillTelegramFromRelease works.
 const matching = releasesData.find(rel => rel.contentId === r.id);
 return (
 <div key={`${r.type}_${r.id}`} className={`flex items-center gap-2.5 p-2 cursor-pointer hover:bg-blue-500/20 rounded-lg m-1 ${tgSelectedRelease === r.id ? "bg-blue-500/30" : ""}`}
 onClick={async () => {
 if (matching) {
 fillTelegramFromRelease(matching.id);
 } else {
 // Manual fill from webseries/movies data when no release entry exists
 setTgSelectedRelease(r.id);
 setTgTitle(r.title || "");
 const fullData = r.type === "webseries"
 ? webseriesData.find(s => s.id === r.id)
 : moviesData.find(m => m.id === r.id);
 if (fullData) {
 const backdrop = (fullData as any).backdrop || (fullData as any).poster || "";
 setTgPosterUrl(backdrop.replace('/original/', '/w1280/').replace('/w780/', '/w1280/'));
 if ((fullData as any).rating) setTgRating(String((fullData as any).rating));
 if ((fullData as any).category) setTgGenres((fullData as any).category);
 if ((fullData as any).language) setTgLanguages(String((fullData as any).language).replace(/\s*\/\s*/g, ", ").replace(/\s*\|\s*/g, ", "));
 setTgDubType((fullData as any).dubType === "fandub" ? "fandub" : "official");
 setTgButtonLink(buildEpisodeShareUrl(r.id));
 setTgSelectedAnimeId(String(r.id));
 try {
 const safeId = String(r.id).replace(/[^a-zA-Z0-9_-]/g, "_");
 const savedSnap = await get(ref(db, `telegramPerAnimeButtons/${safeId}`));
 const saved = savedSnap.val();
 if (saved && typeof saved === "object") {
 if (typeof saved.defaultButtonName === "string" && saved.defaultButtonName.trim()) setTgDefaultButtonName(saved.defaultButtonName);
 if (Array.isArray(saved.buttons)) setTgButtons(saved.buttons.map((b: any) => ({ name: String(b?.name || ""), url: String(b?.url || "") })));
 else setTgButtons([]);
 } else { setTgButtons([]); }
 } catch {}
 if ((fullData as any).tmdbId) {
 setTgImdbId(String((fullData as any).tmdbId));
 try {
 const { genres, rating } = await resolveTelegramGenresAndRating(String((fullData as any).tmdbId), r.title || "");
 if (genres.length > 0) setTgGenres(genres.join(", "));
 if (rating) setTgRating(rating);
 } catch {}
 }
 }
 }
 setTgDropdownOpen(false); setTgContentSearch('');
 }}>
 <CachedImg src={r.poster} alt="" className="w-8 h-11 rounded object-cover flex-shrink-0 bg-[#1E1E32]" loading="lazy" decoding="async" />
 <div className="flex-1 min-w-0">
 <span className="text-sm truncate block">{r.title}</span>
 <span className="text-[9px] text-zinc-500">{r.type === "webseries" ? "📺 Series" : "🎬 Movie"}{matching ? " • 🆕 New EP" : ""}</span>
 </div>
 </div>
 );
 })}
 {filtered.length === 0 && <p className="text-zinc-500 text-[11px] text-center py-4">No anime found</p>}
 </div>
 </div>
 );
 })()}
 </div>
 </div>
 <div className="space-y-3">
 <div>
 <label className="block text-xs text-zinc-400 mb-1.5">Channel ID (at least া with multiple)</label>
 <textarea value={tgChannelId} onChange={e => setTgChannelId(e.target.value)} onBlur={e => { try { set(ref(db, "admin/telegramChannel"), e.target.value.trim()); } catch {} }} className={`${inputClass} min-h-[60px] resize-y`} placeholder={`${TELEGRAM_CHANNEL}, @channel2, -1001234567890`} rows={2} />
 </div>
 <div>
 <label className="block text-xs text-zinc-400 mb-1.5">Title *</label>
 <input value={tgTitle} onChange={e => setTgTitle(e.target.value)} className={inputClass} placeholder="Anime Title" />
 </div>
 {/* IMDB/TMDB ID for auto genres */}
 <div>
 <label className="block text-xs text-zinc-400 mb-1.5">IMDB/TMDB ID (auto Genres and Rating)</label>
 <div className="flex gap-2">
 <input value={tgImdbId} onChange={e => setTgImdbId(e.target.value)} className={`${inputClass} flex-1`} placeholder="tt12345678 or 12345" />
 <button type="button" onClick={() => fetchTmdbGenres(tgImdbId)} disabled={tgImdbLoading || !tgImdbId.trim()}
 className={`${btnPrimary} !px-3 !py-2 !text-[11px] disabled:opacity-50`}>
 {tgImdbLoading ? <RefreshCw size={12} className="animate-spin" /> : "Fetch"}
 </button>
 </div>
 </div>
 <div className="grid grid-cols-2 gap-3">
 <div>
 <label className="block text-xs text-zinc-400 mb-1.5">Season</label>
 <input value={tgSeason} onChange={e => setTgSeason(e.target.value)} className={inputClass} placeholder="Season 01" />
 </div>
 <div>
 <label className="block text-xs text-zinc-400 mb-1.5">Total episode</label>
 <input value={tgTotalEpisodes} onChange={e => setTgTotalEpisodes(e.target.value)} className={inputClass} placeholder="12" />
 </div>
 </div>
 <div className="grid grid-cols-2 gap-3">
 <div>
 <label className="block text-xs text-zinc-400 mb-1.5">Quality</label>
 <input value={tgQuality} onChange={e => setTgQuality(e.target.value)} className={inputClass} placeholder="480p,720p,1080p,4K" />
 </div>
 <div>
 <label className="block text-xs text-zinc-400 mb-1.5">Rating ⭐</label>
 <input value={tgRating} onChange={e => setTgRating(e.target.value)} className={inputClass} placeholder="8.5" />
 </div>
 </div>
 <div>
 <label className="block text-xs text-zinc-400 mb-1.5">Genres</label>
 <input value={tgGenres} onChange={e => setTgGenres(e.target.value)} className={inputClass} placeholder="Animation, Action & Adventure" />
 </div>
 <div>
 <label className="block text-xs text-zinc-400 mb-1.5">audio Language 🎧</label>
 <input value={tgLanguages} onChange={e => setTgLanguages(e.target.value)} className={inputClass} placeholder="Bengali,English,Hindi,Japanese" />
 </div>
 <div className="grid grid-cols-2 gap-3">
 <div>
 <label className="block text-xs text-zinc-400 mb-1.5">Season number</label>
 <input value={tgSeason} onChange={e => setTgSeason(e.target.value)} className={inputClass} placeholder="01" />
 </div>
 <div>
 <label className="block text-xs text-zinc-400 mb-1.5">new episode number</label>
 <input value={tgNewEpAdded} onChange={e => setTgNewEpAdded(e.target.value)} className={inputClass} placeholder="03" />
 </div>
 </div>
 <div>
 <label className="block text-xs text-zinc-400 mb-1.5">audio type</label>
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
 <div className="flex items-center justify-between mb-1.5">
 <label className="block text-xs text-zinc-400">Status</label>
 <label className="flex items-center gap-1.5 text-[10px] text-zinc-500 cursor-pointer">
 <input type="checkbox" checked={tgStatusAuto} onChange={e => setTgStatusAuto(e.target.checked)} className="accent-emerald-500" />
 Auto (IMDb match)
 </label>
 </div>
 <div className="flex gap-2">
 <button type="button" onClick={() => { setTgStatusAuto(false); setTgStatus("ongoing"); }}
 className={`flex-1 py-2.5 rounded-lg text-[12px] font-semibold border transition-all ${tgStatus === "ongoing" ? "bg-emerald-600 border-emerald-500 text-white" : "bg-[#141422] border-white/8 text-zinc-400"}`}>
 🟢 Oɴɢᴏɪɴɢ
 </button>
 <button type="button" onClick={() => { setTgStatusAuto(false); setTgStatus("complete"); }}
 className={`flex-1 py-2.5 rounded-lg text-[12px] font-semibold border transition-all ${tgStatus === "complete" ? "bg-blue-600 border-blue-500 text-white" : "bg-[#141422] border-white/8 text-zinc-400"}`}>
 ✅ Cᴏᴍᴘʟᴇᴛᴇ
 </button>
 </div>
 {tgStatusAuto && (
 <p className="text-[10px] text-zinc-500 mt-1.5">Auto: {tgNewEpAdded || "?"} / {tgTotalEpisodes || "?"} → <span className={tgStatus === "complete" ? "text-blue-400" : "text-emerald-400"}>{tgStatus}</span></p>
 )}
 </div>
 <div>
 <label className="block text-xs text-zinc-400 mb-1.5">Hashtags</label>
 <input value={tgHashtags} onChange={e => setTgHashtags(e.target.value)} onBlur={() => { try { set(ref(db, "admin/tgHashtags"), tgHashtags); } catch {} }} className={inputClass} placeholder="#anime #official" />
 </div>
 <div>
 <label className="block text-xs text-zinc-400 mb-1.5">Poster URL (optional)</label>
 <input value={tgPosterUrl} onChange={e => setTgPosterUrl(e.target.value)} className={inputClass} placeholder="https://image.tmdb.org/..." />
 </div>
 <div>
 <label className="block text-xs text-zinc-400 mb-1.5">download/চ link (optional)</label>
 <input value={tgButtonLink} onChange={e => setTgButtonLink(e.target.value)} className={inputClass} placeholder={SITE_URL} />
 </div>
 {tgButtonLink && (
 <div>
 <label className="block text-xs text-zinc-400 mb-1.5">default button name</label>
 <input value={tgDefaultButtonName} onChange={e => setTgDefaultButtonName(e.target.value)} className={inputClass} placeholder="📥 𝐖𝐀𝐓𝐂𝐇 𝐀𝐍𝐃 𝐃𝐎𝐖𝐍𝐋𝐎𝐀𝐃 📥" />
 </div>
 )}
 {/* Extra buttons */}
 <div>
 <div className="flex items-center justify-between mb-1.5">
 <label className="block text-xs text-zinc-400 font-medium">extra button (optional)</label>
 <button type="button" onClick={() => setTgButtons([...tgButtons, { name: "", url: "" }])}
 className="text-[11px] text-blue-400 hover:text-blue-300 flex items-center gap-1">
 <Plus size={12} /> button add 
 </button>
 </div>
 {tgButtons.map((btn, i) => (
 <div key={i} className="flex gap-2 mb-2 items-start">
 <div className="flex-1 space-y-1.5">
 <input value={btn.name} onChange={e => { const nb = [...tgButtons]; nb[i].name = e.target.value; setTgButtons(nb); }}
 className={inputClass} placeholder="button name" />
 <input value={btn.url} onChange={e => { const nb = [...tgButtons]; nb[i].url = e.target.value; setTgButtons(nb); }}
 className={inputClass} placeholder="https://..." />
 </div>
 <button type="button" onClick={() => setTgButtons(tgButtons.filter((_, j) => j !== i))}
 className="mt-2 text-red-400 hover:text-red-300 p-1.5"><Trash2 size={14} /></button>
 </div>
 ))}
 </div>
 </div>
 </div>

 {/* Footer Links Management */}
 <div className={`${glassCard} p-4 mb-4`}>
 <div className="flex items-center justify-between mb-3">
 <h3 className="text-sm font-semibold flex items-center gap-2">
 <Link size={14} className="text-purple-400" /> footer link (TG postে shows)
 </h3>
 <button type="button" onClick={() => {
 const newLinks = [...tgFooterLinks, { label: "New Link", url: "https://t.me/", emoji: "🔰" }];
 setTgFooterLinks(newLinks);
 set(ref(db, "admin/tgFooterLinks"), newLinks);
 }} className="text-[11px] text-blue-400 hover:text-blue-300 flex items-center gap-1">
 <Plus size={12} /> link add
 </button>
 </div>
 <div className="space-y-2.5">
 {tgFooterLinks.map((link, i) => (
 <div key={i} className="bg-zinc-800/40 rounded-xl p-3 border border-zinc-700/30">
 <div className="grid grid-cols-[40px_1fr] gap-2 mb-2">
 <div>
 <label className="block text-[9px] text-zinc-500 mb-1">Emoji</label>
 <input value={link.emoji} onChange={e => {
 const nl = [...tgFooterLinks]; nl[i].emoji = e.target.value; setTgFooterLinks(nl);
 }} className={`${inputClass} !text-center`} />
 </div>
 <div>
 <label className="block text-[9px] text-zinc-500 mb-1">label</label>
 <input value={link.label} onChange={e => {
 const nl = [...tgFooterLinks]; nl[i].label = e.target.value; setTgFooterLinks(nl);
 }} className={inputClass} placeholder="Link Label" />
 </div>
 </div>
 <div className="flex gap-2">
 <input value={link.url} onChange={e => {
 const nl = [...tgFooterLinks]; nl[i].url = e.target.value; setTgFooterLinks(nl);
 }} className={`${inputClass} flex-1`} placeholder="https://t.me/..." />
 <button type="button" onClick={() => {
 const nl = tgFooterLinks.filter((_, j) => j !== i);
 setTgFooterLinks(nl);
 set(ref(db, "admin/tgFooterLinks"), nl);
 }} className="text-red-400 hover:text-red-300 p-1.5"><Trash2 size={14} /></button>
 </div>
 </div>
 ))}
 <button type="button" onClick={() => set(ref(db, "admin/tgFooterLinks"), tgFooterLinks)}
 className={`${btnSecondary} w-full !py-2 !text-[11px] flex items-center justify-center gap-1.5`}>
 <Save size={12} /> footer link save 
 </button>
 </div>
 </div>

 {/* Preview */}
 <div className={`${glassCard} p-4 mb-4`}>
 <h3 className="text-sm font-semibold mb-3.5 flex items-center gap-2">
 <Eye size={14} className="text-green-400" /> preview
 </h3>
 <div className="bg-[#0E1621] rounded-xl p-4 border border-white/5">
 {tgPosterUrl && (
 <CachedImg src={tgPosterUrl} alt="poster" className="w-full h-[200px] object-cover rounded-lg mb-3"
 onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
 )}
 <div className="font-mono text-[11px] text-zinc-300 whitespace-pre-line leading-relaxed">
{`♨️ Tɪᴛᴇʟ;- ${tgTitle || '{title}'}
┌──────────────────
│ ✦ Sᴇᴀsᴏɴ : ${tgSeason || '{season}'}
│ ✦ Eᴘɪsᴏᴅᴇs : ${tgTotalEpisodes || '{total}'}
│ ✦ Aᴜᴅɪᴏ : 🎧 ${tgLanguages} ${tgDubType === "fandub" ? "𝐅𝐚𝐧𝐝𝐮𝐛" : "𝐎𝐟𝐟𝐢𝐜𝐢𝐚𝐥"}
│ ✦ Qᴜᴀʟɪᴛʏ : ${tgQuality}
│ ✦ Rᴀᴛɪɴɢ : ⭐ ${tgRating}/10
│ ✦ Gᴇɴʀᴇs : ${tgGenres}
│ ✦ Sᴛᴀᴛᴜs : ${tgStatus === "complete" ? "Cᴏᴍᴘʟᴇᴛᴇ ✅" : "Oɴɢᴏɪɴɢ 🟢"}
└──────────────────
▰▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▰
📌 ${formatEpisodeRangeLabel(tgSeason, ...(String(tgNewEpAdded || '01').split('-').map(v => v.trim()) as [string, string?]))}
▰▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▰`}
{tgFooterLinks.map(l => `\n๏ ${l.emoji} ${l.label} ${l.emoji}\n ${l.url}`).join("")}
{`\n▰▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▰\n${sanitizeTelegramHashtags(tgHashtags, tgTitle)}`}
 </div>
 {tgButtonLink && (
 <div className="mt-3 bg-blue-500/20 border border-blue-500/40 rounded-lg py-2.5 text-center text-[12px] font-bold text-blue-300">
 {tgDefaultButtonName || "📥 𝐖𝐀𝐓𝐂𝐇 𝐀𝐍𝐃 𝐃𝐎𝐖𝐍𝐋𝐎𝐀𝐃 📥"}
 </div>
 )}
 {tgButtons.filter(b => b.name.trim()).map((btn, i) => (
 <div key={i} className="mt-1.5 bg-blue-500/15 border border-blue-500/30 rounded-lg py-2 text-center text-[11px] font-bold text-blue-300">
 {btn.name}
 </div>
 ))}
 </div>
 </div>

 <button onClick={sendTelegramPost} disabled={tgSending || !tgTitle.trim()}
 className={`${btnPrimary} w-full py-4 text-[15px] font-semibold flex items-center justify-center gap-2 disabled:opacity-50`}>
 {tgSending ? (
 <>
 <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
 send in progress...
 </>
 ) : (
 <>
 <Send size={18} /> Telegramে post send
 </>
 )}
 </button>

 {/* ============= BULK CATALOG BROADCAST ============= */}
 {(() => {
 const totalPool = webseriesData.length + moviesData.length;
 const sentCount = Object.keys(tgBulkSentIds).length;
 const remaining = Math.max(0, totalPool - sentCount);
 return (
 <div className={`${glassCard} p-4 mt-5 border border-purple-500/30`}>
 <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
 <Send size={14} className="text-purple-400" /> Bulk Catalog Broadcast
 </h3>
 <p className="text-[11px] text-zinc-400 mb-3">
 Send a random batch from all anime to Telegram with one click। any anime duplicate will be No — প্রতি different postে will go।
 </p>

 <div className="grid grid-cols-3 gap-2 mb-3">
 <div className="bg-white/5 rounded-lg p-2 text-center">
 <div className="text-[10px] text-zinc-400">Total</div>
 <div className="text-base font-bold text-white">{totalPool}</div>
 </div>
 <div className="bg-green-500/10 rounded-lg p-2 text-center">
 <div className="text-[10px] text-green-400">Sent</div>
 <div className="text-base font-bold text-green-400">{sentCount}</div>
 </div>
 <div className="bg-purple-500/10 rounded-lg p-2 text-center">
 <div className="text-[10px] text-purple-400">Remaining</div>
 <div className="text-base font-bold text-purple-400">{remaining}</div>
 </div>
 </div>

 <div className="grid grid-cols-2 gap-2 mb-3">
 <div>
 <label className="block text-[10px] text-zinc-400 mb-1">Batch size (1-50)</label>
 <input type="number" min={1} max={50} value={tgBulkBatchSize}
 onChange={e => setTgBulkBatchSize(Math.max(1, Math.min(50, parseInt(e.target.value) || 20)))}
 className={inputClass} />
 </div>
 <div className="flex items-end">
 <button onClick={resetBulkSentIds} type="button"
 className="w-full py-2 px-3 text-[11px] rounded-lg bg-red-500/15 border border-red-500/30 text-red-400 hover:bg-red-500/25 transition">
 🔄 Reset Sent History
 </button>
 </div>
 </div>

 <div className="mb-2">
 <label className="block text-[10px] text-zinc-400 mb-1">Header (HTML allowed)</label>
 <input value={tgBulkHeader} onChange={e => setTgBulkHeader(e.target.value)} className={inputClass} />
 </div>
 <div className="mb-3">
 <label className="block text-[10px] text-zinc-400 mb-1">Footer</label>
 <input value={tgBulkFooter} onChange={e => setTgBulkFooter(e.target.value)} className={inputClass} />
 </div>

 {tgBulkProgress && (
 <div className="mb-3">
 <div className="flex justify-between text-[10px] text-zinc-400 mb-1">
 <span>Sending…</span>
 <span>{tgBulkProgress.done}/{tgBulkProgress.total}</span>
 </div>
 <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
 <div className="h-full bg-purple-500 transition-all"
 style={{ width: `${(tgBulkProgress.done / Math.max(1, tgBulkProgress.total)) * 100}%` }} />
 </div>
 </div>
 )}

 <button onClick={sendBulkCatalogPost} disabled={tgBulkSending || remaining === 0 || !tgChannelId.trim()}
 className="w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 bg-gradient-to-r from-purple-600 to-pink-600 text-white disabled:opacity-50 hover:opacity-95 transition">
 {tgBulkSending ? (
 <>
 <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
 send in progress...
 </>
 ) : (
 <>
 <Send size={16} /> Send {Math.min(tgBulkBatchSize, remaining)} Random Anime
 </>
 )}
 </button>
 <p className="text-[10px] text-zinc-500 mt-2 text-center">
 Upper "Channel ID" field all channelে send will be। প্রতি title clickable link হিসেবে will go।
 </p>
 </div>
 );
 })()}
 </div>
 )}


 {activeSection === "tg-url-changer" && (() => {
 const TgUrlChanger = () => {
 const [tgPosts, setTgPosts] = useState<any[]>([]);
 const [tgPostsLoading, setTgPostsLoading] = useState(true);
 const [tgOldDomain, setTgOldDomain] = useState("");
 const [tgNewDomain, setTgNewDomain] = useState("");
 const [tgBulkRunning, setTgBulkRunning] = useState(false);
 const [tgBulkResults, setTgBulkResults] = useState<{title:string; poster:string; ok:boolean; error?:string}[]>([]);
 const [tgBulkProgress, setTgBulkProgress] = useState(0);
 const [tgQuickPaste, setTgQuickPaste] = useState("");
 const [tgSelectedPost, setTgSelectedPost] = useState<string>("all");
  const [expandedChannel, setExpandedChannel] = useState<string>("");
 const [channelTargets, setChannelTargets] = useState<Record<string, string>>({});
 const [busyChannel, setBusyChannel] = useState<string>("");
 const [busyProgress, setBusyProgress] = useState<{done:number; total:number; skipped?:number}>({done:0,total:0});
 const cancelRef = useRef(false);

 // === Build FRESH caption from latest series/movie data (mirrors sendTelegramPost template) ===
 const buildFreshCaptionForTitle = (savedTitle: string): { caption: string; poster: string; matched: boolean; titleKey?: string; sourceId?: string; buttonUrl?: string; title?: string } => {
 const norm = normalizeTelegramTitleKey;
 const target = norm(savedTitle);
 const ws = webseriesData.find((s: any) => norm(s.title) === target);
 const mv = !ws ? moviesData.find((m: any) => norm(m.title) === target) : null;
 const item: any = ws || mv;
 if (!item) return { caption: "", poster: "", matched: false };

 const isSeries = !!ws;
 const seasons = Array.isArray(item.seasons) ? item.seasons : [];
 const lastSeasonIdx = isSeries && seasons.length > 0 ? seasons.length - 1 : 0;
 const lastSeason = seasons[lastSeasonIdx];
 const totalEps = isSeries ? (lastSeason?.episodes?.length || 0) : 1;
 const seasonNum = isSeries ? String(lastSeasonIdx + 1).padStart(2, "0") : "01";
 const newEpNum = isSeries && totalEps > 0 ? String(totalEps).padStart(2, "0") : "01";

 const rating = item.rating ? String(item.rating) : "N/A";
 const genres = item.category || item.genres || "Animation";
 const languages = String(item.language || "Bengali, English").replace(/\s*\/\s*/g, ", ").replace(/\s*\|\s*/g, ", ");
 const dubType = item.dubType === "fandub" ? "fandub" : "official";
 const audioBadge = dubType === "fandub" ? "𝐅𝐚𝐧𝐝𝐮𝐛" : "𝐎𝐟𝐟𝐢𝐜𝐢𝐚𝐥";
 const quality = item.quality || "480p,720p,1080p";
 const status = item.status === "complete" ? "complete" : "ongoing";
 const poster = ((item.backdrop || item.poster || "") as string).replace("/original/", "/w1280/").replace("/w780/", "/w1280/");

 const footerLinksHtml = tgFooterLinks.map(l => `๏ ${l.emoji} <a href="${l.url}">${l.label}</a> ${l.emoji}`).join("\n");

 const caption = `♨️ <b>Tɪᴛᴇʟ;-</b> ${item.title}
┌──────────────────
│ ✦ <b>Sᴇᴀsᴏɴ :</b> ${seasonNum}
│ ✦ <b>Eᴘɪsᴏᴅᴇs :</b> ${totalEps || 'N/A'}
│ ✦ <b>Aᴜᴅɪᴏ :</b> 🎧 ${languages} ${audioBadge}
│ ✦ <b>Qᴜᴀʟɪᴛʏ :</b> ${quality}
│ ✦ <b>Rᴀᴛɪɴɢ :</b> ⭐ ${rating}/10
│ ✦ <b>Gᴇɴʀᴇs :</b> ${genres}
│ ✦ <b>Sᴛᴀᴛᴜs :</b> ${status === "complete" ? "Cᴏᴍᴘʟᴇᴛᴇ ✅" : "Oɴɢᴏɪɴɢ 🟢"}
└──────────────────
▰▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▰
📌 ${formatEpisodeRangeLabel(seasonNum, newEpNum)}
▰▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▰
${footerLinksHtml}
▰▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▰
#anime`;

 // Rebuild watch button URL with fresh latest-episode pointer
 const buttonUrl = isSeries
 ? buildEpisodeShareUrl(item.id, lastSeasonIdx, Math.max(0, totalEps - 1))
 : buildEpisodeShareUrl(item.id);
 return { caption, poster, matched: true, buttonUrl, titleKey: norm(item.title), sourceId: String(item.id || ""), title: String(item.title || savedTitle || "") } as any;
 };

 const cancelCurrent = () => {
 cancelRef.current = true;
 toast.info("Cancelling…");
 };

 // Load saved posts
 useEffect(() => {
 const unsub = onValue(ref(db, "telegramPosts"), (snap) => {
 const val = snap.val() || {};
 const arr = Object.entries(val).map(([k, v]: any) => ({ firebaseKey: k, ...v }));
 arr.sort((a: any, b: any) => (b.sentAt || 0) - (a.sentAt || 0));
 setTgPosts(arr);
 setTgPostsLoading(false);
 });
 return () => unsub();
 }, []);

 // Group posts by channel (chatId)
 const channelGroups = useMemo(() => {
 const map = new Map<string, any[]>();
 for (const p of tgPosts) {
 const k = String(p.chatId || "unknown");
 if (!map.has(k)) map.set(k, []);
 map.get(k)!.push(p);
 }
 return Array.from(map.entries()).map(([chatId, posts]) => ({
 chatId,
 posts: posts.sort((a:any,b:any)=>(a.sentAt||0)-(b.sentAt||0)),
 }));
 }, [tgPosts]);

 // Quick paste domain extractor
 const handleQuickPaste = (url: string) => {
 setTgQuickPaste(url);
 try {
 const u = new URL(url);
 setTgOldDomain(u.origin);
 } catch {}
 };

 const callTgApi = async (payload: any) => {
 const endpoint = await getEdgeFunctionUrl('telegram-post');
 const res = await fetch(endpoint, {
 method: 'POST',
 headers: {
 'Content-Type': 'application/json',
 ...(SUPABASE_ANON_KEY ? { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } : {}),
 },
 body: JSON.stringify(payload),
 });
 const data = await res.json().catch(() => ({}));
 return { ok: res.ok && !data?.error, data, status: res.status };
 };

 // Bulk replace all telegram post button URLs
 const runBulkReplace = async () => {
 if (!tgOldDomain.trim() || !tgNewDomain.trim()) { toast.error("Old and New Domain required"); return; }
 setTgBulkRunning(true);
 setTgBulkResults([]);
 setTgBulkProgress(0);

 const postsToUpdate = tgSelectedPost === "all" ? tgPosts : tgPosts.filter(p => p.firebaseKey === tgSelectedPost);
 const results: typeof tgBulkResults = [];
 let done = 0;

 for (const post of postsToUpdate) {
 try {
 const oldButtons: { text: string; url: string }[] = post.buttons || [];
 const newButtons = oldButtons.map((btn: any) => ({
 text: btn.text,
 url: btn.url.includes(tgOldDomain.replace(/\/$/, ''))
 ? btn.url.replace(tgOldDomain.replace(/\/$/, ''), tgNewDomain.replace(/\/$/, ''))
 : btn.url,
 }));
 const changed = newButtons.some((nb: any, i: number) => nb.url !== oldButtons[i]?.url);
 if (!changed) { done++; setTgBulkProgress(Math.round((done/postsToUpdate.length)*100)); continue; }
 const r = await callTgApi({ action: "edit-buttons", chatId: post.chatId, messageId: post.messageId, inlineButtons: newButtons });
 if (r.ok) {
 await set(ref(db, `telegramPosts/${post.firebaseKey}/buttons`), newButtons);
 results.push({ title: post.title, poster: post.poster, ok: true });
 } else {
 results.push({ title: post.title, poster: post.poster, ok: false, error: r.data?.error || r.data?.description || `HTTP ${r.status}` });
 }
 } catch (err: any) {
 results.push({ title: post.title, poster: post.poster, ok: false, error: err.message });
 }
 done++;
 setTgBulkProgress(Math.round((done/postsToUpdate.length)*100));
 setTgBulkResults([...results]);
 }
 setTgBulkRunning(false);
 const successCount = results.filter(r => r.ok).length;
 if (successCount > 0) toast.success(`✅ ${successCount}/${results.length} updated`);
 else if (results.length > 0) toast.error("no posts updated");
 else toast.info("no changes needed");
 };

  // === SEND ALL to target channel (dedupe ONLY saved Firebase records by anime title) ===
 const sendAllToChannel = async (sourceChannelId: string) => {
 const target = (channelTargets[sourceChannelId] || sourceChannelId).trim();
 if (!target) { toast.error("Enter a target channel ID"); return; }
 const posts = channelGroups.find(g => g.chatId === sourceChannelId)?.posts || [];
 if (posts.length === 0) { toast.info("no posts"); return; }
  const freshCache = new Map<string, any>();
  const getFresh = (p: any) => {
   const cacheKey = String(p.firebaseKey || `${p.chatId || ""}_${p.messageId || ""}_${p.title || ""}`);
   if (!freshCache.has(cacheKey)) freshCache.set(cacheKey, buildFreshCaptionForTitle(p.title) as any);
   return freshCache.get(cacheKey);
  };
  const seenTitles = new Set<string>();
  const skippedTitles: string[] = [];
  const toSend = [...posts]
   .sort((a, b) => (Number(b.sentAt) || 0) - (Number(a.sentAt) || 0))
   .filter((p) => {
    const fresh = getFresh(p);
    const key = fresh.titleKey || normalizeTelegramTitleKey(p.title || "");
    if (!key) return true;
    if (seenTitles.has(key)) { skippedTitles.push(String(p.title || "Untitled")); return false; }
    seenTitles.add(key);
    return true;
   })
   .sort((a, b) => (Number(a.sentAt) || 0) - (Number(b.sentAt) || 0));
  if (toSend.length === 0) { toast.info("All saved posts are duplicate records — nothing to send"); return; }
 const targetKey = String(target).replace(/[^a-zA-Z0-9_-]/g, '_');
   if (!window.confirm(`Send ${toSend.length} unique anime post(s) with LATEST details to ${target}?${skippedTitles.length ? `\n${skippedTitles.length} duplicate saved record(s) will be skipped.` : ""}\n\nTarget channel history will NOT be checked.`)) return;

 cancelRef.current = false;
   setBusyChannel(sourceChannelId); setBusyProgress({done:0,total:toSend.length,skipped:skippedTitles.length});
  let ok = 0, fail = 0; let firstError = "";
 for (let i = 0; i < toSend.length; i++) {
 if (cancelRef.current) break;
 const p = toSend[i];
 // Build FRESH caption from latest series data
  const fresh = getFresh(p);
 const caption = fresh.matched
 ? fresh.caption
  : (p.caption && String(p.caption).trim() ? sanitizeTelegramCaption(String(p.caption), String(p.title || "")) : `<b>${String(p.title || "").replace(/[<>&]/g, "")}</b>`);
 const poster = (fresh.matched && fresh.poster) ? fresh.poster : (p.poster || undefined);
 // Replace the first inline button URL with latest episode URL when available
 const baseButtons: { text: string; url: string }[] = Array.isArray(p.buttons) ? p.buttons.map((b: any) => ({ ...b })) : [];
 if (fresh.matched && fresh.buttonUrl && baseButtons[0]) baseButtons[0].url = fresh.buttonUrl;
 const payload: any = { chatId: target, caption, photoUrl: poster, inlineButtons: baseButtons.length ? baseButtons : undefined };
 try {
 const r = await callTgApi(payload);
 if (r.ok) {
 ok++;
 const msgId = r.data?.result?.message_id || r.data?.message_id;
 const realChatId = r.data?.result?.chat?.id ?? r.data?.result?.chat?.username ?? target;
 if (msgId) {
  const rec = { chatId: realChatId, messageId: Number(msgId), title: fresh.title || p.title, poster: poster || "", caption, buttons: baseButtons, sentAt: Date.now() };
 try { await set(ref(db, `telegramPosts/${targetKey}_${msgId}`), rec); } catch {}
 }
 } else {
 fail++;
 if (!firstError) firstError = r.data?.error || r.data?.description || `HTTP ${r.status}`;
 }
 } catch (e:any) { fail++; if (!firstError) firstError = e?.message || "network error"; }
  setBusyProgress({done:i+1,total:toSend.length,skipped:skippedTitles.length});
 if (i < toSend.length - 1) await new Promise(r => setTimeout(r, 1200));
 }
 const wasCancelled = cancelRef.current;
 cancelRef.current = false;
 setBusyChannel(""); setBusyProgress({done:0,total:0});
  if (wasCancelled) toast.info(`Cancelled — sent ${ok}, failed ${fail}, skipped ${skippedTitles.length} duplicate`);
  else if (ok > 0) toast.success(`✅ Sent ${ok}/${toSend.length} unique to ${target}${skippedTitles.length?`, skipped ${skippedTitles.length} duplicate`:""}${fail?`, ${fail} failed`:""}`);
 if (!wasCancelled && fail > 0 && firstError) toast.error(`Send error: ${firstError}`);
 };

 // === CLEAR records only (not Telegram) ===
 const clearChannelRecords = async (sourceChannelId: string) => {
 const posts = channelGroups.find(g => g.chatId === sourceChannelId)?.posts || [];
 if (posts.length === 0) return;
 if (!window.confirm(`Clear ${posts.length} saved record(s) for ${sourceChannelId}?\n(Posts stay on Telegram, only local records are removed)`)) return;
 for (const p of posts) { try { await set(ref(db, `telegramPosts/${p.firebaseKey}`), null); } catch {} }
 toast.success(`Cleared ${posts.length} records`);
 };

 const deletePostRecord = async (key: string) => {
 await set(ref(db, `telegramPosts/${key}`), null);
 toast.success("record deleted");
 };

 const clearAllPostRecords = async () => {
 if (tgPosts.length === 0) { toast.info("no records"); return; }
 if (!window.confirm(`Clear ALL ${tgPosts.length} records?`)) return;
 await set(ref(db, "telegramPosts"), null);
 setTgBulkResults([]);
 setTgSelectedPost("all");
 toast.success("all records cleared");
 };

 return (
 <div>
 {/* === URL CHANGER (existing) === */}
 <div className={`${glassCard} p-4 mb-4`}>
 <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
 <RefreshCw size={14} className="text-orange-400" /> Telegram Post Button URL Changer
 </h3>
 <p className="text-[11px] text-zinc-400 mb-4">
 Bulk-update inline button URLs of sent Telegram posts.
 </p>
 <div className="mb-3">
 <label className="block text-xs text-zinc-400 mb-1">⚡ Quick Paste (auto-extract domain)</label>
 <input value={tgQuickPaste} onChange={e => handleQuickPaste(e.target.value)} className={inputClass} placeholder="https://old-domain.com/path/video.mp4" />
 </div>
 <div className="grid grid-cols-2 gap-3 mb-3">
 <div>
 <label className="block text-xs text-zinc-400 mb-1">Old Domain</label>
 <input value={tgOldDomain} onChange={e => setTgOldDomain(e.target.value)} className={inputClass} placeholder="https://old.com" />
 </div>
 <div>
 <label className="block text-xs text-zinc-400 mb-1">New Domain</label>
 <input value={tgNewDomain} onChange={e => setTgNewDomain(e.target.value)} className={inputClass} placeholder="https://new.com" />
 </div>
 </div>
 <div className="mb-3">
 <label className="block text-xs text-zinc-400 mb-1">Post scope</label>
 <select value={tgSelectedPost} onChange={e => setTgSelectedPost(e.target.value)} className={selectClass}>
 <option value="all">📦 All posts ({tgPosts.length})</option>
 {tgPosts.map(p => (<option key={p.firebaseKey} value={p.firebaseKey}>{p.title} ({p.chatId})</option>))}
 </select>
 </div>
 <button onClick={runBulkReplace} disabled={tgBulkRunning || !tgOldDomain.trim() || !tgNewDomain.trim()}
 className={`${btnPrimary} w-full py-3 text-[13px] font-semibold flex items-center justify-center gap-2 disabled:opacity-50`}>
 {tgBulkRunning ? (<><div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />updating... {tgBulkProgress}%</>) : (<><RefreshCw size={16} /> Update Button URLs</>)}
 </button>
 {tgBulkRunning && (<div className="mt-3 bg-zinc-800 rounded-full h-2 overflow-hidden"><div className="bg-gradient-to-r from-blue-500 to-purple-500 h-full transition-all duration-300" style={{ width: `${tgBulkProgress}%` }} /></div>)}
 </div>

 {tgBulkResults.length > 0 && (
 <div className={`${glassCard} p-4 mb-4`}>
 <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><CheckCircle size={14} className="text-green-400" /> Update result</h3>
 <div className="space-y-2 max-h-[300px] overflow-y-auto">
 {tgBulkResults.map((r, i) => (
 <div key={i} className={`flex items-center gap-2.5 p-2 rounded-lg border ${r.ok ? 'border-green-500/20 bg-green-500/5' : 'border-red-500/20 bg-red-500/5'}`}>
 {r.poster && <CachedImg src={r.poster} alt="" className="w-8 h-10 rounded object-cover flex-shrink-0" loading="lazy" decoding="async" />}
 <div className="flex-1 min-w-0">
 <span className="text-[12px] truncate block">{r.title}</span>
 {r.error && <span className="text-[10px] text-red-400">{r.error}</span>}
 </div>
 {r.ok ? <CheckCircle size={14} className="text-green-400 flex-shrink-0" /> : <XCircle size={14} className="text-red-400 flex-shrink-0" />}
 </div>
 ))}
 </div>
 </div>
 )}

 {/* === CHANNEL MANAGER (NEW) === */}
 <div className={`${glassCard} p-4 mb-4`}>
 <div className="flex items-center justify-between gap-3 mb-3">
 <h3 className="text-sm font-semibold flex items-center gap-2">
 <Send size={14} className="text-purple-400" /> Channel Manager
 <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">NEW</span>
 </h3>
 <button onClick={clearAllPostRecords} disabled={tgPostsLoading || tgPosts.length === 0}
 className={`${btnSecondary} !px-3 !py-1.5 text-[11px] text-red-300 border-red-500/30 disabled:opacity-50`}>
 Clear All Records
 </button>
 </div>
 <p className="text-[11px] text-zinc-400 mb-3">
 Posts grouped by saved channel. <b>Send All</b> sends only one latest post per anime from saved Firebase records. It does not check your Telegram channel history. <b>Clear</b> removes saved records only.
 </p>

 {tgPostsLoading ? (
 <div className="flex justify-center py-6"><div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" /></div>
 ) : channelGroups.length === 0 ? (
 <p className="text-zinc-500 text-[11px] text-center py-4">No saved channels yet. Send a Telegram post first.</p>
 ) : (
 <div className="space-y-3">
 {channelGroups.map(({ chatId, posts }) => {
 const isOpen = expandedChannel === chatId;
 const isBusy = busyChannel === chatId;
 const target = channelTargets[chatId] ?? chatId;
 return (
 <div key={chatId} className="rounded-xl border border-zinc-700/40 bg-zinc-900/40 overflow-hidden">
 <div className="flex items-center justify-between gap-2 p-3">
 <button onClick={() => setExpandedChannel(isOpen ? "" : chatId)} className="flex-1 min-w-0 text-left">
 <div className="text-[13px] font-semibold truncate">{chatId}</div>
 <div className="text-[10px] text-zinc-400">{posts.length} post{posts.length===1?"":"s"} saved</div>
 </button>
  {isBusy && (
  <div className="text-[10px] text-amber-300 whitespace-nowrap">
  Sending {busyProgress.done}/{busyProgress.total}{busyProgress.skipped ? ` • skip ${busyProgress.skipped}` : ""}
  </div>
  )}
 </div>
 {isOpen && (
 <div className="px-3 pb-3 space-y-2">
 <div>
 <label className="block text-[10px] text-zinc-400 mb-1">Target channel for Send All (default: same channel)</label>
 <input value={target} onChange={e => setChannelTargets(prev => ({ ...prev, [chatId]: e.target.value }))}
 className={inputClass} placeholder="@channel or -100..." />
 </div>
                  <div className="grid grid-cols-2 gap-2">
 <button disabled={!!busyChannel} onClick={() => sendAllToChannel(chatId)}
 className="w-full py-2.5 px-2 rounded-lg bg-gradient-to-br from-indigo-500/90 to-purple-600/90 hover:from-indigo-500 hover:to-purple-600 text-white text-[11px] font-semibold flex flex-col items-center justify-center gap-1 shadow-md shadow-purple-900/30 border border-purple-400/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
 <Send size={14} />
   <span className="leading-none">Send All</span>
 </button>
 <button disabled={!!busyChannel} onClick={() => clearChannelRecords(chatId)}
 className="w-full py-2.5 px-2 rounded-lg bg-zinc-700/70 hover:bg-zinc-700 text-zinc-100 text-[11px] font-semibold flex flex-col items-center justify-center gap-1 border border-zinc-600/40 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
 <XCircle size={14} />
 <span className="leading-none">Clear</span>
 </button>
 </div>
 {isBusy && (
 <div className="space-y-2 pt-1">
 <div className="flex items-center justify-between gap-2">
  <div className="text-[10px] text-amber-300 font-medium">
   📤 Sending {busyProgress.done}/{busyProgress.total}{busyProgress.skipped ? ` • skipped ${busyProgress.skipped}` : ""}
  </div>
 <button onClick={cancelCurrent}
 className="px-3 py-1 rounded-md bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 text-red-300 text-[10px] font-semibold flex items-center gap-1 transition-all">
 <XCircle size={12} /> Cancel
 </button>
 </div>
 <div className="bg-zinc-800 rounded-full h-1.5 overflow-hidden">
 <div className="bg-gradient-to-r from-amber-500 to-pink-500 h-full transition-all" style={{ width: `${busyProgress.total ? (busyProgress.done/busyProgress.total)*100 : 0}%` }} />
 </div>
 </div>
 )}
 <div className="space-y-1.5 max-h-[260px] overflow-y-auto pt-1">
 {posts.map(post => (
 <div key={post.firebaseKey} className="flex items-center gap-2 p-1.5 bg-zinc-800/40 rounded-lg border border-zinc-700/20">
 {post.poster && <CachedImg src={post.poster} alt="" className="w-8 h-10 rounded object-cover flex-shrink-0" loading="lazy" decoding="async" />}
 <div className="flex-1 min-w-0">
 <span className="text-[11px] font-medium truncate block">{post.title}</span>
 <span className="text-[9px] text-zinc-500 block">MSG: {post.messageId}</span>
 </div>
 <button onClick={() => deletePostRecord(post.firebaseKey)} className="text-red-400 hover:text-red-300 p-1" title="Remove record only">
 <Trash2 size={11} />
 </button>
 </div>
 ))}
 </div>
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
 return <TgUrlChanger />;
 })()}


 {activeSection === "free-access" && (
 <div>
 {/* Telegram Post Free Access (auto-attach to every TG post) */}
 <TelegramFreeAccessConfig glassCard={glassCard} inputClass={inputClass} btnPrimary={btnPrimary} btnSecondary={btnSecondary} />

 {/* Telegram Post — Global Permanent Custom Button */}
 <TelegramGlobalButtonConfig glassCard={glassCard} inputClass={inputClass} btnPrimary={btnPrimary} btnSecondary={btnSecondary} />


 {/* Global Free Access for All */}
 <div className={`${glassCard} p-4 mb-4`}>
 <h3 className="text-sm font-semibold mb-3.5 flex items-center gap-2">
 <Zap size={14} className="text-yellow-500" /> Free Access for All Users
 </h3>
 <p className="text-[11px] text-[#D1C4E9] mb-4">
 all user for a specific duration free access day। this time মধ্which any ad গেট থাকবে No।
 </p>

 {/* Current status */}
 {globalFreeAccess?.active && globalFreeAccess?.expiresAt > Date.now() ? (
 <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 mb-4">
 <div className="flex items-center justify-between mb-2">
 <span className="text-sm font-semibold text-green-400 flex items-center gap-2">
 <Zap size={14} /> global free access অ্যাক্ভ
 </span>
 <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">LIVE</span>
 </div>
 <div className="text-[11px] text-[#D1C4E9] space-y-1">
 <p>start: {new Date(globalFreeAccess.activatedAt).toLocaleString("bn-BD", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
 <p>done: {new Date(globalFreeAccess.expiresAt).toLocaleString("bn-BD", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
 {(() => {
 const rem = globalFreeAccess.expiresAt - Date.now();
 const h = Math.floor(rem / 3600000);
 const m = Math.floor((rem % 3600000) / 60000);
 return <p className="text-green-400 font-semibold">remaining: {h}h {m}m</p>;
 })()}
 </div>
 <button
 onClick={() => {
 if (confirm("global free access off Continue?")) {
 set(ref(db, "globalFreeAccess"), { active: false, expiresAt: 0, activatedAt: 0 })
 .then(() => toast.success("global free access off done"))
 .catch((err) => toast.error("Error: " + err.message));
 }
 }}
 className={`${btnSecondary} mt-3 w-full py-2.5 text-sm flex items-center justify-center gap-2 text-red-400 border-red-500/30 hover:border-red-500`}
 >
 <X size={14} /> free access off 
 </button>
 </div>
 ) : (
 <div className="space-y-3">
 <div className="flex gap-2">
 <div className="flex-1">
 <label className="text-[11px] text-[#957DAD] mb-1 block">hours</label>
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
 <label className="text-[11px] text-[#957DAD] mb-1 block">minute</label>
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
 toast.error("at least পক্ষে 1 minute time day");
 return;
 }
 if (!confirm(`all user ${hours > 0 ? hours + " hours " : ""}${minutes > 0 ? minutes + " minute " : ""}free access Continue?`)) return;
 const now = Date.now();
 set(ref(db, "globalFreeAccess"), {
 active: true,
 activatedAt: now,
 expiresAt: now + totalMs,
 })
 .then(() => toast.success("global free access on done!"))
 .catch((err) => toast.error("Error: " + err.message));
 }}
 className={`${btnPrimary} w-full py-3 text-sm flex items-center justify-center gap-2`}
 >
 <Zap size={14} /> all user free access day
 </button>
 </div>
 )}
 </div>

 <div className={`${glassCard} p-4 mb-4`}>
 <div className="mb-3.5 flex items-center justify-between gap-3">
 <h3 className="text-sm font-semibold flex items-center gap-2">
 <Eye size={14} className="text-green-500" /> Active Free Access Users ({freeAccessUsers.length})
 </h3>
 <button
 onClick={clearAllFreeAccess}
 disabled={freeAccessBusy === "all" || freeAccessUsers.length === 0}
 className={`${btnSecondary} !px-3 !py-1.5 text-[11px] text-red-400 border-red-500/30 hover:border-red-500 disabled:opacity-50`}
 >
 {freeAccessBusy === "all" ? "Clearing..." : "Clear All"}
 </button>
 </div>
 <p className="text-[11px] text-[#D1C4E9] mb-4">
 List of users who took free 24-hour access through the AroLinks ad gate। access done if automatically মুছে will go।
 </p>
 {freeAccessUsers.length === 0 ? (
 <p className="text-[#957DAD] text-[13px] text-center py-8">any অ্যাক্ভ free access user none</p>
 ) : (
 <div className="space-y-2.5">
 {freeAccessUsers.map((user) => {
 const remaining = user.expiresAt - Date.now();
 const hours = Math.floor(remaining / 3600000);
 const minutes = Math.floor((remaining % 3600000) / 60000);
 return (
 <div key={user.id} className={`bg-[#1A1A2E] border rounded-xl p-4 ${user.suspiciousBypass ? "border-red-500/50" : "border-green-500/20"}`}>
 <div className="flex items-center gap-3">
 <div className={`w-[42px] h-[42px] rounded-full flex items-center justify-center font-bold text-lg flex-shrink-0 ${user.suspiciousBypass ? "bg-gradient-to-br from-red-500 to-red-700" : "bg-gradient-to-br from-green-500 to-green-700"}`}>
 {(user.name || "U")[0].toUpperCase()}
 </div>
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-2">
 <p className="text-sm font-semibold truncate">{user.name || "Unknown"}</p>
 {user.suspiciousBypass ? <span className="inline-flex h-2.5 w-2.5 rounded-full bg-red-500" /> : null}
 </div>
 <p className="text-[11px] text-[#D1C4E9] truncate">{user.email || "No email"}</p>
 </div>
 <div className="flex items-center gap-2 flex-shrink-0">
 <div className={`px-2.5 py-1 rounded-full border ${user.suspiciousBypass ? "bg-red-500/15 border-red-500/30" : "bg-green-500/15 border-green-500/30"}`}>
 <span className={`text-[11px] font-bold ${user.suspiciousBypass ? "text-red-400" : "text-green-400"}`}>{hours}h {minutes}m</span>
 </div>
 <button
 onClick={() => clearSingleFreeAccess(user)}
 disabled={freeAccessBusy === String(user.userId || user.id || "")}
 className="h-8 w-8 rounded-full border border-red-500/30 bg-red-500/10 text-red-400 flex items-center justify-center disabled:opacity-50"
 title="Cancel access"
 >
 <X size={14} />
 </button>
 </div>
 </div>
 <div className="mt-2.5 flex justify-between items-center text-[10px] text-[#957DAD]">
 <span>unlock: {new Date(user.unlockedAt).toLocaleString("bn-BD", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
 <span>done: {new Date(user.expiresAt).toLocaleString("bn-BD", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
 </div>
 {user.suspiciousBypass ? (
 <div className="mt-2 text-[10px] text-red-300">
 ⚠️ 30 second- of beforethis token নে done — bypass suspect
 </div>
 ) : null}
 </div>
 );
 })}
 </div>
 )}
 </div>

 {/* Prize Pool - Users who claimed via prize links */}
 <div className={`${glassCard} p-4`}>
 <h3 className="text-sm font-semibold mb-3.5 flex items-center gap-2">
 <Star size={14} className="text-yellow-400" /> 🎁 Prize Pool ({prizePoolUsers.length})
 </h3>
 <p className="text-[11px] text-muted-foreground mb-4">
 List of users who got free access from a Random Prize link।
 </p>
 {prizePoolUsers.length === 0 ? (
 <p className="text-muted-foreground text-[13px] text-center py-8">any প্ইজ claim not done</p>
 ) : (
 <div className="space-y-2.5">
 {prizePoolUsers.map((user) => {
 const isExpired = user.expiresAt < Date.now();
 const isJackpot = user.hours >= 42;
 return (
 <div key={user.id} className={`p-3 rounded-xl border transition-all ${
 isExpired ? "bg-muted/30 border-border opacity-60" 
 : isJackpot ? "bg-yellow-500/10 border-yellow-500/30" 
 : "bg-purple-500/10 border-purple-500/30"
 }`}>
 <div className="flex items-center gap-3">
 <div className={`w-[38px] h-[38px] rounded-full flex items-center justify-center font-bold text-lg flex-shrink-0 ${
 isJackpot ? "bg-gradient-to-br from-yellow-400 to-orange-500" : "bg-gradient-to-br from-purple-500 to-pink-500"
 }`}>
 {isJackpot ? "🏆" : "🎁"}
 </div>
 <div className="flex-1 min-w-0">
 <p className="text-sm font-semibold truncate">{user.name || "Unknown"}</p>
 <p className="text-[10px] text-muted-foreground truncate">{user.email || "No email"}</p>
 </div>
 <div className="text-right flex-shrink-0">
 <div className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
 isExpired ? "bg-muted text-muted-foreground" 
 : isJackpot ? "bg-yellow-500/20 text-yellow-400"
 : "bg-purple-500/20 text-purple-400"
 }`}>
 {user.hours}h {user.minutes || 0}m
 </div>
 {isExpired && <span className="text-[9px] text-muted-foreground">expired</span>}
 </div>
 </div>
 <div className="mt-2 text-[10px] text-muted-foreground">
 claim: {new Date(user.claimedAt).toLocaleString("bn-BD", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
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
 {/* Admin notification & FCM token settings removed — Telegram-only delivery */}

 <div className={`${glassCard} p-4 mb-4`}>
 <h3 className="text-sm font-semibold mb-3.5 flex items-center gap-2">
 <Link size={14} className="text-purple-400" /> Tutorial Videos
 </h3>
 <p className="text-[11px] text-[#D1C4E9] mb-4">
 Add multiple tutorial videos with custom titles. Users will see these in the unlock section.
 </p>

 {/* Existing videos list */}
 {tutorialVideos.length > 0 && (
 <div className="space-y-2 mb-4">
 {tutorialVideos.map((vid: any, idx: number) => (
 <div key={vid.id || idx} className="flex items-center gap-2 bg-[#0E1621] rounded-lg p-2 border border-white/5">
 <div className="flex-1 min-w-0">
 <p className="text-[11px] font-semibold text-white truncate">{vid.title || "Untitled"}</p>
 <a href={vid.url} target="_blank" rel="noopener noreferrer" className="text-[9px] text-purple-400 underline truncate block">{vid.url}</a>
 </div>
 <button onClick={async () => {
 try {
 await remove(ref(db, `settings/tutorialVideos/${vid.id}`));
 toast.success("Removed!");
 } catch { toast.error("Failed"); }
 }} className="text-red-400 hover:text-red-300 flex-shrink-0"><Trash2 size={12} /></button>
 </div>
 ))}
 </div>
 )}

 {/* Add new video */}
 <div className="space-y-2">
 <input value={newTutorialTitle} onChange={e => setNewTutorialTitle(e.target.value)}
 placeholder="Video Title (e.g. How to open ShrinkMe)"
 className={inputClass} />
 <div className="flex gap-2">
 <input value={newTutorialUrl} onChange={e => setNewTutorialUrl(e.target.value)}
 placeholder="Video URL (MP4)" className={`${inputClass} flex-1`} />
 <button onClick={async () => {
 if (!newTutorialTitle.trim() || !newTutorialUrl.trim()) { toast.error("Title & URL required"); return; }
 try {
 const newRef = push(ref(db, "settings/tutorialVideos"));
 await set(newRef, { title: newTutorialTitle.trim(), url: newTutorialUrl.trim() });
 setNewTutorialTitle(""); setNewTutorialUrl("");
 toast.success("Tutorial video added!");
 } catch { toast.error("Failed to save"); }
 }} className={`${btnPrimary} !px-4`}>
 <Plus size={14} /> Add
 </button>
 </div>
 </div>

 {/* Legacy single link */}
 {tutorialLink && (
 <div className="mt-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-2">
 <p className="text-[10px] text-yellow-400 mb-1">Legacy single link (will be used if no videos above):</p>
 <div className="flex items-center gap-2">
 <a href={tutorialLink} target="_blank" rel="noopener noreferrer" className="text-[10px] text-purple-400 underline truncate flex-1">{tutorialLink}</a>
 <button onClick={() => { set(ref(db, "settings/tutorialLink"), null); setTutorialLinkInput(""); toast.success("Removed!"); }}
 className="text-red-400 hover:text-red-300"><Trash2 size={12} /></button>
 </div>
 </div>
 )}
 </div>

 {/* Authorized Google Emails for Admin */}
 <div className={`${glassCard} p-4 mb-4`}>
 <h3 className="text-sm font-semibold mb-3.5 flex items-center gap-2">
 <Shield size={14} className="text-green-500" /> admin Google account
 </h3>
 <p className="text-[11px] text-zinc-400 mb-4">
 Add the Google emails allowed to log in to the admin panel।
 </p>
 <AdminAuthorizedEmails glassCard={glassCard} inputClass={inputClass} btnPrimary={btnPrimary} btnSecondary={btnSecondary} />
 </div>

 {/* Telegram Channel Settings */}
 <div className={`${glassCard} p-4 mb-4`}>
 <h3 className="text-sm font-semibold mb-3.5 flex items-center gap-2">
 <Send size={14} className="text-blue-400" /> Telegram channel settings
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
 toast.success("channel save done!");
 } catch { toast.error("Save failed"); }
 }}
 className={`${btnPrimary} !px-4`}
 >
 <Save size={14} /> Save
 </button>
 </div>
 </div>

 {/* Force notification re-prompt removed — FCM disabled site-wide */}


  {/* Proxy Server Selector — REMOVED. Player proxy now comes only from
     EGD Router → video-proxy URL (settings/functionOverrides/video-proxy). */}

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

 {/* Link Checker moved to dedicated section */}

 {/* Anime Name Exporter (RS vs AN) */}
 <AnimeNameExporter glassCard={glassCard} btnPrimary={btnPrimary} btnSecondary={btnSecondary} />

  {/* AN Series manager moved to Series → AN Series tab */}
 </div>
 )}

 {/* ==================== EDGE FUNCTION ROUTER ==================== */}
 {activeSection === "edge-router" && (
 <EdgeRouterSection glassCard={glassCard} inputClass={inputClass} btnPrimary={btnPrimary} btnSecondary={btnSecondary} />
 )}

 {/* ==================== EMAIL SERVICE ==================== */}
 {activeSection === "email-service" && (
 <EmailServiceSection glassCard={glassCard} inputClass={inputClass} btnPrimary={btnPrimary} btnSecondary={btnSecondary} />
 )}


 {/* ==================== APK DW (Download Center) ==================== */}
 {activeSection === "apk-dw" && (
 <ApkDownloadCenter glassCard={glassCard} inputClass={inputClass} btnPrimary={btnPrimary} />
 )}

 {/* ==================== EGD MANAGER ==================== */}
 {activeSection === "egd-manager" && (
 <EgdManager glassCard={glassCard} inputClass={inputClass} btnPrimary={btnPrimary} btnSecondary={btnSecondary} />
 )}

 {/* ==================== ADSTERRA ADS ==================== */}
 {activeSection === "adsterra" && (
 <AdsterraConfig glassCard={glassCard} inputClass={inputClass} btnPrimary={btnPrimary} />
 )}

 {/* ==================== BACKDROP AI ==================== */}
 {activeSection === "backdrop-ai" && (
 <BackdropAiReplacer glassCard={glassCard} inputClass={inputClass} btnPrimary={btnPrimary} btnSecondary={btnSecondary} />
 )}

 {/* ==================== SECURITY & ACCESS ==================== */}
 {activeSection === "security-center" && (
 <SecurityCenter glassCard={glassCard} inputClass={inputClass} btnPrimary={btnPrimary} btnSecondary={btnSecondary} />
 )}


 {/* ==================== FIREBASE CLEANUP ==================== */}
 {activeSection === "fb-cleanup" && (
 <FirebaseMultiManager glassCard={glassCard} btnPrimary={btnPrimary} btnSecondary={btnSecondary} />
 )}

 {/* ==================== AI CONFIG ==================== */}
 {activeSection === "ai-config" && (
 <AiConfigSection glassCard={glassCard} inputClass={inputClass} btnPrimary={btnPrimary} />
 )}

 {/* ==================== BRANDING ==================== */}
 {activeSection === "branding" && (
 <BrandingSection glassCard={glassCard} inputClass={inputClass} btnPrimary={btnPrimary} />
 )}

 {/* ==================== LIVE TV ==================== */}
 {activeSection === "live-tv" && (() => {
 const LiveTvProxyConfig = ({ glassCard, inputClass, btnPrimary }: { glassCard: string; inputClass: string; btnPrimary: string }) => {
 const [url, setUrl] = useState("");
 const [apiKey, setApiKey] = useState("");
 const [saving, setSaving] = useState(false);
 useEffect(() => {
 const unsub = onValue(ref(db, "settings/liveTvProxy"), (snap) => {
 const v = snap.val() || {};
 setUrl(String(v.url || ""));
 setApiKey(String(v.apiKey || ""));
 });
 return () => unsub();
 }, []);
 const save = async () => {
 setSaving(true);
 try {
 await set(ref(db, "settings/liveTvProxy"), { url: url.trim(), apiKey: apiKey.trim() });
 toast.success("✅ Live TV proxy saved");
 } catch { toast.error("❌ Save failed"); }
 setSaving(false);
 };
 const clear = async () => {
 await remove(ref(db, "settings/liveTvProxy"));
 setUrl(""); setApiKey("");
 toast.success("🗑️ Cleared — using default");
 };
 return (
 <div className={`${glassCard} p-4 mb-4`}>
 <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">📡 Live TV Proxy</h3>
 <p className="text-[10px] text-zinc-400 mb-3">Paste the deployed <code>live-tv-proxy</code> URL from EGD Manager. Leave blank to use the default video proxy.</p>
 <div className="space-y-2">
 <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://xxx.supabase.co/functions/v1/live-tv-proxy?url=" className={inputClass} />
 <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="API key (optional)" className={inputClass} />
 <div className="flex gap-2">
 <button onClick={save} disabled={saving} className={`${btnPrimary} flex-1`}>{saving ? "Saving..." : "💾 Save"}</button>
 <button onClick={clear} className="px-3 py-2 rounded-lg bg-zinc-800 text-xs text-zinc-300 hover:bg-zinc-700">Clear</button>
 </div>
 </div>
 </div>
 );
 };
 const LiveTvAdmin = () => {
 const [channels, setChannelsState] = useState<{id: string; name: string; logo: string; banner: string; streamUrl: string; category: string; order: number}[]>([]);
 const [name, setName] = useState("");
 const [logo, setLogo] = useState("");
 const [banner, setBanner] = useState("");
 const [streamUrl, setStreamUrl] = useState("");
 const [category, setCategory] = useState("General");
 const [editId, setEditId] = useState<string | null>(null);
 const [uploadingLogo, setUploadingLogo] = useState(false);
 const [uploadingBanner, setUploadingBanner] = useState(false);
 const logoFileRef = useRef<HTMLInputElement>(null);
 const bannerFileRef = useRef<HTMLInputElement>(null);
 const [categories, setCategories] = useState<string[]>([]);
 const [newCatName, setNewCatName] = useState("");
 const [showAddCat, setShowAddCat] = useState(false);

 const handleImgUpload = async (file: File, setter: (v: string) => void, setLoading: (v: boolean) => void) => {
 if (file.size > 10 * 1024 * 1024) { toast.error("Max 10MB!"); return; }
 if (!file.type.startsWith("image/")) { toast.error("Only images!"); return; }
 setLoading(true);
 try {
 const { uploadToImgbb } = await import("@/lib/imgbbUpload");
 const url = await uploadToImgbb(file);
 setter(url);
 toast.success("✅ image upload done!");
 } catch { toast.error("❌ upload failed!"); }
 setLoading(false);
 };

 useEffect(() => {
 const unsub = onValue(ref(db, "liveTvChannels"), (snap) => {
 const data = snap.val();
 if (data) {
 const list = Object.entries(data).map(([id, val]: any) => ({
 id, name: val.name || "", logo: val.logo || "", banner: val.banner || "", streamUrl: val.streamUrl || "",
 category: val.category || "General", order: val.order || 0,
 }));
 list.sort((a, b) => a.order - b.order);
 setChannelsState(list);
 } else setChannelsState([]);
 });
 return () => unsub();
 }, []);

 useEffect(() => {
 const unsub = onValue(ref(db, "liveTvCategories"), (snap) => {
 const data = snap.val();
 if (data && Array.isArray(data)) {
 setCategories(data);
 } else if (data && typeof data === "object") {
 setCategories(Object.values(data));
 } else {
 setCategories(["General"]);
 }
 });
 return () => unsub();
 }, []);

 const addCategory = async () => {
 if (!newCatName.trim()) return;
 const updated = [...categories, newCatName.trim()];
 await set(ref(db, "liveTvCategories"), updated);
 setNewCatName("");
 setShowAddCat(false);
 toast.success("✅ Category add done!");
 };

 const deleteCategory = async (cat: string) => {
 const updated = categories.filter(c => c !== cat);
 await set(ref(db, "liveTvCategories"), updated.length ? updated : ["General"]);
 toast.success("🗑️ Category মুছে ফেলা done!");
 };

 const saveChannel = async () => {
 if (!name.trim() || !streamUrl.trim()) { toast.error("name and Stream URL enter!"); return; }
 const data = { name: name.trim(), logo: logo.trim(), banner: banner.trim(), streamUrl: streamUrl.trim(), category: category.trim() || "General", order: channels.length };
 if (editId) {
 await update(ref(db, `liveTvChannels/${editId}`), data);
 toast.success("✅ channel update done!");
 setEditId(null);
 } else {
 await push(ref(db, "liveTvChannels"), data);
 toast.success("✅ channel add done!");
 }
 setName(""); setLogo(""); setBanner(""); setStreamUrl(""); setCategory("General");
 };

 const deleteChannel = async (id: string) => {
 if (!confirm("Delete this channel?")) return;
 await remove(ref(db, `liveTvChannels/${id}`));
 toast.success("🗑️ channel delete done!");
 };

 const startEdit = (ch: any) => {
 setEditId(ch.id); setName(ch.name); setLogo(ch.logo); setBanner(ch.banner || ""); setStreamUrl(ch.streamUrl); setCategory(ch.category);
 };

  return (
  <div>
  {/* LiveTvProxyConfig removed — single proxy now configured via EGD Manager. */}
  <div className={`${glassCard} p-4 mb-4`}>
  <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
  📺 {editId ? "Edit Channel" : "Add New Channel"}
  </h3>
 <div className="space-y-3">
 <div>
 <label className="text-[10px] text-zinc-400 block mb-1">Channel Name *</label>
 <input value={name} onChange={e => setName(e.target.value)} placeholder="Channel name" className={inputClass} />
 </div>

 {/* Logo Upload */}
 <div>
 <label className="text-[10px] text-zinc-400 block mb-1">Channel Logo</label>
 <div className="flex gap-2">
 <input value={logo} onChange={e => setLogo(e.target.value)} placeholder="https://logo-url.png" className={`${inputClass} flex-1`} />
 <button
 onClick={() => logoFileRef.current?.click()}
 disabled={uploadingLogo}
 className={`${btnSecondary} px-3 py-2 text-[10px] flex items-center gap-1`}
 >
 {uploadingLogo ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
 upload
 </button>
 <input ref={logoFileRef} type="file" accept="image/*" className="hidden"
 onChange={e => { const f = e.target.files?.[0]; if (f) handleImgUpload(f, setLogo, setUploadingLogo); e.target.value = ""; }} />
 </div>
 {logo && (
 <div className="mt-2 w-16 h-16 rounded-xl overflow-hidden bg-zinc-800/50 border border-zinc-700/40">
 <CachedImg src={logo} alt="Logo" className="w-full h-full object-contain" loading="lazy" decoding="async" />
 </div>
 )}
 </div>

 {/* Banner Upload */}
 <div>
 <label className="text-[10px] text-zinc-400 block mb-1">Channel Banner (16:9)</label>
 <div className="flex gap-2">
 <input value={banner} onChange={e => setBanner(e.target.value)} placeholder="https://banner-url.png" className={`${inputClass} flex-1`} />
 <button
 onClick={() => bannerFileRef.current?.click()}
 disabled={uploadingBanner}
 className={`${btnSecondary} px-3 py-2 text-[10px] flex items-center gap-1`}
 >
 {uploadingBanner ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
 upload
 </button>
 <input ref={bannerFileRef} type="file" accept="image/*" className="hidden"
 onChange={e => { const f = e.target.files?.[0]; if (f) handleImgUpload(f, setBanner, setUploadingBanner); e.target.value = ""; }} />
 </div>
 {banner && (
 <div className="mt-2 aspect-video rounded-xl overflow-hidden bg-zinc-800/50 border border-zinc-700/40">
 <CachedImg src={banner} alt="Banner" className="w-full h-full object-cover" loading="lazy" decoding="async" />
 </div>
 )}
 </div>

 <div>
 <label className="text-[10px] text-zinc-400 block mb-1">Stream URL *</label>
 <input value={streamUrl} onChange={e => setStreamUrl(e.target.value)} placeholder="https://stream.m3u8" className={inputClass} />
 </div>
 <div>
 <label className="text-[10px] text-zinc-400 block mb-1">Category</label>
 <div className="flex gap-2">
 <select value={category} onChange={e => setCategory(e.target.value)} className={`${inputClass} flex-1`}>
 {categories.map(cat => (
 <option key={cat} value={cat}>{cat}</option>
 ))}
 </select>
 <button onClick={() => setShowAddCat(!showAddCat)} className={`${btnSecondary} px-3 py-2 text-[10px]`}>
 {showAddCat ? "✕" : "+ new"}
 </button>
 </div>
 {showAddCat && (
 <div className="flex gap-2 mt-2">
 <input value={newCatName} onChange={e => setNewCatName(e.target.value)} placeholder="new Category name" className={`${inputClass} flex-1`} />
 <button onClick={addCategory} className={`${btnPrimary} px-3 py-2 text-[10px]`}>add </button>
 </div>
 )}
 {categories.length > 0 && (
 <div className="flex flex-wrap gap-1 mt-2">
 {categories.map(cat => (
 <span key={cat} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-zinc-700/50 text-[9px] text-zinc-300">
 {cat}
 {cat !== "General" && (
 <button onClick={() => deleteCategory(cat)} className="hover:text-red-400">✕</button>
 )}
 </span>
 ))}
 </div>
 )}
 </div>
 <div className="flex gap-2">
 <button onClick={saveChannel} className={`${btnPrimary} flex-1 py-2.5 flex items-center justify-center gap-2`}>
 <Save size={14} /> {editId ? "update " : "add "}
 </button>
 {editId && (
 <button onClick={() => { setEditId(null); setName(""); setLogo(""); setBanner(""); setStreamUrl(""); setCategory("General"); }}
 className={`${btnSecondary} px-4 py-2.5`}>
 cancel
 </button>
 )}
 </div>
 </div>
 </div>

 <div className={`${glassCard} p-4`}>
 <h3 className="text-sm font-semibold mb-3">📺 All Channels ({channels.length})</h3>
 {channels.length === 0 ? (
 <p className="text-xs text-zinc-500 text-center py-6">any channel none</p>
 ) : (
 <div className="space-y-2">
 {channels.map(ch => (
 <div key={ch.id} className="flex items-center gap-3 p-3 rounded-xl bg-zinc-800/40 border border-zinc-700/30">
 <div className="w-12 h-8 rounded-lg overflow-hidden bg-zinc-700/50 flex-shrink-0">
 {ch.logo && <CachedImg src={ch.logo} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />}
 </div>
 <div className="flex-1 min-w-0">
 <p className="text-xs font-semibold text-white truncate">{ch.name}</p>
 <p className="text-[9px] text-zinc-500 truncate">{ch.streamUrl}</p>
 <p className="text-[9px] text-cyan-400">{ch.category}</p>
 </div>
 <div className="flex gap-1">
 <button onClick={() => startEdit(ch)} className="p-1.5 rounded-lg bg-zinc-700/50 hover:bg-zinc-600/50">
 <Edit size={12} className="text-zinc-300" />
 </button>
 <button onClick={() => deleteChannel(ch.id)} className="p-1.5 rounded-lg bg-zinc-700/50 hover:bg-red-600/50">
 <Trash2 size={12} className="text-zinc-300" />
 </button>
 </div>
 </div>
 ))}
 </div>
 )}
 </div>
 </div>
 );
 };
 return <LiveTvAdmin />;
 })()}

 {/* ==================== URL CHANGER ==================== */}
 {activeSection === "url-changer" && (() => {
 const UrlChangerAdmin = () => {
 const [selectedSeriesId, setSelectedSeriesId] = useState("");
 const [oldDomain, setOldDomain] = useState("");
 const [newDomain, setNewDomain] = useState("");
 const [replacing, setReplacing] = useState(false);
 const [replaceResult, setReplaceResult] = useState<{ total: number; replaced: number } | null>(null);
 const [searchFilter, setSearchFilter] = useState("");
 const [showSelector, setShowSelector] = useState(false);
 const [quickPasteText, setQuickPasteText] = useState("");
 const [showQuickPaste, setShowQuickPaste] = useState(false);
 const [selectedSeason, setSelectedSeason] = useState<string>("all");
 const [selectedEpisode, setSelectedEpisode] = useState<string>("all");

 // Bulk mode
 const [bulkMode, setBulkMode] = useState<"off" | "all-series" | "all-movies">("off");
 const [bulkOldDomain, setBulkOldDomain] = useState("");
 const [bulkNewDomain, setBulkNewDomain] = useState("");
 const [bulkReplacing, setBulkReplacing] = useState(false);
 const [bulkResults, setBulkResults] = useState<{ title: string; poster: string; replaced: number; total: number }[]>([]);
 const [bulkQP, setBulkQP] = useState("");
 const [showBulkQP, setShowBulkQP] = useState(false);

 const sortedSeries = useMemo(() => {
 const sorted = [...webseriesData].sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
 if (!searchFilter.trim()) return sorted;
 return sorted.filter(s => s.title?.toLowerCase().includes(searchFilter.toLowerCase()));
 }, [webseriesData, searchFilter]);

 const selectedSeries = webseriesData.find(s => s.id === selectedSeriesId);

 // Get seasons for selected series
 const seriesSeasons = useMemo(() => {
 if (!selectedSeries?.seasons) return [];
 if (Array.isArray(selectedSeries.seasons)) return selectedSeries.seasons;
 return Object.entries(selectedSeries.seasons).map(([k, v]: [string, any]) => ({ ...v, _key: k }));
 }, [selectedSeries]);

 // Get episodes for selected season
 const seasonEpisodes = useMemo(() => {
 if (selectedSeason === "all" || !seriesSeasons.length) return [];
 const s = seriesSeasons[Number(selectedSeason)];
 if (!s?.episodes) return [];
 if (Array.isArray(s.episodes)) return s.episodes;
 return Object.entries(s.episodes).map(([k, v]: [string, any]) => ({ ...v, _key: k }));
 }, [seriesSeasons, selectedSeason]);

 const replaceUrls = async () => {
 if (!selectedSeriesId) { toast.error("series select !"); return; }
 if (!oldDomain.trim() || !newDomain.trim()) { toast.error("Old and New Domain দিতে will be!"); return; }
 if (!confirm(`"${oldDomain.trim()}" → "${newDomain.trim()}" — replace ?`)) return;

 setReplacing(true);
 setReplaceResult(null);
 try {
 const snap = await get(ref(db, `webseries/${selectedSeriesId}`));
 const data = snap.val();
 if (!data?.seasons) { toast.error("this seriesে any Season none!"); setReplacing(false); return; }

 const old = oldDomain.trim();
 const nw = newDomain.trim();
 let totalLinks = 0, replacedLinks = 0;
 const linkFields = ["link", "link480", "link720", "link1080", "link4k"];

 const replaceInEp = (ep: any) => {
 const updatedEp = { ...ep };
 linkFields.forEach(field => {
 if (updatedEp[field]) { totalLinks++; if (updatedEp[field].includes(old)) { updatedEp[field] = updatedEp[field].replace(old, nw); replacedLinks++; } }
 });
 if (updatedEp.audioTracks) {
 updatedEp.audioTracks = updatedEp.audioTracks.map((at: any) => {
 const u = { ...at };
 linkFields.forEach(f => { if (u[f]) { totalLinks++; if (u[f].includes(old)) { u[f] = u[f].replace(old, nw); replacedLinks++; } } });
 return u;
 });
 }
 return updatedEp;
 };

 let updatedSeasons: any;

 if (selectedSeason === "all") {
 // Replace in all seasons
 if (Array.isArray(data.seasons)) {
 updatedSeasons = data.seasons.map((season: any) => ({
 ...season, episodes: (season.episodes || []).map((ep: any) => replaceInEp(ep)),
 }));
 } else {
 updatedSeasons = { ...data.seasons };
 for (const sk of Object.keys(updatedSeasons)) {
 const s = updatedSeasons[sk];
 if (s?.episodes) {
 if (Array.isArray(s.episodes)) {
 updatedSeasons[sk] = { ...s, episodes: s.episodes.map((ep: any) => replaceInEp(ep)) };
 } else {
 const updatedEps = { ...s.episodes };
 for (const ek of Object.keys(updatedEps)) { updatedEps[ek] = replaceInEp(updatedEps[ek]); }
 updatedSeasons[sk] = { ...s, episodes: updatedEps };
 }
 }
 }
 }
 } else if (selectedEpisode === "all") {
 // Replace in specific season only
 updatedSeasons = Array.isArray(data.seasons) ? [...data.seasons] : { ...data.seasons };
 const sIdx = Number(selectedSeason);
 if (Array.isArray(updatedSeasons)) {
 const s = { ...updatedSeasons[sIdx] };
 s.episodes = (s.episodes || []).map((ep: any) => replaceInEp(ep));
 updatedSeasons[sIdx] = s;
 } else {
 const sKeys = Object.keys(updatedSeasons);
 const sk = sKeys[sIdx];
 if (sk && updatedSeasons[sk]?.episodes) {
 const s = { ...updatedSeasons[sk] };
 if (Array.isArray(s.episodes)) {
 s.episodes = s.episodes.map((ep: any) => replaceInEp(ep));
 } else {
 const updatedEps = { ...s.episodes };
 for (const ek of Object.keys(updatedEps)) { updatedEps[ek] = replaceInEp(updatedEps[ek]); }
 s.episodes = updatedEps;
 }
 updatedSeasons[sk] = s;
 }
 }
 } else {
 // Replace in specific episode only
 updatedSeasons = Array.isArray(data.seasons) ? [...data.seasons] : { ...data.seasons };
 const sIdx = Number(selectedSeason);
 const eIdx = Number(selectedEpisode);
 if (Array.isArray(updatedSeasons)) {
 const s = { ...updatedSeasons[sIdx] };
 const eps = [...(s.episodes || [])];
 eps[eIdx] = replaceInEp(eps[eIdx]);
 s.episodes = eps;
 updatedSeasons[sIdx] = s;
 } else {
 const sKeys = Object.keys(updatedSeasons);
 const sk = sKeys[sIdx];
 if (sk && updatedSeasons[sk]?.episodes) {
 const s = { ...updatedSeasons[sk] };
 if (Array.isArray(s.episodes)) {
 const eps = [...s.episodes];
 eps[eIdx] = replaceInEp(eps[eIdx]);
 s.episodes = eps;
 } else {
 const eKeys = Object.keys(s.episodes);
 const ek = eKeys[eIdx];
 if (ek) {
 const updatedEps = { ...s.episodes };
 updatedEps[ek] = replaceInEp(updatedEps[ek]);
 s.episodes = updatedEps;
 }
 }
 updatedSeasons[sk] = s;
 }
 }
 }

 await update(ref(db, `webseries/${selectedSeriesId}`), { seasons: updatedSeasons });
 setReplaceResult({ total: totalLinks, replaced: replacedLinks });
 toast.success(`✅ ${replacedLinks}/${totalLinks} link replaced!`);
 } catch (err: any) {
 toast.error(" Error: " + err.message);
 }
 setReplacing(false);
 };

 const handleQuickPaste = () => {
 const text = quickPasteText.trim();
 if (!text) { toast.error("link Paste!"); return; }
 try {
 const url = new URL(text.split('\n')[0].trim());
 const domain = `${url.protocol}//${url.host}`;
 setOldDomain(domain);
 toast.success(`✅ domain set done: ${domain}`);
 setShowQuickPaste(false); setQuickPasteText("");
 } catch { toast.error("valid URL Paste!"); }
 };

 const handleBulkQP = () => {
 const t = bulkQP.trim();
 if (!t) { toast.error("link Paste!"); return; }
 try {
 const u = new URL(t.split('\n')[0].trim());
 setBulkOldDomain(`${u.protocol}//${u.host}`);
 toast.success(`✅ domain set: ${u.protocol}//${u.host}`);
 setShowBulkQP(false); setBulkQP("");
 } catch { toast.error("valid URL Paste!"); }
 };

 // Bulk replace all series or all movies
 const bulkReplace = async () => {
 if (!bulkOldDomain.trim() || !bulkNewDomain.trim()) { toast.error("Old and New Domain দিতে will be!"); return; }
 const targetType = bulkMode === "all-series" ? "webseries" : "movies";
 const items = bulkMode === "all-series" ? webseriesData : moviesData;
 if (!confirm(`${items.length} ${targetType === "webseries" ? "series" : "movie"}-র all link replace ?`)) return;

 setBulkReplacing(true);
 setBulkResults([]);
 const old = bulkOldDomain.trim();
 const nw = bulkNewDomain.trim();
 const results: typeof bulkResults = [];
 const linkFields = ["link", "link480", "link720", "link1080", "link4k"];

 for (const item of items) {
 try {
 const snap = await get(ref(db, `${targetType}/${item.id}`));
 const data = snap.val();
 if (!data) continue;

 let totalLinks = 0, replacedLinks = 0;

 if (targetType === "webseries" && data.seasons) {
 const processEp = (ep: any) => {
 const u = { ...ep };
 linkFields.forEach(f => { if (u[f]) { totalLinks++; if (u[f].includes(old)) { u[f] = u[f].replace(old, nw); replacedLinks++; } } });
 if (u.audioTracks) {
 u.audioTracks = u.audioTracks.map((at: any) => {
 const a = { ...at };
 linkFields.forEach(f => { if (a[f]) { totalLinks++; if (a[f].includes(old)) { a[f] = a[f].replace(old, nw); replacedLinks++; } } });
 return a;
 });
 }
 return u;
 };

 let updatedSeasons: any;
 if (Array.isArray(data.seasons)) {
 updatedSeasons = data.seasons.map((s: any) => ({ ...s, episodes: (s.episodes || []).map(processEp) }));
 } else {
 updatedSeasons = { ...data.seasons };
 for (const sk of Object.keys(updatedSeasons)) {
 const s = updatedSeasons[sk];
 if (s?.episodes) {
 if (Array.isArray(s.episodes)) {
 updatedSeasons[sk] = { ...s, episodes: s.episodes.map(processEp) };
 } else {
 const ue = { ...s.episodes };
 for (const ek of Object.keys(ue)) { ue[ek] = processEp(ue[ek]); }
 updatedSeasons[sk] = { ...s, episodes: ue };
 }
 }
 }
 }
 if (replacedLinks > 0) await update(ref(db, `webseries/${item.id}`), { seasons: updatedSeasons });
 } else if (targetType === "movies") {
 const updates: Record<string, string> = {};
 linkFields.forEach(f => {
 const field = f === "link" ? "movieLink" : `movieLink${f.replace("link", "")}`;
 const val = data[field] || data[f];
 if (val && typeof val === "string") {
 totalLinks++;
 if (val.includes(old)) {
 updates[field] = val.replace(old, nw);
 replacedLinks++;
 }
 }
 });
 if (replacedLinks > 0) await update(ref(db, `movies/${item.id}`), updates);
 }

 if (replacedLinks > 0) {
 results.push({ title: item.title || item.id, poster: item.poster || "", replaced: replacedLinks, total: totalLinks });
 setBulkResults([...results]);
 }
 } catch (err) {
 console.error(`Error processing ${item.id}:`, err);
 }
 }

 setBulkReplacing(false);
 if (results.length === 0) toast.info("any linkে this domain পা যায়নি — all skip done");
 else toast.success(`✅ ${results.length} ${targetType === "webseries" ? "series" : "movie"}-তে link replaced!`);
 };

 return (
 <div className="space-y-4">
 {/* Single Series URL Changer */}
 <div className={`${glassCard} p-4`}>
 <h3 className="text-sm font-bold mb-2 flex items-center gap-2">
 <Link size={16} className="text-cyan-400" /> 🔗 URL Changer
 </h3>
 <p className="text-[10px] text-zinc-400 mb-4">
 Replace domains for all or selected Season/Episode links of a series।
 </p>

 {/* Series Selector */}
 <label className="text-[10px] text-zinc-400 block mb-1">series select </label>
 <button onClick={() => setShowSelector(!showSelector)}
 className={`${inputClass} w-full mb-2 text-left flex items-center gap-3 py-2`}>
 {selectedSeries ? (
 <>
 <CachedImg src={selectedSeries.poster} alt="" className="w-10 h-14 rounded object-cover flex-shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
 <div className="flex-1 min-w-0">
 <p className="text-[11px] font-semibold text-white truncate">{selectedSeries.title}</p>
 <p className="text-[9px] text-zinc-500">{seriesSeasons.length} seasons</p>
 </div>
 </>
 ) : (
 <span className="text-[11px] text-zinc-500">-- series select --</span>
 )}
 <ChevronDown size={14} className={`text-zinc-400 transition-transform ${showSelector ? 'rotate-180' : ''}`} />
 </button>

 {showSelector && (
 <div className="mb-3 bg-zinc-900/95 border border-zinc-700/50 rounded-xl max-h-[300px] overflow-y-auto">
 <div className="sticky top-0 bg-zinc-900 p-2 border-b border-zinc-700/30">
 <input value={searchFilter} onChange={e => setSearchFilter(e.target.value)}
 placeholder="🔍 search ..." className={`${inputClass} text-[10px] w-full`} autoFocus />
 </div>
 {sortedSeries.map(s => (
 <button key={s.id} onClick={() => { setSelectedSeriesId(s.id); setShowSelector(false); setSearchFilter(""); setSelectedSeason("all"); setSelectedEpisode("all"); }}
 className={`w-full flex items-center gap-3 p-2.5 hover:bg-zinc-800/60 transition-all border-b border-zinc-800/30 ${selectedSeriesId === s.id ? 'bg-cyan-500/10 border-cyan-500/20' : ''}`}>
 <CachedImg src={s.poster} alt="" className="w-9 h-12 rounded object-cover flex-shrink-0 bg-zinc-800" onError={(e) => { (e.target as HTMLImageElement).src = '/placeholder.svg'; }} />
 <div className="flex-1 text-left min-w-0">
 <p className="text-[11px] font-semibold text-white truncate">{s.title}</p>
 <p className="text-[9px] text-zinc-500">{s.seasons ? (Array.isArray(s.seasons) ? s.seasons.length : Object.keys(s.seasons).length) : 0} seasons</p>
 </div>
 {selectedSeriesId === s.id && <Check size={14} className="text-cyan-400 flex-shrink-0" />}
 </button>
 ))}
 {sortedSeries.length === 0 && <p className="text-[10px] text-zinc-500 p-4 text-center">some পা যায়নি</p>}
 </div>
 )}

 {/* Season / Episode Filter */}
 {selectedSeriesId && seriesSeasons.length > 0 && (
 <div className="grid grid-cols-2 gap-2 mb-3">
 <div>
 <label className="text-[9px] text-zinc-500 block mb-1">Season</label>
 <select value={selectedSeason} onChange={e => { setSelectedSeason(e.target.value); setSelectedEpisode("all"); }}
 className={`${inputClass} text-[10px] w-full`}>
 <option value="all">all Season</option>
 {seriesSeasons.map((s: any, i: number) => (
 <option key={i} value={String(i)}>
 {s.name || `Season ${s.seasonNumber || i + 1}`}
 </option>
 ))}
 </select>
 </div>
 <div>
 <label className="text-[9px] text-zinc-500 block mb-1">episode</label>
 <select value={selectedEpisode} onChange={e => setSelectedEpisode(e.target.value)}
 className={`${inputClass} text-[10px] w-full`} disabled={selectedSeason === "all"}>
 <option value="all">all episode</option>
 {seasonEpisodes.map((ep: any, i: number) => (
 <option key={i} value={String(i)}>
 EP {ep.episodeNumber || i + 1} - {ep.title || ''}
 </option>
 ))}
 </select>
 </div>
 </div>
 )}

 {/* Quick Paste */}
 <button onClick={() => setShowQuickPaste(!showQuickPaste)}
 className="mb-3 text-[10px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1">
 <Download size={10} /> Quick Paste (extract domain from links)
 </button>
 {showQuickPaste && (
 <div className="mb-3 bg-black/20 rounded-xl border border-cyan-500/20 p-3">
 <textarea value={quickPasteText} onChange={e => setQuickPasteText(e.target.value)}
 placeholder="any video link Paste — domain auto set will be"
 className={`${inputClass} w-full min-h-[60px] resize-none text-[10px] font-mono mb-2`} />
 <button onClick={handleQuickPaste} disabled={!quickPasteText.trim()}
 className={`${btnPrimary} w-full py-2 text-[10px] flex items-center justify-center gap-1 disabled:opacity-30`}>
 <Check size={11} /> domain set 
 </button>
 </div>
 )}

 <label className="text-[10px] text-zinc-400 block mb-1">old Domain/URL</label>
 <input value={oldDomain} onChange={e => setOldDomain(e.target.value)}
 placeholder="http://fi3.bot-hosting.net:22854" className={`${inputClass} mb-3 text-[10px]`} />
 <label className="text-[10px] text-zinc-400 block mb-1">new Domain/URL</label>
 <input value={newDomain} onChange={e => setNewDomain(e.target.value)}
 placeholder="https://rahat1102-video-hosting-bot.hf.space" className={`${inputClass} mb-4 text-[10px]`} />

 <button onClick={replaceUrls} disabled={replacing || !selectedSeriesId}
 className={`${btnPrimary} w-full py-3 text-sm flex items-center justify-center gap-2`}>
 {replacing ? <><Loader2 size={14} className="animate-spin" /> replace in progress...</> : <><RefreshCw size={14} /> replace </>}
 </button>

 {replaceResult && (
 <div className="mt-3 p-3 rounded-xl bg-green-500/10 border border-green-500/30">
 <p className="text-[11px] font-semibold text-green-400">
 ✅ Total {replaceResult.total} link মধ্which {replaceResult.replaced} replaced!
 {selectedSeason !== "all" && <span className="text-zinc-400 ml-1">(Season {Number(selectedSeason) + 1}{selectedEpisode !== "all" ? `, EP ${Number(selectedEpisode) + 1}` : ""})</span>}
 </p>
 </div>
 )}
 </div>

 {/* Quick Presets */}
 <div className={`${glassCard} p-4`}>
 <h4 className="text-xs font-bold text-white mb-3">⚡ Quick Presets</h4>
 <div className="space-y-2">
 <button onClick={() => { setOldDomain("http://fi3.bot-hosting.net:22854"); setNewDomain("https://rahat1102-video-hosting-bot.hf.space"); setBulkOldDomain("http://fi3.bot-hosting.net:22854"); setBulkNewDomain("https://rahat1102-video-hosting-bot.hf.space"); }}
 className="w-full text-left p-2.5 rounded-xl bg-zinc-800/40 border border-zinc-700/40 hover:border-cyan-500/30 transition-all">
 <p className="text-[10px] font-semibold text-white">Bot Hosting → HF Space</p>
 <p className="text-[9px] text-zinc-500 mt-0.5">fi3.bot-hosting.net → hf.space</p>
 </button>
 <button onClick={() => { setOldDomain("https://rahat1102-video-hosting-bot.hf.space"); setNewDomain("http://fi3.bot-hosting.net:22854"); setBulkOldDomain("https://rahat1102-video-hosting-bot.hf.space"); setBulkNewDomain("http://fi3.bot-hosting.net:22854"); }}
 className="w-full text-left p-2.5 rounded-xl bg-zinc-800/40 border border-zinc-700/40 hover:border-cyan-500/30 transition-all">
 <p className="text-[10px] font-semibold text-white">HF Space → Bot Hosting</p>
 <p className="text-[9px] text-zinc-500 mt-0.5">hf.space → fi3.bot-hosting.net</p>
 </button>
 </div>
 </div>

 {/* ===== BULK ALL SERIES / ALL MOVIES ===== */}
 <div className={`${glassCard} p-4`}>
 <h4 className="text-xs font-bold text-white mb-3 flex items-center gap-2">🚀 Bulk Replace — All Series / all movie</h4>
 <p className="text-[9px] text-zinc-400 mb-3">with All Series or all movieর link domain replace । যেতে domain none সে skip will be।</p>

 <div className="flex gap-2 mb-3">
 <button onClick={() => setBulkMode(bulkMode === "all-series" ? "off" : "all-series")}
 className={`flex-1 py-2.5 text-xs font-bold rounded-xl border transition-all flex items-center justify-center gap-1.5 ${bulkMode === "all-series" ? "bg-purple-600 border-purple-500 text-white" : "bg-zinc-800/40 border-zinc-700/40 text-zinc-400 hover:text-white"}`}>
 📺 All Series ({webseriesData.length})
 </button>
 <button onClick={() => setBulkMode(bulkMode === "all-movies" ? "off" : "all-movies")}
 className={`flex-1 py-2.5 text-xs font-bold rounded-xl border transition-all flex items-center justify-center gap-1.5 ${bulkMode === "all-movies" ? "bg-orange-600 border-orange-500 text-white" : "bg-zinc-800/40 border-zinc-700/40 text-zinc-400 hover:text-white"}`}>
 🎬 All Movies ({moviesData.length})
 </button>
 </div>

 {bulkMode !== "off" && (
 <div className="space-y-3">
 {/* Bulk Quick Paste */}
 <button onClick={() => setShowBulkQP(!showBulkQP)}
 className="text-[10px] text-purple-400 hover:text-purple-300 flex items-center gap-1">
 <Download size={10} /> Quick Paste
 </button>
 {showBulkQP && (
 <div className="bg-black/20 rounded-xl border border-purple-500/20 p-2.5">
 <textarea value={bulkQP} onChange={e => setBulkQP(e.target.value)}
 placeholder="any video link Paste " className={`${inputClass} w-full min-h-[50px] resize-none text-[10px] font-mono mb-2`} />
 <button onClick={handleBulkQP} disabled={!bulkQP.trim()}
 className={`${btnPrimary} w-full py-1.5 text-[10px] flex items-center justify-center gap-1 disabled:opacity-30`}>
 <Check size={11} /> domain set 
 </button>
 </div>
 )}

 <input value={bulkOldDomain} onChange={e => setBulkOldDomain(e.target.value)}
 placeholder="old Domain" className={`${inputClass} text-[10px]`} />
 <input value={bulkNewDomain} onChange={e => setBulkNewDomain(e.target.value)}
 placeholder="new Domain" className={`${inputClass} text-[10px]`} />

 <button onClick={bulkReplace} disabled={bulkReplacing}
 className={`${btnPrimary} w-full py-3 text-sm flex items-center justify-center gap-2 ${bulkMode === "all-series" ? "bg-gradient-to-r from-purple-600 to-indigo-600" : "bg-gradient-to-r from-orange-600 to-red-600"}`}>
 {bulkReplacing ? <><Loader2 size={14} className="animate-spin" /> replace in progress...</> : <><RefreshCw size={14} /> {bulkMode === "all-series" ? "All Seriesে" : "all movieতে"} replace </>}
 </button>

 {/* Bulk Results */}
 {bulkResults.length > 0 && (
 <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
 <p className="text-[10px] text-green-400 font-bold">✅ {bulkResults.length} contentে replaced:</p>
 {bulkResults.map((r, i) => (
 <div key={i} className="flex items-center gap-2.5 bg-green-500/10 border border-green-500/20 rounded-lg p-2">
 {r.poster && <CachedImg src={r.poster} alt="" className="w-8 h-11 rounded object-cover flex-shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
 <div className="flex-1 min-w-0">
 <p className="text-[10px] font-semibold text-white truncate">{r.title}</p>
 <p className="text-[9px] text-green-400">{r.replaced}/{r.total} link replace</p>
 </div>
 </div>
 ))}
 </div>
 )}
 </div>
 )}
 </div>
 </div>
 );
 };
 return <UrlChangerAdmin />;
 })()}

 {activeSection === "link-checker" && (
 <LinkCheckerSection
 glassCard={glassCard}
 btnPrimary={btnPrimary}
 webseriesData={webseriesData}
 moviesData={moviesData}
 />
 )}

 {/* ==================== VIDEO SERVERS ==================== */}
 {activeSection === "video-servers" && (() => {
 const VideoServersSection = () => {
 const [servers, setServers] = useState<{ name: string; domain: string; locked?: boolean }[]>([]);
 const [vsLoading, setVsLoading] = useState(true);
 const [newName, setNewName] = useState("");
 const [newDomain, setNewDomain] = useState("");

 useEffect(() => {
 const unsub = onValue(ref(db, "settings/videoServers"), (snap) => {
 const val = snap.val();
 if (val && Array.isArray(val)) {
 setServers(val.filter((s: any) => s && s.domain));
 } else if (val && typeof val === "object") {
 const arr = Object.values(val).filter((s: any) => s && s.domain) as any[];
 setServers(arr);
 } else {
 setServers([]);
 }
 setVsLoading(false);
 });
 return () => unsub();
 }, []);

 const saveServers = async (updated: { name: string; domain: string; locked?: boolean }[]) => {
 await set(ref(db, "settings/videoServers"), updated);
 toast.success("✅ Server list saved!");
 };

 const addServer = () => {
 if (!newDomain.trim()) { toast.error("Enter domain!"); return; }
 const updated = [...servers, { name: newName.trim() || `Server ${servers.length + 1}`, domain: newDomain.trim(), locked: false }];
 saveServers(updated);
 setNewName("");
 setNewDomain("");
 };

 const toggleLocked = (idx: number) => {
 const updated = [...servers];
 updated[idx] = { ...updated[idx], locked: !updated[idx].locked };
 saveServers(updated);
 };

 const removeServer = (idx: number) => {
 const updated = servers.filter((_, i) => i !== idx);
 saveServers(updated);
 };

 const moveServer = (idx: number, dir: -1 | 1) => {
 const newIdx = idx + dir;
 if (newIdx < 0 || newIdx >= servers.length) return;
 const updated = [...servers];
 [updated[idx], updated[newIdx]] = [updated[newIdx], updated[idx]];
 saveServers(updated);
 };

 return (
 <div>
 <div className={`${glassCard} p-4 mb-4`}>
 <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
 <Activity size={14} className="text-cyan-400" /> video server manageার
 </h3>
 <p className="text-[11px] text-zinc-400 mb-4">
 Add at least 2 servers to show the server-switch button in the video player। only domain change will be, file পাথ কthis থাকবে।
 </p>

 {vsLoading ? (
 <div className="flex justify-center py-6"><div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" /></div>
 ) : servers.length === 0 ? (
 <p className="text-zinc-500 text-[11px] text-center py-4 mb-4">any server none। নিচে from add ।</p>
 ) : (
 <div className="space-y-2 mb-4">
 {servers.map((srv, idx) => (
 <div key={idx} className="flex items-center gap-2 p-2.5 bg-zinc-800/40 rounded-xl border border-zinc-700/30">
 <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500/20 to-blue-500/20 flex items-center justify-center flex-shrink-0">
 <span className="text-[11px] font-bold text-cyan-300">S{idx + 1}</span>
 </div>
 <div className="flex-1 min-w-0">
 <span className="text-[12px] font-medium block truncate flex items-center gap-1">
 {srv.name}
 {srv.locked && <span className="text-[9px] px-1.5 py-0.5 bg-amber-500/20 text-amber-400 rounded-md font-bold">PREMIUM</span>}
 </span>
 <span className="text-[10px] text-zinc-500 block truncate">{srv.domain}</span>
 </div>
 <div className="flex items-center gap-1">
 <button onClick={() => toggleLocked(idx)} title={srv.locked ? "Unlock (make free)" : "Lock (premium only)"}
 className={`p-1 rounded ${srv.locked ? "text-amber-400 hover:text-amber-300" : "text-zinc-500 hover:text-zinc-300"}`}>
 {srv.locked ? <Lock size={13} /> : <Unlock size={13} />}
 </button>
 <button onClick={() => moveServer(idx, -1)} disabled={idx === 0} className="text-zinc-400 hover:text-white p-1 disabled:opacity-30">
 <ChevronLeft size={12} />
 </button>
 <button onClick={() => moveServer(idx, 1)} disabled={idx === servers.length - 1} className="text-zinc-400 hover:text-white p-1 disabled:opacity-30">
 <ChevronRight size={12} />
 </button>
 <button onClick={() => removeServer(idx)} className="text-red-400 hover:text-red-300 p-1">
 <Trash2 size={13} />
 </button>
 </div>
 </div>
 ))}
 </div>
 )}

 <div className="border border-dashed border-zinc-700 rounded-xl p-3 space-y-2">
 <p className="text-[11px] text-zinc-400 font-medium">➕ new server add </p>
 <input value={newName} onChange={e => setNewName(e.target.value)} className={inputClass} placeholder="server name (such as: Server 1)" />
 <input value={newDomain} onChange={e => setNewDomain(e.target.value)} className={inputClass} placeholder="domain (such as: https://example.com)" />
 <button onClick={addServer} className={`${btnPrimary} w-full py-2.5 text-[12px] font-semibold flex items-center justify-center gap-2`}>
 <Plus size={14} /> server add 
 </button>
 </div>
 </div>

 <div className={`${glassCard} p-4`}>
 <h4 className="text-xs font-semibold mb-2 text-zinc-300">📖 how to task করে?</h4>
 <ul className="text-[11px] text-zinc-400 space-y-1.5 list-disc list-inside">
 <li>With at least 2 servers, the player shows a "Server" button</li>
 <li>Switching server only changes the domain — channel/file ID stays the same</li>
 <li>example: <code className="text-cyan-400">https://s1.example.com</code>/8866/file.mkv → <code className="text-cyan-400">https://s2.example.com</code>/8866/file.mkv</li>
 </ul>
 </div>
 </div>
 );
 };
 return <VideoServersSection />;
 })()}

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

 {/* ==================== WEEKLY EPISODE ==================== */}
 {activeSection === "weekly-episode" && (
 <WeeklyEpisodeManager
 webseriesData={webseriesData}
 glassCard={glassCard}
 inputClass={inputClass}
 selectClass={selectClass}
 btnPrimary={btnPrimary}
 btnSecondary={btnSecondary}
 onEditSeries={(id) => editSeries(id)}
 />
 )}


  {activeSection === "analytics" && (
  <AnalyticsSection
  glassCard={glassCard}
  analyticsViews={analyticsViews}
  activeViewers={activeViewers}
  dailyActiveUsers={dailyActiveUsers}
  webseriesData={webseriesData}
  moviesData={moviesData}
  />
  )}

 </main>

 {/* Bottom Navigation */}
 <nav className="fixed bottom-0 left-0 right-0 h-[58px] bg-[#0D0D1A]/95 border-t border-white/6 flex items-center justify-around z-[100] px-1">
 {[
 { section: "dashboard" as Section, icon: <LayoutDashboard size={18} />, label: "Dashboard" },
 { section: "webseries" as Section, icon: <Film size={18} />, label: "Series" },
 { section: "weekly-episode" as Section, icon: <CalendarDays size={18} />, label: "Weekly" },
 { section: "movies" as Section, icon: <Video size={18} />, label: "Movies" },
 { section: "telegram-post" as Section, icon: <Send size={18} />, label: "Telegram" },
 ].map(item => (
 <div key={item.section} onClick={() => showSection(item.section)}
 className={`flex flex-col items-center gap-0.5 py-2 px-2 cursor-pointer relative transition-colors ${
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

// ───────────────────────────────────────────────────────────────────
// AnalyticsSection — memoized, indexed, virtualized for ultra-smooth UI
// ───────────────────────────────────────────────────────────────────
const AnalyticsSection = memo(({
 glassCard, analyticsViews, activeViewers, dailyActiveUsers, webseriesData, moviesData,
}: {
 glassCard: string;
 analyticsViews: Record<string, any>;
 activeViewers: Record<string, any>;
 dailyActiveUsers: Record<string, any>;
 webseriesData: any[];
 moviesData: any[];
}) => {
 const today = useMemo(() => new Date().toISOString().split("T")[0], []);

 // O(1) lookup maps — built once per data change instead of .find() per row.
 const titleIndex = useMemo(() => {
 const m = new Map<string, { title: string; poster: string }>();
 for (const w of webseriesData) m.set(w.id, { title: w.title || w.id, poster: w.poster || "" });
 for (const v of moviesData) if (!m.has(v.id)) m.set(v.id, { title: v.title || v.id, poster: v.poster || "" });
 return m;
 }, [webseriesData, moviesData]);

 const todayUsers = useMemo(() => {
 const map = dailyActiveUsers[today] || {};
 const arr: { uid: string; userName: string; lastSeen: number }[] = [];
 for (const uid in map) {
 const d = map[uid];
 arr.push({ uid, userName: d?.userName || "User", lastSeen: Number(d?.lastSeen || 0) });
 }
 arr.sort((a, b) => b.lastSeen - a.lastSeen);
 return arr;
 }, [dailyActiveUsers, today]);

 const totalCurrentViewers = useMemo(() => {
 let n = 0;
 for (const k in activeViewers) {
 const u = activeViewers[k];
 if (u) n += Object.keys(u).length;
 }
 return n;
 }, [activeViewers]);

 const { contentViewStats, totalTodayViews, maxViewCount } = useMemo(() => {
 const stats: { animeId: string; title: string; viewCount: number; poster: string }[] = [];
 let total = 0;
 for (const aId in analyticsViews) {
 const todayData = analyticsViews[aId]?.[today];
 if (!todayData) continue;
 const count = Object.keys(todayData).length;
 total += count;
 const meta = titleIndex.get(aId);
 stats.push({
 animeId: aId,
 title: meta?.title || aId,
 viewCount: count,
 poster: meta?.poster || "",
 });
 }
 stats.sort((a, b) => b.viewCount - a.viewCount);
 return { contentViewStats: stats, totalTodayViews: total, maxViewCount: stats[0]?.viewCount || 1 };
 }, [analyticsViews, today, titleIndex]);

 // Re-render once a minute for "Last seen" labels — no per-second ticks.
 const [nowTick, setNowTick] = useState(0);
 useEffect(() => {
 const id = setInterval(() => setNowTick(t => t + 1), 60_000);
 return () => clearInterval(id);
 }, []);
 const formatTimeAgo = useCallback((ts: number) => {
 if (!ts) return "—";
 const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
 if (s < 60) return `${s}s ago`;
 const m = Math.floor(s / 60);
 if (m < 60) return `${m}m ago`;
 return `${Math.floor(m / 60)}h ago`;
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [nowTick]);

 // Cap rendered rows so a viral day with 1000+ animes doesn't kill the DOM.
 const MAX_ROWS = 100;
 const visibleStats = contentViewStats.length > MAX_ROWS ? contentViewStats.slice(0, MAX_ROWS) : contentViewStats;
 const visibleUsers = todayUsers.length > MAX_ROWS ? todayUsers.slice(0, MAX_ROWS) : todayUsers;

 return (
 <div style={{ contain: "content" }}>
 <div className="grid grid-cols-3 gap-3 mb-5">
 <div className="bg-gradient-to-br from-[#1A1A2E] to-[#151521] border border-purple-500/20 rounded-2xl p-4">
 <div className="w-10 h-10 bg-purple-500/15 rounded-xl flex items-center justify-center mb-2 text-purple-400"><Users size={18} /></div>
 <div className="text-2xl font-extrabold bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-transparent">{todayUsers.length}</div>
 <div className="text-[10px] text-[#D1C4E9] mt-1">Today's Users</div>
 </div>
 <div className="bg-gradient-to-br from-[#1A1A2E] to-[#151521] border border-blue-500/20 rounded-2xl p-4">
 <div className="w-10 h-10 bg-blue-500/15 rounded-xl flex items-center justify-center mb-2 text-blue-400"><Eye size={18} /></div>
 <div className="text-2xl font-extrabold text-blue-400">{totalTodayViews}</div>
 <div className="text-[10px] text-[#D1C4E9] mt-1">Today's Total Views</div>
 </div>
 <div className="bg-gradient-to-br from-[#1A1A2E] to-[#151521] border border-green-500/20 rounded-2xl p-4">
 <div className="w-10 h-10 bg-green-500/15 rounded-xl flex items-center justify-center mb-2 text-green-400"><Activity size={18} /></div>
 <div className="text-2xl font-extrabold text-green-400">{totalCurrentViewers}</div>
 <div className="text-[10px] text-[#D1C4E9] mt-1">Watching Now</div>
 </div>
 </div>

 <div className={`${glassCard} p-4 mb-4`} style={{ contain: "content" }}>
 <h3 className="text-sm font-semibold mb-3.5 flex items-center gap-2">
 <Users size={14} className="text-purple-400" /> Today's Active Users
 <span className="ml-auto text-[11px] bg-purple-500/15 text-purple-300 px-2 py-0.5 rounded-full font-bold">{todayUsers.length}</span>
 </h3>
 {visibleUsers.length === 0 ? (
 <p className="text-[#957DAD] text-[13px] text-center py-5">No user activity yet today</p>
 ) : (
 <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1" style={{ contentVisibility: "auto" } as any}>
 {visibleUsers.map((u, idx) => (
 <div key={u.uid} className="flex items-center gap-3 bg-[#1A1A2E] rounded-xl p-2.5 border border-white/5">
 <span className="text-[11px] text-[#957DAD] font-bold w-6 text-center">#{idx + 1}</span>
 <div className="w-9 h-9 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-xs font-bold text-white shrink-0">
 {(u.userName || "?").trim().charAt(0).toUpperCase()}
 </div>
 <div className="flex-1 min-w-0">
 <p className="text-[13px] font-semibold truncate text-white">{u.userName}</p>
 <p className="text-[10px] text-[#957DAD]">Last seen {formatTimeAgo(u.lastSeen)}</p>
 </div>
 <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
 </div>
 ))}
 {todayUsers.length > MAX_ROWS && (
 <div className="text-center text-[10px] text-[#957DAD] py-2">+{todayUsers.length - MAX_ROWS} more</div>
 )}
 </div>
 )}
 </div>

 <div className={`${glassCard} p-4 mb-4`} style={{ contain: "content" }}>
 <h3 className="text-sm font-semibold mb-3.5 flex items-center gap-2">
 <Film size={14} className="text-pink-400" /> Today's Anime Views
 <span className="ml-auto text-[11px] bg-pink-500/15 text-pink-300 px-2 py-0.5 rounded-full font-bold">{contentViewStats.length}</span>
 </h3>
 {visibleStats.length === 0 ? (
 <p className="text-[#957DAD] text-[13px] text-center py-5">No views today yet</p>
 ) : (
 <div className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1" style={{ contentVisibility: "auto" } as any}>
 {visibleStats.map((item, idx) => (
 <div key={item.animeId} className="flex items-center gap-3 bg-[#1A1A2E] rounded-xl p-3 border border-white/5">
 <span className="text-[11px] text-[#957DAD] font-bold w-5">#{idx + 1}</span>
 {item.poster ? (
 <CachedImg src={item.poster} loading="lazy" decoding="async" className="w-9 h-[52px] rounded-lg object-cover flex-shrink-0"
 onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
 ) : (
 <div className="w-9 h-[52px] rounded-lg bg-purple-500/20 flex items-center justify-center flex-shrink-0">
 <Film size={14} className="text-purple-400" />
 </div>
 )}
 <div className="flex-1 min-w-0">
 <p className="text-[12px] font-semibold truncate text-white">{item.title}</p>
 <div className="w-full h-1.5 bg-[#0F0F1A] rounded-full mt-1.5 overflow-hidden">
 <div className="h-full rounded-full bg-gradient-to-r from-purple-600 to-pink-500"
 style={{ width: `${Math.min(100, (item.viewCount / maxViewCount) * 100)}%` }} />
 </div>
 </div>
 <span className="text-sm font-bold text-pink-400 flex-shrink-0 tabular-nums">{item.viewCount}</span>
 </div>
 ))}
 {contentViewStats.length > MAX_ROWS && (
 <div className="text-center text-[10px] text-[#957DAD] py-2">+{contentViewStats.length - MAX_ROWS} more</div>
 )}
 </div>
 )}
 </div>

 <div className="text-[10px] text-[#957DAD] text-center pt-2 pb-1">
 Showing today's activity only · resets every 24h
 </div>
 </div>
 );
});
AnalyticsSection.displayName = "AnalyticsSection";



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
 userName: "Admin",
 });
 await update(ref(db, `supportChats/${selectedChat}/meta`), {
 lastMessage: `Admin: ${replyText.trim()}`,
 lastTimestamp: Date.now(),
 });
 setReplyText("");
 toast.success("রিপ্লাthis send done");
 } catch {
 toast.error("রিপ্লাthis পাঠাতে failed");
 }
 };

 const deleteChat = async (userId: string) => {
 if (!confirm("this চ্যাট মুছে ফেলবেন?")) return;
 try {
 await remove(ref(db, `supportChats/${userId}`));
 if (selectedChat === userId) setSelectedChat(null);
 toast.success("চ্যাট মুছে ফেলা done");
 } catch {
 toast.error("মুছতে failed");
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
 <ChevronLeft size={14} /> all চ্যাটে ফিরুন
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
 placeholder="admin রিপ্লাthis লিখুন..."
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
 <p className="text-xs text-zinc-500 text-center py-6">any support message none</p>
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
 userName: "Admin",
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

 // FCM push removed — in-app notification (above) is enough
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
 toast.info(`"${item.name || item.title}" already exists!`);
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
 TMDB Browse anime and auto-import to the database with one click। video link after manually ড to do will be।
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
const normalizeAnimeSaltManagerType = (value: unknown): "series" | "movies" => {
 const raw = String(value || "").trim().toLowerCase();
 return raw === "movie" || raw === "movies" ? "movies" : "series";
};

const normalizeAnimeSaltManagerItem = (item: any) => ({
 ...item,
 slug: String(item?.slug || item?.id || "").trim(),
 title: String(item?.title || item?.name || item?.slug || "Untitled").trim(),
 poster: String(item?.poster || item?.image || item?.thumb || "").trim(),
 year: String(item?.year || "").trim(),
 type: normalizeAnimeSaltManagerType(item?.type),
});

const normalizeAnimeSaltAudioTracks = (tracks: any, defaultAudio?: any) => {
 const list = Array.isArray(tracks)
 ? tracks
 : tracks && typeof tracks === "object"
 ? Object.values(tracks)
 : defaultAudio
 ? [defaultAudio]
 : [];
 const cleaned = list.map((track: any, index: number) => {
 const label = String(track?.label || track?.name || track?.language || `Audio ${index + 1}`).trim();
 const language = String(track?.language || track?.label || label).trim();
 const link = String(track?.link || track?.audioUrl || track?.rawAudioUrl || track?.url || track?.uri || "").trim();
 return {
 language,
 label,
 link,
 audioUrl: String(track?.audioUrl || link || "").trim(),
 rawAudioUrl: String(track?.rawAudioUrl || link || "").trim(),
 isDefault: track?.isDefault === true,
 };
 }).filter((track: any) => track.label || track.language || track.link);
 if (cleaned.length > 0 && !cleaned.some((track: any) => track.isDefault)) {
 const hindiIdx = cleaned.findIndex((track: any) => /hindi|हिन्दी|हिंदी|\bhin\b/i.test(`${track.language} ${track.label}`));
 cleaned[Math.max(0, hindiIdx)].isDefault = true;
 }
 return cleaned;
};

const buildAnimeSaltEditorAudioTrack = (track: any = {}, index = 0, isDefault = false) => {
 const label = String(track?.label || track?.name || track?.language || (isDefault ? "Hindi / Default" : `Audio ${index + 1}`)).trim();
 const language = String(track?.language || (isDefault ? "Hindi" : label)).trim();
 const link = String(track?.link || track?.audioUrl || track?.rawAudioUrl || track?.url || track?.uri || "").trim();
 return {
 language,
 label,
 link,
 audioUrl: String(track?.audioUrl || link || "").trim(),
 rawAudioUrl: String(track?.rawAudioUrl || link || "").trim(),
 isDefault,
 };
};

const normalizeAnimeSaltEditorEpisode = (ep: any = {}, eIdx = 0) => {
 const tracks = normalizeAnimeSaltAudioTracks(ep?.audioTracks, ep?.defaultAudio);
 const audioTracks = tracks.length > 0 ? tracks : [buildAnimeSaltEditorAudioTrack({}, 0, true)];
 const defaultIndex = audioTracks.findIndex((track: any) => track?.isDefault);
 const resolvedAudioTracks = audioTracks.map((track: any, idx: number) => ({
 ...track,
 isDefault: defaultIndex >= 0 ? idx === defaultIndex : idx === 0,
 }));
 const defaultAudio = resolvedAudioTracks.find((track: any) => track?.isDefault) || resolvedAudioTracks[0] || null;
 return {
 number: ep?.number || ep?.episodeNumber || eIdx + 1,
 title: ep?.title || `Episode ${ep?.number || ep?.episodeNumber || eIdx + 1}`,
 slug: ep?.slug || "",
 hasAnimeSaltLink: !!ep?.slug || !!ep?.hasAnimeSaltLink,
 link: ep?.link || "",
 link480: ep?.link480 || ep?.qualityLinks?.p480 || "",
 link720: ep?.link720 || ep?.qualityLinks?.p720 || "",
 link1080: ep?.link1080 || ep?.qualityLinks?.p1080 || "",
 link4k: ep?.link4k || ep?.qualityLinks?.p4k || "",
 audioTracks: resolvedAudioTracks,
 defaultAudio,
 subtitleTracks: Array.isArray(ep?.subtitleTracks) ? ep.subtitleTracks : [],
 };
};

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
 const [animeSaltGlobalEnabled, setAnimeSaltGlobalEnabled] = useState(true);

 // Episode preloader state
 const [preloading, setPreloading] = useState(false);
 const [preloadProgress, setPreloadProgress] = useState({ current: 0, total: 0, currentTitle: "" });
 const [preloadFailed, setPreloadFailed] = useState<{ slug: string; title: string; reason: string }[]>([]);
 const [preloadDone, setPreloadDone] = useState(false);
 const [preloadDeleting, setPreloadDeleting] = useState(false);

 // Listen to global AnimeSalt enabled state
 useEffect(() => {
 const unsub = onValue(ref(db, "settings/animeSaltEnabled"), (snap) => {
 const val = snap.val();
 setAnimeSaltGlobalEnabled(val !== false);
 });
 return () => unsub();
 }, []);

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
 const [epEditorSeasons, setEpEditorSeasons] = useState<any[]>([]);
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
 setAllItems(result.items.map(normalizeAnimeSaltManagerItem).filter((item: any) => item.slug));
 }
 } catch (err) {
 console.error('AnimeSalt load failed:', err);
 toast.error('AnimeSalt data load to do সমস্যা');
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
 toast.success('AnimeSalt data refresh done!');
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
 toast.error('Category Select!');
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

  const existingSelected = selectedItems[item.slug] || {};
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
  customSeasons: Array.isArray(existingSelected?.customSeasons) ? existingSelected.customSeasons : (Array.isArray(item?.customSeasons) ? item.customSeasons : []),
  episodeOverrides: existingSelected?.episodeOverrides || null,
 addedAt: item._rematch ? (selectedItems[item.slug]?.addedAt || Date.now()) : Date.now(),
 });
 toast.success(item._rematch ? `✅ "${item.title}" TMDB update done!` : `✅ "${item.title}" add done!`);
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
 toast.info('TMDB তে any result পা যায়নি');
 }
 } catch {
 toast.error('TMDB search failed');
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
 toast.success('✅ TMDB data প্রয়োগ done! save ।');
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
 toast.success('✅ update save done!');
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
  setEpEditorSeasons(saved.map((season: any, sIdx: number) => ({
  ...season,
  name: season?.name || `Season ${sIdx + 1}`,
  episodes: (Array.isArray(season?.episodes) ? season.episodes : []).map((ep: any, eIdx: number) => normalizeAnimeSaltEditorEpisode(ep, eIdx)),
  })));
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
  episodes: (Array.isArray(s?.episodes) ? s.episodes : []).map((ep: any, eIdx: number) => normalizeAnimeSaltEditorEpisode(ep, eIdx)),
 })));
 } else {
 toast.error('No episodes found');
 }
 } catch (err: any) {
 toast.error('episode load failed: ' + err.message);
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
  episodes: (Array.isArray(s?.episodes) ? s.episodes : []).map((ep: any, eIdx: number) => normalizeAnimeSaltEditorEpisode(ep, eIdx)),
 }));
 // Merge: add only seasons not already present by name
 setEpEditorSeasons(prev => {
 const existingNames = new Set(prev.map(s => s.name));
 const newSeasons = apiSeasons.filter((s: any) => !existingNames.has(s.name));
 if (newSeasons.length === 0) {
 toast.info('all Season already exists');
 return prev;
 }
 toast.success(`${newSeasons.length} Season load done!`);
 return [...prev, ...newSeasons];
 });
 } else {
 toast.error('AnimeSalt from Season পা যায়নি');
 }
 } catch {
 toast.error('AnimeSalt load failed');
 }
 };

 const epAddSeason = () => {
 setEpEditorSeasons(prev => [...prev, {
 name: `Season ${prev.length + 1}`,
  episodes: [normalizeAnimeSaltEditorEpisode({}, 0)],
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
  episodes: (Array.isArray(s?.episodes) ? s.episodes : []).map((ep: any, eIdx: number) => normalizeAnimeSaltEditorEpisode({ ...ep, slug: '', hasAnimeSaltLink: false }, eIdx)),
 }));
 setEpEditorSeasons(prev => {
 const updated = [...prev, ...newSeasons];
 // Auto-expand first new season
 setEpEditorExpandedSeason(prev.length);
 return updated;
 });
 toast.success(`${newSeasons.length} Season JSON from import done!`);
 setJsonImportMode(false);
 setJsonPasteText('');
 return;
 } else {
 toast.error('Invalid JSON format. An episodes or seasons array is required.');
 return;
 }

 if (episodes.length === 0) {
 toast.error('No episodes found in the JSON');
 return;
 }

  const mappedEpisodes = episodes.map((ep: any, eIdx: number) => normalizeAnimeSaltEditorEpisode({ ...ep, slug: '', hasAnimeSaltLink: false }, eIdx));

 const newSeason = {
 name: seasonName || `Season ${epEditorSeasons.length + 1}`,
 episodes: mappedEpisodes,
 };
 setEpEditorSeasons(prev => {
 const newIdx = prev.length;
 setEpEditorExpandedSeason(newIdx);
 return [...prev, newSeason];
 });
 toast.success(`${mappedEpisodes.length} episodes imported from JSON!`);
 setJsonImportMode(false);
 setJsonPasteText('');
 } catch (err: any) {
 toast.error('JSON পার্স failed: ' + err.message);
 }
 };

 const handleJsonPaste = () => {
 if (!jsonPasteText.trim()) { toast.error('Paste JSON text'); return; }
 try {
 const parsed = JSON.parse(jsonPasteText.trim());
 parseJsonEpisodes(parsed);
 } catch {
 toast.error('invalid JSON। valid JSON formatে day।');
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
 if (failed > 0) toast.error(`${failed} file পার্স failed`);
 if (processed > 0) toast.success(`${processed} file successfully import done`);
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
 toast.error('Invalid JSON. An episodes array is required.');
 return;
 }
 if (episodes.length === 0) { toast.error('No episodes found'); return; }
  const mapped = episodes.map((ep: any, eIdx: number) => normalizeAnimeSaltEditorEpisode({ ...ep, slug: '', hasAnimeSaltLink: false }, eIdx));
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
 toast.success(`${mapped.length} episode "${epEditorSeasons[sIdx]?.name}" Seasonে import done!`);
 } catch (err: any) {
 toast.error('JSON পার্স failed: ' + err.message);
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
  allEpisodes.push(normalizeAnimeSaltEditorEpisode({ ...ep, slug: '', hasAnimeSaltLink: false }, eIdx));
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
 if (failed > 0) toast.error(`${failed} file পার্স failed`);
 toast.success(`${allEpisodes.length} episode import done (${processed} file from)`);
 }
 };
 reader.readAsText(file);
 });
 if (epSeasonJsonFileRef.current) epSeasonJsonFileRef.current.value = '';
 setEpSeasonJsonTarget(-1);
 };

 const epRemoveSeason = (sIdx: number) => {
 if (!confirm(`"${epEditorSeasons[sIdx]?.name}" Season delete Continue?`)) return;
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
  const s = { ...copy[sIdx], episodes: [...(Array.isArray(copy[sIdx]?.episodes) ? copy[sIdx].episodes : [])] };
 const num = s.episodes.length + 1;
  s.episodes.push(normalizeAnimeSaltEditorEpisode({ number: num, title: `Episode ${num}` }, num - 1));
 copy[sIdx] = s;
 return copy;
 });
 };

 const epRemoveEpisode = (sIdx: number, eIdx: number) => {
 if (!confirm('this episode delete Continue?')) return;
 setEpEditorSeasons(prev => {
 const copy = [...prev];
  const s = { ...copy[sIdx], episodes: (Array.isArray(copy[sIdx]?.episodes) ? copy[sIdx].episodes : []).filter((_: any, i: number) => i !== eIdx) };
 s.episodes = s.episodes.map((ep: any, i: number) => ({ ...ep, number: i + 1 }));
 copy[sIdx] = s;
 return copy;
 });
 };

 const epUpdateEpisodeField = (sIdx: number, eIdx: number, field: string, value: any) => {
 setEpEditorSeasons(prev => {
 const copy = [...prev];
  const s = { ...copy[sIdx], episodes: [...(Array.isArray(copy[sIdx]?.episodes) ? copy[sIdx].episodes : [])] };
 s.episodes[eIdx] = { ...s.episodes[eIdx], [field]: value };
 copy[sIdx] = s;
 return copy;
 });
 };

  const epUpdateAudioTrack = (sIdx: number, eIdx: number, aIdx: number, field: string, value: any) => {
  setEpEditorSeasons(prev => {
  const copy = [...prev];
  const s = { ...copy[sIdx], episodes: [...(Array.isArray(copy[sIdx]?.episodes) ? copy[sIdx].episodes : [])] };
  const ep = normalizeAnimeSaltEditorEpisode(s.episodes[eIdx] || {}, eIdx);
  const tracks = [...(Array.isArray(ep.audioTracks) ? ep.audioTracks : [])];
  const existingTrack = tracks[aIdx] || buildAnimeSaltEditorAudioTrack({}, aIdx, aIdx === 0);
  tracks[aIdx] = field === 'link'
  ? { ...existingTrack, link: value, audioUrl: value, rawAudioUrl: value }
  : { ...existingTrack, [field]: value };
  const normalized = normalizeAnimeSaltAudioTracks(tracks);
  const defaultAudio = normalized.find((track: any) => track?.isDefault) || normalized[0] || null;
  s.episodes[eIdx] = { ...ep, audioTracks: normalized, defaultAudio };
  copy[sIdx] = s;
  return copy;
  });
  };

  const epAddAudioTrack = (sIdx: number, eIdx: number) => {
  setEpEditorSeasons(prev => {
  const copy = [...prev];
  const s = { ...copy[sIdx], episodes: [...(Array.isArray(copy[sIdx]?.episodes) ? copy[sIdx].episodes : [])] };
  const ep = normalizeAnimeSaltEditorEpisode(s.episodes[eIdx] || {}, eIdx);
  const tracks = [...(Array.isArray(ep.audioTracks) ? ep.audioTracks : [])];
  tracks.push(buildAnimeSaltEditorAudioTrack({}, tracks.length, false));
  s.episodes[eIdx] = { ...ep, audioTracks: tracks, defaultAudio: tracks.find((track: any) => track?.isDefault) || tracks[0] || null };
  copy[sIdx] = s;
  return copy;
  });
  };

  const epRemoveAudioTrack = (sIdx: number, eIdx: number, aIdx: number) => {
  setEpEditorSeasons(prev => {
  const copy = [...prev];
  const s = { ...copy[sIdx], episodes: [...(Array.isArray(copy[sIdx]?.episodes) ? copy[sIdx].episodes : [])] };
  const ep = normalizeAnimeSaltEditorEpisode(s.episodes[eIdx] || {}, eIdx);
  let tracks = (Array.isArray(ep.audioTracks) ? ep.audioTracks : []).filter((_: any, idx: number) => idx !== aIdx);
  if (tracks.length === 0) tracks = [buildAnimeSaltEditorAudioTrack({}, 0, true)];
  if (!tracks.some((track: any) => track?.isDefault)) tracks = tracks.map((track: any, idx: number) => ({ ...track, isDefault: idx === 0 }));
  s.episodes[eIdx] = { ...ep, audioTracks: tracks, defaultAudio: tracks.find((track: any) => track?.isDefault) || tracks[0] || null };
  copy[sIdx] = s;
  return copy;
  });
  };

  const epSetDefaultAudioTrack = (sIdx: number, eIdx: number, aIdx: number) => {
  setEpEditorSeasons(prev => {
  const copy = [...prev];
  const s = { ...copy[sIdx], episodes: [...(Array.isArray(copy[sIdx]?.episodes) ? copy[sIdx].episodes : [])] };
  const ep = normalizeAnimeSaltEditorEpisode(s.episodes[eIdx] || {}, eIdx);
  const tracks = (Array.isArray(ep.audioTracks) ? ep.audioTracks : []).map((track: any, idx: number) => ({ ...track, isDefault: idx === aIdx }));
  s.episodes[eIdx] = { ...ep, audioTracks: tracks, defaultAudio: tracks[aIdx] || tracks[0] || null };
  copy[sIdx] = s;
  return copy;
  });
  };

 const saveEpisodeData = async () => {
 if (!epEditorSlug) return;
 setEpEditorSaving(true);
 try {
  const sanitizedSeasons = epEditorSeasons.map((season: any, sIdx: number) => ({
  name: season?.name || `Season ${sIdx + 1}`,
  episodes: (Array.isArray(season?.episodes) ? season.episodes : []).map((ep: any, eIdx: number) => {
  const normalized = normalizeAnimeSaltEditorEpisode(ep, eIdx);
  const audioTracks = normalizeAnimeSaltAudioTracks(normalized.audioTracks, normalized.defaultAudio);
  const defaultAudio = audioTracks.find((track: any) => track?.isDefault) || audioTracks[0] || null;
  return {
  ...normalized,
  qualityLinks: {
  default: normalized.link || normalized.link1080 || normalized.link720 || normalized.link480 || "",
  p480: normalized.link480 || "",
  p720: normalized.link720 || "",
  p1080: normalized.link1080 || normalized.link || "",
  p4k: normalized.link4k || "",
  },
  audioTracks,
  defaultAudio,
  };
  }),
  }));
  // Save full custom seasons data to Firebase
  await set(ref(db, `animesaltSelected/${epEditorSlug}/customSeasons`), sanitizedSeasons);
  setEpEditorSeasons(sanitizedSeasons);
 // Also generate episodeOverrides for backward compatibility with playback
 const overrides: Record<string, any> = {};
  sanitizedSeasons.forEach((season, sIdx) => {
  (Array.isArray(season?.episodes) ? season.episodes : []).forEach((ep: any, eIdx: number) => {
  if (ep.link || ep.link480 || ep.link720 || ep.link1080 || ep.link4k || (Array.isArray(ep.audioTracks) && ep.audioTracks.some((track: any) => track?.link || track?.audioUrl || track?.rawAudioUrl))) {
 overrides[`s${sIdx}_e${eIdx}`] = {
 link: ep.link || '', link480: ep.link480 || '', link720: ep.link720 || '', link1080: ep.link1080 || '', link4k: ep.link4k || '',
  qualityLinks: ep.qualityLinks || {},
  audioTracks: ep.audioTracks || [],
  defaultAudio: ep.defaultAudio || null,
 };
 }
 });
 });
 await set(ref(db, `animesaltSelected/${epEditorSlug}/episodeOverrides`), Object.keys(overrides).length > 0 ? overrides : null);
 toast.success('✅ episode data save done!');
 } catch (err: any) {
 toast.error('Error: ' + err.message);
 }
 setEpEditorSaving(false);
 };

 const deleteAllEpisodeData = async () => {
 if (!epEditorSlug) return;
 if (!confirm('Delete all Seasons & Episodes and return to AnimeSalt defaults??')) return;
 try {
 await remove(ref(db, `animesaltSelected/${epEditorSlug}/customSeasons`));
 await remove(ref(db, `animesaltSelected/${epEditorSlug}/episodeOverrides`));
 setEpEditorSeasons([]);
 toast.success('All deleted! Next open will load fresh from AnimeSalt।');
 } catch (err: any) {
 toast.error('Error: ' + err.message);
 }
 };

 const removeItem = async (slug: string) => {
 if (!confirm('this item remove Continue?')) return;
 setRemovingSlug(slug);
 try {
 // Remove entire node including customSeasons and episodeOverrides
 await remove(ref(db, `animesaltSelected/${slug}`));
 toast.success('remove done! খন again ড to do পারবেন।');
 } catch {
 toast.error('Error removing');
 }
 setRemovingSlug(null);
 };

 // URL-based import
 const fetchFromUrl = async () => {
 if (!urlInput.trim()) { toast.error('link day!'); return; }
 // Parse URL: https://animesalt.ac/series/slug/ or https://animesalt.ac/movies/slug/ (also supports old .top domain)
 const urlMatch = urlInput.trim().match(/animesalt\.(?:top|ac)\/(series|movies)\/([^/?#]+)/);
 if (!urlMatch) { toast.error('ভুল link! AnimeSalt series or movieর link day।'); return; }
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
 toast.success(`"${result.data.title || urlSlug}" পা gone!`);
 } else {
 toast.error('this link from data পা যায়নি');
 }
 } catch (err: any) {
 toast.error('ফেচ failed: ' + err.message);
 }
 setUrlFetching(false);
 };

 const addFetchedItem = async () => {
 if (!urlFetchedItem) return;
 if (!addCategory) { toast.error('Category Select!'); return; }
 // Use same addItem flow with TMDB
 const item = normalizeAnimeSaltManagerItem({
 slug: urlFetchedItem.slug,
 title: urlFetchedItem.title,
 poster: urlFetchedItem.poster,
 type: urlFetchedItem.type,
 year: urlFetchedItem.year,
 });
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
 toast.success('Category update!');
 } catch {
 toast.error('Error updating');
 }
 };

 const normalizedAllItems = useMemo(
 () => allItems.map(normalizeAnimeSaltManagerItem).filter((item) => item.slug),
 [allItems],
 );

 const addedItems = useMemo(
 () => Object.entries(selectedItems).map(([slug, item]) => normalizeAnimeSaltManagerItem({ slug, ...item })),
 [selectedItems],
 );

 const filteredItems = useMemo(() => {
 let items = filterType === 'added' ? addedItems : normalizedAllItems;
 if (filterType === 'series') items = items.filter(i => i.type === 'series');
 else if (filterType === 'movies') items = items.filter(i => i.type === 'movies');

 if (searchQuery.trim()) {
 const q = searchQuery.toLowerCase();
 items = items.filter((item) => {
 const haystack = [item.title, item.slug, selectedItems[item.slug]?.title, selectedItems[item.slug]?.category]
 .filter(Boolean)
 .join(' ')
 .toLowerCase();
 return haystack.includes(q);
 });
 }
 return items;
 }, [addedItems, filterType, normalizedAllItems, searchQuery, selectedItems]);

 const addedCount = addedItems.length;

 // ==================== EPISODE PRELOADER ====================
 const runEpisodePreloader = async () => {
 const entries = Object.entries(selectedItems);
 if (entries.length === 0) {
 toast.error("any ড ক item none");
 return;
 }
 if (!confirm(`${entries.length} item episode check ক will be। some time লাগতে পারে। start করব?`)) return;
 setPreloading(true);
 setPreloadDone(false);
 setPreloadFailed([]);
 const failed: { slug: string; title: string; reason: string }[] = [];
 let i = 0;
 for (const [slug, data] of entries) {
 i++;
 const title = (data as any)?.title || slug;
 setPreloadProgress({ current: i, total: entries.length, currentTitle: title });
 try {
 const isMovie = (data as any)?.type === "movies";
 let result: any;
 if (isMovie) {
 result = await animeSaltApi.getMovie(slug);
 if (!result?.success || !result?.data) result = await animeSaltApi.getSeries(slug);
 } else {
 result = await animeSaltApi.getSeries(slug);
 if (!result?.success || !result?.data?.seasons?.length) result = await animeSaltApi.getMovie(slug);
 }
 const data2 = result?.data;
 const hasEpisodes = !!(data2?.seasons?.length && data2.seasons.some((s: any) => s?.episodes?.length > 0));
 const hasEmbed = !!(data2?.embedUrl || data2?.embedUrls?.length || data2?.allEmbeds?.length || data2?.links?.length);
 if (!result?.success) failed.push({ slug, title, reason: "ফেচ failed" });
 else if (!hasEpisodes && !hasEmbed) failed.push({ slug, title, reason: "any episode/link পা যায়নি" });
 } catch (e: any) {
 failed.push({ slug, title, reason: e?.message || "ফেচ of" });
 }
 }
 setPreloadFailed(failed);
 setPreloadDone(true);
 setPreloading(false);
 toast.success(`✅ check সম্পন্ন: ${entries.length - failed.length} OK, ${failed.length} failed`);
 };

 const downloadFailedAsText = () => {
 if (preloadFailed.length === 0) return;
 const header = `Failed AnimeSalt Episodes Report\nGenerated: ${new Date().toLocaleString()}\nTotal Failed: ${preloadFailed.length}\n${"=".repeat(50)}\n\n`;
 const body = preloadFailed.map((f, idx) => `${idx + 1}. ${f.title}\n Slug: ${f.slug}\n Reason: ${f.reason}\n`).join("\n");
 const blob = new Blob([header + body], { type: "text/plain;charset=utf-8" });
 const url = URL.createObjectURL(blob);
 const a = document.createElement("a");
 a.href = url;
 a.download = `failed-episodes-${Date.now()}.txt`;
 document.body.appendChild(a);
 a.click();
 document.body.removeChild(a);
 URL.revokeObjectURL(url);
 };

 const deleteAllFailed = async () => {
 if (preloadFailed.length === 0) return;
 if (!confirm(`${preloadFailed.length} failed posts will be fully deleted (from user + admin panel)। Are you sure?`)) return;
 setPreloadDeleting(true);
 let ok = 0;
 for (const f of preloadFailed) {
 try {
 await remove(ref(db, `animesaltSelected/${f.slug}`));
 ok++;
 } catch {}
 }
 setPreloadDeleting(false);
 setPreloadFailed([]);
 setPreloadDone(false);
 toast.success(`✅ ${ok} Post deleted!`);
 };



 return (
 <div>
 {/* TMDB Selection Modal */}
 {tmdbModalItem && tmdbResults.length > 0 && (
 <div className="fixed inset-0 z-[300] bg-black/80 flex items-center justify-center p-4" onClick={() => { setTmdbModalItem(null); setTmdbResults([]); }}>
 <div className="bg-[#1A1A2E] border border-purple-500/40 rounded-2xl max-w-md w-full max-h-[80vh] overflow-y-auto p-4" onClick={e => e.stopPropagation()}>
 <div className="flex justify-between items-center mb-3">
 <h3 className="text-sm font-semibold">🎯 valid image Select</h3>
 <button onClick={() => { setTmdbModalItem(null); setTmdbResults([]); }} className="text-[#957DAD] hover:text-white"><X size={18} /></button>
 </div>
 <p className="text-[11px] text-[#D1C4E9] mb-3">"{tmdbModalItem.title}" of for users {tmdbResults.length} result পা gone:</p>
 <div className="grid grid-cols-2 gap-3">
 {tmdbResults.map((r: any) => (
 <button key={r.id} onClick={() => saveWithTmdb(tmdbModalItem, r)}
 className="text-left rounded-xl overflow-hidden border-2 border-transparent hover:border-purple-500 transition-all bg-[#151521]">
 <CachedImg src={r.poster_path ? TMDB_IMG_BASE + 'w342' + r.poster_path : 'https://via.placeholder.com/200x300/1A1A2E/9D4EDD?text=No+Image'}
 className="w-full aspect-[2/3] object-cover" loading="lazy" decoding="async" />
 <div className="p-2">
 <p className="text-[11px] font-semibold line-clamp-2">{r.name || r.title}</p>
 <p className="text-[9px] text-[#957DAD]">{(r.first_air_date || r.release_date || '').split('-')[0]} • ⭐ {r.vote_average?.toFixed(1)}</p>
 </div>
 </button>
 ))}
 </div>
 <button onClick={() => saveWithTmdb(tmdbModalItem, null)}
 className="w-full mt-3 py-2 rounded-lg text-[11px] bg-[#151521] border border-white/10 text-[#D1C4E9] hover:bg-purple-500/20 transition-all">
 TMDB without ড (original image)
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
 {editForm.poster && <CachedImg src={editForm.poster} className="w-16 h-24 object-cover rounded-lg" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
 {editForm.backdrop && <CachedImg src={editForm.backdrop} className="flex-1 h-24 object-cover rounded-lg" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
 {editForm.logo && <CachedImg src={editForm.logo} className="w-20 h-12 object-contain rounded-lg bg-black/30" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
 </div>

 {/* TMDB Photo Refresh */}
 <button onClick={searchTmdbForEdit} disabled={editTmdbSearching}
 className="w-full py-2 mb-3 rounded-lg text-[11px] font-bold bg-gradient-to-r from-cyan-500/20 to-blue-500/20 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/30 transition-all flex items-center justify-center gap-1.5">
 {editTmdbSearching ? <RefreshCw size={12} className="animate-spin" /> : <RefreshCw size={12} />}
 🔍 TMDB from image refresh 
 </button>

 {/* TMDB Results Grid */}
 {editTmdbResults.length > 0 && (
 <div className="mb-3 bg-[#151521] rounded-xl border border-cyan-500/20 p-3">
 <p className="text-[10px] text-cyan-400 mb-2 font-semibold">valid image Select ({editTmdbResults.length} result):</p>
 <div className="grid grid-cols-3 gap-2 max-h-[200px] overflow-y-auto">
 {editTmdbResults.map((r: any) => (
 <button key={r.id} onClick={() => applyTmdbToEdit(r)}
 className="text-left rounded-lg overflow-hidden border-2 border-transparent hover:border-cyan-500 transition-all bg-black/30">
 <CachedImg src={r.poster_path ? TMDB_IMG_BASE + 'w185' + r.poster_path : 'https://via.placeholder.com/100x150/1A1A2E/9D4EDD?text=N/A'}
 className="w-full aspect-[2/3] object-cover" loading="lazy" decoding="async" />
 <div className="p-1">
 <p className="text-[9px] font-semibold line-clamp-1">{r.name || r.title}</p>
 <p className="text-[8px] text-[#957DAD]">{(r.first_air_date || r.release_date || '').split('-')[0]}</p>
 </div>
 </button>
 ))}
 </div>
 <button onClick={() => setEditTmdbResults([])} className="w-full mt-2 py-1 rounded text-[10px] text-[#957DAD] hover:text-white transition-all">
 off 
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
 <div className="flex gap-2">
 <input
 value={(editForm as any)[field.key]}
 onChange={e => setEditForm(f => ({ ...f, [field.key]: e.target.value }))}
 className={`${inputClass} flex-1`}
 placeholder={field.label}
 />
 {(field.key === "poster" || field.key === "backdrop") && (
 <label className="px-3 py-2 rounded-lg bg-[#151521] border border-white/10 text-[#D1C4E9] cursor-pointer flex items-center gap-1 text-[11px]">
 <Image size={12} />
 <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
 const file = e.target.files?.[0];
 if (!file) return;
 try {
 toast.info("Uploading...");
 const { uploadToImgbb } = await import("@/lib/imgbbUpload");
 const url = await uploadToImgbb(file);
 setEditForm(f => ({ ...f, [field.key]: url }));
 toast.success(`${field.label} uploaded!`);
 } catch { toast.error("Upload failed"); }
 }} />
 </label>
 )}
 </div>
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
 <Save size={12} /> save 
 </button>
 <button onClick={() => setEditItem(null)} className="px-4 py-2 rounded-lg text-[12px] bg-[#151521] border border-white/10 text-[#D1C4E9]">
 cancel
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
 <h3 className="text-sm font-semibold flex items-center gap-2">🎬 episode ডিটর - {selectedItems[epEditorSlug]?.title || epEditorSlug}</h3>
 <button onClick={() => setEpEditorSlug(null)} className="text-[#957DAD] hover:text-white"><X size={18} /></button>
 </div>
 <p className="text-[10px] text-[#D1C4E9] mb-3 flex-shrink-0">
 <span className="text-yellow-400">AnimeSalt link</span> = andদ server from প্লে will be (SaltPlayer)।
 <span className="text-green-400 ml-1">custom link</span> = your video playerে প্লে will be।
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
 <p className="text-[#957DAD] text-[13px] text-center py-8">any Season none। "JSON import", "+ Season" or "AnimeSalt load" click ।</p>
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
  <span className="text-[11px] text-[#D1C4E9]">Episodes: {(Array.isArray(season?.episodes) ? season.episodes : []).length}</span>
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
  {(Array.isArray(season?.episodes) ? season.episodes : []).map((ep: any, eIdx: number) => {
 const hasCustomLink = !!(ep.link || ep.link480 || ep.link720 || ep.link1080 || ep.link4k);
  const audioTracks = normalizeAnimeSaltAudioTracks(ep?.audioTracks, ep?.defaultAudio);
  const safeAudioTracks = audioTracks.length > 0 ? audioTracks : [buildAnimeSaltEditorAudioTrack({}, 0, true)];
 return (
 <div key={eIdx} className={`bg-[#1A1A2E] rounded-xl p-3 border ${hasCustomLink ? 'border-green-500/30' : 'border-white/5'}`}>
 <div className="flex items-center justify-between mb-2">
 <span className="text-xs font-semibold text-purple-400">Episode {ep.number}</span>
 <div className="flex items-center gap-1.5">
 {ep.hasAnimeSaltLink && (
 <span className="text-[9px] bg-yellow-500/15 text-yellow-400 px-2 py-0.5 rounded-full">
 AnimeSalt link exists
 </span>
 )}
 {hasCustomLink && (
 <span className="text-[9px] bg-green-500/15 text-green-400 px-2 py-0.5 rounded-full">
 custom link
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
 placeholder={ep.hasAnimeSaltLink ? 'AnimeSalt link use will be' : 'link day...'}
 rows={2}
 />
 </div>
  {[
  { label: '480p', key: 'link480' },
  { label: '720p', key: 'link720' },
  { label: '1080p', key: 'link1080' },
  { label: '4K', key: 'link4k' },
  ].map(({ label, key }) => {
 return (
  <div key={key} className="rounded-xl border border-cyan-500/15 bg-cyan-500/5 p-2">
  <span className="text-[9px] text-cyan-300 font-bold mb-1 block">{label} video-only quality URL</span>
 <textarea
  value={ep[key] || ''}
  onChange={e => epUpdateEpisodeField(sIdx, eIdx, key, e.target.value)}
 className={`${inputClass} w-full !py-2 !text-[10px] min-h-[44px] resize-none break-all`}
  placeholder={`${label} .m3u8 video-only link এখানে paste করো`}
 rows={2}
 />
 </div>
 );
 })}
  <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-3 space-y-3">
  <div className="flex items-center justify-between gap-2">
  <div>
  <p className="text-[11px] font-bold text-emerald-300">🔊 Episode Audio Storage</p>
  <p className="text-[9px] text-emerald-200/70">Default audio + যতগুলো extra audio আছে সব URL এখানে store হবে।</p>
  </div>
  <button type="button" onClick={() => epAddAudioTrack(sIdx, eIdx)}
  className="px-2.5 py-1.5 rounded-lg text-[10px] font-bold bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/35 flex items-center gap-1">
  <Plus size={10} /> Audio
  </button>
  </div>
  {safeAudioTracks.map((track: any, aIdx: number) => {
  const isDefault = !!track?.isDefault || aIdx === 0 && !safeAudioTracks.some((t: any) => t?.isDefault);
  return (
  <div key={aIdx} className={`rounded-xl border p-2.5 space-y-2 ${isDefault ? 'border-yellow-500/40 bg-yellow-500/10' : 'border-white/10 bg-black/20'}`}>
  <div className="flex items-center justify-between gap-2">
  <span className={`text-[10px] font-bold ${isDefault ? 'text-yellow-300' : 'text-emerald-300'}`}>{isDefault ? '⭐ Default Audio (Hindi/Primary)' : `Audio ${aIdx + 1}`}</span>
  <div className="flex items-center gap-1">
  {!isDefault && <button type="button" onClick={() => epSetDefaultAudioTrack(sIdx, eIdx, aIdx)} className="px-2 py-1 rounded-md text-[9px] bg-yellow-500/15 text-yellow-300 border border-yellow-500/25">Make Default</button>}
  {safeAudioTracks.length > 1 && <button type="button" onClick={() => epRemoveAudioTrack(sIdx, eIdx, aIdx)} className="p-1 rounded-md bg-red-500/15 text-red-300 border border-red-500/25"><Trash2 size={10} /></button>}
  </div>
  </div>
  <div className="grid grid-cols-2 gap-2">
  <input
  value={track?.language || ''}
  onChange={e => epUpdateAudioTrack(sIdx, eIdx, aIdx, 'language', e.target.value)}
  className={`${inputClass} !py-2 !text-[10px]`}
  placeholder="Language (Hindi)"
  />
  <input
  value={track?.label || ''}
  onChange={e => epUpdateAudioTrack(sIdx, eIdx, aIdx, 'label', e.target.value)}
  className={`${inputClass} !py-2 !text-[10px]`}
  placeholder="Label (Hindi)"
  />
  </div>
  <textarea
  value={track?.link || track?.audioUrl || track?.rawAudioUrl || ''}
  onChange={e => epUpdateAudioTrack(sIdx, eIdx, aIdx, 'link', e.target.value)}
  className={`${inputClass} w-full !py-2 !text-[10px] min-h-[48px] resize-none break-all`}
  placeholder="Audio .m3u8 URL এখানে paste করো"
  rows={2}
  />
  </div>
  );
  })}
  </div>
  <div>
  <span className="text-[10px] text-[#D1C4E9] font-medium mb-1 block">Subtitle / CC (VTT or SRT)</span>
  <textarea value={(ep as any).subtitleTracks?.[0]?.url || ""} onChange={e => epUpdateEpisodeField(sIdx, eIdx, 'subtitleTracks', e.target.value.trim() ? [{ label: 'Default', language: '', url: e.target.value.trim() }] : [])}
  className={`${inputClass} w-full !py-2 !text-[10px] min-h-[44px] resize-none break-all`} placeholder="Subtitle URL (optional)" rows={2} />
  </div>
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
 {epEditorSaving ? <RefreshCw size={12} className="animate-spin" /> : <Save size={12} />} save 
 </button>
 <button onClick={deleteAllEpisodeData}
 className="px-4 py-2.5 rounded-lg text-[12px] font-bold bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/40 transition-all flex items-center gap-1">
 <Trash2 size={12} /> all delete
 </button>
 <button onClick={() => setEpEditorSlug(null)}
 className="px-4 py-2.5 rounded-lg text-[12px] bg-[#151521] border border-white/10 text-[#D1C4E9]">
 off
 </button>
 </div>
 </>
 )}
 </div>
 </div>
 )}

 {/* Episode Preloader */}
 <div className={`${glassCard} p-4 mb-4 border border-amber-500/30`}>
 <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
 <RefreshCw size={14} className="text-amber-400" /> 🚀 Episode Preloader
 </h3>
 <p className="text-[10px] text-zinc-400 mb-3">
 Refreshes and checks every added series/movie episode from AnimeSalt। Shows the list of items whose episodes failed to load; you can download a text file and delete with one click।
 </p>

 {preloading && (
 <div className="mb-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30">
 <div className="flex items-center justify-between text-[11px] mb-2">
 <span className="text-amber-300 font-semibold">running... {preloadProgress.current}/{preloadProgress.total}</span>
 <span className="text-amber-400">{Math.round((preloadProgress.current / Math.max(preloadProgress.total, 1)) * 100)}%</span>
 </div>
 <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
 <div className="h-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all"
 style={{ width: `${(preloadProgress.current / Math.max(preloadProgress.total, 1)) * 100}%` }} />
 </div>
 <p className="text-[10px] text-zinc-400 mt-2 truncate">📡 {preloadProgress.currentTitle}</p>
 </div>
 )}

 <button onClick={runEpisodePreloader} disabled={preloading || addedCount === 0}
 className={`w-full py-2.5 rounded-xl text-[12px] font-bold flex items-center justify-center gap-2 transition-all ${
 preloading || addedCount === 0
 ? "bg-zinc-700/50 text-zinc-500 cursor-not-allowed"
 : "bg-gradient-to-r from-amber-500 to-orange-600 text-white hover:shadow-[0_4px_15px_rgba(245,158,11,0.4)]"
 }`}>
 {preloading ? <><RefreshCw size={14} className="animate-spin" /> check in progress...</> : <><Zap size={14} /> all episode check ({addedCount})</>}
 </button>

 {preloadDone && (
 <div className="mt-3 p-3 rounded-xl bg-[#151521] border border-white/10">
 <div className="flex items-center justify-between mb-2">
 <p className="text-[12px] font-semibold">
 {preloadFailed.length === 0
 ? <span className="text-green-400">✅ all episode ঠিকঠাক load in progress!</span>
 : <span className="text-red-400">❌ {preloadFailed.length} item episode load not done</span>}
 </p>
 </div>

 {preloadFailed.length > 0 && (
 <>
 <div className="max-h-[200px] overflow-y-auto space-y-1.5 mb-3 pr-1">
 {preloadFailed.map((f, idx) => (
 <div key={f.slug} className="flex items-start gap-2 p-2 rounded-lg bg-red-500/10 border border-red-500/20">
 <span className="text-[10px] text-red-400 font-bold flex-shrink-0">{idx + 1}.</span>
 <div className="flex-1 min-w-0">
 <p className="text-[11px] font-semibold text-white truncate">{f.title}</p>
 <p className="text-[9px] text-red-300/70 truncate">{f.slug} • {f.reason}</p>
 </div>
 </div>
 ))}
 </div>
 <div className="flex gap-2">
 <button onClick={downloadFailedAsText}
 className="flex-1 py-2 rounded-lg text-[11px] font-bold bg-blue-500/20 border border-blue-500/30 text-blue-400 hover:bg-blue-500/40 transition-all flex items-center justify-center gap-1.5">
 <Download size={12} /> text file
 </button>
 <button onClick={deleteAllFailed} disabled={preloadDeleting}
 className="flex-1 py-2 rounded-lg text-[11px] font-bold bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/40 transition-all flex items-center justify-center gap-1.5">
 {preloadDeleting ? <RefreshCw size={12} className="animate-spin" /> : <Trash2 size={12} />}
 all delete 
 </button>
 </div>
 </>
 )}
 </div>
 )}
 </div>

 {/* AN API URL is now configured only in EGD Router → AN API row. */}
 {/* Global AnimeSalt ON/OFF Toggle */}
 <div className={`${glassCard} p-4 mb-4`}>
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-3">
 <div className={`w-3 h-3 rounded-full ${animeSaltGlobalEnabled ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
 <span className="text-xs font-semibold">{animeSaltGlobalEnabled ? 'AnimeSalt content on exists' : 'AnimeSalt content off exists'}</span>
 </div>
 <button onClick={async () => {
 const next = !animeSaltGlobalEnabled;
 setAnimeSaltGlobalEnabled(next);
 await set(ref(db, "settings/animeSaltEnabled"), next);
 toast.success(next ? "✅ AnimeSalt content enabled" : "AnimeSalt content disabled");
 }}
 className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${animeSaltGlobalEnabled ? 'bg-green-600' : 'bg-zinc-600'}`}>
 <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${animeSaltGlobalEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
 </button>
 </div>
 <p className="text-[10px] text-zinc-400 mt-2">Turning off hides all AnimeSalt content on the site। only site content shows।</p>
 </div>

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
 {refreshing ? 'refresh...' : 'refresh'}
 </button>
 </div>
 <p className="text-[11px] text-[#D1C4E9] mb-3">
 AnimeSalt from content browse , which পছন্দ সে ড । TMDB from সঠিsaved postsার and মেdata auto আallে।
 </p>
 <div className="flex items-center gap-3 mb-3">
 <div className="bg-purple-500/20 text-purple-400 px-3 py-1.5 rounded-full text-xs font-bold">
 Total: {allItems.length}
 </div>
 <div className="bg-green-500/20 text-green-400 px-3 py-1.5 rounded-full text-xs font-bold">
 ড ক: {addedCount}
 </div>
 </div>
 <div className="mb-3">
 <label className="text-[11px] text-[#957DAD] mb-1 block">Category (ড কর for users) <span className="text-red-400">*</span></label>
 <select value={addCategory} onChange={e => setAddCategory(e.target.value)} className={selectClass}>
 <option value="">Select</option>
 {categoryList.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
 </select>
 </div>
 <div className="relative">
 <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-purple-500" />
 <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
 className={`${inputClass} pl-9`} placeholder="search ..." />
 </div>
 </div>

 {/* URL Import Section */}
 <div className={`${glassCard} p-4 mb-4`}>
 <h4 className="text-[13px] font-semibold flex items-center gap-2 mb-2">
 <Link size={14} className="text-cyan-400" /> link with ড 
 </h4>
 <p className="text-[10px] text-[#D1C4E9] mb-2">
 AnimeSalt andয়েবsite from series/movieর link Paste । যেall anime ক্যাlogে none সেগুলো ভাবে ড ।
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
 <CachedImg src={urlFetchedItem.poster} className="w-16 h-24 object-cover rounded-lg flex-shrink-0"
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
 <Check size={12} /> before fromthis ড ক exists
 </div>
 <div className="flex gap-1.5">
 <button onClick={() => { openEditModal(urlFetchedItem.slug); }}
 className="flex-1 py-1.5 rounded-lg text-[10px] font-bold bg-blue-500/20 border border-blue-500/30 text-blue-400 hover:bg-blue-500/40 flex items-center justify-center gap-1">
 <Edit size={10} /> Edit
 </button>
 <button onClick={() => removeItem(urlFetchedItem.slug)}
 className="flex-1 py-1.5 rounded-lg text-[10px] font-bold bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/40 flex items-center justify-center gap-1">
 <Trash2 size={10} /> delete করে again ড 
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
 !addCategory ? <><AlertTriangle size={10} /> প্রথমে Category Select</> :
 <><Download size={10} /> ড </>}
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
 { key: "all", label: "📋 all", count: allItems.length },
 { key: "series", label: "📺 series", count: allItems.filter(i => i.type === 'series').length },
 { key: "movies", label: "🎬 movie", count: allItems.filter(i => i.type === 'movies').length },
 { key: "added", label: "✅ ড ক", count: addedCount },
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
 <p className="text-[#957DAD] text-[13px] text-center py-8">any item পা যায়নি</p>
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
 cancel 
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
 <><Download size={10} /> ড </>
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

// Device Limit Input with local state for live UI update
const DeviceLimitInput = ({ currentValue, userId, onUpdate }: { currentValue: number; userId: string; onUpdate: (userId: string, v: number) => void }) => {
 const [val, setVal] = useState(String(currentValue));
 useEffect(() => { setVal(String(currentValue)); }, [currentValue]);
 return (
 <input
 type="number"
 min="1"
 max="1000"
 value={val}
 onClick={(e) => e.stopPropagation()}
 onChange={(e) => {
 e.stopPropagation();
 setVal(e.target.value);
 const v = parseInt(e.target.value);
 if (v > 0) onUpdate(userId, v);
 }}
 className="w-14 h-7 rounded-lg text-[11px] font-bold text-center bg-white/5 text-zinc-300 border border-white/10 focus:border-yellow-500 outline-none"
 />
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
 if (!confirm("this device remove Continue?")) return;
 try {
 const { removeDevice: rmDev } = await import("@/lib/premiumDevice");
 await rmDev(userId, deviceId);
 setUserDevices(prev => ({ ...prev, [userId]: (prev[userId] || []).filter(d => d.id !== deviceId) }));
 toast.success("device remove done");
 } catch { toast.error("Error removing device"); }
 };

 const cancelSubscription = async (userId: string, userName: string) => {
 if (!confirm(`"${userName}" Cancel this subscription? The device list will also be cleared।`)) return;
 try {
 await remove(ref(db, `users/${userId}/premium`));
 setUserDevices(prev => { const copy = { ...prev }; delete copy[userId]; return copy; });
 const notifRef = push(ref(db, `notifications/${userId}`));
 await set(notifRef, {
 title: "Subscription Cancelled ❌",
 message: "Your premium subscription has been canceled by an admin।",
 type: "warning",
 timestamp: Date.now(),
 read: false,
 });
 toast.success("subscription cancel and user নোফাthis done");
 } catch { toast.error("Error cancelling"); }
 };

 const setDeviceAsOnly = async (userId: string, allowedDeviceId: string) => {
 if (!confirm("Grant access only to this device? All remaining devices will be removed।")) return;
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
 toast.success("onlyমাত্র নির্orচিত deviceে access done");
 } catch { toast.error("Error updating devices"); }
 };

 const updateMaxDevices = async (userId: string, maxDevices: number) => {
 try {
 await update(ref(db, `users/${userId}/premium`), { maxDevices });
 toast.success(`device limit ${maxDevices} update done`);
 } catch { toast.error("Error updating"); }
 };

 const updateExpiryDays = async (userId: string) => {
 const days = parseInt(expiryDaysInput);
 if (isNaN(days) || days < 0) { toast.error("valid day count day"); return; }
 try {
 const newExpiry = Date.now() + days * 86400000;
 await update(ref(db, `users/${userId}/premium`), { expiresAt: newExpiry });
 toast.success(`premium ${days} dayে update done`);
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
 premium userদ device limit manage । Grant access to specific devices, block the rest, or cancel the subscription।
 </p>

 {premiumUsers.length > 0 && (
 <div className="relative mb-3">
 <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-yellow-500" />
 <input
 value={searchQuery}
 onChange={e => setSearchQuery(e.target.value)}
 className={`${inputClass} pl-9`}
 placeholder="user search (name, email)..."
 />
 </div>
 )}

 {filteredPremiumUsers.length === 0 ? (
 <p className="text-[#957DAD] text-[13px] text-center py-8">
 {searchQuery ? "any user পা যায়নি" : "any premium user none"}
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
 <CachedImg src={user.photoURL || user.photo} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" loading="lazy" decoding="async" />
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
 ⏳ {daysLeft} day remaining
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
 <span className="text-[10px] text-zinc-400 font-semibold">⏳ premium মেয়াদ: {daysLeft} day remaining</span>
 <button 
 onClick={(e) => { e.stopPropagation(); setEditingExpiry(editingExpiry === user.id ? null : user.id); setExpiryDaysInput(String(daysLeft)); }}
 className="text-[10px] text-yellow-400 hover:text-yellow-300 font-semibold"
 >
 {editingExpiry === user.id ? "cancel" : "✏️ ডিট"}
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
 placeholder="day count..."
 min="0"
 />
 <span className="text-[10px] text-zinc-500">day</span>
 <button
 onClick={(e) => { e.stopPropagation(); updateExpiryDays(user.id); }}
 className="px-3 py-1.5 rounded-lg bg-yellow-500/20 text-yellow-400 text-[10px] font-bold hover:bg-yellow-500/40 transition-colors"
 >
 save
 </button>
 </div>
 )}
 </div>

 {/* Device Limit Control */}
 <div className="flex items-center gap-2 mb-3 bg-black/20 rounded-lg p-2">
 <span className="text-[10px] text-zinc-400 flex-shrink-0">Max Devices:</span>
 <div className="flex gap-1 items-center">
 {[1, 2, 3, 5, 10].map(n => (
 <button key={n} onClick={(e) => { e.stopPropagation(); updateMaxDevices(user.id, n); }}
 className={`w-7 h-7 rounded-lg text-[11px] font-bold transition-colors ${
 maxDev === n ? "bg-yellow-500 text-black" : "bg-white/5 text-zinc-400 hover:bg-white/10"
 }`}>{n}</button>
 ))}
 <DeviceLimitInput currentValue={maxDev} userId={user.id} onUpdate={updateMaxDevices} />
 </div>
 </div>

 <p className="text-[10px] text-zinc-400 mb-2 font-semibold">রেজিস্র্ড device ({(userDevices[user.id] || []).length}):</p>
 {(userDevices[user.id] || []).length === 0 ? (
 <p className="text-[10px] text-zinc-500 text-center py-2">any device রেজিস্র্ড none</p>
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
 title="only this deviceে access day"
 className="bg-green-500/20 text-green-400 p-1.5 rounded-lg hover:bg-green-500/40 transition-colors">
 <Check size={12} />
 </button>
 <button onClick={(e) => { e.stopPropagation(); removeDeviceHandler(user.id, dev.id); }}
 title="this device remove "
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
 <X size={11} /> subscription cancel
 </button>
 <button onClick={(e) => {
 e.stopPropagation();
 if (!confirm("all device remove Continue?")) return;
 const devices = userDevices[user.id] || [];
 Promise.all(devices.map(d => remove(ref(db, `users/${user.id}/premium/devices/${d.id}`))))
 .then(() => {
 setUserDevices(prev => ({ ...prev, [user.id]: [] }));
 toast.success("all device remove done");
 }).catch(() => toast.error("Error"));
 }}
 className="flex-1 py-2 rounded-lg bg-yellow-500/20 border border-yellow-500/30 text-yellow-400 text-[10px] font-semibold hover:bg-yellow-500/40 transition-colors flex items-center justify-center gap-1">
 <Trash2 size={11} /> all device clear
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
 if (!newEmail.trim() || !newEmail.includes("@")) { toast.error("valid email day"); return; }
 const key = push(ref(db, "admin/authorizedEmails")).key;
 if (!key) return;
 await set(ref(db, `admin/authorizedEmails/${key}`), newEmail.trim());
 setNewEmail("");
 toast.success("email add done!");
 };

 const removeEmail = async (key: string) => {
 await remove(ref(db, `admin/authorizedEmails/${key}`));
 toast.success("email মুছে ফেলা done");
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
 <p className="text-[11px] text-zinc-500 text-center py-3">any Google email add ক not done</p>
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
 toast.success(newVal ? "Cloudflare CDN on done" : "Cloudflare CDN off done");
 } catch {
 toast.error("Save failed");
 }
 };

 return (
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-3">
 <div className={`w-3 h-3 rounded-full ${cdnEnabled ? 'bg-green-500' : 'bg-red-500'}`} />
 <span className="text-sm font-medium">{cdnEnabled ? 'CDN on exists' : 'CDN off exists'}</span>
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

// Proxy URL builder helper
const buildProxyTestUrl = (proxyBase: string, testUrl: string, apiKey?: string): string => {
 if (!proxyBase) return testUrl;
 const encoded = encodeURIComponent(testUrl);
 let url: string;
 if (proxyBase.includes('{url}')) url = proxyBase.split('{url}').join(encoded);
 else if (/[?&]url=$/.test(proxyBase) || proxyBase.endsWith('=')) url = `${proxyBase}${encoded}`;
 else if (proxyBase.includes('?url=') || proxyBase.includes('&url=')) url = `${proxyBase}${encoded}`;
 else url = `${proxyBase.replace(/\/$/, '')}?url=${encoded}`;
 if (apiKey) url += (url.includes('?') ? '&' : '?') + `apikey=${encodeURIComponent(apiKey)}`;
 return url;
};

// Proxy Server presets - only range-safe proxies for reliable seek/skip
const PROXY_SERVERS = [
 { id: 'supabase', name: 'Built-in Proxy (Default)', region: '🌐 Auto Region • Range ✓', url: '' },
];

// Proxy Server Selector sub-component
const ProxyServerSelector = ({ glassCard }: { glassCard: string }) => {
 const [activeProxy, setActiveProxy] = useState('supabase');
 const [customProxies, setCustomProxies] = useState<{ id: string; name: string; url: string; apiKey?: string }[]>([]);
 const [newProxyName, setNewProxyName] = useState('');
 const [newProxyUrl, setNewProxyUrl] = useState('');
 const [newProxyApiKey, setNewProxyApiKey] = useState('');
 const [loading, setLoading] = useState(true);
 const [testing, setTesting] = useState<string | null>(null);
 const [testResults, setTestResults] = useState<Record<string, { speed: number; status: 'ok' | 'fail' }>>({});
 const [showAddForm, setShowAddForm] = useState(false);

 useEffect(() => {
 const unsub1 = onValue(ref(db, "settings/proxyServer"), (snap) => {
 const val = snap.val();
 const incomingId = val?.id || 'supabase';
 setActiveProxy(incomingId);
 setLoading(false);
 });
 const unsub2 = onValue(ref(db, "settings/customProxies"), (snap) => {
 const val = snap.val();
 if (val) {
 const list = Object.entries(val).map(([key, v]: any) => ({ id: key, name: v.name, url: v.url, apiKey: v.apiKey || '' }));
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
 const url = proxy && 'url' in proxy ? proxy.url : '';
 const apiKey = proxy && 'apiKey' in proxy ? (proxy as any).apiKey : '';
 await set(ref(db, "settings/proxyServer"), { id, url: url || null, apiKey: apiKey || null });
 setActiveProxy(id);
 toast.success(`প্রক্সি: ${proxy?.name || id}`);
 } catch {
 toast.error("Save failed");
 }
 };

 const addCustomProxy = async () => {
 if (!newProxyName.trim() || !newProxyUrl.trim()) { toast.error("name and URL দা and"); return; }
 try {
 const id = `custom_${Date.now()}`;
 await set(ref(db, `settings/customProxies/${id}`), {
 name: newProxyName.trim(),
 url: newProxyUrl.trim(),
 apiKey: newProxyApiKey.trim() || null,
 });
 setNewProxyName('');
 setNewProxyUrl('');
 setNewProxyApiKey('');
 setShowAddForm(false);
 toast.success("custom প্রক্সি add done");
 } catch {
 toast.error("Save failed");
 }
 };

 const removeCustomProxy = async (id: string) => {
 try {
 await remove(ref(db, `settings/customProxies/${id}`));
 if (activeProxy === id) {
 await set(ref(db, "settings/proxyServer"), { id: 'supabase', url: null, apiKey: null });
 setActiveProxy('supabase');
 }
 toast.success("প্রক্সি মুছে ফেলা done");
 } catch {
 toast.error("মুছতে failed");
 }
 };

 const testProxy = async (proxy: { id: string; url: string; apiKey?: string }) => {
 setTesting(proxy.id);
 const testVideoUrl = 'https://www.google.com/favicon.ico';
 const start = performance.now();
 try {
 let fetchUrl = buildProxyTestUrl(proxy.url, testVideoUrl, proxy.apiKey);
 const res = await fetch(fetchUrl, { method: 'GET', signal: AbortSignal.timeout(10000) });
 const elapsed = Math.round(performance.now() - start);
 setTestResults(prev => ({ ...prev, [proxy.id]: { speed: elapsed, status: res.ok ? 'ok' : 'fail' } }));
 } catch {
 const elapsed = Math.round(performance.now() - start);
 setTestResults(prev => ({ ...prev, [proxy.id]: { speed: elapsed, status: 'fail' } }));
 }
 setTesting(null);
 };

 if (loading) return <div className="text-xs text-zinc-500">load in progress...</div>;

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
 {'apiKey' in proxy && (proxy as any).apiKey && (
 <div className="text-[9px] text-yellow-500/70 mt-0.5">🔑 API Key set exists</div>
 )}
 </div>
 </div>
 <div className="flex items-center gap-1.5 flex-shrink-0">
 {testResults[proxy.id] && (
 <span className={`text-[10px] font-mono ${testResults[proxy.id].status === 'ok' ? 'text-green-400' : 'text-red-400'}`}>
 {testResults[proxy.id].status === 'ok' ? `${testResults[proxy.id].speed}ms` : 'failed'}
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
 onClick={(e) => { e.stopPropagation(); testProxy(proxy as any); }}
 disabled={testing === proxy.id}
 className="px-2 py-1 text-[10px] rounded bg-zinc-700 hover:bg-zinc-600 transition-colors disabled:opacity-50"
 >
 {testing === proxy.id ? '...' : 'test'}
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
 placeholder="প্রক্সি name (such as: My Supabase Proxy)"
 className="w-full text-xs bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white placeholder-zinc-500 focus:border-cyan-500 outline-none"
 />
 <input
 type="text"
 value={newProxyUrl}
 onChange={e => setNewProxyUrl(e.target.value)}
 placeholder="প্রক্সি URL (such as: https://xxx.supabase.co/functions/v1/rs-video-proxy?url=)"
 className="w-full text-xs bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white placeholder-zinc-500 focus:border-cyan-500 outline-none"
 />
 <input
 type="text"
 value={newProxyApiKey}
 onChange={e => setNewProxyApiKey(e.target.value)}
 placeholder="🔑 API Key (No থাকলে খালি খো)"
 className="w-full text-xs bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white placeholder-zinc-500 focus:border-yellow-500 outline-none"
 />
 <p className="text-[10px] text-zinc-500 leading-relaxed">
 ✨ Key থাকলে: <code className="text-cyan-400">proxy?url=VIDEO&apikey=KEY</code><br/>
 ✨ Key No থাকলে: <code className="text-cyan-400">proxy?url=VIDEO</code>
 </p>
 <div className="flex gap-2">
 <button onClick={addCustomProxy} className="flex-1 py-2 text-xs bg-cyan-600 hover:bg-cyan-500 rounded-lg transition-colors">
 ✅ add 
 </button>
 <button onClick={() => { setShowAddForm(false); setNewProxyName(''); setNewProxyUrl(''); setNewProxyApiKey(''); }} className="px-3 py-2 text-xs bg-zinc-700 hover:bg-zinc-600 rounded-lg transition-colors">
 cancel
 </button>
 </div>
 </div>
 ) : (
 <button
 onClick={() => setShowAddForm(true)}
 className="w-full py-2 text-xs font-medium border border-dashed border-zinc-600 hover:border-cyan-500 rounded-lg transition-colors flex items-center justify-center gap-1.5"
 >
 <Plus size={12} /> custom প্রক্সি add 
 </button>
 )}

 {/* Test All */}
 <button
 onClick={async () => { for (const p of allProxies) { await testProxy(p as any); } }}
 disabled={testing !== null}
 className="w-full mt-2 py-2 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors disabled:opacity-50"
 >
 {testing ? 'test running...' : '🚀 all প্রক্সি test '}
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
 webseriesData.forEach(w => allContent.push({ title: w.title, fbPath: `webseries/${w.id}`, searchType: "tv", source: "" }));
 moviesData.forEach(m => allContent.push({ title: m.title, fbPath: `movies/${m.id}`, searchType: "movie", source: "" }));
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
 errorList.push(`❌ [${item.source}] ${item.title} — TMDB তে পা যায়নি`);
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
 toast.success(`image refresh সম্পন্ন! ${success}/${allContent.length} update done`);
 };

 const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
 const totalCount = mode === "rs" ? rsCount : mode === "animesalt" ? asCount : rsCount + asCount;

 return (
 <div className={`${glassCard} p-4 mb-4`}>
 <h3 className="text-sm font-semibold mb-3.5 flex items-center gap-2">
 <RefreshCw size={14} className="text-emerald-400" /> image refresh (TMDB)
 </h3>
 <p className="text-[11px] text-zinc-400 mb-3">
 Re-fetches Poster and Backdrop images for all content from TMDB।
 </p>

 {!refreshing && !done && (
 <div className="space-y-3">
 <div className="flex gap-2">
 {(["animesalt", "rs", "all"] as const).map(m => (
 <button key={m} onClick={() => setMode(m)}
 className={`flex-1 py-2 text-xs font-semibold rounded-lg border transition-colors ${mode === m ? "bg-indigo-600 border-indigo-500 text-white" : "bg-[#141422] border-white/8 text-zinc-400 hover:text-white"}`}>
 {m === "animesalt" ? `P2 (${asCount})` : m === "rs" ? `Primary (${rsCount})` : `all (${rsCount + asCount})`}
 </button>
 ))}
 </div>
 <button onClick={startRefresh} className={`${btnPrimary} w-full py-3 flex items-center justify-center gap-2 text-sm`}>
 <RefreshCw size={16} /> Start Refresh ({totalCount} content)
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
 <p className="text-[10px] text-zinc-500 animate-pulse">⏳ browser off ন No...</p>
 </div>
 )}

 {done && (
 <div className="space-y-3">
 <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3">
 <p className="text-sm text-emerald-400 font-semibold flex items-center gap-2">
 <Check size={16} /> সম্পন্ন! {successCount}/{progress.total} update done
 </p>
 </div>
 <button onClick={() => { setDone(false); setErrors([]); }} className={`${btnPrimary} w-full py-2.5 text-sm flex items-center justify-center gap-2`}>
 <RefreshCw size={14} /> again refresh 
 </button>
 </div>
 )}

 {errors.length > 0 && (
 <div className="mt-3 bg-red-500/10 border border-red-500/20 rounded-lg p-3 max-h-[200px] overflow-y-auto">
 <p className="text-xs text-red-400 font-semibold mb-2">⚠️ {errors.length} সমস্যা:</p>
 {errors.map((err, i) => (
 <p key={i} className="text-[11px] text-red-300/80 py-0.5">{err}</p>
 ))}
 </div>
 )}
 </div>
 );
};

// Episode Name Refresh Section - fetch episode names from TMDB 
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

 if (targetList.length === 0) { toast.error("content Select"); return; }

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
 errorList.push(`❌ ${ws.title} — TMDB তে পা যায়নি`);
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
 toast.success(`episode name refresh সম্পন্ন! ${totalEpsUpdated} episode update done`);
 };

 const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

 return (
 <div className={`${glassCard} p-4 mb-4`}>
 <h3 className="text-sm font-semibold mb-3.5 flex items-center gap-2">
 <List size={14} className="text-amber-400" /> episode name refresh (TMDB)
 </h3>
 <p className="text-[11px] text-zinc-400 mb-3">
 andয়েবseries episode name TMDB from update । only খালি or জেনিক name update will be।
 </p>

 {!refreshing && !done && (
 <div className="space-y-3">
 {/* Mode selector */}
 <div className="flex gap-2">
 <button onClick={() => setMode("all")}
 className={`flex-1 py-2 text-xs font-semibold rounded-lg border transition-colors ${mode === "all" ? "bg-amber-600 border-amber-500 text-white" : "bg-[#141422] border-white/8 text-zinc-400 hover:text-white"}`}>
 All Series ({webseriesData.length})
 </button>
 <button onClick={() => setMode("single")}
 className={`flex-1 py-2 text-xs font-semibold rounded-lg border transition-colors ${mode === "single" ? "bg-amber-600 border-amber-500 text-white" : "bg-[#141422] border-white/8 text-zinc-400 hover:text-white"}`}>
 specific series
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
 placeholder="series search ..."
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
 {ws.poster && <CachedImg src={ws.poster} className="w-6 h-8 rounded object-cover flex-shrink-0" loading="lazy" decoding="async" />}
 <span className="truncate">{ws.title}</span>
 </button>
 ))}
 {filteredSeries.length === 0 && <p className="text-[11px] text-zinc-500 text-center py-3">any series পা যায়নি</p>}
 </div>
 </div>
 )}

 <button
 onClick={startRefresh}
 disabled={mode === "single" && !selectedId}
 className={`${btnPrimary} w-full py-3 flex items-center justify-center gap-2 text-sm disabled:opacity-40`}
 >
 <RefreshCw size={16} /> Start Refresh ({mode === "single" ? (selectedId ? "1" : "Select") : `${webseriesData.length}`} series)
 </button>
 </div>
 )}

 {refreshing && (
 <div className="space-y-3">
 <div className="flex items-center justify-between text-xs text-zinc-400">
 <span>{progress.current}/{progress.total} series</span>
 <span>{pct}%</span>
 </div>
 <div className="w-full h-3 bg-[#141422] rounded-full overflow-hidden">
 <div className="h-full bg-gradient-to-r from-amber-500 to-orange-400 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
 </div>
 <p className="text-[11px] text-zinc-300 truncate">🔄 {progress.currentTitle}</p>
 <p className="text-[10px] text-emerald-400">{updatedEps} episode update done</p>
 <p className="text-[10px] text-zinc-500 animate-pulse">⏳ browser off ন No...</p>
 </div>
 )}

 {done && (
 <div className="space-y-3">
 <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
 <p className="text-sm text-amber-400 font-semibold flex items-center gap-2">
 <Check size={16} /> সম্পন্ন! {successCount} seriesে Total {updatedEps} episode update done
 </p>
 </div>
 <button onClick={() => { setDone(false); setErrors([]); setSelectedId(""); }} className={`${btnPrimary} w-full py-2.5 text-sm flex items-center justify-center gap-2`}>
 <RefreshCw size={14} /> again refresh 
 </button>
 </div>
 )}

 {errors.length > 0 && (
 <div className="mt-3 bg-red-500/10 border border-red-500/20 rounded-lg p-3 max-h-[200px] overflow-y-auto">
 <p className="text-xs text-red-400 font-semibold mb-2">⚠️ {errors.length} সমস্যা:</p>
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
 const [filterSeason, setFilterSeason] = useState<string>("all");
 const [filterEpisode, setFilterEpisode] = useState<string>("all");

 const allContent = useMemo(() => [
 ...webseriesData.map(w => ({ ...w, _type: 'webseries' as const })),
 ...moviesData.map(m => ({ ...m, _type: 'movies' as const })),
 ], [webseriesData, moviesData]);

 const filteredContent = useMemo(() => {
 if (!searchQuery.trim()) return allContent;
 const q = searchQuery.toLowerCase();
 return allContent.filter(c => c.title?.toLowerCase().includes(q));
 }, [allContent, searchQuery]);

 // Get seasons/episodes for selected content (for filter)
 const selectedContent = useMemo(() => allContent.find(c => c.id === selectedId), [allContent, selectedId]);
 const selectedSeasons = useMemo(() => {
 if (!selectedContent || selectedContent._type !== 'webseries' || !selectedContent.seasons) return [];
 if (Array.isArray(selectedContent.seasons)) return selectedContent.seasons;
 return Object.entries(selectedContent.seasons).map(([k, v]: [string, any]) => ({ ...v, _key: k }));
 }, [selectedContent]);
 const selectedSeasonEpisodes = useMemo(() => {
 if (filterSeason === "all" || !selectedSeasons.length) return [];
 const s = selectedSeasons[Number(filterSeason)];
 if (!s?.episodes) return [];
 if (Array.isArray(s.episodes)) return s.episodes;
 return Object.entries(s.episodes).map(([k, v]: [string, any]) => ({ ...v, _key: k }));
 }, [selectedSeasons, filterSeason]);

 const qualityFields = ['link', 'link480', 'link720', 'link1080', 'link4k'] as const;
 const qualityLabels: Record<string, string> = { link: 'Default', link480: '480p', link720: '720p', link1080: '1080p', link4k: '4K' };

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

 const cloudflareCandidate = `${CLOUDFLARE_CDN}/video-proxy?url=${encoded}`;
 const customProxyCandidate = proxyUrl && isRangeSafeProxy(proxyUrl)
 ? (proxyUrl.includes('{url}')
 ? proxyUrl.split('{url}').join(encoded)
 : /[?&]url=$/.test(proxyUrl) || proxyUrl.endsWith('=') || proxyUrl.includes('?url=') || proxyUrl.includes('&url=')
 ? `${proxyUrl}${encoded}`
 : `${proxyUrl.replace(/\/$/, '')}?url=${encoded}`)
 : null;

 if (cdnEnabled) {
 addCandidate(cloudflareCandidate);
 return candidates;
 }

 if (url.startsWith('http://')) {
 addCandidate(customProxyCandidate);
 return candidates;
 }

 if (url.startsWith('https://')) {
 addCandidate(customProxyCandidate);
 addCandidate(url);
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

 if (targetContent.length === 0) { toast.error("content Select"); return; }

 abortRef.current = false;
 setChecking(true);
 setBrokenLinks([]);
 setDone(false);
 setExpandedContent(new Set());

 const broken: typeof brokenLinks = [];
 let totalLinks = 0;

 // Helper: should we include this season/episode?
 const shouldIncludeSeason = (sIdx: number) => {
 if (mode !== "single" || filterSeason === "all") return true;
 return sIdx === Number(filterSeason);
 };
 const shouldIncludeEpisode = (eIdx: number) => {
 if (mode !== "single" || filterSeason === "all" || filterEpisode === "all") return true;
 return eIdx === Number(filterEpisode);
 };

 for (const content of targetContent) {
 if (content._type === 'webseries' && content.seasons) {
 const seasonEntries = Object.entries(content.seasons as Record<string, any>);
 seasonEntries.forEach(([, season], sIdx) => {
 if (!shouldIncludeSeason(sIdx)) return;
 if (season.episodes) {
 const epEntries = Object.entries(season.episodes as Record<string, any>);
 epEntries.forEach(([, ep], eIdx) => {
 if (!shouldIncludeEpisode(eIdx)) return;
 for (const q of qualityFields) {
 if (ep[q] && typeof ep[q] === 'string' && ep[q].trim()) totalLinks++;
 }
 });
 }
 });
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
 const seasonEntries = Object.entries(content.seasons as Record<string, any>);
 for (let sIdx = 0; sIdx < seasonEntries.length; sIdx++) {
 if (!shouldIncludeSeason(sIdx)) continue;
 const [seasonKey, season] = seasonEntries[sIdx];
 if (!season.episodes) continue;
 const epEntries = Object.entries(season.episodes as Record<string, any>);
 for (let eIdx = 0; eIdx < epEntries.length; eIdx++) {
 if (!shouldIncludeEpisode(eIdx)) continue;
 const [epKey, ep] = epEntries[eIdx];
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
 toast.info(`check cancel done। ${broken.length} ব্রোন link পা gone`);
 return;
 }

 setDone(true);
 setChecking(false);
 // Auto expand all content groups
 const contentIds = new Set(broken.map(b => b.contentId));
 setExpandedContent(contentIds);
 toast.success(`link check সম্পন্ন! ${broken.length} ব্রোন link পা gone`);
 };

 const deleteBrokenLink = async (item: typeof brokenLinks[0], idx: number) => {
 const key = `${idx}`;
 setDeleting(prev => ({ ...prev, [key]: true }));
 try {
 await set(ref(db, item.fbPath), null);
 setBrokenLinks(prev => prev.filter((_, i) => i !== idx));
 toast.success(`link মুছে ফেলা done`);
 } catch (err: any) {
 toast.error(`মুছতে failed: ${err.message}`);
 }
 setDeleting(prev => ({ ...prev, [key]: false }));
 };

 const deleteAllBroken = async () => {
 if (!confirm(`${brokenLinks.length} ব্রোন link Are you sure you want to delete?`)) return;
 let deleted = 0;
 for (const item of brokenLinks) {
 try { await set(ref(db, item.fbPath), null); deleted++; } catch {}
 }
 setBrokenLinks([]);
 toast.success(`${deleted} ব্রোন link মুছে ফেলা done`);
 };

 const saveEditedUrl = async (item: typeof brokenLinks[0], idx: number) => {
 if (!editUrl.trim()) return;
 try {
 await set(ref(db, item.fbPath), editUrl.trim());
 setBrokenLinks(prev => prev.map((b, i) => i === idx ? { ...b, url: editUrl.trim() } : b));
 setEditingIdx(null);
 setEditUrl("");
 toast.success("link update done");
 } catch (err: any) {
 toast.error(`update failed: ${err.message}`);
 }
 };

 const applyJsonFix = async () => {
 try {
 const fixes = JSON.parse(jsonInput.trim());
 if (!Array.isArray(fixes)) { toast.error("JSON অবশ্যthis ক Array হতে will be"); return; }
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
 toast.success(`${applied} link update done`);
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
 <Link size={14} className="text-red-400" /> link checkার
 </h3>
 <p className="text-[11px] text-zinc-400 mb-3">
 Tests real playback through CDN/Direct/Proxy routes like the user player। যেগুলো any routeেthis প্লে will be No সেগুলোthis ব্রোন shows।
 </p>

 {!checking && !done && (
 <div className="space-y-3">
 <div className="flex gap-2">
 <button onClick={() => setMode("all")}
 className={`flex-1 py-2 text-xs font-semibold rounded-lg border transition-colors ${mode === "all" ? "bg-red-600 border-red-500 text-white" : "bg-[#141422] border-white/8 text-zinc-400 hover:text-white"}`}>
 all content ({allContent.length})
 </button>
 <button onClick={() => setMode("single")}
 className={`flex-1 py-2 text-xs font-semibold rounded-lg border transition-colors ${mode === "single" ? "bg-red-600 border-red-500 text-white" : "bg-[#141422] border-white/8 text-zinc-400 hover:text-white"}`}>
 specific content
 </button>
 </div>

 {mode === "single" && (
 <div className="space-y-2">
 <div className="relative">
 <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
 <input
 value={searchQuery}
 onChange={e => setSearchQuery(e.target.value)}
 placeholder="content search ..."
 className="w-full text-xs bg-zinc-800 border border-zinc-700 rounded-lg pl-8 pr-3 py-2.5 text-white placeholder-zinc-500 focus:border-red-500 outline-none"
 />
 </div>
 <div className="max-h-[200px] overflow-y-auto space-y-1 rounded-lg border border-zinc-700/50 p-1.5">
 {filteredContent.map(c => (
 <button
 key={c.id}
 onClick={() => { setSelectedId(c.id); setFilterSeason("all"); setFilterEpisode("all"); }}
 className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors flex items-center gap-2 ${
 selectedId === c.id ? 'bg-red-600/20 border border-red-500/40 text-red-300' : 'hover:bg-zinc-700/50 text-zinc-300'
 }`}
 >
 {c.poster && <CachedImg src={c.poster} className="w-6 h-8 rounded object-cover flex-shrink-0" loading="lazy" decoding="async" />}
 <span className="truncate">{c.title}</span>
 <span className="text-[10px] text-zinc-500 ml-auto flex-shrink-0">{c._type === 'webseries' ? '📺' : '🎬'}</span>
 </button>
 ))}
 {filteredContent.length === 0 && <p className="text-[11px] text-zinc-500 text-center py-3">any content পা যায়নি</p>}
 </div>

 {/* Season/Episode Filter for selected webseries */}
 {selectedId && selectedContent?._type === 'webseries' && selectedSeasons.length > 0 && (
 <div className="grid grid-cols-2 gap-2 mt-2">
 <select value={filterSeason} onChange={e => { setFilterSeason(e.target.value); setFilterEpisode("all"); }}
 className="text-[10px] bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-2 text-white">
 <option value="all">all Season</option>
 {selectedSeasons.map((s: any, i: number) => (
 <option key={i} value={String(i)}>{s.name || `Season ${s.seasonNumber || i + 1}`}</option>
 ))}
 </select>
 <select value={filterEpisode} onChange={e => setFilterEpisode(e.target.value)}
 disabled={filterSeason === "all"}
 className="text-[10px] bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-2 text-white disabled:opacity-40">
 <option value="all">all episode</option>
 {selectedSeasonEpisodes.map((ep: any, i: number) => (
 <option key={i} value={String(i)}>EP {ep.episodeNumber || i + 1}</option>
 ))}
 </select>
 </div>
 )}
 </div>
 )}

 <button
 onClick={startCheck}
 disabled={mode === "single" && !selectedId}
 className={`${btnPrimary} w-full py-3 flex items-center justify-center gap-2 text-sm disabled:opacity-40`}
 >
 <Link size={16} /> link check start
 </button>
 </div>
 )}

 {checking && (
 <div className="space-y-3">
 <div className="flex items-center justify-between text-xs text-zinc-400">
 <span>{progress.current}/{progress.total} link</span>
 <span>{pct}%</span>
 </div>
 <div className="w-full h-3 bg-[#141422] rounded-full overflow-hidden">
 <div className="h-full bg-gradient-to-r from-red-500 to-orange-400 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
 </div>
 <p className="text-[11px] text-zinc-300 truncate">🔍 {progress.currentTitle}</p>
 {brokenLinks.length > 0 && (
 <p className="text-[10px] text-red-400">❌ {brokenLinks.length} ব্রোন link পা gone</p>
 )}
 <p className="text-[10px] text-zinc-500 animate-pulse">⏳ video প্লেব্যাক test running, browser off ন No...</p>
 <button
 onClick={() => { abortRef.current = true; }}
 className="w-full py-2 text-xs font-semibold bg-red-600/80 hover:bg-red-500 rounded-lg transition-colors flex items-center justify-center gap-1.5 mt-2"
 >
 <X size={12} /> check cancel 
 </button>
 </div>
 )}

 {done && (
 <div className="space-y-3">
 <div className={`${brokenLinks.length > 0 ? 'bg-red-500/10 border-red-500/30' : 'bg-emerald-500/10 border-emerald-500/30'} border rounded-lg p-3 flex items-center justify-between`}>
 <p className={`text-sm font-semibold flex items-center gap-2 ${brokenLinks.length > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
 <Check size={16} />
 {brokenLinks.length > 0
 ? `${brokenLinks.length} ব্রোন link পা gone (${groupedBroken.length} contentে)`
 : 'all link ঠিক exists! ✅'}
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
 <Trash2 size={12} /> Clear All ({brokenLinks.length})
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
 <Edit size={12} /> JSON with ফিক্স 
 </button>
 {jsonMode && (
 <div className="space-y-2 bg-zinc-800/50 border border-zinc-700/50 rounded-lg p-3">
 <p className="text-[10px] text-zinc-400">
 নিচে JSON Paste — format: [&#123;"fbPath":"...", "newUrl":"..."&#125;]
 </p>
 <textarea
 value={jsonInput}
 onChange={e => setJsonInput(e.target.value)}
 rows={5}
 placeholder='[{"fbPath":"webseries/.../link","newUrl":"https://..."}]'
 className="w-full text-xs bg-zinc-900 border border-zinc-700 rounded-lg p-2.5 text-white placeholder-zinc-600 focus:border-indigo-500 outline-none resize-none font-mono"
 />
 <button onClick={applyJsonFix} className="w-full py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors">
 JSON Apply 
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
 {group.type === 'webseries' ? '📺 Series' : '🎬 Movie'} • {group.items.length} ব্রোন link
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
 <Edit size={9} /> ডিট
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
 placeholder="new URL day..."
 />
 <button onClick={() => saveEditedUrl(item, item.originalIdx)} className="px-2.5 py-1.5 text-[9px] bg-emerald-600 hover:bg-emerald-500 rounded-md font-semibold">save</button>
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
 <RefreshCw size={14} /> again check 
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
 const [filterSeason, setFilterSeason] = useState<string>("all");
 const [filterEpisode, setFilterEpisode] = useState<string>("all");

 const filteredEpisodes = useMemo(() => {
 if (filterSeason === "all") return [];
 const s = seasonsData[Number(filterSeason)];
 return s?.episodes || [];
 }, [seasonsData, filterSeason]);

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
 const settingsSnap = await get(ref(db, "settings"));
 const settings = settingsSnap.val() || {};
 const cdnEnabled = settings.cdnEnabled !== false;
 const proxyUrl = settings.proxyServer?.url || '';
 const encoded = encodeURIComponent(url);
 const candidates: string[] = [];

 if (cdnEnabled) {
 candidates.push(`${CLOUDFLARE_CDN}/video-proxy?url=${encoded}`);
 } else if (url.startsWith('http://')) {
 if (proxyUrl) {
 candidates.push(
 proxyUrl.includes('{url}')
 ? proxyUrl.split('{url}').join(encoded)
 : /[?&]url=$/.test(proxyUrl) || proxyUrl.endsWith('=') || proxyUrl.includes('?url=') || proxyUrl.includes('&url=')
 ? `${proxyUrl}${encoded}`
 : `${proxyUrl.replace(/\/$/, '')}?url=${encoded}`
 );
 }
 } else {
 if (proxyUrl) {
 candidates.push(
 proxyUrl.includes('{url}')
 ? proxyUrl.split('{url}').join(encoded)
 : /[?&]url=$/.test(proxyUrl) || proxyUrl.endsWith('=') || proxyUrl.includes('?url=') || proxyUrl.includes('&url=')
 ? `${proxyUrl}${encoded}`
 : `${proxyUrl.replace(/\/$/, '')}?url=${encoded}`
 );
 }
 candidates.push(url);
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

 // Filter seasons/episodes based on selection
 const targetSeasons = filterSeason === "all" ? seasonsData : [seasonsData[Number(filterSeason)]];

 targetSeasons.forEach(s => {
 if (!s?.episodes) return;
 const eps = filterSeason !== "all" && filterEpisode !== "all" ? [s.episodes[Number(filterEpisode)]] : s.episodes;
 eps.forEach((ep: any) => {
 if (!ep) return;
 for (const q of qualityFields) if (ep[q] && typeof ep[q] === 'string' && ep[q].trim()) totalLinks++;
 });
 });

 setProgress({ current: 0, total: totalLinks, currentTitle: "" });

 for (let sIdx = 0; sIdx < targetSeasons.length; sIdx++) {
 const season = targetSeasons[sIdx];
 if (!season?.episodes) continue;
 const episodes = filterSeason !== "all" && filterEpisode !== "all" ? [season.episodes[Number(filterEpisode)]] : season.episodes;
 for (let eIdx = 0; eIdx < (episodes?.length || 0); eIdx++) {
 const ep = episodes[eIdx];
 if (!ep) continue;
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
 if (broken.length === 0 && !abortRef.current) toast.success("✅ all link ঠিক exists!");
 else if (broken.length > 0) toast.warning(`⚠️ ${broken.length} ব্রোন link পা gone`);
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
 <h4 className="text-xs font-bold flex items-center gap-2"><Link size={12} className="text-amber-400" /> Link Checker ({totalLinks} link)</h4>
 {!checking && !done && (
 <button onClick={startCheck} className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-amber-500/20 border border-amber-500/30 text-amber-400 hover:bg-amber-500/40 flex items-center gap-1">
 <Search size={10} /> check 
 </button>
 )}
 {checking && (
 <button onClick={() => { abortRef.current = true; }} className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/40 flex items-center gap-1">
 <X size={10} /> cancel
 </button>
 )}
 </div>
 {/* Season/Episode Filter */}
 {!checking && !done && seasonsData.length > 0 && (
 <div className="grid grid-cols-2 gap-2 mb-3">
 <select value={filterSeason} onChange={e => { setFilterSeason(e.target.value); setFilterEpisode("all"); }}
 className="text-[10px] bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-white">
 <option value="all">all Season</option>
 {seasonsData.map((s: any, i: number) => (
 <option key={i} value={String(i)}>{s.name || `Season ${i + 1}`}</option>
 ))}
 </select>
 <select value={filterEpisode} onChange={e => setFilterEpisode(e.target.value)}
 disabled={filterSeason === "all"}
 className="text-[10px] bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-white disabled:opacity-40">
 <option value="all">all episode</option>
 {filteredEpisodes.map((ep: any, i: number) => (
 <option key={i} value={String(i)}>EP {ep.episodeNumber || i + 1}</option>
 ))}
 </select>
 </div>
 )}
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
 <p className="text-emerald-400 text-xs font-semibold">✅ all link task করছে! ({goodCount}/{goodCount + brokenLinks.length})</p>
 </div>
 )}
 {brokenLinks.length > 0 && (
 <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
 <p className="text-[10px] text-red-400 font-bold mb-1">❌ {brokenLinks.length} ব্রোন link:</p>
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
 <RefreshCw size={10} /> again check 
 </button>
 )}
 </div>
 );
};

export default Admin;
