// ============================================================
// AnNativeView — native HLS player for AN content (no iframe).
//
// Given AN HLS data freshly resolved from the live AnimeSalt API
// (Index.tsx -> animeSaltApi), this component:
//   1. Builds a synthesized HLS master playlist (data: URL) that combines
//      ONE video variant + ALL provided audio renditions.
//   2. Plays the API-returned URLs in a native <video> via hls.js.
//      No Firebase reads — playback is 100% API-driven so links never go stale.
//   3. Quality switching rebuilds the master (preserves currentTime + audio
//      track) — fixed-quality model, no ABR. Audio switching uses the
//      hls.js audioTrack API (instant).
//
// Falls back via onFail() if extraction returns no streams or hls errors.
// ============================================================
import "@/lib/anPlaybackProxy";

type Stream = { url: string; label: string; height: number; resolution: string; bandwidth: number; codecs?: string };
type Audio  = { language: string; name: string; uri: string };

export type AnNativeResolvedData = {
  streams: Stream[];
  audio: Audio[];
  preferredQualityIdx?: number;
  defaultAudioIdx?: number;
};
// AN subtitle extraction/proxy was removed from the API for stability.
