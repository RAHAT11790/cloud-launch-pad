import type { LucideIcon } from "lucide-react";

/** One crisp symbol; the button surface supplies depth, never displaced icon copies. */
export function PlayerIcon3D({ icon: Icon, className = "" }: { icon: LucideIcon; className?: string }) {
  return (
    <span className={`p3d-icon ${className}`} aria-hidden="true">
      <Icon className="p3d-icon-symbol" strokeWidth={2} />
    </span>
  );
}