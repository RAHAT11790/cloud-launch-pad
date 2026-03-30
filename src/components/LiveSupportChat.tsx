import { useState, useEffect, useRef, useCallback } from "react";
import { X, Send } from "lucide-react";

import { db, ref, push, set, onValue } from "@/lib/firebase";
import { toast } from "sonner";
import { useBranding } from "@/hooks/useBranding";
import { SITE_URL } from "@/lib/siteConfig";
import logoImg from "@/assets/logo.png";

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "admin";
  content: string;
  timestamp: number;
}

interface AnimeInfo {
  title: string;
  type: string;
  category?: string;
  rating?: string;
  year?: string;
  storyline?: string;
  dubType?: string;
  episodeCount?: number;
  seasonCount?: number;
  source?: string;
  id?: string;
  slug?: string;
  shareLink?: string;
}

interface LiveSupportChatProps {
  getAnimeList?: () => AnimeInfo[];
  isOpen: boolean;
  onClose: () => void;
  onAnimeSelect?: (animeKey: string) => void;
}

const LiveSupportChat = ({ getAnimeList, isOpen, onClose, onAnimeSelect }: LiveSupportChatProps) => {
  const branding = useBranding();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [aiStatus, setAiStatus] = useState<"checking" | "ready" | "offline">("checking");
  const [logoFailed, setLogoFailed] = useState(false);
  const [userId, setUserId] = useState("");
  const [userName, setUserName] = useState("Guest");
  const [userContext, setUserContext] = useState<string>("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const cooldownUntilRef = useRef(0);
  const logoSrc = !logoFailed && branding.logoUrl ? branding.logoUrl : logoImg;

  useEffect(() => {
    try {
      const u = JSON.parse(localStorage.getItem("rsanime_user") || "{}");
      if (u.id) setUserId(u.id);
      if (u.name || u.username) setUserName(u.name || u.username);
    } catch {}
  }, []);

  useEffect(() => {
    if (!userId) return;
    const commaKey = (() => {
      try {
        const u = JSON.parse(localStorage.getItem("rsanime_user") || "{}");
        return u.email?.replace(/\./g, ",") || "";
      } catch { return ""; }
    })();
    if (!commaKey) return;

    const appUserRef = ref(db, `appUsers/${commaKey}`);
    const premiumRef = ref(db, `users/${userId}/premium`);

    let appUserData: any = null;
    let premiumData: any = null;

    const buildContext = () => {
      let ctx = "";
      if (appUserData) {
        ctx += `ইউজার নাম: ${appUserData.name || "অজানা"}\n`;
        ctx += `ইমেইল: ${appUserData.email || commaKey.replace(/,/g, ".")}\n`;
        ctx += `পাসওয়ার্ড সেট আছে: ${appUserData.password ? "হ্যাঁ" : "না"}\n`;
        if (appUserData.password) {
          ctx += `বর্তমান পাসওয়ার্ড: ${appUserData.password}\n`;
        }
        ctx += `লগইন পদ্ধতি: ${appUserData.googleUid ? "Google" : "Email/Password"}\n`;
      }
      if (premiumData) {
        ctx += `প্রিমিয়াম স্ট্যাটাস: ${premiumData.active ? "সক্রিয় ✅" : "নিষ্ক্রিয় ❌"}\n`;
        if (premiumData.active) {
          const expiry = premiumData.expiresAt ? new Date(premiumData.expiresAt) : null;
          if (expiry) {
            const remaining = Math.max(0, Math.ceil((expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
            ctx += `প্রিমিয়াম মেয়াদ: ${remaining} দিন বাকি (${expiry.toLocaleDateString("bn-BD")})\n`;
          }
          if (premiumData.deviceLimit) ctx += `ডিভাইস লিমিট: ${premiumData.deviceLimit}টি\n`;
          if (premiumData.devices) {
            const deviceCount = typeof premiumData.devices === "object" ? Object.keys(premiumData.devices).length : 0;
            ctx += `সক্রিয় ডিভাইস: ${deviceCount}টি\n`;
          }
        }
      }
      setUserContext(ctx);
    };

    const unsub1 = onValue(appUserRef, (snap) => {
      appUserData = snap.val();
      buildContext();
    });
    const unsub2 = onValue(premiumRef, (snap) => {
      premiumData = snap.val();
      buildContext();
    });

    return () => { unsub1(); unsub2(); };
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    const chatRef = ref(db, `supportChats/${userId}/messages`);
    const unsub = onValue(chatRef, (snap) => {
      const data = snap.val();
      if (!data) return;
      const adminMsgs = Object.entries(data)
        .map(([id, msg]: any) => ({ id, ...msg }))
        .filter((m: any) => m.role === "admin");

      setMessages(prev => {
        const existingIds = new Set(prev.map(m => m.id));
        const newMsgs = adminMsgs.filter((m: any) => !existingIds.has(m.id));
        if (newMsgs.length === 0) return prev;
        return [...prev, ...newMsgs].sort((a, b) => a.timestamp - b.timestamp);
      });
    });
    return () => unsub();
  }, [userId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;

    const verifyAi = async () => {
      setAiStatus("checking");
      try {
        const { get: fbGet } = await import("@/lib/firebase");
        const dbRef = (await import("@/lib/firebase")).ref;
        const dbInst = (await import("@/lib/firebase")).db;
        const aiConfigSnap = await fbGet(dbRef(dbInst, "settings/aiChat"));
        const aiConfig = aiConfigSnap.val();

        if (!cancelled) {
          setAiStatus(aiConfig?.enabled && aiConfig?.url ? "ready" : "offline");
        }
      } catch {
        if (!cancelled) setAiStatus("offline");
      }
    };

    verifyAi();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const buildAnimeContext = useCallback(() => {
    const animeList = getAnimeList?.() || [];
    if (animeList.length === 0) return "";
    const buildShareLink = (anime: AnimeInfo) => {
      if (anime.shareLink) return anime.shareLink;
      const key = anime.id || (anime.source === "animesalt" && anime.slug ? `as_${anime.slug}` : "");
      return key ? `${SITE_URL}?anime=${encodeURIComponent(key)}` : "";
    };

    const primaryItems = animeList.filter((a) => a.source !== "animesalt");
    const altItems = animeList.filter((a) => a.source === "animesalt");

    let context = `SITE: ${SITE_URL}\n`;
    context += `STRICT RULES:\n`;
    context += `- ONLY use the exact SHARE_LINK from this list.\n`;
    context += `- NEVER generate, guess, edit, shorten, or replace any link.\n`;
    context += `- If the exact anime is not found in this list, say it is not available on our site.\n`;
    context += `- NEVER give Crunchyroll, Funimation, YouTube, Google, or any external link.\n`;
    context += `- Always return anime buttons in this exact format: [BTN:Short Name:LINK:exact_share_link]\n`;
    context += `- Match anime by exact title first. Do not give another anime's link.\n\n`;

    context += `RS Catalog (${primaryItems.length}টি):\n`;
    primaryItems.slice(0, 80).forEach((a) => {
      const shareLink = buildShareLink(a);
      if (a.id && shareLink) context += `- TITLE: ${a.title} | ID: ${a.id} | SHARE_LINK: ${shareLink}\n`;
    });

    if (altItems.length > 0) {
      context += `\nAN Catalog (${altItems.length}টি):\n`;
      altItems.slice(0, 80).forEach((a) => {
        const shareLink = buildShareLink(a);
        if (a.id && shareLink) context += `- TITLE: ${a.title} | ID: ${a.id} | SHARE_LINK: ${shareLink}\n`;
      });
    }

    return context.substring(0, 6000);
  }, [getAnimeList]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const now = Date.now();
    if (cooldownUntilRef.current > now) {
      const waitSeconds = Math.ceil((cooldownUntilRef.current - now) / 1000);
      toast.error(`⏳ ${waitSeconds} সেকেন্ড পরে আবার চেষ্টা করুন`);
      return;
    }

    const normalize = (value: string) => value.toLowerCase().replace(/[!?.,/\\-]/g, " ").replace(/\s+/g, " ").trim();
    const normalizedText = normalize(text);
    const extractField = (label: string) => {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = userContext.match(new RegExp(`^${escaped}:\\s*(.+)$`, "mi"));
      return match?.[1]?.trim() || "";
    };
    const hasAny = (patterns: string[]) => patterns.some((pattern) => normalizedText.includes(pattern));
    const asksPassword = hasAny(["password", "pass", "পাসওয়ার্ড", "পাস", "id pass", "আইডি পাস"]);
    const asksEmail = hasAny(["email", "gmail", "mail", "ইমেইল", "id", "আইডি"]);
    const asksPremium = hasAny(["premium", "প্রিমিয়াম", "subscription", "সাবস্ক্রিপশন", "মেয়াদ", "দিন বাকি", "device", "ডিভাইস", "limit", "লিমিট"]);
    const asksAccountInfo = asksPassword || asksEmail || asksPremium;
    const asksAnime = hasAny(["anime", "অ্যানিমে", "এনিমে", "movie", "মুভি", "series", "সিরিজ", "episode", "এপিসোড", "দেখ", "দেও", "link", "লিংক", "দাও", "suggest", "recommend", "naruto", "one piece", "dragon ball", "attack on titan", "demon slayer"]);
    const isGreeting = hasAny(["hi", "hello", "hey", "assalamu alaikum", "আসসালামু আলাইকুম", "আসসালামু আলাইকুম", "সালাম", "হ্যালো", "হাই"]);
    const isTinyMessage = normalizedText.split(" ").filter(Boolean).length <= 3;
    const buildLocalReply = () => {
      if (isGreeting && isTinyMessage) {
        return `আসসালামু আলাইকুম ${userName || "ভাই"}! 👋\nআমি RS AI। anime, episode, premium, ID/password—যা জানতে চান লিখুন।`;
      }

      if (!userContext) return "";

      const name = extractField("ইউজার নাম") || "আপনি";
      const email = extractField("ইমেইল");
      const password = extractField("বর্তমান পাসওয়ার্ড");
      const premiumStatus = extractField("প্রিমিয়াম স্ট্যাটাস");
      const premiumExpiry = extractField("প্রিমিয়াম মেয়াদ");
      const deviceLimit = extractField("ডিভাইস লিমিট");
      const activeDevices = extractField("সক্রিয় ডিভাইস");

      if (asksPassword && asksEmail) {
        return `${name}, আপনার লগইন তথ্য:\n• ইমেইল/আইডি: ${email || "পাওয়া যায়নি"}\n• পাসওয়ার্ড: ${password || "সেট করা নেই"} 🔐`;
      }
      if (asksPassword) {
        return password ? `${name}, আপনার বর্তমান পাসওয়ার্ড: ${password} 🔐` : `${name}, আপনার অ্যাকাউন্টে কোনো পাসওয়ার্ড সেট করা নেই।`;
      }
      if (asksEmail) {
        return email ? `${name}, আপনার লগইন ইমেইল/আইডি: ${email} 📩` : `${name}, আপনার লগইন ইমেইল/আইডি পাওয়া যায়নি।`;
      }
      if (asksPremium) {
        const info = [
          premiumStatus ? `• ${premiumStatus}` : "",
          premiumExpiry ? `• ${premiumExpiry}` : "",
          deviceLimit ? `• ডিভাইস লিমিট: ${deviceLimit}` : "",
          activeDevices ? `• সক্রিয় ডিভাইস: ${activeDevices}` : "",
        ].filter(Boolean);
        return info.length ? `${name}, আপনার প্রিমিয়াম তথ্য:\n${info.join("\n")} ✨` : "";
      }
      return "";
    };

    setInput("");
    const userMsg: ChatMessage = { id: `u_${Date.now()}`, role: "user", content: text, timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);

    if (text.includes("@RS") || text.includes("@rs") || text.includes("@Rs")) {
      const cleanMsg = text.replace(/@[Rr][Ss]/g, "").trim();
      try {
        const msgRef = push(ref(db, `supportChats/${userId}/messages`));
        await set(msgRef, { role: "user", content: cleanMsg || text, timestamp: Date.now(), userName, userId, isAdminRequest: true });
        await set(ref(db, `supportChats/${userId}/meta`), { userName, lastMessage: cleanMsg || text, lastTimestamp: Date.now(), unread: true });
        const adminReply: ChatMessage = { id: `a_${Date.now()}`, role: "assistant", content: "✅ আপনার মেসেজ Admin-এর কাছে পাঠানো হয়েছে! Admin রিপ্লাই দিলে এখানেই দেখতে পাবেন। 😊", timestamp: Date.now() };
        setMessages(prev => [...prev, adminReply]);
      } catch {
        toast.error("মেসেজ পাঠাতে ব্যর্থ");
      }
      return;
    }

    const localReply = buildLocalReply();
    if (localReply) {
      setAiStatus("ready");
      const localMsg: ChatMessage = {
        id: `local_${Date.now()}`,
        role: "assistant",
        content: localReply,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, localMsg]);
      return;
    }

    setLoading(true);
    try {
      const trimmedText = text.slice(0, 500);
      const chatHistory = messages.slice(-3).map(m => ({
        role: m.role === "admin" ? "user" : m.role,
        content: (m.role === "admin" ? `[Admin Reply]: ${m.content}` : m.content).slice(0, 300),
      }));
      chatHistory.push({ role: "user", content: trimmedText });

      const { get: fbGet } = await import("@/lib/firebase");
      const dbRef = (await import("@/lib/firebase")).ref;
      const dbInst = (await import("@/lib/firebase")).db;
      const aiConfigSnap = await fbGet(dbRef(dbInst, "settings/aiChat"));
      const aiConfig = aiConfigSnap.val();

      if (!aiConfig?.enabled || !aiConfig?.url) {
        throw new Error("AI not configured");
      }

      const payload: Record<string, unknown> = { messages: chatHistory };
      if (asksAccountInfo && userContext) {
        payload.userContext = userContext.slice(0, 600);
      }
      if (asksAnime) {
        const animeCtx = buildAnimeContext();
        if (animeCtx) payload.animeContext = animeCtx;
      }

      const res = await fetch(aiConfig.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      // Support both Supabase edge ({ reply }) and Cloudflare worker ({ response }) formats
      const aiReply = data?.reply || data?.response;
      if (!res.ok && !aiReply) {
        throw new Error(data?.error || `AI error ${res.status}`);
      }
      if (!aiReply) {
        throw new Error("Empty AI reply");
      }

      cooldownUntilRef.current = 0;
      setAiStatus("ready");

      const sanitizeReply = (raw: string) =>
        raw.replace(/\bAnimeSalt\b/gi, "AN").replace(/\[AS\]/g, "[AN]");

      const aiMsg: ChatMessage = {
        id: `ai_${Date.now()}`,
        role: "assistant",
        content: sanitizeReply(aiReply),
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, aiMsg]);
    } catch (err: any) {
      const isRateLimit = err?.message?.includes("429") || err?.message?.toLowerCase().includes("too many");
      if (isRateLimit) {
        cooldownUntilRef.current = Date.now() + 15000;
      }
      const errMsg: ChatMessage = {
        id: `err_${Date.now()}`,
        role: "assistant",
        content: isRateLimit
          ? "⏳ এই মুহূর্তে অনেক বেশি রিকোয়েস্ট হচ্ছে। ১৫ সেকেন্ড পরে আবার চেষ্টা করুন।"
          : "⚠️ সার্ভারে সমস্যা হচ্ছে। একটু পরে আবার চেষ্টা করুন। সরাসরি Admin-এর কাছে পৌঁছাতে @RS লিখে মেসেজ করুন।",
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errMsg]);
      if (!isRateLimit) setAiStatus("offline");
    }
    setLoading(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const renderMessageContent = (content: string) => {
    const normalizeAnimeKey = (value: string) =>
      decodeURIComponent(value)
        .trim()
        .replace(/[\]\)}>,.!?]+$/g, "")
        .replace(/^["'(\[]+/, "");

    const getInternalAnimeKey = (value: string) => {
      const cleaned = value.trim().replace(/[\]\)}>,.!?]+$/g, "");
      const animeMatch = cleaned.match(/[?&]anime=([^&\s]+)/i);
      return animeMatch ? normalizeAnimeKey(animeMatch[1]) : "";
    };

    const isInternalSiteUrl = (value: string) => {
      try {
        const url = new URL(value.trim().replace(/[\]\)}>,.!?]+$/g, ""));
        const appOrigin = typeof window !== "undefined" ? window.location.origin : SITE_URL;
        const siteOrigin = new URL(SITE_URL).origin;
        return url.origin === appOrigin || url.origin === siteOrigin;
      } catch {
        return false;
      }
    };

    // Match various BTN formats the AI might produce
    const btnRegex = /\[BTN:(.+?):(ANIME_ID|ANIME|LINK|ID):([^\]]+)\]/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = btnRegex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        parts.push(<span key={`t${lastIndex}`} className="whitespace-pre-wrap">{content.slice(lastIndex, match.index)}</span>);
      }

      const label = match[1];
      const type = match[2];
      const payload = match[3];

      if (type === "LINK") {
        const animeKey = getInternalAnimeKey(payload);
        if (animeKey && isInternalSiteUrl(payload)) {
          parts.push(
            <button
              key={`link${match.index}`}
              onClick={() => {
                onAnimeSelect?.(animeKey);
                onClose();
              }}
              className="block w-full mt-1.5 mb-1 px-3 py-2 rounded-lg text-primary-foreground text-xs font-medium text-center hover:opacity-90 active:scale-[0.98] transition-all gradient-primary"
            >
              ▶ {label.slice(0, 20).trim() || "Open"}
            </button>
          );
        } else {
          parts.push(
            <a
              key={`link${match.index}`}
              href={payload}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full mt-1.5 mb-1 px-3 py-2 rounded-lg text-primary-foreground text-xs font-medium text-center hover:opacity-90 active:scale-[0.98] transition-all gradient-primary"
            >
              {label}
            </a>
          );
        }
      } else {
        parts.push(
          <button
            key={`btn${match.index}`}
            onClick={() => {
              onAnimeSelect?.(payload);
              onClose();
            }}
            className="block w-full mt-1.5 mb-1 px-3 py-2 rounded-lg text-primary text-xs font-medium text-left hover:bg-primary/10 active:scale-[0.98] transition-all bg-card"
            style={{ boxShadow: "var(--neu-shadow-sm)" }}
          >
            {label}
          </button>
        );
      }

      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < content.length) {
      parts.push(<span key={`t${lastIndex}`} className="whitespace-pre-wrap">{content.slice(lastIndex)}</span>);
    }

    // Auto-detect plain URLs and make them clickable
    const renderWithLinks = (nodes: React.ReactNode[]): React.ReactNode[] => {
      const urlRegex = /(https?:\/\/[^\s*<>]+)/g;
      const result: React.ReactNode[] = [];
      nodes.forEach((node, i) => {
        if (typeof node === "string" || (node && typeof node === "object" && "props" in node && node.props?.className?.includes("whitespace-pre-wrap"))) {
          const text = typeof node === "string" ? node : (node as any).props.children;
          if (typeof text !== "string") { result.push(node); return; }
          const textParts: React.ReactNode[] = [];
          let lastIdx = 0;
          let urlMatch: RegExpExecArray | null;
          const r = new RegExp(urlRegex);
          while ((urlMatch = r.exec(text)) !== null) {
            if (urlMatch.index > lastIdx) {
              textParts.push(text.slice(lastIdx, urlMatch.index));
            }
            const url = urlMatch[1].replace(/\*+$/g, "").replace(/[\]\)}>,.!?]+$/g, "");
            // Extract anime name from URL path
            const pathName = (() => {
              try {
                const segments = new URL(url).pathname.split("/").filter(Boolean);
                const last = segments[segments.length - 1] || "";
                return last.replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase()).slice(0, 25);
              } catch { return "Link"; }
            })();
            // Internal RS Anime link → use onAnimeSelect for in-app navigation
            const animeKey = getInternalAnimeKey(url);
            if (animeKey && isInternalSiteUrl(url)) {
              textParts.push(
                <button key={`url_${i}_${urlMatch.index}`}
                  onClick={() => { onAnimeSelect?.(animeKey); onClose(); }}
                  className="inline-flex items-center gap-1 mt-1 mb-1 px-3 py-1.5 rounded-lg text-primary-foreground text-xs font-medium hover:opacity-90 active:scale-[0.98] transition-all gradient-primary max-w-[200px] truncate">
                  ▶ {pathName || "Open"}
                </button>
              );
            } else {
              textParts.push(
                <a key={`url_${i}_${urlMatch.index}`} href={url} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 mt-1 mb-1 px-3 py-1.5 rounded-lg text-primary-foreground text-xs font-medium hover:opacity-90 active:scale-[0.98] transition-all gradient-primary max-w-[200px] truncate">
                  ▶ {pathName || "Open"}
                </a>
              );
            }
            lastIdx = urlMatch.index + urlMatch[0].length;
          }
          if (lastIdx < text.length) textParts.push(text.slice(lastIdx));
          if (textParts.length > 0) {
            result.push(<span key={`wl_${i}`} className="whitespace-pre-wrap">{textParts}</span>);
          } else {
            result.push(node);
          }
        } else {
          result.push(node);
        }
      });
      return result;
    };

    const finalParts = parts.length > 0 ? renderWithLinks(parts) : [<span key="raw" className="whitespace-pre-wrap">{content}</span>];
    return <div>{finalParts}</div>;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed left-2 right-2 sm:left-auto sm:right-3 sm:w-[370px] z-[60] rounded-2xl overflow-hidden flex flex-col bg-background"
      style={{ 
        top: "70px", bottom: "65px", maxHeight: "calc(100vh - 135px)",
        boxShadow: "var(--neu-shadow-lg)",
      }}>
      
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-3 bg-card" style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.05)" }}>
        <div className="w-9 h-9 rounded-lg overflow-hidden p-0.5 bg-card" style={{ boxShadow: "var(--neu-shadow-sm)" }}>
          <img src={logoSrc} alt={branding.siteName} className="w-full h-full object-contain" onError={() => setLogoFailed(true)} />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-bold text-foreground">{branding.siteName} Support</h3>
          <div className="flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full ${aiStatus === "ready" ? "bg-primary animate-pulse" : aiStatus === "offline" ? "bg-destructive" : "bg-muted-foreground/60"}`} />
            <p className={`text-[10px] ${aiStatus === "ready" ? "text-primary" : aiStatus === "offline" ? "text-destructive" : "text-muted-foreground"}`}>
              {aiStatus === "ready" ? "AI Assistant • Ready" : aiStatus === "offline" ? "AI Assistant • Offline" : "AI Assistant • Checking"}
            </p>
          </div>
        </div>
        <button onClick={onClose} className="p-1.5 hover:bg-muted rounded-lg transition-colors">
          <X size={16} className="text-muted-foreground" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-8">
            <div className="w-12 h-12 rounded-lg overflow-hidden mx-auto mb-3 bg-card p-1" style={{ boxShadow: "var(--neu-shadow-sm)" }}>
              <img src={logoSrc} alt={branding.siteName} className="w-full h-full object-contain" onError={() => setLogoFailed(true)} />
            </div>
            <p className="text-sm text-foreground font-medium">হ্যালো! 👋</p>
            <p className="text-xs text-muted-foreground mt-1">আমি {branding.siteName} Bot, আপনাকে সাহায্য করতে এখানে আছি!</p>
            <p className="text-[10px] text-primary/60 mt-2">Admin-এর সাথে কথা বলতে @RS লিখুন</p>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
              msg.role === "user"
                ? "gradient-primary text-primary-foreground rounded-br-md"
                : msg.role === "admin"
                ? "bg-green-100 text-green-900 rounded-bl-md"
                : "bg-card text-foreground rounded-bl-md"
            }`}
            style={msg.role !== "user" ? { boxShadow: "var(--neu-shadow-sm)" } : { boxShadow: "0 3px 10px hsla(42,80%,50%,0.3)" }}>
              {msg.role === "admin" && (
                <span className="text-[10px] font-bold text-green-700 block mb-1">🛡️ Admin (RS)</span>
              )}
              {renderMessageContent(msg.content)}
              <span className="text-[9px] opacity-40 mt-1 block text-right">
                {new Date(msg.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-card rounded-2xl rounded-bl-md px-4 py-3" style={{ boxShadow: "var(--neu-shadow-sm)" }}>
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-3" style={{ boxShadow: "0 -2px 8px rgba(0,0,0,0.04)" }}>
        <div className="flex items-center gap-2">
          <input
            value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
            placeholder="মেসেজ লিখুন..."
            className="flex-1 min-w-0 bg-secondary rounded-full px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary/30 transition-colors"
            style={{ boxShadow: "var(--neu-shadow-inset)" }}
            disabled={loading}
          />
          <button onClick={sendMessage} disabled={!input.trim() || loading}
            className="flex-shrink-0 w-10 h-10 rounded-full gradient-primary hover:opacity-90 disabled:opacity-30 flex items-center justify-center transition-colors"
            style={{ boxShadow: "0 3px 10px hsla(42,80%,50%,0.3)" }}>
            <Send size={16} className="text-primary-foreground" />
          </button>
        </div>
        <p className="text-[9px] text-muted-foreground text-center mt-2">@RS লিখে Admin-কে সরাসরি মেসেজ করুন</p>
      </div>
    </div>
  );
};

export default LiveSupportChat;
