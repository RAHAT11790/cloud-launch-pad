import { describe, expect, it } from "vitest";
import { readId, readVint, readSignedVint, readElementHeader, eachChild, EBML_IDS } from "@/lib/mkv/ebml";
import { buildFragment, buildInitSegment } from "@/lib/mkv/mp4Writer";
import { isLikelyMatroskaUrl, languageLabel, mkvTestHooks } from "@/lib/mkv/mkvMultiAudio";

const boxTypes = (buf: Uint8Array): string[] => {
  const out: string[] = [];
  let offset = 0;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  while (offset + 8 <= buf.length) {
    const size = view.getUint32(offset);
    const type = String.fromCharCode(buf[offset + 4], buf[offset + 5], buf[offset + 6], buf[offset + 7]);
    out.push(type);
    if (size < 8) break;
    offset += size;
  }
  return out;
};

const findBox = (buf: Uint8Array, type: string): boolean => {
  const needle = type.split("").map((c) => c.charCodeAt(0));
  for (let i = 0; i + needle.length <= buf.length; i += 1) {
    let hit = true;
    for (let j = 0; j < needle.length; j += 1) {
      if (buf[i + j] !== needle[j]) { hit = false; break; }
    }
    if (hit) return true;
  }
  return false;
};

describe("EBML primitives", () => {
  it("reads element ids with their marker bits", () => {
    const buf = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]);
    expect(readId(buf, 0)).toEqual({ id: EBML_IDS.EBML, length: 4 });
    expect(readId(new Uint8Array([0xa3]), 0)).toEqual({ id: EBML_IDS.SimpleBlock, length: 1 });
  });

  it("reads sizes and detects unknown size", () => {
    expect(readVint(new Uint8Array([0x84]), 0)).toEqual({ value: 4, length: 1, unknown: false });
    expect(readVint(new Uint8Array([0x41, 0x23]), 0)).toEqual({ value: 0x123, length: 2, unknown: false });
    expect(readVint(new Uint8Array([0xff]), 0)?.unknown).toBe(true);
  });

  it("reads signed lacing deltas", () => {
    expect(readSignedVint(new Uint8Array([0xbf]), 0)?.value).toBe(0x3f - 63);
  });

  it("walks children of a master element", () => {
    // Info element with TimecodeScale = 1000000
    const body = new Uint8Array([0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40]);
    const seen: number[] = [];
    eachChild(body, 0, body.length, (el) => seen.push(el.id));
    expect(seen).toEqual([EBML_IDS.TimecodeScale]);
    const header = readElementHeader(body, 0);
    expect(header?.size).toBe(3);
  });
});

describe("fragmented MP4 writer", () => {
  const avcC = new Uint8Array([0x01, 0x64, 0x00, 0x29, 0xff, 0xe1, 0x00, 0x04, 0x27, 0x64, 0x00, 0x29, 0x01, 0x00, 0x04, 0x28, 0xee, 0x3c, 0xb0]);

  it("writes a video init segment with ftyp + moov + avcC", () => {
    const init = buildInitSegment({
      kind: "video", timescale: 1000, width: 1920, height: 1080, codecPrivate: avcC, codecBox: "avc1",
    });
    expect(boxTypes(init).slice(0, 2)).toEqual(["ftyp", "moov"]);
    expect(findBox(init, "avcC")).toBe(true);
    expect(findBox(init, "mvex")).toBe(true);
  });

  it("writes an audio init segment with esds", () => {
    const init = buildInitSegment({
      kind: "audio", timescale: 1000, channels: 2, sampleRate: 48000, sampleSize: 16,
      codecPrivate: new Uint8Array([0x11, 0x90]),
    });
    expect(findBox(init, "mp4a")).toBe(true);
    expect(findBox(init, "esds")).toBe(true);
    expect(findBox(init, "smhd")).toBe(true);
  });

  it("writes moof + mdat with correct sizes and sample count", () => {
    const samples = [
      { data: new Uint8Array([1, 2, 3, 4]), duration: 42, cto: 0, isKey: true },
      { data: new Uint8Array([5, 6]), duration: 42, cto: 84, isKey: false },
    ];
    const fragment = buildFragment(1, 1000, samples, 1);
    const types = boxTypes(fragment);
    expect(types).toEqual(["moof", "mdat"]);
    const view = new DataView(fragment.buffer, fragment.byteOffset, fragment.byteLength);
    const moofSize = view.getUint32(0);
    const mdatSize = view.getUint32(moofSize);
    expect(mdatSize).toBe(8 + 6);
    expect(findBox(fragment, "tfdt")).toBe(true);
    expect(findBox(fragment, "trun")).toBe(true);
  });

  it("keeps mdat payload byte-identical to the samples", () => {
    const fragment = buildFragment(2, 0, [{ data: new Uint8Array([9, 8, 7]), duration: 10, cto: 0, isKey: true }], 1);
    const view = new DataView(fragment.buffer, fragment.byteOffset, fragment.byteLength);
    const moofSize = view.getUint32(0);
    expect(Array.from(fragment.slice(moofSize + 8))).toEqual([9, 8, 7]);
  });
});

describe("MKV helpers", () => {
  it("detects matroska sources, including proxied urls", () => {
    expect(isLikelyMatroskaUrl("https://host/x/Anime+S01+E12+1080p.mkv?hash=abc")).toBe(true);
    expect(isLikelyMatroskaUrl("https://edge/functions/v1/video-proxy?url=https%3A%2F%2Fhost%2Fa.mkv%3Fhash%3D1")).toBe(true);
    expect(isLikelyMatroskaUrl("https://host/video.mp4")).toBe(false);
    expect(isLikelyMatroskaUrl("https://host/master.m3u8")).toBe(false);
  });

  it("maps language codes to readable names", () => {
    expect(languageLabel("hin", "hin")).toBe("Hindi");
    expect(languageLabel("jpn", "jpn")).toBe("Japanese");
    expect(languageLabel("eng", "eng")).toBe("English");
    expect(languageLabel("xyz", "XYZ")).toBe("XYZ");
  });

  it("derives mp4 codec strings", () => {
    expect(mkvTestHooks.audioCodecString(new Uint8Array([0x11, 0x90]))).toBe("mp4a.40.2");
    expect(mkvTestHooks.videoCodecString("V_MPEG4/ISO/AVC", new Uint8Array([1, 0x64, 0x00, 0x29]))).toBe("avc1.640029");
  });

  it("builds a valid AAC AudioSpecificConfig when the file omits one", () => {
    const asc = mkvTestHooks.buildAudioSpecificConfig(48000, 2);
    expect(asc.length).toBe(2);
    expect((asc[0] >> 3) & 0x1f).toBe(2); // AAC-LC
    expect(((asc[0] & 0x07) << 1) | (asc[1] >> 7)).toBe(3); // 48 kHz index
  });

  it("strips ASS styling into plain subtitle text", () => {
    const raw = "0,0,Default,,0,0,0,,{\\i1}Big Sister...{\\i0}\\NWe meet.";
    expect(mkvTestHooks.stripAssText(raw)).toBe("Big Sister...\nWe meet.");
  });
});
