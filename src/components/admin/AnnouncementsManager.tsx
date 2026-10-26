import { useEffect, useMemo, useState } from "react";
import { Megaphone, Sparkles, Trash2, Send, Loader2, ImagePlus, X } from "lucide-react";
import { db, ref, onValue, push, set, remove, update } from "@/lib/firebase";
import { activeAnnouncements, expiredAnnouncementIds, ANNOUNCEMENT_EXPIRY_HOURS, ANNOUNCEMENT_IMAGE_RATIOS, imageRatioClass, timeAgo, type AnnouncementKind, type AnnouncementImageRatio } from "@/lib/announcements";
import { uploadToImgbb } from "@/lib/imgbbUpload";
import { toast } from "sonner";

const label = (h: number) => h < 24 ? `${h} hours` : h < 168 ? `${h / 24} days` : h === 168 ? "1 week" : "30 days";
const field = "w-full px-3.5 py-2.5 bg-[#141422] border border-white/8 rounded-lg text-white text-sm focus:border-indigo-500 focus:outline-none placeholder:text-zinc-500";

export default function AnnouncementsManager() {
  const [raw, setRaw] = useState<Record<string, any>>({});
  const [kind, setKind] = useState<AnnouncementKind>("normal");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState("");
  const [ratio, setRatio] = useState<AnnouncementImageRatio>("16:9");
  const [hours, setHours] = useState(24);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => onValue(ref(db, "announcements"), s => setRaw(s.val() || {})), []);
  // Expired messages are deleted so nothing piles up in Firebase.
  useEffect(() => {
    const ids = expiredAnnouncementIds(raw);
    if (ids.length) update(ref(db, "announcements"), Object.fromEntries(ids.map(id => [id, null]))).catch(() => {});
  }, [raw]);
  const list = useMemo(() => activeAnnouncements(raw), [raw]);

  const upload = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    try { setImage(await uploadToImgbb(file)); } catch { toast.error("Image upload failed"); } finally { setUploading(false); }
  };
  const send = async () => {
    if (!title.trim()) { toast.error("Title is required"); return; }
    setBusy(true);
    try {
      const now = Date.now();
      await set(push(ref(db, "announcements")), { kind, title: title.trim(), description: description.trim(), ...(image ? { image, imageRatio: ratio } : {}), createdAt: now, expiresAt: now + hours * 3600_000 });
      toast.success(kind === "popup" ? "Popup sent to all visitors" : "Message added to the bell");
      setTitle(""); setDescription(""); setImage(""); setRatio("16:9");
    } catch (e: any) { toast.error("Could not send: " + (e?.message || "error")); }
    finally { setBusy(false); }
  };

  return <div className="bg-[#16162A] border border-white/6 rounded-xl p-4 mb-4 text-white">
    <h3 className="text-sm font-semibold mb-1 flex items-center gap-2"><Megaphone size={14} className="text-pink-500" /> Notifications & Popup Messages</h3>
    <p className="text-[11px] text-[#957DAD] mb-3">Normal = bell only. Popup = shown once to every visitor, then stays in the bell. Both delete themselves when they expire. New releases appear in the bell automatically.</p>
    <div className="grid grid-cols-2 gap-2 mb-3">
      {(["normal", "popup"] as const).map(k => <button key={k} type="button" onClick={() => setKind(k)}
        className={`flex items-center justify-center gap-2 rounded-lg border py-2.5 text-sm font-semibold ${kind === k ? "border-indigo-500 bg-indigo-600/20" : "border-white/10 text-zinc-400"}`}>
        {k === "popup" ? <Sparkles size={15} /> : <Megaphone size={15} />}{k === "popup" ? "Popup message" : "Normal message"}</button>)}
    </div>
    <input className={`${field} mb-2`} placeholder="Title" maxLength={90} value={title} onChange={e => setTitle(e.target.value)} />
    <textarea className={`${field} mb-2 min-h-[90px]`} placeholder="Details (what you updated, new features…)" maxLength={1200} value={description} onChange={e => setDescription(e.target.value)} />
    {image ? <div className="mb-3 rounded-lg border border-white/10 bg-[#141422] p-2.5">
        <p className="mb-2 text-[11px] font-semibold text-[#D1C4E9]">Image shape — the popup box takes this shape</p>
        <div className="mb-2.5 grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Image shape">
          {ANNOUNCEMENT_IMAGE_RATIOS.map(r => { const [w, h] = r.split(":").map(Number); return <button key={r} type="button" role="radio" aria-checked={ratio === r} onClick={() => setRatio(r)}
            className={`flex flex-col items-center gap-1 rounded-md border py-2 text-[11px] font-bold ${ratio === r ? "border-indigo-500 bg-indigo-600/20 text-white" : "border-white/10 text-zinc-400"}`}>
            <span className="flex h-6 items-center"><span className="block rounded-[2px] border-2 border-current" style={{ width: w >= h ? 24 : 24 * w / h, height: w >= h ? 24 * h / w : 24 }} /></span>{r}</button>; })}
        </div>
        <div className="relative"><img src={image} alt="Popup image preview" className={`${imageRatioClass(ratio)} rounded-lg object-cover`} />
          <button onClick={() => setImage("")} aria-label="Remove image" className="absolute right-1.5 top-1.5 rounded-full bg-black/70 p-1"><X size={14} /></button></div>
      </div>
      : <label className="mb-2 flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-white/15 py-3 text-xs text-zinc-400">
        {uploading ? <Loader2 size={15} className="animate-spin" /> : <ImagePlus size={15} />}{uploading ? "Uploading…" : "Optional image — upload, then pick its shape"}
        <input type="file" accept="image/*" className="hidden" onChange={e => upload(e.target.files?.[0])} />
      </label>}
    <div className="flex items-center gap-2 mb-3">
      <span className="text-xs text-[#D1C4E9]">Expires after</span>
      <select className={`${field} !w-auto flex-1`} value={hours} onChange={e => setHours(Number(e.target.value))}>
        {ANNOUNCEMENT_EXPIRY_HOURS.map(h => <option key={h} value={h}>{label(h)}</option>)}
      </select>
    </div>
    <button onClick={send} disabled={busy || uploading} className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 font-semibold rounded-lg py-3 inline-flex items-center justify-center gap-2">
      {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}{kind === "popup" ? "Send popup" : "Send message"}
    </button>
    <div className="mt-4 space-y-2">
      <p className="text-xs font-semibold text-[#D1C4E9]">Active messages ({list.length})</p>
      {list.length === 0 && <p className="text-[12px] text-zinc-500">No active messages.</p>}
      {list.map(a => <div key={a.id} className="flex items-start gap-2 rounded-lg bg-[#141422] p-2.5">
        <span className={`mt-0.5 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${a.kind === "popup" ? "bg-pink-500/20 text-pink-300" : "bg-indigo-500/20 text-indigo-300"}`}>{a.kind}</span>
        <div className="min-w-0 flex-1"><p className="text-[13px] font-semibold truncate">{a.title}</p><p className="text-[10px] text-zinc-500">{timeAgo(a.createdAt)} · expires {new Date(a.expiresAt).toLocaleString()}</p></div>
        <button aria-label={`Delete ${a.title}`} onClick={() => confirm("Delete this message?") && remove(ref(db, `announcements/${a.id}`)).then(() => toast.success("Deleted"))} className="text-red-400 p-1"><Trash2 size={15} /></button>
      </div>)}
    </div>
  </div>;
}
