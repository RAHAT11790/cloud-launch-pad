// ============================================================
// Chunked Firebase Realtime Database reader
// ============================================================
// Reading a whole collection (`users`, `appUsers`, ...) in ONE request makes
// Firebase serialise the entire subtree before it answers — that is what made
// the admin panel wait several seconds and spike RTDB egress.
//
// Instead we page through the collection with `orderByKey() + limitToFirst()`
// and `startAfter(lastKey)`. Firebase then answers many small responses
// (~500KB each) instead of one huge one, so the first rows paint almost
// instantly and total pressure on the database stays flat.

import { db, ref, get, query, orderByKey, limitToFirst, startAfter } from "@/lib/firebase";

export interface ChunkedReadOptions<T = any> {
  /** How many child keys to pull per request. */
  pageSize?: number;
  /** Called after every chunk with the merged result so the UI can paint early. */
  onChunk?: (merged: Record<string, T>, chunk: Record<string, T>) => void;
  /** Hard cap so a runaway collection can never lock the panel. */
  maxItems?: number;
  /** Return true to abort (component unmounted). */
  isCancelled?: () => boolean;
  /** Idle gap between chunks (ms) — keeps the socket free for live listeners. */
  gapMs?: number;
}

export async function readCollectionChunked<T = any>(
  path: string,
  options: ChunkedReadOptions<T> = {},
): Promise<Record<string, T>> {
  const pageSize = Math.max(25, options.pageSize ?? 300);
  const maxItems = options.maxItems ?? 20000;
  const gapMs = options.gapMs ?? 40;
  const merged: Record<string, T> = {};
  let cursor: string | null = null;
  let total = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (options.isCancelled?.()) break;
    const constraints: any[] = [orderByKey(), limitToFirst(pageSize)];
    if (cursor !== null) constraints.splice(1, 0, startAfter(cursor));
    let snap: any;
    try {
      snap = await get(query(ref(db, path), ...constraints));
    } catch {
      break;
    }
    const chunk = (snap?.val() || {}) as Record<string, T>;
    const keys = Object.keys(chunk);
    if (!keys.length) break;
    keys.forEach((key) => { merged[key] = chunk[key]; });
    total += keys.length;
    cursor = keys[keys.length - 1];
    if (!options.isCancelled?.()) options.onChunk?.(merged, chunk);
    if (keys.length < pageSize || total >= maxItems) break;
    if (gapMs > 0) await new Promise((resolve) => setTimeout(resolve, gapMs));
  }

  return merged;
}

/** Same as above but returns an array with the Firebase key merged in as `id`. */
export async function readListChunked<T = any>(
  path: string,
  options: ChunkedReadOptions<T> & { onChunkList?: (items: Array<T & { id: string }>) => void } = {},
): Promise<Array<T & { id: string }>> {
  const toList = (record: Record<string, any>) =>
    Object.entries(record).map(([id, value]) => ({ id, ...(value as any) }));
  const merged = await readCollectionChunked<T>(path, {
    ...options,
    onChunk: (all, chunk) => {
      options.onChunk?.(all, chunk);
      options.onChunkList?.(toList(all) as any);
    },
  });
  return toList(merged) as any;
}
