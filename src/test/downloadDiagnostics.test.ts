import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/edgeFunctionRouter", () => ({ getEdgeFunctionUrl: vi.fn() }));
vi.mock("@/lib/downloadManagerSettings", () => ({ applyActiveDownloadServer: (url: string) => url, stripWatchSegment: (url: string) => url }));
vi.mock("@/lib/videoDownload", () => ({ unwrapManagedVideoUrl: (url: string) => url }));
import { isDownloadResponse, validDownloadUrl } from "@/lib/downloadDiagnostics";
describe("Real download detection", () => {
  it("accepts HTTP and HTTPS but never script or credential URLs", () => {
    expect(validDownloadUrl("http://media.example/file.mkv")).toBe("http://media.example/file.mkv");
    expect(validDownloadUrl("https://media.example/file.mkv")).toBe("https://media.example/file.mkv");
    expect(validDownloadUrl("javascript:alert(1)")).toBe("");
    expect(validDownloadUrl("https://name:password@media.example/file.mkv")).toBe("");
  });
  it("requires real file bytes, not a health response", () => {
    const bytes = new Uint8Array([26, 69, 223, 163]);
    expect(isDownloadResponse(206, "video/x-matroska", "", bytes)).toBe(true);
    expect(isDownloadResponse(200, "application/json", "", new TextEncoder().encode('{"ok":true}'))).toBe(false);
    expect(isDownloadResponse(502, "video/mp4", "", bytes)).toBe(false);
    expect(isDownloadResponse(206, "video/mp4", "", new Uint8Array())).toBe(false);
  });
  it("rejects an HTML error even when labelled a binary download", () => {
    expect(isDownloadResponse(200, "application/octet-stream", "attachment", new TextEncoder().encode("<!DOCTYPE html><html>Denied"))).toBe(false);
  });
});