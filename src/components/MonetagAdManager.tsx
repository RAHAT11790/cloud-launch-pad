import { useEffect } from "react";
import { loadPopunderOnce } from "@/lib/monetagAds";

/**
 * Mount this only inside the video player route.
 * Loads Monetag popunder ONCE per session — multiple mounts are safe.
 */
const MonetagAdManager = () => {
  useEffect(() => {
    // Defer one tick so the player UI paints first
    const t = window.setTimeout(() => { loadPopunderOnce(); }, 200);
    return () => window.clearTimeout(t);
  }, []);
  return null;
};

export default MonetagAdManager;
