import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronRight, Download, HardDrive, Play, Trash2, X, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import { deleteDownload, getAllDownloads, type DownloadedVideo } from "@/lib/downloadStore";
import { nativeDownloads, type NativeEngineState } from "@/lib/nativeDownloadEngine";
import { cn } from "@/lib/utils";
import OfflinePlayer from "./OfflinePlayer";

interface Group {
  key: string;
  title: string;
  poster?: string;
  items: DownloadedVideo[];
  bytes: number;
}

const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

const OfflineDownloadsPanel = ({ onBack }: { onBack: () => void }) => {
  const [items, setItems] = useState<DownloadedVideo[]>([]);
  const [queue, setQueue] = useState<NativeEngineState>(() => nativeDownloads.getState());
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [playing, setPlaying] = useState<DownloadedVideo | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try { setItems(await getAllDownloads()); } catch {} finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);
  useEffect(() => nativeDownloads.subscribe((state) => {
    setQueue(state);
    if (state.tasks.some((task) => task.status === "complete")) void load();
  }), []);

  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>();
    items.forEach((item) => {
      const title = item.seriesTitle || item.title || "Unknown";
      const key = title.toLowerCase();
      const group = map.get(key) || { key, title, poster: item.poster, items: [], bytes: 0 };
      group.items.push(item);
      group.bytes += item.size || 0;
      if (!group.poster && item.poster) group.poster = item.poster;
      map.set(key, group);
    });
    return Array.from(map.values()).map((group) => ({
      ...group,
      items: group.items.sort((a, b) => (a.episodeNumber || 0) - (b.episodeNumber || 0) || a.downloadedAt - b.downloadedAt),
    })).sort((a, b) => b.items[0].downloadedAt - a.items[0].downloadedAt);
  }, [items]);

  const activeTasks = queue.tasks.filter((task) => ["queued", "downloading", "error"].includes(task.status));
  const totalBytes = items.reduce((sum, item) => sum + (item.size || 0), 0);
  const current = groups.find((group) => group.key === openGroup) || null;

  const remove = async (id: string) => {
    await deleteDownload(id);
    setItems((prev) => prev.filter((item) => item.id !== id));
    toast.success("Removed from offline library");
  };

  if (playing) {
    const playlist = (current?.items || items).filter((entry) => entry.id !== undefined);
    return (
      <OfflinePlayer
        item={playing}
        playlist={playlist}
        onSelect={(entry) => setPlaying(entry)}
        onBack={() => setPlaying(null)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      <div className="sticky top-0 z-20 backdrop-blur-xl bg-background/85 border-b border-border/60">
        <div className="flex items-center gap-3 px-4 h-14">
          <button
            onClick={() => (current ? setOpenGroup(null) : onBack())}
            className="w-9 h-9 rounded-full bg-muted/60 flex items-center justify-center"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <p className="font-semibold truncate">{current ? current.title : "Download Manager"}</p>
            <p className="text-[11px] text-muted-foreground">
              {current
                ? `${current.items.length} episode${current.items.length > 1 ? "s" : ""} · ${mb(current.bytes)}`
                : `${items.length} file${items.length === 1 ? "" : "s"} · ${mb(totalBytes)} offline`}
            </p>
          </div>
        </div>
      </div>

      {/* ---------------- active queue ---------------- */}
      {!current && activeTasks.length > 0 && (
        <div className="px-4 pt-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Downloading</p>
            <button onClick={() => nativeDownloads.clearFinished()} className="text-[11px] text-muted-foreground hover:text-foreground">
              Clear finished
            </button>
          </div>
          {activeTasks.map((task, index) => (
            <div key={task.id} className="rounded-2xl border border-border/70 bg-card/80 p-3 flex gap-3">
              <div className="w-16 aspect-[2/3] rounded-lg overflow-hidden bg-muted shrink-0">
                {task.poster && <img src={task.poster} alt={task.title} className="w-full h-full object-cover" />}
              </div>
              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{task.title}</p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {task.episodeLabel || "Video"} · {index + 1} of {activeTasks.length}
                      {task.kind === "an" ? " · HLS" : ""}
                    </p>
                  </div>
                  <button onClick={() => nativeDownloads.cancel(task.id)} className="w-7 h-7 rounded-full bg-muted/70 flex items-center justify-center">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className={cn("h-full rounded-full transition-all", task.status === "error" ? "bg-destructive" : "bg-primary")}
                    style={{ width: `${Math.max(3, task.percent)}%` }}
                  />
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  {task.status === "downloading" && <Loader2 className="w-3 h-3 animate-spin text-primary" />}
                  {task.status === "error" && <AlertTriangle className="w-3 h-3 text-destructive" />}
                  <span>
                    {task.status === "error"
                      ? task.error
                      : task.status === "queued"
                        ? "Waiting in queue"
                        : `${task.percent}% · ${task.loadedMB.toFixed(1)} MB${task.totalMB ? ` / ${task.totalMB.toFixed(1)} MB` : ""}`}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ---------------- library ---------------- */}
      {!current && (
        <div className="px-4 pt-5">
          {loading ? (
            <div className="py-20 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : groups.length === 0 ? (
            <div className="py-20 text-center space-y-3">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-muted/60 flex items-center justify-center">
                <HardDrive className="w-7 h-7 text-muted-foreground" />
              </div>
              <p className="font-semibold">No offline anime yet</p>
              <p className="text-xs text-muted-foreground max-w-[260px] mx-auto">
                Tap download on any episode — RS and AN both save here for offline watching.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {groups.map((group) => (
                <button
                  key={group.key}
                  onClick={() => setOpenGroup(group.key)}
                  className="group text-left rounded-2xl overflow-hidden border border-border/70 bg-card/70 hover:border-primary/60 transition-colors"
                >
                  <div className="relative aspect-[2/3] bg-muted overflow-hidden">
                    {group.poster && (
                      <img src={group.poster} alt={group.title} loading="lazy" className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300" />
                    )}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-2">
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary-foreground bg-primary/80 rounded-full px-2 py-0.5">
                        <Download className="w-3 h-3" />
                        {group.items.length}
                      </span>
                    </div>
                  </div>
                  <div className="p-2.5">
                    <p className="text-sm font-semibold truncate">{group.title}</p>
                    <p className="text-[11px] text-muted-foreground flex items-center justify-between">
                      <span>{mb(group.bytes)}</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ---------------- episode list ---------------- */}
      {current && (
        <div className="px-4 pt-4 space-y-2">
          {current.items.map((item) => (
            <div key={item.id} className="flex items-center gap-3 p-2 rounded-2xl border border-border/60 bg-card/70">
              <button onClick={() => setPlaying(item)} className="relative w-28 aspect-video rounded-lg overflow-hidden bg-muted shrink-0">
                {item.poster && <img src={item.poster} alt={item.title} loading="lazy" className="w-full h-full object-cover" />}
                <span className="absolute inset-0 flex items-center justify-center bg-black/35">
                  <Play className="w-5 h-5 text-white" />
                </span>
              </button>
              <button onClick={() => setPlaying(item)} className="flex-1 min-w-0 text-left">
                <p className="text-sm font-medium truncate">{item.episodeLabel || item.subtitle || item.title}</p>
                <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                  <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                  {mb(item.size || 0)}{item.quality ? ` · ${item.quality}` : ""}{item.kind === "an" ? " · HLS" : ""}
                </p>
              </button>
              <button onClick={() => void remove(item.id)} className="w-9 h-9 rounded-full bg-muted/60 flex items-center justify-center text-destructive">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default OfflineDownloadsPanel;
