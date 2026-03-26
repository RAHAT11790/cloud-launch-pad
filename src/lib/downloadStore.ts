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
  size: number;
  downloadedAt: number;
  blob?: Blob;
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

export async function saveVideo(video: DownloadedVideo): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(video);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
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
      const items = (req.result as DownloadedVideo[]).map(({ blob, ...rest }) => rest);
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

export async function downloadWithProgress(
  url: string,
  onProgress: (percent: number, loadedMB: number, totalMB: number) => void,
  signal?: AbortSignal
): Promise<Blob> {
  const response = await fetch(url, { signal });
  const contentLength = Number(response.headers.get("Content-Length") || 0);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No readable stream");

  const chunks: Uint8Array[] = [];
  let loaded = 0;

  while (true) {
    if (signal?.aborted) {
      reader.cancel();
      throw new DOMException("Download cancelled", "AbortError");
    }
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    const totalMB = contentLength ? contentLength / (1024 * 1024) : 0;
    const loadedMB = loaded / (1024 * 1024);
    const percent = contentLength ? Math.round((loaded / contentLength) * 100) : 0;
    onProgress(percent, loadedMB, totalMB);
  }

  return new Blob(chunks as unknown as BlobPart[], { type: "video/mp4" });
}
