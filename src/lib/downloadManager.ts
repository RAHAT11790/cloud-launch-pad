// Minimal silent download dispatcher.
// No queue UI, no toasts, no progress tracking — clicking a download
// button just triggers the browser's native download for each URL.
// Public API kept compatible with previous callers (VideoPlayer, ProfilePage).

import { triggerBackgroundVideoDownload } from "./videoDownload";

export type DownloadStatus = "queued" | "downloading" | "paused" | "complete" | "error" | "cancelled";

export interface ActiveDownload {
  id: string;
  title: string;
  subtitle?: string;
  poster?: string;
  quality: string;
  percent: number;
  loadedMB: number;
  totalMB: number;
  status: DownloadStatus;
  sequence: number;
  queueIndex: number;
  totalInBatch: number;
  error?: string;
  fileName?: string;
}

export interface DownloadQueueSnapshot {
  downloads: Map<string, ActiveDownload>;
  activeId: string | null;
  queuedCount: number;
  completedCount: number;
  totalCount: number;
}

type DownloadParams = {
  id: string;
  url: string;
  title: string;
  subtitle?: string;
  poster?: string;
  quality: string;
  fileName?: string;
};

const createFileSafeName = (value: string) =>
  value.replace(/[^a-zA-Z0-9\s\-_]/g, "").replace(/\s+/g, " ").trim();

const buildFileName = (title: string, subtitle?: string, quality?: string) => {
  const parts = [title, subtitle, quality && quality !== "Auto" ? quality : ""]
    .map((part) => createFileSafeName(String(part || "")))
    .filter(Boolean);
  return `${parts.join(" - ") || "video"}.mp4`;
};

const EMPTY_SNAPSHOT: DownloadQueueSnapshot = {
  downloads: new Map(),
  activeId: null,
  queuedCount: 0,
  completedCount: 0,
  totalCount: 0,
};

let bulkOffset = 0;
const triggerOne = (params: DownloadParams) => {
  const fileName = params.fileName || buildFileName(params.title, params.subtitle, params.quality);
  triggerBackgroundVideoDownload(params.url, fileName);
};

class DownloadManager {
  subscribe(_fn: (snapshot: DownloadQueueSnapshot) => void) {
    // No-op: nothing to subscribe to anymore.
    return () => {};
  }
  getSnapshotState() { return EMPTY_SNAPSHOT; }
  getDownload(_id: string) { return undefined; }
  isDownloading(_id: string) { return false; }
  pauseDownload(_id: string) {}
  resumeDownload(_id: string) {}
  cancelDownload(_id: string) {}
  clearFinished() {}

  async startDownload(params: DownloadParams) {
    triggerOne(params);
  }

  // Bulk: stagger each direct download slightly so browsers don't drop them.
  async enqueueDownload(params: DownloadParams) {
    const delay = bulkOffset;
    bulkOffset += 350;
    window.setTimeout(() => {
      try { triggerOne(params); } finally {
        // Decay the offset once this one fires.
        bulkOffset = Math.max(0, bulkOffset - 350);
      }
    }, delay);
  }
}

export const downloadManager = new DownloadManager();
