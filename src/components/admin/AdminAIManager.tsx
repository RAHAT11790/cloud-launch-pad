import { useState, useRef, useEffect, useMemo } from "react";
import { Sparkles, Send, Check, X, Loader2, Bot, User, AlertCircle, Image as ImageIcon, Plus, FileJson, Music2, ChevronDown, ChevronUp, Wand2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/siteConfig";
import { toast } from "sonner";
import { db, ref, get } from "@/lib/firebase";

type OpPreview = {
  title?: string;
  poster?: string;
  year?: string;
  category?: string;
  collection?: string;
  seriesId?: string;
  subtitle?: string;
};
type Operation = { name: string; args: Record<string, any>; preview?: OpPreview };
type Msg =
  | { role: "user"; content: string; images?: string[] }
  | { role: "assistant"; content: string; operations?: Operation[]; status?: "pending" | "approved" | "rejected" | "executed"; results?: any[] };

type EpisodeDraft = {
  episodeNumber: number;
  link?: string;
  link480?: string;
  link720?: string;
  link1080?: string;
  link4k?: string;
  audioLanguage?: string;
};

type BuilderTarget = {
  collection: "webseries" | "movies" | "animesalt";
  seriesId: string;
  seasonNumber: number;
  title?: string;
};

const OP_LABELS: Record<string, { label: string; danger?: boolean; emoji: string }> = {
  create_anime_from_tmdb: { label: "Create Anime (TMDB)", emoji: "🆕" },
  add_episode: { label: "Add Episode", emoji: "➕" },
  bulk_add_episodes: { label: "Bulk Save Episodes", emoji: "📦" },
  notify_and_telegram: { label: "Notify + Telegram", emoji: "📲" },
  edit_series: { label: "Edit Series", emoji: "✏️" },
  delete_item: { label: "Delete", danger: true, emoji: "🗑️" },
  send_notification: { label: "Send Push Notification", emoji: "🔔" },
  send_telegram: { label: "Post to Telegram", emoji: "📢" },
  release_weekly: { label: "Mark Weekly Released", emoji: "✅" },
  check_link: { label: "Check Link", emoji: "🔗" },
  approve_subscription: { label: "Approve Subscription", emoji: "💳" },
  set_firebase_path: { label: "Write Firebase Data", emoji: "📝" },
};

const QUALITY_KEYS: Array<{ key: keyof EpisodeDraft; label: string }> = [
  { key: "link", label: "Default" },
  { key: "link480", label: "480p" },
  { key: "link720", label: "720p" },
  { key: "link1080", label: "1080p" },
  { key: "link4k", label: "4K" },
];

const HISTORY_KEY = "rs_admin_ai_history_v1";
const HISTORY_MAX = 60; // keep last 60 messages

const loadHistory = (): Msg[] | null => {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed.slice(-HISTORY_MAX);
  } catch {}
  return null;
};

export function AdminAIManager() {
  const [messages, setMessages] = useState<Msg[]>(() => loadHistory() || [
    {
      role: "assistant",
      content:
        "👋 আসসালামু আলাইকুম! আমি আপনার **Admin AI Manager**। আমি live admin operations handle করতে পারি — episode add/edit, bulk episode save, notification, Telegram post, weekly release, payment approve, link check, router/settings update, Firebase data patch — সব কিছুর আগে preview দেখাব, আপনি **Allow** চাপলে তবেই execute হবে।\n\nকোড/UI change চাইলে আমি exact execution plan, payload, settings update, আর builder-ready instruction তৈরি করে দেব। ডিফল্ট ভাষা: বাংলা। ইংরেজি চাইলে \"reply in English\" লিখুন।",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingImages, setPendingImages] = useState<string[]>([]); // base64 dataURLs
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const executionLogs = useMemo(
    () =>
      messages
        .flatMap((msg, idx) => {
          if (msg.role !== "assistant") return [] as { id: string; tone: "ok" | "error" | "info"; text: string }[];
          if (msg.results?.length) {
            return msg.results.map((result: any, rIdx) => ({
              id: `${idx}-${rIdx}`,
              tone: result?.ok ? "ok" : "error",
              text: `${result?.op || "action"}: ${result?.message || (result?.ok ? "done" : "failed")}`,
            }));
          }
          if (msg.status === "pending" && msg.operations?.length) {
            return [{ id: `${idx}-pending`, tone: "info", text: `Preview ready · ${msg.operations.length} action waiting for approval` }];
          }
          if (msg.content.includes("⚠️")) {
            return [{ id: `${idx}-error`, tone: "error", text: msg.content.split("⚠️").pop()?.trim() || msg.content }];
          }
          return [] as { id: string; tone: "ok" | "error" | "info"; text: string }[];
        })
        .slice(-8)
        .reverse(),
    [messages],
  );

  const handleImagePick = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const arr = Array.from(files).slice(0, 4); // max 4 images
    const dataUrls = await Promise.all(
      arr.map(
        (f) =>
          new Promise<string>((resolve, reject) => {
            if (f.size > 5 * 1024 * 1024) {
              toast.error(`${f.name}: 5MB এর বড় image চলবে না`);
              reject("too big");
              return;
            }
            const r = new FileReader();
            r.onload = () => resolve(String(r.result || ""));
            r.onerror = () => reject(r.error);
            r.readAsDataURL(f);
          }),
      ),
    ).catch(() => []);
    setPendingImages((p) => [...p, ...dataUrls.filter(Boolean)].slice(0, 4));
    if (dataUrls.length) toast.success(`📷 ${dataUrls.length} image attached`);
  };

  // Episode Builder state
  const [builderOpen, setBuilderOpen] = useState(false);
  const [builderTarget, setBuilderTarget] = useState<BuilderTarget | null>(null);
  const [currentEpNum, setCurrentEpNum] = useState<number>(1);
  const [currentLinks, setCurrentLinks] = useState<Partial<EpisodeDraft>>({});
  const [audioLang, setAudioLang] = useState("Hindi");
  const [queue, setQueue] = useState<EpisodeDraft[]>([]);
  const [jsonText, setJsonText] = useState("");
  const [showJson, setShowJson] = useState(false);
  // Series picker (replaces typing raw seriesId)
  const [seriesIndex, setSeriesIndex] = useState<
    { id: string; title: string; collection: "webseries" | "movies" | "animesalt" }[]
  >([]);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);

  // Load series index when builder opens
  useEffect(() => {
    if (!builderOpen || seriesIndex.length > 0) return;
    (async () => {
      const collections: ("webseries" | "movies" | "animesalt")[] = [
        "webseries",
        "movies",
        "animesalt",
      ];
      const all: { id: string; title: string; collection: any }[] = [];
      await Promise.all(
        collections.map(async (c) => {
          try {
            const snap = await get(ref(db, c));
            const v = snap.val();
            if (v && typeof v === "object") {
              Object.entries(v).forEach(([id, item]: [string, any]) => {
                all.push({
                  id,
                  title: String(item?.title || item?.name || id),
                  collection: c,
                });
              });
            }
          } catch {}
        }),
      );
      all.sort((a, b) => a.title.localeCompare(b.title));
      setSeriesIndex(all);
    })();
  }, [builderOpen, seriesIndex.length]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  // Persist chat history to localStorage so user keeps context across page reloads
  useEffect(() => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(messages.slice(-HISTORY_MAX)));
    } catch {}
  }, [messages]);

  const clearHistory = () => {
    if (!window.confirm("Clear AI chat history? এই কাজ undo করা যাবে না।")) return;
    try { localStorage.removeItem(HISTORY_KEY); } catch {}
    setMessages([{
      role: "assistant",
      content: "🆕 নতুন chat শুরু হলো। কী করতে চান বলুন।",
    }]);
    toast.success("Chat history cleared");
  };

  const aiUrl = `${SUPABASE_URL}/functions/v1/admin-ai`;

  // ===== Builder helpers =====
  const setQuality = (key: keyof EpisodeDraft, value: string) => {
    setCurrentLinks((prev) => ({ ...prev, [key]: value }));
  };

  const addToQueue = () => {
    const hasLink = QUALITY_KEYS.some(({ key }) => (currentLinks[key] as string)?.trim());
    if (!hasLink) {
      toast.error("কমপক্ষে একটা quality link দিন");
      return;
    }
    const draft: EpisodeDraft = {
      episodeNumber: currentEpNum,
      audioLanguage: audioLang,
      ...currentLinks,
    };
    setQueue((q) =>
      [...q.filter((e) => e.episodeNumber !== currentEpNum), draft].sort(
        (a, b) => a.episodeNumber - b.episodeNumber,
      ),
    );
    setCurrentLinks({});
    setCurrentEpNum((n) => n + 1);
    toast.success(`✓ EP${currentEpNum} queued — পরের episode link দিন`);
  };

  const importJsonEpisodes = () => {
    try {
      const parsed = JSON.parse(jsonText);
      const arr = Array.isArray(parsed) ? parsed : parsed.episodes || [];
      if (!Array.isArray(arr) || arr.length === 0) throw new Error("empty");
      const valid = arr
        .map((e: any, i: number) => ({
          episodeNumber: Number(e.episodeNumber || e.ep || i + 1),
          link: e.link,
          link480: e.link480,
          link720: e.link720,
          link1080: e.link1080,
          link4k: e.link4k,
          audioLanguage: e.audioLanguage || audioLang,
        }))
        .filter(
          (e) =>
            e.episodeNumber &&
            (e.link || e.link480 || e.link720 || e.link1080 || e.link4k),
        );
      if (!valid.length) throw new Error("no episode has links");
      setQueue(valid);
      setJsonText("");
      setShowJson(false);
      toast.success(`✓ ${valid.length} episodes imported from JSON`);
    } catch (e: any) {
      toast.error(`Invalid JSON: ${e.message}`);
    }
  };

  const submitQueue = (chainNotify: boolean) => {
    if (!builderTarget) {
      toast.error("আগে target series বলুন (e.g. 'set target Naruto S1' chat-এ)");
      return;
    }
    if (queue.length === 0) {
      toast.error("Queue খালি — episode add করুন");
      return;
    }
    const lines = queue
      .map((e) => {
        const links = QUALITY_KEYS.filter(({ key }) => (e as any)[key])
          .map(({ key, label }) => `${label}: ${(e as any)[key]}`)
          .join(", ");
        return `EP${e.episodeNumber}: ${links}`;
      })
      .join("\n");
    const audio = audioLang ? ` (Audio: ${audioLang})` : "";
    const msg = `Save ${queue.length} episodes to **${builderTarget.title || builderTarget.seriesId}** S${builderTarget.seasonNumber}${audio}, **trim other episodes**:\n${lines}${chainNotify ? "\n\nতারপর FCM notification + Telegram পাঠাও।" : ""}`;
    setBuilderOpen(false);
    sendWithText(msg);
    setQueue([]);
    setCurrentEpNum(1);
    setCurrentLinks({});
  };

  const sendWithText = async (text: string) => {
    if (!text.trim() || loading) return;
    setInput("");
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setLoading(true);
    try {
      const chatHistory = next
        .filter((m) => m.role === "user" || (m.role === "assistant" && m.content))
        .map((m) => ({ role: m.role, content: m.content }));
      const r = await fetch(aiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ mode: "plan", messages: chatHistory }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: data.reply || "(no reply)",
          operations: data.operations || [],
          status: data.operations?.length ? "pending" : undefined,
        },
      ]);
    } catch (e: any) {
      setMessages((m) => [...m, { role: "assistant", content: `⚠️ ${e.message}` }]);
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };


  const send = async () => {
    const text = input.trim();
    if ((!text && pendingImages.length === 0) || loading) return;
    const imagesSnapshot = pendingImages;
    setInput("");
    setPendingImages([]);
    const next: Msg[] = [...messages, { role: "user", content: text || "(image)", images: imagesSnapshot }];
    setMessages(next);
    setLoading(true);

    try {
      const chatHistory = next
        .filter((m) => m.role === "user" || (m.role === "assistant" && m.content))
        .map((m) => {
          if (m.role === "user" && (m as any).images?.length) {
            return { role: m.role, content: m.content, images: (m as any).images };
          }
          return { role: m.role, content: m.content };
        });

      const r = await fetch(aiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ mode: "plan", messages: chatHistory }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: data.reply || "(no reply)",
          operations: data.operations || [],
          status: data.operations?.length ? "pending" : undefined,
        },
      ]);
    } catch (e: any) {
      setMessages((m) => [...m, { role: "assistant", content: `⚠️ ${e.message}` }]);
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  const allow = async (idx: number) => {
    const msg = messages[idx];
    if (msg.role !== "assistant" || !msg.operations) return;
    setMessages((m) => m.map((x, i) => (i === idx ? { ...x, status: "approved" } : x)));
    setLoading(true);
    try {
      const r = await fetch(aiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ mode: "execute", operations: msg.operations }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setMessages((m) =>
        m.map((x, i) =>
          i === idx ? { ...x, status: "executed", results: data.results } : x,
        ),
      );
      const okCount = (data.results || []).filter((x: any) => x.ok).length;
      const fail = (data.results || []).length - okCount;
      if (fail === 0) toast.success(`✅ ${okCount} action${okCount > 1 ? "s" : ""} executed`);
      else toast.warning(`⚠️ ${okCount} ok, ${fail} failed`);
    } catch (e: any) {
      toast.error(`Execution failed: ${e.message}`);
      setMessages((m) =>
        m.map((x, i) =>
          i === idx ? { ...x, status: "pending", content: x.content + `\n\n⚠️ ${e.message}\n\n💡 নিচের execution log দেখে আবার চেষ্টা করুন।` } : x,
        ),
      );
    } finally {
      setLoading(false);
    }
  };

  const reject = (idx: number) => {
    setMessages((m) => m.map((x, i) => (i === idx ? { ...x, status: "rejected" } : x)));
  };

  const quickPrompts = [
    "How many series do I have?",
    "Show today's pending weekly releases",
    "Check all links in Naruto S1",
    "Send a test notification 'Hello!'",
  ];

  return (
    <div className="bg-gradient-to-br from-violet-950/40 via-[#0d0d18] to-indigo-950/40 border border-violet-500/30 rounded-2xl overflow-hidden mb-4 shadow-[0_0_30px_rgba(139,92,246,0.15)]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/8 bg-violet-900/20 flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center shadow-lg">
          <Sparkles size={16} className="text-white" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-bold text-white">Admin AI Manager</h3>
          <p className="text-[10px] text-violet-300">
            Smart assistant — preview before execute
          </p>
        </div>
        <span className="text-[9px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
          ● Live
        </span>
        <button
          onClick={clearHistory}
          title="Clear chat history"
          className="text-[9px] px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-300 border border-rose-500/30 hover:bg-rose-500/25"
        >
          Clear
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="max-h-[460px] overflow-y-auto p-3 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={`flex gap-2 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
            <div
              className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center ${
                m.role === "user"
                  ? "bg-indigo-600"
                  : "bg-gradient-to-br from-violet-500 to-fuchsia-600"
              }`}
            >
              {m.role === "user" ? <User size={14} /> : <Bot size={14} />}
            </div>
            <div className={`flex-1 max-w-[92%] min-w-0 ${m.role === "user" ? "text-right" : ""}`}>
              <div
                className={`inline-block text-left px-3.5 py-3 rounded-2xl text-[12.5px] whitespace-pre-wrap break-words max-w-full overflow-hidden ${
                  m.role === "user"
                    ? "bg-indigo-600/30 border border-indigo-500/40 text-indigo-50"
                    : "bg-[#141422] border border-white/8 text-zinc-100"
                }`}
                style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
              >
                <div className="prose prose-invert prose-p:my-0 prose-pre:my-2 prose-pre:max-w-full prose-code:break-all prose-p:break-words prose-li:break-words max-w-none text-inherit [&_*]:break-words">
                  <ReactMarkdown>{m.content}</ReactMarkdown>
                </div>
                {m.role === "user" && (m as any).images?.length > 0 && (
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {(m as any).images.map((img: string, k: number) => (
                      <img
                        key={k}
                        src={img}
                        alt={`upload-${k}`}
                        className="w-20 h-20 object-cover rounded-xl border border-white/10"
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Operations preview */}
              {m.role === "assistant" && m.operations && m.operations.length > 0 && (
                <div className="mt-2 bg-[#0a0a14] border border-violet-500/30 rounded-xl p-2.5">
                  <p className="text-[10px] font-bold text-violet-300 uppercase tracking-wide mb-2 flex items-center gap-1">
                    <AlertCircle size={11} /> Preview · {m.operations.length} action{m.operations.length > 1 ? "s" : ""}
                  </p>
                  <div className="space-y-1.5">
                    {m.operations.map((op, j) => {
                      const meta = OP_LABELS[op.name] || { label: op.name, emoji: "⚙️" };
                      const p = op.preview || {};
                      const posterSrc = p.poster || "";
                      const headline =
                        p.title ||
                        op.args.seriesId ||
                        op.args.path ||
                        op.args.title ||
                        op.args.paymentId ||
                        meta.label;
                      const subline =
                        p.subtitle ||
                        [
                          p.collection,
                          p.year,
                          op.args.seasonNumber ? `S${op.args.seasonNumber}` : "",
                          op.args.episodeNumber ? `EP${op.args.episodeNumber}` : "",
                        ]
                          .filter(Boolean)
                          .join(" · ");
                      return (
                        <div
                          key={j}
                          className={`text-[11px] p-2 rounded-lg border ${
                            meta.danger
                              ? "bg-rose-500/10 border-rose-500/30"
                              : "bg-white/5 border-white/10"
                          }`}
                        >
                          <div className="flex gap-2.5">
                            {posterSrc ? (
                              <img
                                src={posterSrc}
                                alt={headline}
                                className="w-12 h-16 rounded-md object-cover bg-zinc-800 flex-shrink-0"
                                loading="lazy"
                              />
                            ) : (
                              <div className="w-12 h-16 rounded-md bg-zinc-800 flex items-center justify-center flex-shrink-0">
                                <ImageIcon size={16} className="text-zinc-600" />
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="text-[11.5px] font-semibold text-white flex items-center gap-1.5 flex-wrap">
                                <span>{meta.emoji}</span>
                                <span>{meta.label}</span>
                                {meta.danger && (
                                  <span className="text-[9px] text-rose-300 px-1.5 py-0.5 rounded bg-rose-500/20">
                                    ⚠ destructive
                                  </span>
                                )}
                              </div>
                              <p className="text-[12px] text-zinc-100 truncate font-medium mt-0.5">
                                {headline}
                              </p>
                              {subline && (
                                <p className="text-[10px] text-zinc-400 truncate">{subline}</p>
                              )}
                            </div>
                          </div>
                          <details className="mt-1.5">
                            <summary className="text-[9.5px] text-zinc-500 cursor-pointer select-none hover:text-zinc-300">
                              raw payload
                            </summary>
                            <pre className="text-[10px] text-zinc-400 mt-1 overflow-x-auto whitespace-pre-wrap break-all max-h-32">
                              {JSON.stringify(op.args, null, 2)}
                            </pre>
                          </details>
                        </div>
                      );
                    })}
                  </div>

                  {m.status === "pending" && (
                    <div className="flex gap-2 mt-2.5">
                      <button
                        onClick={() => allow(i)}
                        disabled={loading}
                        className="flex-1 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[12px] font-bold flex items-center justify-center gap-1.5 disabled:opacity-50"
                      >
                        <Check size={13} /> Allow
                      </button>
                      <button
                        onClick={() => reject(i)}
                        disabled={loading}
                        className="flex-1 px-3 py-2 rounded-lg bg-rose-600/80 hover:bg-rose-500 text-white text-[12px] font-bold flex items-center justify-center gap-1.5 disabled:opacity-50"
                      >
                        <X size={13} /> Disallow
                      </button>
                    </div>
                  )}
                  {m.status === "approved" && (
                    <p className="text-[11px] text-amber-300 mt-2 flex items-center gap-1">
                      <Loader2 size={11} className="animate-spin" /> Executing…
                    </p>
                  )}
                  {m.status === "rejected" && (
                    <p className="text-[11px] text-zinc-400 mt-2">❌ Cancelled by you</p>
                  )}
                  {m.status === "executed" && m.results && (
                    <div className="mt-2 space-y-1">
                      {m.results.map((r: any, k) => (
                        <p
                          key={k}
                          className={`text-[10.5px] ${r.ok ? "text-emerald-300" : "text-rose-300"}`}
                        >
                          {r.ok ? "✅" : "❌"} <strong>{r.op}</strong>: {r.message}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex gap-2 items-center text-zinc-400 text-[12px]">
            <Loader2 size={14} className="animate-spin" /> Thinking…
          </div>
        )}
      </div>

      {/* Quick prompts */}
      {messages.length <= 1 && (
        <div className="px-3 pb-2 flex gap-1.5 flex-wrap">
          {quickPrompts.map((p) => (
            <button
              key={p}
              onClick={() => setInput(p)}
              className="text-[10.5px] px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-zinc-300 hover:bg-violet-500/20 hover:border-violet-400/40"
            >
              {p}
            </button>
          ))}
        </div>
      )}

      {/* === Episode Builder Toggle === */}
      <div className="px-3 py-2 border-t border-white/8 bg-violet-950/20">
        <button
          onClick={() => setBuilderOpen((v) => !v)}
          className="w-full flex items-center justify-between text-[11.5px] font-semibold text-violet-200 hover:text-white"
        >
          <span className="flex items-center gap-1.5">
            <Wand2 size={13} />
            Episode Builder
            {queue.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full bg-violet-500/30 text-[9.5px]">
                {queue.length} queued
              </span>
            )}
            {builderTarget && (
              <span className="ml-1 px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[9.5px] truncate max-w-[140px]">
                🎯 {builderTarget.title || builderTarget.seriesId} S{builderTarget.seasonNumber}
              </span>
            )}
          </span>
          {builderOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>

        {builderOpen && (
          <div className="mt-2 space-y-2.5 bg-[#0a0a14] border border-violet-500/30 rounded-xl p-2.5">
            {/* Target selector — Series search dropdown (no more typing wrong IDs) */}
            <div className="space-y-1.5">
              <label className="text-[10px] text-violet-300 font-bold uppercase">Target Series:</label>
              <div className="relative">
                <input
                  placeholder={
                    builderTarget
                      ? `🎯 ${builderTarget.title} (${builderTarget.collection})`
                      : "🔍 Search series by name…"
                  }
                  value={pickerQuery}
                  onFocus={() => setPickerOpen(true)}
                  onChange={(e) => {
                    setPickerQuery(e.target.value);
                    setPickerOpen(true);
                  }}
                  className="w-full bg-[#141422] border border-white/10 rounded px-2 py-1.5 text-[11.5px] text-white placeholder:text-zinc-500"
                />
                {pickerOpen && pickerQuery.trim().length > 0 && (
                  <div className="absolute z-20 mt-1 left-0 right-0 max-h-48 overflow-y-auto bg-[#0d0d18] border border-violet-500/40 rounded-lg shadow-xl">
                    {seriesIndex
                      .filter((s) =>
                        s.title.toLowerCase().includes(pickerQuery.trim().toLowerCase()),
                      )
                      .slice(0, 30)
                      .map((s) => (
                        <button
                          key={`${s.collection}/${s.id}`}
                          onClick={() => {
                            setBuilderTarget({
                              collection: s.collection,
                              seriesId: s.id,
                              seasonNumber: builderTarget?.seasonNumber || 1,
                              title: s.title,
                            });
                            setPickerQuery("");
                            setPickerOpen(false);
                            toast.success(`🎯 Target: ${s.title}`);
                          }}
                          className="w-full text-left px-2 py-1.5 hover:bg-violet-500/20 text-[11px] text-white border-b border-white/5 last:border-b-0 flex justify-between items-center"
                        >
                          <span className="truncate">{s.title}</span>
                          <span className="text-[9px] text-violet-400 ml-2">
                            {s.collection}
                          </span>
                        </button>
                      ))}
                    {seriesIndex.filter((s) =>
                      s.title.toLowerCase().includes(pickerQuery.trim().toLowerCase()),
                    ).length === 0 && (
                      <div className="px-2 py-2 text-[11px] text-zinc-500">
                        No match. Try a different name.
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="flex gap-1.5 items-center">
                <label className="text-[10px] text-violet-300 font-bold uppercase">Season:</label>
                <input
                type="number"
                min={1}
                placeholder="S"
                value={builderTarget?.seasonNumber || 1}
                onChange={(e) =>
                  setBuilderTarget((t) => ({
                    collection: t?.collection || "webseries",
                    seriesId: t?.seriesId || "",
                    seasonNumber: Number(e.target.value) || 1,
                    title: t?.title,
                  }))
                }
                className="w-16 bg-[#141422] border border-white/10 rounded px-2 py-1 text-[11px] text-white"
              />
                {builderTarget && (
                  <button
                    onClick={() => {
                      setBuilderTarget(null);
                      setPickerQuery("");
                    }}
                    className="ml-auto text-[10px] text-rose-400 hover:text-rose-300"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            {/* Episode number + audio */}
            <div className="flex gap-1.5 items-center">
              <label className="text-[10px] text-violet-300 font-bold uppercase">EP</label>
              <input
                type="number"
                min={1}
                value={currentEpNum}
                onChange={(e) => setCurrentEpNum(Number(e.target.value) || 1)}
                className="w-16 bg-[#141422] border border-white/10 rounded px-2 py-1 text-[11px] text-white"
              />
              <Music2 size={12} className="text-violet-300" />
              <select
                value={audioLang}
                onChange={(e) => setAudioLang(e.target.value)}
                className="flex-1 bg-[#141422] border border-white/10 rounded px-2 py-1 text-[11px] text-white"
              >
                <option>Hindi</option>
                <option>English</option>
                <option>Japanese</option>
                <option>Bangla</option>
                <option>Multi</option>
              </select>
            </div>

            {/* Quality buttons (5) */}
            <div className="space-y-1">
              {QUALITY_KEYS.map(({ key, label }) => (
                <div key={key} className="flex gap-1.5 items-center">
                  <span className="w-14 text-[10.5px] font-bold text-zinc-400">{label}</span>
                  <input
                    placeholder={`paste ${label} link…`}
                    value={(currentLinks[key] as string) || ""}
                    onChange={(e) => setQuality(key, e.target.value)}
                    className="flex-1 bg-[#141422] border border-white/10 rounded px-2 py-1 text-[11px] text-white placeholder:text-zinc-600 font-mono"
                  />
                </div>
              ))}
            </div>

            {/* Add / Done buttons */}
            <div className="flex gap-1.5">
              <button
                onClick={addToQueue}
                className="flex-1 px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11.5px] font-bold flex items-center justify-center gap-1"
              >
                <Plus size={12} /> Add (next EP)
              </button>
              <button
                onClick={() => submitQueue(false)}
                disabled={queue.length === 0}
                className="flex-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-30 text-white text-[11.5px] font-bold flex items-center justify-center gap-1"
              >
                <Check size={12} /> Done · Save {queue.length || ""}
              </button>
              <button
                onClick={() => submitQueue(true)}
                disabled={queue.length === 0}
                className="flex-1 px-2.5 py-1.5 rounded-lg bg-fuchsia-600 hover:bg-fuchsia-500 disabled:opacity-30 text-white text-[11.5px] font-bold flex items-center justify-center gap-1"
              >
                ✨ Save + Notify
              </button>
            </div>

            {/* Queue list */}
            {queue.length > 0 && (
              <div className="bg-white/5 border border-white/10 rounded-lg p-1.5 max-h-24 overflow-y-auto">
                {queue.map((e) => (
                  <div key={e.episodeNumber} className="flex justify-between text-[10.5px] py-0.5">
                    <span className="text-emerald-300">EP{e.episodeNumber}</span>
                    <span className="text-zinc-400">
                      {QUALITY_KEYS.filter(({ key }) => (e as any)[key])
                        .map(({ label }) => label)
                        .join(" · ")}
                    </span>
                    <button
                      onClick={() =>
                        setQueue((q) => q.filter((x) => x.episodeNumber !== e.episodeNumber))
                      }
                      className="text-rose-400 hover:text-rose-300"
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* JSON paste box */}
            <div>
              <button
                onClick={() => setShowJson((v) => !v)}
                className="text-[10.5px] text-violet-300 hover:text-white flex items-center gap-1"
              >
                <FileJson size={11} /> {showJson ? "Hide" : "Paste"} JSON (bulk import)
              </button>
              {showJson && (
                <div className="mt-1.5 space-y-1.5">
                  <textarea
                    value={jsonText}
                    onChange={(e) => setJsonText(e.target.value)}
                    placeholder='[{"episodeNumber":1,"link1080":"https://..."},{"episodeNumber":2,"link720":"https://..."}]'
                    rows={4}
                    className="w-full bg-[#141422] border border-white/10 rounded px-2 py-1.5 text-[10.5px] text-white font-mono placeholder:text-zinc-600"
                  />
                  <button
                    onClick={importJsonEpisodes}
                    className="w-full px-2 py-1 rounded bg-violet-600 hover:bg-violet-500 text-white text-[11px] font-bold"
                  >
                    Import to Queue
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {pendingImages.length > 0 && (
        <div className="px-3 pt-3 pb-1 flex gap-2 flex-wrap bg-[#0a0a14] border-t border-white/8">
          {pendingImages.map((img, i) => (
            <div key={i} className="relative group">
              <img src={img} alt="attachment" className="w-20 h-20 object-cover rounded-2xl border border-violet-500/40" />
              <button
                onClick={() => setPendingImages((p) => p.filter((_, k) => k !== i))}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-rose-600 text-white text-[10px] flex items-center justify-center shadow-lg"
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="p-3 border-t border-white/8 bg-[#0a0a14]">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            handleImagePick(e.target.files);
            if (fileInputRef.current) fileInputRef.current.value = "";
          }}
        />
        <div className="rounded-[28px] border border-white/10 bg-[#11111b] px-3 py-3.5 shadow-[0_12px_30px_rgba(0,0,0,0.25)]">
          <div className="flex items-end gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
              title="Attach screenshot"
              className="h-11 w-11 rounded-full bg-[#181825] border border-white/10 text-violet-300 hover:bg-violet-500/20 disabled:opacity-40 flex items-center justify-center flex-shrink-0"
            >
              <ImageIcon size={18} />
            </button>
            <div className="flex-1 min-w-0">
              <textarea
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  const ta = e.target as HTMLTextAreaElement;
                  ta.style.height = "auto";
                  ta.style.height = Math.min(ta.scrollHeight, 320) + "px";
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                disabled={loading}
                rows={4}
                placeholder="মেসেজ, কোড, JSON, UI fix, admin command — সব লিখুন। Enter = send, Shift+Enter = নতুন লাইন।"
                className="w-full bg-transparent px-1 py-2 text-[14px] text-white placeholder:text-zinc-500 focus:outline-none resize-none leading-6 min-h-[132px] max-h-[420px] overflow-y-auto"
              />
            </div>
            <button
              onClick={send}
              disabled={loading || (!input.trim() && pendingImages.length === 0)}
              className="h-12 w-12 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white disabled:opacity-40 flex items-center justify-center flex-shrink-0"
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
            </button>
          </div>
        </div>
        <p className="text-[10px] text-zinc-500 mt-2 px-1 break-words">
          💡 বড় script / JSON / multi-line prompt paste করতে পারবেন। ছবি attach করলে উপরে preview দেখাবে।
        </p>
        <div className="mt-3 rounded-2xl border border-white/8 bg-[#11111b] overflow-hidden">
          <div className="px-3 py-2 border-b border-white/8 flex items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Execution Log</p>
            <span className="text-[10px] text-zinc-500">{executionLogs.length} items</span>
          </div>
          <div className="max-h-[180px] overflow-y-auto divide-y divide-white/5">
            {executionLogs.length === 0 ? (
              <p className="px-3 py-3 text-[11px] text-zinc-500">এখনো কোনো execution log নেই।</p>
            ) : (
              executionLogs.map((log) => (
                <div key={log.id} className="px-3 py-2.5 flex items-start gap-2">
                  <span className={`mt-1 h-2 w-2 rounded-full flex-shrink-0 ${log.tone === "ok" ? "bg-emerald-400" : log.tone === "error" ? "bg-rose-400" : "bg-cyan-400"}`} />
                  <p className="text-[11px] text-zinc-200 break-words">{log.text}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
