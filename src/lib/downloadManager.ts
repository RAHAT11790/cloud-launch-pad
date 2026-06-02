import { downloadWithProgress, saveVideo } from "./downloadStore";

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
  urls?: string[];
  fallbackUrl?: string;
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

const cloneDownloads = (downloads: Map<string, ActiveDownload>) => new Map(downloads);

class DownloadManager {
  private downloads = new Map<string, ActiveDownload>();
  private listeners = new Set<(snapshot: DownloadQueueSnapshot) => void>();
  private queuedIds: string[] = [];
  private activeId: string | null = null;
  private sequence = 0;
  private controllers = new Map<string, AbortController>();
  private params = new Map<string, DownloadParams>();

  private emit() {
    const snapshot = this.getSnapshotState();
    this.listeners.forEach((fn) => fn(snapshot));
  }

  private upsertDownload(id: string, patch: Partial<ActiveDownload>) {
    const current = this.downloads.get(id);
    if (!current) return;
    this.downloads.set(id, { ...current, ...patch });
    this.emit();
  }

  private async processQueue() {
    if (this.activeId) return;
    const nextId = this.queuedIds.find((id) => this.downloads.get(id)?.status === "queued");
    if (!nextId) return;

    const params = this.params.get(nextId);
    const item = this.downloads.get(nextId);
    if (!params || !item) return;

    this.activeId = nextId;
    const controller = new AbortController();
    this.controllers.set(nextId, controller);
    this.upsertDownload(nextId, { status: "downloading" });

    const candidates = [params.url, ...(params.urls || []), params.fallbackUrl]
      .filter(Boolean)
      .filter((url, idx, arr) => arr.indexOf(url) === idx) as string[];

    let lastError: unknown = null;
    for (const candidate of candidates) {
      try {
        const blob = await downloadWithProgress(candidate, (percent, loadedMB, totalMB) => {
          this.upsertDownload(nextId, { percent, loadedMB, totalMB, status: "downloading" });
        }, controller.signal);

        await saveVideo({
          id: nextId,
          title: params.title,
          subtitle: params.subtitle,
          poster: params.poster,
          quality: params.quality,
          fileName: params.fileName || buildFileName(params.title, params.subtitle, params.quality),
          sourceUrl: candidate,
          size: blob.size,
          downloadedAt: Date.now(),
          blob,
        });

        this.upsertDownload(nextId, {
          status: "complete",
          percent: 100,
          loadedMB: blob.size / (1024 * 1024),
          totalMB: blob.size / (1024 * 1024),
        });
        break;
      } catch (error: any) {
        lastError = error;
        if (error?.name === "AbortError") {
          const latest = this.downloads.get(nextId);
          if (latest?.status === "cancelled") break;
          this.upsertDownload(nextId, { status: "paused" });
          break;
        }
      }
    }

    const finalState = this.downloads.get(nextId);
    if (finalState && finalState.status !== "complete" && finalState.status !== "paused" && finalState.status !== "cancelled") {
      this.upsertDownload(nextId, { status: "error", error: lastError instanceof Error ? lastError.message : "Download failed" });
    }

    this.controllers.delete(nextId);
    this.activeId = null;
    this.emit();
    void this.processQueue();
  }

  subscribe(fn: (snapshot: DownloadQueueSnapshot) => void) {
    this.listeners.add(fn);
    fn(this.getSnapshotState());
    return () => { this.listeners.delete(fn); };
  }

  getSnapshotState(): DownloadQueueSnapshot {
    const downloads = cloneDownloads(this.downloads);
    const values = Array.from(downloads.values());
    return {
      downloads,
      activeId: this.activeId,
      queuedCount: values.filter((item) => item.status === "queued").length,
      completedCount: values.filter((item) => item.status === "complete").length,
      totalCount: values.filter((item) => item.status !== "cancelled").length,
    };
  }

  getDownload(id: string) { return this.downloads.get(id); }
  isDownloading(id: string) { return this.downloads.get(id)?.status === "downloading"; }

  pauseDownload(id: string) {
    if (this.downloads.get(id)?.status !== "downloading") return;
    this.controllers.get(id)?.abort();
  }

  resumeDownload(id: string) {
    const item = this.downloads.get(id);
    if (!item || item.status !== "paused") return;
    this.upsertDownload(id, { status: "queued" });
    if (!this.queuedIds.includes(id)) this.queuedIds.push(id);
    void this.processQueue();
  }

  cancelDownload(id: string) {
    const item = this.downloads.get(id);
    if (!item) return;
    this.upsertDownload(id, { status: "cancelled" });
    this.queuedIds = this.queuedIds.filter((queuedId) => queuedId !== id);
    if (this.activeId === id) this.controllers.get(id)?.abort();
    this.controllers.delete(id);
    this.emit();
  }

  clearFinished() {
    Array.from(this.downloads.entries()).forEach(([id, item]) => {
      if (["complete", "cancelled", "error"].includes(item.status)) {
        this.downloads.delete(id);
        this.params.delete(id);
        this.controllers.delete(id);
        this.queuedIds = this.queuedIds.filter((queuedId) => queuedId !== id);
      }
    });
    this.emit();
  }

  async startDownload(params: DownloadParams) {
    const existing = this.downloads.get(params.id);
    if (existing && ["queued", "downloading", "paused"].includes(existing.status)) return;

    const sequence = ++this.sequence;
    const item: ActiveDownload = {
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
      queueIndex: this.queuedIds.length + (this.activeId ? 2 : 1),
      totalInBatch: this.queuedIds.length + (this.activeId ? 2 : 1),
      fileName: params.fileName || buildFileName(params.title, params.subtitle, params.quality),
    };

    this.downloads.set(params.id, item);
    this.params.set(params.id, params);
    this.queuedIds.push(params.id);
    this.emit();
    void this.processQueue();
  }

  async enqueueDownload(params: DownloadParams) {
    return this.startDownload(params);
  }
}

export const downloadManager = new DownloadManager();
