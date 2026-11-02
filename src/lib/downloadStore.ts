// IndexedDB-based local video storage - NO data goes to any server/database
const DB_NAME = "rsanime_downloads";
const DB_VERSION = 1;
const STORE_NAME = "videos";

export interface DownloadedVideo {
  id: string; // unique key
  title: string;
  subtitle?: string;
  poster?: string;
  quality?: string;
  fileName: string;
  sourceUrl?: string;
  size: number;
  downloadedAt: number;
  blob?: Blob;
  // Grouping + offline-player metadata (Android app "Download Manager")
  seriesTitle?: string;
  episodeLabel?: string;
  episodeNumber?: number;
  kind?: "rs" | "an";
  mimeType?: string;
  // HLS/AN downloads keep every audio track so the offline player can switch.
  audioTracks?: { label: string; lang?: string; blob?: Blob }[];
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getVideoBlob(id: string): Promise<Blob | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(id);
    req.onsuccess = () => resolve(req.result?.blob || null);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllDownloads(): Promise<DownloadedVideo[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => {
      const items = (req.result as DownloadedVideo[]).map(({ blob, audioTracks, ...rest }) => ({
        ...rest,
        audioTracks: (audioTracks || []).map(({ blob: _b, ...track }) => track),
      }));
      items.sort((a, b) => b.downloadedAt - a.downloadedAt);
      resolve(items);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteDownload(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
