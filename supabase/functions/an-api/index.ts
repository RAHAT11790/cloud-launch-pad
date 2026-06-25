// ============================================================
// an-api — Standalone AnimeSalt (AN) Search + Stream Extractor API
// ============================================================
// Endpoints (all GET, JSON unless noted):
//   GET /                       → Beautiful HTML UI (browser)
//   GET /search?q=naruto        → [{slug,title,poster,year,type}]
//   GET /anime?slug=&type=series→ {title,poster,storyline,seasons:[{name,episodes:[{number,title,slug}]}]}
//   GET /episode?slug=naruto-1x1→ {slug,title,sources:[{embed,master,streams:[{url,filename,resolution,height,bandwidth}],audio:[{language,name,uri}]}]}
// CORS: open. Pure scraping — no secrets required.
// ============================================================

const AN_BASE = "https://animesalt.ac";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const cors: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });

const decode = (s: string) =>
  s
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&#8211;|&ndash;/g, "-")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, "")
    .trim();

const parseHlsAttrs = (line: string): Record<string, string> => {
  const attrs: Record<string, string> = {};
  const body = line.includes(":") ? line.slice(line.indexOf(":") + 1) : line;
  const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    attrs[m[1].toUpperCase()] = String(m[2] || "").replace(/^"|"$/g, "");
  }
  return attrs;
};

const resolveUrl = (value: string, baseUrl: string) => {
  try { return new URL(value, baseUrl).toString(); } catch { return value; }
};

const uniqueByUri = <T extends { uri?: string; url?: string }>(items: T[]) => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = String(item.uri || item.url || "").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

async function fetchText(url: string, init?: RequestInit): Promise<string> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "User-Agent": UA,
      Accept: "text/html,*/*",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: AN_BASE + "/",
      ...(init?.headers || {}),
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Upstream ${res.status} for ${url}`);
  return await res.text();
}

// ---------- SEARCH ----------
async function search(q: string) {
  const html = await fetchText(`${AN_BASE}/?s=${encodeURIComponent(q)}`);
  const seen = new Set<string>();
  const out: any[] = [];
  // Each result is wrapped in <li ...><article>...<a class="lnk-blk" href="...slug/"></a></article></li>
  const liRe = /<li[^>]*class="[^"]*post-\d+[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
  let m: RegExpExecArray | null;
  while ((m = liRe.exec(html))) {
    const block = m[1];
    const hrefM = block.match(/href="https:\/\/animesalt\.ac\/(series|movies)\/([^"\/]+)\/?"/i);
    if (!hrefM) continue;
    const type = hrefM[1];
    const slug = hrefM[2];
    if (seen.has(slug)) continue;
    seen.add(slug);
    const titleM = block.match(/<h2[^>]*class="entry-title"[^>]*>([\s\S]*?)<\/h2>/i);
    const title = titleM ? decode(titleM[1]) : slug.replace(/-/g, " ");
    // poster: prefer data-src on img, fall back to src
    const imgM =
      block.match(/<img[^>]+data-src="([^"]+)"/i) ||
      block.match(/<img[^>]+src="(https?:[^"]+)"/i);
    let poster = imgM ? imgM[1] : "";
    if (poster.startsWith("//")) poster = "https:" + poster;
    const yearM = block.match(/annee-(\d{3,4})/i) || block.match(/(?:19|20)\d{2}/);
    out.push({
      slug,
      type,
      title,
      poster,
      year: yearM ? yearM[0].replace(/^annee-/, "") : "",
      detailUrl: `${AN_BASE}/${type}/${slug}/`,
    });
  }
  return out;
}

// ---------- ANIME DETAIL ----------
async function detail(slug: string, type: string) {
  const t = type === "movies" ? "movies" : "series";
  const html = await fetchText(`${AN_BASE}/${t}/${slug}/`);
  const titleM =
    html.match(/<meta property="og:title" content="([^"]+)"/i) ||
    html.match(/<title>([^<]+)<\/title>/i);
  const posterM = html.match(/<meta property="og:image" content="([^"]+)"/i);
  const descM = html.match(/<meta name="description" content="([^"]+)"/i);

  const seasons = new Map<string, { name: string; episodes: any[] }>();
  const epRe =
    /<a[^>]+href="https:\/\/animesalt\.ac\/episode\/([^"\/]+)\/?"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = epRe.exec(html))) {
    const epSlug = m[1];
    if (seen.has(epSlug)) continue;
    seen.add(epSlug);
    const inner = decode(m[2]) || epSlug;
    const sx = epSlug.match(/(\d+)x(\d+)$/i);
    const seasonNum = sx ? Number(sx[1]) : 1;
    const epNum = sx ? Number(sx[2]) : seen.size;
    const key = `Season ${seasonNum}`;
    if (!seasons.has(key)) seasons.set(key, { name: key, episodes: [] });
    seasons.get(key)!.episodes.push({ number: epNum, title: inner, slug: epSlug });
  }

  const seasonsArr = Array.from(seasons.values()).map((s) => ({
    name: s.name,
    episodes: s.episodes.sort((a, b) => a.number - b.number),
  }));

  return {
    slug,
    type: t,
    title: titleM ? decode(titleM[1]) : slug,
    poster: posterM ? posterM[1] : "",
    storyline: descM ? decode(descM[1]) : "",
    seasons: seasonsArr,
    episodeCount: seasonsArr.reduce((n, s) => n + s.episodes.length, 0),
  };
}

// ---------- EPISODE → ALL STREAM URLS ----------
function parseMaster(masterUrl: string, body: string) {
  const base = new URL(masterUrl);
  const baseOrigin = `${base.protocol}//${base.host}`;
  const resolve = (u: string) =>
    /^https?:\/\//i.test(u) ? u : u.startsWith("/") ? baseOrigin + u : new URL(u, masterUrl).toString();

  const lines = body.split(/\r?\n/);
  const streams: any[] = [];
  const audio: any[] = [];
  const subtitles: any[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("#EXT-X-MEDIA") && /TYPE=AUDIO/i.test(line)) {
      const attrs = parseHlsAttrs(line);
      const lang = attrs.LANGUAGE || "";
      const name = attrs.NAME || lang;
      const uri = attrs.URI || "";
      if (uri) audio.push({ language: lang, name, uri: resolve(uri) });
    } else if (line.startsWith("#EXT-X-MEDIA") && /TYPE=(SUBTITLES|CLOSED-CAPTIONS)/i.test(line)) {
      const attrs = parseHlsAttrs(line);
      const lang = attrs.LANGUAGE || "";
      const name = attrs.NAME || lang || attrs["GROUP-ID"] || "Subtitle";
      const uri = attrs.URI || "";
      if (uri) subtitles.push({ language: lang, name, uri: resolve(uri) });
    } else if (line.startsWith("#EXT-X-STREAM-INF")) {
      const next = (lines[i + 1] || "").trim();
      if (!next || next.startsWith("#")) continue;
      const attrs = parseHlsAttrs(line);
      const res = attrs.RESOLUTION || "";
      const name = attrs.NAME || "";
      const bw = Number(attrs.BANDWIDTH || 0);
      const height = res ? Number(res.split("x")[1]) : 0;
      const url = resolve(next);
      const label = name || (height ? `${height}p` : "auto");
      const filename = `${label}.m3u8`;
      streams.push({ url, filename, resolution: res, height, bandwidth: bw, label });
    }
  }
  streams.sort((a, b) => b.height - a.height);
  return { streams, audio: uniqueByUri(audio), subtitles: uniqueByUri(subtitles) };
}

function collectSubtitleCandidates(value: unknown, baseUrl: string, out: any[], depth = 0) {
  if (!value || depth > 5) return;
  if (Array.isArray(value)) {
    value.forEach((item) => collectSubtitleCandidates(item, baseUrl, out, depth + 1));
    return;
  }
  if (typeof value !== "object") return;

  const obj = value as Record<string, any>;
  const kind = String(obj.kind || obj.type || obj.trackType || obj.fileType || "").toLowerCase();
  const label = String(obj.label || obj.name || obj.title || obj.language || obj.lang || obj.srclang || "Subtitle");
  const raw = obj.file || obj.url || obj.src || obj.uri || obj.link || obj.href;
  const rawString = typeof raw === "string" ? raw.trim() : "";
  const looksLikeSubtitle = /sub|caption|text|vtt|srt|webvtt|ttml|dfxp/i.test(kind) || /\.(vtt|srt|webvtt|ttml|dfxp)(\?|#|$)/i.test(rawString);
  if (rawString && looksLikeSubtitle) {
    out.push({
      language: obj.language || obj.srclang || obj.lang || "",
      name: label || obj.language || obj.lang || "Subtitle",
      uri: resolveUrl(rawString, baseUrl),
    });
  }

  for (const key of ["captions", "caption", "subtitles", "subtitle", "tracks", "textTracks", "subs", "files", "sources"]) {
    if (obj[key]) collectSubtitleCandidates(obj[key], baseUrl, out, depth + 1);
  }
}

async function extractFromPlayer(embedUrl: string) {
  // embedUrl: https://as-cdnNN.top/video/{hash}
  const m = embedUrl.match(/^(https?:\/\/[^\/]+)\/video\/([a-f0-9]+)/i);
  if (!m) return { embed: embedUrl, error: "unrecognized embed format" };
  const origin = m[1];
  const hash = m[2];
  const apiUrl = `${origin}/player/index.php?data=${hash}&do=getVideo`;
  const body = new URLSearchParams({ hash, r: AN_BASE + "/" }).toString();
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      Referer: embedUrl,
      Origin: origin,
      "X-Requested-With": "XMLHttpRequest",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const txt = await res.text();
  let data: any;
  try { data = JSON.parse(txt); } catch {
    return { embed: embedUrl, error: "player did not return JSON", raw: txt.slice(0, 200) };
  }
  const master = data.videoSource || data.securedLink || "";
  let parsed: any = { streams: [], audio: [], subtitles: [] };
  if (master) {
    try {
      const mRes = await fetch(master, { headers: { "User-Agent": UA, Referer: origin + "/" } });
      const mTxt = await mRes.text();
      parsed = parseMaster(master, mTxt);
    } catch (e) {
      parsed.error = `master fetch failed: ${(e as Error).message}`;
    }
  }
  // Some AN player JSONs expose captions in top-level or nested player fields.
  const extraSubs: any[] = [];
  collectSubtitleCandidates(data, embedUrl, extraSubs);
  const allSubs = uniqueByUri([...(parsed.subtitles || []), ...extraSubs]);
  return {
    embed: embedUrl,
    hash,
    poster: data.videoImage || "",
    master,
    streams: parsed.streams,
    audio: parsed.audio,
    subtitles: allSubs,
  };
}

async function episode(slug: string, type?: string) {
  // Try paths based on type, fall back to the other if no embeds.
  const candidates = type === "movies"
    ? [`${AN_BASE}/movies/${slug}/`, `${AN_BASE}/episode/${slug}/`]
    : [`${AN_BASE}/episode/${slug}/`, `${AN_BASE}/movies/${slug}/`, `${AN_BASE}/series/${slug}/`];

  let html = "";
  let pageUrl = candidates[0];
  let embeds = new Set<string>();
  for (const url of candidates) {
    try {
      const h = await fetchText(url);
      const found = new Set<string>();
      const reIframe = /<iframe[^>]+(?:src|data-src)="([^"]+)"/gi;
      let m: RegExpExecArray | null;
      while ((m = reIframe.exec(h))) {
        if (/\/video\/[a-f0-9]+/i.test(m[1])) found.add(m[1]);
      }
      const reData = /data-(?:src|embed|player|video)="([^"]+\/video\/[a-f0-9]+[^"]*)"/gi;
      while ((m = reData.exec(h))) found.add(m[1]);
      // any URL in HTML
      const reAny = /https?:\/\/[a-z0-9.-]+\/video\/[a-f0-9]+/gi;
      while ((m = reAny.exec(h))) found.add(m[0]);
      if (found.size > 0) { html = h; pageUrl = url; embeds = found; break; }
      if (!html) { html = h; pageUrl = url; }
    } catch {}
  }

  const titleM =
    html.match(/<meta property="og:title" content="([^"]+)"/i) ||
    html.match(/<title>([^<]+)<\/title>/i);

  const sources: any[] = [];
  for (const embed of embeds) {
    try {
      sources.push(await extractFromPlayer(embed));
    } catch (e) {
      sources.push({ embed, error: (e as Error).message });
    }
  }
  return {
    slug,
    title: titleM ? decode(titleM[1]) : slug,
    pageUrl,
    sources,
  };
}

// ---------- HTML UI ----------
const HTML_UI = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>AN Stream API — Explorer</title>
<style>
:root{--bg:#0a0b10;--panel:#13151d;--line:#262936;--text:#e7e9ee;--mute:#8b90a0;--acc:#ff4d6d;--acc2:#7c4dff;--ok:#3fd97f}
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,Inter,sans-serif;background:radial-gradient(1200px 600px at 10% -10%,#1a1330 0%,transparent 60%),radial-gradient(900px 600px at 110% 10%,#301525 0%,transparent 60%),var(--bg);color:var(--text);min-height:100vh}
.wrap{max-width:1100px;margin:0 auto;padding:28px 18px 80px}
header{display:flex;align-items:center;gap:14px;margin-bottom:22px}
.logo{width:42px;height:42px;border-radius:12px;background:linear-gradient(135deg,var(--acc),var(--acc2));display:grid;place-items:center;font-weight:800;color:#fff;box-shadow:0 8px 28px rgba(124,77,255,.35)}
h1{font-size:20px;margin:0;letter-spacing:.3px}
.sub{color:var(--mute);font-size:13px;margin-top:2px}
.search{display:flex;gap:10px;background:var(--panel);border:1px solid var(--line);padding:10px;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.35)}
.search input{flex:1;background:transparent;border:0;outline:0;color:var(--text);padding:12px 8px;font-size:16px}
.search button{background:linear-gradient(135deg,var(--acc),var(--acc2));border:0;color:#fff;padding:0 20px;border-radius:10px;font-weight:600;cursor:pointer;font-size:14px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:14px;margin-top:22px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;overflow:hidden;cursor:pointer;transition:transform .15s,border-color .15s}
.card:hover{transform:translateY(-3px);border-color:#3a3f55}
.card .pwrap{aspect-ratio:2/3;background:#1a1c25;background-size:cover;background-position:center}
.card .meta{padding:10px 12px}
.card .t{font-size:13px;font-weight:600;line-height:1.25;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.card .s{font-size:11px;color:var(--mute);margin-top:4px;display:flex;justify-content:space-between}
.badge{background:rgba(124,77,255,.18);color:#cdbbff;padding:1px 7px;border-radius:6px;font-size:10px;text-transform:uppercase;letter-spacing:.5px}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:18px;margin-top:22px}
.epheader{display:flex;gap:16px;align-items:flex-start}
.epheader img{width:120px;border-radius:10px}
.epheader h2{margin:0 0 6px;font-size:18px}
.epheader p{color:var(--mute);font-size:13px;line-height:1.5;margin:0}
.season{margin-top:14px}
.season h3{margin:0 0 8px;font-size:13px;color:var(--mute);text-transform:uppercase;letter-spacing:.6px}
.eps{display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:6px}
.ep{padding:8px;text-align:center;background:#1a1d28;border:1px solid var(--line);border-radius:8px;cursor:pointer;font-size:12px;transition:border-color .15s,background .15s}
.ep:hover{border-color:var(--acc);background:#222533}
.streams{margin-top:10px}
.src{background:#1a1d28;border:1px solid var(--line);border-radius:10px;padding:12px;margin-top:10px}
.src .hd{display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--mute);margin-bottom:8px}
.qrow{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px;background:#0f1119;border:1px solid var(--line);border-radius:8px;margin-top:6px;flex-wrap:wrap}
.qrow .l{font-weight:600;font-size:13px}
.qrow .u{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:#a4b1d0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:200px}
.copy{background:var(--ok);border:0;color:#04230f;padding:5px 10px;border-radius:6px;font-weight:600;font-size:11px;cursor:pointer}
.copy.open{background:var(--acc)}
.loading{text-align:center;color:var(--mute);padding:30px;font-size:14px}
.err{background:rgba(255,77,109,.12);color:#ff97a8;padding:12px;border-radius:10px;border:1px solid rgba(255,77,109,.3);font-size:13px;margin-top:10px}
.tabs{display:flex;gap:6px;margin-top:14px;border-bottom:1px solid var(--line)}
.tab{padding:8px 14px;cursor:pointer;font-size:13px;color:var(--mute);border-bottom:2px solid transparent}
.tab.on{color:var(--text);border-color:var(--acc)}
.api-hint{background:#0f1119;border:1px solid var(--line);padding:10px 14px;border-radius:10px;margin-top:18px;font-family:ui-monospace,Menlo,monospace;font-size:11px;color:#a4b1d0;overflow:auto}
.api-hint b{color:var(--acc)}
.back{background:transparent;border:1px solid var(--line);color:var(--text);padding:6px 12px;border-radius:8px;cursor:pointer;font-size:12px;margin-bottom:14px}
</style>
</head><body>
<div class="wrap">
  <header>
    <div class="logo">AN</div>
    <div>
      <h1>AnimeSalt Stream API</h1>
      <div class="sub">Search any anime → fetch every episode → extract all quality streams</div>
    </div>
  </header>

  <form class="search" onsubmit="event.preventDefault();doSearch()">
    <input id="q" placeholder="Search anime… (e.g. Naruto)" autocomplete="off"/>
    <button>Search</button>
  </form>

  <div id="out"></div>

  <div class="api-hint">
    <b>API Endpoints:</b><br/>
    GET <span id="origin"></span>/search?q=naruto<br/>
    GET <span id="origin2"></span>/anime?slug=naruto&type=series<br/>
    GET <span id="origin3"></span>/episode?slug=naruto-1x1
  </div>
</div>

<script>
const $=s=>document.querySelector(s);
const out=$('#out');
const O=location.origin+location.pathname.replace(/\\/$/,'');
['origin','origin2','origin3'].forEach(id=>$('#'+id).textContent=O);

async function doSearch(){
  const q=$('#q').value.trim();
  if(!q) return;
  out.innerHTML='<div class="loading">Searching…</div>';
  try{
    const r=await fetch(O+'/search?q='+encodeURIComponent(q));
    const d=await r.json();
    if(!Array.isArray(d)||d.length===0){out.innerHTML='<div class="err">No results found.</div>';return;}
    out.innerHTML='<div class="grid">'+d.map(it=>\`
      <div class="card" onclick='openAnime(\${JSON.stringify(it).replace(/'/g,"&#39;")})'>
        <div class="pwrap" style="background-image:url('\${it.poster||""}')"></div>
        <div class="meta">
          <div class="t">\${it.title}</div>
          <div class="s"><span class="badge">\${it.type}</span><span>\${it.year||""}</span></div>
        </div>
      </div>\`).join('')+'</div>';
  }catch(e){out.innerHTML='<div class="err">'+e.message+'</div>';}
}

async function openAnime(it){
  out.innerHTML='<button class="back" onclick="doSearch()">← Back to results</button><div class="loading">Loading episodes…</div>';
  try{
    const r=await fetch(O+'/anime?slug='+encodeURIComponent(it.slug)+'&type='+it.type);
    const d=await r.json();
    let h='<button class="back" onclick="doSearch()">← Back to results</button><div class="panel">';
    h+=\`<div class="epheader"><img src="\${d.poster||it.poster||''}"/><div><h2>\${d.title}</h2><p>\${d.storyline||''}</p><div class="s" style="margin-top:8px"><span class="badge">\${d.episodeCount} episodes</span></div></div></div>\`;
    if(d.seasons.length===0 && it.type==='movies'){
      h+=\`<div class="season"><div class="eps"><div class="ep" onclick='openEpisode("\${it.slug}")'>Play Movie</div></div></div>\`;
    } else {
      d.seasons.forEach(s=>{
        h+=\`<div class="season"><h3>\${s.name}</h3><div class="eps">\${s.episodes.map(e=>\`<div class="ep" onclick='openEpisode("\${e.slug}")'>EP \${e.number}</div>\`).join('')}</div></div>\`;
      });
    }
    h+='</div>';
    out.innerHTML=h;
  }catch(e){out.innerHTML+='<div class="err">'+e.message+'</div>';}
}

async function openEpisode(slug){
  const sec=document.createElement('div');
  sec.className='panel';
  sec.innerHTML='<div class="loading">Extracting stream URLs…</div>';
  out.appendChild(sec);
  sec.scrollIntoView({behavior:'smooth',block:'start'});
  try{
    const r=await fetch(O+'/episode?slug='+encodeURIComponent(slug));
    const d=await r.json();
    let h=\`<h2 style="margin:0 0 4px">\${d.title}</h2><div class="sub">\${slug}</div>\`;
    if(!d.sources||d.sources.length===0){h+='<div class="err">No streams found.</div>'}
    d.sources.forEach((s,i)=>{
      h+=\`<div class="src"><div class="hd"><span>Server \${i+1} · \${new URL(s.embed).host}</span><span>\${s.streams?.length||0} qualities</span></div>\`;
      if(s.error){h+=\`<div class="err">\${s.error}</div>\`}
      if(s.master){h+=\`<div class="qrow"><span class="l">Master HLS</span><span class="u">\${s.master}</span><button class="copy open" onclick="window.open('\${s.master}')">Open</button><button class="copy" onclick="navigator.clipboard.writeText('\${s.master}')">Copy</button></div>\`}
      (s.streams||[]).forEach(q=>{
        h+=\`<div class="qrow"><span class="l">\${q.label} <span style="color:var(--mute);font-weight:400">· \${q.resolution}</span></span><span class="u">\${q.url}</span><button class="copy" onclick="navigator.clipboard.writeText('\${q.url}')">Copy</button></div>\`;
      });
      (s.audio||[]).forEach(a=>{
        h+=\`<div class="qrow"><span class="l">🔊 \${a.name}</span><span class="u">\${a.uri}</span><button class="copy" onclick="navigator.clipboard.writeText('\${a.uri}')">Copy</button></div>\`;
      });
      h+='</div>';
    });
    sec.innerHTML=h;
  }catch(e){sec.innerHTML='<div class="err">'+e.message+'</div>';}
}
</script>
</body></html>`;

// ---------- HLS PROXY (CORS-safe pass-through + m3u8 URL rewriting) ----------
// Used by the native player so hls.js can fetch playlists and segments from a
// same-origin (CORS-allowed) URL. Body is NOT modified other than rewriting
// URL references inside .m3u8 to point back through this proxy.
function rewriteM3U8(text: string, baseUrl: string, proxyPrefix: string): string {
  const base = new URL(baseUrl);
  const toAbs = (u: string) => { try { return new URL(u, base).toString(); } catch { return u; } };
  const wrap = (u: string) => `${proxyPrefix}?url=${encodeURIComponent(toAbs(u))}`;
  return text.split(/\r?\n/).map((line) => {
    if (!line) return line;
    if (line.startsWith("#")) return line.replace(/URI="([^"]+)"/g, (_, u) => `URI="${wrap(u)}"`);
    return wrap(line.trim());
  }).join("\n");
}

async function hlsProxy(req: Request, target: string, proxyPrefix: string): Promise<Response> {
  const range = req.headers.get("range") || undefined;
  // NOTE: AN's CDN returns 500 if Referer/Origin are set on segment requests.
  // The CDN serves all variant playlists + segments fine without any
  // identifying headers, so we send a minimal request.
  const upstream = await fetch(target, {
    headers: {
      "User-Agent": UA,
      ...(range ? { Range: range } : {}),
    },
  });

  const ct = (upstream.headers.get("content-type") || "").toLowerCase();
  const looksM3u8 = /mpegurl|m3u8/.test(ct) || /\.m3u8(\?|$)/i.test(target);

  const baseHeaders: Record<string, string> = { ...cors };
  for (const h of ["content-type", "content-length", "content-range", "accept-ranges", "cache-control", "etag", "last-modified"]) {
    const v = upstream.headers.get(h);
    if (v) baseHeaders[h] = v;
  }

  if (looksM3u8) {
    const text = await upstream.text();
    const rewritten = rewriteM3U8(text, target, proxyPrefix);
    delete baseHeaders["content-length"];
    baseHeaders["content-type"] = "application/vnd.apple.mpegurl; charset=utf-8";
    baseHeaders["cache-control"] = "no-store";
    return new Response(rewritten, { status: upstream.status, headers: baseHeaders });
  }
  return new Response(upstream.body, { status: upstream.status, headers: baseHeaders });
}

// ---------- SUBTITLE PROXY (SRT→VTT conversion, always WebVTT out) ----------
function srtToVtt(srt: string): string {
  // Convert "00:00:01,000" → "00:00:01.000" and prepend WEBVTT header.
  const body = srt
    .replace(/\r+/g, "")
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
  return "WEBVTT\n\n" + body.trim() + "\n";
}

function isVttLike(text: string) {
  return /^WEBVTT\b/i.test(text.trim()) || /\d{2}:\d{2}:\d{2}[,.]\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}[,.]\d{3}/.test(text);
}

function timestampToSeconds(raw: string): number {
  const parts = raw.trim().replace(",", ".").split(":").map(Number);
  if (parts.some((part) => Number.isNaN(part))) return Number.NaN;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return Number.NaN;
}

function secondsToTimestamp(seconds: number): string {
  const safe = Math.max(0, seconds || 0);
  const hh = Math.floor(safe / 3600).toString().padStart(2, "0");
  const mm = Math.floor((safe % 3600) / 60).toString().padStart(2, "0");
  const ss = Math.floor(safe % 60).toString().padStart(2, "0");
  const ms = Math.round((safe - Math.floor(safe)) * 1000).toString().padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

function stripVttHeader(text: string) {
  return text
    .replace(/\r+/g, "")
    .replace(/^WEBVTT[^\n]*(?:\n+NOTE[^\n]*(?:\n(?!\d{2}:)[^\n]*)*)?/i, "")
    .trim();
}

function offsetVttCues(text: string, offset: number): string {
  const body = stripVttHeader(text);
  if (!offset) return body;
  return body.replace(
    /(\d{2}:\d{2}:\d{2}[,.]\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}[,.]\d{3})([^\n]*)/g,
    (_m, start, end, rest) => {
      const s = timestampToSeconds(start);
      const e = timestampToSeconds(end);
      if (!Number.isFinite(s) || !Number.isFinite(e)) return _m;
      return `${secondsToTimestamp(s + offset)} --> ${secondsToTimestamp(e + offset)}${rest || ""}`;
    },
  );
}

async function subtitleToVtt(target: string, depth = 0): Promise<string> {
  if (depth > 4) throw new Error("subtitle nesting too deep");
  const upstream = await fetch(target, { headers: { "User-Agent": UA } });
  if (!upstream.ok) throw new Error(`upstream ${upstream.status}`);
  const text = await upstream.text();
  const trimmed = text.replace(/\r/g, "").trim();

  if (/^#EXTM3U\b/i.test(trimmed)) {
    const lines = trimmed.split("\n").map((line) => line.trim()).filter(Boolean);
    let nextDuration = 0;
    let offset = 0;
    const parts: string[] = [];
    for (const line of lines) {
      if (line.startsWith("#EXTINF:")) {
        nextDuration = Number.parseFloat(line.slice(8).split(",")[0] || "0") || 0;
        continue;
      }
      if (line.startsWith("#")) continue;
      const segmentUrl = resolveUrl(line, target);
      const segmentVtt = await subtitleToVtt(segmentUrl, depth + 1);
      parts.push(offsetVttCues(segmentVtt, offset));
      offset += nextDuration;
      nextDuration = 0;
    }
    return "WEBVTT\n\n" + parts.filter(Boolean).join("\n\n").trim() + "\n";
  }

  if (isVttLike(trimmed)) return /^WEBVTT\b/i.test(trimmed) ? trimmed + "\n" : srtToVtt(trimmed);
  return "WEBVTT\n\n" + trimmed + "\n";
}

async function subsProxy(target: string): Promise<Response> {
  let text: string;
  try {
    text = await subtitleToVtt(target);
  } catch (e) {
    return new Response((e as Error).message || "subtitle upstream failed", { status: 502, headers: cors });
  }
  return new Response(text, {
    status: 200,
    headers: { ...cors, "Content-Type": "text/vtt; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}

// ---------- ROUTER ----------
// Domain allowlist — block third-party scrapers/embeds.
const _ALLOWED_HOST_RX = [
  /\.lovable\.app$/i, /^lovable\.app$/i,
  /\.lovableproject\.com$/i, /^lovableproject\.com$/i,
  /^rsanime03\.lovable\.app$/i,
  /^localhost(?::\d+)?$/i, /^127\.0\.0\.1(?::\d+)?$/i,
];
const _hostAllowed = (s: string | null) => {
  if (!s) return false;
  try { return _ALLOWED_HOST_RX.some((rx) => rx.test(new URL(s).host)); } catch { return false; }
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*?\/an-api/i, "") || "/";
  const proxyPrefix = `https://${url.host}/functions/v1/an-api/hls`;

  // Allowlist guard disabled — origin/referer headers are unreliable for
  // cross-origin media/HLS segment fetches and were blocking real playback.
  // Embed-theft protection is enforced at the UI layer instead.

  try {
    if (path === "/" || path === "") {
      return new Response(HTML_UI, { headers: { ...cors, "Content-Type": "text/html; charset=utf-8" } });
    }
    if (path === "/search") {
      const q = url.searchParams.get("q") || "";
      if (!q.trim()) return json({ error: "missing ?q=" }, 400);
      return json(await search(q.trim()));
    }
    if (path === "/anime") {
      const slug = url.searchParams.get("slug") || "";
      const type = url.searchParams.get("type") || "series";
      if (!slug) return json({ error: "missing ?slug=" }, 400);
      return json(await detail(slug, type));
    }
    if (path === "/episode") {
      const slug = url.searchParams.get("slug") || "";
      const type = url.searchParams.get("type") || "";
      if (!slug) return json({ error: "missing ?slug=" }, 400);
      return json(await episode(slug, type));
    }
    if (path === "/embed") {
      const embedUrl = url.searchParams.get("url") || "";
      if (!embedUrl) return json({ error: "missing ?url=" }, 400);
      return json(await extractFromPlayer(embedUrl));
    }
    if (path === "/hls") {
      const target = url.searchParams.get("url") || "";
      if (!target) return new Response("missing ?url=", { status: 400, headers: cors });
      return await hlsProxy(req, target, proxyPrefix);
    }
    if (path === "/subs") {
      const target = url.searchParams.get("url") || "";
      if (!target) return new Response("missing ?url=", { status: 400, headers: cors });
      return await subsProxy(target);
    }
    return json({ error: "not found", path }, 404);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
