// Global singleton download manager - state persists across navigation
import { saveVideo, downloadWithProgress } from "./downloadStore";

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

class DownloadManager {
  private active = new Map<string, ActiveDownload>();
  private abortControllers = new Map<string, AbortController>();
  private pausedUrls = new Map<string, { url: string; loadedBytes: number }>();
  private listeners = new Set<Listener>();

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

      const qualitySuffix = entry.quality && entry.quality !== "Auto" ? ` - ${entry.quality}` : "";
      const safeName = createFileSafeName(`${entry.title}${entry.subtitle ? ` - ${entry.subtitle}` : ""}${qualitySuffix}`) || "video";
      const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
      const fileName = `${safeName}-${stamp}.mp4`;

      await saveVideo({
        id, title: entry.title, subtitle: entry.subtitle, poster: entry.poster,
        quality: entry.quality, fileName, size: blob.size, downloadedAt: Date.now(), blob,
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

      const qualitySuffix = quality && quality !== "Auto" ? ` - ${quality}` : "";
      const safeName = createFileSafeName(`${title}${subtitle ? ` - ${subtitle}` : ""}${qualitySuffix}`) || "video";
      const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
      const fileName = `${safeName}-${stamp}.mp4`;

      await saveVideo({
        id, title, subtitle, poster, quality, fileName,
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

      const entry = this.active.get(id);
      if (entry) {
        entry.status = "error";
        this.notify();
      }
      this.pausedUrls.delete(id);
      window.open(url, "_blank");
      setTimeout(() => {
        this.active.delete(id);
        this.notify();
      }, 3000);
    }
  }
}

// Singleton
export const downloadManager = new DownloadManager();
