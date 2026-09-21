import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Send, Save, Loader2, Bot, Link2, Copy, CheckCircle2, AlertTriangle, FlaskConical } from "lucide-react";
import { db, ref, onValue, set } from "@/lib/firebase";
import {
  buildTelegramDownloadUrl,
  buildTelegramStartPayload,
  telegramTitleHash,
  TELEGRAM_FREE_QUALITIES,
  normalizeTelegramQuality,
} from "@/lib/telegramDownload";

type Props = {
  glassCard?: string;
  inputClass?: string;
  btnPrimary?: string;
};

const TelegramDownloadConfig = ({ glassCard = "", inputClass = "", btnPrimary = "" }: Props) => {
  const [botUrl, setBotUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  // Admin-only test bench
  const [testTitle, setTestTitle] = useState("Bottom-Tier Character Tomozaki");
  const [testSeason, setTestSeason] = useState(1);
  const [testEpisodes, setTestEpisodes] = useState("1-5");
  const [testQualities, setTestQualities] = useState<string[]>(["480P", "720P", "1080P"]);

  useEffect(() => {
    const unsub = onValue(ref(db, "settings/telegramDownload"), (snap) => {
      const val = snap.val() || {};
      setBotUrl(String(val?.botUrl || val?.url || ""));
      setLoading(false);
    });
    return () => { try { (unsub as any)?.(); } catch {} };
  }, []);

  const save = async () => {
    const clean = botUrl.trim().replace(/\/+$/, "").replace(/\?.*$/, "");
    if (clean && !/^https?:\/\/t\.me\/[A-Za-z0-9_]+$/i.test(clean)) {
      toast.error("Enter a valid bot link, e.g. https://t.me/RS_ANIME_03_BOT");
      return;
    }
    setSaving(true);
    try {
      await set(ref(db, "settings/telegramDownload"), { botUrl: clean, updatedAt: Date.now() });
      setBotUrl(clean);
      toast.success(clean ? "Telegram bot saved" : "Telegram download disabled");
    } catch {
      toast.error("Could not save the bot link");
    } finally {
      setSaving(false);
    }
  };

  const episodeList = useMemo(() => {
    const out: number[] = [];
    String(testEpisodes || "").split(",").forEach((chunk) => {
      const part = chunk.trim();
      if (!part) return;
      const range = part.match(/^(\d+)\s*-\s*(\d+)$/);
      if (range) {
        const a = Number(range[1]);
        const b = Number(range[2]);
        for (let i = Math.min(a, b); i <= Math.max(a, b); i += 1) out.push(i);
        return;
      }
      const n = Number(part);
      if (Number.isFinite(n) && n > 0) out.push(n);
    });
    return out;
  }, [testEpisodes]);

  const payload = buildTelegramStartPayload({
    title: testTitle,
    season: testSeason,
    episodes: episodeList,
    qualities: testQualities,
  });
  const preview = buildTelegramDownloadUrl({
    botUrl: botUrl.trim(),
    title: testTitle,
    season: testSeason,
    episodes: episodeList,
    qualities: testQualities,
  });
  const hash = telegramTitleHash(testTitle);
  const payloadOk = Boolean(payload) && payload.length <= 64;

  const card = `${glassCard || "rounded-2xl border border-white/10 bg-[#16162A]"} p-4`;
  const input = "w-full h-10 rounded-lg border border-white/10 bg-black/30 px-3 text-[12.5px] text-white placeholder:text-zinc-500 focus:border-sky-500 focus:outline-none";
  const label = "block text-[10.5px] font-bold uppercase tracking-wider text-zinc-400 mb-1.5";

  const copyPreview = async () => {
    if (!preview) return;
    try {
      await navigator.clipboard.writeText(preview);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { toast.error("Copy failed"); }
  };

  return (
    <div className="flex flex-col gap-3.5 max-w-3xl pb-32">
      {/* Bot link */}
      <div className={card}>
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 shrink-0 rounded-xl bg-sky-500/15 text-sky-400 flex items-center justify-center">
            <Bot size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-[14px] font-bold text-white leading-tight truncate">Telegram Download Bot</h3>
            <p className="text-[11px] text-zinc-400 leading-snug mt-0.5">Only the bot link is needed — deep links build automatically.</p>
          </div>
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[9.5px] font-bold tracking-wide ${botUrl ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400"}`}>
            {loading ? "…" : botUrl ? "ACTIVE" : "OFF"}
          </span>
        </div>

        <div className="mt-4">
          <label className={label}>Bot link</label>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Link2 size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                value={botUrl}
                onChange={(e) => setBotUrl(e.target.value)}
                placeholder="https://t.me/RS_ANIME_03_BOT"
                disabled={loading}
                className={`${input} pl-9`}
              />
            </div>
            <button
              onClick={save}
              disabled={saving || loading}
              className="h-10 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[12.5px] font-bold inline-flex items-center justify-center gap-1.5 shrink-0 transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>

      {/* Admin-only test bench */}
      <div className={card}>
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 shrink-0 rounded-xl bg-violet-500/15 text-violet-400 flex items-center justify-center">
            <FlaskConical size={17} />
          </div>
          <div className="min-w-0 flex-1">
            <h4 className="text-[13.5px] font-bold text-white leading-tight">Link tester</h4>
            <p className="text-[11px] text-zinc-400 leading-snug mt-0.5">Admin only — check a title before users use it.</p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={label}>Anime title</label>
            <input value={testTitle} onChange={(e) => setTestTitle(e.target.value)} className={input} />
          </div>
          <div>
            <label className={label}>Season</label>
            <input
              type="number"
              min={1}
              value={testSeason}
              onChange={(e) => setTestSeason(Math.max(1, Number(e.target.value) || 1))}
              className={input}
            />
          </div>
          <div>
            <label className={label}>Episodes</label>
            <input value={testEpisodes} onChange={(e) => setTestEpisodes(e.target.value)} placeholder="5 or 1-24 or 2,4-6,9" className={input} />
          </div>
        </div>

        <div className="mt-4">
          <label className={label}>Qualities</label>
          <div className="flex flex-wrap gap-2">
            {TELEGRAM_FREE_QUALITIES.map((q) => {
              const on = testQualities.includes(q);
              return (
                <button
                  key={q}
                  onClick={() => setTestQualities((prev) => (on ? prev.filter((x) => x !== q) : [...prev, q]))}
                  className={`h-9 px-3.5 rounded-lg text-[12px] font-bold border transition-colors ${on ? "bg-sky-500 text-white border-sky-500" : "bg-white/[0.04] text-zinc-300 border-white/10 hover:bg-white/[0.08]"}`}
                >
                  {normalizeTelegramQuality(q)}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-white/10 bg-black/25 p-3.5 flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10.5px] font-bold uppercase tracking-wider text-zinc-400">Generated deep link</span>
            <span className={`inline-flex items-center gap-1 text-[10px] font-bold ${payloadOk ? "text-emerald-400" : "text-amber-400"}`}>
              {payloadOk ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
              {payloadOk ? `${payload.length}/64 OK` : "Invalid"}
            </span>
          </div>
          <p className="font-mono text-[11px] leading-relaxed break-all text-sky-400">
            {preview || "Save a valid bot link and pick episodes/qualities to see the link."}
          </p>
          <div className="grid gap-1 sm:grid-cols-2 text-[10.5px] text-zinc-400">
            <span className="truncate">Payload: <span className="font-mono text-white">{payload || "—"}</span></span>
            <span className="truncate">Title hash: <span className="font-mono text-white">{hash || "—"}</span></span>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={copyPreview}
              disabled={!preview}
              className="h-9 px-3.5 rounded-lg border border-white/10 bg-white/[0.04] text-[12px] font-semibold text-white inline-flex items-center gap-1.5 disabled:opacity-40 hover:bg-white/[0.08] transition-colors"
            >
              {copied ? <CheckCircle2 size={13} /> : <Copy size={13} />}{copied ? "Copied" : "Copy"}
            </button>
            <button
              onClick={() => preview && window.open(preview, "_blank", "noopener,noreferrer")}
              disabled={!preview}
              className="h-9 px-3.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-[12px] font-bold inline-flex items-center gap-1.5 disabled:opacity-40 transition-colors"
            >
              <Send size={13} /> Test in Telegram
            </button>
          </div>
        </div>
      </div>

      {/* Format reference */}
      <div className={card}>
        <h4 className="text-[13px] font-bold text-white mb-2.5">Link format</h4>
        <pre className="text-[10.5px] leading-relaxed whitespace-pre-wrap break-all text-zinc-400 bg-black/30 border border-white/[0.06] rounded-xl p-3.5">
{`{BOT_LINK}?start=ep_{season}_{episodes}_{qualities}_{title_hash}

season      -> 2 digits                     01, 02, 12
episodes    -> 05  |  1-24  |  2,4-6,9
qualities   -> dash joined, lowercase       480p-720p-1080p  |  all
title_hash  -> first 8 hex of SHA1(title.trim().toLowerCase())

Telegram limit: payload max 64 chars, only A-Z a-z 0-9 _ -`}
        </pre>
      </div>
    </div>
  );
};

export default TelegramDownloadConfig;
