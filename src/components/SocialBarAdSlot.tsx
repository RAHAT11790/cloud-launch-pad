import { useEffect, useRef, useState } from "react";
import { Megaphone, ShieldAlert } from "lucide-react";
import { getAdsterraConfig, subscribeAdsterraConfig, type AdsterraConfig } from "@/lib/adsterraAds";
import { logAdEvent } from "@/lib/adEngagement";

interface Props {
  isPremium?: boolean | null;
  className?: string;
}

/**
 * Inline sponsor display placed directly under the player's like/share row.
 * Hosts the Adsterra Social Bar snippet (notification / video / multi-ad unit)
 * in-flow instead of as a floating overlay, so it is visible, non-intrusive
 * and actually viewable — which is what drives counted clicks.
 */
const SocialBarAdSlot = ({ isPremium, className = "" }: Props) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [cfg, setCfg] = useState<AdsterraConfig | null>(null);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    let alive = true;
    getAdsterraConfig().then((c) => { if (alive) setCfg(c); }).catch(() => {});
    const un = subscribeAdsterraConfig((c) => setCfg(c));
    return () => { alive = false; try { un(); } catch {} };
  }, []);

  useEffect(() => {
    if (isPremium) return;
    const host = hostRef.current;
    const snippet = String(cfg?.streamLink || "").trim();
    if (!host || !cfg?.enabled || !snippet) return;

    host.innerHTML = "";
    setBlocked(false);

    if (/^https?:\/\//i.test(snippet) && !snippet.includes("<")) {
      // A plain smartlink — render it as a tappable sponsor strip.
      const a = document.createElement("a");
      a.href = snippet;
      a.target = "_blank";
      a.rel = "noopener sponsored";
      a.textContent = "Open sponsor offer";
      a.className = "block w-full text-center py-3 text-[12px] font-semibold text-primary";
      host.appendChild(a);
      return;
    }

    const tmp = document.createElement("div");
    tmp.innerHTML = snippet;
    let failures = 0;
    let scripts = 0;
    Array.from(tmp.childNodes).forEach((node) => {
      if (node.nodeType === 1 && (node as Element).tagName === "SCRIPT") {
        const old = node as HTMLScriptElement;
        const s = document.createElement("script");
        Array.from(old.attributes).forEach((a) => s.setAttribute(a.name, a.value));
        if (old.textContent) s.textContent = old.textContent;
        if (s.src) {
          s.async = true;
          scripts += 1;
          s.addEventListener("error", () => {
            failures += 1;
            if (failures >= scripts) { setBlocked(true); logAdEvent("social-bar", "blocked"); }
          });
        }
        host.appendChild(s);
      } else {
        host.appendChild(node);
      }
    });

    logAdEvent("social-bar", "mounted");
    const t = window.setTimeout(() => {
      if (!host.querySelector("iframe, img, a, canvas")) {
        setBlocked(true);
        logAdEvent("social-bar", "empty");
      }
    }, 6000);

    return () => { window.clearTimeout(t); try { host.innerHTML = ""; } catch {} };
  }, [cfg, isPremium]);

  if (isPremium) return null;
  if (!cfg?.enabled || !String(cfg?.streamLink || "").trim()) return null;

  return (
    <section
      aria-label="Sponsored"
      className={`rounded-2xl border border-border bg-foreground/[0.04] overflow-hidden ${className}`}
    >
      <header className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border/70">
        <Megaphone className="w-3 h-3 text-primary" strokeWidth={2.2} />
        <span className="text-[10px] font-semibold tracking-wide uppercase text-muted-foreground">
          Sponsored — keeps RS Anime free
        </span>
      </header>

      <div ref={hostRef} className="min-h-[78px] flex items-center justify-center px-2 py-2 [&_iframe]:max-w-full" />

      {blocked && (
        <div className="flex items-start gap-2 px-3 pb-3 pt-0 text-[11px] text-muted-foreground">
          <ShieldAlert className="w-3.5 h-3.5 text-destructive mt-0.5 flex-shrink-0" />
          <p>
            Sponsor blocked by an ad blocker or VPN DNS. Please allow ads for this site — it is the only
            way we keep streaming and downloads free.
          </p>
        </div>
      )}
    </section>
  );
};

export default SocialBarAdSlot;
