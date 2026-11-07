import { useEffect, useState } from "react";
import { toast } from "sonner";
import { UserCheck, Plus, X, Mail, Users } from "lucide-react";
import { db, ref, update } from "@/lib/firebase";
import {
  DEFAULT_EMAIL_DOMAINS, normalizeDomain, subscribeLoginAccess, loginAccessNow, type LoginAccess,
} from "@/lib/emailService";

type Props = { glassCard: string; inputClass: string; btnPrimary: string };

/** Admin → Settings → Login settings: guest button switch + sign-up email domains. */
const LoginAccessManager = ({ glassCard, inputClass, btnPrimary }: Props) => {
  const [access, setAccess] = useState<LoginAccess>(loginAccessNow);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => subscribeLoginAccess(setAccess), []);

  const save = async (patch: Partial<LoginAccess>, msg: string) => {
    setBusy(true);
    try {
      await update(ref(db, "settings/loginAccess"), patch);
      toast.success(msg);
    } catch { toast.error("Save failed"); }
    setBusy(false);
  };

  const addDomain = () => {
    const d = normalizeDomain(draft);
    if (!d) { toast.error("Enter a domain like outlook.com"); return; }
    if (access.allowedDomains.includes(d)) { toast.error(`@${d} is already allowed`); return; }
    setDraft("");
    save({ allowedDomains: [...access.allowedDomains, d] }, `@${d} can now sign up`);
  };
  const removeDomain = (d: string) => {
    const next = access.allowedDomains.filter(x => x !== d);
    if (!next.length) { toast.error("Keep at least one domain"); return; }
    save({ allowedDomains: next }, `@${d} removed`);
  };

  return (
    <div className={`${glassCard} p-4 mb-4 space-y-4`} data-login-access>
      <h3 className="text-sm font-semibold flex items-center gap-2 text-white">
        <UserCheck size={14} className="text-emerald-400" /> Login settings
      </h3>

      <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
        <div className="w-9 h-9 rounded-lg bg-sky-500/15 flex items-center justify-center shrink-0"><Users size={16} className="text-sky-300" /></div>
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-semibold text-white">Continue as Guest</p>
          <p className="text-[10.5px] text-white/50 leading-snug">
            {access.guestEnabled ? "Visitors can browse without an account." : "Off — only signed-in users can use the site. Guests see the login page."}
          </p>
        </div>
        <button
          role="switch" aria-checked={access.guestEnabled} aria-label="Continue as Guest" disabled={busy}
          onClick={() => save({ guestEnabled: !access.guestEnabled }, access.guestEnabled ? "Guest access turned off" : "Guest access turned on")}
          className={`relative w-12 h-7 rounded-full transition-colors shrink-0 disabled:opacity-50 ${access.guestEnabled ? "bg-emerald-500" : "bg-white/15"}`}
        >
          <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all ${access.guestEnabled ? "left-6" : "left-1"}`} />
        </button>
      </div>

      <div className="space-y-2">
        <p className="text-[12px] font-semibold text-white flex items-center gap-1.5"><Mail size={13} className="text-amber-300" /> Allowed sign-up email domains</p>
        <p className="text-[10.5px] text-white/50">Only these addresses can create an account, use Google sign-in and reset passwords. Default: @{DEFAULT_EMAIL_DOMAINS[0]}.</p>
        <div className="flex flex-wrap gap-1.5">
          {access.allowedDomains.map(d => (
            <span key={d} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-200 text-[11px] font-mono">
              @{d}
              <button onClick={() => removeDomain(d)} disabled={busy} aria-label={`Remove ${d}`} className="w-5 h-5 rounded-full hover:bg-white/10 flex items-center justify-center"><X size={11} /></button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => e.key === "Enter" && addDomain()}
            placeholder="e.g. outlook.com" className={`${inputClass} flex-1`} aria-label="New email domain" />
          <button onClick={addDomain} disabled={busy} className={`${btnPrimary} !px-4`}><Plus size={14} /> Add</button>
        </div>
        <p className="text-[10px] text-white/40">Redeploy the Email Service Worker once so it reads this list too.</p>
      </div>
    </div>
  );
};

export default LoginAccessManager;
