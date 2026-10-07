import { memo, useEffect, useRef } from "react";
import type { PgsBitmapCue } from "@/lib/mkv/pgs";

interface Props {
  text: string;
  bitmap: PgsBitmapCue | null;
  fontScale: number;
  verticalOffset: number;
  objectFit: string;
}

/** Renders embedded MKV subtitles: text captions and Blu-ray (PGS) bitmaps. */
export const EmbeddedSubtitleLayer = memo(({ text, bitmap, fontScale, verticalOffset, objectFit }: Props) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (!bitmap) { ctx.clearRect(0, 0, canvas.width, canvas.height); return; }
    if (canvas.width !== bitmap.planeWidth || canvas.height !== bitmap.planeHeight) {
      canvas.width = bitmap.planeWidth || 1920;
      canvas.height = bitmap.planeHeight || 1080;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const b of bitmap.bitmaps) {
      try { ctx.putImageData(new ImageData(new Uint8ClampedArray(b.rgba), b.width, b.height), b.x, b.y); } catch { /* bad bitmap */ }
    }
  }, [bitmap]);

  return (
    <>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[8] h-full w-full"
        style={{ objectFit: (objectFit as any) || "contain", opacity: bitmap ? 1 : 0, transition: "opacity 90ms linear" }}
      />
      {!!text && (
        <div data-embedded-subtitle="" className="pointer-events-none absolute inset-x-3 z-[8] flex justify-center" style={{ bottom: `clamp(8px, ${verticalOffset}%, 28%)` }}>
          <div
            className="max-w-[92%] whitespace-pre-line px-1 text-center font-semibold leading-snug text-white"
            style={{
              fontSize: `${Math.round(13 * fontScale)}px`,
              lineHeight: Math.max(1.2, 1.34 - (fontScale - 1) * 0.08),
              textShadow: "0 0 3px rgba(0,0,0,.95), 0 1px 2px rgba(0,0,0,.95), 0 0 8px rgba(0,0,0,.6)",
            }}
          >
            {text}
          </div>
        </div>
      )}
    </>
  );
});
EmbeddedSubtitleLayer.displayName = "EmbeddedSubtitleLayer";
