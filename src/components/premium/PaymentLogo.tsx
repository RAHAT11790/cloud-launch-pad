import { useEffect, useState } from "react";

const opaqueLogos = new Map<string, string>();

/** Bake the white surface into the image, not just CSS, for phone forced-dark modes. */
export function PaymentLogo({ src, alt = "", className = "" }: { src: string; alt?: string; className?: string }) {
  const [image, setImage] = useState(() => opaqueLogos.get(src) || src);
  useEffect(() => {
    setImage(opaqueLogos.get(src) || src);
    if (!src || opaqueLogos.has(src)) return;
    let cancelled = false;
    const original = new Image();
    original.crossOrigin = "anonymous";
    original.onload = () => {
      if (cancelled || !original.naturalWidth || !original.naturalHeight) return;
      try {
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, 512 / Math.max(original.naturalWidth, original.naturalHeight));
        canvas.width = Math.max(1, Math.round(original.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(original.naturalHeight * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(original, 0, 0, canvas.width, canvas.height);
        const opaque = canvas.toDataURL("image/png");
        opaqueLogos.set(src, opaque);
        setImage(opaque);
      } catch { /* CORS-only external logos retain the white CSS surface. */ }
    };
    original.src = src;
    return () => { cancelled = true; };
  }, [src]);
  return <img src={image} alt={alt} className={`payment-logo-image ${className}`} />;
}