/**
 * Storage-full rescue.
 *
 * Phones give each web address about 5 MB of saved data. When it is full every
 * save fails (guest coins, history, Firebase's own notes), which visitors saw as
 * broken features. Before giving up, a failed save now drops only re-downloadable
 * caches (largest first) and tries once more. Logins, guest data, device IDs and
 * settings are never removed. Imported first in `main.tsx`.
 */

/** Saved items the site can always download again. */
const DISPOSABLE: RegExp[] = [
  /^rs_rest_cache:/, /^rs_cache_/, /^rs_an_cache_/, /^rs_an_playable_v\d+:/, /^rs_abyss_cache_v\d+$/,
  /^rs_dl_size_cache_v\d+$/, /^rs_img_seen_v\d+$/, /^rs_mkv_tracks_v\d+/, /^rs_video_servers_cache_v\d+$/,
  /^rs_video_proxy_url_cache_v\d+$/, /^rs_an_manager_cards_v\d+$/, /^rs_profile_shop_cache_v\d+$/,
  /^rs_admin_(adsterra_cache|apk_center_cache|live_tv_categories|live_tv_channels|tg_url_changer_posts|tg_welcome_cache)_v\d+$/,
  /^rs_pf_poster_v\d+:/,
];

export const isDisposableKey = (key: string) => DISPOSABLE.some((re) => re.test(key));

export function isQuotaError(e: unknown): boolean {
  const err = e as { name?: string; code?: number } | null;
  return !!err && (err.name === "QuotaExceededError" || err.name === "NS_ERROR_DOM_QUOTA_REACHED" || err.code === 22 || err.code === 1014);
}

/** Remove disposable items, largest first, until about `need` characters are free. Returns how many were removed. */
export function freeStorage(storage: Storage, need: number, keep = ""): number {
  const items: Array<[string, number]> = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k && k !== keep && isDisposableKey(k)) items.push([k, k.length + (storage.getItem(k) || "").length]);
  }
  items.sort((a, b) => b[1] - a[1]);
  let freed = 0;
  let removed = 0;
  for (const [k, size] of items) {
    if (freed >= need) break;
    try { storage.removeItem(k); freed += size; removed++; } catch { /* ignore */ }
  }
  return removed;
}

let installed = false;
export function installStorageGuard() {
  if (installed || typeof Storage === "undefined") return;
  installed = true;
  const original = Storage.prototype.setItem;
  Storage.prototype.setItem = function guardedSetItem(this: Storage, key: string, value: string) {
    try {
      return original.call(this, key, value);
    } catch (e) {
      if (!isQuotaError(e)) throw e;
      const need = (String(key).length + String(value).length) * 2 + 4096;
      if (!freeStorage(this, need, String(key))) throw e;
      return original.call(this, key, value);
    }
  };
}

installStorageGuard();
