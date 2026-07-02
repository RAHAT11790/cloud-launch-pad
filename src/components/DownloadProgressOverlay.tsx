import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Download, GripHorizontal, Loader2, Pause, Play, X } from "lucide-react";

import { downloadManager, type ActiveDownload, type DownloadQueueSnapshot } from "@/lib/downloadManager";

const STORAGE_KEY = "rs_download_overlay_pos";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const formatMb = (value: number) => {
  if (!value || value <= 0) return "Unknown size";
  if (value >= 1024) return `${(value / 1024).toFixed(2)} GB`;
  return `${value.toFixed(value >= 100 ? 0 : 1)} MB`;
};

export default function DownloadProgressOverlay() {
  const [snapshot, setSnapshot] = useState<DownloadQueueSnapshot>(() => downloadManager.getSnapshotState());
  const [hidden, setHidden] = useState(false);
  const [position, setPosition] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { x: 14, y: 108 };
      const parsed = JSON.parse(raw);
      return {
        x: Number(parsed?.x) || 14,
        y: Number(parsed?.y) || 108,
      };
    } catch {
      return { x: 14, y: 108 };
    }
  });

  useEffect(() => downloadManager.subscribe(setSnapshot), []);

  useEffect(() => {
    if (snapshot.totalCount > 0) setHidden(false);
  }, [snapshot.totalCount]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(position));
    } catch {}
  }, [position]);

  const items = useMemo(
    () => Array.from(snapshot.downloads.values()).sort((a, b) => a.sequence - b.sequence),
    [snapshot.downloads],
  );
  const activeItem = (snapshot.activeId && snapshot.downloads.get(snapshot.activeId)) || items.find((item) => item.status === "downloading") || items[0];

  if (!activeItem || hidden) return null;

  const completed = items.filter((item) => item.status === "complete").length;
  const hasKnownSize = activeItem.totalMB > 0 && activeItem.loadedMB > 0;
  const progressLabel = hasKnownSize
    ? `${formatMb(activeItem.loadedMB)} / ${formatMb(activeItem.totalMB)}`
    : activeItem.status === "complete"
      ? "Saved to Downloads"
      : activeItem.status === "error"
        ? "Download failed"
        : "Preparing download size...";

  const onDragEnd = (_: unknown, info: { point: { x: number; y: number } }) => {
    const maxX = Math.max(14, window.innerWidth - 286);
    const maxY = Math.max(80, window.innerHeight - 210);
    setPosition({
      x: clamp(info.point.x - 130, 14, maxX),
      y: clamp(info.point.y - 24, 80, maxY),
    });
  };

  return (
    <AnimatePresence>
      <motion.div
        drag
        dragMomentum={false}
        dragElastic={0.08}
        dragConstraints={{ left: 12, top: 64, right: Math.max(12, window.innerWidth - 274), bottom: Math.max(64, window.innerHeight - 188) }}
        onDragEnd={onDragEnd}
        initial={{ opacity: 0, scale: 0.92, y: 16 }}
        animate={{ opacity: 1, scale: 1, x: position.x, y: position.y }}
        exit={{ opacity: 0, scale: 0.94, y: 12 }}
        transition={{ type: "spring", stiffness: 320, damping: 28, mass: 0.7 }}
        className="fixed left-0 top-0 z-[260] w-[260px] select-none rounded-xl border border-border/70 bg-card/95 p-3 shadow-[0_16px_40px_hsl(var(--background)/0.55)] backdrop-blur-xl"
      >
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[11px] font-semibold text-foreground">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg gradient-primary text-primary-foreground">
                {activeItem.status === "downloading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              </div>
              <div className="min-w-0">
                <p className="truncate">{activeItem.subtitle || activeItem.title}</p>
                <p className="text-[10px] font-medium text-muted-foreground">
                  {activeItem.error || `Episode ${Math.min(activeItem.queueIndex, activeItem.totalInBatch)} of ${activeItem.totalInBatch}`}
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Move download panel"
              className="flex h-7 w-7 items-center justify-center rounded-lg bg-secondary/70 text-muted-foreground"
            >
              <GripHorizontal className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label="Hide download panel"
              onClick={() => setHidden(true)}
              className="flex h-7 w-7 items-center justify-center rounded-lg bg-secondary/70 text-muted-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="overflow-hidden rounded-lg bg-secondary/70">
          <motion.div
            className="h-2 rounded-lg gradient-primary"
            animate={{ width: `${Math.max(activeItem.percent, activeItem.status === "complete" ? 100 : 4)}%` }}
            transition={{ ease: [0.32, 0.72, 0, 1], duration: 0.25 }}
          />
        </div>

        <div className="mt-2 flex items-center justify-between gap-3 text-[10px] text-muted-foreground">
          <span>{progressLabel}</span>
          <span>{completed}/{items.length} done</span>
        </div>

        <div className="mt-2 flex items-center gap-2">
          {(activeItem.status === "queued" || activeItem.status === "downloading") && (
            <button
              type="button"
              onClick={() => downloadManager.pauseDownload(activeItem.id)}
              className="flex h-8 flex-1 items-center justify-center gap-1 rounded-lg bg-secondary/70 text-[10px] font-semibold text-foreground"
            >
              <Pause className="h-3.5 w-3.5" /> Pause
            </button>
          )}
          {activeItem.status === "paused" && (
            <button
              type="button"
              onClick={() => downloadManager.resumeDownload(activeItem.id)}
              className="flex h-8 flex-1 items-center justify-center gap-1 rounded-lg gradient-primary text-[10px] font-semibold text-primary-foreground"
            >
              <Play className="h-3.5 w-3.5" /> Resume
            </button>
          )}
          {(activeItem.status === "queued" || activeItem.status === "downloading" || activeItem.status === "paused") && (
            <button
              type="button"
              onClick={() => downloadManager.cancelDownload(activeItem.id)}
              className="flex h-8 flex-1 items-center justify-center rounded-lg bg-destructive/15 text-[10px] font-semibold text-destructive"
            >
              Cancel
            </button>
          )}
        </div>

        <div className="mt-2 space-y-1.5">
          {items.slice(0, 3).map((item: ActiveDownload) => (
            <div key={item.id} className="rounded-lg bg-secondary/50 px-2 py-1.5">
              <div className="flex items-center justify-between gap-2 text-[10px]">
                <span className="truncate text-foreground">{item.subtitle || item.title}</span>
                <span className="shrink-0 text-muted-foreground">
                  {item.status === "queued" ? "Queued" : item.status === "downloading" ? `${item.percent}%` : item.status === "paused" ? "Paused" : item.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}