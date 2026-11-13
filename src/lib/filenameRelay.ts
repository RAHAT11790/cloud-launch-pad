import { getEdgeFunctionUrl } from "@/lib/edgeFunctionRouter";
import { applyActiveDownloadServer, stripWatchSegment } from "@/lib/downloadManagerSettings";
import { unwrapManagedVideoUrl } from "@/lib/videoDownload";
export async function getFilenameRelayBase() { return getEdgeFunctionUrl("file-rename"); }
function relayFor(base: string, target: string, filename: string) {
  const url = new URL(base);
  url.searchParams.set("url", target);
  url.searchParams.set("filename", filename);
  return url.toString();
}
export function filenameRelayUrl(base: string, source: string, filename: string) {
  if (!base || !/^https?:\/\//i.test(source)) return "";
  return relayFor(base, stripWatchSegment(applyActiveDownloadServer(unwrapManagedVideoUrl(source))), filename);
}
export type RelayCandidate = { href: string; target: string; viaActiveServer: boolean };
/**
 * Relay links to try in order: the admin's active download server first, then
 * the file's own server. A dead active server (offline tunnel, DNS gone) must
 * never make a healthy file undownloadable.
 */
export function filenameRelayCandidates(base: string, source: string, filename: string): RelayCandidate[] {
  if (!base || !/^https?:\/\//i.test(source)) return [];
  const original = stripWatchSegment(unwrapManagedVideoUrl(source));
  const served = stripWatchSegment(applyActiveDownloadServer(unwrapManagedVideoUrl(source)));
  const list: RelayCandidate[] = [{ href: relayFor(base, served, filename), target: served, viaActiveServer: served !== original }];
  if (served !== original) list.push({ href: relayFor(base, original, filename), target: original, viaActiveServer: false });
  return list;
}
/** Why a file could not be reached, in words the viewer understands. */
export function relayFailureReason(status: number | null): string {
  if (status === null) return "Server not reachable";
  if (status === 404 || status === 410) return "File not found on server";
  if (status === 401 || status === 403) return "Server refused the file";
  if (status === 400) return "Invalid file link";
  if (status >= 500) return "File server offline";
  return "File unavailable";
}
