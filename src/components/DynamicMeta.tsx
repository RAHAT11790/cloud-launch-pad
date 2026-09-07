import { useEffect } from "react";
import { useBranding } from "@/hooks/useBranding";
import { SITE_URL } from "@/lib/siteConfig";

/** Updates OG/meta tags dynamically from Firebase branding config */
const DynamicMeta = () => {
  const branding = useBranding();

  useEffect(() => {
    const logoUrl = branding.logoUrl || "";

    // Title
    document.title = branding.siteName || "RS Anime 03 - Watch Anime Online in HD";

    // Helper to update or create meta tag
    const setMeta = (attr: string, key: string, content: string) => {
      let el = document.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement | null;
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute(attr, key);
        document.head.appendChild(el);
      }
      el.setAttribute("content", content);
    };

    // Description
    setMeta("name", "description", branding.siteDescription || "RS Anime 03 is an anime streaming platform where you can discover anime series, movies, donghua and cartoons with HD video, Hindi dubbed, English subtitles and multiple audio options.");
    setMeta("name", "author", branding.siteName || "RS Anime 03");

    // OG tags
    setMeta("property", "og:title", branding.siteName);
    setMeta("property", "og:description", branding.siteDescription);
    setMeta("property", "og:image", logoUrl);
    setMeta("property", "og:url", SITE_URL);

    // Twitter tags
    setMeta("name", "twitter:title", branding.siteName);
    setMeta("name", "twitter:description", branding.siteDescription);
    setMeta("name", "twitter:image", logoUrl);

    // Favicon
    const favicon = document.querySelector('link[rel="icon"]') as HTMLLinkElement | null;
    if (favicon) favicon.href = logoUrl;
    const appleTouchIcon = document.querySelector('link[rel="apple-touch-icon"]') as HTMLLinkElement | null;
    if (appleTouchIcon) appleTouchIcon.href = logoUrl;
  }, [branding]);

  return null;
};

export default DynamicMeta;
