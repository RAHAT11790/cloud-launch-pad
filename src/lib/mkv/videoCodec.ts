// ============================================================
// Video codec strings (pure, testable in Node)
// ============================================================
import type { MkvTrack } from "./mkvDemux";

const hex2 = (v: number) => v.toString(16).padStart(2, "0");

/** RFC 6381 / ISO 14496-15 E.3 codec string from an HEVCDecoderConfigurationRecord. */
export function hevcCodecString(hvcC: Uint8Array | undefined | null, box: "hvc1" | "hev1" = "hvc1"): string {
  if (!hvcC || hvcC.length < 13) return `${box}.1.6.L93.B0`;
  const space = (hvcC[1] >> 6) & 0x03;
  const tier = (hvcC[1] >> 5) & 0x01;
  const profile = hvcC[1] & 0x1f;
  const compat = ((hvcC[2] << 24) | (hvcC[3] << 16) | (hvcC[4] << 8) | hvcC[5]) >>> 0;
  let reversed = 0;
  for (let i = 0; i < 32; i += 1) if (compat & (1 << i)) reversed |= 1 << (31 - i);
  const constraints = Array.from(hvcC.subarray(6, 12));
  while (constraints.length && constraints[constraints.length - 1] === 0) constraints.pop();
  const parts = [
    box,
    `${space ? String.fromCharCode(64 + space) : ""}${profile || 1}`,
    (reversed >>> 0).toString(16).toUpperCase(),
    `${tier ? "H" : "L"}${hvcC[12] || 93}`,
    ...constraints.map((b) => b.toString(16).toUpperCase()),
  ];
  return parts.join(".");
}

/** WebCodecs codec string for the file's video track ("" = not H.264/HEVC). */
export function webCodecsVideoCodec(track: Pick<MkvTrack, "codecId" | "codecPrivate">): string {
  if (/HEVC/i.test(track.codecId)) return hevcCodecString(track.codecPrivate);
  if (/AVC/i.test(track.codecId)) {
    const p = track.codecPrivate;
    return p && p.length >= 4 ? `avc1.${hex2(p[1])}${hex2(p[2])}${hex2(p[3])}` : "avc1.640029";
  }
  return "";
}

/** Bit depth of an HEVC stream from its hvcC (8 for Main, 10 for Main 10 …). */
export function hevcBitDepth(hvcC: Uint8Array | undefined | null): number {
  if (!hvcC || hvcC.length < 23) return 8;
  return (hvcC[17] & 0x07) + 8;
}

/**
 * Video kinds browsers often show as a black screen inside .mkv:
 * "hevc", "avc-6e" (10-bit H.264), "avc-7a" (4:2:2), "avc-f4" (4:4:4); "" = fine.
 */
export const videoFamily = (mime?: string): string => {
  const m = String(mime || "").toLowerCase();
  if (/hvc1|hev1/.test(m)) return "hevc";
  const avc = m.match(/avc[13]\.([0-9a-f]{2})/);
  if (avc && ["6e", "7a", "f4"].includes(avc[1])) return `avc-${avc[1]}`;
  return "";
};
