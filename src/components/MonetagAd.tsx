import { useEffect, useId } from "react";
import { renderPlacementAd, type MonetagPlacement } from "@/lib/monetagAds";

interface MonetagAdProps {
  placement: MonetagPlacement;
  className?: string;
}

/**
 * Drop-in placement container. Renders Monetag banner/in-page-push/vignette
 * configured for this placement. Premium users see an empty (zero-height) div.
 */
const MonetagAd = ({ placement, className }: MonetagAdProps) => {
  const reactId = useId();
  const containerId = `monetag-${placement}-${reactId.replace(/:/g, "")}`;

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      if (!cancelled) renderPlacementAd(placement, containerId);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [placement, containerId]);

  return <div id={containerId} className={className} data-monetag-placement={placement} />;
};

export default MonetagAd;
