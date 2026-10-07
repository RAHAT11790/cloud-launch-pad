// ============================================================
// MP4 / MOV track probe (audio + subtitle list from the `moov` box)
// ============================================================
// Many RS uploads are named ".mp4" but are really Matroska (and a few ".mkv"
// are really MP4), so the container is always sniffed from the first bytes.
// For real MP4 files only the `moov` box is read: a handful of small range
// requests even when `moov` sits at the end of the file.

import type { RangeSource } from "./mkvDemux";
import { languageName } from "./mkvDemux";

export interface Mp4Track {
  id: number;
  kind: "video" | "audio" | "subtitle" | "other";
  codec: string;
  language: string;
  name: string;
  channels?: number;
}

export const isMp4Magic = (b: Uint8Array) =>
  b.length >= 8 && ["ftyp", "moov", "free", "mdat", "wide", "skip", "styp"].includes(String.fromCharCode(b[4], b[5], b[6], b[7]));

const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const type4 = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

interface Box { type: string; start: number; header: number; size: number }

function* boxes(b: Uint8Array, from: number, to: number): Generator<Box> {
  let o = from;
  while (o + 8 <= to) {
    let size = u32(b, o);
    const type = type4(b, o + 4);
    let header = 8;
    if (size === 1) { size = u32(b, o + 8) * 2 ** 32 + u32(b, o + 12); header = 16; }
    if (size === 0) size = to - o;
    if (size < header) return;
    yield { type, start: o, header, size };
    o += size;
  }
}

const CODECS: Record<string, string> = {
  avc1: "H.264", avc3: "H.264", hev1: "HEVC", hvc1: "HEVC", av01: "AV1", vp09: "VP9",
  mp4a: "AAC", "ac-3": "AC3", "ec-3": "E-AC3", opus: "Opus", Opus: "Opus", fLaC: "FLAC", ".mp3": "MP3",
  tx3g: "TX3G", wvtt: "VTT", stpp: "TTML", c608: "CEA-608",
};

const decodeLang = (code: number) => {
  if (!code || code === 0x7fff) return "";
  const s = String.fromCharCode(((code >> 10) & 31) + 0x60, ((code >> 5) & 31) + 0x60, (code & 31) + 0x60);
  return /^[a-z]{3}$/.test(s) && s !== "und" ? s : "";
};

export function parseMoov(m: Uint8Array): Mp4Track[] {
  const out: Mp4Track[] = [];
  const top = Array.from(boxes(m, 0, m.length)).find((x) => x.type === "moov");
  if (!top) return out;
  for (const trak of boxes(m, top.start + top.header, top.start + top.size)) {
    if (trak.type !== "trak") continue;
    const t: Mp4Track = { id: 0, kind: "other", codec: "", language: "", name: "" };
    let handler = "";
    const walk = (from: number, to: number) => {
      for (const b of boxes(m, from, to)) {
        const body = b.start + b.header;
        if (["mdia", "minf", "stbl", "udta", "edts"].includes(b.type)) walk(body, b.start + b.size);
        else if (b.type === "tkhd") t.id = u32(m, body + (m[body] === 1 ? 20 : 12));
        else if (b.type === "hdlr") {
          handler = type4(m, body + 8);
          const raw = new TextDecoder().decode(m.subarray(body + 24, b.start + b.size)).replace(/\0/g, "").trim();
          if (raw && !/handle(r)?$/i.test(raw)) t.name = t.name || raw;
        } else if (b.type === "mdhd") {
          const off = body + (m[body] === 1 ? 4 + 8 + 8 + 4 + 8 : 4 + 4 + 4 + 4 + 4);
          t.language = decodeLang((m[off] << 8) | m[off + 1]);
        } else if (b.type === "stsd") {
          const entry = body + 8;
          const fmt = type4(m, entry + 4);
          t.codec = CODECS[fmt] || fmt.trim();
          if (handler === "soun") t.channels = (m[entry + 8 + 16] << 8) | m[entry + 8 + 17];
        } else if (b.type === "name") {
          t.name = new TextDecoder().decode(m.subarray(body, b.start + b.size)).replace(/\0/g, "").trim();
        }
      }
    };
    walk(trak.start + trak.header, trak.start + trak.size);
    t.kind = handler === "vide" ? "video" : handler === "soun" ? "audio"
      // QuickTime "text" handler tracks in Telegram uploads are chapter titles, not subtitles.
      : (handler === "sbtl" || handler === "subt") && /TX3G|VTT|TTML/.test(t.codec) ? "subtitle" : "other";
    out.push(t);
  }
  return out;
}

/** Locate and read the `moov` box with as few range reads as possible. */
export async function readMp4Tracks(src: RangeSource, head: Uint8Array): Promise<Mp4Track[]> {
  let pos = 0;
  for (let guard = 0; guard < 24; guard += 1) {
    const local = pos + 16 <= head.length ? head.subarray(pos, pos + 16) : await src.read(pos, 16);
    if (local.length < 8) break;
    let size = u32(local, 0);
    const type = type4(local, 4);
    if (size === 1) size = u32(local, 8) * 2 ** 32 + u32(local, 12);
    if (type === "moov") {
      if (size > 32 * 1024 * 1024) throw new Error("moov too large");
      const body = pos + size <= head.length ? head.subarray(pos, pos + size) : await src.read(pos, size);
      return parseMoov(body);
    }
    if (size < 8) break;
    pos += size;
  }
  throw new Error("moov not found");
}

export const mp4TrackLabel = (t: Mp4Track, index: number) =>
  languageName(t.language) || (t.kind === "audio" ? `Audio ${index + 1}` : `Subtitle ${index + 1}`);
