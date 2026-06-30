// ============================================
// Dynamic Branding Hook - Firebase থেকে সব নাম/লোগো লোড
// ============================================
import { useState, useEffect } from "react";
import { db, ref, onValue } from "@/lib/firebase";

const BRANDING_CACHE_KEY = "rs_branding_cache_v1";

export interface BrandingConfig {
  siteName: string;
  siteDescription: string;
  siteTagline: string;
  loginTitle: string;
  loginSubtitle: string;
  premiumTitle: string;
  footerText: string;
  footerCopyright: string;
  splashText: string;
  
  adminTitle: string;
  aboutTitle: string;
  logoUrl: string;           // Default logo (header, splash, etc.)
  splashBgUrl?: string;      // Deprecated — splash no longer renders a background image
  playerLogoUrl: string;     // (legacy) Video player loading logo
  playerName: string;        // Video player title (e.g. "RS ANIME PLAYER")
  rsCardLabel: string;       // RS source card label
  anCardLabel: string;       // AnimeSalt source card label
}

const DEFAULT_BRANDING: BrandingConfig = {
  siteName: "",
  siteDescription: "",
  siteTagline: "",
  loginTitle: "",
  loginSubtitle: "",
  premiumTitle: "",
  footerText: "",
  footerCopyright: "",
  splashText: "",
  
  adminTitle: "",
  aboutTitle: "",
  logoUrl: "",
  playerLogoUrl: "",
  playerName: "",
  rsCardLabel: "RS",
  anCardLabel: "AN",
};

let cachedBranding: BrandingConfig | null = null;
const listeners = new Set<(b: BrandingConfig) => void>();

function readBrandingCache(): BrandingConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(BRANDING_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_BRANDING, ...(parsed || {}) };
  } catch {
    return null;
  }
}

function writeBrandingCache(value: BrandingConfig) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(BRANDING_CACHE_KEY, JSON.stringify(value));
  } catch {
    // ignore storage failures
  }
}

if (!cachedBranding) {
  cachedBranding = readBrandingCache();
}

// Initialize listener once
let initialized = false;
function initBrandingListener() {
  if (initialized) return;
  initialized = true;
  onValue(ref(db, "settings/branding"), (snap) => {
    const val = snap.val();
    cachedBranding = val ? { ...DEFAULT_BRANDING, ...val } : { ...DEFAULT_BRANDING };
    writeBrandingCache(cachedBranding);
    listeners.forEach(fn => fn(cachedBranding!));
  });
}

export function useBranding(): BrandingConfig {
  const [branding, setBranding] = useState<BrandingConfig>(cachedBranding || DEFAULT_BRANDING);

  useEffect(() => {
    initBrandingListener();
    if (cachedBranding) setBranding(cachedBranding);
    
    const listener = (b: BrandingConfig) => setBranding(b);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  return branding;
}

export function getBrandingSync(): BrandingConfig {
  return cachedBranding || DEFAULT_BRANDING;
}

export { DEFAULT_BRANDING };
