import { useEffect, useRef, useState } from "react";
import { db, ref, onValue, set, push, update, remove } from "@/lib/firebase";
import { toast } from "sonner";
import { Save, Loader2, Upload, Edit, Trash2 } from "lucide-react";
import CachedImg from "@/components/CachedImg";

interface Props {
  glassCard: string;
  inputClass: string;
  btnPrimary: string;
  btnSecondary: string;
}

type Channel = {
  id: string;
  name: string;
  logo: string;
  banner: string;
  streamUrl: string;
  category: string;
  order: number;
};

// Warm-start cache — paints channels + categories instantly on re-open.
const CH_CACHE_KEY = "rs_admin_live_tv_channels_v1";
const CAT_CACHE_KEY = "rs_admin_live_tv_categories_v1";
let channelsCache: Channel[] = (() => {
  try { return JSON.parse(localStorage.getItem(CH_CACHE_KEY) || "[]"); } catch { return []; }
})();
let categoriesCache: string[] = (() => {
  try { return JSON.parse(localStorage.getItem(CAT_CACHE_KEY) || "[]"); } catch { return []; }
})();

const LiveTvManager = ({ glassCard, inputClass, btnPrimary, btnSecondary }: Props) => {
  const [channels, setChannelsState] = useState<Channel[]>(channelsCache);
  const [name, setName] = useState("");
  const [logo, setLogo] = useState("");
  const [banner, setBanner] = useState("");
  const [streamUrl, setStreamUrl] = useState("");
  const [category, setCategory] = useState("General");
  const [editId, setEditId] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const logoFileRef = useRef<HTMLInputElement>(null);
  const bannerFileRef = useRef<HTMLInputElement>(null);
  const [categories, setCategories] = useState<string[]>(categoriesCache.length ? categoriesCache : ["General"]);
  const [newCatName, setNewCatName] = useState("");
  const [showAddCat, setShowAddCat] = useState(false);

  const handleImgUpload = async (file: File, setter: (v: string) => void, setLoading: (v: boolean) => void) => {
    if (file.size > 10 * 1024 * 1024) { toast.error("Max 10MB!"); return; }
    if (!file.type.startsWith("image/")) { toast.error("Only images!"); return; }
    setLoading(true);
    try {
      const { uploadToImgbb } = await import("@/lib/imgbbUpload");
      const url = await uploadToImgbb(file);
      setter(url);
      toast.success("✅ image upload done!");
    } catch { toast.error("❌ upload failed!"); }
    setLoading(false);
  };

  useEffect(() => {
    const unsub = onValue(ref(db, "liveTvChannels"), (snap) => {
      const data = snap.val();
      let list: Channel[] = [];
      if (data) {
        list = Object.entries(data).map(([id, val]: any) => ({
          id, name: val.name || "", logo: val.logo || "", banner: val.banner || "", streamUrl: val.streamUrl || "",
          category: val.category || "General", order: val.order || 0,
        }));
        list.sort((a, b) => a.order - b.order);
      }
      channelsCache = list;
      try { localStorage.setItem(CH_CACHE_KEY, JSON.stringify(list)); } catch {}
      setChannelsState(list);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onValue(ref(db, "liveTvCategories"), (snap) => {
      const data = snap.val();
      let next: string[] = ["General"];
      if (data && Array.isArray(data)) next = data;
      else if (data && typeof data === "object") next = Object.values(data) as string[];
      categoriesCache = next;
      try { localStorage.setItem(CAT_CACHE_KEY, JSON.stringify(next)); } catch {}
      setCategories(next);
    });
    return () => unsub();
  }, []);

  const addCategory = async () => {
    if (!newCatName.trim()) return;
    const updated = [...categories, newCatName.trim()];
    await set(ref(db, "liveTvCategories"), updated);
    setNewCatName("");
    setShowAddCat(false);
    toast.success("✅ Category add done!");
  };

  const deleteCategory = async (cat: string) => {
    const updated = categories.filter(c => c !== cat);
    await set(ref(db, "liveTvCategories"), updated.length ? updated : ["General"]);
    toast.success("🗑️ Category মুছে ফেলা done!");
  };

  const saveChannel = async () => {
    if (!name.trim() || !streamUrl.trim()) { toast.error("name and Stream URL enter!"); return; }
    const data = { name: name.trim(), logo: logo.trim(), banner: banner.trim(), streamUrl: streamUrl.trim(), category: category.trim() || "General", order: channels.length };
    if (editId) {
      await update(ref(db, `liveTvChannels/${editId}`), data);
      toast.success("✅ channel update done!");
      setEditId(null);
    } else {
      await push(ref(db, "liveTvChannels"), data);
      toast.success("✅ channel add done!");
    }
    setName(""); setLogo(""); setBanner(""); setStreamUrl(""); setCategory("General");
  };

  const deleteChannel = async (id: string) => {
    if (!confirm("Delete this channel?")) return;
    await remove(ref(db, `liveTvChannels/${id}`));
    toast.success("🗑️ channel delete done!");
  };

  const startEdit = (ch: Channel) => {
    setEditId(ch.id); setName(ch.name); setLogo(ch.logo); setBanner(ch.banner || ""); setStreamUrl(ch.streamUrl); setCategory(ch.category);
  };

  return (
    <div>
      <div className={`${glassCard} p-4 mb-4`}>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          📺 {editId ? "Edit Channel" : "Add New Channel"}
        </h3>
        <div className="space-y-3">
          <div>
            <label className="text-[10px] text-zinc-400 block mb-1">Channel Name *</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Channel name" className={inputClass} />
          </div>

          <div>
            <label className="text-[10px] text-zinc-400 block mb-1">Channel Logo</label>
            <div className="flex gap-2">
              <input value={logo} onChange={e => setLogo(e.target.value)} placeholder="https://logo-url.png" className={`${inputClass} flex-1`} />
              <button
                onClick={() => logoFileRef.current?.click()}
                disabled={uploadingLogo}
                className={`${btnSecondary} px-3 py-2 text-[10px] flex items-center gap-1`}
              >
                {uploadingLogo ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                upload
              </button>
              <input ref={logoFileRef} type="file" accept="image/*" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleImgUpload(f, setLogo, setUploadingLogo); e.target.value = ""; }} />
            </div>
            {logo && (
              <div className="mt-2 w-16 h-16 rounded-xl overflow-hidden bg-zinc-800/50 border border-zinc-700/40">
                <CachedImg src={logo} alt="Logo" className="w-full h-full object-contain" loading="lazy" decoding="async" />
              </div>
            )}
          </div>

          <div>
            <label className="text-[10px] text-zinc-400 block mb-1">Channel Banner (16:9)</label>
            <div className="flex gap-2">
              <input value={banner} onChange={e => setBanner(e.target.value)} placeholder="https://banner-url.png" className={`${inputClass} flex-1`} />
              <button
                onClick={() => bannerFileRef.current?.click()}
                disabled={uploadingBanner}
                className={`${btnSecondary} px-3 py-2 text-[10px] flex items-center gap-1`}
              >
                {uploadingBanner ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                upload
              </button>
              <input ref={bannerFileRef} type="file" accept="image/*" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleImgUpload(f, setBanner, setUploadingBanner); e.target.value = ""; }} />
            </div>
            {banner && (
              <div className="mt-2 aspect-video rounded-xl overflow-hidden bg-zinc-800/50 border border-zinc-700/40">
                <CachedImg src={banner} alt="Banner" className="w-full h-full object-cover" loading="lazy" decoding="async" />
              </div>
            )}
          </div>

          <div>
            <label className="text-[10px] text-zinc-400 block mb-1">Stream URL *</label>
            <input value={streamUrl} onChange={e => setStreamUrl(e.target.value)} placeholder="https://stream.m3u8" className={inputClass} />
          </div>
          <div>
            <label className="text-[10px] text-zinc-400 block mb-1">Category</label>
            <div className="flex gap-2">
              <select value={category} onChange={e => setCategory(e.target.value)} className={`${inputClass} flex-1`}>
                {categories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
              <button onClick={() => setShowAddCat(!showAddCat)} className={`${btnSecondary} px-3 py-2 text-[10px]`}>
                {showAddCat ? "✕" : "+ new"}
              </button>
            </div>
            {showAddCat && (
              <div className="flex gap-2 mt-2">
                <input value={newCatName} onChange={e => setNewCatName(e.target.value)} placeholder="new Category name" className={`${inputClass} flex-1`} />
                <button onClick={addCategory} className={`${btnPrimary} px-3 py-2 text-[10px]`}>add </button>
              </div>
            )}
            {categories.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {categories.map(cat => (
                  <span key={cat} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-zinc-700/50 text-[9px] text-zinc-300">
                    {cat}
                    {cat !== "General" && (
                      <button onClick={() => deleteCategory(cat)} className="hover:text-red-400">✕</button>
                    )}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={saveChannel} className={`${btnPrimary} flex-1 py-2.5 flex items-center justify-center gap-2`}>
              <Save size={14} /> {editId ? "update " : "add "}
            </button>
            {editId && (
              <button onClick={() => { setEditId(null); setName(""); setLogo(""); setBanner(""); setStreamUrl(""); setCategory("General"); }}
                className={`${btnSecondary} px-4 py-2.5`}>
                cancel
              </button>
            )}
          </div>
        </div>
      </div>

      <div className={`${glassCard} p-4`}>
        <h3 className="text-sm font-semibold mb-3">📺 All Channels ({channels.length})</h3>
        {channels.length === 0 ? (
          <p className="text-xs text-zinc-500 text-center py-6">any channel none</p>
        ) : (
          <div className="space-y-2">
            {channels.map(ch => (
              <div key={ch.id} className="flex items-center gap-3 p-3 rounded-xl bg-zinc-800/40 border border-zinc-700/30">
                <div className="w-12 h-8 rounded-lg overflow-hidden bg-zinc-700/50 flex-shrink-0">
                  {ch.logo && <CachedImg src={ch.logo} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-white truncate">{ch.name}</p>
                  <p className="text-[9px] text-zinc-500 truncate">{ch.streamUrl}</p>
                  <p className="text-[9px] text-cyan-400">{ch.category}</p>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => startEdit(ch)} className="p-1.5 rounded-lg bg-zinc-700/50 hover:bg-zinc-600/50">
                    <Edit size={12} className="text-zinc-300" />
                  </button>
                  <button onClick={() => deleteChannel(ch.id)} className="p-1.5 rounded-lg bg-zinc-700/50 hover:bg-red-600/50">
                    <Trash2 size={12} className="text-zinc-300" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default LiveTvManager;
