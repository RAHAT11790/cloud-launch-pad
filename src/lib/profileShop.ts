import { db, onValue, ref, remove, runTransaction, update } from "@/lib/firebase";

export type ShopKind = "frames" | "backgrounds";

export type ShopItem = {
  id: string;
  name: string;
  imageUrl: string;
  price: number;
  free: boolean;
  enabled: boolean;
  tier: string;
  order: number;
};

export type ProfileShop = {
  frames: ShopItem[];
  backgrounds: ShopItem[];
};

export const EMPTY_SHOP: ProfileShop = { frames: [], backgrounds: [] };

const SHOP_PATH = "settings/profileShop";

const normalizeItem = (id: string, raw: any): ShopItem => ({
  id,
  name: String(raw?.name || id),
  imageUrl: String(raw?.imageUrl || "").trim(),
  price: Math.max(0, Number(raw?.price || 0)),
  free: raw?.free === true || Number(raw?.price || 0) <= 0,
  enabled: raw?.enabled !== false,
  tier: String(raw?.tier || "Custom"),
  order: Number(raw?.order || 0),
});

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
