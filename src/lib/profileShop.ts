import { db, onValue, ref, remove, runTransaction, update } from "@/lib/firebase";

export type ShopKind = "frames" | "backgrounds";

/** Live animation layers a frame can wear (combined freely). */
export const FRAME_EFFECTS = [
  { id: "aura", name: "Aura ring", hint: "Rotating light ring behind the frame" },
  { id: "shine", name: "Shine sweep", hint: "A light beam glides across the artwork" },
  { id: "glow", name: "Breathing glow", hint: "Soft glow that breathes in and out" },
  { id: "pulse", name: "Heartbeat", hint: "Frame gently scales like a heartbeat" },
  { id: "float", name: "Float", hint: "Frame hovers up and down" },
  { id: "spin", name: "Slow spin", hint: "Artwork rotates (best for round frames)" },
  { id: "sparkle", name: "Sparkles", hint: "Stars twinkle around the avatar" },
  { id: "orbit", name: "Orbit", hint: "Energy orbs circle the avatar" },
  { id: "embers", name: "Embers", hint: "Glowing particles rise from below" },
  { id: "ripple", name: "Ripple", hint: "Energy waves expand outward" },
] as const;

export type FrameEffect = (typeof FRAME_EFFECTS)[number]["id"];
const EFFECT_IDS = new Set<string>(FRAME_EFFECTS.map((e) => e.id));
/** Older frames saved before animations existed still come alive. */
export const DEFAULT_FRAME_EFFECTS: FrameEffect[] = ["aura", "shine", "glow"];

export type BackdropMediaType = "image" | "video";

export const looksLikeVideoUrl = (url: string) => /\.(mp4|webm|mov|m4v|ogv)(?:[?#]|$)/i.test(String(url || "").trim());

export type ShopItem = {
  id: string;
  name: string;
  /** Frame artwork, or the backdrop image / video poster. */
  imageUrl: string;
  /** Backdrops only: "video" plays `videoUrl` on a seamless loop. */
  mediaType: BackdropMediaType;
  videoUrl: string;
  /** Frames only: animation layers, accent colour ("" = theme colour), speed multiplier. */
  effects: FrameEffect[];
  fxColor: string;
  fxSpeed: number;
  price: number;
  free: boolean;
  enabled: boolean;
  tier: string;
  order: number;
  scale: number;
  offsetX: number;
  offsetY: number;
};

export type ProfileShop = {
  frames: ShopItem[];
  backgrounds: ShopItem[];
};

export const EMPTY_SHOP: ProfileShop = { frames: [], backgrounds: [] };

const SHOP_PATH = "settings/profileShop";

const normalizeEffects = (raw: any): FrameEffect[] => {
  if (raw === undefined || raw === null) return [...DEFAULT_FRAME_EFFECTS];
  // Stored as "aura,shine" ("none" = deliberately no effects; Firebase drops empty arrays).
  const list = typeof raw === "string" ? raw.split(",") : Array.isArray(raw) ? raw : typeof raw === "object" ? Object.values(raw) : [];
  return list.map((v: any) => String(v).trim()).filter((id) => EFFECT_IDS.has(id)) as FrameEffect[];
};

const normalizeColor = (raw: any) => {
  const value = String(raw || "").trim();
  return /^#[0-9a-f]{6}$/i.test(value) ? value : "";
};

export const normalizeItem = (id: string, raw: any): ShopItem => {
  const videoUrl = String(raw?.videoUrl || "").trim();
  const imageUrl = String(raw?.imageUrl || "").trim();
  const mediaType: BackdropMediaType = raw?.mediaType === "video" || (!raw?.mediaType && (videoUrl || looksLikeVideoUrl(imageUrl))) ? "video" : "image";
  return {
  id,
  name: String(raw?.name || id),
  imageUrl: mediaType === "video" && !videoUrl && looksLikeVideoUrl(imageUrl) ? "" : imageUrl,
  mediaType,
  videoUrl: videoUrl || (mediaType === "video" && looksLikeVideoUrl(imageUrl) ? imageUrl : ""),
  effects: normalizeEffects(raw?.effects),
  fxColor: normalizeColor(raw?.fxColor),
  fxSpeed: Math.min(2, Math.max(0.5, Number(raw?.fxSpeed || 1))),
  price: Math.max(0, Number(raw?.price || 0)),
  free: raw?.free === true || Number(raw?.price || 0) <= 0,
  enabled: raw?.enabled !== false,
  tier: String(raw?.tier || "Custom"),
  order: Number(raw?.order || 0),
  scale: Math.min(180, Math.max(80, Number(raw?.scale || 126))),
  offsetX: Math.min(30, Math.max(-30, Number(raw?.offsetX || 0))),
  offsetY: Math.min(30, Math.max(-30, Number(raw?.offsetY || 0))),
  };
};

const parseList = (raw: any): ShopItem[] =>
  Object.entries(raw || {})
    .map(([id, value]) => normalizeItem(id, value))
    .sort((a, b) => a.order - b.order || a.price - b.price || a.name.localeCompare(b.name));

export const subscribeProfileShop = (cb: (shop: ProfileShop) => void) => {
  const unsubscribe = onValue(ref(db, SHOP_PATH), (snap) => {
    const raw = snap.val() || {};
    cb({ frames: parseList(raw.frames), backgrounds: parseList(raw.backgrounds) });
  });
  return () => unsubscribe();
};

export const saveProfileShopItem = async (kind: ShopKind, item: ShopItem) => {
  const { id, ...rest } = item;
  await update(ref(db, `${SHOP_PATH}/${kind}/${id}`), {
    ...rest,
    effects: rest.effects.length ? rest.effects.join(",") : "none",
    price: rest.free ? 0 : Math.max(0, Number(rest.price || 0)),
    updatedAt: Date.now(),
  });
};

export const deleteProfileShopItem = async (kind: ShopKind, id: string) => {
  await remove(ref(db, `${SHOP_PATH}/${kind}/${id}`));
};

export const makeShopItemId = (name: string) =>
  `${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 28) || "item"}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;

export type PurchaseResult = { ok: true; coins: number } | { ok: false; reason: "insufficient" };

const ownedKey = (kind: ShopKind) => (kind === "frames" ? "ownedFrames" : "ownedBackgrounds");
const selectedKey = (kind: ShopKind) => (kind === "frames" ? "frameId" : "backgroundId");

/**
 * Equips a shop item, buying it with coins first when it is not free/owned.
 * Wallet deduction and ownership are written in one atomic transaction.
 */
export const equipOrBuyShopItem = async (
  uid: string,
  kind: ShopKind,
  item: ShopItem,
  opts: { isPremium: boolean },
): Promise<PurchaseResult> => {
  let result: PurchaseResult = { ok: false, reason: "insufficient" };
  await runTransaction(ref(db, `users/${uid}`), (current: any) => {
    const user = current || {};
    const customization = user.profileCustomization || {};
    const owned = customization[ownedKey(kind)] || {};
    const wallet = user.coinWallet || { coins: 0 };
    const coins = Math.max(0, Number(wallet.coins || 0));
    const freeForUser = item.free || opts.isPremium || owned[item.id] === true;

    if (freeForUser) {
      result = { ok: true, coins };
      return {
        ...user,
        profileCustomization: {
          ...customization,
          [selectedKey(kind)]: item.id,
          [ownedKey(kind)]: { ...owned, [item.id]: true },
        },
      };
    }

    if (coins < item.price) return current;
    result = { ok: true, coins: coins - item.price };
    return {
      ...user,
      coinWallet: { ...wallet, coins: coins - item.price },
      profileCustomization: {
        ...customization,
        [selectedKey(kind)]: item.id,
        [ownedKey(kind)]: { ...owned, [item.id]: true },
      },
    };
  });
  return result;
};
