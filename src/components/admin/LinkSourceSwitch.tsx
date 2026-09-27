import { useEffect, useState, type ReactNode } from "react";
import { CheckCircle2, Loader2, Send, Server, XCircle } from "lucide-react";
import { isAbyssLink, normalizeAbyssInput, resolveAbyss } from "@/lib/abyss";

interface Props {
  link: string;
  /** Called with the cleaned Abyss link (goes into the episode/part `link`). */
  onAbyssLinkChange: (value: string) => void;
  /** Existing Telegram / quality fields. */
  children: ReactNode;
}

/**
 * Per-episode source switch: "Telegram" keeps the 4 quality boxes,
 * "Abyss" shows ONE link box (that link already carries every quality).
 */
export default function LinkSourceSwitch({ link, onAbyssLinkChange, children }: Props) {
  const [mode, setMode] = useState<"telegram" | "abyss">(isAbyssLink(link) ? "abyss" : "telegram");
  const [check, setCheck] = useState<{ state: "idle" | "loading" | "ok" | "fail"; text?: string }>({ state: "idle" });

  useEffect(() => {
    if (isAbyssLink(link)) setMode("abyss");
  }, [link]);

  const runCheck = async () => {
    if (!isAbyssLink(link)) { setCheck({ state: "fail", text: "Not an Abyss link" }); return; }
    setCheck({ state: "loading" });
    const r = await resolveAbyss(link);
    setCheck(r.ok
      ? { state: "ok", text: `${r.sources.map((s) => s.label).join(" · ")}${r.title ? ` — ${r.title}` : ""}` }
      : { state: "fail", text: r.error || "No playable quality found (will use embed fallback)" });
  };

  const tab = (m: "telegram" | "abyss", label: string, Icon: typeof Send) => (
    <button
      type="button"
      onClick={() => { setMode(m); setCheck({ state: "idle" }); }}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-semibold transition-colors ${
        mode === m ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  );

  return (
    <div className="space-y-2">
      <div className="flex gap-1 rounded-lg border border-border bg-muted/40 p-1">
        {tab("telegram", "Telegram link", Send)}
        {tab("abyss", "Abyss link", Server)}
      </div>
      {mode === "telegram" ? (
        children
      ) : (
        <div className="space-y-1.5 rounded-lg border border-primary/25 bg-primary/5 p-2.5">
          <span className="block text-[10px] font-medium text-foreground/80">Abyss URL (all qualities & audio in one link)</span>
          <textarea
            value={link || ""}
            onChange={(e) => { onAbyssLinkChange(normalizeAbyssInput(e.target.value)); setCheck({ state: "idle" }); }}
            rows={2}
            placeholder="https://player.abyssplayer.com/xxxxxxxxxx  (or paste the <iframe> code)"
            className="min-h-[44px] w-full resize-none break-all rounded-md border border-border bg-background px-2.5 py-2 text-[10px] text-foreground outline-none focus:border-primary"
          />
          <div className="flex items-center gap-2">
            <button type="button" onClick={runCheck} disabled={check.state === "loading"}
              className="rounded-md bg-primary/15 px-2.5 py-1 text-[10px] font-semibold text-primary hover:bg-primary/25 disabled:opacity-50">
              {check.state === "loading" ? <Loader2 className="h-3 w-3 animate-spin" /> : "Check link"}
            </button>
            {check.state === "ok" && <span className="flex min-w-0 items-center gap-1 text-[10px] text-primary"><CheckCircle2 className="h-3 w-3 shrink-0" /><span className="truncate">{check.text}</span></span>}
            {check.state === "fail" && <span className="flex min-w-0 items-center gap-1 text-[10px] text-destructive"><XCircle className="h-3 w-3 shrink-0" /><span className="truncate">{check.text}</span></span>}
          </div>
        </div>
      )}
    </div>
  );
}
