// ============================================
// Dynamic Branding Hook - Firebase থেকে সব নাম/লোগো লোড
// ============================================
import { useState, useEffect } from "react";
import { db, ref, onValue } from "@/lib/firebase";

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
  playerLogoUrl: string;     // Video player loading logo
}

const DEFAULT_BRANDING: BrandingConfig = {
  siteName: "RS ANIME",
  siteDescription: "Your ultimate destination for watching anime series and movies.",
  siteTagline: "Premium Anime Streaming",
  loginTitle: "RS ANIME",
  loginSubtitle: "Premium Anime Streaming",
  premiumTitle: "RS ANIME Premium",
  footerText: "Unlimited Anime Series & Movies",
  footerCopyright: "© 2026 RS ANIME. All rights reserved.",
  splashText: "RS ANIME",
  adminTitle: "RS ANIME Admin",
  aboutTitle: "About RS ANIME",
  logoUrl: "",
  playerLogoUrl: "",
};

let cachedBranding: BrandingConfig | null = null;
const listeners = new Set<(b: BrandingConfig) => void>();

// Initialize listener once
let initialized = false;
function initBrandingListener() {
  if (initialized) return;
  initialized = true;
  onValue(ref(db, "settings/branding"), (snap) => {
    const val = snap.val();
    cachedBranding = val ? { ...DEFAULT_BRANDING, ...val } : { ...DEFAULT_BRANDING };
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
