// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import worker from "../../cloudflare-workers/email-service.js";
import { isPreviewHost, parseSiteDomainState, stateTrusted, STATE_MAX_AGE_MS } from "@/lib/siteDomain";
import { applyEntries, decodeHandoff, encodeHandoff, pickEntries, trustedReferrer, PER_KEY_MAX } from "@/lib/domainBoot";

const { decideLiveHost, originAllowed, rememberSite, resetMemory } = (worker as any)._internals;
const OLD = "rsanime03.lovable.app";

describe("live domain decision (email server domain checker)", () => {
  it("follows Lovable's own redirect from the old address to the new domain", () => {
    const r = [{ host: OLD, serving: false, redirect: "rsanime03.online" }, { host: "rsanime03.online", serving: true }];
    expect(decideLiveHost(r, OLD, "")).toBe("rsanime03.online");
  });
  it("prefers a working custom domain over the Lovable address", () => {
    const r = [{ host: OLD, serving: true }, { host: "rsanime03.online", serving: true }];
    expect(decideLiveHost(r, OLD, "")).toBe("rsanime03.online");
  });
  it("uses a subdomain when only the subdomain serves the site", () => {
    const r = [{ host: OLD, serving: true }, { host: "rsanime03.online", serving: false }, { host: "watch.rsanime03.online", serving: true }];
    expect(decideLiveHost(r, OLD, "")).toBe("watch.rsanime03.online");
  });
  it("picks the domain the others redirect to (www → real domain)", () => {
    const r = [{ host: OLD, serving: true }, { host: "www.rsanime03.online", serving: true }, { host: "rsanime03.online", serving: true }, { host: "x.rsanime03.online", serving: false, redirect: "www.rsanime03.online" }];
    expect(decideLiveHost(r, OLD, "")).toBe("www.rsanime03.online");
  });
  it("falls back to the Lovable address when the custom domain is down", () => {
    const r = [{ host: OLD, serving: true }, { host: "rsanime03.online", serving: false }];
    expect(decideLiveHost(r, OLD, "rsanime03.online")).toBe(OLD);
  });
  it("gives no answer when nothing serves the site (the saved one is kept)", () => {
    expect(decideLiveHost([{ host: OLD, serving: false }], OLD, "")).toBe("");
  });
});

describe("email server accepts the live domain automatically", () => {
  beforeEach(() => resetMemory());
  it("refuses an unknown domain, accepts it once the checker saw it serving the site", () => {
    expect(originAllowed("https://rsanime03.online", {})).toBe(false);
    rememberSite({ live: "https://rsanime03.online", hosts: { "rsanime03,online": { host: "rsanime03.online", serving: true } }, checkedAt: Date.now() });
    expect(originAllowed("https://rsanime03.online", {})).toBe(true);
    expect(originAllowed("https://evil.example", {})).toBe(false);
  });
  it("does not accept a domain that is listed but not serving the site", () => {
    rememberSite({ live: "https://rsanime03.online", hosts: { a: { host: "old.example", serving: false } }, checkedAt: Date.now() });
    expect(originAllowed("https://old.example", {})).toBe(false);
  });
});

describe("site-side live domain record", () => {
  it("treats previews and local dev as not-the-site", () => {
    expect(isPreviewHost("localhost")).toBe(true);
    expect(isPreviewHost("id-preview--d9496f6f.lovable.app")).toBe(true);
    expect(isPreviewHost("rsanime03.lovable.app")).toBe(false);
    expect(isPreviewHost("rsanime03.online")).toBe(false);
  });
  it("never moves visitors on an old or unconfirmed check", () => {
    const now = Date.now();
    const st = parseSiteDomainState({ live: "https://rsanime03.online", checkedAt: now, hosts: { a: { host: "rsanime03.online", serving: true } } });
    expect(stateTrusted(st, now)).toBe(true);
    expect(stateTrusted(st, now + STATE_MAX_AGE_MS + 1)).toBe(false);
    const notServing = parseSiteDomainState({ live: "https://rsanime03.online", checkedAt: now, hosts: { a: { host: "rsanime03.online", serving: false } } });
    expect(stateTrusted(notServing, now)).toBe(false);
    expect(parseSiteDomainState({ live: "http://rsanime03.online", checkedAt: now })).toBeNull();
  });
});

describe("login hand-over to the new domain", () => {
  beforeEach(() => localStorage.clear());
  it("carries the saved data unchanged (including Bengali text)", () => {
    const p = { v: 1 as const, at: 1, e: { rsanime_user: JSON.stringify({ id: "u1", name: "রাহাত" }), rs_device_id: "dev-9" } };
    expect(decodeHandoff(encodeHandoff(p))?.e).toEqual(p.e);
  });
  it("always carries the login and device id, drops oversized items", () => {
    const big = "x".repeat(PER_KEY_MAX + 1);
    const out = pickEntries([["rs_cache_big", big], ["rsanime_user", "{\"id\":\"u1\"}"], ["firebase:authUser:k:[DEFAULT]", "{}"], ["rs_theme", "dark"]]);
    expect(Object.keys(out).sort()).toEqual(["firebase:authUser:k:[DEFAULT]", "rs_theme", "rsanime_user"]);
  });
  it("signs the visitor in on the new domain once, and never over a login made there", () => {
    const p = { v: 1 as const, at: 1, e: { rsanime_user: "{\"id\":\"u1\"}" } };
    expect(applyEntries(localStorage, p)).toBe(true);
    expect(localStorage.getItem("rsanime_user")).toBe("{\"id\":\"u1\"}");
    expect(applyEntries(localStorage, { v: 1, at: 2, e: { rsanime_user: "{\"id\":\"u2\"}" } })).toBe(false);
    localStorage.clear();
    localStorage.setItem("rsanime_user", "{\"id\":\"me\"}");
    expect(applyEntries(localStorage, p)).toBe(false);
    expect(localStorage.getItem("rsanime_user")).toBe("{\"id\":\"me\"}");
  });
  it("accepts a hand-over only when it came from the site's own old address", () => {
    expect(trustedReferrer("https://rsanime03.lovable.app/", "rsanime03.online", [])).toBe(true);
    expect(trustedReferrer("https://evil.example/", "rsanime03.online", [])).toBe(false);
    expect(trustedReferrer("", "rsanime03.online", [])).toBe(false);
    expect(trustedReferrer("https://www.rsanime03.online/", "rsanime03.online", ["www.rsanime03.online"])).toBe(true);
  });
});
