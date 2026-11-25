import type { LucideIcon } from "lucide-react";

/** Three rigid layers give control symbols a visible extruded edge without a 3D renderer. */
export function PlayerIcon3D({ icon: Icon, className = "" }: { icon: LucideIcon; className?: string }) {
  return (
    <span className={`p3d-icon ${className}`} aria-hidden="true">
      <Icon className="p3d-icon-depth" strokeWidth={3} />
      <Icon className="p3d-icon-edge" strokeWidth={2.8} />
      <Icon className="p3d-icon-face" strokeWidth={2.4} />
    </span>
  );
}