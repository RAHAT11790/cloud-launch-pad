import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Image as ImageIcon, Loader2, Plus, ScanFace, Trash2, Save, Coins, Gift } from "lucide-react";
import {
  EMPTY_SHOP,
  ProfileShop,
  ShopItem,
  ShopKind,
  deleteProfileShopItem,
  makeShopItemId,
  saveProfileShopItem,
  subscribeProfileShop,
} from "@/lib/profileShop";

type DraftItem = ShopItem & { isNew?: boolean };

const blankItem = (kind: ShopKind, order: number): DraftItem => ({
  id: makeShopItemId(kind === "frames" ? "frame" : "background"),
  name: "",
  imageUrl: "",
  price: 10,
  free: false,
  enabled: true,
  tier: "Custom",
  order,
  isNew: true,
});

const card = "rounded-2xl border border-white/10 bg-[#15152a] p-4";
const label = "mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-[#9d93c2]";
const field =
  "h-10 w-full rounded-lg border border-white/10 bg-[#0f0f1e] px-3 text-[13px] text-white outline-none placeholder:text-[#6f6893] focus:border-purple-500";

const ProfileShopManager = () => {
  const [shop, setShop] = useState<ProfileShop>(EMPTY_SHOP);
  const [kind, setKind] = useState<ShopKind>("frames");
  const [drafts, setDrafts] = useState<Record<string, DraftItem>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => subscribeProfileShop(setShop), []);

  const items = kind === "frames" ? shop.frames : shop.backgrounds;

  const rows = useMemo<DraftItem[]>(() => {
    const stored = items.map((item) => drafts[item.id] || item);
    const news = Object.values(drafts).filter((d) => d.isNew && !items.some((i) => i.id === d.id));
    return [...news, ...stored];
  }, [items, drafts]);

  const patch = (id: string, next: Partial<DraftItem>) =>
    setDrafts((current) => {
      const base = current[id] || items.find((i) => i.id === id);
      if (!base) return current;
      return { ...current, [id]: { ...base, ...next } };
    });

  const addItem = () => {
    const draft = blankItem(kind, items.length + 1);
    setDrafts((current) => ({ ...current, [draft.id]: draft }));
  };

  const save = async (item: DraftItem) => {
    if (!item.name.trim()) return toast.error("Give this item a name");
    if (!item.imageUrl.trim()) return toast.error("Add the image URL");
    setSavingId(item.id);
    try {
      const { isNew, ...clean } = item;
      await saveProfileShopItem(kind, { ...clean, name: clean.name.trim(), imageUrl: clean.imageUrl.trim() });
      setDrafts((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      toast.success("Saved");
    } catch {
      toast.error("Could not save");
    } finally {
      setSavingId(null);
    }
  };

  const drop = async (item: DraftItem) => {
    if (item.isNew) {
      setDrafts((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      return;
    }
    if (!confirm(`Delete "${item.name}"?`)) return;
    try {
      await deleteProfileShopItem(kind, item.id);
      toast.success("Deleted");
    } catch {
      toast.error("Could not delete");
    }
  };

  return (
    <div className="space-y-4">
      <div className={`${card} flex flex-col gap-3`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
              <ScanFace size={15} className="text-purple-400" /> Profile Shop
            </h3>
            <p className="mt-1 text-[12px] leading-relaxed text-[#9d93c2]">
              Add avatar frames and profile background images, then set each price. Free items unlock for everyone;
              premium members get everything free.
            </p>
          </div>
          <button
            onClick={addItem}
            className="inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg bg-gradient-to-r from-purple-600 to-fuchsia-600 px-4 text-[13px] font-semibold text-white"
          >
            <Plus size={14} /> Add {kind === "frames" ? "frame" : "background"}
          </button>
        </div>

        <div className="flex gap-2">
          {(["frames", "backgrounds"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`h-9 flex-1 rounded-lg border text-[12px] font-semibold capitalize transition-colors ${
                kind === k
                  ? "border-transparent bg-purple-600 text-white"
                  : "border-white/10 bg-[#0f0f1e] text-[#9d93c2] hover:border-purple-500/50"
              }`}
            >
              {k === "frames" ? "Avatar Frames" : "Backgrounds"} ({k === "frames" ? shop.frames.length : shop.backgrounds.length})
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className={`${card} py-10 text-center text-[13px] text-[#9d93c2]`}>
          No {kind} yet. Click “Add {kind === "frames" ? "frame" : "background"}” to upload your first PNG URL.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {rows.map((item) => {
            const dirty = !!drafts[item.id];
            return (
              <div key={item.id} className={`${card} space-y-3`}>
                <div className="flex items-start gap-3">
                  <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-xl border border-white/10 bg-[#0f0f1e]">
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt={item.name} className="h-full w-full object-contain" />
                    ) : (
                      <ImageIcon size={18} className="text-[#6f6893]" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    <div>
                      <span className={label}>Name</span>
                      <input
                        className={field}
                        value={item.name}
                        placeholder={kind === "frames" ? "Wolf Spirit" : "Neon Tokyo"}
                        onChange={(e) => patch(item.id, { name: e.target.value })}
                      />
                    </div>
                    <div>
                      <span className={label}>Image URL (transparent PNG for frames)</span>
                      <input
                        className={field}
                        value={item.imageUrl}
                        placeholder="https://..."
                        onChange={(e) => patch(item.id, { imageUrl: e.target.value })}
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className={label}>Price (coins)</span>
                    <input
                      type="number"
                      min={0}
                      className={`${field} ${item.free ? "opacity-50" : ""}`}
                      disabled={item.free}
                      value={item.price}
                      onChange={(e) => patch(item.id, { price: Math.max(0, Number(e.target.value || 0)) })}
                    />
                  </div>
                  <div>
                    <span className={label}>Tier label</span>
                    <input
                      className={field}
                      value={item.tier}
                      placeholder="Legendary"
                      onChange={(e) => patch(item.id, { tier: e.target.value })}
                    />
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => patch(item.id, { free: !item.free })}
                    className={`inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-[12px] font-semibold ${
                      item.free
                        ? "border-transparent bg-emerald-600 text-white"
                        : "border-white/10 bg-[#0f0f1e] text-[#9d93c2]"
                    }`}
                  >
                    {item.free ? <Gift size={13} /> : <Coins size={13} />} {item.free ? "Free for all" : "Paid"}
                  </button>
                  <button
                    onClick={() => patch(item.id, { enabled: !item.enabled })}
                    className={`inline-flex h-9 items-center whitespace-nowrap rounded-lg border px-3 text-[12px] font-semibold ${
                      item.enabled
                        ? "border-transparent bg-sky-600 text-white"
                        : "border-white/10 bg-[#0f0f1e] text-[#9d93c2]"
                    }`}
                  >
                    {item.enabled ? "Visible" : "Hidden"}
                  </button>
                  <div className="flex-1" />
                  <button
                    onClick={() => drop(item)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-[#0f0f1e] text-[#9d93c2] hover:text-red-400"
                    aria-label="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                  <button
                    onClick={() => save(item)}
                    disabled={savingId === item.id}
                    className={`inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg px-4 text-[12px] font-semibold text-white ${
                      dirty || item.isNew ? "bg-gradient-to-r from-purple-600 to-fuchsia-600" : "bg-white/10"
                    }`}
                  >
                    {savingId === item.id ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ProfileShopManager;
