import { useState } from "react";
import { CheckCircle2, Link2, Loader2, Send, XCircle } from "lucide-react";

export type LinkSection = "telegram" | "direct";

/** Pull the src out of pasted <iframe> code; otherwise return trimmed input. */
export function normalizeDirectInput(input: string): string {
  const raw = String(input || "").trim();
  return raw.match(/<iframe[^>]*src=["']([^"']+)["']/i)?.[1] || raw;
}

export const isDirectMediaUrl = (u: string) => /\.(mp4|m3u8|webm|mkv|mov)(?:$|[?#])/i.test(String(u || ""));

/**
 * Editor-level switch shown ABOVE the season list. Telegram and Direct are two
 * separate link sets: episodes store `link*` (Telegram) and `directLink`
 * (Direct) in different fields, so one never leaks into the other.
 */
export function LinkSectionTabs({
  value, onChange, telegramCount, directCount, total,
}: { value: LinkSection; onChange: (v: LinkSection) => void; telegramCount: number; directCount: number; total: number }) {
  const tab = (m: LinkSection, label: string, hint: string, count: number, Icon: typeof Send) => {
    const active = value === m;
    return (
      <button
        type="button"
        onClick={() => onChange(m)}
        aria-pressed={active}
        className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-all ${
          active
            ? m === "direct"
              ? "border-emerald-400/60 bg-emerald-500/15 shadow-lg shadow-emerald-500/10"
              : "border-sky-400/60 bg-sky-500/15 shadow-lg shadow-sky-500/10"
            : "border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06]"
        }`}
      >
        <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${active ? (m === "direct" ? "bg-emerald-400/25 text-emerald-100" : "bg-sky-400/25 text-sky-100") : "bg-white/[0.06] text-zinc-400"}`}>
          <Icon size={15} />
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block text-[12px] font-bold ${active ? "text-white" : "text-zinc-300"}`}>{label}</span>
          <span className="block truncate text-[9.5px] text-zinc-500">{hint}</span>
        </span>
        <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold ${active ? "bg-white/15 text-white" : "bg-white/[0.06] text-zinc-400"}`}>
          {count}/{total}
        </span>
      </button>
    );
  };
  return (
    <div className="mb-4 rounded-2xl border border-white/[0.07] bg-black/30 p-2.5">
      <p className="mb-2 px-1 text-[10px] font-bold uppercase tracking-wider text-zinc-400">Video links</p>
      <div className="grid grid-cols-2 gap-2">
        {tab("telegram", "Telegram", "Quality links + audio", telegramCount, Send)}
        {tab("direct", "Direct Link", "MP4 / M3U8 / iframe", directCount, Link2)}
      </div>
    </div>
  );
}

/** Single Direct URL box for one episode / part — completely separate field. */
export function DirectLinkField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [check, setCheck] = useState<{ state: "idle" | "loading" | "ok" | "fail"; text?: string }>({ state: "idle" });
  const invalid = !!value && !/^https?:\/\//i.test(value);
  const runCheck = async () => {
    if (invalid) { setCheck({ state: "fail", text: "Link must start with http(s)://" }); return; }
    if (!isDirectMediaUrl(value)) { setCheck({ state: "ok", text: "Embed link — plays in iframe player" }); return; }
    setCheck({ state: "loading" });
    const v = document.createElement("video");
    v.preload = "metadata"; v.muted = true;
    const done = (r: typeof check) => { setCheck(r); v.removeAttribute("src"); v.load(); };
    const t = window.setTimeout(() => done({ state: "fail", text: "No response in 15s" }), 15000);
    v.onloadedmetadata = () => {
      window.clearTimeout(t);
      const m = Math.floor(v.duration / 60), s = Math.floor(v.duration % 60);
      done({ state: "ok", text: `Playable · ${v.videoWidth ? `${v.videoHeight}p · ` : ""}${Number.isFinite(v.duration) ? `${m}:${String(s).padStart(2, "0")}` : "live"}` });
    };
    v.onerror = () => { window.clearTimeout(t); done({ state: "fail", text: "Video could not be loaded" }); };
    v.src = value;
  };
  return (
    <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-2.5">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-200">
          <Link2 size={11} /> Direct video link
        </span>
        {value && !invalid && (
          <span className="rounded bg-emerald-400/15 px-1.5 py-0.5 text-[9px] font-bold text-emerald-200">
            {isDirectMediaUrl(value) ? "Direct player" : "Iframe player"}
          </span>
        )}
      </div>
      <input
        value={value || ""}
        onChange={(e) => { onChange(normalizeDirectInput(e.target.value)); setCheck({ state: "idle" }); }}
        placeholder="https://…/video.mp4, .m3u8 or <iframe> code"
        className={`h-9 w-full rounded-lg border bg-black/40 px-2.5 text-[11px] text-white outline-none placeholder:text-zinc-600 focus:border-emerald-400 ${invalid ? "border-red-500/60" : "border-white/10"}`}
      />
      <div className="mt-2 flex min-h-[24px] items-center gap-2">
        <button type="button" onClick={runCheck} disabled={!value || check.state === "loading"}
          className="inline-flex h-6 items-center gap-1 rounded-md bg-emerald-500/20 px-2.5 text-[10px] font-bold text-emerald-100 hover:bg-emerald-500/30 disabled:opacity-40">
          {check.state === "loading" ? <Loader2 className="h-3 w-3 animate-spin" /> : null} Check link
        </button>
        {check.state === "ok" && <span className="flex min-w-0 items-center gap-1 text-[10px] text-emerald-300"><CheckCircle2 className="h-3 w-3 shrink-0" /><span className="truncate">{check.text}</span></span>}
        {check.state === "fail" && <span className="flex min-w-0 items-center gap-1 text-[10px] text-red-300"><XCircle className="h-3 w-3 shrink-0" /><span className="truncate">{check.text}</span></span>}
      </div>
    </div>
  );
}
