import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Eye, EyeOff, Image as ImageIcon, Loader2, Plus, ScanFace, Trash2, Save, Coins, Gift, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  scale: 126,
  offsetX: 0,
  offsetY: 0,
  isNew: true,
});

const card = "rounded-lg border border-border/60 bg-card p-4 shadow-sm";
const label = "mb-1.5 block text-[11px] font-semibold uppercase text-muted-foreground";
const field =
  "h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary";

const ProfileShopManager = () => {
  const [shop, setShop] = useState<ProfileShop>(EMPTY_SHOP);
  const [kind, setKind] = useState<ShopKind>("frames");
  const [drafts, setDrafts] = useState<Record<string, DraftItem>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);

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

  const uploadImage = async (item: DraftItem, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.error("Choose an image file");
    if (file.size > 10 * 1024 * 1024) return toast.error("Image must be smaller than 10MB");
    setUploadingId(item.id);
    try {
      const { uploadToImgbb } = await import("@/lib/imgbbUpload");
      const imageUrl = await uploadToImgbb(file);
      patch(item.id, { imageUrl, name: item.name || file.name.replace(/\.[^.]+$/, "") });
      toast.success("Image uploaded. Save the item to publish it.");
    } catch {
      toast.error("Image upload failed. Try again or paste an image URL.");
    } finally {
      setUploadingId(null);
    }
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
      <div className={`${card} flex flex-col gap-4`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
              <ScanFace size={17} className="text-primary" /> Profile Shop
            </h3>
            <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-muted-foreground">
              Add transparent PNG/WebP frames or wide backdrop images. Upload, preview, set the price, then publish.
            </p>
          </div>
          <Button
            onClick={addItem}
            className="h-10 max-w-full shrink-0 px-4 text-[13px]"
          >
            <Plus size={14} /> New {kind === "frames" ? "frame" : "backdrop"}
          </Button>
        </div>

        <div className="flex gap-2">
          {(["frames", "backgrounds"] as const).map((k) => (
            <Button
              key={k}
              type="button"
              variant={kind === k ? "default" : "outline"}
              onClick={() => setKind(k)}
              className="h-10 min-w-0 flex-1 whitespace-normal px-2 text-[12px] font-semibold"
            >
              {k === "frames" ? "Avatar Frames" : "Backgrounds"} ({k === "frames" ? shop.frames.length : shop.backgrounds.length})
            </Button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className={`${card} py-10 text-center text-[13px] text-muted-foreground`}>
          No {kind} yet. Add one, then choose an image from your gallery.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {rows.map((item) => {
            const dirty = !!drafts[item.id];
            const isUploading = uploadingId === item.id;
            return (
              <div key={item.id} className={`${card} relative space-y-3 ${dirty ? "ring-1 ring-primary/50" : ""}`}>
                <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-3">
                  <div className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold text-foreground">{item.name || `Untitled ${kind === "frames" ? "frame" : "backdrop"}`}</span>
                    <span className={`mt-0.5 block text-[10px] font-bold uppercase ${item.isNew ? "text-primary" : dirty ? "text-warning" : "text-success"}`}>
                      {item.isNew ? "New item · not published" : dirty ? "Unsaved changes" : "Published"}
                    </span>
                  </div>
                  <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-[10px] font-semibold text-muted-foreground">#{Math.max(0, item.order)}</span>
                </div>
                <div className="flex items-start gap-3">
                  <div className={`profile-shop-admin-preview grid shrink-0 place-items-center overflow-hidden rounded-md border border-border ${kind === "frames" ? "is-frame h-28 w-28" : "h-20 w-28"}`}>
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt={item.name || `${kind} preview`} className={`h-full w-full ${kind === "frames" ? "object-contain" : "object-cover"}`} />
                    ) : (
                      <ImageIcon size={20} className="text-muted-foreground" />
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
                    <label className="block">
                      <span className={label}>Gallery image</span>
                       <span className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-primary/60 bg-primary/5 px-3 text-center text-[12px] font-semibold text-primary hover:bg-primary/10">
                        {isUploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                        {isUploading ? "Uploading…" : "Choose from gallery"}
                      </span>
                      <input type="file" accept={kind === "frames" ? "image/png,image/webp" : "image/*"} className="hidden" disabled={isUploading} onChange={(event) => uploadImage(item, event)} />
                    </label>
                  </div>
                </div>

                <div>
                  <span className={label}>Image URL</span>
                  <input className={field} value={item.imageUrl} placeholder="Uploaded URL appears here" onChange={(e) => patch(item.id, { imageUrl: e.target.value })} />
                </div>

                <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-3">
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
                  <div>
                    <span className={label}>Display order</span>
                    <input type="number" min={0} className={field} value={item.order} onChange={(e) => patch(item.id, { order: Math.max(0, Number(e.target.value || 0)) })} />
                  </div>
                </div>

                {kind === "frames" && (
                  <div className="rounded-md border border-border/60 bg-muted/20 p-3">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <div><span className="block text-[12px] font-semibold text-foreground">Frame placement</span><span className="text-[10px] text-muted-foreground">Fit the clear opening around the profile photo</span></div>
                      <Button type="button" variant="ghost" size="sm" className="h-8 text-[11px]" onClick={() => patch(item.id, { scale: 126, offsetX: 0, offsetY: 0 })}>Reset</Button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      {([
                        ["Size", "scale", 80, 180, "%"],
                        ["Left / right", "offsetX", -30, 30, "px"],
                        ["Up / down", "offsetY", -30, 30, "px"],
                      ] as const).map(([title, key, min, max, unit]) => (
                        <label key={key} className="block text-[11px] text-muted-foreground">
                          <span className="mb-1 flex justify-between"><span>{title}</span><strong className="text-foreground">{item[key]}{unit}</strong></span>
                          <input className="w-full accent-primary" type="range" min={min} max={max} value={item[key]} onChange={(e) => patch(item.id, { [key]: Number(e.target.value) })} />
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => patch(item.id, { free: !item.free })}
                    className={`h-9 min-w-0 px-2 text-[12px] ${item.free ? "border-success/50 bg-success/10 text-success" : ""}`}
                  >
                    {item.free ? <Gift size={13} /> : <Coins size={13} />} {item.free ? "Free for all" : "Paid"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => patch(item.id, { enabled: !item.enabled })}
                    className="h-9 min-w-0 px-2 text-[12px]"
                  >
                    {item.enabled ? <Eye size={13} /> : <EyeOff size={13} />} {item.enabled ? "Visible" : "Hidden"}
                  </Button>
                  <div className="hidden flex-1 sm:block" />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => drop(item)}
                    className="h-9 w-full text-destructive sm:w-9"
                    aria-label="Delete"
                  >
                    <Trash2 size={14} />
                  </Button>
                  <Button
                    type="button"
                    onClick={() => save(item)}
                    disabled={savingId === item.id || isUploading || (!dirty && !item.isNew)}
                    className="h-9 min-w-0 px-4 text-[12px]"
                  >
                    {savingId === item.id ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} {item.isNew ? "Publish" : "Save changes"}
                  </Button>
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
