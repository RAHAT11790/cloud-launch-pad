import { useState, useRef, useEffect } from "react";
import { Sparkles, Send, Check, X, Loader2, Bot, User, AlertCircle, Image as ImageIcon } from "lucide-react";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/siteConfig";
import { toast } from "sonner";

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
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; operations?: Operation[]; status?: "pending" | "approved" | "rejected" | "executed"; results?: any[] };

const OP_LABELS: Record<string, { label: string; danger?: boolean; emoji: string }> = {
  add_episode: { label: "Add Episode", emoji: "➕" },
  edit_series: { label: "Edit Series", emoji: "✏️" },
  delete_item: { label: "Delete", danger: true, emoji: "🗑️" },
  send_notification: { label: "Send Push Notification", emoji: "🔔" },
  send_telegram: { label: "Post to Telegram", emoji: "📢" },
  release_weekly: { label: "Mark Weekly Released", emoji: "✅" },
  check_link: { label: "Check Link", emoji: "🔗" },
  approve_subscription: { label: "Approve Subscription", emoji: "💳" },
  set_firebase_path: { label: "Write Firebase Data", emoji: "📝" },
};

export function AdminAIManager() {
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      content:
        "👋 আসসালামু আলাইকুম! আমি আপনার **Admin AI Manager**। যা খুশি বলুন — episode add, notification, series edit, payment approve, link check, weekly EP release — আমি আগে preview দেখাব, আপনি **Allow** চাপলে তবেই execute হবে।\n\nডিফল্ট ভাষা: বাংলা। ইংরেজি চাইলে \"reply in English\" লিখুন।",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  const aiUrl = `${SUPABASE_URL}/functions/v1/admin-ai`;

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
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
          i === idx ? { ...x, status: "pending", content: x.content + `\n\n⚠️ ${e.message}\n\n💡 Lovable থেকে ঠিক করিয়া নিন।` } : x,
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
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="max-h-[420px] overflow-y-auto p-3 space-y-3">
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
            <div className={`flex-1 max-w-[85%] ${m.role === "user" ? "text-right" : ""}`}>
              <div
                className={`inline-block text-left px-3 py-2 rounded-xl text-[12.5px] whitespace-pre-wrap ${
                  m.role === "user"
                    ? "bg-indigo-600/30 border border-indigo-500/40 text-indigo-50"
                    : "bg-[#141422] border border-white/8 text-zinc-100"
                }`}
              >
                {m.content}
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

      {/* Input */}
      <div className="p-2.5 border-t border-white/8 bg-[#0a0a14] flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          disabled={loading}
          placeholder="e.g. Naruto S1 EP5 720p https://… 1080p https://… তারপর notify সব ইউজারকে"
          className="flex-1 bg-[#141422] border border-white/10 rounded-lg px-3 py-2 text-[13px] text-white placeholder:text-zinc-500 focus:outline-none focus:border-violet-500/60"
        />
        <button
          onClick={send}
          disabled={loading || !input.trim()}
          className="px-3 py-2 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white disabled:opacity-40"
        >
          <Send size={15} />
        </button>
      </div>
    </div>
  );
}
