import { triggerBackgroundVideoDownload } from "./videoDownload";
import { isHlsUrl } from "./hlsDownloader";

export type DownloadStatus = "queued" | "downloading" | "paused" | "complete" | "error" | "cancelled";

export interface ActiveDownload {
  id: string;
  url?: string;
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

export type DownloadParams = {
  id: string;
  url: string;
  title: string;
  subtitle?: string;
  poster?: string;
  quality: string;
  fileName?: string;
};

type Subscriber = (snapshot: DownloadQueueSnapshot) => void;

// Allow several downloads in parallel. Browsers handle this fine.
const MAX_CONCURRENT = 4;

const createFileSafeName = (value: string) =>
  value.replace(/[^a-zA-Z0-9\s\-_]/g, "").replace(/\s+/g, " ").trim();

const buildFileName = (title: string, subtitle?: string, quality?: string) => {
  const parts = [title, subtitle, quality && quality !== "Auto" ? quality : ""]
    .map((part) => createFileSafeName(String(part || "")))
    .filter(Boolean);
  return `${parts.join(" - ") || "video"}.mp4`;
};

interface ItemTimers {
  trigger?: number;
  finish?: number;
}

class DownloadManager {
  private downloads = new Map<string, ActiveDownload>();
  private listeners = new Set<Subscriber>();
  private queue: string[] = [];
  private activeIds = new Set<string>();
  private lastStartedId: string | null = null;
  private timers = new Map<string, ItemTimers>();
  private sequence = 0;

  private isProxyDownloadUrl(url: string) {
    return /\/functions\/v1\/(video-download|video-proxy)\?/i.test(String(url || ""));
  }

  private async fetchContentLength(url: string, init?: RequestInit): Promise<number> {
    try {
      const response = await fetch(url, init);
      const len = response.headers.get("content-length");
      if (len && Number(len) > 0) return Number(len);
      const range = response.headers.get("content-range");
      if (range) {
        const match = /\/(\d+)\s*$/.exec(range);
        if (match && Number(match[1]) > 0) return Number(match[1]);
      }
    } catch {}
    return 0;
  }

  private getSnapshot(): DownloadQueueSnapshot {
    const values = Array.from(this.downloads.values());
    return {
      downloads: new Map(this.downloads),
      activeId: this.lastStartedId,
      queuedCount: values.filter((item) => item.status === "queued" || item.status === "paused").length,
      completedCount: values.filter((item) => item.status === "complete").length,
      totalCount: values.filter((item) => item.status !== "cancelled").length,
    };
  }

  private emit() {
    const snapshot = this.getSnapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  }

  private update(id: string, patch: Partial<ActiveDownload>) {
    const current = this.downloads.get(id);
    if (!current) return;
    this.downloads.set(id, { ...current, ...patch });
    this.emit();
  }

  private clearItemTimers(id: string) {
    const t = this.timers.get(id);
    if (!t) return;
    if (t.trigger !== undefined) window.clearTimeout(t.trigger);
    if (t.finish !== undefined) window.clearTimeout(t.finish);
    this.timers.delete(id);
  }

  private settleItem(id: string, status: DownloadStatus, patch: Partial<ActiveDownload> = {}) {
    this.clearItemTimers(id);
    const current = this.downloads.get(id);
    if (current) {
      this.downloads.set(id, {
        ...current,
        status,
        percent: status === "complete" ? 100 : current.percent,
        loadedMB: status === "complete" ? Math.max(current.loadedMB, current.totalMB || 1) : current.loadedMB,
        totalMB: Math.max(current.totalMB, current.loadedMB, 1),
        ...patch,
      });
    }
    this.activeIds.delete(id);
    if (this.lastStartedId === id) this.lastStartedId = null;
    this.emit();
    this.pump();
  }

  private async fetchTotalSize(url: string): Promise<number> {
    const candidate = String(url || "").trim();
    if (!candidate) return 0;
    const probePlans: RequestInit[] = this.isProxyDownloadUrl(candidate)
      ? [
          { method: "HEAD" },
          { method: "GET", headers: { Range: "bytes=0-0" } },
        ]
      : [
          { method: "HEAD", mode: "cors" },
          { method: "GET", headers: { Range: "bytes=0-0" }, mode: "cors" },
          { method: "GET", mode: "cors" },
        ];

    for (const init of probePlans) {
      const length = await this.fetchContentLength(candidate, init);
      if (length > 0) return length;
    }
    return 0;
  }

  private startItem(id: string) {
    const item = this.downloads.get(id);
    if (!item || item.status === "cancelled") {
      this.activeIds.delete(id);
      this.pump();
      return;
    }

    this.activeIds.add(id);
    this.lastStartedId = id;
    this.downloads.set(id, {
      ...item,
      status: "downloading",
      percent: 12,
      loadedMB: 0.2,
      totalMB: Math.max(item.totalMB, 1),
    });
    this.emit();

    if (item.url) {
      this.fetchTotalSize(item.url).then((bytes) => {
        if (bytes > 0) {
          const mb = bytes / (1024 * 1024);
          this.update(id, { totalMB: mb });
        }
      }).catch(() => {});
    }

    // HLS (.m3u8) downloads use a real in-browser segment fetcher so the
    // user gets a single concatenated .ts file (RS-style naming preserved).
    if (item.url && isHlsUrl(item.url)) {
      const fileName = (item.fileName || buildFileName(item.title, item.subtitle, item.quality))
        .replace(/\.(mp4|mkv|webm|m4v|mov)$/i, "") + ".ts";
      import("./hlsDownloader").then(async ({ downloadHls, saveBlobAs }) => {
        try {
          const blob = await downloadHls(item.url!, (loaded, total, bytes) => {
            const percent = Math.min(99, Math.round((loaded / total) * 100));
            const mb = bytes / (1024 * 1024);
            // Estimate total based on average segment size so the UI shows real numbers.
            const avg = bytes / Math.max(1, loaded);
            const estTotalMB = (avg * total) / (1024 * 1024);
            this.update(id, { percent, loadedMB: mb, totalMB: Math.max(estTotalMB, mb, 1) });
          });
          saveBlobAs(blob, fileName);
          const mb = blob.size / (1024 * 1024);
          this.settleItem(id, "complete", { percent: 100, loadedMB: mb, totalMB: mb });
        } catch (e: any) {
          this.settleItem(id, "error", { error: e?.message || "HLS download failed" });
        }
      });
      return;
    }

    const timers: ItemTimers = {};
    this.timers.set(id, timers);

    // Stagger trigger slightly per item so the browser registers each
    // download dialog as a distinct user-initiated download.
    const offset = (this.activeIds.size - 1) * 140;
    timers.trigger = window.setTimeout(() => {
      const latest = this.downloads.get(id);
      if (!latest || latest.status !== "downloading") return;
      const ok = triggerBackgroundVideoDownload(latest.url as unknown as string, latest.fileName || buildFileName(latest.title, latest.subtitle, latest.quality));
      if (!ok) {
        this.settleItem(id, "error", { error: "Download link is invalid" });
        return;
      }

      const t = latest.totalMB > 1 ? latest.totalMB : 1;
      this.update(id, { percent: 72, loadedMB: t * 0.72, totalMB: t });
      timers.finish = window.setTimeout(() => {
        const final = this.downloads.get(id);
        const fT = final && final.totalMB > 1 ? final.totalMB : 1;
        this.settleItem(id, "complete", { percent: 100, loadedMB: fT, totalMB: fT });
      }, 900);
    }, 220 + offset);
  }

  private pump() {
    while (this.activeIds.size < MAX_CONCURRENT) {
      const nextId = this.queue.find((id) => {
        const item = this.downloads.get(id);
        return item && item.status === "queued" && !this.activeIds.has(id);
      });
      if (!nextId) break;
      this.queue = this.queue.filter((id) => id !== nextId);
      this.startItem(nextId);
    }
    // Compact queue: drop ids that are no longer queued/paused.
    this.queue = this.queue.filter((id) => {
      const item = this.downloads.get(id);
      return item && (item.status === "queued" || item.status === "paused");
    });
  }

  subscribe(fn: Subscriber) {
    this.listeners.add(fn);
    fn(this.getSnapshot());
    return () => {
      this.listeners.delete(fn);
    };
  }

  getSnapshotState() {
    return this.getSnapshot();
  }

  getDownload(id: string) {
    return this.downloads.get(id);
  }

  isDownloading(id: string) {
    const item = this.downloads.get(id);
    return item?.status === "queued" || item?.status === "downloading";
  }

  pauseDownload(id: string) {
    if (this.activeIds.has(id)) {
      this.clearItemTimers(id);
      this.activeIds.delete(id);
      if (this.lastStartedId === id) this.lastStartedId = null;
      this.update(id, { status: "paused" });
      this.queue.unshift(id);
      this.emit();
      return;
    }
    const item = this.downloads.get(id);
    if (!item || item.status !== "queued") return;
    this.update(id, { status: "paused" });
    this.queue = this.queue.filter((queuedId) => queuedId !== id);
  }

  resumeDownload(id: string) {
    const item = this.downloads.get(id);
    if (!item || item.status !== "paused") return;
    this.update(id, { status: "queued" });
    if (!this.queue.includes(id)) this.queue.push(id);
    this.pump();
  }

  cancelDownload(id: string) {
    if (this.activeIds.has(id)) {
      this.settleItem(id, "cancelled", { percent: 0, loadedMB: 0, totalMB: 0 });
      return;
    }
    const item = this.downloads.get(id);
    if (!item) return;
    this.clearItemTimers(id);
    this.downloads.set(id, { ...item, status: "cancelled", percent: 0, loadedMB: 0, totalMB: 0 });
    this.queue = this.queue.filter((queuedId) => queuedId !== id);
    this.emit();
  }

  clearFinished() {
    Array.from(this.downloads.entries()).forEach(([id, item]) => {
      if (["complete", "cancelled", "error"].includes(item.status)) this.downloads.delete(id);
    });
    this.emit();
  }

  async startDownload(params: DownloadParams) {
    const fileName = params.fileName || buildFileName(params.title, params.subtitle, params.quality);
    this.sequence += 1;
    this.downloads.set(params.id, {
      id: params.id,
      url: params.url,
      title: params.title,
      subtitle: params.subtitle,
      poster: params.poster,
      quality: params.quality,
      percent: 0,
      loadedMB: 0,
      totalMB: 1,
      status: "queued",
      sequence: this.sequence,
      queueIndex: 1,
      totalInBatch: 1,
      fileName,
    });
    this.queue.push(params.id);
    this.emit();
    this.pump();
  }

  async enqueueDownload(params: DownloadParams) {
    const fileName = params.fileName || buildFileName(params.title, params.subtitle, params.quality);
    const batchSize = this.queue.length + this.activeIds.size + 1;
    this.sequence += 1;
    this.downloads.set(params.id, {
      id: params.id,
      url: params.url,
      title: params.title,
      subtitle: params.subtitle,
      poster: params.poster,
      quality: params.quality,
      percent: 0,
      loadedMB: 0,
      totalMB: 1,
      status: "queued",
      sequence: this.sequence,
      queueIndex: batchSize,
      totalInBatch: batchSize,
      fileName,
    });
    this.queue.push(params.id);
    this.emit();
    this.pump();
  }

  /**
   * Enqueue multiple downloads as a single batch with correct metadata.
   */
  enqueueBatch(items: DownloadParams[]) {
    if (!items || items.length === 0) return;
    const total = items.length;
    items.forEach((params, idx) => {
      const fileName = params.fileName || buildFileName(params.title, params.subtitle, params.quality);
      this.sequence += 1;
      this.downloads.set(params.id, {
        id: params.id,
        url: params.url,
        title: params.title,
        subtitle: params.subtitle,
        poster: params.poster,
        quality: params.quality,
        percent: 0,
        loadedMB: 0,
        totalMB: 1,
        status: "queued",
        sequence: this.sequence,
        queueIndex: idx + 1,
        totalInBatch: total,
        fileName,
      });
      this.queue.push(params.id);
    });
    this.emit();
    this.pump();
  }

  /**
   * UI-only registration.
   */
  registerExternalDownload(params: DownloadParams) {
    const fileName = params.fileName || buildFileName(params.title, params.subtitle, params.quality);
    this.sequence += 1;
    this.downloads.set(params.id, {
      id: params.id,
      url: params.url,
      title: params.title,
      subtitle: params.subtitle,
      poster: params.poster,
      quality: params.quality,
      percent: 100,
      loadedMB: 1,
      totalMB: 1,
      status: "complete",
      sequence: this.sequence,
      queueIndex: 1,
      totalInBatch: 1,
      fileName,
    });
    this.emit();
  }
}

export const downloadManager = new DownloadManager();
