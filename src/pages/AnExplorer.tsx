import { useState, useEffect } from "react";
import { getEdgeFunctionUrl } from "@/lib/edgeFunctionRouter";

type SearchItem = { slug: string; type: string; title: string; poster: string; year: string };
type Episode = { number: number; title: string; slug: string };
type Season = { name: string; episodes: Episode[] };
type Detail = { title: string; poster: string; storyline: string; seasons: Season[]; episodeCount: number };
type Stream = { url: string; filename: string; resolution: string; height: number; bandwidth: number; label: string };
type Audio = { language: string; name: string; uri: string };
type Source = { embed: string; hash?: string; poster?: string; master?: string; streams?: Stream[]; audio?: Audio[]; error?: string };
type EpisodeData = { slug: string; title: string; pageUrl: string; sources: Source[] };

const normalizeAnApiBaseUrl = (value: string): string => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.search = "";
    url.hash = "";
    const endpointNames = new Set(["raw", "search", "anime", "episode", "embed", "hls", "subs"]);
    const parts = url.pathname.split("/").filter(Boolean);
    while (parts.length && endpointNames.has(parts[parts.length - 1].toLowerCase())) parts.pop();
    url.pathname = `/${parts.join("/")}`.replace(/\/+$/, "");
    return url.toString().replace(/\/+$/, "");
  } catch {
    return raw.replace(/\/(?:raw|search|anime|episode|embed|hls|subs)(?:\?.*)?$/i, "").replace(/\/+$/, "");
  }
};

export default function AnExplorer() {
  const [apiBase, setApiBase] = useState("");
  const [q, setQ] = useState("");
  const [view, setView] = useState<"search" | "anime">("search");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [results, setResults] = useState<SearchItem[]>([]);
  const [current, setCurrent] = useState<SearchItem | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [episodes, setEpisodes] = useState<Record<string, EpisodeData | { loading: true } | { error: string }>>({});
  const [copied, setCopied] = useState("");

  useEffect(() => {
    document.title = "AN Stream API — Explorer";
    getEdgeFunctionUrl("an-api").then((url) => setApiBase(normalizeAnApiBaseUrl(url || "")));
  }, []);

  async function doSearch(e?: React.FormEvent) {
    e?.preventDefault();
    if (!q.trim()) return;
    if (!apiBase) { setErr("AN API URL is not saved/enabled in EGD Router."); return; }
    setLoading(true); setErr(""); setView("search"); setDetail(null); setCurrent(null);
    try {
      const r = await fetch(`${apiBase}/search?q=${encodeURIComponent(q.trim())}`);
      const d = await r.json();
      if (!Array.isArray(d) || d.length === 0) { setErr("No results found."); setResults([]); }
      else setResults(d);
    } catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  }

  async function openAnime(it: SearchItem) {
    setCurrent(it); setView("anime"); setLoading(true); setErr(""); setDetail(null); setEpisodes({});
    try {
      if (!apiBase) throw new Error("AN API URL is not saved/enabled in EGD Router.");
      const r = await fetch(`${apiBase}/anime?slug=${encodeURIComponent(it.slug)}&type=${it.type}`);
      const d = await r.json();
      setDetail(d);
    } catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  }

  async function openEpisode(slug: string, type?: string) {
    if (episodes[slug] && !("error" in episodes[slug])) return;
    setEpisodes((p) => ({ ...p, [slug]: { loading: true } as any }));
    try {
      if (!apiBase) throw new Error("AN API URL is not saved/enabled in EGD Router.");
      const t = type || current?.type || "";
      const r = await fetch(`${apiBase}/episode?slug=${encodeURIComponent(slug)}${t ? `&type=${t}` : ""}`);
      const d = await r.json();
      setEpisodes((p) => ({ ...p, [slug]: d }));
    } catch (e: any) {
      setEpisodes((p) => ({ ...p, [slug]: { error: e.message } as any }));
    }
  }

  const copy = (s: string) => { navigator.clipboard?.writeText(s); setCopied(s); setTimeout(() => setCopied(""), 1200); };

  return (
    <div className="min-h-screen text-[#e7e9ee] overflow-x-hidden" style={{
      background: "radial-gradient(900px 500px at 10% -10%,#1a1330 0%,transparent 60%),radial-gradient(700px 500px at 110% 10%,#301525 0%,transparent 60%),#0a0b10",
      fontFamily: "-apple-system,BlinkMacSystemFont,Inter,sans-serif",
    }}>
      <div className="max-w-[1100px] mx-auto px-3 sm:px-4 pt-5 pb-24">
        <header className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl grid place-items-center font-extrabold text-white text-sm shrink-0 shadow-[0_8px_28px_rgba(124,77,255,0.35)]"
               style={{ background: "linear-gradient(135deg,#ff4d6d,#7c4dff)" }}>AN</div>
          <div className="min-w-0">
            <h1 className="text-base sm:text-lg m-0 tracking-wide font-semibold truncate">AnimeSalt Stream API</h1>
            <div className="text-[11px] sm:text-xs text-[#8b90a0] mt-0.5">Search → fetch episodes → extract streams</div>
          </div>
        </header>

        <form onSubmit={doSearch} className="flex gap-2 bg-[#13151d] border border-[#262936] p-2 rounded-2xl shadow-[0_12px_40px_rgba(0,0,0,0.35)]">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search anime…"
            autoComplete="off"
            className="flex-1 min-w-0 bg-transparent border-0 outline-none text-[#e7e9ee] px-2 py-2.5 text-sm sm:text-base"
          />
          <button type="submit" className="shrink-0 border-0 text-white px-4 sm:px-5 py-2.5 rounded-lg font-semibold text-sm cursor-pointer"
                  style={{ background: "linear-gradient(135deg,#ff4d6d,#7c4dff)" }}>Search</button>
        </form>

        {loading && view === "search" && <div className="text-center text-[#8b90a0] py-8 text-sm">Searching…</div>}
        {err && <div className="bg-[rgba(255,77,109,0.12)] text-[#ff97a8] p-3 rounded-xl border border-[rgba(255,77,109,0.3)] text-sm mt-3">{err}</div>}

        {view === "search" && results.length > 0 && (
          <div className="grid gap-2.5 sm:gap-3.5 mt-4 grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(170px,1fr))]">
            {results.map((it) => (
              <Card key={it.slug} it={it} onClick={() => openAnime(it)} />
            ))}
          </div>
        )}

        {view === "anime" && (
          <>
            <button onClick={() => setView("search")} className="bg-transparent border border-[#262936] text-[#e7e9ee] px-3 py-1.5 rounded-lg cursor-pointer text-xs mt-4">← Back to results</button>
            {loading && <div className="text-center text-[#8b90a0] py-8 text-sm">Loading…</div>}
            {detail && (
              <div className="bg-[#13151d] border border-[#262936] rounded-2xl p-3 sm:p-4 mt-3">
                <div className="flex gap-3 sm:gap-4 items-start">
                  <Poster src={detail.poster || current?.poster || ""} className="w-[90px] sm:w-[120px] aspect-[2/3] rounded-lg shrink-0" />
                  <div className="min-w-0">
                    <h2 className="m-0 mb-1.5 text-base sm:text-lg leading-tight">{detail.title}</h2>
                    <p className="text-[#8b90a0] text-xs sm:text-[13px] leading-relaxed m-0 line-clamp-4">{detail.storyline}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <span className="bg-[rgba(124,77,255,0.18)] text-[#cdbbff] px-2 py-0.5 rounded text-[10px] uppercase tracking-wider">{current?.type}</span>
                      {detail.episodeCount > 0 && <span className="bg-[rgba(124,77,255,0.18)] text-[#cdbbff] px-2 py-0.5 rounded text-[10px] uppercase tracking-wider">{detail.episodeCount} EP</span>}
                    </div>
                  </div>
                </div>

                {detail.seasons.length === 0 ? (
                  <div className="mt-4">
                    <button
                      onClick={() => openEpisode(current!.slug, current!.type)}
                      className="w-full sm:w-auto px-4 py-2.5 bg-gradient-to-r from-[#ff4d6d] to-[#7c4dff] text-white rounded-lg text-sm font-semibold"
                    >▶ Fetch Movie Streams</button>
                    {episodes[current!.slug] && <EpisodePanel ep={episodes[current!.slug]} copy={copy} copied={copied} />}
                  </div>
                ) : detail.seasons.map((s) => (
                  <div key={s.name} className="mt-4">
                    <h3 className="m-0 mb-2 text-[11px] text-[#8b90a0] uppercase tracking-wider">{s.name}</h3>
                    <div className="grid gap-1.5 grid-cols-[repeat(auto-fill,minmax(60px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(80px,1fr))]">
                      {s.episodes.map((e) => (
                        <button
                          key={e.slug}
                          onClick={() => openEpisode(e.slug)}
                          className={`p-2 text-center border rounded-lg text-xs transition ${episodes[e.slug] ? "bg-[#2a1d33] border-[#ff4d6d]" : "bg-[#1a1d28] border-[#262936] hover:border-[#ff4d6d]"}`}
                        >EP {e.number}</button>
                      ))}
                    </div>
                  </div>
                ))}

                {Object.entries(episodes).filter(([k]) => k !== current?.slug || detail.seasons.length > 0).map(([k, ep]) => (
                  <EpisodePanel key={k} ep={ep} copy={copy} copied={copied} />
                ))}
              </div>
            )}
          </>
        )}

        <div className="bg-[#0f1119] border border-[#262936] px-3 py-2.5 rounded-xl mt-5 font-mono text-[10px] sm:text-[11px] text-[#a4b1d0] overflow-auto break-all">
          <b className="text-[#ff4d6d]">API:</b> {apiBase ? `GET ${apiBase}/search?q=… · /anime?slug=…&type=… · /episode?slug=…&type=…` : "Save and enable AN API URL in EGD Router first."}
        </div>
      </div>
    </div>
  );
}

function Poster({ src, className }: { src: string; className: string }) {
  const [failed, setFailed] = useState(!src);
  if (failed || !src) {
    return (
      <div className={`${className} bg-gradient-to-br from-[#1a1c25] to-[#2a1d33] grid place-items-center text-[#5a5f70] text-[10px] uppercase tracking-wider`}>
        No Image
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      referrerPolicy="no-referrer"
      loading="lazy"
      onError={() => setFailed(true)}
      className={`${className} object-cover bg-[#1a1c25]`}
    />
  );
}

function Card({ it, onClick }: { it: SearchItem; onClick: () => void }) {
  return (
    <div onClick={onClick} className="bg-[#13151d] border border-[#262936] rounded-xl overflow-hidden cursor-pointer hover:-translate-y-1 hover:border-[#3a3f55] transition">
      <Poster src={it.poster} className="w-full aspect-[2/3]" />
      <div className="px-2.5 py-2">
        <div className="text-[12px] sm:text-[13px] font-semibold leading-tight line-clamp-2 min-h-[2.4em]">{it.title}</div>
        <div className="text-[10px] sm:text-[11px] text-[#8b90a0] mt-1 flex justify-between items-center gap-1">
          <span className="bg-[rgba(124,77,255,0.18)] text-[#cdbbff] px-1.5 py-px rounded text-[9px] uppercase tracking-wider">{it.type}</span>
          <span>{it.year}</span>
        </div>
      </div>
    </div>
  );
}

function EpisodePanel({ ep, copy, copied }: { ep: any; copy: (s: string) => void; copied: string }) {
  if (ep?.loading) return <div className="bg-[#0f1119] border border-[#262936] rounded-xl p-4 mt-3 text-center text-[#8b90a0] text-sm">Extracting streams…</div>;
  if (ep?.error) return <div className="bg-[rgba(255,77,109,0.12)] text-[#ff97a8] p-3 rounded-xl border border-[rgba(255,77,109,0.3)] text-sm mt-3">{ep.error}</div>;
  if (!ep?.sources) return null;
  return (
    <div className="bg-[#0f1119] border border-[#262936] rounded-xl p-3 sm:p-4 mt-3">
      <h3 className="m-0 mb-1 text-sm sm:text-base break-words">{ep.title}</h3>
      <div className="text-[11px] text-[#8b90a0] mb-2 break-all">{ep.slug}</div>
      {ep.sources.length === 0 && <div className="bg-[rgba(255,77,109,0.12)] text-[#ff97a8] p-2.5 rounded-lg text-xs">No streams found.</div>}
      {ep.sources.map((s: Source, i: number) => (
        <div key={i} className="bg-[#1a1d28] border border-[#262936] rounded-lg p-2.5 sm:p-3 mt-2">
          <div className="flex justify-between items-center text-[11px] text-[#8b90a0] mb-2 gap-2">
            <span className="truncate">Server {i + 1}{s.embed && ` · ${new URL(s.embed).host}`}</span>
            <span className="shrink-0">{s.streams?.length || 0}q · {s.audio?.length || 0}a</span>
          </div>
          {s.error && <div className="bg-[rgba(255,77,109,0.12)] text-[#ff97a8] p-2 rounded text-[11px]">{s.error}</div>}
          {s.master && (
            <div className="bg-gradient-to-r from-[#2a1d33] to-[#1d2433] border border-[#7c4dff]/40 rounded-lg p-2.5 mt-2">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[10px] bg-[#7c4dff]/30 text-[#cdbbff] px-1.5 py-0.5 rounded uppercase tracking-wider font-bold">★ Master</span>
                <span className="text-[10px] text-[#8b90a0]">Video + All Audio</span>
              </div>
              <div className="font-mono text-[10px] text-[#a4b1d0] break-all mb-2">{s.master}</div>
              <div className="flex gap-1.5">
                <button onClick={() => window.open(s.master!, "_blank")} className="flex-1 border-0 text-white px-2 py-1.5 rounded text-[11px] font-semibold cursor-pointer" style={{ background: "#ff4d6d" }}>Open</button>
                <button onClick={() => copy(s.master!)} className="flex-1 border-0 px-2 py-1.5 rounded text-[11px] font-semibold cursor-pointer" style={{ background: "#3fd97f", color: "#04230f" }}>{copied === s.master ? "Copied!" : "Copy"}</button>
              </div>
            </div>
          )}
          {s.streams && s.streams.length > 0 && (
            <div className="mt-2">
              <div className="text-[10px] text-[#8b90a0] uppercase tracking-wider mb-1">Video qualities</div>
              {s.streams.map((q) => <Row key={q.url} label={`${q.label} · ${q.resolution}`} url={q.url} onCopy={copy} copied={copied} />)}
            </div>
          )}
          {s.audio && s.audio.length > 0 && (
            <div className="mt-2">
              <div className="text-[10px] text-[#8b90a0] uppercase tracking-wider mb-1">Audio tracks</div>
              {s.audio.map((a) => <Row key={a.uri} label={`🔊 ${a.name || a.language}`} url={a.uri} onCopy={copy} copied={copied} />)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Row({ label, url, onCopy, copied }: { label: string; url: string; onCopy: (s: string) => void; copied: string }) {
  return (
    <div className="p-2 bg-[#0f1119] border border-[#262936] rounded-lg mt-1.5">
      <div className="flex justify-between items-center gap-2 mb-1">
        <span className="font-semibold text-[12px] truncate">{label}</span>
        <button onClick={() => onCopy(url)} className="shrink-0 border-0 px-2.5 py-1 rounded text-[10px] font-semibold cursor-pointer" style={{ background: copied === url ? "#7c4dff" : "#3fd97f", color: copied === url ? "#fff" : "#04230f" }}>
          {copied === url ? "Copied!" : "Copy"}
        </button>
      </div>
      <div className="font-mono text-[10px] text-[#a4b1d0] break-all leading-relaxed">{url}</div>
    </div>
  );
}
