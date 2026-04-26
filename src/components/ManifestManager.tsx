import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useBranding } from "@/hooks/useBranding";

const DEFAULT_THEME = "#0a0b14";

const toAbsoluteUrl = (value: string) => {
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (typeof window === "undefined") return value;
  if (value.startsWith("/")) return `${window.location.origin}${value}`;
  return `${window.location.origin}/${value.replace(/^\/+/, "")}`;
};

const upsertMeta = (selector: string, attrs: Record<string, string>) => {
  let el = document.head.querySelector(selector) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement("meta");
    document.head.appendChild(el);
  }

  Object.entries(attrs).forEach(([key, value]) => {
    el!.setAttribute(key, value);
  });
};

export default function ManifestManager() {
  const branding = useBranding();
  const location = useLocation();

  useEffect(() => {
    const isAdminRoute = location.pathname.startsWith("/admin");
    const appName = isAdminRoute ? `${branding.siteName} Admin` : branding.siteName;
    const iconUrl = toAbsoluteUrl(branding.logoUrl) || "/android-chrome-512x512.png";
    const startUrl = isAdminRoute ? "/admin?source=homescreen" : "/?source=homescreen";
    const scope = isAdminRoute ? "/admin" : "/";
    const manifest = {
      id: isAdminRoute ? "/install/admin-panel" : "/install/user-panel",
      name: appName,
      short_name: appName,
      description: isAdminRoute
        ? `${branding.siteName} admin panel`
        : branding.siteDescription,
      start_url: startUrl,
      scope,
      display: "standalone",
      orientation: "portrait",
      background_color: DEFAULT_THEME,
      theme_color: DEFAULT_THEME,
      prefer_related_applications: false,
      icons: [
        {
          src: iconUrl,
          sizes: "192x192",
          type: "image/png",
          purpose: "any maskable",
        },
        {
          src: iconUrl,
          sizes: "512x512",
          type: "image/png",
          purpose: "any maskable",
        },
      ],
    };

    const blob = new Blob([JSON.stringify(manifest)], {
      type: "application/manifest+json",
    });
    const manifestUrl = URL.createObjectURL(blob);

    let link = document.head.querySelector('link[rel="manifest"]') as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.rel = "manifest";
      document.head.appendChild(link);
    }
    link.href = manifestUrl;

    upsertMeta('meta[name="apple-mobile-web-app-title"]', {
      name: "apple-mobile-web-app-title",
      content: appName,
    });
    upsertMeta('meta[name="mobile-web-app-capable"]', {
      name: "mobile-web-app-capable",
      content: "yes",
    });

    return () => {
      URL.revokeObjectURL(manifestUrl);
    };
  }, [branding.logoUrl, branding.siteDescription, branding.siteName, location.pathname]);

  return null;
}