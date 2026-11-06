import { describe, expect, it } from "vitest";
import { validDownloadUrl } from "@/lib/downloadDiagnostics";
describe("Custom download server URL", () => {
  it("accepts HTTP and HTTPS but never script or credential URLs", () => {
    expect(validDownloadUrl("http://media.example/file.mkv")).toBe("http://media.example/file.mkv");
    expect(validDownloadUrl("https://media.example")).toBe("https://media.example/");
    expect(validDownloadUrl("javascript:alert(1)")).toBe("");
    expect(validDownloadUrl("https://name:password@media.example/file.mkv")).toBe("");
  });
});
