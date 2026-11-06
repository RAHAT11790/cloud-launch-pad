import { getEdgeFunctionUrl } from "@/lib/edgeFunctionRouter";
import { applyActiveDownloadServer, stripWatchSegment } from "@/lib/downloadManagerSettings";
import { unwrapManagedVideoUrl } from "@/lib/videoDownload";
export type DownloadCheck = { name: string; state: "working" | "failed" | "unconfigured" | "blocked"; status?: number; bytes?: number; reason?: string };
export function validDownloadUrl(raw: string) {
  try {
    const url = new URL(raw.trim());
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.toString() : "";
  } catch { return ""; }
}
export function isDownloadResponse(status: number, contentType: string, disposition: string, bytes: Uint8Array) {
  if (status !== 200 && status !== 206) return false;
  if (/text\/html|application\/(?:json|problem\+json)/i.test(contentType)) return false;
  const prefix = new TextDecoder().decode(bytes.slice(0, 100)).trimStart();
  if (/^(?:<!doctype|<html|\{\s*"(?:error|message)")/i.test(prefix)) return false;
  return bytes.length > 0 && (/video\/|audio\/|octet-stream|application\/(?:x-matroska|mp4)/i.test(contentType) || /attachment/i.test(disposition));
}
async function probe(name: string, url: string): Promise<DownloadCheck> {
  if (!url) return { name, state: "unconfigured", reason: "No active router URL" };
  if (location.protocol === "https:" && url.startsWith("http:")) return { name, state: "blocked", reason: "HTTP requires an HTTPS relay" };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(url, { headers: { Range: "bytes=0-1023" }, signal: controller.signal, cache: "no-store" });
    reader = response.body?.getReader();
    const first = await reader?.read();
    const bytes = first?.value || new Uint8Array();
    const working = isDownloadResponse(response.status, response.headers.get("Content-Type") || "", response.headers.get("Content-Disposition") || "", bytes);
    return { name, state: working ? "working" : "failed", status: response.status, bytes: bytes.length, reason: working ? "File bytes received" : "No downloadable file response" };
  } catch { return { name, state: "failed", reason: controller.signal.aborted ? "Timed out" : "Network or CORS refused the request" }; }
  finally { await reader?.cancel().catch(() => {}); controller.abort(); clearTimeout(timeout); }
}
export async function checkDownloadFunctions(raw: string): Promise<DownloadCheck[]> {
  const original = validDownloadUrl(raw);
  if (!original) throw new Error("Enter a valid HTTP or HTTPS file URL");
  const source = stripWatchSegment(applyActiveDownloadServer(unwrapManagedVideoUrl(original)));
  const functions = ["file-rename", "video-download", "video-proxy"];
  const routes = await Promise.all(functions.map(async name => {
    const base = await getEdgeFunctionUrl(name).catch(() => "");
    if (!base) return { name, url: "" };
    const url = new URL(base); url.searchParams.set("url", source); url.searchParams.set("filename", "download-check.mkv");
    return { name, url: url.toString() };
  }));
  return Promise.all([{ name: "Direct source", url: source }, ...routes].map(route => probe(route.name, route.url)));
}