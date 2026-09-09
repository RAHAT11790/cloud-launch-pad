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

  const card = glassCard || "rounded-2xl border border-border bg-card p-5";
  const input = inputClass || "w-full h-11 rounded-xl border border-border bg-background px-3 text-sm text-foreground";

  const copyPreview = async () => {
    if (!preview) return;
    try {
      await navigator.clipboard.writeText(preview);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { toast.error("Copy failed"); }
  };

  return (
    <div className="space-y-4 max-w-3xl">
      {/* Bot link */}
      <div className={card}>
        <div className="mb-5">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 shrink-0 rounded-xl bg-sky-500/15 text-sky-400 flex items-center justify-center">
              <Bot size={18} />
            </div>
            <h3 className="flex-1 min-w-0 text-[15px] font-bold text-foreground leading-snug truncate">
              Telegram Download Bot
            </h3>
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold tracking-wide ${botUrl ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400"}`}>
              {loading ? "…" : botUrl ? "ACTIVE" : "OFF"}
            </span>
          </div>
          <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
            Only the bot link is needed. Deep links are generated automatically and never shown to users.
          </p>
        </div>

        <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Bot link</label>
        <div className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <Link2 size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
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
            className={`${btnPrimary || "h-11 px-5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm"} inline-flex items-center justify-center gap-2 shrink-0`}
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {/* Admin-only test bench */}
      <div className={card}>
        <div className="flex items-center gap-2.5 mb-4">
          <div className="h-9 w-9 rounded-xl bg-violet-500/15 text-violet-400 flex items-center justify-center">
            <FlaskConical size={17} />
          </div>
          <div>
            <h4 className="text-sm font-bold text-foreground">Link tester (admin only)</h4>
            <p className="text-[11px] text-muted-foreground">Check any title, season, episodes and quality before users use it.</p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Anime title</label>
            <input value={testTitle} onChange={(e) => setTestTitle(e.target.value)} className={input} />
          </div>
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Season</label>
            <input
              type="number"
              min={1}
              value={testSeason}
              onChange={(e) => setTestSeason(Math.max(1, Number(e.target.value) || 1))}
              className={input}
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Episodes</label>
            <input value={testEpisodes} onChange={(e) => setTestEpisodes(e.target.value)} placeholder="5 or 1-24 or 2,4-6,9" className={input} />
          </div>
        </div>

        <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground mt-4 mb-2">Qualities</label>
        <div className="flex flex-wrap gap-2">
          {TELEGRAM_FREE_QUALITIES.map((q) => {
            const on = testQualities.includes(q);
            return (
              <button
                key={q}
                onClick={() => setTestQualities((prev) => (on ? prev.filter((x) => x !== q) : [...prev, q]))}
                className={`h-9 px-4 rounded-xl text-xs font-bold border transition-colors ${on ? "bg-sky-500 text-white border-sky-500" : "bg-transparent text-muted-foreground border-border"}`}
              >
                {normalizeTelegramQuality(q)}
              </button>
            );
          })}
        </div>

        <div className="mt-5 rounded-xl border border-border bg-muted/30 p-3.5 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Generated deep link</span>
            <span className={`inline-flex items-center gap-1 text-[10px] font-bold ${payloadOk ? "text-emerald-400" : "text-amber-400"}`}>
              {payloadOk ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
              {payloadOk ? `${payload.length}/64 OK` : "Invalid"}
            </span>
          </div>
          <p className="font-mono text-[11px] leading-relaxed break-all text-sky-400">
            {preview || "Save a valid bot link and pick episodes/qualities to see the link."}
          </p>
          <div className="grid grid-cols-2 gap-2 text-[10.5px] text-muted-foreground">
            <span>Payload: <span className="font-mono text-foreground">{payload || "—"}</span></span>
            <span>Title hash: <span className="font-mono text-foreground">{hash || "—"}</span></span>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={copyPreview}
              disabled={!preview}
              className="h-9 px-3.5 rounded-xl border border-border text-xs font-semibold text-foreground inline-flex items-center gap-1.5 disabled:opacity-40"
            >
              {copied ? <CheckCircle2 size={13} /> : <Copy size={13} />}{copied ? "Copied" : "Copy"}
            </button>
            <button
              onClick={() => preview && window.open(preview, "_blank", "noopener,noreferrer")}
              disabled={!preview}
              className="h-9 px-3.5 rounded-xl bg-sky-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-40"
            >
              <Send size={13} /> Test in Telegram
            </button>
          </div>
        </div>
      </div>

      {/* Format reference */}
      <div className={card}>
        <h4 className="text-sm font-bold text-foreground mb-2.5">Link format</h4>
        <pre className="text-[11px] leading-relaxed whitespace-pre-wrap break-all text-muted-foreground bg-muted/40 rounded-xl p-3.5">
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
