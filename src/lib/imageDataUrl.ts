/** Reads a gallery image and shrinks it into a small data URL (kept inside Firebase settings). */
export async function imageFileToDataUrl(file: File, maxSide = 320, quality = 0.86): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Please choose an image");
  if (file.type === "image/svg+xml" && file.size < 60_000) {
    return await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(file); });
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    c.getContext("2d")!.drawImage(img, 0, 0, w, h);
    return c.toDataURL("image/webp", quality);
  } finally { URL.revokeObjectURL(url); }
}
