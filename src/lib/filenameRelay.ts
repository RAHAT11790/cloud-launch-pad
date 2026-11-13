import { getEdgeFunctionUrl } from "@/lib/edgeFunctionRouter";
import { applyActiveDownloadServer, stripWatchSegment } from "@/lib/downloadManagerSettings";
import { unwrapManagedVideoUrl } from "@/lib/videoDownload";
export async function getFilenameRelayBase() { return getEdgeFunctionUrl("file-rename"); }
export function filenameRelayUrl(base: string, source: string, filename: string) {
  if (!base || !/^https?:\/\//i.test(source)) return "";
  const url = new URL(base);
  url.searchParams.set("url", stripWatchSegment(applyActiveDownloadServer(unwrapManagedVideoUrl(source))));
  url.searchParams.set("filename", filename);
  return url.toString();
}