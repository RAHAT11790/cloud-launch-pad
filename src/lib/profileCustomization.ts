import { db, get, onValue, ref, runTransaction, update } from "@/lib/firebase";

export type ProfileFrame = {
  id: string;
  name: string;
  price: number;
  tier: "Starter" | "Rare" | "Epic" | "Legendary";
  effect: string;
};

export type ProfileTheme = {
  id: string;
  name: string;
  className: string;
};

export type ProfileCustomization = {
  frameId: string;
  themeId: string;
  fontId: string;
  backgroundId: string;
  ownedFrames: Record<string, boolean>;
  ownedBackgrounds: Record<string, boolean>;
};

export const PROFILE_FRAMES: ProfileFrame[] = [
  { id: "ember", name: "Ember Ring", price: 5, tier: "Starter", effect: "ember" },
  { id: "pulse", name: "Crimson Pulse", price: 7, tier: "Starter", effect: "pulse" },
  { id: "shuriken", name: "Shuriken", price: 9, tier: "Starter", effect: "shuriken" },
  { id: "sakura", name: "Sakura Drift", price: 10, tier: "Starter", effect: "sakura" },
  { id: "thunder", name: "Thunder Arc", price: 12, tier: "Rare", effect: "thunder" },
  { id: "water", name: "Water Halo", price: 14, tier: "Rare", effect: "water" },
  { id: "mecha", name: "Mecha Core", price: 16, tier: "Rare", effect: "mecha" },
  { id: "spirit", name: "Spirit Flame", price: 18, tier: "Rare", effect: "spirit" },
  { id: "chakra", name: "Chakra Orbit", price: 20, tier: "Rare", effect: "chakra" },
  { id: "glitch", name: "Glitch Rift", price: 22, tier: "Epic", effect: "glitch" },
  { id: "eclipse", name: "Solar Eclipse", price: 25, tier: "Epic", effect: "eclipse" },
  { id: "dragon", name: "Dragon Breath", price: 27, tier: "Epic", effect: "dragon" },
  { id: "frost", name: "Frost Crown", price: 29, tier: "Epic", effect: "frost" },
  { id: "void", name: "Void Portal", price: 31, tier: "Epic", effect: "void" },
  { id: "phoenix", name: "Phoenix Rise", price: 34, tier: "Epic", effect: "phoenix" },
  { id: "celestial", name: "Celestial", price: 37, tier: "Legendary", effect: "celestial" },
  { id: "bloodmoon", name: "Blood Moon", price: 40, tier: "Legendary", effect: "bloodmoon" },
  { id: "hologram", name: "Holo Legend", price: 43, tier: "Legendary", effect: "hologram" },
  { id: "infinity", name: "Infinity Crown", price: 47, tier: "Legendary", effect: "infinity" },
  { id: "sovereign", name: "Anime Sovereign", price: 50, tier: "Legendary", effect: "sovereign" },
];

export const PROFILE_THEMES: ProfileTheme[] = [
  { id: "crimson", name: "Crimson District", className: "profile-theme-crimson" },
  { id: "akatsuki", name: "Scarlet Cloud", className: "profile-theme-akatsuki" },
  { id: "gold", name: "Shogun Gold", className: "profile-theme-gold" },
  { id: "ice", name: "Frost Reign", className: "profile-theme-ice" },
  { id: "violet", name: "Cursed Violet", className: "profile-theme-violet" },
  { id: "emerald", name: "Spirit Forest", className: "profile-theme-emerald" },
  { id: "mono", name: "Manga Noir", className: "profile-theme-mono" },
  { id: "sunset", name: "Tokyo Sunset", className: "profile-theme-sunset" },
];

export const PROFILE_FONTS = [
  { id: "sora", name: "Classic Bold", className: "profile-font-sora" },
  { id: "orbitron", name: "Orbitron", className: "profile-font-orbitron" },
  { id: "audiowide", name: "Audiowide", className: "profile-font-audiowide" },
  { id: "rajdhani", name: "Rajdhani", className: "profile-font-rajdhani" },
  { id: "bebas", name: "Bebas Neue", className: "profile-font-bebas" },
  { id: "bungee", name: "Bungee", className: "profile-font-bungee" },
  { id: "anton", name: "Anton Impact", className: "profile-font-anton" },
  { id: "kanit", name: "Kanit Sharp", className: "profile-font-kanit" },
  { id: "teko", name: "Teko Tall", className: "profile-font-teko" },
  { id: "gold", name: "Gold Legend", className: "profile-font-gold" },
  { id: "gradient", name: "Aurora Gradient", className: "profile-font-gradient" },
  { id: "neon", name: "Neon Nights", className: "profile-font-neon" },
  { id: "outline", name: "Outline Pro", className: "profile-font-outline" },
  { id: "glow", name: "Soft Glow", className: "profile-font-glow" },
  { id: "fire", name: "Fire Blaze", className: "profile-font-fire" },
  { id: "ice", name: "Ice Crystal", className: "profile-font-ice" },
  { id: "rainbow", name: "Rainbow Pop", className: "profile-font-rainbow" },
  { id: "retro", name: "Retro Pixel", className: "profile-font-retro" },
  { id: "marker", name: "Marker Ink", className: "profile-font-marker" },
  { id: "shadow", name: "Deep Shadow", className: "profile-font-shadow" },
] as const;


export const DEFAULT_PROFILE_CUSTOMIZATION: ProfileCustomization = {
  frameId: "ember",
  themeId: "crimson",
  fontId: "sora",
  backgroundId: "",
  ownedFrames: { ember: true },
  ownedBackgrounds: {},
};

const cleanCustomization = (raw: Partial<ProfileCustomization> | null): ProfileCustomization => ({
  ...DEFAULT_PROFILE_CUSTOMIZATION,
  ...(raw || {}),
  ownedFrames: { ...DEFAULT_PROFILE_CUSTOMIZATION.ownedFrames, ...(raw?.ownedFrames || {}) },
  ownedBackgrounds: { ...(raw?.ownedBackgrounds || {}) },
});

export const subscribeProfileCustomization = (uid: string, cb: (value: ProfileCustomization) => void) => {
  const unsubscribe = onValue(ref(db, `users/${uid}/profileCustomization`), (snap) => cb(cleanCustomization(snap.val())));
  return () => unsubscribe();
};

export const saveProfileStyle = async (
  uid: string,
  patch: Partial<Pick<ProfileCustomization, "frameId" | "themeId" | "fontId" | "backgroundId">>,
) => {
  await update(ref(db, `users/${uid}/profileCustomization`), patch);
};

export type BuyFrameResult = { ok: true; coins: number } | { ok: false; reason: "insufficient" | "missing" };

export const buyProfileFrame = async (uid: string, frameId: string): Promise<BuyFrameResult> => {
  const frame = PROFILE_FRAMES.find((item) => item.id === frameId);
  if (!frame) return { ok: false, reason: "missing" };
  let result: BuyFrameResult = { ok: false, reason: "insufficient" };
  await runTransaction(ref(db, `users/${uid}`), (current: any) => {
    const user = current || {};
    const customization = user.profileCustomization || {};
    const ownedFrames = customization.ownedFrames || {};
    const wallet = user.coinWallet || { coins: 0, adWatchLog: {} };
    const coins = Math.max(0, Number(wallet.coins || 0));
    if (ownedFrames[frameId] === true) {
      result = { ok: true, coins };
      return {
        ...user,
        profileCustomization: { ...customization, frameId },
      };
    }
    if (coins < frame.price) return current;
    result = { ok: true, coins: coins - frame.price };
    return {
      ...user,
      coinWallet: { ...wallet, coins: coins - frame.price },
      profileCustomization: {
        ...customization,
        frameId,
        ownedFrames: { ...ownedFrames, [frameId]: true },
      },
    };
  });
  return result;
};
