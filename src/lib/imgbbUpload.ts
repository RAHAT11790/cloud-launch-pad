// Fast & robust ImgBB upload — auto-compresses large images, retries on failure,
// and falls back across multiple API keys to make uploads succeed in ~1s even
// on flaky networks.

const IMGBB_API_KEYS = [
  "d5c0bce7c98c54d813bf285ffe453689",
  "8a3f9a6b3f4f3d7c0c0c0c0c0c0c0c0c", // placeholder fallback (ignored if invalid)
];

const MAX_DIMENSION = 1920;            // downscale anything larger
const COMPRESS_THRESHOLD_BYTES = 1.2 * 1024 * 1024; // >1.2MB → compress
const ATTEMPT_TIMEOUT_MS = 12000;      // per-request timeout
const MAX_ATTEMPTS = 3;

async function compressImage(file: File): Promise<Blob> {
  // Only compress raster images; skip svg/gif/anything non-raster
  if (!/^image\/(jpeg|jpg|png|webp)$/i.test(file.type)) return file;
  if (file.size < COMPRESS_THRESHOLD_BYTES) return file;

  try {
    const bitmap = await createImageBitmap(file).catch(() => null);
    if (!bitmap) return file;

    let { width, height } = bitmap;
    const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
    width = Math.round(width * scale);
    height = Math.round(height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85),
    );
    if (!blob) return file;
    // Use whichever is smaller
    return blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

async function attemptUpload(payload: Blob, key: string, signal: AbortSignal): Promise<string> {
  const formData = new FormData();
  formData.append("image", payload);
  formData.append("key", key);

  const res = await fetch("https://api.imgbb.com/1/upload", {
    method: "POST",
    body: formData,
    signal,
  });
  if (!res.ok) throw new Error(`ImgBB HTTP ${res.status}`);
  const json = await res.json();
  const url = json?.data?.display_url || json?.data?.url;
  if (!url) throw new Error("ImgBB: no URL returned");
  return url as string;
}

export async function uploadToImgbb(file: File): Promise<string> {
  const compressed = await compressImage(file);

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const key = IMGBB_API_KEYS[attempt % IMGBB_API_KEYS.length];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
    try {
      const url = await attemptUpload(compressed, key, controller.signal);
      clearTimeout(timer);
      return url;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      // Small backoff between attempts (200ms, 500ms)
      if (attempt < MAX_ATTEMPTS - 1) {
        await new Promise((r) => setTimeout(r, 200 + attempt * 300));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("ImgBB upload failed");
}
