export type DownloadChoice = { quality: string; url: string; fileName: string; locked?: boolean };
export type DownloadEpisode = { number: number; title: string; choices: DownloadChoice[] };
export type DownloadFlowRequest = { title: string; poster?: string; episodes: DownloadEpisode[]; returnPath: string };
export const DOWNLOAD_FLOW_KEY = "rs_download_flow_v1";
export const DEFAULT_DOWNLOAD_ADS = {
  socialBar: '<script data-cfasync="false" src="https://bauval.org/14/76179d54c872b5d668d5a5bd3c60cc20"></script>',
  banner: `<script>var atOptions = {'key':'a50e44c4616d20c203054f1729493757','format':'iframe','height':300,'width':160,'params':{}};</script><script src="https://bauval.org/22/a50e44c4616d20c203054f1729493757"></script>`,
};
export function normalizeDownloadFlowSettings(raw: Record<string, unknown> = {}) {
  const limit = Number(raw.maxEpisodes);
  const stages = Array.isArray(raw.adSteps) ? raw.adSteps : [5, 5];
  return {
    maxEpisodes: Number.isFinite(limit) ? Math.max(1, Math.trunc(limit)) : 2,
    adSteps: stages.slice(0, 10).map((n) => Math.max(1, Math.min(120, Math.trunc(Number(n) || 5)))),
    socialBar: typeof raw.socialBar === "string" ? raw.socialBar : "",
    banner: typeof raw.banner === "string" ? raw.banner : "",
  };
}
export function selectDownloadEpisode(selected: number[], episode: number, maximum: number): number[] {
  if (selected.includes(episode)) return selected.filter((n) => n !== episode);
  return selected.length < maximum ? [...selected, episode] : selected;
}
export function downloadWaitRemaining(seconds: number, visibleElapsedMs: number) {
  return Math.max(0, Math.ceil(seconds - visibleElapsedMs / 1000));
}
export function sourceDownloadFilename(filename: string, source: string) {
  try {
    const match = decodeURIComponent(new URL(source).pathname).match(/\.(mkv|mp4|webm|avi|mov|m4v)$/i);
    return match ? filename.replace(/\.[a-z0-9]{2,5}$/i, `.${match[1].toLowerCase()}`) : filename;
  } catch { return filename; }
}
export function openDownloadFlow(request: DownloadFlowRequest) {
  sessionStorage.setItem(DOWNLOAD_FLOW_KEY, JSON.stringify(request));
  // Full navigation tears down player ad hooks; final page never inherits them.
  window.location.assign("/download");
}