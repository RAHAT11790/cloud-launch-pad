import { hasDownload, saveVideo, downloadWithProgress } from "./downloadStore";

export type DownloadStatus = "queued" | "downloading" | "complete" | "error" | "cancelled";

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

  getActive(): Map<string, ActiveDownload> {
    return new Map(this.active);
  }

  getSnapshotState() {
    return this.getSnapshot();
  }

  getDownload(id: string) {
    return this.active.get(id);
  }

  isDownloading(id: string) {
    const item = this.active.get(id);
    return item?.status === "downloading" || item?.status === "queued";
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
      window.setTimeout(() => {
        this.active.delete(id);
        if (this.activeId === id) this.activeId = null;
        this.reindexQueueMeta();
        this.notify();
      }, 220);
    } else {
      this.notify();
    }
  }

  clearFinished() {
    for (const [id, item] of this.active.entries()) {
      if (item.status === "complete" || item.status === "error" || item.status === "cancelled") {
        this.active.delete(id);
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

    const sequence = ++this.sequenceSeed;
    this.queue.push({ ...params, sequence });
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
    });
    this.reindexQueueMeta();
    this.notify();
    void this.processQueue();
  }

  private reindexQueueMeta() {
    const ordered = [
      ...(this.activeId ? [this.activeId] : []),
      ...this.queue.map((item) => item.id),
    ];
    const total = ordered.length || Array.from(this.active.values()).filter((item) => item.status === "complete").length;

    ordered.forEach((id, index) => {
      const item = this.active.get(id);
      if (!item) return;
      item.queueIndex = index + 1;
      item.totalInBatch = Math.max(total, index + 1);
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
        fileName: buildFileName(params.title, params.subtitle, params.quality),
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
        const fileName = buildFileName(params.title, params.subtitle, params.quality);
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
    } catch (error) {
      const current = this.active.get(params.id);
      if (current) {
        if (error instanceof DOMException && error.name === "AbortError") {
          current.status = "cancelled";
        } else {
          current.status = "error";
          current.error = error instanceof Error ? error.message : "Download failed";
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