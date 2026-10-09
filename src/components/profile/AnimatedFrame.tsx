import { forwardRef, useCallback, useEffect, useState, type CSSProperties, type ForwardedRef } from "react";

/* ---------- Performance: pause effects that are off screen, lite mode on low-RAM phones ---------- */
if (typeof window !== "undefined") {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const lowRam = typeof nav.deviceMemory === "number" && nav.deviceMemory <= 2;
  const fewCores = typeof nav.hardwareConcurrency === "number" && nav.hardwareConcurrency <= 4 && lowRam;
  if (lowRam || fewCores) document.documentElement.classList.add("pf-lite");
}

let sharedObserver: IntersectionObserver | null = null;
const getObserver = () => {
  if (sharedObserver || typeof IntersectionObserver === "undefined") return sharedObserver;
  sharedObserver = new IntersectionObserver((entries) => {
    for (const e of entries) (e.target as HTMLElement).classList.toggle("pf-off", !e.isIntersecting);
  }, { rootMargin: "80px" });
  return sharedObserver;
};

/** Callback ref: forwards the node and pauses its CSS animations while it is off screen. */
const usePauseOffscreen = (forwarded: ForwardedRef<HTMLSpanElement>) => useCallback((node: HTMLSpanElement | null) => {
  if (typeof forwarded === "function") forwarded(node);
  else if (forwarded) forwarded.current = node;
  const io = getObserver();
  if (!io || !node) return;
  io.observe(node);
}, [forwarded]);
import type { FrameEffect, ShopItem } from "@/lib/profileShop";

/**
 * Animated profile frame: the admin's artwork (PNG / WebP / GIF / APNG) plus
 * stackable live effect layers. Everything here is pure CSS animation on
 * transform / opacity, so it stays smooth on low-end phones.
 *
 * Render it inside a positioned square box (the avatar or a shop preview);
 * the avatar photo sits between the back and front layers.
 */

type FrameLike = Pick<ShopItem, "imageUrl" | "effects" | "fxColor" | "fxSpeed" | "scale" | "offsetX" | "offsetY">;

export const frameStyleVars = (frame?: FrameLike | null): CSSProperties | undefined => {
  if (!frame) return undefined;
  return {
    "--frame-scale": `${frame.scale}%`,
    "--frame-x": `${frame.offsetX}px`,
    "--frame-y": `${frame.offsetY}px`,
    "--fx-speed": String(frame.fxSpeed || 1),
    ...(frame.fxColor ? { "--fx-color": frame.fxColor } : {}),
  } as CSSProperties;
};

const SPARKLES = [
  { a: -62, d: 0 },
  { a: 18, d: 0.7 },
  { a: 96, d: 1.4 },
  { a: 160, d: 0.35 },
  { a: 214, d: 1.05 },
  { a: 288, d: 1.75 },
];

const EMBERS = [
  { x: 18, d: 0, s: 1 },
  { x: 32, d: 0.9, s: 0.7 },
  { x: 46, d: 1.7, s: 1.15 },
  { x: 58, d: 0.4, s: 0.8 },
  { x: 70, d: 1.25, s: 1 },
  { x: 82, d: 2.1, s: 0.75 },
  { x: 40, d: 2.6, s: 0.9 },
  { x: 64, d: 3.1, s: 0.65 },
];

/* ---------- Auto effect colour, sampled from the artwork itself ---------- */
const colorCache = new Map<string, string>();
const colorPending = new Map<string, Promise<string>>();

const sampleArtworkColor = (url: string): Promise<string> => {
  if (colorCache.has(url)) return Promise.resolve(colorCache.get(url)!);
  if (colorPending.has(url)) return colorPending.get(url)!;
  const job = new Promise<string>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => {
      try {
        const size = 40;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return resolve("");
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;
        // 12 hue buckets, weighted by saturation x opacity — the frame's signature colour wins.
        const buckets = Array.from({ length: 12 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
        for (let i = 0; i < data.length; i += 4) {
          const a = data[i + 3] / 255;
          if (a < 0.5) continue;
          const r = data[i], g = data[i + 1], b = data[i + 2];
          const max = Math.max(r, g, b), min = Math.min(r, g, b);
          const sat = max === 0 ? 0 : (max - min) / max;
          if (sat < 0.28 || max < 60) continue;
          let h = 0;
          const d = max - min;
          if (max === r) h = ((g - b) / d) % 6;
          else if (max === g) h = (b - r) / d + 2;
          else h = (r - g) / d + 4;
          const idx = Math.floor((((h * 60) + 360) % 360) / 30);
          const w = sat * a * (max / 255);
          const bk = buckets[idx];
          bk.w += w; bk.r += r * w; bk.g += g * w; bk.b += b * w;
        }
        const best = buckets.reduce((x, y) => (y.w > x.w ? y : x));
        if (best.w < 2) return resolve("");
        const hex = (v: number) => Math.round(Math.min(255, v)).toString(16).padStart(2, "0");
        let r = best.r / best.w, g = best.g / best.w, b = best.b / best.w;
        // Lift dark colours so the glow reads on a dark profile.
        const peak = Math.max(r, g, b);
        if (peak < 210) { const k = 210 / Math.max(1, peak); r *= k; g *= k; b *= k; }
        resolve(`#${hex(r)}${hex(g)}${hex(b)}`);
      } catch {
        resolve(""); // cross-origin artwork without CORS: fall back to the theme colour
      }
    };
    img.onerror = () => resolve("");
    img.src = url;
  }).then((c) => {
    colorCache.set(url, c);
    colorPending.delete(url);
    return c;
  });
  colorPending.set(url, job);
  return job;
};

/** Admin-picked colour, else the artwork's own colour, else the user's theme colour. */
const useFrameColor = (frame?: FrameLike | null) => {
  const art = frame?.imageUrl || "";
  const manual = frame?.fxColor || "";
  const [auto, setAuto] = useState(() => (art ? colorCache.get(art) || "" : ""));
  useEffect(() => {
    if (manual || !art) return;
    let alive = true;
    sampleArtworkColor(art).then((c) => alive && setAuto(c));
    return () => { alive = false; };
  }, [art, manual]);
  const color = manual || auto;
  return color ? ({ "--fx-color": color } as CSSProperties) : undefined;
};

const has = (effects: FrameEffect[], id: FrameEffect) => effects.includes(id);

/** Layers drawn BEHIND the avatar photo. */
export const FrameBackLayers = forwardRef<HTMLSpanElement, { frame?: FrameLike | null }>(({ frame }, ref) => {
  const colorStyle = useFrameColor(frame);
  const setRef = usePauseOffscreen(ref);
  if (!frame) return null;
  const fx = frame.effects || [];
  if (!has(fx, "aura") && !has(fx, "ripple")) return null;
  return (
    <span ref={setRef} className="pf-fx-back" style={colorStyle} aria-hidden="true">
      {has(fx, "aura") && <span className="pf-fx-aura" />}
      {has(fx, "ripple") && (
        <>
          <span className="pf-fx-ripple" />
          <span className="pf-fx-ripple pf-fx-ripple-2" />
        </>
      )}
    </span>
  );
});
FrameBackLayers.displayName = "FrameBackLayers";

/** Artwork + layers drawn IN FRONT of the avatar photo. */
export const FrameFrontLayers = forwardRef<HTMLSpanElement, { frame?: FrameLike | null }>(({ frame }, ref) => {
  const colorStyle = useFrameColor(frame);
  const setRef = usePauseOffscreen(ref);
  const setFrontRef = usePauseOffscreen(null);
  if (!frame) return null;
  const fx = frame.effects || [];
  const art = frame.imageUrl;
  const motion = [
    has(fx, "float") && "is-float",
    has(fx, "spin") && "is-spin",
    has(fx, "pulse") && "is-pulse",
  ].filter(Boolean).join(" ");

  return (
    <>
      <span ref={setRef} className="pf-art" style={colorStyle} aria-hidden="true">
        <span className={`pf-art-motion ${motion}`}>
          {art ? (
            <>
              {has(fx, "glow") && <img src={art} alt="" className="pf-art-glow" draggable={false} />}
              <img src={art} alt="" className="pf-art-img" draggable={false} />
              {has(fx, "shine") && (
                <span className="pf-art-shine" style={{ WebkitMaskImage: `url("${art}")`, maskImage: `url("${art}")` } as CSSProperties}>
                  <span />
                </span>
              )}
            </>
          ) : (
            <span className={`pf-art-ring ${has(fx, "glow") ? "is-glow" : ""}`}>
              {has(fx, "shine") && <span className="pf-art-ring-shine" />}
            </span>
          )}
        </span>
      </span>
      {(has(fx, "sparkle") || has(fx, "orbit") || has(fx, "embers")) && (
        <span ref={setFrontRef} className="pf-fx-front" style={colorStyle} aria-hidden="true">
          {has(fx, "sparkle") && SPARKLES.map((s, i) => (
            <span key={`s${i}`} className="pf-fx-sparkle" style={{ "--a": `${s.a}deg`, "--d": `${s.d}s` } as CSSProperties} />
          ))}
          {has(fx, "orbit") && (
            <span className="pf-fx-orbit">
              <span /><span /><span />
            </span>
          )}
          {has(fx, "embers") && EMBERS.map((e, i) => (
            <span key={`e${i}`} className="pf-fx-ember" style={{ "--x": `${e.x}%`, "--d": `${e.d}s`, "--s": e.s } as CSSProperties} />
          ))}
        </span>
      )}
    </>
  );
});
FrameFrontLayers.displayName = "FrameFrontLayers";
