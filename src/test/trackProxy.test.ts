import { beforeEach, describe, expect, it } from "vitest";
import { CORS_VERDICT_TTL, hostRefusesDirectRead, orderReadCandidates, rememberDirectRead } from "@/lib/trackProxy";

const FILE = "https://superb-companion-que-alignment.trycloudflare.com/49231/Ep.mkv?hash=Ab";
const PROXY = "https://video-proxy.example.workers.dev/?url=x";

describe("audio-track proxy", () => {
  beforeEach(() => localStorage.clear());

  it("reads the file directly first while the server allows it", () => {
    expect(orderReadCandidates([FILE], [PROXY], false)).toEqual([FILE, PROXY]);
  });

  it("goes straight to the proxy once a server refused a direct read", () => {
    rememberDirectRead(FILE, false);
    expect(hostRefusesDirectRead(FILE)).toBe(true);
    expect(orderReadCandidates([FILE], [PROXY], hostRefusesDirectRead(FILE))).toEqual([PROXY, FILE]);
  });

  it("keeps trying direct when no proxy is set up", () => {
    expect(orderReadCandidates([FILE], [], true)).toEqual([FILE]);
  });

  it("forgets a refusal after the verdict expires, and a success clears it", () => {
    const now = Date.now();
    rememberDirectRead(FILE, false, now);
    expect(hostRefusesDirectRead(FILE, now + CORS_VERDICT_TTL + 1)).toBe(false);
    rememberDirectRead(FILE, true, now);
    expect(hostRefusesDirectRead(FILE, now)).toBe(false);
  });
});
