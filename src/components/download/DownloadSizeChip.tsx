import { HardDrive, Loader2 } from "lucide-react";
import { formatDownloadSize } from "@/lib/downloadSize";

/** Size badge for one downloadable file: checking → real size → unknown. */
export function DownloadSizeChip({ bytes, checked }: { bytes: number; checked: boolean }) {
  const label = formatDownloadSize(bytes);
  if (label) {
    return (
      <span data-dl-size="ready" className="inline-flex items-center gap-1 rounded-full border border-emerald-400/35 bg-emerald-400/10 px-2 py-[3px] text-[10.5px] font-bold tabular-nums text-emerald-300">
        <HardDrive className="h-3 w-3" aria-hidden="true" />{label}
      </span>
    );
  }
  if (!checked) {
    return (
      <span data-dl-size="checking" className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.06] px-2 py-[3px] text-[10.5px] font-medium text-white/60">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />Checking
      </span>
    );
  }
  return (
    <span data-dl-size="unknown" className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2 py-[3px] text-[10.5px] font-medium text-white/40">
      <HardDrive className="h-3 w-3" aria-hidden="true" />Size unknown
    </span>
  );
}
