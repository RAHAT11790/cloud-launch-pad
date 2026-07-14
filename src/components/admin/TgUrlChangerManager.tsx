import { useEffect, useMemo, useRef, useState, startTransition } from "react";
import { db, ref, onValue, set, query, limitToLast } from "@/lib/firebase";
import { toast } from "sonner";
import { RefreshCw, CheckCircle, XCircle, Send, Trash2 } from "lucide-react";
import CachedImg from "@/components/CachedImg";
import { SUPABASE_ANON_KEY } from "@/lib/siteConfig";
import { getEdgeFunctionUrl } from "@/lib/edgeFunctionRouter";

// ==== Local helpers (mirror Admin.tsx module-scope helpers) ====
const TG_DIVIDER = "━━━━━━━━━━━━━━━━━━";
const TG_DUB_TAGS = {
  official: "#ᴏғғɪᴄɪᴀʟ",
  fandub: "#ғᴀɴᴅᴜʙ",
} as const;
const getTelegramDubTag = (t: "official" | "fandub") => TG_DUB_TAGS[t];

const normalizeTelegramBaseHashtags = (tags: string) => {
  const raw = String(tags || "").replace(/[\r\n]+/g, " ").split(/\s+/).map(t => t.trim()).filter(Boolean);
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const t of raw) {
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (/(official|fandub|ᴏғғɪᴄɪᴀʟ|ғᴀɴᴅᴜʙ|𝐎𝐟𝐟𝐢𝐜𝐢𝐚𝐥|𝐅𝐚𝐧𝐝𝐮𝐛)/i.test(t)) continue;
    kept.push(t);
  }
  return kept.join(" ");
};

function normalizeTelegramTitleKey(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/#/g, " ")
    .replace(/[^a-z0-9\u0980-\u09ff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeTelegramHashtags(tags: string, title: string): string {
  const titleKey = normalizeTelegramTitleKey(title);
  return String(tags || "")
    .split(/\s+/)
    .map(tag => tag.trim())
    .filter(Boolean)
    .filter(tag => !/(official|fandub|ᴏғғɪᴄɪᴀʟ|ғᴀɴᴅᴜʙ|𝐎𝐟𝐟𝐢𝐜𝐢𝐚𝐥|𝐅𝐚𝐧𝐝𝐮𝐛)/i.test(tag))
    .filter(tag => normalizeTelegramTitleKey(tag) !== titleKey)
    .join(" ");
}

function sanitizeTelegramCaption(caption: string, title: string): string {
  return String(caption || "")
    .replace(/#?𝐅𝐚𝐧𝐝𝐮𝐛|#?fandub/gi, TG_DUB_TAGS.fandub)
    .replace(/#?𝐎𝐟𝐟𝐢𝐜𝐢𝐚𝐥|#?official/gi, TG_DUB_TAGS.official)
    .replace(/▰▱{1,}▰/g, TG_DIVIDER)
    .split("\n")
    .map(line => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("#")) return line;
      return sanitizeTelegramHashtags(trimmed, title);
    })
    .filter(line => line.trim().length > 0)
    .join("\n")
    .trim();
}

const formatEpisodeRangeLabel = (seasonValue?: string | number, start?: string | number, end?: string | number) => {
  const seasonText = String(seasonValue ?? "").trim() || "01";
  const startText = String(start ?? "").trim() || "01";
  const endText = String(end ?? "").trim();
  return endText && endText !== startText
    ? `Sᴇᴀsᴏɴ #${seasonText} • Eᴘɪsᴏᴅᴇ #${startText}-${endText} Aᴅᴅᴇᴅ`
    : `Sᴇᴀsᴏɴ #${seasonText} • Eᴘɪsᴏᴅᴇ #${startText} Aᴅᴅᴇᴅ`;
};

// Must mirror the Admin.tsx module-scope helper.
const buildEpisodeShareUrl = (animeId: string, seasonIdx?: number, epIdx?: number) => {
  const base = typeof window !== "undefined" ? window.location.origin : "";
  const q = new URLSearchParams();
  q.set("id", animeId);
  if (typeof seasonIdx === "number") q.set("s", String(seasonIdx));
  if (typeof epIdx === "number") q.set("e", String(epIdx));
  return `${base}/?${q.toString()}`;
};

// Warm cache — instant paint on re-open.
const CACHE_KEY = "rs_admin_tg_url_changer_posts_v1";
let postsCache: any[] = (() => {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "[]"); } catch { return []; }
})();

interface Props {
  glassCard: string;
  inputClass: string;
  selectClass: string;
  btnPrimary: string;
  btnSecondary: string;
  webseriesData: any[];
  moviesData: any[];
  tgFooterLinks: { label: string; url: string; emoji: string }[];
  tgHashtags: string;
  tgGenres: string;
}

const TgUrlChangerManager = ({
  glassCard, inputClass, selectClass, btnPrimary, btnSecondary,
  webseriesData, moviesData, tgFooterLinks, tgHashtags, tgGenres,
}: Props) => {
  const [tgPosts, setTgPosts] = useState<any[]>(postsCache);
  const [tgPostsLoading, setTgPostsLoading] = useState<boolean>(postsCache.length === 0);
  const [tgOldDomain, setTgOldDomain] = useState("");
  const [tgNewDomain, setTgNewDomain] = useState("");
  const [tgBulkRunning, setTgBulkRunning] = useState(false);
  const [tgBulkResults, setTgBulkResults] = useState<{title:string; poster:string; ok:boolean; error?:string}[]>([]);
  const [tgBulkProgress, setTgBulkProgress] = useState(0);
  const [tgQuickPaste, setTgQuickPaste] = useState("");
  const [tgSelectedPost, setTgSelectedPost] = useState<string>("all");
  const [expandedChannel, setExpandedChannel] = useState<string>("");
  const [channelTargets, setChannelTargets] = useState<Record<string, string>>({});
  const [busyChannel, setBusyChannel] = useState<string>("");
  const [busyProgress, setBusyProgress] = useState<{done:number; total:number; skipped?:number}>({done:0,total:0});
  const cancelRef = useRef(false);

  // Keep prop refs so async loops always see latest data without re-renders.
  const dataRef = useRef({ webseriesData, moviesData, tgFooterLinks, tgHashtags, tgGenres });
  dataRef.current = { webseriesData, moviesData, tgFooterLinks, tgHashtags, tgGenres };

  const buildFreshCaptionForTitle = (savedTitle: string): { caption: string; poster: string; matched: boolean; titleKey?: string; sourceId?: string; buttonUrl?: string; title?: string } => {
    const { webseriesData: ws0, moviesData: mv0, tgFooterLinks: fl, tgHashtags: hh, tgGenres: gg } = dataRef.current;
    const norm = normalizeTelegramTitleKey;
    const target = norm(savedTitle);
    const ws = ws0.find((s: any) => norm(s.title) === target);
    const mv = !ws ? mv0.find((m: any) => norm(m.title) === target) : null;
    const item: any = ws || mv;
    if (!item) return { caption: "", poster: "", matched: false };

    const isSeries = !!ws;
    const seasons = Array.isArray(item.seasons) ? item.seasons : [];
    const lastSeasonIdx = isSeries && seasons.length > 0 ? seasons.length - 1 : 0;
    const lastSeason = seasons[lastSeasonIdx];
    const totalEps = isSeries ? (lastSeason?.episodes?.length || 0) : 1;
    const seasonNum = isSeries ? String(lastSeasonIdx + 1).padStart(2, "0") : "01";
    const newEpNum = isSeries && totalEps > 0 ? String(totalEps).padStart(2, "0") : "01";

    const rating = item.rating ? String(item.rating) : "N/A";
    const genres = Array.isArray(item.genres) ? item.genres.join(", ") : String(item.genres || gg || "Animation");
    const languages = String(item.language || "Bengali, English").replace(/\s*\/\s*/g, ", ").replace(/\s*\|\s*/g, ", ");
    const dubType = item.dubType === "fandub" ? "fandub" : "official";
    const audioBadge = getTelegramDubTag(dubType);
    const quality = item.quality || "480p,720p,1080p";
    const status = item.status === "complete" ? "complete" : "ongoing";
    const poster = ((item.backdrop || item.poster || "") as string).replace("/original/", "/w1280/").replace("/w780/", "/w1280/");

    const footerLinksHtml = fl.map(l => `๏ ${l.emoji} <a href="${l.url}">${l.label}</a> ${l.emoji}`).join("\n");

    const caption = `♨️ <b>Tɪᴛᴇʟ;-</b> ${item.title}
┌──────────────────
│ ✦ <b>Sᴇᴀsᴏɴ :</b> ${seasonNum}
│ ✦ <b>Eᴘɪsᴏᴅᴇs :</b> ${totalEps || 'N/A'}
│ ✦ <b>Aᴜᴅɪᴏ :</b> 🎧 ${languages} ${audioBadge}
│ ✦ <b>Qᴜᴀʟɪᴛʏ :</b> ${quality}
│ ✦ <b>Rᴀᴛɪɴɢ :</b> ⭐ ${rating}/10
│ ✦ <b>Gᴇɴʀᴇs :</b> ${genres}
│ ✦ <b>Sᴛᴀᴛᴜs :</b> ${status === "complete" ? "Cᴏᴍᴘʟᴇᴛᴇ ✅" : "Oɴɢᴏɪɴɢ 🟢"}
└──────────────────
${TG_DIVIDER}
📌 ${formatEpisodeRangeLabel(seasonNum, newEpNum)}
${TG_DIVIDER}
${footerLinksHtml}
${TG_DIVIDER}
${normalizeTelegramBaseHashtags(hh)} ${getTelegramDubTag(dubType)}`;

    const buttonUrl = isSeries
      ? buildEpisodeShareUrl(item.id, lastSeasonIdx, Math.max(0, totalEps - 1))
      : buildEpisodeShareUrl(item.id);
    return { caption, poster, matched: true, buttonUrl, titleKey: norm(item.title), sourceId: String(item.id || ""), title: String(item.title || savedTitle || "") } as any;
  };

  const cancelCurrent = () => {
    cancelRef.current = true;
    toast.info("Cancelling…");
  };

  useEffect(() => {
    const unsub = onValue(query(ref(db, "telegramPosts"), limitToLast(300)), (snap) => {
      const val = snap.val() || {};
      const arr = Object.entries(val).map(([k, v]: any) => ({ firebaseKey: k, ...v }));
      arr.sort((a: any, b: any) => (b.sentAt || 0) - (a.sentAt || 0));
      const sliced = arr.slice(0, 300);
      postsCache = sliced;
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(sliced)); } catch {}
      startTransition(() => {
        setTgPosts(sliced);
        setTgPostsLoading(false);
      });
    });
    return () => unsub();
  }, []);

  const channelGroups = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const p of tgPosts) {
      const k = String(p.chatId || "unknown");
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(p);
    }
    return Array.from(map.entries()).map(([chatId, posts]) => ({
      chatId,
      posts: posts.sort((a:any,b:any)=>(a.sentAt||0)-(b.sentAt||0)),
    }));
  }, [tgPosts]);

  const handleQuickPaste = (url: string) => {
    setTgQuickPaste(url);
    try {
      const u = new URL(url);
      setTgOldDomain(u.origin);
    } catch {}
  };

  const callTgApi = async (payload: any) => {
    const endpoint = await getEdgeFunctionUrl('telegram-post');
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(SUPABASE_ANON_KEY ? { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } : {}),
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && !data?.error, data, status: res.status };
  };

  const runBulkReplace = async () => {
    if (!tgOldDomain.trim() || !tgNewDomain.trim()) { toast.error("Old and New Domain required"); return; }
    setTgBulkRunning(true);
    setTgBulkResults([]);
    setTgBulkProgress(0);

    const postsToUpdate = tgSelectedPost === "all" ? tgPosts : tgPosts.filter(p => p.firebaseKey === tgSelectedPost);
    const results: typeof tgBulkResults = [];
    let done = 0;

    for (const post of postsToUpdate) {
      try {
        const oldButtons: { text: string; url: string }[] = post.buttons || [];
        const newButtons = oldButtons.map((btn: any) => ({
          text: btn.text,
          url: btn.url.includes(tgOldDomain.replace(/\/$/, ''))
            ? btn.url.replace(tgOldDomain.replace(/\/$/, ''), tgNewDomain.replace(/\/$/, ''))
            : btn.url,
        }));
        const changed = newButtons.some((nb: any, i: number) => nb.url !== oldButtons[i]?.url);
        if (!changed) { done++; setTgBulkProgress(Math.round((done/postsToUpdate.length)*100)); continue; }
        const r = await callTgApi({ action: "edit-buttons", chatId: post.chatId, messageId: post.messageId, inlineButtons: newButtons });
        if (r.ok) {
          await set(ref(db, `telegramPosts/${post.firebaseKey}/buttons`), newButtons);
          results.push({ title: post.title, poster: post.poster, ok: true });
        } else {
          results.push({ title: post.title, poster: post.poster, ok: false, error: r.data?.error || r.data?.description || `HTTP ${r.status}` });
        }
      } catch (err: any) {
        results.push({ title: post.title, poster: post.poster, ok: false, error: err.message });
      }
      done++;
      setTgBulkProgress(Math.round((done/postsToUpdate.length)*100));
      setTgBulkResults([...results]);
    }
    setTgBulkRunning(false);
    const successCount = results.filter(r => r.ok).length;
    if (successCount > 0) toast.success(`✅ ${successCount}/${results.length} updated`);
    else if (results.length > 0) toast.error("no posts updated");
    else toast.info("no changes needed");
  };

  const sendAllToChannel = async (sourceChannelId: string) => {
    const target = (channelTargets[sourceChannelId] || sourceChannelId).trim();
    if (!target) { toast.error("Enter a target channel ID"); return; }
    const posts = channelGroups.find(g => g.chatId === sourceChannelId)?.posts || [];
    if (posts.length === 0) { toast.info("no posts"); return; }
    const freshCache = new Map<string, any>();
    const getFresh = (p: any) => {
      const cacheKey = String(p.firebaseKey || `${p.chatId || ""}_${p.messageId || ""}_${p.title || ""}`);
      if (!freshCache.has(cacheKey)) freshCache.set(cacheKey, buildFreshCaptionForTitle(p.title) as any);
      return freshCache.get(cacheKey);
    };
    const seenTitles = new Set<string>();
    const skippedTitles: string[] = [];
    const toSend = [...posts]
      .sort((a, b) => (Number(b.sentAt) || 0) - (Number(a.sentAt) || 0))
      .filter((p) => {
        const fresh = getFresh(p);
        const key = fresh.titleKey || normalizeTelegramTitleKey(p.title || "");
        if (!key) return true;
        if (seenTitles.has(key)) { skippedTitles.push(String(p.title || "Untitled")); return false; }
        seenTitles.add(key);
        return true;
      })
      .sort((a, b) => (Number(a.sentAt) || 0) - (Number(b.sentAt) || 0));
    if (toSend.length === 0) { toast.info("All saved posts are duplicate records — nothing to send"); return; }
    const targetKey = String(target).replace(/[^a-zA-Z0-9_-]/g, '_');
    if (!window.confirm(`Send ${toSend.length} unique anime post(s) with LATEST details to ${target}?${skippedTitles.length ? `\n${skippedTitles.length} duplicate saved record(s) will be skipped.` : ""}\n\nTarget channel history will NOT be checked.`)) return;

    cancelRef.current = false;
    setBusyChannel(sourceChannelId); setBusyProgress({done:0,total:toSend.length,skipped:skippedTitles.length});
    let ok = 0, fail = 0; let firstError = "";
    for (let i = 0; i < toSend.length; i++) {
      if (cancelRef.current) break;
      const p = toSend[i];
      const fresh = getFresh(p);
      const caption = fresh.matched
        ? fresh.caption
        : (p.caption && String(p.caption).trim() ? sanitizeTelegramCaption(String(p.caption), String(p.title || "")) : `<b>${String(p.title || "").replace(/[<>&]/g, "")}</b>`);
      const poster = (fresh.matched && fresh.poster) ? fresh.poster : (p.poster || undefined);
      const baseButtons: { text: string; url: string }[] = Array.isArray(p.buttons) ? p.buttons.map((b: any) => ({ ...b })) : [];
      if (fresh.matched && fresh.buttonUrl && baseButtons[0]) baseButtons[0].url = fresh.buttonUrl;
      const payload: any = { chatId: target, caption, photoUrl: poster, inlineButtons: baseButtons.length ? baseButtons : undefined };
      try {
        const r = await callTgApi(payload);
        if (r.ok) {
          ok++;
          const msgId = r.data?.result?.message_id || r.data?.message_id;
          const realChatId = r.data?.result?.chat?.id ?? r.data?.result?.chat?.username ?? target;
          if (msgId) {
            const rec = { chatId: realChatId, messageId: Number(msgId), title: fresh.title || p.title, poster: poster || "", caption, buttons: baseButtons, sentAt: Date.now() };
            try { await set(ref(db, `telegramPosts/${targetKey}_${msgId}`), rec); } catch {}
          }
        } else {
          fail++;
          if (!firstError) firstError = r.data?.error || r.data?.description || `HTTP ${r.status}`;
        }
      } catch (e:any) { fail++; if (!firstError) firstError = e?.message || "network error"; }
      setBusyProgress({done:i+1,total:toSend.length,skipped:skippedTitles.length});
      if (i < toSend.length - 1) await new Promise(r => setTimeout(r, 1200));
    }
    const wasCancelled = cancelRef.current;
    cancelRef.current = false;
    setBusyChannel(""); setBusyProgress({done:0,total:0});
    if (wasCancelled) toast.info(`Cancelled — sent ${ok}, failed ${fail}, skipped ${skippedTitles.length} duplicate`);
    else if (ok > 0) toast.success(`✅ Sent ${ok}/${toSend.length} unique to ${target}${skippedTitles.length?`, skipped ${skippedTitles.length} duplicate`:""}${fail?`, ${fail} failed`:""}`);
    if (!wasCancelled && fail > 0 && firstError) toast.error(`Send error: ${firstError}`);
  };

  const clearChannelRecords = async (sourceChannelId: string) => {
    const posts = channelGroups.find(g => g.chatId === sourceChannelId)?.posts || [];
    if (posts.length === 0) return;
    if (!window.confirm(`Clear ${posts.length} saved record(s) for ${sourceChannelId}?\n(Posts stay on Telegram, only local records are removed)`)) return;
    for (const p of posts) { try { await set(ref(db, `telegramPosts/${p.firebaseKey}`), null); } catch {} }
    toast.success(`Cleared ${posts.length} records`);
  };

  const deletePostRecord = async (key: string) => {
    await set(ref(db, `telegramPosts/${key}`), null);
    toast.success("record deleted");
  };

  const clearAllPostRecords = async () => {
    if (tgPosts.length === 0) { toast.info("no records"); return; }
    if (!window.confirm(`Clear ALL ${tgPosts.length} records?`)) return;
    await set(ref(db, "telegramPosts"), null);
    setTgBulkResults([]);
    setTgSelectedPost("all");
    toast.success("all records cleared");
  };

  return (
    <div>
      <div className={`${glassCard} p-4 mb-4`}>
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
          <RefreshCw size={14} className="text-orange-400" /> Telegram Post Button URL Changer
        </h3>
        <p className="text-[11px] text-zinc-400 mb-4">
          Bulk-update inline button URLs of sent Telegram posts.
        </p>
        <div className="mb-3">
          <label className="block text-xs text-zinc-400 mb-1">⚡ Quick Paste (auto-extract domain)</label>
          <input value={tgQuickPaste} onChange={e => handleQuickPaste(e.target.value)} className={inputClass} placeholder="https://old-domain.com/path/video.mp4" />
        </div>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Old Domain</label>
            <input value={tgOldDomain} onChange={e => setTgOldDomain(e.target.value)} className={inputClass} placeholder="https://old.com" />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">New Domain</label>
            <input value={tgNewDomain} onChange={e => setTgNewDomain(e.target.value)} className={inputClass} placeholder="https://new.com" />
          </div>
        </div>
        <div className="mb-3">
          <label className="block text-xs text-zinc-400 mb-1">Post scope</label>
          <select value={tgSelectedPost} onChange={e => setTgSelectedPost(e.target.value)} className={selectClass}>
            <option value="all">📦 All posts ({tgPosts.length})</option>
            {tgPosts.map(p => (<option key={p.firebaseKey} value={p.firebaseKey}>{p.title} ({p.chatId})</option>))}
          </select>
        </div>
        <button onClick={runBulkReplace} disabled={tgBulkRunning || !tgOldDomain.trim() || !tgNewDomain.trim()}
          className={`${btnPrimary} w-full py-3 text-[13px] font-semibold flex items-center justify-center gap-2 disabled:opacity-50`}>
          {tgBulkRunning ? (<><div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />updating... {tgBulkProgress}%</>) : (<><RefreshCw size={16} /> Update Button URLs</>)}
        </button>
        {tgBulkRunning && (<div className="mt-3 bg-zinc-800 rounded-full h-2 overflow-hidden"><div className="bg-gradient-to-r from-blue-500 to-purple-500 h-full transition-all duration-300" style={{ width: `${tgBulkProgress}%` }} /></div>)}
      </div>

      {tgBulkResults.length > 0 && (
        <div className={`${glassCard} p-4 mb-4`}>
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><CheckCircle size={14} className="text-green-400" /> Update result</h3>
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {tgBulkResults.map((r, i) => (
              <div key={i} className={`flex items-center gap-2.5 p-2 rounded-lg border ${r.ok ? 'border-green-500/20 bg-green-500/5' : 'border-red-500/20 bg-red-500/5'}`}>
                {r.poster && <CachedImg src={r.poster} alt="" className="w-8 h-10 rounded object-cover flex-shrink-0" loading="lazy" decoding="async" />}
                <div className="flex-1 min-w-0">
                  <span className="text-[12px] truncate block">{r.title}</span>
                  {r.error && <span className="text-[10px] text-red-400">{r.error}</span>}
                </div>
                {r.ok ? <CheckCircle size={14} className="text-green-400 flex-shrink-0" /> : <XCircle size={14} className="text-red-400 flex-shrink-0" />}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={`${glassCard} p-4 mb-4`}>
        <div className="flex items-center justify-between gap-3 mb-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Send size={14} className="text-purple-400" /> Channel Manager
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">NEW</span>
          </h3>
          <button onClick={clearAllPostRecords} disabled={tgPostsLoading || tgPosts.length === 0}
            className={`${btnSecondary} !px-3 !py-1.5 text-[11px] text-red-300 border-red-500/30 disabled:opacity-50`}>
            Clear All Records
          </button>
        </div>
        <p className="text-[11px] text-zinc-400 mb-3">
          Posts grouped by saved channel. <b>Send All</b> sends only one latest post per anime from saved Firebase records. It does not check your Telegram channel history. <b>Clear</b> removes saved records only.
        </p>

        {tgPostsLoading ? (
          <div className="flex justify-center py-6"><div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" /></div>
        ) : channelGroups.length === 0 ? (
          <p className="text-zinc-500 text-[11px] text-center py-4">No saved channels yet. Send a Telegram post first.</p>
        ) : (
          <div className="space-y-3">
            {channelGroups.map(({ chatId, posts }) => {
              const isOpen = expandedChannel === chatId;
              const isBusy = busyChannel === chatId;
              const target = channelTargets[chatId] ?? chatId;
              return (
                <div key={chatId} className="rounded-xl border border-zinc-700/40 bg-zinc-900/40 overflow-hidden">
                  <div className="flex items-center justify-between gap-2 p-3">
                    <button onClick={() => setExpandedChannel(isOpen ? "" : chatId)} className="flex-1 min-w-0 text-left">
                      <div className="text-[13px] font-semibold truncate">{chatId}</div>
                      <div className="text-[10px] text-zinc-400">{posts.length} post{posts.length===1?"":"s"} saved</div>
                    </button>
                    {isBusy && (
                      <div className="text-[10px] text-amber-300 whitespace-nowrap">
                        Sending {busyProgress.done}/{busyProgress.total}{busyProgress.skipped ? ` • skip ${busyProgress.skipped}` : ""}
                      </div>
                    )}
                  </div>
                  {isOpen && (
                    <div className="px-3 pb-3 space-y-2">
                      <div>
                        <label className="block text-[10px] text-zinc-400 mb-1">Target channel for Send All (default: same channel)</label>
                        <input value={target} onChange={e => setChannelTargets(prev => ({ ...prev, [chatId]: e.target.value }))}
                          className={inputClass} placeholder="@channel or -100..." />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <button disabled={!!busyChannel} onClick={() => sendAllToChannel(chatId)}
                          className="w-full py-2.5 px-2 rounded-lg bg-gradient-to-br from-indigo-500/90 to-purple-600/90 hover:from-indigo-500 hover:to-purple-600 text-white text-[11px] font-semibold flex flex-col items-center justify-center gap-1 shadow-md shadow-purple-900/30 border border-purple-400/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
                          <Send size={14} />
                          <span className="leading-none">Send All</span>
                        </button>
                        <button disabled={!!busyChannel} onClick={() => clearChannelRecords(chatId)}
                          className="w-full py-2.5 px-2 rounded-lg bg-zinc-700/70 hover:bg-zinc-700 text-zinc-100 text-[11px] font-semibold flex flex-col items-center justify-center gap-1 border border-zinc-600/40 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
                          <XCircle size={14} />
                          <span className="leading-none">Clear</span>
                        </button>
                      </div>
                      {isBusy && (
                        <div className="space-y-2 pt-1">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-[10px] text-amber-300 font-medium">
                              📤 Sending {busyProgress.done}/{busyProgress.total}{busyProgress.skipped ? ` • skipped ${busyProgress.skipped}` : ""}
                            </div>
                            <button onClick={cancelCurrent}
                              className="px-3 py-1 rounded-md bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 text-red-300 text-[10px] font-semibold flex items-center gap-1 transition-all">
                              <XCircle size={12} /> Cancel
                            </button>
                          </div>
                          <div className="bg-zinc-800 rounded-full h-1.5 overflow-hidden">
                            <div className="bg-gradient-to-r from-amber-500 to-pink-500 h-full transition-all" style={{ width: `${busyProgress.total ? (busyProgress.done/busyProgress.total)*100 : 0}%` }} />
                          </div>
                        </div>
                      )}
                      <div className="space-y-1.5 max-h-[260px] overflow-y-auto pt-1">
                        {posts.map(post => (
                          <div key={post.firebaseKey} className="flex items-center gap-2 p-1.5 bg-zinc-800/40 rounded-lg border border-zinc-700/20">
                            {post.poster && <CachedImg src={post.poster} alt="" className="w-8 h-10 rounded object-cover flex-shrink-0" loading="lazy" decoding="async" />}
                            <div className="flex-1 min-w-0">
                              <span className="text-[11px] font-medium truncate block">{post.title}</span>
                              <span className="text-[9px] text-zinc-500 block">MSG: {post.messageId}</span>
                            </div>
                            <button onClick={() => deletePostRecord(post.firebaseKey)} className="text-red-400 hover:text-red-300 p-1" title="Remove record only">
                              <Trash2 size={11} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default TgUrlChangerManager;
