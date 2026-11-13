// ============================================================
// Subtitle formats — one reader for every caption file the player meets
// ============================================================
// SRT, WebVTT, ASS/SSA, YouTube SBV, TTML/DFXP, SAMI (.smi) and MicroDVD
// (.sub) files, in any common text encoding, become plain timed lines; the
// same cleaner tidies lines inside .mkv files (ASS override tags, SRT
// {\an8} tags, HTML styling, entities, karaoke timings, drawing commands).
// Pure (no DOM), so it is tested directly.

export interface SubtitleCue { start: number; end: number; text: string }
export type SubtitleKind = "srt" | "vtt" | "ass" | "sbv" | "ttml" | "sami" | "microdvd" | "unknown";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", nbsp: " ", quot: '"', apos: "'", "#39": "'", lrm: "", rlm: "" };
const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, name: string) => {
    const k = name.toLowerCase();
    if (k in ENTITIES) return ENTITIES[k];
    if (k.startsWith("#x")) { const n = parseInt(k.slice(2), 16); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    if (k.startsWith("#")) { const n = parseInt(k.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    return m;
  });

/** Plain caption text from one subtitle line of any format. */
export function cleanSubtitleText(raw: string, kind: SubtitleKind = "srt"): string {
  let s = String(raw || "");
  if (kind === "ass") {
    if (/\{[^}]*\\p[1-9]/.test(s)) return ""; // vector drawing, not text
    s = s.replace(/\\N/g, "\n").replace(/\\n/g, "\n").replace(/\\h/g, " ");
  }
  s = s
    .replace(/\{\\[^}]*\}/g, "") // ASS-style override tags, also used inside SRT ({\an8}, {\i1})
    .replace(/\{[^}]*\}/g, kind === "ass" ? "" : "$&")
    .replace(/<\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3}>/g, "") // VTT karaoke timestamps
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?[a-z][^>]*>/gi, ""); // <i> <b> <font> <c.x> <v Name> <ruby> …
  s = decodeEntities(s).replace(/\r/g, "");
  return s
    .split("\n")
    .map((line) => line.replace(/[\u200B-\u200F\uFEFF]/g, "").replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** Text of a subtitle file in its real encoding (UTF-8/16 with or without BOM, else Windows-1252). */
export function decodeSubtitleBytes(input: ArrayBuffer | Uint8Array): string {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  const dec = (label: string, fatal = false, start = 0) => new TextDecoder(label, { fatal }).decode(b.subarray(start));
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return dec("utf-8", false, 3);
  if (b[0] === 0xff && b[1] === 0xfe) return dec("utf-16le", false, 2);
  if (b[0] === 0xfe && b[1] === 0xff) return dec("utf-16be", false, 2);
  // UTF-16 without BOM: every other byte is zero in Latin text.
  const sample = b.subarray(0, Math.min(b.length, 400));
  let zEven = 0; let zOdd = 0;
  for (let i = 0; i < sample.length; i += 1) if (!sample[i]) { if (i % 2) zOdd += 1; else zEven += 1; }
  if (zOdd > sample.length / 5) return dec("utf-16le");
  if (zEven > sample.length / 5) return dec("utf-16be");
  try { return dec("utf-8", true); } catch { /* not UTF-8 */ }
  try { return dec("windows-1252"); } catch { return dec("utf-8"); }
}

/** h:mm:ss.ms / mm:ss,ms / ss.ms → seconds (NaN when not a time). */
export function parseClock(raw: string): number {
  const m = String(raw || "").trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,:](\d{1,3}))?$/);
  if (!m) {
    const s = String(raw || "").trim().match(/^(\d+(?:\.\d+)?)s?$/);
    return s ? Number(s[1]) : NaN;
  }
  const frac = m[4] ? Number(`0.${m[4].padEnd(3, "0")}`) : 0;
  return Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + frac;
}

export function detectSubtitleKind(text: string): SubtitleKind {
  const head = text.replace(/^\uFEFF/, "").trimStart().slice(0, 4000);
  if (/^WEBVTT/.test(head)) return "vtt";
  if (/^\[Script Info\]|^\[V4\+? Styles\]|^\[Events\]/im.test(head) || /^Dialogue:\s*/m.test(head)) return "ass";
  if (/<tt[\s>]|<\?xml[^>]*>\s*<tt|xmlns="http:\/\/www\.w3\.org\/ns\/ttml/i.test(head)) return "ttml";
  if (/<SAMI>|<SYNC\s+Start=/i.test(head)) return "sami";
  if (/^\{\d+\}\{\d*\}/m.test(head)) return "microdvd";
  if (/-->/.test(head)) return "srt";
  if (/^\d+:\d{2}:\d{2}\.\d{3},\d+:\d{2}:\d{2}\.\d{3}\s*$/m.test(head)) return "sbv";
  return "unknown";
}

const byStart = (a: SubtitleCue, b: SubtitleCue) => a.start - b.start || a.end - b.end;

function parseArrowCues(text: string, kind: "srt" | "vtt"): SubtitleCue[] {
  const out: SubtitleCue[] = [];
  const blocks = text.replace(/\r\n?/g, "\n").split(/\n[ \t]*\n+/);
  for (const block of blocks) {
    const lines = block.split("\n");
    const at = lines.findIndex((l) => l.includes("-->"));
    if (at < 0) continue;
    const [a, b] = lines[at].split("-->");
    const start = parseClock((a || "").trim().split(/\s+/)[0]);
    const end = parseClock((b || "").trim().split(/\s+/)[0]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (kind === "vtt" && /^(NOTE|STYLE|REGION)\b/.test(lines[0] || "")) continue;
    const body = cleanSubtitleText(lines.slice(at + 1).join("\n"), kind);
    if (body) out.push({ start, end: end > start ? end : start + 2, text: body });
  }
  return out;
}

function parseAss(text: string): SubtitleCue[] {
  const out: SubtitleCue[] = [];
  let fields = ["layer", "start", "end", "style", "name", "marginl", "marginr", "marginv", "effect", "text"];
  let inEvents = false;
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (/^\[.+\]$/.test(line)) { inEvents = /^\[Events\]$/i.test(line); continue; }
    if (inEvents && /^Format:/i.test(line)) { fields = line.slice(7).split(",").map((f) => f.trim().toLowerCase()); continue; }
    if (!/^Dialogue:/i.test(line)) continue;
    const parts = line.slice(9).split(",");
    const textAt = fields.indexOf("text");
    const value = (name: string) => (parts[fields.indexOf(name)] || "").trim();
    const body = cleanSubtitleText(parts.slice(textAt >= 0 ? textAt : 9).join(","), "ass");
    const start = parseClock(value("start")); const end = parseClock(value("end"));
    if (body && Number.isFinite(start) && Number.isFinite(end)) out.push({ start, end, text: body });
  }
  return out;
}

function parseSbv(text: string): SubtitleCue[] {
  const out: SubtitleCue[] = [];
  for (const block of text.replace(/\r\n?/g, "\n").split(/\n\s*\n+/)) {
    const lines = block.split("\n");
    const m = (lines[0] || "").match(/^([\d:.]+),([\d:.]+)$/);
    if (!m) continue;
    const body = cleanSubtitleText(lines.slice(1).join("\n").replace(/\[br\]/gi, "\n"));
    if (body) out.push({ start: parseClock(m[1]), end: parseClock(m[2]), text: body });
  }
  return out;
}

/** TTML time: "00:00:01.500", "00:00:01:12" (frames), "1.5s", "1500ms", "36000000t". */
function ttmlTime(raw: string, tickRate: number, frameRate: number): number {
  const v = String(raw || "").trim();
  let m = v.match(/^(\d+(?:\.\d+)?)(h|m|s|ms|f|t)$/);
  if (m) {
    const n = Number(m[1]);
    return m[2] === "h" ? n * 3600 : m[2] === "m" ? n * 60 : m[2] === "s" ? n : m[2] === "ms" ? n / 1000 : m[2] === "f" ? n / frameRate : n / tickRate;
  }
  m = v.match(/^(\d+):(\d{2}):(\d{2}):(\d{2})$/);
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / frameRate;
  return parseClock(v);
}

function parseTtml(text: string): SubtitleCue[] {
  const out: SubtitleCue[] = [];
  const tickRate = Number(text.match(/tickRate="(\d+)"/i)?.[1] || 10_000_000);
  const frameRate = Number(text.match(/frameRate="(\d+)"/i)?.[1] || 30);
  const re = /<(?:\w+:)?p\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?p>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const attrs = m[1];
    const begin = attrs.match(/\bbegin="([^"]+)"/)?.[1];
    const endRaw = attrs.match(/\bend="([^"]+)"/)?.[1];
    const dur = attrs.match(/\bdur="([^"]+)"/)?.[1];
    if (!begin) continue;
    const start = ttmlTime(begin, tickRate, frameRate);
    const end = endRaw ? ttmlTime(endRaw, tickRate, frameRate) : dur ? start + ttmlTime(dur, tickRate, frameRate) : start + 3;
    const body = cleanSubtitleText(m[2].replace(/\s*\n\s*/g, " ").replace(/<(?:\w+:)?br\s*\/?>/gi, "\n"), "srt");
    if (body && Number.isFinite(start) && Number.isFinite(end)) out.push({ start, end, text: body });
  }
  return out;
}

function parseSami(text: string): SubtitleCue[] {
  const out: SubtitleCue[] = [];
  const syncs = [...text.matchAll(/<SYNC\s+Start\s*=\s*"?(\d+)"?[^>]*>([\s\S]*?)(?=<SYNC|<\/BODY|$)/gi)];
  syncs.forEach((s, i) => {
    const start = Number(s[1]) / 1000;
    const next = syncs[i + 1] ? Number(syncs[i + 1][1]) / 1000 : start + 3;
    const body = cleanSubtitleText(s[2].replace(/<P[^>]*>/gi, "").replace(/\s*\n\s*/g, " "), "srt");
    if (body && body !== " ") out.push({ start, end: next, text: body });
  });
  return out;
}

function parseMicroDvd(text: string, fpsHint = 23.976): SubtitleCue[] {
  const out: SubtitleCue[] = [];
  let fps = fpsHint;
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const m = raw.match(/^\{(\d+)\}\{(\d*)\}(.*)$/);
    if (!m) continue;
    const a = Number(m[1]); const b = m[2] ? Number(m[2]) : a + Math.round(fps * 3);
    // "{1}{1}25.000" declares the frame rate.
    if (a <= 1 && b <= 1 && /^\d+(\.\d+)?$/.test(m[3].trim())) { fps = Number(m[3]) || fps; continue; }
    const body = cleanSubtitleText(m[3].replace(/\|/g, "\n").replace(/\{[yYcCfFsSpPhH]:[^}]*\}/g, ""), "srt");
    if (body) out.push({ start: a / fps, end: b / fps, text: body });
  }
  return out;
}

/** Every timed line of a subtitle file, sorted by start time. */
export function parseSubtitleFile(text: string, opts: { fps?: number } = {}): SubtitleCue[] {
  const clean = String(text || "").replace(/^\uFEFF/, "");
  const kind = detectSubtitleKind(clean);
  const cues = kind === "vtt" ? parseArrowCues(clean, "vtt")
    : kind === "srt" ? parseArrowCues(clean, "srt")
    : kind === "ass" ? parseAss(clean)
    : kind === "sbv" ? parseSbv(clean)
    : kind === "ttml" ? parseTtml(clean)
    : kind === "sami" ? parseSami(clean)
    : kind === "microdvd" ? parseMicroDvd(clean, opts.fps)
    : [];
  return cues.sort(byStart);
}

/** Lines on screen at once, without the duplicates layered ASS files carry. */
export function uniqueLines(texts: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of texts) { const k = t.trim(); if (k && !seen.has(k)) { seen.add(k); out.push(k); } }
  return out.join("\n");
}
