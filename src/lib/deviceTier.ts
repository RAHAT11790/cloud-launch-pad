// Low-end phone detection (≈1–3GB RAM or ≤4 slow cores). Used to drop the
// most expensive decorative effects while keeping the same look.
export function isLiteDevice(): boolean {
  try {
    const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
    const mem = typeof nav.deviceMemory === "number" ? nav.deviceMemory : 4;
    const cores = nav.hardwareConcurrency || 8;
    if (nav.connection?.saveData) return true;
    if (mem <= 2) return true;
    return mem <= 3 && cores <= 4;
  } catch {
    return false;
  }
}

/** Adds `html.rs-lite` once at startup so CSS can trim heavy effects. */
export function applyDeviceTierClass(): void {
  try {
    if (isLiteDevice()) document.documentElement.classList.add("rs-lite");
  } catch {}
}
