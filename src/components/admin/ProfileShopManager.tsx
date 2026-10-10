import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Eye, EyeOff, Image as ImageIcon, Loader2, Plus, ScanFace, Trash2, Save, Coins, Gift, Upload, Film, Sparkles, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DEFAULT_FRAME_EFFECTS,
  EMPTY_SHOP,
  FRAME_EFFECTS,
  FrameEffect,
  ProfileShop,
  ShopItem,
  ShopKind,
  deleteProfileShopItem,
  makeShopItemId,
  saveProfileShopItem,
  subscribeProfileShop,
} from "@/lib/profileShop";
import { FrameBackLayers, FrameFrontLayers, frameStyleVars } from "@/components/profile/AnimatedFrame";
import BackdropMedia from "@/components/profile/BackdropMedia";

type DraftItem = ShopItem & { isNew?: boolean; draftKind?: ShopKind };

const blankItem = (kind: ShopKind, order: number): DraftItem => ({
  id: makeShopItemId(kind === "frames" ? "frame" : "background"),
  name: "",
  imageUrl: "",
  mediaType: "image",
  videoUrl: "",
  effects: [...DEFAULT_FRAME_EFFECTS],
  fxColor: "",
  fxSpeed: 1,
  price: 10,
  free: false,
  enabled: true,
  tier: "Custom",
  order,
  scale: 126,
  offsetX: 0,
  offsetY: 0,
  isNew: true,
  draftKind: kind,
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
    const news = Object.values(drafts).filter((d) => d.isNew && d.draftKind === kind && !items.some((i) => i.id === d.id));
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

  const uploadVideo = async (item: DraftItem, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return toast.error("File is larger than 10MB — not accepted");
    const isGif = file.type === "image/gif";
    if (!isGif && !file.type.startsWith("video/")) return toast.error("Choose a video or GIF file");
    setUploadingId(item.id);
    try {
      if (isGif) {
        const { uploadToImgbb } = await import("@/lib/imgbbUpload");
        const imageUrl = await uploadToImgbb(file);
        patch(item.id, { mediaType: "image", imageUrl, name: item.name || file.name.replace(/\.[^.]+$/, "") });
      } else {
        const { uploadMediaFile, posterFromFile } = await import("@/lib/profileMediaStore");
        const videoUrl = await uploadMediaFile(file);
        patch(item.id, { mediaType: "video", videoUrl, name: item.name || file.name.replace(/\.[^.]+$/, "") });
        // Auto poster (first frame) so every phone paints the right picture before the video starts.
        if (!item.imageUrl.trim()) {
          try {
            const poster = await posterFromFile(file);
            if (poster) {
              const { uploadToImgbb } = await import("@/lib/imgbbUpload");
              const imageUrl = await uploadToImgbb(new File([poster], "backdrop-poster.jpg", { type: "image/jpeg" }));
              if (imageUrl) patch(item.id, { imageUrl });
            }
          } catch { /* poster is optional */ }
        }
      }
      toast.success("Uploaded. Save the item to publish it.");
    } catch {
      toast.error("Upload failed. Try again.");
    } finally {
      setUploadingId(null);
    }
  };

  const save = async (item: DraftItem) => {
    if (!item.name.trim()) return toast.error("Give this item a name");
    const isVideo = kind === "backgrounds" && item.mediaType === "video";
    if (isVideo && !/^(https?:\/\/|rtdb:)/i.test(item.videoUrl.trim())) return toast.error("Upload a video or add a video URL (https://…)");
    if (!isVideo && kind === "backgrounds" && !item.imageUrl.trim()) return toast.error("Add the image URL");
    if (kind === "frames" && !item.imageUrl.trim() && item.effects.length === 0) return toast.error("Add frame artwork or pick at least one animation");
    setSavingId(item.id);
    try {
      const { isNew, draftKind, ...clean } = item;
      await saveProfileShopItem(kind, {
        ...clean,
        name: clean.name.trim(),
        imageUrl: clean.imageUrl.trim(),
        videoUrl: kind === "backgrounds" && clean.mediaType === "video" ? clean.videoUrl.trim() : "",
        mediaType: kind === "backgrounds" ? clean.mediaType : "image",
      });
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
              Frames: transparent PNG / WebP / GIF artwork plus live animations. Backdrops: a wide image or a looping video URL. Preview, set the price, then publish.
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
          No {kind} yet. Add one, then choose artwork from your gallery{kind === "backgrounds" ? " or paste a video URL" : ""}.
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
                  <div className={`profile-shop-admin-preview relative grid shrink-0 place-items-center rounded-md border border-border bg-muted/30 ${kind === "frames" ? "is-frame h-28 w-28 overflow-visible" : "h-20 w-28 overflow-hidden"}`}>
                    {kind === "frames" ? (
                      item.imageUrl || item.effects.length ? (
                        <span className="pf-admin-frame-stage" style={frameStyleVars(item)}>
                          <FrameBackLayers frame={item} />
                          <span className="pf-admin-photo" />
                          <FrameFrontLayers frame={item} />
                        </span>
                      ) : (
                        <ImageIcon size={20} className="text-muted-foreground" />
                      )
                    ) : (item.mediaType === "video" ? item.videoUrl : item.imageUrl) ? (
                      <BackdropMedia item={item} preview />
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
                      <span className={label}>{kind === "backgrounds" && item.mediaType === "video" ? "Poster image (optional)" : kind === "frames" ? "Artwork (PNG / WebP / GIF)" : "Gallery image"}</span>
                       <span className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-primary/60 bg-primary/5 px-3 text-center text-[12px] font-semibold text-primary hover:bg-primary/10">
                        {isUploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                        {isUploading ? "Uploading…" : "Choose from gallery"}
                      </span>
                      <input type="file" accept={kind === "frames" ? "image/png,image/webp,image/gif,image/apng" : "image/*"} className="hidden" disabled={isUploading} onChange={(event) => uploadImage(item, event)} />
                    </label>
                  </div>
                </div>

                {kind === "backgrounds" && (
                  <div className="grid grid-cols-2 gap-2">
                    {([["image", ImageIcon, "Image"], ["video", Film, "Looping video"]] as const).map(([type, Icon, text]) => (
                      <Button
                        key={type}
                        type="button"
                        variant={item.mediaType === type ? "default" : "outline"}
                        onClick={() => patch(item.id, { mediaType: type })}
                        className="h-9 min-w-0 px-2 text-[12px]"
                      >
                        <Icon size={13} /> {text}
                      </Button>
                    ))}
                  </div>
                )}

                {kind === "backgrounds" && item.mediaType === "video" && (
                  <div>
                    <label className="mb-2 block">
                      <span className={label}>Video / GIF from gallery (max 10MB)</span>
                      <span className="flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-primary bg-primary/10 px-3 text-center text-[13px] font-bold text-primary">
                        {isUploading ? <Loader2 size={15} className="animate-spin" /> : <Film size={15} />}
                        {isUploading ? "Uploading…" : item.videoUrl.startsWith("rtdb:") ? "Uploaded ✓ — tap to replace" : "Upload video or GIF"}
                      </span>
                      <input type="file" accept="video/mp4,video/webm,video/quicktime,video/*,image/gif" className="hidden" disabled={isUploading} onChange={(event) => uploadVideo(item, event)} />
                    </label>
                    <span className={label}>…or Video URL (MP4 / WebM)</span>
                    <input
                      className={field}
                      value={item.videoUrl.startsWith("rtdb:") ? "" : item.videoUrl}
                      placeholder={item.videoUrl.startsWith("rtdb:") ? "Using uploaded file" : "https://…/backdrop.mp4"}
                      onChange={(e) => patch(item.id, { videoUrl: e.target.value })}
                    />
                    <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">Plays muted and loops forever behind the profile. Any length works; short 5–20s clips load fastest. Use an https link.</p>
                  </div>
                )}

                <div>
                  <span className={label}>{kind === "backgrounds" && item.mediaType === "video" ? "Poster image URL (optional)" : "Image URL"}</span>
                  <input className={field} value={item.imageUrl} placeholder={kind === "frames" ? "Leave empty for an animated ring frame" : "Uploaded URL appears here"} onChange={(e) => patch(item.id, { imageUrl: e.target.value })} />
                </div>

                {kind === "frames" && (
                  <div className="rounded-md border border-border/60 bg-muted/20 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div>
                        <span className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground"><Sparkles size={13} className="text-primary" /> Animation</span>
                        <span className="text-[10px] text-muted-foreground">Mix any effects — the preview updates live</span>
                      </div>
                      <Button type="button" variant="outline" size="sm" className="h-8 text-[11px]" onClick={() => patch(item.id, { effects: [...DEFAULT_FRAME_EFFECTS], fxColor: "", fxSpeed: 1 })}>Reset</Button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {FRAME_EFFECTS.map((fx) => {
                        const on = item.effects.includes(fx.id);
                        return (
                          <button
                            key={fx.id}
                            type="button"
                            title={fx.hint}
                            aria-pressed={on}
                            onClick={() => patch(item.id, { effects: on ? item.effects.filter((e) => e !== fx.id) : [...item.effects, fx.id as FrameEffect] })}
                            className={`h-8 rounded-md border px-2.5 text-[11px] font-semibold transition-colors ${on ? "border-primary bg-primary/15 text-primary" : "border-border bg-background text-muted-foreground hover:text-foreground"}`}
                          >
                            {fx.name}
                          </button>
                        );
                      })}
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div>
                        <span className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground"><Palette size={12} /> Effect colour</span>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            aria-label="Effect colour"
                            className="h-9 w-12 shrink-0 cursor-pointer rounded-md border border-input bg-background p-1"
                            value={item.fxColor || "#ed4245"}
                            onChange={(e) => patch(item.id, { fxColor: e.target.value })}
                          />
                          <Button type="button" variant={item.fxColor ? "outline" : "default"} className="h-9 min-w-0 flex-1 px-2 text-[11px]" onClick={() => patch(item.id, { fxColor: "" })}>
                            Auto colour
                          </Button>
                        </div>
                      </div>
                      <label className="block text-[11px] text-muted-foreground">
                        <span className="mb-1 flex justify-between"><span>Speed</span><strong className="text-foreground">{item.fxSpeed.toFixed(1)}×</strong></span>
                        <input className="w-full accent-primary" type="range" min={0.5} max={2} step={0.1} value={item.fxSpeed} onChange={(e) => patch(item.id, { fxSpeed: Number(e.target.value) })} />
                      </label>
                    </div>
                  </div>
                )}

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
                      <Button type="button" variant="outline" size="sm" className="h-8 text-[11px]" onClick={() => patch(item.id, { scale: 126, offsetX: 0, offsetY: 0 })}>Reset</Button>
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
