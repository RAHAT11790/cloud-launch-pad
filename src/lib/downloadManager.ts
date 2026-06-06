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

type Subscriber = (snapshot: DownloadQueueSnapshot) => void;

const createFileSafeName = (value: string) =>
  value.replace(/[^a-zA-Z0-9\s\-_]/g, "").replace(/\s+/g, " ").trim();

const buildFileName = (title: string, subtitle?: string, quality?: string) => {
  const parts = [title, subtitle, quality && quality !== "Auto" ? quality : ""]
    .map((part) => createFileSafeName(String(part || "")))
    .filter(Boolean);
  return `${parts.join(" - ") || "video"}.mp4`;
};

class DownloadManager {
  private downloads = new Map<string, ActiveDownload>();
  private listeners = new Set<Subscriber>();
  private queue: string[] = [];
  private activeId: string | null = null;
  private sequence = 0;
  private triggerTimer: number | null = null;
  private finishTimer: number | null = null;

  private getSnapshot(): DownloadQueueSnapshot {
    const values = Array.from(this.downloads.values());
    return {
      downloads: new Map(this.downloads),
      activeId: this.activeId,
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

  private clearTimers() {
    if (this.triggerTimer !== null) window.clearTimeout(this.triggerTimer);
    if (this.finishTimer !== null) window.clearTimeout(this.finishTimer);
    this.triggerTimer = null;
    this.finishTimer = null;
  }

  private settleActive(status: DownloadStatus, patch: Partial<ActiveDownload> = {}) {
    const id = this.activeId;
    this.clearTimers();
    if (id) {
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
    }
    this.activeId = null;
    this.emit();
    this.pump();
  }

  private startItem(id: string) {
    const item = this.downloads.get(id);
    if (!item || item.status === "cancelled") {
      this.activeId = null;
      this.pump();
      return;
    }

    this.activeId = id;
    this.downloads.set(id, {
      ...item,
      status: "downloading",
      percent: 12,
      loadedMB: 0.2,
      totalMB: Math.max(item.totalMB, 1),
    });
    this.emit();

    this.triggerTimer = window.setTimeout(() => {
      const latest = this.downloads.get(id);
      if (!latest || latest.status !== "downloading") return;
      const ok = triggerBackgroundVideoDownload(latest.url as unknown as string, latest.fileName || buildFileName(latest.title, latest.subtitle, latest.quality));
      if (!ok) {
        this.settleActive("error", { error: "Download link is invalid" });
        return;
      }

      this.update(id, { percent: 72, loadedMB: 0.8, totalMB: 1 });
      this.finishTimer = window.setTimeout(() => {
        this.settleActive("complete", { percent: 100, loadedMB: 1, totalMB: 1 });
      }, 900);
    }, 220);
  }

  private pump() {
    if (this.activeId) return;
    const nextId = this.queue.find((id) => {
      const item = this.downloads.get(id);
      return item && item.status === "queued";
    });
    if (!nextId) {
      this.queue = this.queue.filter((id) => {
        const item = this.downloads.get(id);
        return item && item.status === "paused";
      });
      return;
    }
    this.queue = this.queue.filter((id) => id !== nextId);
    this.startItem(nextId);
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
    if (this.activeId === id) {
      this.update(id, { status: "paused" });
      this.activeId = null;
      this.clearTimers();
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
    if (this.activeId === id) {
      this.settleActive("cancelled", { percent: 0, loadedMB: 0, totalMB: 0 });
      return;
    }
    const item = this.downloads.get(id);
    if (!item) return;
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
    const batchSize = this.queue.length + (this.activeId ? 1 : 0) + 1;
    this.sequence += 1;
    this.downloads.set(params.id, {
      id: params.id,
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
}

export const downloadManager = new DownloadManager();
