// ============================================================
// Cloudflare Worker — apk-download (CF-native)
// Serves the user APK with correct headers.
// Configure SECRET:  APK_URL   (direct download URL of the .apk)
//                    APK_FILENAME (optional, default rs-anime.apk)
// GET / → streams the APK as attachment.
// ============================================================

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Expose-Headers": "content-length, content-type, content-disposition",
};

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const src = (env.APK_URL || "").trim();
    const name = (env.APK_FILENAME || "rs-anime.apk").replace(/[\r\n"]/g, "");
    if (!src) return new Response("APK_URL not configured", { status: 500, headers: cors });

    const range = req.headers.get("range");
    const headers = { "User-Agent": "Mozilla/5.0" };
    if (range) headers.range = range;

    const res = await fetch(src, { method: req.method, headers, redirect: "follow" });
    const out = new Headers(cors);
    for (const k of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
      const v = res.headers.get(k); if (v) out.set(k, v);
    }
    out.set("content-type", "application/vnd.android.package-archive");
    out.set("content-disposition", `attachment; filename="${name}"`);
    if (!out.has("accept-ranges")) out.set("accept-ranges", "bytes");
    return new Response(req.method === "HEAD" ? null : res.body, { status: res.status, headers: out });
  },
};
