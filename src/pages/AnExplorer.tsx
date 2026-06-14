import { useState, useEffect } from "react";

const API_BASE = `https://kqxpzqegtvaiwgdusrin.supabase.co/functions/v1/an-api`;

type SearchItem = { slug: string; type: string; title: string; poster: string; year: string };
type Episode = { number: number; title: string; slug: string };
type Season = { name: string; episodes: Episode[] };
type Detail = { title: string; poster: string; storyline: string; seasons: Season[]; episodeCount: number };
type Stream = { url: string; filename: string; resolution: string; height: number; bandwidth: number; label: string };
type Audio = { language: string; name: string; uri: string };
type Source = { embed: string; hash?: string; poster?: string; master?: string; streams?: Stream[]; audio?: Audio[]; error?: string };
type EpisodeData = { slug: string; title: string; pageUrl: string; sources: Source[] };

export default function AnExplorer() {
  const [q, setQ] = useState("");
  const [view, setView] = useState<"search" | "anime" | "episode">("search");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [results, setResults] = useState<SearchItem[]>([]);
  const [current, setCurrent] = useState<SearchItem | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [episodes, setEpisodes] = useState<Record<string, EpisodeData>>({});
  const [copied, setCopied] = useState("");

  useEffect(() => { document.title = "AN Stream API — Explorer"; }, []);

  async function doSearch(e?: React.FormEvent) {
    e?.preventDefault();
    if (!q.trim()) return;
    setLoading(true); setErr(""); setView("search"); setDetail(null); setCurrent(null);
    try {
      const r = await fetch(`${API_BASE}/search?q=${encodeURIComponent(q.trim())}`);
      const d = await r.json();
      if (!Array.isArray(d) || d.length === 0) { setErr("No results found."); setResults([]); }
      else setResults(d);
    } catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  }

  async function openAnime(it: SearchItem) {
    setCurrent(it); setView("anime"); setLoading(true); setErr(""); setDetail(null); setEpisodes({});
    try {
      const r = await fetch(`${API_BASE}/anime?slug=${encodeURIComponent(it.slug)}&type=${it.type}`);
      const d = await r.json();
      setDetail(d);
    } catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  }

  async function openEpisode(slug: string) {
    if (episodes[slug]) return; // already loaded
    setEpisodes((p) => ({ ...p, [slug]: { slug, title: "Loading…", pageUrl: "", sources: [] } }));
    try {
      const r = await fetch(`${API_BASE}/episode?slug=${encodeURIComponent(slug)}`);
      const d = await r.json();
      setEpisodes((p) => ({ ...p, [slug]: d }));
    } catch (e: any) {
      setEpisodes((p) => ({ ...p, [slug]: { slug, title: "Error", pageUrl: "", sources: [{ embed: "", error: e.message }] } }));
    }
  }

  const copy = (s: string) => { navigator.clipboard?.writeText(s); setCopied(s); setTimeout(() => setCopied(""), 1200); };

  return (
    <div className="min-h-screen text-[#e7e9ee]" style={{
      background: "radial-gradient(1200px 600px at 10% -10%,#1a1330 0%,transparent 60%),radial-gradient(900px 600px at 110% 10%,#301525 0%,transparent 60%),#0a0b10",
      fontFamily: "-apple-system,BlinkMacSystemFont,Inter,sans-serif",
    }}>
      <div className="max-w-[1100px] mx-auto px-4 pt-7 pb-20">
        <header className="flex items-center gap-3.5 mb-5">
          <div className="w-[42px] h-[42px] rounded-xl grid place-items-center font-extrabold text-white shadow-[0_8px_28px_rgba(124,77,255,0.35)]"
               style={{ background: "linear-gradient(135deg,#ff4d6d,#7c4dff)" }}>AN</div>
          <div>
            <h1 className="text-[20px] m-0 tracking-wide font-semibold">AnimeSalt Stream API</h1>
            <div className="text-[13px] text-[#8b90a0] mt-0.5">Search any anime → fetch every episode → extract all quality streams</div>
          </div>
        </header>

        <form onSubmit={doSearch} className="flex gap-2.5 bg-[#13151d] border border-[#262936] p-2.5 rounded-2xl shadow-[0_12px_40px_rgba(0,0,0,0.35)]">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search anime… (e.g. Naruto)" autoComplete="off"
                 className="flex-1 bg-transparent border-0 outline-none text-[#e7e9ee] px-2 py-3 text-base" />
          <button className="border-0 text-white px-5 rounded-lg font-semibold text-sm cursor-pointer"
                  style={{ background: "linear-gradient(135deg,#ff4d6d,#7c4dff)" }}>Search</button>
        </form>

        {loading && view === "search" && <div className="text-center text-[#8b90a0] py-8 text-sm">Searching…</div>}
        {err && <div className="bg-[rgba(255,77,109,0.12)] text-[#ff97a8] p-3 rounded-xl border border-[rgba(255,77,109,0.3)] text-sm mt-3">{err}</div>}

        {view === "search" && results.length > 0 && (
          <div className="grid gap-3.5 mt-5" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(170px,1fr))" }}>
            {results.map((it) => (
              <div key={it.slug} onClick={() => openAnime(it)}
                   className="bg-[#13151d] border border-[#262936] rounded-2xl overflow-hidden cursor-pointer hover:-translate-y-1 hover:border-[#3a3f55] transition">
                <div className="bg-[#1a1c25] bg-cover bg-center" style={{ aspectRatio: "2/3", backgroundImage: `url(${it.poster || ""})` }} />
                <div className="px-3 py-2.5">
                  <div className="text-[13px] font-semibold leading-tight line-clamp-2">{it.title}</div>
                  <div className="text-[11px] text-[#8b90a0] mt-1 flex justify-between">
                    <span className="bg-[rgba(124,77,255,0.18)] text-[#cdbbff] px-1.5 py-px rounded text-[10px] uppercase tracking-wider">{it.type}</span>
                    <span>{it.year}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {view === "anime" && (
          <>
            <button onClick={() => setView("search")} className="bg-transparent border border-[#262936] text-[#e7e9ee] px-3 py-1.5 rounded-lg cursor-pointer text-xs mt-5">← Back to results</button>
            {loading && <div className="text-center text-[#8b90a0] py-8 text-sm">Loading episodes…</div>}
            {detail && (
              <div className="bg-[#13151d] border border-[#262936] rounded-2xl p-4 mt-3">
                <div className="flex gap-4 items-start">
                  <img src={detail.poster || current?.poster || ""} alt="" className="w-[120px] rounded-xl" />
                  <div>
                    <h2 className="m-0 mb-1.5 text-lg">{detail.title}</h2>
                    <p className="text-[#8b90a0] text-[13px] leading-relaxed m-0">{detail.storyline}</p>
                    <div className="mt-2"><span className="bg-[rgba(124,77,255,0.18)] text-[#cdbbff] px-1.5 py-px rounded text-[10px] uppercase tracking-wider">{detail.episodeCount} episodes</span></div>
                  </div>
                </div>

                {(detail.seasons.length === 0 && current?.type === "movies") ? (
                  <div className="mt-4 grid gap-1.5" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(80px,1fr))" }}>
                    <div onClick={() => openEpisode(current!.slug)} className="p-2 text-center bg-[#1a1d28] border border-[#262936] rounded-lg cursor-pointer text-xs hover:border-[#ff4d6d]">Play Movie</div>
                  </div>
                ) : detail.seasons.map((s) => (
                  <div key={s.name} className="mt-4">
                    <h3 className="m-0 mb-2 text-xs text-[#8b90a0] uppercase tracking-wider">{s.name}</h3>
                    <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(80px,1fr))" }}>
                      {s.episodes.map((e) => (
                        <div key={e.slug} onClick={() => openEpisode(e.slug)} className="p-2 text-center bg-[#1a1d28] border border-[#262936] rounded-lg cursor-pointer text-xs hover:border-[#ff4d6d] hover:bg-[#222533]">EP {e.number}</div>
                      ))}
                    </div>
                  </div>
                ))}

                {Object.values(episodes).map((ep) => (
                  <div key={ep.slug} className="bg-[#13151d] border border-[#262936] rounded-2xl p-4 mt-3">
                    <h2 className="m-0 mb-1 text-base">{ep.title}</h2>
                    <div className="text-[13px] text-[#8b90a0] mb-2">{ep.slug}</div>
                    {(!ep.sources || ep.sources.length === 0) && <div className="bg-[rgba(255,77,109,0.12)] text-[#ff97a8] p-3 rounded-xl border border-[rgba(255,77,109,0.3)] text-sm">No streams found.</div>}
                    {ep.sources?.map((s, i) => (
                      <div key={i} className="bg-[#1a1d28] border border-[#262936] rounded-xl p-3 mt-2.5">
                        <div className="flex justify-between items-center text-xs text-[#8b90a0] mb-2">
                          <span>Server {i + 1} {s.embed && `· ${new URL(s.embed).host}`}</span>
                          <span>{s.streams?.length || 0} qualities</span>
                        </div>
                        {s.error && <div className="bg-[rgba(255,77,109,0.12)] text-[#ff97a8] p-2 rounded-lg text-xs">{s.error}</div>}
                        {s.master && (
                          <Row label="Master HLS" url={s.master} primary onCopy={copy} copied={copied} />
                        )}
                        {s.streams?.map((q) => (
                          <Row key={q.url} label={`${q.label} · ${q.resolution}`} url={q.url} onCopy={copy} copied={copied} />
                        ))}
                        {s.audio?.map((a) => (
                          <Row key={a.uri} label={`🔊 ${a.name}`} url={a.uri} onCopy={copy} copied={copied} />
                        ))}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <div className="bg-[#0f1119] border border-[#262936] px-3.5 py-2.5 rounded-xl mt-5 font-mono text-[11px] text-[#a4b1d0] overflow-auto">
          <b className="text-[#ff4d6d]">API Endpoints:</b><br />
          GET {API_BASE}/search?q=naruto<br />
          GET {API_BASE}/anime?slug=naruto&type=series<br />
          GET {API_BASE}/episode?slug=naruto-1x1
        </div>
      </div>
    </div>
  );
}

function Row({ label, url, primary, onCopy, copied }: { label: string; url: string; primary?: boolean; onCopy: (s: string) => void; copied: string }) {
  return (
    <div className="flex justify-between items-center gap-2.5 p-2 bg-[#0f1119] border border-[#262936] rounded-lg mt-1.5 flex-wrap">
      <span className="font-semibold text-[13px]">{label}</span>
      <span className="font-mono text-[11px] text-[#a4b1d0] flex-1 overflow-hidden text-ellipsis whitespace-nowrap min-w-[200px]">{url}</span>
      {primary && <button onClick={() => window.open(url, "_blank")} className="border-0 text-white px-2.5 py-1 rounded-md font-semibold text-[11px] cursor-pointer" style={{ background: "#ff4d6d" }}>Open</button>}
      <button onClick={() => onCopy(url)} className="border-0 px-2.5 py-1 rounded-md font-semibold text-[11px] cursor-pointer" style={{ background: "#3fd97f", color: "#04230f" }}>
        {copied === url ? "Copied!" : "Copy"}
      </button>
    </div>
  );
}
