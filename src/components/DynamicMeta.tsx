import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useBranding } from "@/hooks/useBranding";
import { SITE_URL } from "@/lib/siteConfig";

/** Updates OG/meta tags dynamically from Firebase branding config */
const DynamicMeta = () => {
  const branding = useBranding();
  const location = useLocation();

  useEffect(() => {
    const siteName = branding.siteName || "RS Anime 03";
    const siteDescription = branding.siteDescription || "RS Anime 03 is an anime streaming platform where you can discover anime series, movies, donghua and cartoons with HD video, Hindi dubbed, English subtitles and multiple audio options.";
    const fullTitle = siteName + " - Watch Anime Online in HD";
    const logoUrl = String((branding as any)?.logoUrl || (branding as any)?.logo || "");

    // Title
    document.title = fullTitle;

    // Helper to update or create meta tag
    const setMeta = (attr: string, key: string, content: string) => {
      if (!content) return;
      let el = document.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement | null;
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute(attr, key);
        document.head.appendChild(el);
      }
      el.setAttribute("content", content);
    };

    // Description & Author
    setMeta("name", "description", siteDescription);
    setMeta("name", "author", siteName);

    // OG tags
    setMeta("property", "og:title", fullTitle);
    setMeta("property", "og:description", siteDescription);
    setMeta("property", "og:image", logoUrl || "https://i.ibb.co.com/gLc93Bc3/android-chrome-512x512.png");
    setMeta("property", "og:url", SITE_URL + location.pathname);

    // Twitter tags
    setMeta("name", "twitter:title", fullTitle);
    setMeta("name", "twitter:description", siteDescription);
    setMeta("name", "twitter:image", logoUrl || "https://i.ibb.co.com/gLc93Bc3/android-chrome-512x512.png");

    // Canonical
    let canonical = document.querySelector("link[rel=\"canonical\"]") as HTMLLinkElement | null;
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.setAttribute("rel", "canonical");
      document.head.appendChild(canonical);
    }
    canonical.setAttribute("href", SITE_URL + (location.pathname === "/" ? "" : location.pathname));

  }, [branding, location]);

  return null;
};

export default DynamicMeta;
