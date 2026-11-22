import { describe, it, expect, beforeEach } from "vitest";
import { freeStorage, isDisposableKey, installStorageGuard } from "@/lib/storageGuard";
import { trustedReferrer } from "@/lib/domainBoot";

describe("storage-full rescue", () => {
  beforeEach(() => localStorage.clear());

  it("never treats logins, guest data or device IDs as removable", () => {
    for (const k of ["rsanime_user", "rs_guest_data_v2", "rs_device_id", "rs_entry_done", "rs_admin_tmdb_api_key", "firebase:authUser:x"]) {
      expect(isDisposableKey(k)).toBe(false);
    }
    expect(isDisposableKey("rs_cache_movies_v1")).toBe(true);
    expect(isDisposableKey("rs_an_playable_v2:abc")).toBe(true);
  });

  it("frees the largest caches first and keeps everything else", () => {
    localStorage.setItem("rsanime_user", "{\"id\":\"u1\"}");
    localStorage.setItem("rs_cache_movies_v1", "x".repeat(5000));
    localStorage.setItem("rs_cache_categories_v1", "x".repeat(100));
    expect(freeStorage(localStorage, 1000)).toBe(1);
    expect(localStorage.getItem("rs_cache_movies_v1")).toBeNull();
    expect(localStorage.getItem("rs_cache_categories_v1")).not.toBeNull();
    expect(localStorage.getItem("rsanime_user")).toBe("{\"id\":\"u1\"}");
  });

  it("a save that would not fit succeeds after caches are dropped", () => {
    installStorageGuard();
    const big = "x".repeat(1_400_000);
    // Fill most of the ~5M-char quota with re-downloadable caches.
    for (let i = 0; i < 3; i++) localStorage.setItem(`rs_cache_part${i}_v1`, big);
    localStorage.setItem("rsanime_user", "{\"id\":\"u1\"}");
    localStorage.setItem("rs_guest_data_v2", "y".repeat(1_000_000));
    expect(localStorage.getItem("rs_guest_data_v2")?.length).toBe(1_000_000);
    expect(localStorage.getItem("rsanime_user")).toBe("{\"id\":\"u1\"}");
  });
});

describe("hand-over between www and the bare domain", () => {
  it("accepts www.<domain> → <domain> and rejects other sites", () => {
    expect(trustedReferrer("https://www.rsanime03.online/", "rsanime03.online", [])).toBe(true);
    expect(trustedReferrer("https://evil.example/", "rsanime03.online", [])).toBe(false);
    expect(trustedReferrer("https://www.evil.example/", "rsanime03.online", [])).toBe(false);
  });
});
