// Global singleton download manager - state persists across navigation
import { hasDownload, saveVideo, downloadWithProgress } from "./downloadStore";

export interface ActiveDownload {
  id: string;
  title: string;
  subtitle?: string;
  poster?: string;
  quality: string;
  percent: number;
  loadedMB: number;
  totalMB: number;
  status: "downloading" | "paused" | "complete" | "error";
}

type Listener = (downloads: Map<string, ActiveDownload>) => void;

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
  private abortControllers = new Map<string, AbortController>();
  private pausedUrls = new Map<string, { url: string; loadedBytes: number }>();
  private listeners = new Set<Listener>();
  // Serial queue: only one download runs at a time
  private queue: Array<{ id: string; url: string; title: string; subtitle?: string; poster?: string; quality: string }> = [];
  private processing = false;

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    fn(new Map(this.active));
    return () => { this.listeners.delete(fn); };
  }

  private notify() {
    const snapshot = new Map(this.active);
    this.listeners.forEach(fn => fn(snapshot));
  }

  isDownloading(id: string) {
    const d = this.active.get(id);
    return d?.status === "downloading";
  }

  getActive(): Map<string, ActiveDownload> {
    return new Map(this.active);
  }

  cancelDownload(id: string) {
    const controller = this.abortControllers.get(id);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(id);
    }
    this.pausedUrls.delete(id);
    this.active.delete(id);
    this.notify();
  }

  pauseDownload(id: string) {
    const entry = this.active.get(id);
    if (!entry || entry.status !== "downloading") return;
    
    const controller = this.abortControllers.get(id);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(id);
    }
    
    entry.status = "paused";
    this.notify();
  }

  async resumeDownload(id: string) {
    const entry = this.active.get(id);
    const pausedInfo = this.pausedUrls.get(id);
    if (!entry || entry.status !== "paused" || !pausedInfo) return;
    if (await hasDownload(id)) {
      this.pausedUrls.delete(id);
      this.active.delete(id);
      this.notify();
      return;
    }

    const abortController = new AbortController();
    this.abortControllers.set(id, abortController);
    entry.status = "downloading";
    this.notify();

    try {
      const blob = await downloadWithProgress(pausedInfo.url, (percent, loadedMB, totalMB) => {
        const e = this.active.get(id);
        if (e) {
          e.percent = percent;
          e.loadedMB = loadedMB;
          e.totalMB = totalMB;
          this.notify();
        }
      }, abortController.signal);

      this.abortControllers.delete(id);
      this.pausedUrls.delete(id);

      const fileName = buildFileName(entry.title, entry.subtitle, entry.quality);

      await saveVideo({
        id, title: entry.title, subtitle: entry.subtitle, poster: entry.poster,
        quality: entry.quality, fileName, sourceUrl: pausedInfo.url, size: blob.size, downloadedAt: Date.now(), blob,
      });

      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl; a.download = fileName;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);

      const e2 = this.active.get(id);
      if (e2) { e2.percent = 100; e2.status = "complete"; this.notify(); }
      setTimeout(() => { this.active.delete(id); this.notify(); }, 3000);

    } catch (err) {
      this.abortControllers.delete(id);
      if (err instanceof DOMException && err.name === "AbortError") {
        // Paused again
        const e = this.active.get(id);
        if (e && e.status !== "paused") { this.active.delete(id); }
        this.notify();
        return;
      }
      const e = this.active.get(id);
      if (e) { e.status = "error"; this.notify(); }
      setTimeout(() => { this.active.delete(id); this.notify(); }, 3000);
    }
  }

  async startDownload(params: {
    id: string;
    url: string;
    title: string;
    subtitle?: string;
    poster?: string;
    quality: string;
  }) {
    const { id, url, title, subtitle, poster, quality } = params;

    if (this.isDownloading(id)) return;
    if (await hasDownload(id)) return;

    // If paused, resume instead
    if (this.active.get(id)?.status === "paused") {
      return this.resumeDownload(id);
    }

    const abortController = new AbortController();
    this.abortControllers.set(id, abortController);
    this.pausedUrls.set(id, { url, loadedBytes: 0 });

    this.active.set(id, {
      id, title, subtitle, poster, quality,
      percent: 0, loadedMB: 0, totalMB: 0,
      status: "downloading",
    });
    this.notify();

    try {
      const blob = await downloadWithProgress(url, (percent, loadedMB, totalMB) => {
        const entry = this.active.get(id);
        if (entry) {
          entry.percent = percent;
          entry.loadedMB = loadedMB;
          entry.totalMB = totalMB;
          this.notify();
        }
      }, abortController.signal);

      this.abortControllers.delete(id);
      this.pausedUrls.delete(id);

      const fileName = buildFileName(title, subtitle, quality);

      await saveVideo({
        id, title, subtitle, poster, quality, fileName,
        sourceUrl: url,
        size: blob.size,
        downloadedAt: Date.now(),
        blob,
      });

      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);

      const entry = this.active.get(id);
      if (entry) {
        entry.percent = 100;
        entry.status = "complete";
        this.notify();
      }

      setTimeout(() => {
        this.active.delete(id);
        this.notify();
      }, 3000);

    } catch (err) {
      this.abortControllers.delete(id);
      
      // If cancelled, just clean up silently
      if (err instanceof DOMException && err.name === "AbortError") {
        const entry = this.active.get(id);
        if (entry && entry.status !== "paused") {
          this.active.delete(id);
          this.pausedUrls.delete(id);
        }
        this.notify();
        return;
      }

      // CORS / network failure on cross-origin direct media (e.g. render.com,
      // bot-hosting). Fall back to a plain browser download — let the browser
      // handle the file directly without progress tracking.
      try {
        const a = document.createElement("a");
        a.href = url;
        const safeName = createFileSafeName(`${title}${subtitle ? ` - ${subtitle}` : ""}${quality && quality !== "Auto" ? ` - ${quality}` : ""}`) || "video";
        a.download = `${safeName}.mp4`;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        const entry = this.active.get(id);
        if (entry) { entry.status = "complete"; entry.percent = 100; this.notify(); }
        setTimeout(() => { this.active.delete(id); this.notify(); }, 2500);
        this.pausedUrls.delete(id);
        return;
      } catch { /* fall through to error state */ }

      const entry = this.active.get(id);
      if (entry) {
        entry.status = "error";
        this.notify();
      }
      this.pausedUrls.delete(id);
      setTimeout(() => {
        this.active.delete(id);
        this.notify();
      }, 3000);
    }
  }

  /** Add a download to the serial queue. Only ONE runs at a time. */
  enqueueDownload(params: {
    id: string;
    url: string;
    title: string;
    subtitle?: string;
    poster?: string;
    quality: string;
  }) {
    // Already active or queued? Skip duplicates.
    if (this.active.has(params.id)) return;
    if (this.queue.find(q => q.id === params.id)) return;

    hasDownload(params.id).then((exists) => {
      if (exists) return;

      this.queue.push(params);
      // Show as a placeholder "queued" entry so UI lists it
      this.active.set(params.id, {
        id: params.id,
        title: params.title,
        subtitle: params.subtitle,
        poster: params.poster,
        quality: params.quality,
        percent: 0,
        loadedMB: 0,
        totalMB: 0,
        status: "paused", // visually "waiting"
      });
      this.notify();
      this.processQueue();
    });
  }

  private async processQueue() {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.queue.length > 0) {
        const next = this.queue.shift()!;
        // Remove placeholder so startDownload re-creates as "downloading"
        this.active.delete(next.id);
        await this.startDownload(next);
      }
    } finally {
      this.processing = false;
    }
  }
}

// Singleton
export const downloadManager = new DownloadManager();
