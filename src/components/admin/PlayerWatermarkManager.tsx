import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ImagePlus, RotateCcw, Save, Eye, EyeOff, Sun, Maximize2, Type } from "lucide-react";
import { db, ref, onValue, set } from "@/lib/firebase";
import { DEFAULT_WATERMARK, normalizeWatermark, type WatermarkSettings } from "@/lib/playerWatermark";
import { imageFileToDataUrl } from "@/lib/imageDataUrl";
import { useBranding } from "@/hooks/useBranding";

interface Props { glassCard: string; inputClass: string; btnPrimary: string; btnSecondary: string }

const Slider = ({ icon, label, value, min, max, step, show, onChange }: any) => (
    <label className="block">
      <span className="flex items-center justify-between text-[11px] text-zinc-400 mb-1.5">
        <span className="flex items-center gap-1.5">{icon}{label}</span>
        <b className="text-white font-mono">{show}</b>
      </span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-amber-400" />
    </label>
  );


export default function PlayerWatermarkManager({ glassCard, inputClass, btnPrimary, btnSecondary }: Props) {
  const branding = useBranding();
  const [s, setS] = useState<WatermarkSettings>(DEFAULT_WATERMARK);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fs, setFs] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => onValue(ref(db, "settings/playerWatermark"), (snap) => {
    setS(normalizeWatermark(snap.val())); setLoaded(true);
  }), []);

  const patch = (p: Partial<WatermarkSettings>) => setS((o) => ({ ...o, ...p }));
  const logo = s.logoUrl || branding.logoUrl || "/android-chrome-192x192.png";
  const size = fs ? s.size * 1.3 : s.size;

  const pick = async (f?: File | null) => {
    if (!f) return;
    try { patch({ logoUrl: await imageFileToDataUrl(f, 192) }); toast.success("Logo ready — tap Save"); }
    catch (e: any) { toast.error(e?.message || "Could not read image"); }
  };

  const save = async () => {
    setSaving(true);
    try { await set(ref(db, "settings/playerWatermark"), s); toast.success("Watermark saved"); }
    catch (e: any) { toast.error("Error: " + e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-4" data-watermark-manager>
      {/* Live preview */}
      <div className={`${glassCard} p-4`}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Live preview</h3>
          <div className="flex gap-1.5">
            <button onClick={() => setFs(false)} className={`text-[11px] px-2.5 py-1 rounded-md ${!fs ? "bg-amber-400 text-black font-bold" : "bg-white/5 text-zinc-300"}`}>Normal</button>
            <button onClick={() => setFs(true)} className={`text-[11px] px-2.5 py-1 rounded-md ${fs ? "bg-amber-400 text-black font-bold" : "bg-white/5 text-zinc-300"}`}>Fullscreen</button>
          </div>
        </div>
        <div className="relative w-full aspect-video rounded-xl overflow-hidden border border-white/10"
          style={{ background: "radial-gradient(120% 90% at 30% 20%, #3b2a5c 0%, #141428 55%, #07070d 100%)" }}>
          <span className="absolute bottom-2 left-3 text-[10px] text-white/50">Free user view</span>
          {s.enabled ? (
            <div className="absolute flex flex-col items-center gap-[2px] pointer-events-none"
              style={{ top: fs ? 16 : 10, right: fs ? 18 : 10, opacity: s.opacity, filter: `brightness(${s.brightness})` }}>
              <img src={logo} alt="" style={{ width: size, height: size, borderRadius: "27%", objectFit: "cover", boxShadow: "0 1px 3px rgba(0,0,0,.5)" }} />
              {s.showText && s.text && <span style={{ fontSize: size * (fs ? 0.27 : 0.27), fontWeight: 800, letterSpacing: ".08em", color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,.9)", whiteSpace: "nowrap" }}>{s.text}</span>}
            </div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-zinc-400">Watermark is off</div>
          )}
        </div>
        <p className="mt-2 text-[11px] text-zinc-500">Premium users never see the watermark.</p>
      </div>

      {/* Controls */}
      <div className={`${glassCard} p-4 space-y-4`}>
        <button onClick={() => patch({ enabled: !s.enabled })}
          className={`w-full flex items-center justify-between rounded-xl px-4 py-3 border ${s.enabled ? "border-emerald-500/40 bg-emerald-500/10" : "border-white/10 bg-white/5"}`}>
          <span className="flex items-center gap-2 text-sm font-semibold">{s.enabled ? <Eye size={16} /> : <EyeOff size={16} />} Watermark</span>
          <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${s.enabled ? "bg-emerald-500 text-black" : "bg-zinc-700 text-zinc-300"}`}>{s.enabled ? "ON" : "OFF"}</span>
        </button>

        <div className="flex items-center gap-3">
          <img src={logo} alt="" className="w-14 h-14 rounded-xl object-cover border border-white/10 bg-black/40" />
          <div className="flex-1 flex flex-wrap gap-2">
            <button onClick={() => fileRef.current?.click()} className={`${btnSecondary} px-3 py-2 text-xs inline-flex items-center gap-1.5`}><ImagePlus size={14} /> Upload from gallery</button>
            {s.logoUrl && <button onClick={() => patch({ logoUrl: "" })} className={`${btnSecondary} px-3 py-2 text-xs inline-flex items-center gap-1.5`}><RotateCcw size={14} /> Use site logo</button>}
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
        </div>

        <Slider icon={<Maximize2 size={12} />} label="Size" value={s.size} min={14} max={80} step={1} show={`${s.size}px`} onChange={(v: number) => patch({ size: v })} />
        <Slider icon={<Eye size={12} />} label="Visibility" value={s.opacity} min={0.05} max={1} step={0.01} show={`${Math.round(s.opacity * 100)}%`} onChange={(v: number) => patch({ opacity: v })} />
        <Slider icon={<Sun size={12} />} label="Brightness" value={s.brightness} min={0.3} max={2} step={0.05} show={`${Math.round(s.brightness * 100)}%`} onChange={(v: number) => patch({ brightness: v })} />

        <div className="flex items-center gap-2">
          <button onClick={() => patch({ showText: !s.showText })}
            className={`shrink-0 text-[11px] font-bold px-3 py-2.5 rounded-lg inline-flex items-center gap-1 ${s.showText ? "bg-amber-400 text-black" : "bg-white/5 text-zinc-300"}`}><Type size={12} /> Text {s.showText ? "ON" : "OFF"}</button>
          <input value={s.text} maxLength={24} onChange={(e) => patch({ text: e.target.value })} className={inputClass} placeholder="RS ANIME03" disabled={!s.showText} />
        </div>

        <div className="flex gap-2">
          <button onClick={() => setS({ ...DEFAULT_WATERMARK })} className={`${btnSecondary} px-4 py-3 text-xs inline-flex items-center gap-1.5`}><RotateCcw size={14} /> Reset</button>
          <button onClick={save} disabled={!loaded || saving} className={`${btnPrimary} flex-1 gap-2 disabled:opacity-50`}><Save size={16} /> {saving ? "Saving…" : "Save watermark"}</button>
        </div>
      </div>
    </div>
  );
}
