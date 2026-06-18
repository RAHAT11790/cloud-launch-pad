import sys

def replace_in_file(file_path, start_marker, end_marker, replacement):
    with open(file_path, 'r') as f:
        content = f.read()
    
    start_idx = content.find(start_marker)
    end_idx = content.find(end_marker, start_idx) + len(end_marker)
    
    if start_idx != -1 and end_idx != -1:
        new_content = content[:start_idx] + replacement + content[end_idx:]
        with open(file_path, 'w') as f:
            f.write(new_content)
        print(f"Updated {file_path}")
    else:
        print(f"Could not find markers in {file_path}")

# VideoPlayer.tsx candidates logic
replacement_candidates = """const buildPlaybackCandidates = (url: string, cdnEnabled: boolean, proxyUrl?: string, proxyApiKey?: string): string[] => {
  if (!url) return [];

  const candidates: string[] = [];
  const addCandidate = (candidate?: string | null) => {
    if (!candidate || candidates.includes(candidate)) return;
    candidates.push(candidate);
  };

  if (isBypassSource(url)) {
    addCandidate(url);
    return candidates;
  }

  const isHttp = isInsecureHttpSource(url);

  if (isHttp) {
    // HTTP source — MUST use admin proxy only. No direct playback (mixed-content block).
    const customProxyCandidate = proxyUrl ? buildProxyPlaybackUrl(proxyUrl, url, proxyApiKey) : null;
    const builtinProxyCandidate = BUILTIN_STREAM_PROXY ? buildProxyPlaybackUrl(BUILTIN_STREAM_PROXY, url) : null;
    
    if (customProxyCandidate) addCandidate(customProxyCandidate);
    if (builtinProxyCandidate) addCandidate(builtinProxyCandidate);
    
    // If no proxy is configured, we have to fallback to the original URL but it will likely fail.
    if (candidates.length === 0) addCandidate(url);
  } else {
    // HTTPS source — direct ONLY (no proxy overhead).
    addCandidate(url);
  }

  return candidates;
};"""

replace_in_file('src/components/VideoPlayer.tsx', 'const buildPlaybackCandidates = (url: string, cdnEnabled: boolean, proxyUrl?: string, proxyApiKey?: string): string[] => {', 'return candidates;\n};', replacement_candidates)

# VideoPlayer.tsx UI messages
with open('src/components/VideoPlayer.tsx', 'r') as f:
    content = f.read()
content = content.replace('<p className="text-[11px] font-semibold text-white truncate">Video unavailable</p>', '<p className="text-[11px] font-semibold text-white truncate">Link Expired</p>')
content = content.replace('<p className="text-[10px] text-white/70 truncate">Tap a different server below</p>', '<p className="text-[10px] text-white/70 truncate">Switch server to continue</p>')
with open('src/components/VideoPlayer.tsx', 'w') as f:
    f.write(content)

# videoDownload.ts
replacement_download = """export function buildVideoDownloadUrl(rawUrl: string, rawFileName: string): string | null {
  const trimmedUrl = String(rawUrl || "").trim();
  if (!trimmedUrl || !isHttpUrl(trimmedUrl)) return null;

  // HTTPS direct only (no proxy)
  if (!trimmedUrl.toLowerCase().startsWith("http://")) {
    return trimmedUrl;
  }

  if (isManagedVideoDownloadUrl(trimmedUrl)) return trimmedUrl;
  const base = resolveBaseSync();
  if (!base) return null;
  const fileName = buildSafeFileName(rawFileName);
  return `${base}?filename=${encodeURIComponent(fileName)}&url=${encodeURIComponent(trimmedUrl)}`;
}"""

replace_in_file('src/lib/videoDownload.ts', 'export function buildVideoDownloadUrl(rawUrl: string, rawFileName: string): string | null {', 'return ;\n}', replacement_download)
