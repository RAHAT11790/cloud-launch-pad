export type DownloadChoice = { quality: string; url: string; fileName: string; locked?: boolean };
export type DownloadEpisode = { number: number; title: string; choices: DownloadChoice[]; telegramUrl?: string };
export type DownloadFlowRequest = { title: string; poster?: string; season?: number; episodes: DownloadEpisode[]; telegramUrl?: string; telegramEpisodeCount?: number; returnPath: string };
export const DOWNLOAD_FLOW_KEY = "rs_download_flow_v1";
export const DOWNLOAD_FINAL_KEY = "rs_download_final_v1";
export function downloadNeedsAdFlow(premium: boolean | null) { return premium === false; }
export function sponsorWaitComplete(seconds: number, awayMs: number) { return awayMs >= seconds * 1000; }
export function sponsorReturnOutcome(seconds: number, awayMs: number, delivered: boolean) {
  return !delivered || sponsorWaitComplete(seconds, awayMs) ? "advance" : "retry";
}
export function nextDownloadStep(step: number, count: number): number | "final" {
  return step + 1 >= count ? "final" : step + 1;
}
export function freeDownloadQuality(value: string) {
  const label = value.trim().toLowerCase();
  const match = label.match(/^(480|720|1080)p?$/);
  return match ? `${match[1]}p` : label === "default" ? "Original file" : "";
}
export const DEFAULT_DOWNLOAD_ADS = {
  socialBar: '<script data-cfasync="false" src="https://bauval.org/14/76179d54c872b5d668d5a5bd3c60cc20"></script>',
  banner: `<script>var atOptions = {'key':'a50e44c4616d20c203054f1729493757','format':'iframe','height':300,'width':160,'params':{}};</script><script src="https://bauval.org/22/a50e44c4616d20c203054f1729493757"></script>`,
};
const clampSteps = (value: unknown): number[] | null => {
  const list = Array.isArray(value) ? value : value && typeof value === "object" ? Object.values(value) : null;
  return list ? list.slice(0, 10).map((n) => Math.max(1, Math.min(120, Math.trunc(Number(n) || 5)))) : null;
};
/** Ad steps per selected-episode count: keys "1".."N" plus optional "all" (selection beyond the limit). */
export type AdStepsByCount = Record<string, number[]>;
export function normalizeDownloadFlowSettings(raw: Record<string, unknown> = {}) {
  const limit = Number(raw.maxEpisodes);
  const byCountRaw = raw.adStepsByCount && typeof raw.adStepsByCount === "object" ? raw.adStepsByCount as Record<string, unknown> : {};
  const adStepsByCount: AdStepsByCount = {};
  for (const [key, value] of Object.entries(byCountRaw)) {
    const steps = clampSteps(value);
    if (steps && (/^[1-9]\d*$/.test(key) || key === "all")) adStepsByCount[key] = steps;
  }
  return {
    maxEpisodes: Number.isFinite(limit) ? Math.max(1, Math.trunc(limit)) : 2,
    adSteps: clampSteps(raw.adSteps) ?? [5, 5],
    adStepsByCount,
    socialBar: typeof raw.socialBar === "string" ? raw.socialBar : "",
    banner: typeof raw.banner === "string" ? raw.banner : "",
  };
}
type FlowRules = { maxEpisodes: number; adSteps: number[]; adStepsByCount?: AdStepsByCount };
/** Free users may pick every episode only when the admin configured an "All episodes" box. */
export function downloadAllowsAll(rules: FlowRules) { return Array.isArray(rules.adStepsByCount?.all); }
export function downloadSelectionLimit(rules: FlowRules, total: number) {
  return downloadAllowsAll(rules) ? Math.max(total, rules.maxEpisodes) : rules.maxEpisodes;
}
/** Exact count box first; beyond the per-request limit the "All episodes" box; otherwise the default steps. */
export function downloadStepsFor(rules: FlowRules, count: number): number[] {
  const byCount = rules.adStepsByCount || {};
  if (byCount[String(count)]) return byCount[String(count)];
  if (count > rules.maxEpisodes && byCount.all) return byCount.all;
  return rules.adSteps;
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
  sessionStorage.removeItem(DOWNLOAD_FINAL_KEY);
  sessionStorage.setItem(DOWNLOAD_FLOW_KEY, JSON.stringify(request));
  // Full navigation tears down player ad hooks; final page never inherits them.
  window.location.assign("/download");
}