// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { decodeHandoff } from "@/lib/domainBoot";

// The early domain move lives inline in index.html (it must run before the app bundle downloads).
const html = readFileSync("index.html", "utf8");
const src = html.split("<script>").map((s) => s.split("</script>")[0]).find((s) => s.includes("__rsDomainMove"))!;

const OLD = "https://rsanime03.lovable.app";
const NEW = "https://rsanime03.online";
const state = () => ({ live: NEW, checkedAt: Date.now(), hosts: { a: { host: "rsanime03.lovable.app", serving: true }, b: { host: "rsanime03.online", serving: true } } });

function run(newDomainAnswers: boolean) {
  const replace = vi.fn();
  const loc = { protocol: "https:", hostname: "rsanime03.lovable.app", origin: OLD, pathname: "/watch/abc", search: "?s=1&ep=2", hash: "", replace };
  const win: Record<string, unknown> = {};
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    if (url.includes("siteDomain.json")) return Promise.resolve({ ok: true, json: () => Promise.resolve(state()) });
    return newDomainAnswers ? Promise.resolve({ ok: true }) : Promise.reject(new TypeError("TLS handshake failed"));
  }));
  new Function("location", "window", src)(loc, win);
  return { replace, done: win.__rsDomainMove as Promise<boolean>, win };
}

describe("old address moves visitors to the live domain with their login", () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); localStorage.setItem("rsanime_user", '{"id":"u1"}'); localStorage.setItem("rs_device_id", "d1"); });

  it("moves to the same page on the live domain and carries the login", async () => {
    const r = run(true);
    expect(await r.done).toBe(true);
    const target = String(r.replace.mock.calls[0][0]);
    expect(target.startsWith(`${NEW}/watch/abc?s=1&ep=2#rs_handoff=`)).toBe(true);
    const p = decodeHandoff(target.split("#rs_handoff=")[1])!;
    expect(p.e.rsanime_user).toBe('{"id":"u1"}');
    expect(p.e.rs_device_id).toBe("d1");
  });

  it("never sends anyone to a live domain that does not answer", async () => {
    const r = run(false);
    expect(await r.done).toBe(false);
    expect(r.replace).not.toHaveBeenCalled();
    expect(r.win.__rsDomainDead).toBe(true);
  });
});
