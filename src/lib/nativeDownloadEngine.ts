// ===========================================================================
// RS ANIME03 — Android native download engine
// ---------------------------------------------------------------------------
// Inside the Android app there is no proxy and no rename problem:
//   * RS files (http/https) stream straight from the source URL.
//   * AN/HLS episodes are fetched segment-by-segment and merged locally,
//     keeping every audio track so the offline player can switch language.
// Downloads run strictly ONE AT A TIME, in the order the user queued them,
// and an ongoing Android notification shows the anime poster, the episode
// position ("Episode 3 of 12") and a live progress bar.
// ===========================================================================

import { saveVideo, type DownloadedVideo } from "@/lib/downloadStore";
import { isNativeApp } from "@/lib/nativeRuntime";

export type NativeTaskStatus = "queued" | "downloading" | "complete" | "error" | "cancelled";

export interface NativeTask {
  id: string;
  url: string;
  title: string;            // anime / series name
  episodeLabel?: string;    // "Episode 3", "Part 2"
  episodeNumber?: number;
  poster?: string;
  quality?: string;
  kind: "rs" | "an";
  status: NativeTaskStatus;
  percent: number;
  loadedMB: number;
  totalMB: number;
  error?: string;
  createdAt: number;
}

type Listener = (state: NativeEngineState) => void;

export interface NativeEngineState {
  tasks: NativeTask[];
  activeId: string | null;
  completed: number;
  total: number;
}

const NOTIFICATION_ID = 7301;
const safeName = (value: string) => String(value || "").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();

const buildFileName = (task: NativeTask) => {
  const parts = [task.title, task.episodeLabel, task.quality && task.quality !== "Auto" ? task.quality : ""]
    .map((part) => safeName(String(part || "")))
    .filter(Boolean);
  const ext = task.kind === "an" ? "ts" : "mp4";
  return `${parts.join(" - ") || "video"}.${ext}`;
};

const toMb = (bytes: number) => (bytes > 0 ? bytes / (1024 * 1024) : 0);

const resolveUrl = (base: string, rel: string) => {
  try { return new URL(rel, base).toString(); } catch { return rel; }
};

// --------------------------------------------------------------------------
// HLS helpers (no external dependency — plain playlist parsing)
// --------------------------------------------------------------------------
interface HlsAudio { label: string; lang?: string; uri: string }

const parseMaster = (text: string, baseUrl: string) => {
  const lines = text.split(/\r?\n/);
  const variants: { bandwidth: number; uri: string; audioGroup?: string }[] = [];
  const audios: (HlsAudio & { group: string })[] = [];

  lines.forEach((line, i) => {
    if (line.startsWith("#EXT-X-STREAM-INF")) {
      const bandwidth = Number(/BANDWIDTH=(\d+)/.exec(line)?.[1] || 0);
      const audioGroup = /AUDIO="([^"]+)"/.exec(line)?.[1];
      const uri = (lines[i + 1] || "").trim();
      if (uri && !uri.startsWith("#")) variants.push({ bandwidth, uri: resolveUrl(baseUrl, uri), audioGroup });
    }
    if (line.startsWith("#EXT-X-MEDIA") && /TYPE=AUDIO/.test(line)) {
      const uri = /URI="([^"]+)"/.exec(line)?.[1];
      if (!uri) return;
      audios.push({
        group: /GROUP-ID="([^"]+)"/.exec(line)?.[1] || "audio",
        label: /NAME="([^"]+)"/.exec(line)?.[1] || "Audio",
        lang: /LANGUAGE="([^"]+)"/.exec(line)?.[1],
        uri: resolveUrl(baseUrl, uri),
      });
    }
  });

  variants.sort((a, b) => b.bandwidth - a.bandwidth);
  return { variants, audios };
};

const parseSegments = (text: string, baseUrl: string) => {
  const segments: string[] = [];
  let mapUri = "";
  text.split(/\r?\n/).forEach((raw) => {
    const line = raw.trim();
    if (!line) return;
    if (line.startsWith("#EXT-X-MAP")) {
      const uri = /URI="([^"]+)"/.exec(line)?.[1];
      if (uri) mapUri = resolveUrl(baseUrl, uri);
      return;
    }
    if (line.startsWith("#")) return;
    segments.push(resolveUrl(baseUrl, line));
  });
  return { segments, mapUri };
};

export const isHlsSource = (url: string) => {
  const value = String(url || "").toLowerCase();
  return /\.m3u8(?:[?#]|$)/.test(value)
    || value.startsWith("data:application/vnd.apple.mpegurl")
    || value.startsWith("data:application/x-mpegurl")
    || /\/hls(?:\/|\?)/.test(value)
    || /an-(?:api|playback)/.test(value);
};

// --------------------------------------------------------------------------
// Engine
// --------------------------------------------------------------------------
class NativeDownloadEngine {
  private tasks = new Map<string, NativeTask>();
  private order: string[] = [];
  private listeners = new Set<Listener>();
  private activeId: string | null = null;
  private controller: AbortController | null = null;
  private running = false;
  private notificationsReady: Promise<boolean> | null = null;

  // ---------------- state ----------------
  private state(): NativeEngineState {
    const tasks = this.order.map((id) => this.tasks.get(id)!).filter(Boolean);
    return {
      tasks,
      activeId: this.activeId,
      completed: tasks.filter((t) => t.status === "complete").length,
      total: tasks.filter((t) => t.status !== "cancelled").length,
    };
  }

  private emit() {
    const snapshot = this.state();
    this.listeners.forEach((fn) => fn(snapshot));
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    fn(this.state());
    return () => { this.listeners.delete(fn); };
  }

  getState() { return this.state(); }

  private patch(id: string, patch: Partial<NativeTask>) {
    const current = this.tasks.get(id);
    if (!current) return;
    this.tasks.set(id, { ...current, ...patch });
    this.emit();
  }

  // ---------------- notifications ----------------
  private async notifier() {
    if (!isNativeApp()) return null;
    try {
      const mod = await import("@capacitor/local-notifications");
      const plugin = mod.LocalNotifications;
      if (!this.notificationsReady) {
        this.notificationsReady = plugin.requestPermissions()
          .then((res: any) => res?.display === "granted")
          .catch(() => false);
      }
      return (await this.notificationsReady) ? plugin : null;
    } catch {
      return null;
    }
  }

  private async showProgressNotification(task: NativeTask) {
    const plugin = await this.notifier();
    if (!plugin) return;
    const position = this.queuePosition(task.id);
    const bar = this.progressBar(task.percent);
    try {
      await plugin.schedule({
        notifications: [{
          id: NOTIFICATION_ID,
          title: `⬇ ${task.title}`,
          body: `${task.episodeLabel || "Video"} · ${position.index} of ${position.total}\n${bar} ${task.percent}%`,
          largeBody: `${bar} ${task.percent}%  (${task.loadedMB.toFixed(1)} MB${task.totalMB ? ` / ${task.totalMB.toFixed(1)} MB` : ""})`,
          summaryText: "RS ANIME03 downloads",
          ongoing: true,
          autoCancel: false,
          largeIcon: task.poster || undefined,
          smallIcon: "ic_stat_notification_badge",
        }],
      });
    } catch {}
  }

  private async finishNotification(task: NativeTask, ok: boolean) {
    const plugin = await this.notifier();
    if (!plugin) return;
    const pending = this.order.filter((id) => this.tasks.get(id)?.status === "queued").length;
    try {
      await plugin.schedule({
        notifications: [{
          id: NOTIFICATION_ID,
          title: ok ? `✓ ${task.title}` : `✕ ${task.title}`,
          body: ok
            ? `${task.episodeLabel || "Video"} saved for offline${pending ? ` · ${pending} left in queue` : ""}`
            : `${task.episodeLabel || "Video"} failed — ${task.error || "try again"}`,
          ongoing: false,
          autoCancel: true,
          largeIcon: task.poster || undefined,
          smallIcon: "ic_stat_notification_badge",
        }],
      });
    } catch {}
  }

  private progressBar(percent: number) {
    const filled = Math.max(0, Math.min(10, Math.round(percent / 10)));
    return `${"█".repeat(filled)}${"░".repeat(10 - filled)}`;
  }

  private queuePosition(id: string) {
    const live = this.order.filter((taskId) => this.tasks.get(taskId)?.status !== "cancelled");
    return { index: Math.max(1, live.indexOf(id) + 1), total: Math.max(1, live.length) };
  }

  // ---------------- queueing ----------------
  enqueue(input: Omit<NativeTask, "status" | "percent" | "loadedMB" | "totalMB" | "createdAt" | "kind"> & { kind?: NativeTask["kind"] }) {
    const kind: NativeTask["kind"] = input.kind || (isHlsSource(input.url) ? "an" : "rs");
    const task: NativeTask = {
      ...input,
      kind,
      status: "queued",
      percent: 0,
      loadedMB: 0,
      totalMB: 0,
      createdAt: Date.now(),
    };
    this.tasks.set(task.id, task);
    if (!this.order.includes(task.id)) this.order.push(task.id);
    this.emit();
    void this.pump();
  }

  enqueueBatch(items: Parameters<NativeDownloadEngine["enqueue"]>[0][]) {
    items.forEach((item) => this.enqueue(item));
  }

  cancel(id: string) {
    const task = this.tasks.get(id);
    if (!task) return;
    if (this.activeId === id) {
      try { this.controller?.abort(); } catch {}
    }
    this.patch(id, { status: "cancelled", percent: 0 });
  }

  clearFinished() {
    this.order = this.order.filter((id) => {
      const status = this.tasks.get(id)?.status;
      if (status && ["complete", "cancelled", "error"].includes(status)) {
        this.tasks.delete(id);
        return false;
      }
      return true;
    });
    this.emit();
  }

  isQueued(id: string) {
    const status = this.tasks.get(id)?.status;
    return status === "queued" || status === "downloading";
  }

  // ---------------- runner ----------------
  private async pump() {
    if (this.running) return;
    this.running = true;
    try {
      while (true) {
        const nextId = this.order.find((id) => this.tasks.get(id)?.status === "queued");
        if (!nextId) break;
        await this.run(nextId);
      }
    } finally {
      this.running = false;
      this.activeId = null;
      this.emit();
    }
  }

  private async run(id: string) {
    const task = this.tasks.get(id);
    if (!task) return;
    this.activeId = id;
    this.controller = new AbortController();
    this.patch(id, { status: "downloading", percent: 1, loadedMB: 0 });
    void this.showProgressNotification(this.tasks.get(id)!);

    let lastNotify = 0;
    const onProgress = (percent: number, loadedMB: number, totalMB: number) => {
      this.patch(id, { percent, loadedMB, totalMB });
      const now = Date.now();
      if (now - lastNotify > 1200) {
        lastNotify = now;
        const latest = this.tasks.get(id);
        if (latest) void this.showProgressNotification(latest);
      }
    };

    try {
      const fileName = buildFileName(task);
      const record: DownloadedVideo = task.kind === "an"
        ? await this.downloadHls(task, fileName, onProgress, this.controller.signal)
        : await this.downloadDirect(task, fileName, onProgress, this.controller.signal);

      await saveVideo(record);
      this.patch(id, { status: "complete", percent: 100 });
      void this.finishNotification(this.tasks.get(id)!, true);
    } catch (error: any) {
      const aborted = error?.name === "AbortError";
      this.patch(id, {
        status: aborted ? "cancelled" : "error",
        error: aborted ? undefined : String(error?.message || "Download failed"),
      });
      if (!aborted) void this.finishNotification(this.tasks.get(id)!, false);
    } finally {
      this.controller = null;
    }
  }

  // Direct source download — http OR https, no proxy, native rename via fileName.
  private async downloadDirect(
    task: NativeTask,
    fileName: string,
    onProgress: (p: number, l: number, t: number) => void,
    signal: AbortSignal,
  ): Promise<DownloadedVideo> {
    const res = await fetch(task.url, { signal });
    if (!res.ok) throw new Error(`Source responded ${res.status}`);
    const total = Number(res.headers.get("content-length") || 0);
    const reader = res.body?.getReader();
    if (!reader) throw new Error("Source stream unavailable");

    const chunks: BlobPart[] = [];
    let loaded = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value as unknown as BlobPart);
      loaded += value!.length;
      onProgress(total ? Math.min(99, Math.round((loaded / total) * 100)) : 0, toMb(loaded), toMb(total));
    }
    const blob = new Blob(chunks, { type: "video/mp4" });
    onProgress(100, toMb(blob.size), toMb(blob.size));
    return this.buildRecord(task, fileName, blob, "video/mp4");
  }

  // HLS/AN download — merge segments locally and keep every audio track.
  private async downloadHls(
    task: NativeTask,
    fileName: string,
    onProgress: (p: number, l: number, t: number) => void,
    signal: AbortSignal,
  ): Promise<DownloadedVideo> {
    const masterText = await (await fetch(task.url, { signal })).text();
    let mediaUrl = task.url;
    let audioTracks: HlsAudio[] = [];

    if (/#EXT-X-STREAM-INF/.test(masterText)) {
      const { variants, audios } = parseMaster(masterText, task.url);
      if (!variants.length) throw new Error("No playable HLS variant found");
      mediaUrl = variants[0].uri;
      const group = variants[0].audioGroup;
      audioTracks = audios.filter((audio) => !group || audio.group === group);
    }

    const mediaText = mediaUrl === task.url ? masterText : await (await fetch(mediaUrl, { signal })).text();
    const { segments, mapUri } = parseSegments(mediaText, mediaUrl);
    if (!segments.length) throw new Error("HLS playlist has no segments");

    const audioPlaylists = await Promise.all(audioTracks.map(async (audio) => {
      try {
        const text = await (await fetch(audio.uri, { signal })).text();
        return { audio, ...parseSegments(text, audio.uri) };
      } catch {
        return null;
      }
    }));
    const liveAudio = audioPlaylists.filter(Boolean) as { audio: HlsAudio; segments: string[]; mapUri: string }[];

    const totalUnits = segments.length + liveAudio.reduce((sum, entry) => sum + entry.segments.length, 0);
    let doneUnits = 0;
    let loadedBytes = 0;

    const fetchAll = async (urls: string[], init?: string) => {
      const parts: BlobPart[] = [];
      if (init) {
        const head = await fetch(init, { signal });
        parts.push(await head.arrayBuffer());
      }
      for (const url of urls) {
        const res = await fetch(url, { signal });
        if (!res.ok) throw new Error(`Segment failed (${res.status})`);
        const buf = await res.arrayBuffer();
        parts.push(buf);
        loadedBytes += buf.byteLength;
        doneUnits += 1;
        onProgress(Math.min(99, Math.round((doneUnits / totalUnits) * 100)), toMb(loadedBytes), 0);
      }
      return parts;
    };

    const videoParts = await fetchAll(segments, mapUri || undefined);
    const videoBlob = new Blob(videoParts, { type: "video/mp2t" });

    const savedAudio: { label: string; lang?: string; blob: Blob }[] = [];
    for (const entry of liveAudio) {
      const parts = await fetchAll(entry.segments, entry.mapUri || undefined);
      savedAudio.push({
        label: entry.audio.label,
        lang: entry.audio.lang,
        blob: new Blob(parts, { type: "audio/mp2t" }),
      });
    }

    onProgress(100, toMb(loadedBytes), toMb(loadedBytes));
    const record = this.buildRecord(task, fileName, videoBlob, "video/mp2t");
    record.audioTracks = savedAudio;
    return record;
  }

  private buildRecord(task: NativeTask, fileName: string, blob: Blob, mimeType: string): DownloadedVideo {
    return {
      id: task.id,
      title: task.title,
      subtitle: task.episodeLabel,
      poster: task.poster,
      quality: task.quality || "Auto",
      fileName,
      sourceUrl: task.url,
      size: blob.size,
      downloadedAt: Date.now(),
      blob,
      seriesTitle: task.title,
      episodeLabel: task.episodeLabel,
      episodeNumber: task.episodeNumber,
      kind: task.kind,
      mimeType,
    };
  }
}

export const nativeDownloads = new NativeDownloadEngine();
