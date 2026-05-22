import { toast } from "@/hooks/use-toast";

import { buildVideoDownloadUrl, triggerBackgroundVideoDownload } from "./videoDownload";

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

type QueueItem = DownloadParams & {
  sequence: number;
};

type Listener = (snapshot: DownloadQueueSnapshot) => void;

const createFileSafeName = (value: string) =>
  value
    .replace(/[^a-zA-Z0-9\s\-_]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const buildFileName = (title: string, subtitle?: string, quality?: string) => {
  const parts = [title, subtitle, quality && quality !== "Auto" ? quality : ""]
    .map((part) => createFileSafeName(String(part || "")))
    .filter(Boolean);
  return `${parts.join(" - ") || "video"}.mp4`;
};

class DownloadManager {
  private active = new Map<string, ActiveDownload>();
  private listeners = new Set<Listener>();
  private requests = new Map<string, DownloadParams>();
  private queue: QueueItem[] = [];
  private processing = false;
  private activeId: string | null = null;
  private sequenceSeed = 0;
  private handoffTimers = new Map<string, number>();

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    fn(this.getSnapshot());
    return () => {
      this.listeners.delete(fn);
    };
  }

  private getSnapshot(): DownloadQueueSnapshot {
    const downloads = new Map(this.active);
    const values = Array.from(downloads.values());
    return {
      downloads,
      activeId: this.activeId,
      queuedCount: values.filter((item) => item.status === "queued").length,
      completedCount: values.filter((item) => item.status === "complete").length,
      totalCount: values.length,
    };
  }

  private notify() {
    const snapshot = this.getSnapshot();
    this.listeners.forEach((fn) => fn(snapshot));
  }

  getSnapshotState() {
    return this.getSnapshot();
  }

  getDownload(id: string) {
    return this.active.get(id);
  }

  isDownloading(id: string) {
    const item = this.active.get(id);
    return item?.status === "downloading" || item?.status === "queued" || item?.status === "paused";
  }

  pauseDownload(id: string) {
    const item = this.active.get(id);
    if (!item || item.status === "complete" || item.status === "error" || item.status === "cancelled") return;

    const queuedIndex = this.queue.findIndex((queued) => queued.id === id);
    if (queuedIndex >= 0) {
      this.queue.splice(queuedIndex, 1);
      item.status = "paused";
      this.reindexQueueMeta();
      this.notify();
      toast({ title: "Download paused", description: item.subtitle || item.title });
      return;
    }

    if (this.activeId === id && item.status === "downloading") {
      item.status = "paused";
      const timer = this.handoffTimers.get(id);
      if (timer) {
        window.clearTimeout(timer);
        this.handoffTimers.delete(id);
      }
      this.activeId = null;
      this.reindexQueueMeta();
      this.notify();
      toast({ title: "Download paused", description: item.subtitle || item.title });
      void this.processQueue();
    }
  }

  resumeDownload(id: string) {
    const request = this.requests.get(id);
    const item = this.active.get(id);
    if (!request || !item || item.status !== "paused") return;
    if (this.queue.some((queued) => queued.id === id) || this.activeId === id) return;

    item.status = "queued";
    item.error = undefined;
    item.percent = 0;
    item.loadedMB = 0;
    item.totalMB = 0;

    const sequence = ++this.sequenceSeed;
    item.sequence = sequence;
    this.queue.push({ ...request, sequence });
    this.reindexQueueMeta();
    this.notify();
    toast({ title: "Download resumed", description: item.subtitle || item.title });
    void this.processQueue();
  }

  cancelDownload(id: string) {
    const queuedIndex = this.queue.findIndex((item) => item.id === id);
    if (queuedIndex >= 0) {
      this.queue.splice(queuedIndex, 1);
    }

    const timer = this.handoffTimers.get(id);
    if (timer) {
      window.clearTimeout(timer);
      this.handoffTimers.delete(id);
    }

    const existing = this.active.get(id);
    if (existing) {
      existing.status = "cancelled";
      this.notify();
      toast({ title: "Download cancelled", description: existing.subtitle || existing.title });
      window.setTimeout(() => {
        this.active.delete(id);
        this.requests.delete(id);
        if (this.activeId === id) this.activeId = null;
        this.reindexQueueMeta();
        this.notify();
      }, 220);
    }
  }

  clearFinished() {
    for (const [id, item] of this.active.entries()) {
      if (item.status === "complete" || item.status === "error" || item.status === "cancelled") {
        this.active.delete(id);
        this.requests.delete(id);
      }
    }
    this.notify();
  }

  async startDownload(params: DownloadParams) {
    return this.enqueueDownload(params);
  }

  async enqueueDownload(params: DownloadParams) {
    const normalized = {
      ...params,
      fileName: params.fileName || buildFileName(params.title, params.subtitle, params.quality),
    };

    const existing = this.active.get(normalized.id);
    if (existing && existing.status !== "error" && existing.status !== "cancelled" && existing.status !== "complete") return;

    this.requests.set(normalized.id, normalized);

    const sequence = ++this.sequenceSeed;
    this.queue.push({ ...normalized, sequence });
    this.active.set(normalized.id, {
      id: normalized.id,
      title: normalized.title,
      subtitle: normalized.subtitle,
      poster: normalized.poster,
      quality: normalized.quality,
      percent: 0,
      loadedMB: 0,
      totalMB: 0,
      status: "queued",
      sequence,
      queueIndex: this.queue.length,
      totalInBatch: this.queue.length,
      fileName: normalized.fileName,
    });
    this.reindexQueueMeta();
    this.notify();
    toast({ title: "Download queued", description: normalized.subtitle || normalized.title });
    void this.processQueue();
  }

  private reindexQueueMeta() {
    const ordered = [
      ...(this.activeId ? [this.activeId] : []),
      ...this.queue.map((item) => item.id),
      ...Array.from(this.active.values())
        .filter((item) => item.status === "paused")
        .sort((a, b) => a.sequence - b.sequence)
        .map((item) => item.id),
    ];
    const total = Math.max(ordered.length, 1);

    ordered.forEach((id, index) => {
      const item = this.active.get(id);
      if (!item) return;
      item.queueIndex = index + 1;
      item.totalInBatch = total;
    });
  }

  private async processQueue() {
    if (this.processing) return;
    this.processing = true;

    try {
      while (this.queue.length > 0) {
        const next = this.queue.shift();
        if (!next) continue;
        const active = this.active.get(next.id);
        if (!active || active.status === "cancelled") continue;
        if (active.status === "paused") continue;
        this.activeId = next.id;
        this.reindexQueueMeta();
        this.notify();
        await this.runDownload(next);
      }
    } finally {
      this.activeId = null;
      this.processing = false;
      this.reindexQueueMeta();
      this.notify();
    }
  }

  private async runDownload(params: QueueItem) {
    const entry = this.active.get(params.id);
    if (!entry || entry.status === "paused" || entry.status === "cancelled") return;

    entry.status = "downloading";
    entry.error = undefined;
    entry.percent = Math.max(entry.percent, 8);
    this.notify();
    toast({ title: "Download started", description: params.subtitle || params.title });

    await new Promise<void>((resolve) => {
      const tick = () => {
        const current = this.active.get(params.id);
        if (!current || current.status === "paused" || current.status === "cancelled") {
          resolve();
          return;
        }

        current.percent = Math.min(current.percent + (current.percent < 30 ? 18 : current.percent < 60 ? 12 : 7), 92);
        this.notify();

        if (current.percent >= 92) {
          resolve();
          return;
        }

        const timer = window.setTimeout(tick, 180);
        this.handoffTimers.set(params.id, timer);
      };

      const timer = window.setTimeout(tick, 120);
      this.handoffTimers.set(params.id, timer);
    });

    this.handoffTimers.delete(params.id);

    const current = this.active.get(params.id);
    if (!current || current.status === "paused" || current.status === "cancelled") return;

    const downloadUrl = buildVideoDownloadUrl(params.url, params.fileName || buildFileName(params.title, params.subtitle, params.quality)) || params.url;
    const ok = triggerBackgroundVideoDownload(downloadUrl, params.fileName || buildFileName(params.title, params.subtitle, params.quality));

    if (!ok) {
      current.status = "error";
      current.error = "Browser download could not be started";
      this.notify();
      toast({ variant: "destructive", title: "Download failed", description: current.error });
      return;
    }

    current.percent = 100;
    current.status = "complete";
    this.notify();
    toast({ title: "Sent to browser download manager", description: params.subtitle || params.title });
  }
}

export const downloadManager = new DownloadManager();