// RS ANIME — SHARE PREVIEW (Cloudflare Worker build). Paste Worker URL into EGD Router → share-preview.
// ============================================================
// RS Anime — Share link preview
// GET /share-preview/watch/<animeId>?s=1&e=3&o=<site origin>
// Social apps (Telegram, WhatsApp, Facebook…) read the OG tags and show the
// anime's LOGO image on a 16:9 card. Real visitors are redirected instantly
// to <site origin>/watch/<animeId>?s&e.
// ============================================================

const FIREBASE_DB = "https://animeverse-d7b79-default-rtdb.asia-southeast1.firebasedatabase.app";
const FALLBACK_ORIGIN = "https://rsanime03.lovable.app";
const ALLOWED_ORIGIN = /^https:\/\/([a-z0-9-]+\.)*(lovable\.app|lovableproject\.com)$|^http:\/\/localhost(:\d+)?$/i;

const esc = (s) => String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function readAnime(id) {
  for (const path of ["webseries", "movies"]) {
    try {
      const r = await fetch(`${FIREBASE_DB}/${path}/${encodeURIComponent(id)}.json`);
      if (!r.ok) continue;
      const j = await r.json();
      if (j && typeof j === "object") return j;
    } catch { /* next */ }
  }
  return null;
}

// Logo on a dark 16:9 canvas (1200x675) so every app shows a clean card.
const cardImage = (img, isLogo) =>
  `https://wsrv.nl/?url=${encodeURIComponent(img)}&w=1200&h=675&fit=${isLogo ? "contain" : "cover"}&cbg=0b0d14&output=jpg&q=88`;

async function handler(req) {
  const url = new URL(req.url);
  const m = url.pathname.match(/\/watch\/([^/?#]+)/);
  const id = m ? decodeURIComponent(m[1]) : (url.searchParams.get("id") || "");
  const o = String(url.searchParams.get("o") || "").replace(/\/+$/, "");
  const origin = ALLOWED_ORIGIN.test(o) ? o : FALLBACK_ORIGIN;
  const qs = new URLSearchParams();
  for (const k of ["s", "e"]) { const v = url.searchParams.get(k); if (v && /^\d+$/.test(v)) qs.set(k, v); }
  const target = id ? `${origin}/watch/${encodeURIComponent(id)}${qs.toString() ? `?${qs}` : ""}` : origin;

  const a = id ? await readAnime(id) : null;
  const title = String(a?.title || "RS Anime");
  const ep = qs.get("e");
  const season = qs.get("s");
  const heading = ep ? `${title} — ${season && season !== "1" ? `S${season} ` : ""}Episode ${ep}` : title;
  const desc = String(a?.storyline || a?.description || a?.overview || `Watch ${title} on RS Anime`).slice(0, 200);
  const logo = String(a?.logo || a?.titleLogo || "");
  const fallback = String(a?.backdrop || a?.poster || "");
  const image = logo ? cardImage(logo, true) : fallback ? cardImage(fallback, false) : "";

  const html = `<!doctype html><html><head><meta charset="utf-8">
<title>${esc(heading)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="video.other">
<meta property="og:site_name" content="RS Anime">
<meta property="og:title" content="${esc(heading)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(target)}">
${image ? `<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="675">
<meta property="og:image:type" content="image/jpeg">
<meta name="twitter:image" content="${esc(image)}">` : ""}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(heading)}">
<meta name="twitter:description" content="${esc(desc)}">
<link rel="canonical" href="${esc(target)}">
</head><body style="background:#0b0d14"><script>location.replace(${JSON.stringify(target)})</script></body></html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export default { fetch: (req) => handler(req) };
