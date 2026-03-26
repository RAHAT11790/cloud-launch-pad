import { useState, useEffect, useRef, useCallback } from "react";
import { X, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { db, ref, push, set, onValue } from "@/lib/firebase";
import { toast } from "sonner";
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
}

interface LiveSupportChatProps {
  animeList?: AnimeInfo[];
  isOpen: boolean;
  onClose: () => void;
  onAnimeSelect?: (animeKey: string) => void;
}

const LiveSupportChat = ({ animeList = [], isOpen, onClose, onAnimeSelect }: LiveSupportChatProps) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [userId, setUserId] = useState("");
  const [userName, setUserName] = useState("Guest");
  const [userContext, setUserContext] = useState<string>("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const u = JSON.parse(localStorage.getItem("rsanime_user") || "{}");
      if (u.id) setUserId(u.id);
      if (u.name || u.username) setUserName(u.name || u.username);
    } catch {}
  }, []);

  // Fetch user-specific data from Firebase for personalized AI
  useEffect(() => {
    if (!userId) return;
    const commaKey = (() => {
      try {
        const u = JSON.parse(localStorage.getItem("rsanime_user") || "{}");
        return u.email?.replace(/\./g, ",") || "";
      } catch { return ""; }
    })();
    if (!commaKey) return;

    // Fetch appUsers data
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

  const animeContext = useCallback(() => {
    if (animeList.length === 0) return "";
    const primaryItems = animeList.filter((a) => a.source !== "animesalt");
    const altItems = animeList.filter((a) => a.source === "animesalt");

    let context = `মোট Anime সংখ্যা: ${animeList.length}\n`;
    context += `RS Catalog: ${primaryItems.length}টি\n`;
    context += `AN Catalog: ${altItems.length}টি\n`;
    context += `মোট Series: ${animeList.filter((a) => a.type === "webseries").length}টি\n`;
    context += `মোট Movies: ${animeList.filter((a) => a.type === "movie").length}টি\n\n`;

    const byCategory: Record<string, AnimeInfo[]> = {};
    animeList.forEach((a) => {
      const cat = a.category || "Other";
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(a);
    });

    context += `ক্যাটাগরি অনুযায়ী (ID সহ):\n`;
    Object.entries(byCategory).forEach(([cat, items]) => {
      context += `\n📁 ${cat} (${items.length}টি):\n`;
      items.forEach((a) => {
        const sourceKey = a.source === "animesalt" ? "AN" : "RS";
        let line = `  - [ID:${a.id || a.title}] [SRC:${sourceKey}] ${a.title} (${a.type === "movie" ? "Movie" : "Series"}`;
        if (a.year) line += `, ${a.year}`;
        if (a.rating) line += `, Rating: ${a.rating}`;
        if (a.dubType) line += `, ${a.dubType === "fandub" ? "Fan Dub" : "Official Dub"}`;
        if (a.seasonCount) line += `, ${a.seasonCount} Seasons`;
        if (a.episodeCount) line += `, ${a.episodeCount} Episodes`;
        line += `)`;
        context += line + "\n";
      });
    });

    return context;
  }, [animeList]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;
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
      } catch { toast.error("মেসেজ পাঠাতে ব্যর্থ"); }
      return;
    }

    setLoading(true);
    try {
      const chatHistory = messages.slice(-10).map(m => ({
        role: m.role === "admin" ? "user" : m.role,
        content: m.role === "admin" ? `[Admin Reply]: ${m.content}` : m.content,
      }));
      chatHistory.push({ role: "user", content: text });
      const { data, error } = await supabase.functions.invoke("live-chat", { body: { messages: chatHistory, animeContext: animeContext(), userContext } });
      if (error) throw error;

      const sanitizeAssistantReply = (raw: string) =>
        raw
          .replace(/\bAnimeSalt\b/gi, "AN")
          .replace(/\[AS\]/g, "[AN]")
          .replace(/\bAS\b/g, "AN");

      const aiMsg: ChatMessage = {
        id: `ai_${Date.now()}`,
        role: "assistant",
        content: sanitizeAssistantReply(data?.reply || "দুঃখিত, উত্তর দিতে পারছি না।"),
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, aiMsg]);
    } catch {
      const errMsg: ChatMessage = { id: `err_${Date.now()}`, role: "assistant", content: "⚠️ সার্ভারে সমস্যা হচ্ছে। একটু পরে আবার চেষ্টা করুন। সরাসরি Admin-এর কাছে পৌঁছাতে @RS লিখে মেসেজ করুন।", timestamp: Date.now() };
      setMessages(prev => [...prev, errMsg]);
    }
    setLoading(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const renderMessageContent = (content: string) => {
    const btnRegex = /\[BTN:(.+?):(ANIME_ID|ANIME|LINK):(.+?)\]/g;
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

    return <div>{parts.length > 0 ? parts : <span className="whitespace-pre-wrap">{content}</span>}</div>;
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
          <img src={logoImg} alt="RS" className="w-full h-full object-contain" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-bold text-foreground">RS Support</h3>
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
            <p className="text-[10px] text-green-600">AI Assistant • Online</p>
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
              <img src={logoImg} alt="RS" className="w-full h-full object-contain" />
            </div>
            <p className="text-sm text-foreground font-medium">হ্যালো! 👋</p>
            <p className="text-xs text-muted-foreground mt-1">আমি RS Bot, আপনাকে সাহায্য করতে এখানে আছি!</p>
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
