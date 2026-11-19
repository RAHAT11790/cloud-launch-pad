import { describe, it, expect, beforeEach } from "vitest";
import {
  checkMondiadCode, mondiadParts, networkFromStack, pickAdNetwork, readLastNet,
  markNetCapped, readNetCaps, NET_RETRY_MS,
} from "@/lib/adNetworks";

const POP = '<script async="" src="https://ss.mrmnd.com/popunder.js" data-mndpopid="7e036bc5-6a5a-4c60-92ba-f7d11d9ed144"></script>';
const BANNER_DIV = '<div data-mndbanid="046dc61e-bd9f-46c2-84a4-9c9a07ce78a2"></div>';

describe("player pop-unders take turns between Adsterra and Mondiad", () => {
  beforeEach(() => localStorage.clear());

  it("alternates: after Adsterra opened, Mondiad gets the next tap and back", () => {
    expect(pickAdNetwork(["adsterra", "mondiad"], "adsterra", {}, 1000)).toBe("mondiad");
    expect(pickAdNetwork(["adsterra", "mondiad"], "mondiad", {}, 1000)).toBe("adsterra");
  });

  it("a resting network hands the tap to the other one", () => {
    expect(pickAdNetwork(["adsterra", "mondiad"], "adsterra", { mondiad: 5000 }, 1000)).toBe("adsterra");
  });

  it("both resting means no tag turn (Direct Link takes over)", () => {
    expect(pickAdNetwork(["adsterra", "mondiad"], null, { adsterra: 5000, mondiad: 5000 }, 1000)).toBeNull();
  });

  it("a silent network rests 20 minutes, then is tried again", () => {
    markNetCapped("mondiad", 0);
    expect(NET_RETRY_MS).toBe(20 * 60_000);
    expect(pickAdNetwork(["mondiad"], null, readNetCaps(), NET_RETRY_MS - 1)).toBeNull();
    expect(pickAdNetwork(["mondiad"], null, readNetCaps(), NET_RETRY_MS + 1)).toBe("mondiad");
    expect(readLastNet()).toBeNull();
  });

  it("knows which network's script opened a tab", () => {
    const own = "rsanime03.lovable.app";
    const m = "Error\n at x (https://rsanime03.lovable.app/assets/index.js:1:2)\n at HTMLDocument.o (https://ss.mrmnd.com/popunder.js:1:999)";
    const a = "Error\n at x (https://rsanime03.lovable.app/assets/index.js:1:2)\n at y (https://bauval.org/14/abc:1:5)";
    expect(networkFromStack(m, own)).toBe("mondiad");
    expect(networkFromStack(a, own)).toBe("adsterra");
    expect(networkFromStack("Error\n at z (https://rsanime03.lovable.app/a.js:1:1)", own)).toBeNull();
  });
});

describe("Mondiad ad codes", () => {
  it("accepts Mondiad's popunder code and refuses one without a zone id", () => {
    expect(checkMondiadCode("popunder", POP).state).toBe("ok");
    expect(checkMondiadCode("popunder", '<script src="https://ss.mrmnd.com/popunder.js"></script>').state).toBe("bad");
    expect(checkMondiadCode("popunder", "").state).toBe("empty");
  });

  it("accepts the in-page push static script", () => {
    expect(checkMondiadCode("inPagePush", '<script async src="https://ss.mndsrv.com/static/3c90ace8-2202-460e-9dec-a3f5fbc0d855.js"></script>').state).toBe("ok");
    expect(checkMondiadCode("inPagePush", '<script src="https://evil.example/static/3c90ace8-2202-460e-9dec-a3f5fbc0d855.js"></script>').state).toBe("bad");
  });

  it("a banner element alone gets Mondiad's banner.js delivery script", () => {
    const parts = mondiadParts("banner", BANNER_DIV);
    expect(parts.elements).toEqual([{ attr: "data-mndbanid", id: "046dc61e-bd9f-46c2-84a4-9c9a07ce78a2" }]);
    expect(parts.scripts.map((s) => s.src)).toEqual(["https://ss.mndsrv.com/banner.js"]);
  });

  it("native needs its element code", () => {
    expect(checkMondiadCode("native", '<script async src="https://ss.mndsrv.com/native.js"></script>').state).toBe("bad");
    expect(checkMondiadCode("native", '<script async src="https://ss.mndsrv.com/native.js"></script><div data-mndazid="303aacc4-a1cd-467d-b758-23c8335b2454"></div>').state).toBe("ok");
  });
});
