import { buildVideoDownloadUrl, buildVideoDownloadUrlCandidates, triggerBackgroundVideoDownload } from "./videoDownload";

// HLS/AN downloads are intentionally unsupported in this build — only direct
// HTTP(S) RS files can be downloaded. Detect HLS-style URLs to reject early.
const isHlsUrl = (url: string): boolean => {
  const value = String(url || "").toLowerCase();
  return value.startsWith("data:application/vnd.apple.mpegurl")
    || value.startsWith("data:application/x-mpegurl")
    || /\.m3u8(?:[?#]|$)/i.test(value)
    || /\/hls(?:\/|\?)/i.test(value)
    || /\/an-api\//i.test(value);
};

const AN_DOWNLOAD_BLOCK_MESSAGE = "AN downloads are not supported. Please use our Telegram channel to get this episode.";

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

// Downloads now use native browser anchors (no blob buffering), so multiple
// selected files must be triggered during the original user click. If we queue
// them one-by-one after timers/promises, mobile browsers silently block them.
const MAX_CONCURRENT = 12;

const createFileSafeName = (value: string) =>
  value.replace(/[^a-zA-Z0-9\s\-_]/g, "").replace(/\s+/g, " ").trim();

const buildFileName = (title: string, subtitle?: string, quality?: string) => {
  const parts = [title, subtitle, quality && quality !== "Auto" ? quality : ""]
    .map((part) => createFileSafeName(String(part || "")))
    .filter(Boolean);
  return `${parts.join(" - ") || "video"}.mp4`;
};

const decodeDataUriBytes = (value: string): number => {
  const raw = String(value || "").trim();
  if (!raw.toLowerCase().startsWith("data:")) return 0;
  const comma = raw.indexOf(",");
  if (comma < 0) return 0;
  const meta = raw.slice(0, comma).toLowerCase();
  const payload = raw.slice(comma + 1);
  try {
    if (meta.includes(";base64")) return Uint8Array.from(atob(payload), (c) => c.charCodeAt(0)).byteLength;
    return new TextEncoder().encode(decodeURIComponent(payload)).byteLength;
  } catch {
    return 0;
  }
};

interface ItemTimers {
  trigger?: number;
  finish?: number;
}

const SIZE_CACHE_KEY = "rs_dl_size_cache_v1";
const bytesToMb = (bytes: number) => bytes > 0 ? bytes / (1024 * 1024) : 0;
const timeoutSignal = (ms: number) => {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => window.clearTimeout(timer) };
};
const isAbortError = (error: unknown) => {
  const name = (error as { name?: string })?.name || "";
  return name === "AbortError" || /aborted/i.test(String((error as { message?: string })?.message || error || ""));
};

class DownloadManager {
  private downloads = new Map<string, ActiveDownload>();
  private listeners = new Set<Subscriber>();
  private queue: string[] = [];
  private activeIds = new Set<string>();
  private lastStartedId: string | null = null;
  private timers = new Map<string, ItemTimers>();
  private controllers = new Map<string, AbortController>();
  private sequence = 0;

  private isProxyDownloadUrl(url: string) {
    return /\/functions\/v1\/(video-download|video-proxy)\?/i.test(String(url || ""));
  }

  private async fetchContentLength(url: string, init?: RequestInit): Promise<number> {
    const timeout = timeoutSignal(2400);
    try {
      const response = await fetch(url, { ...init, signal: init?.signal || timeout.signal });
      if (!response.ok && response.status !== 206) {
        try { await response.body?.cancel(); } catch {}
        return 0;
      }
      const contentType = String(response.headers.get("content-type") || "").toLowerCase();
      if (/json|text\/html/.test(contentType)) {
        try { await response.body?.cancel(); } catch {}
        return 0;
      }
      const len = response.headers.get("content-length");
      if (len && Number(len) > 512 * 1024) {
        try { await response.body?.cancel(); } catch {}
        return Number(len);
      }
      const range = response.headers.get("content-range");
      if (range) {
        const match = /\/(\d+)\s*$/.exec(range);
        if (match && Number(match[1]) > 0) {
          try { await response.body?.cancel(); } catch {}
          return Number(match[1]);
        }
      }
      try { await response.body?.cancel(); } catch {}
    } catch {}
    finally { timeout.cancel(); }
    return 0;
  }

  private readCachedSize(url: string): number {
    try {
      const cache = JSON.parse(localStorage.getItem(SIZE_CACHE_KEY) || "{}");
      const bytes = Number(cache?.[url] || 0);
      return Number.isFinite(bytes) && bytes > 512 * 1024 ? bytes : 0;
    } catch {
      return 0;
    }
  }

  private writeCachedSize(url: string, bytes: number) {
    if (!url || !bytes || bytes <= 0) return;
    try {
      const cache = JSON.parse(localStorage.getItem(SIZE_CACHE_KEY) || "{}");
      cache[url] = Math.round(bytes);
      localStorage.setItem(SIZE_CACHE_KEY, JSON.stringify(cache));
    } catch {}
  }

  private resolveHttpDownloadUrl(url: string, fileName: string) {
    const raw = String(url || "").trim();
    if (!raw || raw.toLowerCase().startsWith("data:") || isHlsUrl(raw)) return raw;
    if (/^https?:\/\//i.test(raw)) return buildVideoDownloadUrl(raw, fileName) || raw;
    return raw;
  }

  private resolveHttpDownloadCandidates(url: string, fileName: string) {
    const raw = String(url || "").trim();
    if (!raw || raw.toLowerCase().startsWith("data:") || isHlsUrl(raw)) return raw ? [raw] : [];
    if (!/^https?:\/\//i.test(raw)) return raw ? [raw] : [];
    return Array.from(new Set([
      ...buildVideoDownloadUrlCandidates(raw, fileName),
      buildVideoDownloadUrl(raw, fileName) || "",
    ].filter(Boolean)));
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

  private abortItem(id: string) {
    try { this.controllers.get(id)?.abort(); } catch {}
    this.controllers.delete(id);
  }

  private settleItem(id: string, status: DownloadStatus, patch: Partial<ActiveDownload> = {}) {
    this.clearItemTimers(id);
    const current = this.downloads.get(id);
    if (current) {
      const knownTotal = Math.max(Number(patch.totalMB ?? 0), current.totalMB || 0, current.loadedMB || 0);
      this.downloads.set(id, {
        ...current,
        status,
        percent: status === "complete" ? 100 : current.percent,
        loadedMB: status === "complete" && knownTotal > 0 ? Math.max(current.loadedMB, knownTotal) : current.loadedMB,
        totalMB: knownTotal,
        ...patch,
      });
    }
    this.controllers.delete(id);
    this.activeIds.delete(id);
    if (this.lastStartedId === id) this.lastStartedId = null;
    this.emit();
    this.pump();
  }

  private async fetchTotalSize(url: string): Promise<number> {
    const candidate = String(url || "").trim();
    if (!candidate) return 0;
    const cached = this.readCachedSize(candidate);
    if (cached > 0) return cached;
    if (isHlsUrl(candidate)) return 0;
    if (candidate.toLowerCase().startsWith("data:")) return decodeDataUriBytes(candidate);
    const probeTargets = this.resolveHttpDownloadCandidates(candidate, "probe.mp4");
    const probePlans: RequestInit[] = [
      { method: "HEAD", mode: "cors" },
      { method: "GET", headers: { Range: "bytes=0-0" }, mode: "cors" },
    ];

    for (const probeTarget of probeTargets) {
      if (!/^https?:\/\//i.test(probeTarget)) continue;
      for (const init of probePlans) {
        const length = await this.fetchContentLength(probeTarget, init);
        if (length > 0) {
          this.writeCachedSize(candidate, length);
          return length;
        }
      }
    }
    return 0;
  }

  private prefetchTotalSize(id: string, url?: string) {
    if (!url) return;
    const cached = this.readCachedSize(url);
    if (cached > 0) {
      this.update(id, { totalMB: bytesToMb(cached) });
      return;
    }
    this.fetchTotalSize(url).then((bytes) => {
      const latest = this.downloads.get(id);
      if (!latest || latest.status === "cancelled") return;
      if (bytes > 0) this.update(id, { totalMB: bytesToMb(bytes) });
    }).catch(() => {});
  }

  private async runItemDownload(id: string, controller: AbortController) {
    const item = this.downloads.get(id);
    if (!item || item.status !== "downloading") return;
    if (!item.url) {
      this.settleItem(id, "error", { error: "Download link is invalid" });
      return;
    }

    const rawUrl = String(item.url || "").trim();
    const fileName = item.fileName || buildFileName(item.title, item.subtitle, item.quality);

    if (isHlsUrl(rawUrl)) {
      this.settleItem(id, "error", { error: AN_DOWNLOAD_BLOCK_MESSAGE });
      return;
    }

    this.update(id, { fileName, percent: 3, loadedMB: 0 });

    // Permanent browser-native flow: do NOT buffer large MP4 files into the web
    // app/installed PWA. The proxy returns attachment + renamed filename, and
    // the browser's own download manager handles pause/resume safely.
    try {
      const triggered = triggerBackgroundVideoDownload(rawUrl, fileName);
      if (!triggered) {
        this.settleItem(id, "error", { error: "Download service is unavailable" });
        return;
      }
      this.update(id, { percent: 35 });
      const bytes = await Promise.race([
        this.fetchTotalSize(rawUrl),
        new Promise<number>((resolve) => window.setTimeout(() => resolve(0), 2200)),
      ]);
      if (controller.signal.aborted) return;
      const totalMB = bytes > 0 ? bytesToMb(bytes) : Math.max(this.downloads.get(id)?.totalMB || 0, this.downloads.get(id)?.loadedMB || 0);
      this.settleItem(id, "complete", { percent: 100, loadedMB: totalMB, totalMB });
    } catch (error) {
      if (isAbortError(error)) return;
      this.settleItem(id, "error", { error: error instanceof Error ? error.message : "Download failed" });
    } finally {
      if (this.controllers.get(id) === controller) this.controllers.delete(id);
    }
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
      percent: 1,
      loadedMB: 0,
      totalMB: Math.max(item.totalMB || 0, 0),
    });
    this.emit();

    this.prefetchTotalSize(id, item.url);

    const controller = new AbortController();
    this.controllers.set(id, controller);

    void this.runItemDownload(id, controller);
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
      this.abortItem(id);
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
      this.abortItem(id);
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
      totalMB: 0,
      status: "queued",
      sequence: this.sequence,
      queueIndex: 1,
      totalInBatch: 1,
      fileName,
    });
    this.queue.push(params.id);
    this.emit();
    this.prefetchTotalSize(params.id, params.url);
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
      totalMB: 0,
      status: "queued",
      sequence: this.sequence,
      queueIndex: batchSize,
      totalInBatch: batchSize,
      fileName,
    });
    this.queue.push(params.id);
    this.emit();
    this.prefetchTotalSize(params.id, params.url);
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
        totalMB: 0,
        status: "queued",
        sequence: this.sequence,
        queueIndex: idx + 1,
        totalInBatch: total,
        fileName,
      });
      this.queue.push(params.id);
      this.prefetchTotalSize(params.id, params.url);
    });
    this.emit();
    this.pump();
  }

  /**
   * Register an externally requested download and run it through the same real
   * downloader so RS bulk items also get progress, size, and a saved file.
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
      percent: 0,
      loadedMB: 0,
      totalMB: 0,
      status: "queued",
      sequence: this.sequence,
      queueIndex: 1,
      totalInBatch: 1,
      fileName,
    });
    this.queue.push(params.id);
    this.emit();
    this.prefetchTotalSize(params.id, params.url);
    this.pump();
  }
}

export const downloadManager = new DownloadManager();
