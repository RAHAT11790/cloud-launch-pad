import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ImagePlus, QrCode, Save, Plus, Trash2, ChevronUp, ChevronDown, ChevronRight, Wallet, ListChecks,
  MessageCircle, Package, RotateCcw, Power,
} from "lucide-react";
import { db, ref, onValue, set, update } from "@/lib/firebase";
import {
  DEFAULT_GATEWAY, DEFAULT_LOGOS, normalizeGateway, priceFor, type PaymentGatewayConfig, type PaymentKind, type PaymentMethod,
} from "@/lib/paymentGateway";
import { imageFileToDataUrl } from "@/lib/imageDataUrl";
import { PaymentLogo } from "@/components/premium/PaymentLogo";

interface Props { glassCard: string; inputClass: string; btnPrimary: string; btnSecondary: string }
type Tab = "methods" | "plans" | "benefits" | "contact";

const AUTO_BENEFITS = [
  "Unlock every premium series & movie",
  "1080p / 4K quality unlocked",
  "Video downloads enabled",
  "Ad-free watching",
  "No watermark on the player",
];

function ImagePick({ value, onChange, label, icon, maxSide, btnSecondary }: { value: string; onChange: (v: string) => void; label: string; icon: React.ReactNode; maxSide: number; btnSecondary: string }) {
  const r = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-3">
      <div className="payment-logo-surface w-14 h-14 rounded-lg flex items-center justify-center overflow-hidden shrink-0">
        {value ? <PaymentLogo src={value} className="w-full h-full object-contain p-1" /> : <span className="text-muted-foreground">{icon}</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => r.current?.click()} className={`${btnSecondary} px-3 py-2 text-xs inline-flex items-center gap-1.5`}>{icon} {label}</button>
        {value && <button type="button" onClick={() => onChange("")} className={`${btnSecondary} px-3 py-2 text-xs`}>Remove</button>}
      </div>
      <input ref={r} type="file" accept="image/*" className="hidden" onChange={async (e) => {
        const f = e.target.files?.[0]; e.target.value = "";
        if (!f) return;
        try { onChange(await imageFileToDataUrl(f, maxSide)); toast.success("Image ready — tap Save"); }
        catch (err: any) { toast.error(err?.message || "Could not read image"); }
      }} />
    </div>
  );
}

export default function PaymentGatewayManager({ glassCard, inputClass, btnPrimary, btnSecondary }: Props) {
  const [tab, setTab] = useState<Tab>("methods");
  const [cfg, setCfg] = useState<PaymentGatewayConfig>(DEFAULT_GATEWAY);
  const [legacy, setLegacy] = useState<any>(null);
  const [rawGateway, setRawGateway] = useState<any>(undefined);
  const [plans, setPlans] = useState<any[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = useRef(false);

  useEffect(() => {
    const u1 = onValue(ref(db, "settings/paymentGateway"), (s) => setRawGateway(s.val()));
    const u2 = onValue(ref(db, "bkashSettings"), (s) => setLegacy(s.val() || {}));
    return () => { u1(); u2(); };
  }, []);
  useEffect(() => {
    if (rawGateway === undefined || legacy === null || dirty.current) return;
    setCfg(normalizeGateway(rawGateway, legacy));
    setPlans(Array.isArray(legacy?.plans) ? legacy.plans : []);
  }, [rawGateway, legacy]);

  const edit = (fn: (c: PaymentGatewayConfig) => PaymentGatewayConfig) => { dirty.current = true; setCfg(fn); };
  const editMethod = (id: string, p: Partial<PaymentMethod>) => edit((c) => ({ ...c, methods: c.methods.map((m) => (m.id === id ? { ...m, ...p } : m)) }));
  const move = (i: number, d: number) => edit((c) => {
    const m = [...c.methods]; const j = i + d; if (j < 0 || j >= m.length) return c;
    [m[i], m[j]] = [m[j], m[i]]; return { ...c, methods: m };
  });
  const addMethod = (kind: PaymentKind) => {
    const id = `pm-${Date.now().toString(36)}`;
    edit((c) => ({ ...c, methods: [...c.methods, {
      id, name: kind === "crypto" ? "Crypto (USDT)" : kind === "mobile" ? "Mobile Wallet" : "Other Payment",
      kind, logo: "", number: "", accountType: kind === "crypto" ? "BEP20 (USDT)" : kind === "mobile" ? "Personal" : "",
      qr: "", instructions: "Pay to the account below, then submit the Transaction ID.", enabled: true,
      color: kind === "crypto" ? "#F0B90B" : "#F5B83D", senderLabel: kind === "mobile" ? "Your wallet number" : "Your account / ID",
    }] }));
    setOpen(id);
  };
  const editPlan = (i: number, p: any) => { dirty.current = true; setPlans((o) => o.map((x, k) => (k === i ? { ...x, ...p } : x))); };

  const save = async () => {
    setSaving(true);
    try {
      await set(ref(db, "settings/paymentGateway"), cfg);
      const bk = cfg.methods.find((m) => m.id === "bkash");
      await update(ref(db, "bkashSettings"), {
        plans,
        ...(bk ? { phoneNumber: bk.number, accountType: bk.accountType, qrCodeLink: bk.qr, instructions: bk.instructions } : {}),
      });
      dirty.current = false;
      toast.success("Payment gateway saved");
    } catch (e: any) { toast.error("Error: " + e.message); }
    finally { setSaving(false); }
  };

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "methods", label: "Methods", icon: <Wallet size={14} /> },
    { id: "plans", label: "Price list", icon: <Package size={14} /> },
    { id: "benefits", label: "Benefits", icon: <ListChecks size={14} /> },
    { id: "contact", label: "Contact", icon: <MessageCircle size={14} /> },
  ];

  return (
    <div className="space-y-4 pb-24" data-payment-gateway-manager>
      <div className="pg3d-admin-hero">
        <div className="pg3d-admin-logos">
          {cfg.methods.slice(0, 4).map((m) => (
            <span key={m.id} className="pg3d-coin" style={{ ["--c" as any]: m.color }}>
              {m.logo ? <PaymentLogo src={m.logo} alt={m.name} /> : <Wallet size={16} />}
            </span>
          ))}
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-extrabold text-white">Payment Gateway</h2>
          <p className="text-[11px] text-zinc-400">{cfg.methods.filter((m) => m.enabled && m.number).length} live methods • {plans.filter((p) => p.active !== false).length} plans</p>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`pg3d-tab ${tab === t.id ? "is-on" : ""}`}>{t.icon}<span>{t.label}</span></button>
        ))}
      </div>

      {tab === "methods" && (
        <div className="space-y-2.5">
          {cfg.methods.map((m, i) => {
            const isOpen = open === m.id;
            const isDefault = ["bkash", "nagad", "binance"].includes(m.id);
            return (
              <div key={m.id} className={`${glassCard} overflow-hidden`} style={{ borderColor: isOpen ? m.color + "88" : undefined }}>
                <div className="flex items-center gap-3 p-3">
                  <div className="payment-logo-surface w-12 h-12 rounded-lg flex items-center justify-center overflow-hidden shrink-0">
                    {m.logo ? <PaymentLogo src={m.logo} alt={m.name} className="w-full h-full object-contain p-1" /> : <Wallet size={18} className="text-muted-foreground" />}
                  </div>
                  <button className="flex-1 min-w-0 text-left" onClick={() => setOpen(isOpen ? null : m.id)}>
                    <p className="text-sm font-bold text-white truncate">{m.name}</p>
                    <p className="text-[11px] text-zinc-400 truncate">{m.number || "No number yet — hidden from users"}</p>
                  </button>
                  <div className="flex flex-col">
                    <button onClick={() => move(i, -1)} className="text-zinc-400 p-0.5" aria-label="Move up"><ChevronUp size={14} /></button>
                    <button onClick={() => move(i, 1)} className="text-zinc-400 p-0.5" aria-label="Move down"><ChevronDown size={14} /></button>
                  </div>
                  <button onClick={() => editMethod(m.id, { enabled: !m.enabled })}
                    className={`text-[10px] font-black px-2 py-1 rounded-md inline-flex items-center gap-1 ${m.enabled ? "bg-emerald-500 text-black" : "bg-zinc-700 text-zinc-300"}`}>
                    <Power size={10} /> {m.enabled ? "ON" : "OFF"}
                  </button>
                  <button onClick={() => setOpen(isOpen ? null : m.id)} className="text-zinc-400"><ChevronRight size={16} className={`transition-transform ${isOpen ? "rotate-90" : ""}`} /></button>
                </div>
                {isOpen && (
                  <div className="border-t border-white/6 p-3 space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block"><span className="text-[10px] text-zinc-500">Name</span>
                        <input value={m.name} onChange={(e) => editMethod(m.id, { name: e.target.value })} className={inputClass} /></label>
                      <label className="block"><span className="text-[10px] text-zinc-500">Type</span>
                        <select value={m.kind} onChange={(e) => editMethod(m.id, { kind: e.target.value as PaymentKind })} className={inputClass}>
                          <option value="mobile">Mobile wallet (৳)</option><option value="crypto">Crypto (USDT)</option><option value="other">Other (৳)</option>
                        </select></label>
                    </div>
                    <label className="block"><span className="text-[10px] text-zinc-500">{m.kind === "crypto" ? "Wallet address / Pay ID" : "Account number"}</span>
                      <textarea rows={m.kind === "crypto" ? 2 : 1} value={m.number} onChange={(e) => editMethod(m.id, { number: e.target.value.trim() })} className={inputClass + " font-mono resize-none break-all"} placeholder={m.kind === "crypto" ? "Wallet address or Binance Pay ID" : "01XXXXXXXXX"} /></label>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block"><span className="text-[10px] text-zinc-500">{m.kind === "crypto" ? "Network" : "Account type"}</span>
                        <input list={m.kind === "crypto" ? "payment-crypto-networks" : undefined} value={m.accountType} onChange={(e) => editMethod(m.id, { accountType: e.target.value })} className={inputClass} placeholder={m.kind === "crypto" ? "BEP20 / TRC20 / TON" : "Agent / Personal"} /></label>
                      <label className="block"><span className="text-[10px] text-zinc-500">Brand color</span>
                        <input type="color" value={m.color} onChange={(e) => editMethod(m.id, { color: e.target.value })} className="w-full h-[42px] rounded-lg bg-transparent border border-white/10" /></label>
                    </div>
                    <label className="block"><span className="text-[10px] text-zinc-500">Label for the user's sender box</span>
                      <input value={m.senderLabel} onChange={(e) => editMethod(m.id, { senderLabel: e.target.value })} className={inputClass} /></label>
                    <label className="block"><span className="text-[10px] text-zinc-500">Instructions for users</span>
                      <textarea value={m.instructions} onChange={(e) => editMethod(m.id, { instructions: e.target.value })} className={inputClass + " min-h-[70px] resize-none"} /></label>
                    <ImagePick value={m.logo} onChange={(v) => editMethod(m.id, { logo: v })} label="Logo" icon={<ImagePlus size={14} />} maxSide={256} btnSecondary={btnSecondary} />
                    {isDefault && m.logo !== (DEFAULT_LOGOS as any)[m.id] && (
                      <button onClick={() => editMethod(m.id, { logo: (DEFAULT_LOGOS as any)[m.id] })} className="text-[11px] text-amber-300 inline-flex items-center gap-1"><RotateCcw size={11} /> Official logo</button>
                    )}
                    <ImagePick value={m.qr} onChange={(v) => editMethod(m.id, { qr: v })} label="QR code" icon={<QrCode size={14} />} maxSide={512} btnSecondary={btnSecondary} />
                    {!isDefault && (
                      <button onClick={() => { if (confirm(`Delete ${m.name}?`)) edit((c) => ({ ...c, methods: c.methods.filter((x) => x.id !== m.id) })); }}
                        className="w-full py-2 rounded-lg bg-red-500/10 text-red-400 text-xs font-semibold inline-flex items-center justify-center gap-1.5"><Trash2 size={13} /> Delete method</button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          <div className="grid grid-cols-3 gap-2">
            <button onClick={() => addMethod("mobile")} className={`${btnSecondary} py-2.5 text-[11px] inline-flex items-center justify-center gap-1`}><Plus size={13} /> Wallet</button>
            <button onClick={() => addMethod("crypto")} className={`${btnSecondary} py-2.5 text-[11px] inline-flex items-center justify-center gap-1`}><Plus size={13} /> Crypto</button>
            <button onClick={() => addMethod("other")} className={`${btnSecondary} py-2.5 text-[11px] inline-flex items-center justify-center gap-1`}><Plus size={13} /> Other</button>
          </div>
        </div>
      )}

      {tab === "plans" && (
        <div className="space-y-2.5">
          <div className={`${glassCard} p-3 grid grid-cols-2 gap-2`}>
            <label className="block"><span className="text-[10px] text-zinc-500">1 USDT = ৳</span>
              <input type="number" value={cfg.usdtRate} onChange={(e) => edit((c) => ({ ...c, usdtRate: Number(e.target.value) || 1 }))} className={inputClass} /></label>
            <label className="block"><span className="text-[10px] text-zinc-500">Review wait (hours)</span>
              <input type="number" value={cfg.reviewHours} onChange={(e) => edit((c) => ({ ...c, reviewHours: Number(e.target.value) || 24 }))} className={inputClass} /></label>
          </div>
          {plans.map((p, i) => (
            <div key={p.id || i} className={`${glassCard} p-3`}>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <label className="block"><span className="text-[10px] text-zinc-500">Plan name</span><input value={p.name || ""} onChange={(e) => editPlan(i, { name: e.target.value })} className={inputClass} /></label>
                <label className="block"><span className="text-[10px] text-zinc-500">Price (৳)</span><input type="number" value={p.price ?? 0} onChange={(e) => editPlan(i, { price: Number(e.target.value) })} className={inputClass} /></label>
              </div>
              <div className="grid grid-cols-3 gap-2 items-end">
                <label className="block"><span className="text-[10px] text-zinc-500">Days</span><input type="number" value={p.days ?? 30} onChange={(e) => editPlan(i, { days: Number(e.target.value) })} className={inputClass} /></label>
                <label className="block"><span className="text-[10px] text-zinc-500">Devices</span><input type="number" min={1} max={10} value={p.maxDevices || 1} onChange={(e) => editPlan(i, { maxDevices: Number(e.target.value) || 1 })} className={inputClass} /></label>
                <div className="flex gap-1.5">
                  <button onClick={() => editPlan(i, { active: p.active === false })} className={`flex-1 h-[42px] rounded-lg text-[10px] font-black ${p.active !== false ? "bg-emerald-500 text-black" : "bg-zinc-700 text-zinc-300"}`}>{p.active !== false ? "ON" : "OFF"}</button>
                  <button onClick={() => { dirty.current = true; setPlans((o) => o.filter((_, k) => k !== i)); }} className="w-[42px] h-[42px] rounded-lg bg-red-500/10 text-red-400 flex items-center justify-center" aria-label="Delete plan"><Trash2 size={14} /></button>
                </div>
              </div>
              <p className="mt-2 text-[10px] text-zinc-500">Shown as ৳{p.price ?? 0} • {priceFor({ kind: "crypto" }, Number(p.price) || 0, cfg.usdtRate)}</p>
            </div>
          ))}
          <button onClick={() => { dirty.current = true; setPlans((o) => [...o, { id: `plan${Date.now().toString(36)}`, name: "New Plan", days: 30, price: 100, maxDevices: 1, active: true }]); }}
            className={`${btnSecondary} w-full py-2.5 text-xs inline-flex items-center justify-center gap-1.5`}><Plus size={14} /> Add plan</button>
        </div>
      )}

      {tab === "benefits" && (
        <div className={`${glassCard} p-3 space-y-2`}>
          <p className="text-[11px] text-zinc-400">What users get with Premium — one line per step. Leave empty to show the automatic list.</p>
          {cfg.benefits.map((b, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-6 h-6 shrink-0 rounded-full bg-amber-400 text-black text-[11px] font-black flex items-center justify-center">{i + 1}</span>
              <textarea rows={2} value={b} onChange={(e) => edit((c) => ({ ...c, benefits: c.benefits.map((x, k) => (k === i ? e.target.value : x)) }))} className={inputClass + " min-w-0 flex-1 resize-none leading-relaxed"} />
              <div className="flex flex-col">
                <button onClick={() => edit((c) => { const a = [...c.benefits]; if (i > 0) [a[i - 1], a[i]] = [a[i], a[i - 1]]; return { ...c, benefits: a }; })} className="text-zinc-400"><ChevronUp size={13} /></button>
                <button onClick={() => edit((c) => { const a = [...c.benefits]; if (i < a.length - 1) [a[i + 1], a[i]] = [a[i], a[i + 1]]; return { ...c, benefits: a }; })} className="text-zinc-400"><ChevronDown size={13} /></button>
              </div>
              <button onClick={() => edit((c) => ({ ...c, benefits: c.benefits.filter((_, k) => k !== i) }))} className="text-red-400 p-1" aria-label="Remove"><Trash2 size={14} /></button>
            </div>
          ))}
          <div className="flex gap-2">
            <button onClick={() => edit((c) => ({ ...c, benefits: [...c.benefits, ""] }))} className={`${btnSecondary} flex-1 py-2.5 text-xs inline-flex items-center justify-center gap-1.5`}><Plus size={14} /> Add line</button>
            {cfg.benefits.length === 0 && (
              <button onClick={() => edit((c) => ({ ...c, benefits: [...AUTO_BENEFITS] }))} className={`${btnSecondary} flex-1 py-2.5 text-xs`}>Start from default</button>
            )}
          </div>
        </div>
      )}

      {tab === "contact" && (
        <div className={`${glassCard} p-3 space-y-3`}>
          <button onClick={() => edit((c) => ({ ...c, contact: { ...c.contact, enabled: !c.contact.enabled } }))}
            className={`w-full flex items-center justify-between rounded-xl px-4 py-3 border ${cfg.contact.enabled ? "border-emerald-500/40 bg-emerald-500/10" : "border-white/10 bg-white/5"}`}>
            <span className="text-sm font-semibold">Show Admin Contact</span>
            <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${cfg.contact.enabled ? "bg-emerald-500 text-black" : "bg-zinc-700 text-zinc-300"}`}>{cfg.contact.enabled ? "ON" : "OFF"}</span>
          </button>
          <label className="block"><span className="text-[10px] text-zinc-500">Title</span>
            <input value={cfg.contact.title} onChange={(e) => edit((c) => ({ ...c, contact: { ...c.contact, title: e.target.value } }))} className={inputClass} /></label>
          <label className="block"><span className="text-[10px] text-zinc-500">Telegram username or link</span>
            <input value={cfg.contact.telegram} onChange={(e) => edit((c) => ({ ...c, contact: { ...c.contact, telegram: e.target.value } }))} className={inputClass} placeholder="@username" /></label>
          <label className="block"><span className="text-[10px] text-zinc-500">WhatsApp number or link</span>
            <input value={cfg.contact.whatsapp} onChange={(e) => edit((c) => ({ ...c, contact: { ...c.contact, whatsapp: e.target.value } }))} className={inputClass} placeholder="+8801XXXXXXXXX" /></label>
          <ImagePick value={cfg.contact.logo} onChange={(v) => edit((c) => ({ ...c, contact: { ...c.contact, logo: v } }))} label="Logo" icon={<ImagePlus size={14} />} maxSide={256} btnSecondary={btnSecondary} />
          {cfg.contact.logo !== DEFAULT_LOGOS.contact && (
            <button onClick={() => edit((c) => ({ ...c, contact: { ...c.contact, logo: DEFAULT_LOGOS.contact } }))} className="text-[11px] text-amber-300 inline-flex items-center gap-1"><RotateCcw size={11} /> Default logo</button>
          )}
        </div>
      )}

      <div className="sticky bottom-20 z-10">
        <button onClick={save} disabled={saving || legacy === null} className={`${btnPrimary} w-full gap-2 shadow-[0_10px_30px_-8px_rgba(0,0,0,.8)] disabled:opacity-50`}>
          <Save size={16} /> {saving ? "Saving…" : "Save payment gateway"}
        </button>
      </div>
      <datalist id="payment-crypto-networks"><option value="BEP20 (USDT)" /><option value="TRC20 (USDT)" /><option value="TON (USDT)" /></datalist>
    </div>
  );
}
