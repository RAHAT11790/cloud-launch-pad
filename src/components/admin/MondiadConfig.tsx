import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Save, Zap, Radio, LayoutGrid, Sparkles, ShieldCheck, CheckCircle2, AlertTriangle, Copy } from "lucide-react";
import { db, ref, set } from "@/lib/firebase";
import { checkMondiadCode, type MondiadSlot } from "@/lib/adNetworks";
import { EMPTY_MONDIAD, MONDIAD_PATH, mondiadToFirebase, useMondiadConfig, type MondiadConfig as Cfg } from "@/lib/mondiadAds";

interface Props { inputClass: string; btnPrimary: string; }

const VERIFY_TAG = '<meta name="mnd-ver" content="h2rplj155e59g7iwkltw" />';

type Field = { key: keyof Omit<Cfg, "enabled">; slot: MondiadSlot; name: string; icon: JSX.Element; help: string; placeholder: string };

const PLAYER_FIELDS: Field[] = [
  { key: "popunder", slot: "popunder", name: "Popunder", icon: <Zap className="w-3.5 h-3.5 text-amber-300" />,
    help: "Takes turns with the Adsterra popunder on player taps. If one opens nothing, the other one takes over.",
    placeholder: '<script async src="https://ss.mrmnd.com/popunder.js" data-mndpopid="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"></script>' },
  { key: "playerInPagePush", slot: "inPagePush", name: "In-Page Push", icon: <Radio className="w-3.5 h-3.5 text-fuchsia-300" />,
    help: "Notification-style ad inside the player page, shown once per visit.",
    placeholder: '<script async src="https://ss.mndsrv.com/static/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.js"></script>' },
];
const DOWNLOAD_FIELDS: Field[] = [
  { key: "banner", slot: "banner", name: "Banner", icon: <LayoutGrid className="w-3.5 h-3.5 text-sky-300" />,
    help: "Paste both parts (banner.js + the <div data-mndbanid> element). The element alone also works.",
    placeholder: '<script async src="https://ss.mndsrv.com/banner.js"></script>\n<div data-mndbanid="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"></div>' },
  { key: "native", slot: "native", name: "Native", icon: <Sparkles className="w-3.5 h-3.5 text-emerald-300" />,
    help: "Paste both parts (native.js + the <div data-mndazid> element). The element alone also works.",
    placeholder: '<script async src="https://ss.mndsrv.com/native.js"></script>\n<div data-mndazid="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"></div>' },
  { key: "downloadInPagePush", slot: "inPagePush", name: "In-Page Push", icon: <Radio className="w-3.5 h-3.5 text-fuchsia-300" />,
    help: "Notification-style ad in the download step ad box.",
    placeholder: '<script async src="https://ss.mndsrv.com/static/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.js"></script>' },
];

const codeArea =
  "w-full min-w-0 rounded-lg bg-black/60 border border-white/10 px-2.5 py-2 " +
  "font-mono text-[11px] leading-relaxed text-emerald-100/90 " +
  "placeholder:text-white/25 focus:outline-none focus:ring-1 focus:ring-sky-400/40 " +
  "resize-y break-all whitespace-pre-wrap overflow-auto";

function Status({ slot, code }: { slot: MondiadSlot; code: string }) {
  const c = checkMondiadCode(slot, code);
  if (c.state === "empty") return <span className="text-[10px] text-white/40">Empty — no ad</span>;
  if (c.state === "bad") return <span role="alert" className="flex items-start gap-1 text-[10px] text-rose-300"><AlertTriangle className="w-3 h-3 mt-px shrink-0" />{c.reason}</span>;
  return <span className="flex items-start gap-1 text-[10px] text-emerald-300"><CheckCircle2 className="w-3 h-3 mt-px shrink-0" />Correct Mondiad code{c.note ? ` · ${c.note}` : ""}</span>;
}

export default function MondiadConfig({ btnPrimary }: Props) {
  const live = useMondiadConfig();
  const [cfg, setCfg] = useState<Cfg>(live);
  const [saving, setSaving] = useState(false);
  const dirty = useRef(false);
  useEffect(() => { if (!dirty.current) setCfg(live); }, [live]);
  const edit = (patch: Partial<Cfg>) => { dirty.current = true; setCfg((c) => ({ ...c, ...patch })); };

  const fields = [...PLAYER_FIELDS, ...DOWNLOAD_FIELDS];
  const bad = fields.filter((f) => checkMondiadCode(f.slot, cfg[f.key]).state === "bad");

  const save = async () => {
    if (bad.length) { toast.error(`Fix the ${bad[0].name} code first`); return; }
    setSaving(true);
    try {
      await set(ref(db, MONDIAD_PATH), mondiadToFirebase(cfg));
      dirty.current = false;
      toast.success("Mondiad ads saved");
    } catch { toast.error("Save failed"); }
    setSaving(false);
  };

  const box = (f: Field) => (
    <div key={f.key} className="space-y-1.5 min-w-0">
      <div className="flex items-center gap-2">{f.icon}<span className="text-[11px] font-semibold text-white/85">{f.name}</span></div>
      <textarea aria-label={`Mondiad ${f.name} code`} value={cfg[f.key]} rows={3} className={codeArea} placeholder={f.placeholder}
        onChange={(e) => edit({ [f.key]: e.target.value } as Partial<Cfg>)} />
      <Status slot={f.slot} code={cfg[f.key]} />
      <p className="text-[10px] text-white/45">{f.help}</p>
    </div>
  );

  return (
    <div className="space-y-5 min-w-0">
      <section className="rounded-2xl border border-white/10 bg-gradient-to-br from-[#0c1f2e]/70 to-black/40 p-4 space-y-3 min-w-0 overflow-hidden">
        <header className="flex items-start justify-between gap-3 min-w-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-lg bg-sky-500/15 border border-sky-400/25 flex items-center justify-center"><ShieldCheck className="w-4 h-4 text-sky-300" /></span>
              <h3 className="text-sm font-bold text-white truncate">Mondiad · Domain verification</h3>
            </div>
            <p className="text-[11px] text-white/50 mt-1">This code is already inside the site's &lt;head&gt;. After Publish, choose "Insert Code" on Mondiad and tap Verify.</p>
          </div>
        </header>
        <div className="flex items-center gap-2 min-w-0">
          <code className="flex-1 min-w-0 truncate rounded-lg bg-black/60 border border-white/10 px-2.5 py-2 font-mono text-[11px] text-sky-100/90">{VERIFY_TAG}</code>
          <button type="button" aria-label="Copy verification code" className="shrink-0 h-8 w-8 rounded-lg border border-white/15 bg-white/5 flex items-center justify-center text-white/70"
            onClick={() => { void navigator.clipboard?.writeText(VERIFY_TAG); toast.success("Copied"); }}><Copy className="w-3.5 h-3.5" /></button>
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-gradient-to-br from-[#1a0f2e]/70 to-black/40 p-4 space-y-4 min-w-0 overflow-hidden">
        <header className="flex items-start justify-between gap-3 min-w-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-lg bg-fuchsia-500/15 border border-fuchsia-400/25 flex items-center justify-center">🎬</span>
              <h3 className="text-sm font-bold text-white truncate">Mondiad · Video Player</h3>
            </div>
            <p className="text-[11px] text-white/50 mt-1">Uses the same cool-down as Adsterra (one player ad per gap, both networks together).</p>
          </div>
          <label className="inline-flex items-center gap-2 text-[11px] text-white/80 shrink-0 rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
            <input type="checkbox" className="accent-sky-500" checked={cfg.enabled} onChange={(e) => edit({ enabled: e.target.checked })} />
            {cfg.enabled ? "Enabled" : "Off"}
          </label>
        </header>
        {PLAYER_FIELDS.map(box)}
      </section>

      <section className="rounded-2xl border border-white/10 bg-gradient-to-br from-[#0f2a1e]/70 to-black/40 p-4 space-y-4 min-w-0 overflow-hidden">
        <header className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-400/25 flex items-center justify-center">⬇️</span>
            <h3 className="text-sm font-bold text-white truncate">Mondiad · Download Page</h3>
          </div>
          <p className="text-[11px] text-white/50 mt-1">Shown in the ad box between the timer and the Continue button, under the Adsterra ads.</p>
        </header>
        {DOWNLOAD_FIELDS.map(box)}
        <p className="text-[10px] text-white/45">Classic Push needs Mondiad's own service-worker file in the site's root folder, so it has no box here.</p>
      </section>

      <div className="flex gap-2">
        <button type="button" onClick={() => edit({ ...EMPTY_MONDIAD, enabled: cfg.enabled })} className="h-10 px-4 rounded-xl border border-white/15 bg-white/5 text-[12px] font-semibold text-white/70">Clear all</button>
        <button type="button" onClick={save} disabled={saving} className={btnPrimary + " flex-1 inline-flex items-center justify-center gap-1.5"}>
          <Save className="w-3.5 h-3.5" />{saving ? "Saving..." : "Save Mondiad Ads"}
        </button>
      </div>
    </div>
  );
}
