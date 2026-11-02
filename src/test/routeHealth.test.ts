import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetRouteHealth, aliveOrEmpty, checkRouteAlive, isDeadStatus, isRouteKnownDead, markRouteDead } from "@/lib/routeHealth";

const realFetch = globalThis.fetch;

describe("routeHealth — a dead function server behaves like an empty router row", () => {
  beforeEach(() => __resetRouteHealth());
  afterEach(() => { globalThis.fetch = realFetch; });

  it("backend project with exhausted quota (402) is dead, so the route becomes empty", async () => {
    globalThis.fetch = vi.fn(async () => new Response("{}", { status: 402 })) as any;
    expect(await aliveOrEmpty("https://abc.supabase.co/functions/v1/abyss")).toBe("");
    expect(isRouteKnownDead("https://abc.supabase.co/functions/v1/ad-shield")).toBe(true);
  });

  it("server whose name no longer resolves is dead", async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError("Failed to fetch"); }) as any;
    expect(await checkRouteAlive("https://gone.supabase.co/functions/v1/abyss")).toBe(false);
  });

  it("live backend gateway (404 at /functions/v1/) keeps the route", async () => {
    globalThis.fetch = vi.fn(async () => new Response("", { status: 404 })) as any;
    const url = "https://live.supabase.co/functions/v1/abyss";
    expect(await aliveOrEmpty(url)).toBe(url);
  });

  it("live Cloudflare worker keeps the route and is probed only once", async () => {
    const f = vi.fn(async () => new Response(null, { status: 200 }));
    globalThis.fetch = f as any;
    const url = "https://abyss.example.workers.dev";
    expect(await aliveOrEmpty(url)).toBe(url);
    expect(await aliveOrEmpty(url)).toBe(url);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("a failure seen by a real call marks the server dead immediately", () => {
    markRouteDead("https://x.supabase.co/functions/v1/rs-bot");
    expect(isRouteKnownDead("https://x.supabase.co/functions/v1/other")).toBe(true);
  });

  it("only quota/gateway statuses count as dead", () => {
    expect(isDeadStatus(402)).toBe(true);
    expect(isDeadStatus(503)).toBe(true);
    expect(isDeadStatus(400)).toBe(false);
    expect(isDeadStatus(404)).toBe(false);
  });
});
