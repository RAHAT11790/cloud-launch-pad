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

type MondiadScript = { src: string; attrs: Record<string, string> };

/** Fixes what phones and chat apps do to pasted code: curly quotes, `//host` links, missing https. */
function cleanPaste(raw: string) {
  return String(raw || "")
    .replace(/[\u201C\u201D\u2033]/g, '"')
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/\u00A0/g, " ")
    .trim();
}
function mondiadUrl(raw: string): string | null {
  let v = String(raw || "").trim();
  if (v.startsWith("//")) v = "https:" + v;
  else if (/^[a-z0-9.-]+\.[a-z]{2,}\//i.test(v)) v = "https://" + v;
  try {
    const u = new URL(v);
    if (u.protocol === "http:") u.protocol = "https:";
    return u.protocol === "https:" && hostMatches(u.hostname, MONDIAD_HOSTS) ? u.href : null;
  } catch { return null; }
}
const ZONE_PATH = new RegExp(`/${UUID}\\.js(?:$|[?#])`, "i");

/** Every Mondiad script in a pasted code (a bare script link counts too), with its data-mnd* ids. */
function mondiadScripts(code: string): MondiadScript[] {
  const out: MondiadScript[] = [];
  const re = /<script\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const tag = m[1];
    const raw = /\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i.exec(tag);
    const src = raw && mondiadUrl(raw[1] || raw[2] || raw[3] || "");
    if (!src) continue;
    const attrs: Record<string, string> = {};
    const ar = new RegExp(`\\b(data-mnd[a-z]+)\\s*=\\s*["']?(${UUID})["']?`, "gi");
    let a: RegExpExecArray | null;
    while ((a = ar.exec(tag))) attrs[a[1].toLowerCase()] = a[2];
    out.push({ src, attrs });
  }
  if (!out.length && !code.includes("<")) {
    const src = mondiadUrl(code);
    if (src) out.push({ src, attrs: {} });
  }
  return out;
}

const endsWithFile = (src: string, file: string) => src.toLowerCase().split(/[?#]/)[0].endsWith(`/${file}`);

/** Is this the code Mondiad gives for that placement? */
export function checkMondiadCode(slot: MondiadSlot, raw: string): CodeCheck {
  const code = cleanPaste(raw);
  if (!code) return { state: "empty" };
  const scripts = mondiadScripts(code);
  const zoneScript = scripts.some((s) => ZONE_PATH.test(s.src));
  if (!scripts.length && (/<script\b/i.test(code) || /^https?:\/\//i.test(code)))
    return { state: "bad", reason: "This script is not from Mondiad (mrmnd.com / mndsrv.com)." };
  if (slot === "popunder") {
    if (zoneScript) return { state: "ok" };
    if (scripts.some((s) => endsWithFile(s.src, "popunder.js") && s.attrs["data-mndpopid"])) return { state: "ok" };
    return { state: "bad", reason: 'Paste the Popunder code from Mondiad "Get tag", like <script async src="https://ds.mrmnd.com/<zone-id>.js"></script>' };
  }
  if (slot === "inPagePush") {
    if (zoneScript) return { state: "ok" };
    return { state: "bad", reason: 'Paste the In-Page Push code from Mondiad "Get tag", like <script async src="https://ds.mrmnd.com/<zone-id>.js"></script>' };
  }
  const attr = ELEMENT_ATTR[slot];
  if (new RegExp(`${attr}\\s*=\\s*["']?${UUID}`, "i").test(code)) {
    if (!scripts.some((s) => endsWithFile(s.src, `${slot}.js`))) return { state: "ok", note: `Delivery script ${slot}.js added automatically.` };
    return { state: "ok" };
  }
  if (zoneScript) return { state: "ok" };
  return { state: "bad", reason: `Paste both ${slot === "banner" ? "Banner" : "Native"} codes from Mondiad (the script and the <div ${attr}="…"> element).` };
}

/** Pieces the site may build from a Mondiad code — only Mondiad script links and zone-id elements. */
export function mondiadParts(slot: MondiadSlot, raw: string): { scripts: MondiadScript[]; elements: { attr: string; id: string }[] } {
  const code = cleanPaste(raw);
  if (checkMondiadCode(slot, code).state !== "ok") return { scripts: [], elements: [] };
  const scripts = mondiadScripts(code);
  const elements: { attr: string; id: string }[] = [];
  if (slot === "banner" || slot === "native") {
    const attr = ELEMENT_ATTR[slot];
    const er = new RegExp(`${attr}\\s*=\\s*["']?(${UUID})`, "gi");
    let m: RegExpExecArray | null;
    while ((m = er.exec(code))) elements.push({ attr, id: m[1] });
    if (elements.length && !scripts.some((s) => endsWithFile(s.src, `${slot}.js`))) scripts.push({ src: MONDIAD_DELIVERY[slot], attrs: {} });
  }
  return { scripts, elements };
}

const escAttr = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
/** Clean, safe HTML rebuilt from a Mondiad code ("" when the code is not valid). */
export function mondiadHtml(slot: MondiadSlot, raw: string): string {
  const { scripts, elements } = mondiadParts(slot, raw);
  return [
    ...scripts.map((s) => `<script async src="${escAttr(s.src)}"${Object.entries(s.attrs).map(([k, v]) => ` ${k}="${escAttr(v)}"`).join("")}></script>`),
    ...elements.map((e) => `<div ${e.attr}="${escAttr(e.id)}"></div>`),
  ].join("\n");
}
