// ============================================
// Ad networks (Adsterra + Mondiad) — pure rules shared by the player and admin.
//
//   • Which network's pop-under gets the next player ad (turn taking, a
//     silent/blocked network hands over to the other).
//   • Which network a sponsor-tab open came from (script URL in the stack).
//   • What a correct Mondiad ad code looks like for every placement.
// No Firebase here, so every rule is unit-tested.
// ============================================

export type AdNetworkId = "adsterra" | "mondiad";

/** Script hosts Mondiad serves its tags from (ss.mrmnd.com, ss.mndsrv.com …). */
export const MONDIAD_HOSTS = ["mrmnd.com", "mndsrv.com", "mondiad.com", "mondiad.net", "mondiad.digital"];

/** A network that opened nothing (its own frequency cap) rests this long. */
export const NET_RETRY_MS = 20 * 60_000;

const CAPS_KEY = "rs_ad_net_caps_v1";
const LAST_KEY = "rs_ad_net_last_v1";

export function hostMatches(host: string, list: string[]): boolean {
  const h = String(host || "").toLowerCase();
  return list.some((d) => h === d || h.endsWith("." + d));
}

/** Hostnames of every script src (or bare URL) inside an ad code. */
export function scriptHosts(snippet: string): string[] {
  const out = new Set<string>();
  const text = String(snippet || "");
  const re = /src\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    try { out.add(new URL(m[1], "https://x.invalid").hostname.toLowerCase()); } catch {}
  }
  const bare = text.trim();
  if (/^https?:\/\/\S+$/i.test(bare)) {
    try { out.add(new URL(bare).hostname.toLowerCase()); } catch {}
  }
  out.delete("x.invalid");
  return [...out];
}

/**
 * Which network's code is on the call stack of a window.open.
 * The innermost foreign script decides: a Mondiad host → "mondiad"; any other
 * foreign script → "adsterra" (its tags load helper scripts from changing
 * domains). Only our own site on the stack gives null (never blocked).
 */
export function networkFromStack(
  stack: string,
  ownHost: string,
  mondiadHosts: string[] = MONDIAD_HOSTS,
): AdNetworkId | null {
  const re = /https?:\/\/([^/:\s)]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(stack || "")))) {
    const host = m[1].toLowerCase();
    if (host === String(ownHost || "").toLowerCase() || host === "localhost") continue;
    return hostMatches(host, mondiadHosts) ? "mondiad" : "adsterra";
  }
  return null;
}

export type NetCaps = Partial<Record<AdNetworkId, number>>;

/**
 * Next pop-under turn: networks take turns (the one that did not open last),
 * a resting (capped) network is skipped, null = every network rests → Direct Link.
 */
export function pickAdNetwork(available: AdNetworkId[], last: AdNetworkId | null, caps: NetCaps, now: number): AdNetworkId | null {
  const live = available.filter((id) => !(Number(caps[id]) > now));
  if (!live.length) return null;
  return live.find((id) => id !== last) ?? live[0];
}

// ---- device-persisted turn state (survives reloads) ----
export function readNetCaps(): NetCaps {
  try { const v = JSON.parse(localStorage.getItem(CAPS_KEY) || "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; }
}
function writeNetCaps(c: NetCaps) {
  try { localStorage.setItem(CAPS_KEY, JSON.stringify(c)); } catch {}
}
export function markNetCapped(id: AdNetworkId, now = Date.now()) {
  writeNetCaps({ ...readNetCaps(), [id]: now + NET_RETRY_MS });
}
export function clearNetCap(id: AdNetworkId) {
  const c = readNetCaps();
  if (c[id]) { delete c[id]; writeNetCaps(c); }
}
export function readLastNet(): AdNetworkId | null {
  try { const v = localStorage.getItem(LAST_KEY); return v === "adsterra" || v === "mondiad" ? v : null; } catch { return null; }
}
export function writeLastNet(id: AdNetworkId) {
  try { localStorage.setItem(LAST_KEY, id); } catch {}
}

// ---- Mondiad ad codes ----
export type MondiadSlot = "popunder" | "inPagePush" | "banner" | "native";

/** Delivery scripts Mondiad gives for the two-part formats. */
export const MONDIAD_DELIVERY: Record<"banner" | "native", string> = {
  banner: "https://ss.mndsrv.com/banner.js",
  native: "https://ss.mndsrv.com/native.js",
};
const ELEMENT_ATTR: Record<"banner" | "native", string> = { banner: "data-mndbanid", native: "data-mndazid" };
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export type CodeCheck = { state: "empty" } | { state: "ok"; note?: string } | { state: "bad"; reason: string };

const mondiadScriptSrcs = (code: string) => {
  const out: string[] = [];
  const re = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    try { const u = new URL(m[1]); if (u.protocol === "https:" && hostMatches(u.hostname, MONDIAD_HOSTS)) out.push(u.href); } catch {}
  }
  return out;
};

/** Is this the code Mondiad gives for that placement? */
export function checkMondiadCode(slot: MondiadSlot, raw: string): CodeCheck {
  const code = String(raw || "").trim();
  if (!code) return { state: "empty" };
  const srcs = mondiadScriptSrcs(code);
  if (slot === "popunder") {
    if (!srcs.some((s) => /popunder\.js/i.test(s))) return { state: "bad", reason: "Popunder code must contain Mondiad's popunder.js script." };
    if (!new RegExp(`data-mndpopid\\s*=\\s*["']${UUID}["']`, "i").test(code)) return { state: "bad", reason: "data-mndpopid (zone ID) is missing." };
    return { state: "ok" };
  }
  if (slot === "inPagePush") {
    if (!srcs.some((s) => new RegExp(`/c?static/${UUID}\\.js`, "i").test(s))) return { state: "bad", reason: "In-Page Push code must be Mondiad's …/static/<zone-id>.js script." };
    return { state: "ok" };
  }
  const attr = ELEMENT_ATTR[slot];
  if (!new RegExp(`${attr}\\s*=\\s*["']${UUID}["']`, "i").test(code)) return { state: "bad", reason: `Element code (<div ${attr}="…">) is missing.` };
  if (!srcs.some((s) => s.toLowerCase().endsWith(`/${slot}.js`))) return { state: "ok", note: `Delivery script ${slot}.js added automatically.` };
  return { state: "ok" };
}

/** Pieces the isolated download-ad document is allowed to build from a Mondiad code. */
export function mondiadParts(slot: MondiadSlot, raw: string): { scripts: { src: string; attrs: Record<string, string> }[]; elements: { attr: string; id: string }[] } {
  const code = String(raw || "");
  if (checkMondiadCode(slot, code).state !== "ok") return { scripts: [], elements: [] };
  const scripts: { src: string; attrs: Record<string, string> }[] = [];
  const re = /<script\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const tag = m[1];
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (!src) continue;
    try {
      const u = new URL(src);
      if (u.protocol !== "https:" || !hostMatches(u.hostname, MONDIAD_HOSTS)) continue;
      const attrs: Record<string, string> = {};
      const pop = new RegExp(`data-mndpopid\\s*=\\s*["'](${UUID})["']`, "i").exec(tag)?.[1];
      if (pop) attrs["data-mndpopid"] = pop;
      scripts.push({ src: u.href, attrs });
    } catch {}
  }
  const elements: { attr: string; id: string }[] = [];
  if (slot === "banner" || slot === "native") {
    const attr = ELEMENT_ATTR[slot];
    const er = new RegExp(`${attr}\\s*=\\s*["'](${UUID})["']`, "gi");
    while ((m = er.exec(code))) elements.push({ attr, id: m[1] });
    if (!scripts.some((s) => s.src.toLowerCase().endsWith(`/${slot}.js`))) scripts.push({ src: MONDIAD_DELIVERY[slot], attrs: {} });
  }
  return { scripts, elements };
}
