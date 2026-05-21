import { toast } from "@/hooks/use-toast";

import { hasDownload, saveVideo, downloadWithProgress } from "./downloadStore";

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

const isStandaloneMode = () => {
  if (typeof window === "undefined") return false;
  return !!(
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
};

class DownloadManager {
  private active = new Map<string, ActiveDownload>();
  private listeners = new Set<Listener>();
  private abortControllers = new Map<string, AbortController>();
  private requests = new Map<string, DownloadParams>();
  private pauseRequested = new Set<string>();
  private queue: QueueItem[] = [];
  private processing = false;
  private activeId: string | null = null;
  private sequenceSeed = 0;

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

    const controller = this.abortControllers.get(id);
    if (controller) {
      this.pauseRequested.add(id);
      controller.abort();
    }
  }

  resumeDownload(id: string) {
    const request = this.requests.get(id);
    const item = this.active.get(id);
    if (!request || !item || item.status !== "paused") return;
    if (this.queue.some((queued) => queued.id === id) || this.activeId === id) return;

    item.status = "queued";
    item.percent = 0;
    item.loadedMB = 0;
    item.totalMB = 0;
    item.error = undefined;

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

    const controller = this.abortControllers.get(id);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(id);
    }

    const existing = this.active.get(id);
    if (existing) {
      existing.status = "cancelled";
      this.notify();
      toast({
        title: "Download cancelled",
        description: existing.subtitle || existing.title,
      });
      window.setTimeout(() => {
        this.active.delete(id);
        this.requests.delete(id);
        this.pauseRequested.delete(id);
        if (this.activeId === id) this.activeId = null;
        this.reindexQueueMeta();
        this.notify();
      }, 220);
    } else {
      this.requests.delete(id);
      this.pauseRequested.delete(id);
      this.notify();
    }
  }

  clearFinished() {
    for (const [id, item] of this.active.entries()) {
      if (item.status === "complete" || item.status === "error" || item.status === "cancelled") {
        this.active.delete(id);
        this.requests.delete(id);
        this.pauseRequested.delete(id);
      }
    }
    this.notify();
  }

  async startDownload(params: DownloadParams) {
    return this.enqueueDownload(params);
  }

  async enqueueDownload(params: DownloadParams) {
    if (!params.url?.startsWith("https://")) {
      throw new Error("Only HTTPS download servers are allowed");
    }

    if (this.active.has(params.id) || this.queue.some((item) => item.id === params.id)) return;
    if (await hasDownload(params.id)) return;

    const normalized = {
      ...params,
      fileName: params.fileName || buildFileName(params.title, params.subtitle, params.quality),
    };

    this.requests.set(params.id, normalized);

    const sequence = ++this.sequenceSeed;
    this.queue.push({ ...normalized, sequence });
    this.active.set(params.id, {
      id: params.id,
      title: params.title,
      subtitle: params.subtitle,
      poster: params.poster,
      quality: params.quality,
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
    toast({
      title: "Download queued",
      description: params.subtitle || params.title,
    });
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
    if (!entry) return;

    entry.status = "downloading";
    entry.error = undefined;
    this.notify();
    toast({
      title: "Download started",
      description: params.subtitle || params.title,
    });

    const abortController = new AbortController();
    this.abortControllers.set(params.id, abortController);

    try {
      const blob = await downloadWithProgress(
        params.url,
        (percent, loadedMB, totalMB) => {
          const current = this.active.get(params.id);
          if (!current) return;
          current.percent = percent;
          current.loadedMB = loadedMB;
          current.totalMB = totalMB;
          this.notify();
        },
        abortController.signal,
      );

      await saveVideo({
        id: params.id,
        title: params.title,
        subtitle: params.subtitle,
        poster: params.poster,
        quality: params.quality,
        fileName: params.fileName || buildFileName(params.title, params.subtitle, params.quality),
        sourceUrl: params.url,
        size: blob.size,
        downloadedAt: Date.now(),
        blob,
      });

      const current = this.active.get(params.id);
      if (current) {
        current.percent = 100;
        current.loadedMB = blob.size / (1024 * 1024);
        current.totalMB = blob.size / (1024 * 1024);
        current.status = "complete";
      }

      if (!isStandaloneMode()) {
        const fileName = params.fileName || buildFileName(params.title, params.subtitle, params.quality);
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = fileName;
        a.rel = "noopener noreferrer";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
      }

      this.notify();
      toast({
        title: "Download complete",
        description: params.subtitle || params.title,
      });
    } catch (error) {
      const current = this.active.get(params.id);
      if (current) {
        if (error instanceof DOMException && error.name === "AbortError") {
          if (this.pauseRequested.has(params.id)) {
            this.pauseRequested.delete(params.id);
            current.status = "paused";
            toast({
              title: "Download paused",
              description: params.subtitle || params.title,
            });
          } else {
            current.status = "cancelled";
          }
        } else {
          current.status = "error";
          current.error = error instanceof Error ? error.message : "Download failed";
          toast({
            variant: "destructive",
            title: "Download failed",
            description: current.error,
          });
        }
      }
      this.notify();
    } finally {
      this.abortControllers.delete(params.id);
      if (this.activeId === params.id) this.activeId = null;
      this.reindexQueueMeta();
      this.notify();
    }
  }
}

export const downloadManager = new DownloadManager();