import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Send, Save, Loader2 } from "lucide-react";
import { db, ref, onValue, set } from "@/lib/firebase";
import { buildTelegramDownloadUrl } from "@/lib/telegramDownload";

type Props = {
  glassCard?: string;
  inputClass?: string;
  btnPrimary?: string;
};

const TelegramDownloadConfig = ({ glassCard = "", inputClass = "", btnPrimary = "" }: Props) => {
  const [botUrl, setBotUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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

  const preview = buildTelegramDownloadUrl({
    botUrl: botUrl.trim(),
    title: "Bottom Tier Character Tomozaki",
    season: 1,
    episodes: [1, 2, 3, 4, 5],
    qualities: ["480P", "720P", "1080P"],
  });

  return (
    <div className="space-y-5">
      <div className={glassCard || "rounded-2xl border border-border bg-card p-5"}>
        <div className="flex items-center gap-2.5 mb-4">
          <div className="h-9 w-9 rounded-xl bg-sky-500/15 text-sky-400 flex items-center justify-center">
            <Send size={17} />
          </div>
          <div>
            <h3 className="text-base font-bold text-foreground">Telegram Download Bot</h3>
            <p className="text-xs text-muted-foreground">
              Users get episodes from this bot. Only the bot link is needed — the rest of the deep link is generated automatically.
            </p>
          </div>
        </div>

        <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Bot link</label>
        <input
          value={botUrl}
          onChange={(e) => setBotUrl(e.target.value)}
          placeholder="https://t.me/RS_ANIME_03_BOT"
          disabled={loading}
          className={inputClass || "w-full h-11 rounded-xl border border-border bg-background px-3 text-sm text-foreground"}
        />

        <button
          onClick={save}
          disabled={saving || loading}
          className={`${btnPrimary || "mt-3 h-11 px-5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm"} mt-3 inline-flex items-center gap-2`}
        >
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          {saving ? "Saving…" : "Save bot link"}
        </button>
      </div>

      <div className={glassCard || "rounded-2xl border border-border bg-card p-5"}>
        <h4 className="text-sm font-bold text-foreground mb-2">Generated link format</h4>
        <pre className="text-[11px] leading-relaxed whitespace-pre-wrap break-all text-muted-foreground bg-muted/40 rounded-xl p-3">
{`{BOT_LINK}?start=ep_{season}_{episodes}_{qualities}_{Title-With-Dashes}

season    -> always 2 digits            01, 02, 10
episodes  -> single: 2 digits           05
             multiple: first-last       1-5
qualities -> lowercase, "-" joined      480p-720p-1080p
title     -> every space becomes "-"    Bottom-Tier-Character-Tomozaki`}
        </pre>
        <p className="text-xs font-semibold text-foreground mt-3 mb-1">Live preview</p>
        <p className="text-[11px] break-all text-sky-400">
          {preview || "Enter a valid bot link to see the generated deep link."}
        </p>
      </div>
    </div>
  );
};

export default TelegramDownloadConfig;
