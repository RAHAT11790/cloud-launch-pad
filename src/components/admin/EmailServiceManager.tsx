import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Mail, Activity, Loader2, CheckCircle2, XCircle, ShieldCheck, Send, BarChart3, Clock, KeyRound, Trash2,
  Settings2, Eye, RefreshCw, AlertTriangle, Link as LinkIcon, Gauge, ListChecks, ChevronDown, Lock, Unlock, Fingerprint,
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
  gmail?: { ok: boolean; code: string; ms: number; message: string; scope?: string; accessExpiresAt?: number; refreshExpiresAt?: number; checkedAt?: number };
  today?: { day: string; sent: number; limit: number; left: number; resetsInSec: number };
  last?: { ok: boolean; lastOkAt: number; lastErrAt: number; lastErr: string; lastErrMsg: string; lastMs: number } | null;
  security?: Record<string, boolean>;
  settings?: Partial<EmailServiceSettings>;
};
type EventRow = { id: string; t: number; k: string; p?: string; m?: string; email?: string; ms?: number; err?: string; why?: string; r?: string };

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
  tampered: { label: "Tampered record blocked", tone: "text-red-400" },
};
const WHY: Record<string, string> = {
  cooldown: "asked again before the wait ended", email_daily: "used all codes for today", daily: "service daily cap reached",
  minute: "too many requests this minute", ip_hourly: "network hourly limit", ip_daily: "network daily limit", race: "double tap",
};
const SETTING_LABELS: Record<keyof EmailServiceSettings, [string, string]> = {
  otpMinutes: ["Code valid", "min"],
  linkMinutes: ["Button link valid", "min"],
  cooldownSeconds: ["Resend wait (1 live code)", "sec"],
  maxAttempts: ["Wrong tries allowed", "tries"],
  perEmailDaily: ["Codes per email / day", "max"],
  perIpDaily: ["Per network / day", "max"],
  hourlyPerIp: ["Per network / hour", "max"],
  perMinute: ["Whole service / minute", "max"],
  dailyLimit: ["Whole service / day", "max"],
};
const ago = (t: number, now = Date.now()) => {
  if (!t) return "never";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};
const until = (t: number, now = Date.now()) => {
  const s = Math.round((t - now) / 1000);
  if (s <= 0) return "now";
  if (s < 3600) return `${Math.ceil(s / 60)} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} days`;
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
  const [pin, setPin] = useState("");
  const [fullEvents, setFullEvents] = useState<EventRow[] | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [pinError, setPinError] = useState("");

  const unlockFull = async () => {
    if (!url || !pin.trim()) return;
    setUnlocking(true); setPinError("");
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "admin-events", pin: pin.trim(), limit: 80 }) });
      const d = await r.json().catch(() => ({}));
      if (!d?.ok) { setPinError(d?.message || "Could not unlock"); setUnlocking(false); return; }
      setFullEvents(d.events || []);
      setPin("");
    } catch { setPinError("Can't reach the email server"); }
    setUnlocking(false);
  };

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
  const sentToday = Math.max(todaySum.sent, health?.today?.sent || 0);
  const quotaPct = Math.min(100, Math.round((sentToday / Math.max(1, settingsDraft.dailyLimit)) * 100));
  const shownEvents = fullEvents || events;
  const rtx = health?.gmail?.refreshExpiresAt || 0;

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

      {/* API + token health */}
      <div className={`${glassCard} p-4 space-y-2.5`}>
        <h3 className="text-sm font-semibold text-zinc-300 flex items-center gap-2"><Fingerprint size={14} className="text-sky-400" /> API &amp; token health</h3>
        {(() => {
          const rows: [string, string, "ok" | "bad" | "warn" | "off"][] = [
            ["Gmail API", !health?.gmail ? "Not checked yet" : gmailOk ? `Working · ${health.gmail.ms} ms` : `${health.gmail.code}`, !health?.gmail ? "off" : gmailOk ? "ok" : "bad"],
            ["Refresh token", !health?.gmail ? "—" : !gmailOk ? (health.gmail.code === "gmail_token_revoked" ? "Expired or revoked" : "Not working") : rtx ? `Expires in ${until(rtx)} (Google app in Testing mode)` : "Valid · no expiry reported", !health?.gmail ? "off" : !gmailOk ? "bad" : rtx ? "warn" : "ok"],
            ["Access token", health?.gmail?.accessExpiresAt ? `Fresh · renews in ${until(health.gmail.accessExpiresAt)}` : "—", health?.gmail?.accessExpiresAt ? "ok" : "off"],
            ["Send permission", health?.gmail ? (health.gmail.scope ? (/gmail\.send|mail\.google\.com/.test(health.gmail.scope) ? "gmail.send granted" : "gmail.send missing") : gmailOk ? "granted" : "—") : "—", health?.gmail ? (gmailOk ? "ok" : "bad") : "off"],
            ["Last email sent", health?.last?.lastOkAt ? `${ago(health.last.lastOkAt)}${health.last.lastMs ? ` · ${health.last.lastMs} ms` : ""}` : "No email yet", health?.last?.lastOkAt ? "ok" : "off"],
            ["Last error", health?.last?.lastErrAt ? `${health.last.lastErr} · ${ago(health.last.lastErrAt)}` : "None", health?.last?.lastErrAt ? (health.last.ok ? "warn" : "bad") : "ok"],
            ["Server version", health?.service || "—", health?.service ? (health.service.endsWith("v4") ? "ok" : "warn") : "off"],
          ];
          const dot = { ok: "bg-emerald-400", bad: "bg-red-500", warn: "bg-amber-400", off: "bg-zinc-600" };
          return (
            <div className="divide-y divide-white/5 rounded-xl border border-white/5 bg-white/[0.03]">
              {rows.map(([k, v, t]) => (
                <div key={k} className="flex items-center gap-2.5 px-3 py-2">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${dot[t]}`} />
                  <span className="text-[10.5px] text-zinc-400 w-[96px] shrink-0">{k}</span>
                  <span className="text-[10.5px] text-zinc-100 min-w-0 flex-1 truncate text-right">{v}</span>
                </div>
              ))}
            </div>
          );
        })()}
        {health?.last?.lastErrMsg && !health.last.ok && <p className="text-[9.5px] text-red-300/80 break-words">{health.last.lastErrMsg}</p>}
        {health?.service && !health.service.endsWith("v4") && <p className="text-[9.5px] text-amber-300/90">The live Worker is older than this panel. Redeploy <b>email-service</b> from Cloudflare Manager to get the new limits and protection.</p>}
        {health?.gmail?.checkedAt && <p className="text-[9px] text-zinc-600">Checked {ago(health.gmail.checkedAt)} (cached 1 min on the server)</p>}
      </div>

      {/* Limits in plain words */}
      <div className={`${glassCard} p-4 space-y-2`}>
        <h3 className="text-sm font-semibold text-zinc-300 flex items-center gap-2"><ShieldCheck size={14} className="text-emerald-400" /> Anti-spam protection</h3>
        <ul className="text-[10.5px] text-zinc-300 leading-relaxed space-y-1">
          <li>• One live code per email — a new one only after <b>{Math.round(settingsDraft.cooldownSeconds / 60 * 10) / 10} min</b></li>
          <li>• <b>{settingsDraft.perEmailDaily}</b> codes per email per day (resets at midnight, Bangladesh time)</li>
          <li>• <b>{settingsDraft.hourlyPerIp}</b>/hour and <b>{settingsDraft.perIpDaily}</b>/day from one network (IP)</li>
          <li>• Whole service: <b>{settingsDraft.perMinute}</b>/minute, <b>{settingsDraft.dailyLimit}</b>/day</li>
          <li>• Code valid <b>{settingsDraft.otpMinutes} min</b>, button <b>{settingsDraft.linkMinutes} min</b>, <b>{settingsDraft.maxAttempts}</b> wrong tries then locked</li>
          <li>• Codes, links and emails are hashed/encrypted; every request record is signed, so edited or rolled-back records are refused{weekSum.tampered ? <> — <b className="text-red-300">{weekSum.tampered} blocked this week</b></> : null}</li>
        </ul>
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
            Optional: EMAIL_SECRET {health.optional.EMAIL_SECRET ? "✓" : "—"} · SITE_URL {health.optional.SITE_URL ? "✓" : "—"} · FIREBASE_DB_URL {health.optional.FIREBASE_DB_URL ? "✓" : "—"} · FIREBASE_DB_SECRET {health.optional.FIREBASE_DB_SECRET ? "✓" : "—"} · ADMIN_PIN {health.optional.ADMIN_PIN ? "✓" : "— (needed to see full emails)"}
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
            <span>Daily limit</span><span className="tabular-nums text-zinc-300">{sentToday} / {settingsDraft.dailyLimit}{health?.today ? ` · resets in ${until(Date.now() + health.today.resetsInSec * 1000)}` : ""}</span>
          </div>
          <div className="h-2 rounded-full bg-white/5 overflow-hidden">
            <div className={`h-full rounded-full ${quotaPct > 85 ? "bg-red-500" : quotaPct > 60 ? "bg-amber-400" : "bg-gradient-to-r from-blue-600 to-cyan-400"}`} style={{ width: `${quotaPct}%` }} />
          </div>
          <p className="text-[9px] text-zinc-600 mt-1">A personal Gmail account can send about 500 emails a day — keep this cap below it so Google never flags the account.</p>
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
            <button onClick={async () => { if (!confirm("Clear the activity list?")) return; await remove(ref(db, "emailAuth/events")); setFullEvents(null); toast.success("Cleared"); }}
              className={`${btnSecondary} px-2 py-1 text-[9px] flex items-center gap-1`}><Trash2 size={9} /> Clear</button>
          )}
        </div>
        {fullEvents ? (
          <div className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[10.5px] text-emerald-200">
            <span className="flex items-center gap-1.5"><Unlock size={11} /> Full emails shown (this screen only)</span>
            <button onClick={() => setFullEvents(null)} className="font-semibold text-emerald-100">Hide</button>
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="flex gap-2">
              <input type="password" inputMode="numeric" value={pin} onChange={(e) => { setPin(e.target.value); setPinError(""); }} placeholder="Worker ADMIN_PIN"
                onKeyDown={(e) => { if (e.key === "Enter") void unlockFull(); }} className={`${inputClass} flex-1 px-3 py-2 text-xs`} />
              <button onClick={unlockFull} disabled={unlocking || !pin.trim() || !url} className={`${btnSecondary} px-3 text-[10.5px] flex items-center gap-1.5 disabled:opacity-40`}>
                {unlocking ? <Loader2 size={11} className="animate-spin" /> : <Lock size={11} />} Show full emails
              </button>
            </div>
            {pinError && <p className="text-[10px] text-red-300">{pinError}</p>}
            <p className="text-[9px] text-zinc-600">Emails are stored encrypted. Only the email server can open them, after it checks its own ADMIN_PIN secret.</p>
          </div>
        )}
        {shownEvents.length === 0 ? <p className="text-[11px] text-zinc-600 text-center py-3">No email activity yet</p> : (
          <div className="space-y-1 max-h-[360px] overflow-y-auto">
            {shownEvents.map((e) => {
              const look = EVENT_LOOK[e.k] || { label: e.k, tone: "text-zinc-300" };
              return (
                <div key={e.id} className="rounded-lg bg-white/[0.03] border border-white/5 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-[11px] font-semibold ${look.tone}`}>{look.label}</span>
                    <span className="text-[9px] text-zinc-500 shrink-0">{e.t ? fmtTime(e.t) : ""}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <span className={`text-[10px] font-mono truncate ${e.email ? "text-zinc-100" : "text-zinc-400"}`}>{e.email || e.m || "—"}{e.p ? ` · ${e.p === "reset" ? "reset" : "sign-up"}` : ""}{e.r ? ` · #${e.r}` : ""}</span>
                    {e.ms != null && <span className="text-[9px] text-zinc-500 shrink-0">{e.ms} ms</span>}
                  </div>
                  {e.k === "limited" && e.why && <p className="text-[9px] text-amber-300/80 mt-1">{WHY[e.why] || e.why}</p>}
                  {e.k !== "limited" && (e.err || e.why) && <p className="text-[9px] text-red-300/80 mt-1 break-words">{e.err}{e.why ? ` — ${e.why}` : ""}</p>}
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
