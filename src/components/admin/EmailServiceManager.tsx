import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Mail, Activity, Loader2, CheckCircle2, XCircle, ShieldCheck, Send, BarChart3, Clock, KeyRound, Trash2,
  Settings2, Eye, RefreshCw, AlertTriangle, Link as LinkIcon, Gauge, ListChecks, ChevronDown,
} from "lucide-react";
import { db, ref, onValue, set, remove, query, limitToLast } from "@/lib/firebase";
import { getEdgeFunctionUrl } from "@/lib/edgeFunctionRouter";
import {
  summarizeEmailStats, lastDayKeys, emailDayKey, clampEmailSettings, EMAIL_SETTING_BOUNDS,
  type EmailDayStats, type EmailServiceSettings,
} from "@/lib/emailStats";

type Props = { glassCard: string; inputClass: string; btnPrimary: string; btnSecondary: string };
type Health = {
  ok: boolean; service?: string; provider?: string; ready?: boolean; missing?: string[]; sender?: string | null; senderValid?: boolean;
  optional?: Record<string, boolean>;
  gmail?: { ok: boolean; code: string; ms: number; message: string };
};
type EventRow = { id: string; t: number; k: string; p?: string; m?: string; ms?: number; err?: string; why?: string };

const REQUIRED = ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN", "GMAIL_SENDER_EMAIL"];
const EVENT_LOOK: Record<string, { label: string; tone: string }> = {
  sent: { label: "Email sent", tone: "text-sky-300" },
  failed: { label: "Send failed", tone: "text-red-400" },
  verified_otp: { label: "Verified · code", tone: "text-emerald-400" },
  verified_link: { label: "Verified · button", tone: "text-emerald-400" },
  claimed: { label: "Finished in app", tone: "text-emerald-300" },
  wrong: { label: "Wrong code", tone: "text-amber-400" },
  locked: { label: "Locked (too many tries)", tone: "text-red-400" },
  expired: { label: "Expired", tone: "text-zinc-400" },
  limited: { label: "Rate limited", tone: "text-amber-300" },
};
const SETTING_LABELS: Record<keyof EmailServiceSettings, [string, string]> = {
  otpMinutes: ["Code valid", "min"],
  linkMinutes: ["Button link valid", "min"],
  cooldownSeconds: ["Resend wait", "sec"],
  maxAttempts: ["Wrong tries allowed", "tries"],
  dailyLimit: ["Emails per day", "max"],
  hourlyPerEmail: ["Per email / hour", "max"],
  hourlyPerIp: ["Per network / hour", "max"],
};

const fmtTime = (t: number) => new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
const pctText = (v: number | null) => (v == null ? "—" : `${v}%`);

const EmailServiceManager = ({ glassCard, inputClass, btnPrimary, btnSecondary }: Props) => {
  const [url, setUrl] = useState("");
  const [health, setHealth] = useState<Health | null>(null);
  const [checking, setChecking] = useState(false);
  const [latency, setLatency] = useState<number | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [stats, setStats] = useState<Record<string, EmailDayStats>>({});
  const [events, setEvents] = useState<EventRow[]>([]);
  const [settingsDraft, setSettingsDraft] = useState<EmailServiceSettings>(clampEmailSettings(null));
  const [savingSettings, setSavingSettings] = useState(false);
  const [preview, setPreview] = useState<{ type: "register" | "reset"; html: string; loading: boolean } | null>(null);
  const [resetLogs, setResetLogs] = useState<any[]>([]);
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => { getEdgeFunctionUrl("email-service").then((u) => setUrl(u || "")).catch(() => {}); }, []);
  useEffect(() => onValue(query(ref(db, "emailAuth/stats"), limitToLast(14)), (s) => setStats(s.val() || {}), () => {}), []);
  useEffect(() => onValue(query(ref(db, "emailAuth/events"), limitToLast(40)), (s) => {
    const v = s.val() || {};
    setEvents(Object.entries(v).map(([id, e]: any) => ({ id, ...e })).sort((a, b) => (b.t || 0) - (a.t || 0)));
  }, () => {}), []);
  useEffect(() => onValue(ref(db, "settings/emailService"), (s) => setSettingsDraft(clampEmailSettings(s.val())), () => {}), []);
  useEffect(() => onValue(ref(db, "passwordResets"), (snap) => {
    const val = snap.val() || {};
    setResetLogs(Object.entries(val).map(([k, v]: any) => ({ id: k, ...v })).sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0)));
  }, () => {}), []);

  const check = async (deep = true) => {
    if (!url) { toast.error("Email Service URL is not set in EGD Router."); return; }
    setChecking(true); setUnreachable(false);
    const t0 = performance.now();
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000);
      const r = await fetch(`${url.replace(/\/+$/, "")}/?deep=${deep ? 1 : 0}`, { signal: ctrl.signal });
      clearTimeout(timer);
      setLatency(Math.round(performance.now() - t0));
      setHealth(await r.json());
    } catch { setUnreachable(true); setHealth(null); }
    setChecking(false);
  };
  useEffect(() => { if (url) void check(true); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [url]);

  const loadPreview = async (type: "register" | "reset") => {
    if (!url) return;
    setPreview({ type, html: "", loading: true });
    try {
      const r = await fetch(`${url.replace(/\/+$/, "")}/preview?type=${type}`);
      setPreview({ type, html: await r.text(), loading: false });
    } catch { setPreview(null); toast.error("Could not load the template"); }
  };

  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      await set(ref(db, "settings/emailService"), { ...clampEmailSettings(settingsDraft), updatedAt: Date.now() });
      toast.success("Saved — the email server uses it within a minute");
    } catch { toast.error("Save failed"); }
    setSavingSettings(false);
  };

  const days = useMemo(() => lastDayKeys(7), []);
  const today = stats[emailDayKey()] || {};
  const todaySum = summarizeEmailStats([today]);
  const weekSum = summarizeEmailStats(days.map((d) => stats[d] || {}));
  const maxBar = Math.max(1, ...days.map((d) => Number(stats[d]?.sent || 0) + Number(stats[d]?.failed || 0)));
  const quotaPct = Math.min(100, Math.round((todaySum.sent / Math.max(1, settingsDraft.dailyLimit)) * 100));

  const missing = health?.missing || [];
  const ready = !!health?.ready;
  const gmailOk = !!health?.gmail?.ok;
  const statusTone = unreachable ? "red" : !health ? "zinc" : !ready ? "amber" : health.gmail && !gmailOk ? "red" : "emerald";
  const statusText = unreachable ? "Server unreachable" : !health ? "Checking…" : !ready ? "Waiting for Gmail secrets" : health.gmail && !gmailOk ? "Gmail authorisation failed" : "Live · Gmail API connected";
  const toneCls: Record<string, string> = {
    red: "bg-red-500/10 text-red-300 border-red-500/30", amber: "bg-amber-500/10 text-amber-300 border-amber-500/30",
    emerald: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30", zinc: "bg-white/5 text-zinc-400 border-white/10",
  };

  const Stat = ({ label, value, sub, tone = "text-white" }: { label: string; value: string | number; sub?: string; tone?: string }) => (
    <div className="rounded-xl bg-white/[0.03] border border-white/5 px-3 py-2.5 min-w-0">
      <p className="text-[9px] uppercase tracking-wider text-zinc-500 truncate">{label}</p>
      <p className={`text-lg font-black leading-tight mt-0.5 tabular-nums ${tone}`}>{value}</p>
      {sub && <p className="text-[9px] text-zinc-500 truncate">{sub}</p>}
    </div>
  );

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-white flex items-center gap-2"><Mail size={18} className="text-sky-400" /> Email Service <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30">GMAIL API</span></h2>

      {/* Status */}
      <div className={`${glassCard} p-4 space-y-3 relative overflow-hidden`}>
        <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-blue-700 via-blue-500 to-cyan-400" />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-zinc-500">Server status</p>
            <span className={`mt-1 inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 rounded-lg border ${toneCls[statusTone]}`}>
              {statusTone === "emerald" ? <CheckCircle2 size={12} /> : statusTone === "zinc" ? <Loader2 size={12} className="animate-spin" /> : <AlertTriangle size={12} />} {statusText}
            </span>
          </div>
          <button onClick={() => check(true)} disabled={checking || !url} className={`${btnSecondary} px-3 py-1.5 text-[10px] flex items-center gap-1.5 disabled:opacity-40 shrink-0`}>
            {checking ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Check now
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2 text-[10px]">
          <div className="rounded-lg bg-white/[0.03] border border-white/5 px-2.5 py-2 min-w-0">
            <p className="text-zinc-500">Sender Gmail</p>
            <p className="text-zinc-200 font-mono truncate">{health?.sender || "—"}</p>
          </div>
          <div className="rounded-lg bg-white/[0.03] border border-white/5 px-2.5 py-2 min-w-0">
            <p className="text-zinc-500">Response time</p>
            <p className="text-zinc-200 font-mono">{latency != null ? `${latency} ms` : "—"}{health?.gmail ? ` · Google ${health.gmail.ms} ms` : ""}</p>
          </div>
        </div>
        <div className="text-[10px] font-mono text-zinc-500 truncate flex items-center gap-1.5"><LinkIcon size={10} className="shrink-0" />{url || "Not set in EGD Router → email-service"}</div>
        {health?.gmail && !gmailOk && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[10px] text-red-200 leading-relaxed">
            <b>{health.gmail.code}</b> — {health.gmail.message}
            {health.gmail.code === "gmail_token_revoked" && <p className="mt-1 text-red-300/80">The refresh token was revoked or expired. If the Google OAuth app is still in "Testing" mode, Google expires refresh tokens after 7 days — publish the app (Google Cloud → OAuth consent screen → Publish) and create a new refresh token once.</p>}
          </div>
        )}
      </div>

      {/* Secrets */}
      <div className={`${glassCard} p-4 space-y-2.5`}>
        <h3 className="text-sm font-semibold text-zinc-300 flex items-center gap-2"><ShieldCheck size={14} className="text-emerald-400" /> Cloudflare secrets</h3>
        <div className="grid grid-cols-1 gap-1.5">
          {REQUIRED.map((k) => {
            const ok = !!health && !missing.includes(k) && (k !== "GMAIL_SENDER_EMAIL" || health.senderValid !== false);
            return (
              <div key={k} className="flex items-center justify-between rounded-lg bg-white/[0.03] border border-white/5 px-3 py-2">
                <span className="text-[11px] font-mono text-zinc-200">{k}</span>
                {!health ? <span className="text-[10px] text-zinc-500">—</span> : ok
                  ? <span className="text-[10px] text-emerald-400 flex items-center gap-1"><CheckCircle2 size={11} /> Set</span>
                  : <span className="text-[10px] text-red-400 flex items-center gap-1"><XCircle size={11} /> {missing.includes(k) ? "Missing" : "Invalid"}</span>}
              </div>
            );
          })}
        </div>
        {health?.optional && (
          <p className="text-[9px] text-zinc-500 leading-relaxed">
            Optional: EMAIL_SECRET {health.optional.EMAIL_SECRET ? "✓" : "—"} · SITE_URL {health.optional.SITE_URL ? "✓" : "—"} · FIREBASE_DB_URL {health.optional.FIREBASE_DB_URL ? "✓" : "—"} · FIREBASE_DB_SECRET {health.optional.FIREBASE_DB_SECRET ? "✓" : "—"}
          </p>
        )}
        <button onClick={() => setShowGuide((v) => !v)} className="w-full flex items-center justify-between text-[11px] text-sky-300 pt-1">
          <span className="flex items-center gap-1.5"><ListChecks size={12} /> How to add the secrets</span>
          <ChevronDown size={13} className={`transition-transform ${showGuide ? "rotate-180" : ""}`} />
        </button>
        {showGuide && (
          <ol className="text-[10px] text-zinc-400 leading-relaxed list-decimal pl-4 space-y-1">
            <li>Admin → <b>Cloudflare Manager</b> → select <b>email-service</b> → Env values.</li>
            <li>Add each name above with its value and press Save (or Cloudflare dashboard → Workers → email-service → Settings → Variables and Secrets → Add → type <b>Secret</b>).</li>
            <li>Come back here and press <b>Check now</b> — it should say "Live · Gmail API connected".</li>
          </ol>
        )}
      </div>

      {/* Today */}
      <div className={`${glassCard} p-4 space-y-3`}>
        <h3 className="text-sm font-semibold text-zinc-300 flex items-center gap-2"><Gauge size={14} className="text-sky-400" /> Today</h3>
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Emails sent" value={todaySum.sent} sub={`${todaySum.register} sign-up · ${todaySum.reset} reset`} tone="text-sky-300" />
          <Stat label="Verified" value={todaySum.verified} sub={`${todaySum.viaOtp} code · ${todaySum.viaLink} button`} tone="text-emerald-400" />
          <Stat label="Failed" value={todaySum.failed} sub={`Delivery ${pctText(todaySum.deliveryRate)}`} tone={todaySum.failed ? "text-red-400" : "text-white"} />
          <Stat label="Blocked" value={todaySum.limited + todaySum.locked} sub={`${todaySum.wrong} wrong codes`} tone="text-amber-300" />
        </div>
        <div>
          <div className="flex items-center justify-between text-[10px] text-zinc-500 mb-1">
            <span>Daily limit</span><span className="tabular-nums text-zinc-300">{todaySum.sent} / {settingsDraft.dailyLimit}</span>
          </div>
          <div className="h-2 rounded-full bg-white/5 overflow-hidden">
            <div className={`h-full rounded-full ${quotaPct > 85 ? "bg-red-500" : quotaPct > 60 ? "bg-amber-400" : "bg-gradient-to-r from-blue-600 to-cyan-400"}`} style={{ width: `${quotaPct}%` }} />
          </div>
          <p className="text-[9px] text-zinc-600 mt-1">A personal Gmail account can send about 500 emails a day.</p>
        </div>
      </div>

      {/* 7 days */}
      <div className={`${glassCard} p-4 space-y-3`}>
        <h3 className="text-sm font-semibold text-zinc-300 flex items-center gap-2"><BarChart3 size={14} className="text-sky-400" /> Last 7 days</h3>
        <div className="flex items-end gap-1.5 h-28">
          {days.map((d) => {
            const s = stats[d] || {};
            const sent = Number(s.sent || 0), failed = Number(s.failed || 0);
            const verified = Number(s.verified_otp || 0) + Number(s.verified_link || 0);
            return (
              <div key={d} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                <span className="text-[9px] text-zinc-400 tabular-nums">{sent || ""}</span>
                <div className="w-full flex flex-col justify-end rounded-md bg-white/[0.03] h-20 overflow-hidden" title={`${d}: ${sent} sent, ${verified} verified, ${failed} failed`}>
                  {failed > 0 && <div className="w-full bg-red-500/80" style={{ height: `${(failed / maxBar) * 100}%` }} />}
                  <div className="w-full bg-gradient-to-t from-blue-700 to-sky-400" style={{ height: `${(Math.max(0, sent - verified) / maxBar) * 100}%` }} />
                  <div className="w-full bg-emerald-500" style={{ height: `${(Math.min(verified, sent) / maxBar) * 100}%` }} />
                </div>
                <span className="text-[8px] text-zinc-500">{d.slice(8)}/{d.slice(5, 7)}</span>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-3 text-[9px] text-zinc-500">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-500" /> verified</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-sky-400" /> sent</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-500" /> failed</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Delivery" value={pctText(weekSum.deliveryRate)} sub={`${weekSum.sent} sent`} tone="text-sky-300" />
          <Stat label="Verify rate" value={pctText(weekSum.verifyRate)} sub={`${weekSum.verified} verified`} tone="text-emerald-400" />
          <Stat label="Gmail speed" value={weekSum.avgMs != null ? `${weekSum.avgMs}ms` : "—"} sub="avg per email" />
        </div>
        <div className="grid grid-cols-4 gap-2">
          <Stat label="Resends" value={weekSum.resend} />
          <Stat label="Wrong" value={weekSum.wrong} />
          <Stat label="Expired" value={weekSum.expired} />
          <Stat label="Limited" value={weekSum.limited} />
        </div>
      </div>

      {/* Activity */}
      <div className={`${glassCard} p-4 space-y-2.5`}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-300 flex items-center gap-2"><Activity size={14} className="text-sky-400" /> Live activity</h3>
          {events.length > 0 && (
            <button onClick={async () => { if (!confirm("Clear the activity list?")) return; await remove(ref(db, "emailAuth/events")); toast.success("Cleared"); }}
              className={`${btnSecondary} px-2 py-1 text-[9px] flex items-center gap-1`}><Trash2 size={9} /> Clear</button>
          )}
        </div>
        {events.length === 0 ? <p className="text-[11px] text-zinc-600 text-center py-3">No email activity yet</p> : (
          <div className="space-y-1 max-h-[320px] overflow-y-auto">
            {events.map((e) => {
              const look = EVENT_LOOK[e.k] || { label: e.k, tone: "text-zinc-300" };
              return (
                <div key={e.id} className="rounded-lg bg-white/[0.03] border border-white/5 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-[11px] font-semibold ${look.tone}`}>{look.label}</span>
                    <span className="text-[9px] text-zinc-500 shrink-0">{e.t ? fmtTime(e.t) : ""}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <span className="text-[10px] text-zinc-400 font-mono truncate">{e.m || "—"}{e.p ? ` · ${e.p === "reset" ? "reset" : "sign-up"}` : ""}</span>
                    {e.ms != null && <span className="text-[9px] text-zinc-500 shrink-0">{e.ms} ms</span>}
                  </div>
                  {(e.err || e.why) && <p className="text-[9px] text-red-300/80 mt-1 break-words">{e.err}{e.why ? ` — ${e.why}` : ""}</p>}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Rules */}
      <div className={`${glassCard} p-4 space-y-3`}>
        <h3 className="text-sm font-semibold text-zinc-300 flex items-center gap-2"><Settings2 size={14} className="text-sky-400" /> Security rules</h3>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(SETTING_LABELS) as (keyof EmailServiceSettings)[]).map((k) => {
            const [lo, hi] = EMAIL_SETTING_BOUNDS[k];
            return (
              <label key={k} className="block">
                <span className="text-[10px] text-zinc-400">{SETTING_LABELS[k][0]} <span className="text-zinc-600">({lo}–{hi} {SETTING_LABELS[k][1]})</span></span>
                <input type="number" inputMode="numeric" min={lo} max={hi} value={settingsDraft[k]}
                  onChange={(ev) => setSettingsDraft((s) => ({ ...s, [k]: Number(ev.target.value) }))}
                  className={`${inputClass} mt-1 w-full px-3 py-2 text-xs`} />
              </label>
            );
          })}
        </div>
        <button onClick={saveSettings} disabled={savingSettings} className={`${btnPrimary} w-full py-2.5 text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-50`}>
          {savingSettings ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />} Save rules
        </button>
      </div>

      {/* Template preview */}
      <div className={`${glassCard} p-4 space-y-3`}>
        <h3 className="text-sm font-semibold text-zinc-300 flex items-center gap-2"><Eye size={14} className="text-sky-400" /> Email design</h3>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => loadPreview("register")} disabled={!url} className={`${btnSecondary} py-2 text-[11px] flex items-center justify-center gap-1.5 disabled:opacity-40 ${preview?.type === "register" ? "ring-1 ring-sky-400/60" : ""}`}><Send size={11} /> Sign-up email</button>
          <button onClick={() => loadPreview("reset")} disabled={!url} className={`${btnSecondary} py-2 text-[11px] flex items-center justify-center gap-1.5 disabled:opacity-40 ${preview?.type === "reset" ? "ring-1 ring-sky-400/60" : ""}`}><KeyRound size={11} /> Reset email</button>
        </div>
        {preview && (
          <div className="rounded-xl overflow-hidden border border-white/10 bg-black/40">
            {preview.loading
              ? <div className="h-40 grid place-items-center"><Loader2 size={16} className="animate-spin text-zinc-500" /></div>
              : <iframe title="Email preview" sandbox="" srcDoc={preview.html} className="w-full h-[640px] bg-transparent" />}
          </div>
        )}
      </div>

      {/* Password reset logs */}
      <div className={`${glassCard} p-4 space-y-3`}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-300 flex items-center gap-2"><Clock size={14} className="text-amber-400" /> Password reset logs</h3>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-zinc-500">{resetLogs.length} users</span>
            {resetLogs.length > 0 && (
              <button onClick={async () => { if (!confirm("Delete all password reset logs?")) return; await remove(ref(db, "passwordResets")); toast.success("Logs cleared."); }}
                className={`${btnSecondary} px-2 py-1 text-[9px] flex items-center gap-1`}><Trash2 size={9} /> Clear All</button>
            )}
          </div>
        </div>
        {resetLogs.length === 0 ? <p className="text-[11px] text-zinc-600 text-center py-3">No password reset logs yet</p> : (
          <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
            {resetLogs.map((log: any) => (
              <div key={log.id} className="bg-white/[0.03] border border-white/5 rounded-lg px-3 py-2 flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-white font-medium truncate">{log.email}</p>
                  <p className="text-[9px] text-zinc-500">{log.name || "—"}</p>
                </div>
                <div className="text-right flex-shrink-0 ml-2">
                  <p className="text-[9px] text-zinc-400">{log.timestamp ? fmtTime(log.timestamp) : "—"}</p>
                  <p className="text-[9px] text-emerald-400/60">{log.method || "email"}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default EmailServiceManager;
