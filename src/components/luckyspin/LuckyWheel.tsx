import { memo } from "react";
import type { SpinPrize } from "@/lib/luckySpin";

const pt = (r: number, deg: number) => {
  const a = (deg * Math.PI) / 180;
  return [r * Math.sin(a), -r * Math.cos(a)] as const;
};

/** 3D gold-rim prize wheel. `angle` turns it clockwise; the pointer sits at the top. */
function LuckyWheelBase({ prizes, angle, spinning, logoUrl }: { prizes: SpinPrize[]; angle: number; spinning: boolean; logoUrl?: string }) {
  const n = prizes.length;
  const seg = 360 / n;
  const R = 90;
  const bulbs = Array.from({ length: 24 }, (_, i) => pt(95.5, i * 15));
  const fs = n > 10 ? 7.2 : n > 8 ? 8 : 9;
  return (
    <div className="ls-stage">
      <div className="ls-tilt">
        <div className="ls-pointer" aria-hidden="true" />
        <svg viewBox="-100 -100 200 200" className="ls-wheel-svg" role="img" aria-label="Lucky spin wheel">
          <defs>
            <radialGradient id="lsRim" cx="50%" cy="38%" r="62%">
              <stop offset="0%" stopColor="hsl(46 100% 78%)" />
              <stop offset="55%" stopColor="hsl(42 92% 55%)" />
              <stop offset="100%" stopColor="hsl(32 85% 30%)" />
            </radialGradient>
            <radialGradient id="lsShade" cx="50%" cy="50%" r="50%">
              <stop offset="60%" stopColor="hsl(0 0% 0% / 0)" />
              <stop offset="100%" stopColor="hsl(0 0% 0% / 0.45)" />
            </radialGradient>
          </defs>
          <circle r="99" fill="url(#lsRim)" />
          <circle r="92.5" className="ls-rim-inner" />
          {bulbs.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="2.1" className={`ls-bulb ${i % 2 ? "b" : "a"}`} />)}
          <g className="ls-rotor" style={{ transform: `rotate(${angle}deg)`, transition: spinning ? "transform 5.2s cubic-bezier(0.12, 0.72, 0.1, 1)" : "none" }}>
            {prizes.map((p, i) => {
              const [x0, y0] = pt(R, i * seg);
              const [x1, y1] = pt(R, (i + 1) * seg);
              const large = seg > 180 ? 1 : 0;
              const c = (i + 0.5) * seg;
              const win = p.days > 0;
              return (
                <g key={p.id + i}>
                  <path d={`M0 0 L${x0} ${y0} A${R} ${R} 0 ${large} 1 ${x1} ${y1} Z`} className={`ls-seg ls-seg-${win ? i % 3 : "x"}`} />
                  <g transform={`rotate(${c}) translate(0 ${-R * 0.6})`}>
                    {win ? (
                      <>
                        <text className="ls-num" y="2" textAnchor="middle" fontSize={fs * 2.1}>{p.days}</text>
                        <text className="ls-unit" y={fs * 1.45} textAnchor="middle" fontSize={fs * 0.72}>{p.days === 1 ? "DAY" : "DAYS"}</text>
                      </>
                    ) : (
                      <text className="ls-miss" y="3" textAnchor="middle" fontSize={fs * 0.8}>{p.label.toUpperCase()}</text>
                    )}
                  </g>
                  <line x1="0" y1="0" x2={x0} y2={y0} className="ls-divider" />
                </g>
              );
            })}
          </g>
          <circle r={R} fill="url(#lsShade)" pointerEvents="none" />
          <circle r="21" className="ls-hub-ring" />
          <circle r="17.5" className="ls-hub" />
          {logoUrl ? (
            <>
              <clipPath id="lsLogoClip"><circle r="16" /></clipPath>
              <image href={logoUrl} x="-16" y="-16" width="32" height="32" clipPath="url(#lsLogoClip)" preserveAspectRatio="xMidYMid slice" />
            </>
          ) : (
            <text className="ls-hub-text" y="4.5" textAnchor="middle" fontSize="12">RS</text>
          )}
        </svg>
      </div>
      <div className="ls-floor" aria-hidden="true" />
    </div>
  );
}

export const LuckyWheel = memo(LuckyWheelBase);
