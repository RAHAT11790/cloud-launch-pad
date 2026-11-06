import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowBendUpLeft, ArrowLeft, CaretDown, ChatsCircle, Copy, ImageSquare, Microphone, PaperPlaneRight,
  Pause, Play, Plus, SignIn, Smiley, Sticker, Trash, X, PencilSimple, Prohibit, Warning, ShieldStar, Timer, CrownSimple, TextAa,
} from "@phosphor-icons/react";
import {
  BUILT_IN_STICKERS, MAX_IMAGE_BYTES, MAX_VOICE_SECONDS, addMySticker, currentChatProfile, deleteMessage, editOwnMessage,
  subscribeChatSettings, subscribeBan, subscribeWarnings, markWarningsSeen, clearMentions, banMember, unbanMember, warnMember, lastSentAt, ChatBlockedError,
  formatDuration, loadVoice, messagePreview, nameColorSlot, removeMySticker, sendChatMessage, subscribeChat,
  subscribeMyStickers, uploadVoice, type ChatMessage, type ChatProfile, type ChatReply,
} from "@/lib/communityChat";
import { uploadToImgbb } from "@/lib/imgbbUpload";
import { banActive, banRemainingMs, formatCountdown, parseChatCommand, slowModeWaitMs, DEFAULT_CHAT_SETTINGS, type ChatBan, type ChatSettings, type ChatWarning } from "@/lib/chatModeration";
import { useBranding } from "@/hooks/useBranding";
import { toast } from "sonner";

type Props = { onBack: () => void; onLogin: () => void };

const dayLabel = (t: number) => {
  const d = new Date(t); const now = new Date();
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { day: "numeric", month: "long", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
};
const timeLabel = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const nameColor = (uid: string) => ({ color: `hsl(var(--chat-n${nameColorSlot(uid)}))` });

export default function CommunityChat({ onBack, onLogin }: Props) {
  const branding = useBranding();
  const [me, setMe] = useState<ChatProfile | null>(currentChatProfile);
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [text, setText] = useState("");
  const [reply, setReply] = useState<ChatReply | null>(null);
  const [image, setImage] = useState<{ url: string; local: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [panel, setPanel] = useState<null | "stickers">(null);
  const [menu, setMenu] = useState<ChatMessage | null>(null);
  const [profile, setProfile] = useState<ChatProfile | null>(null);
  const [viewer, setViewer] = useState("");
  const [atBottom, setAtBottom] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const firstLoad = useRef(true);
  const [settings, setSettings] = useState<ChatSettings>(DEFAULT_CHAT_SETTINGS);
  const [ban, setBan] = useState<ChatBan | null>(null);
  const [warnings, setWarnings] = useState<ChatWarning[]>([]);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [lastSent, setLastSent] = useState(lastSentAt);
  const [tick, setTick] = useState(Date.now());
  useEffect(() => subscribeChatSettings(setSettings), []);
  useEffect(() => { if (!me) { setBan(null); setWarnings([]); return; } const a = subscribeBan(me.id, setBan); const b = subscribeWarnings(me.id, setWarnings); void clearMentions(me.id).catch(() => {}); return () => { a(); b(); }; }, [me?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const banned = !me?.ceo && banActive(ban, tick);
  const slowWait = me?.ceo ? 0 : slowModeWaitMs(lastSent, settings.slowModeSeconds, tick);
  useEffect(() => { if (!banned && !slowWait) return; const t = window.setInterval(() => setTick(Date.now()), 500); return () => window.clearInterval(t); }, [banned, slowWait > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  const unseenWarnings = warnings.filter(w => !w.seen);

  useEffect(() => {
    const refresh = () => setMe(currentChatProfile());
    window.addEventListener("rs_auth_changed", refresh);
    window.addEventListener("storage", refresh);
    return () => { window.removeEventListener("rs_auth_changed", refresh); window.removeEventListener("storage", refresh); };
  }, []);
  useEffect(() => subscribeChat(rows => { setMessages(rows); setLoadError(false); }, () => setLoadError(true)), []);

  const scrollToEnd = useCallback((smooth = false) => {
    const el = listRef.current; if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);
  useEffect(() => {
    if (!messages) return;
    const last = messages[messages.length - 1];
    if (firstLoad.current) { firstLoad.current = false; requestAnimationFrame(() => scrollToEnd()); return; }
    if (atBottom || (last && last.uid === me?.id)) requestAnimationFrame(() => scrollToEnd(true));
  }, [messages]); // eslint-disable-line react-hooks/exhaustive-deps

  const members = useMemo(() => new Set((messages || []).map(m => m.uid)).size, [messages]);
  const byId = useMemo(() => new Map((messages || []).map(m => [m.id, m])), [messages]);

  const startReply = useCallback((m: ChatMessage) => {
    setReply({ id: m.id, name: m.name, preview: messagePreview(m), uid: m.uid }); setEditing(null);
    setMenu(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);
  const jumpTo = useCallback((id: string) => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-mid="${id}"]`);
    if (!el) { toast("Original message is no longer loaded"); return; }
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.remove("cc-flash"); void el.offsetWidth; el.classList.add("cc-flash");
  }, []);

  const resetInput = () => { setText(""); setImage(null); setReply(null); setEditing(null); if (inputRef.current) inputRef.current.style.height = ""; };
  const showError = (e: unknown, fallback: string) => toast.error(e instanceof ChatBlockedError || (e instanceof Error && e.message.length < 90) ? (e as Error).message : fallback);
  const runCommand = async (body: string) => {
    const cmd = parseChatCommand(body, reply?.uid);
    if (!cmd) return false;
    if (!me?.ceo) { toast.error("Only the CEO admin can use chat commands"); return true; }
    if (cmd.cmd === "invalid") { toast.error(cmd.error); return true; }
    if (cmd.target === me.id) { toast.error("You cannot use this on yourself"); return true; }
    const name = (messages || []).find(m => m.uid === cmd.target)?.name || reply?.name || cmd.target;
    if (cmd.cmd === "ban") {
      await banMember(cmd.target, cmd.duration, cmd.reason, me.name, name);
      toast.success(cmd.duration === "permanent" ? `${name} is permanently banned — all their messages were deleted` : `${name} is muted for ${formatCountdown(cmd.duration)}`);
    } else if (cmd.cmd === "unban") { await unbanMember(cmd.target); toast.success(`${name} is unbanned`); }
    else { await warnMember(cmd.target, cmd.text, me.name); toast.success(`Warning sent to ${name}`); }
    resetInput();
    return true;
  };
  const send = async () => {
    if (sending || uploading) return;
    const body = text.trim();
    if (!image && !body) return;
    setSending(true);
    try {
      if (editing) { await editOwnMessage(editing, body); resetInput(); return; }
      if (!image && await runCommand(body)) return;
      await sendChatMessage(image ? { kind: "image", image: image.url, text: body } : { kind: "text", text: body }, reply);
      setLastSent(Date.now()); setTick(Date.now());
      resetInput();
    } catch (e) { showError(e, "Message not sent. Try again."); }
    finally { setSending(false); }
  };
  const startEdit = (m: ChatMessage) => { setMenu(null); setReply(null); setImage(null); setEditing(m); setText(m.text || ""); requestAnimationFrame(() => { const el = inputRef.current; if (el) { el.focus(); el.style.height = "auto"; el.style.height = `${Math.min(120, el.scrollHeight)}px`; } }); };
  const sendSticker = async (sticker: string) => {
    setPanel(null);
    try { await sendChatMessage({ kind: "sticker", sticker }, reply); setReply(null); setLastSent(Date.now()); setTick(Date.now()); }
    catch (e) { showError(e, "Sticker not sent. Try again."); }
  };
  const sendVoice = async (blob: Blob, dur: number) => {
    setSending(true);
    try { const voice = await uploadVoice(blob); await sendChatMessage({ kind: "voice", voice, dur }, reply); setReply(null); setLastSent(Date.now()); setTick(Date.now()); }
    catch (e) { showError(e, "Voice message not sent."); }
    finally { setSending(false); }
  };
  const pickImage = async (file?: File) => {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp|gif)$/i.test(file.type)) { toast.error("Only photos can be sent"); return; }
    if (file.size > MAX_IMAGE_BYTES) { toast.error("Photo must be under 10 MB"); return; }
    const local = URL.createObjectURL(file);
    setImage({ url: "", local }); setUploading(true);
    try { const url = await uploadToImgbb(file); setImage({ url, local }); }
    catch { setImage(null); toast.error("Photo upload failed"); }
    finally { setUploading(false); }
  };

  let lastDay = "";
  return (
    <section className="community-chat" aria-label="Global chat">
      <header className="cc-top relative z-10 flex items-center gap-2 px-2 h-auto">
        <div className="flex items-center gap-2 h-[58px] w-full">
          <button type="button" onClick={onBack} aria-label="Back" className="cc-3d h-10 w-10 shrink-0 rounded-full grid place-items-center text-foreground">
            <ArrowLeft size={20} weight="bold" />
          </button>
          <span className="h-10 w-10 shrink-0 rounded-full overflow-hidden grid place-items-center cc-3d-primary">
            {branding.logoUrl ? <img src={branding.logoUrl} alt="" className="h-full w-full object-cover" /> : <ChatsCircle size={22} weight="fill" />}
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <h1 className="text-[15px] font-extrabold truncate flex items-center gap-1.5">RS ANIME03 {me?.ceo && <span className="cc-ceo-badge"><CrownSimple size={11} weight="fill" />CEO</span>}</h1>
            <p className="text-[11.5px] cc-meta truncate">Global Chat{members ? ` · ${members} member${members === 1 ? "" : "s"}` : ""}</p>
          </div>
        </div>
      </header>

      <div ref={listRef} onScroll={e => { const el = e.currentTarget; setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 120); }}
        className="cc-wall relative flex-1 min-h-0 overflow-y-auto overscroll-contain px-2.5 py-3" onClick={() => setPanel(null)}>
        {loadError && <p role="alert" className="mx-auto my-3 w-fit rounded-full px-3 py-1.5 text-xs cc-pill">Could not load messages. Check your connection.</p>}
        {messages === null && !loadError && <div className="py-16 grid place-items-center"><span className="h-7 w-7 rounded-full border-2 border-primary border-t-transparent animate-spin" aria-label="Loading messages" /></div>}
        {messages?.length === 0 && (
          <div className="mx-auto mt-20 max-w-[260px] rounded-2xl px-5 py-6 text-center cc-pill">
            <ChatsCircle size={44} weight="duotone" className="mx-auto mb-2" />
            <p className="text-sm font-bold">No messages yet</p>
            <p className="text-xs mt-1 opacity-90">Say hi to the RS ANIME03 community 👋</p>
          </div>
        )}
        {messages?.map((m, i) => {
          const prev = messages[i - 1]; const next = messages[i + 1];
          const day = dayLabel(m.t);
          const showDay = day !== lastDay; lastDay = day;
          const groupStart = showDay || !prev || prev.uid !== m.uid || m.t - prev.t > 5 * 60_000;
          const groupEnd = !next || next.uid !== m.uid || next.t - m.t > 5 * 60_000 || dayLabel(next.t) !== day;
          return (
            <div key={m.id}>
              {showDay && <div className="sticky top-1 z-[1] my-2 flex justify-center"><span className="rounded-full px-3 py-1 text-[11.5px] font-semibold cc-pill">{day}</span></div>}
              <MessageRow m={m} own={m.uid === me?.id} groupStart={groupStart} groupEnd={groupEnd} quoted={m.reply ? byId.get(m.reply.id) : undefined}
                onMenu={setMenu} onReply={startReply} onProfile={setProfile} onJump={jumpTo} onImage={setViewer} />
            </div>
          );
        })}
      </div>

      {!atBottom && (
        <button type="button" aria-label="Scroll to latest" onClick={() => scrollToEnd(true)}
          className="cc-3d absolute right-3 z-10 h-11 w-11 rounded-full grid place-items-center text-foreground" style={{ bottom: "calc(84px + env(safe-area-inset-bottom))" }}>
          <CaretDown size={20} weight="bold" />
        </button>
      )}

      <footer className="cc-bottom relative z-10 px-2 pt-2">
        {!me ? (
          <button type="button" onClick={onLogin} className="cc-3d-primary w-full h-12 rounded-2xl font-extrabold text-[15px] flex items-center justify-center gap-2">
            <SignIn size={20} weight="bold" /> Sign in to chat
          </button>
        ) : banned ? (
          <div role="status" className="cc-banbar flex items-center gap-3 rounded-2xl px-4 py-3">
            <Prohibit size={26} weight="duotone" className="shrink-0" />
            <div className="min-w-0 flex-1 leading-tight">
              <p className="text-[14px] font-extrabold">{ban!.until === 0 ? "You are banned from Global Chat" : "You are muted"}</p>
              <p className="text-[12px] opacity-85 truncate">{ban!.reason || "Breaking chat rules"}</p>
            </div>
            {ban!.until !== 0 && <span className="font-mono text-[15px] font-black tabular-nums flex items-center gap-1"><Timer size={16} weight="bold" />{formatCountdown(banRemainingMs(ban, tick))}</span>}
          </div>
        ) : (
          <Composer editing={!!editing} slowWait={editing ? 0 : slowWait} isCeo={!!me.ceo}
            text={text} setText={setText} inputRef={inputRef} reply={reply} clearReply={() => setReply(null)}
            image={image} clearImage={() => setImage(null)} cancelEdit={resetInput} uploading={uploading} sending={sending}
            onSend={send} onAttach={() => fileRef.current?.click()} panelOpen={panel === "stickers"}
            togglePanel={() => { setPanel(p => (p ? null : "stickers")); inputRef.current?.blur(); }} onVoice={sendVoice}
          />
        )}
        {me && !banned && panel === "stickers" && <StickerPanel uid={me.id} onPick={sendSticker} />}
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; void pickImage(f); }} />
      </footer>

      {menu && (
        <div className="fixed inset-0 z-[70] flex items-end bg-foreground/30" onClick={() => setMenu(null)}>
          <div className="cc-sheet w-full rounded-t-3xl bg-card p-3 pb-[max(14px,env(safe-area-inset-bottom))]" onClick={e => e.stopPropagation()} role="menu" aria-label="Message actions">
            <p className="px-3 pb-2 text-xs cc-meta truncate">{menu.name}: {messagePreview(menu)}</p>
            <SheetButton icon={<ArrowBendUpLeft size={20} weight="bold" />} label="Reply" onClick={() => startReply(menu)} />
            {menu.text && <SheetButton icon={<Copy size={20} weight="bold" />} label="Copy text" onClick={() => { void navigator.clipboard.writeText(menu.text || "").then(() => toast.success("Copied")).catch(() => toast.error("Could not copy")); setMenu(null); }} />}
            <SheetButton icon={<ChatsCircle size={20} weight="bold" />} label="View profile" onClick={() => { setProfile({ id: menu.uid, name: menu.name, photo: menu.photo }); setMenu(null); }} />
            {menu.uid === me?.id && (menu.kind === "text" || menu.kind === "image") && <SheetButton icon={<PencilSimple size={20} weight="bold" />} label="Edit" onClick={() => startEdit(menu)} />}
            {(menu.uid === me?.id || me?.ceo) && <SheetButton danger icon={<Trash size={20} weight="bold" />} label={menu.uid === me?.id ? "Delete" : "Delete for everyone"} onClick={() => { const target = menu; setMenu(null); void deleteMessage(target).then(() => toast.success("Message deleted")).catch(() => toast.error("Could not delete")); }} />}
            {me?.ceo && menu.uid !== me.id && <>
              <p className="px-3 pt-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-primary flex items-center gap-1"><ShieldStar size={14} weight="fill" />CEO tools</p>
              <SheetButton icon={<Warning size={20} weight="bold" />} label="Warn (type /warning …)" onClick={() => { const m = menu; startReply(m); setText("/warning "); }} />
              <SheetButton icon={<Timer size={20} weight="bold" />} label="Mute 30 minutes" onClick={() => { const m = menu; setMenu(null); void banMember(m.uid, 30 * 60_000, "Muted by CEO", me.name, m.name).then(() => toast.success(`${m.name} muted for 30 minutes`)).catch(() => toast.error("Could not mute")); }} />
              <SheetButton danger icon={<Prohibit size={20} weight="bold" />} label="Ban permanently + delete all" onClick={() => { const m = menu; setMenu(null); if (!window.confirm(`Permanently ban ${m.name} and delete every message they sent?`)) return; void banMember(m.uid, "permanent", "Banned by CEO", me.name, m.name).then(() => toast.success(`${m.name} banned — all messages deleted`)).catch(() => toast.error("Could not ban")); }} />
            </>}
          </div>
        </div>
      )}

      {profile && (
        <div className="fixed inset-0 z-[70] flex items-end bg-foreground/30" onClick={() => setProfile(null)}>
          <div className="cc-sheet w-full rounded-t-3xl bg-card px-5 pt-3 pb-[max(20px,env(safe-area-inset-bottom))] flex flex-col items-center gap-3" onClick={e => e.stopPropagation()} role="dialog" aria-label="Member profile">
            <span className="h-1 w-10 rounded-full bg-muted" />
            <Avatar profile={profile} size={88} />
            <h2 className="text-lg font-extrabold break-words text-center max-w-full" style={nameColor(profile.id)}>{profile.name}</h2>
            <button type="button" className="cc-3d w-full rounded-2xl px-4 py-3 flex items-center gap-3 text-left"
              onClick={() => { void navigator.clipboard.writeText(profile.id).then(() => toast.success("ID copied")).catch(() => toast.error("Could not copy ID")); }}>
              <span className="min-w-0 flex-1"><span className="block text-[11px] cc-meta">User ID</span><span className="block text-sm font-mono font-semibold break-all">{profile.id}</span></span>
              <Copy size={20} weight="bold" className="text-primary shrink-0" />
            </button>
          </div>
        </div>
      )}

      {me && unseenWarnings.length > 0 && (
        <div className="fixed inset-0 z-[85] grid place-items-center bg-foreground/50 px-5" role="alertdialog" aria-label="Warning from admin">
          <div className="cc-warn w-full max-w-sm rounded-3xl p-5 text-center">
            <span className="cc-warn-ico mx-auto mb-3 grid h-16 w-16 place-items-center rounded-full"><Warning size={34} weight="fill" /></span>
            <h2 className="text-lg font-black">Warning from RS ANIME03</h2>
            <div className="mt-3 space-y-2 text-left">
              {unseenWarnings.map(w => <p key={w.id} className="rounded-xl bg-secondary px-3 py-2 text-[14px] font-semibold break-words">{w.text}<span className="block text-[11px] cc-meta mt-0.5">{w.by} · {timeLabel(w.t)}</span></p>)}
            </div>
            <p className="mt-3 text-[12.5px] cc-meta">If this happens again you may be banned from Global Chat.</p>
            <button type="button" className="cc-3d-primary mt-4 h-12 w-full rounded-2xl font-extrabold" onClick={() => void markWarningsSeen(me.id, unseenWarnings.map(w => w.id))}>I understand</button>
          </div>
        </div>
      )}

      {viewer && (
        <div className="fixed inset-0 z-[80] bg-foreground/90 grid place-items-center" onClick={() => setViewer("")} role="dialog" aria-label="Photo">
          <img src={viewer} alt="Shared photo" className="max-h-[90dvh] max-w-full object-contain" />
          <button type="button" aria-label="Close photo" className="cc-3d absolute top-[max(14px,env(safe-area-inset-top))] right-3 h-10 w-10 rounded-full grid place-items-center text-foreground"><X size={20} weight="bold" /></button>
        </div>
      )}
    </section>
  );
}

function SheetButton({ icon, label, onClick, danger = false }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className={`w-full flex items-center gap-3 rounded-xl px-3 py-3.5 text-[15px] font-semibold active:bg-secondary ${danger ? "text-destructive" : "text-foreground"}`}>
      {icon}{label}
    </button>
  );
}

function Avatar({ profile, size = 34 }: { profile: Pick<ChatProfile, "id" | "name" | "photo">; size?: number }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className="shrink-0 rounded-full overflow-hidden grid place-items-center font-extrabold cc-3d" style={{ width: size, height: size, fontSize: size * 0.42, ...nameColor(profile.id) }}>
      {profile.photo && !broken
        ? <img src={profile.photo} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" loading="lazy" onError={() => setBroken(true)} />
        : (profile.name || "?").slice(0, 1).toUpperCase()}
    </span>
  );
}

type RowProps = {
  m: ChatMessage; own: boolean; groupStart: boolean; groupEnd: boolean; quoted?: ChatMessage;
  onMenu: (m: ChatMessage) => void; onReply: (m: ChatMessage) => void; onProfile: (p: ChatProfile) => void; onJump: (id: string) => void; onImage: (url: string) => void;
};
const MessageRow = memo(function MessageRow({ m, own, groupStart, groupEnd, quoted, onMenu, onReply, onProfile, onJump, onImage }: RowProps) {
  const [dx, setDx] = useState(0);
  const touch = useRef<{ x: number; y: number; locked: boolean | null } | null>(null);
  const sticker = m.kind === "sticker";
  const profile = { id: m.uid, name: m.name, photo: m.photo };
  const time = <span className={`text-[10.5px] whitespace-nowrap ${sticker ? "cc-pill rounded-full px-1.5 py-0.5" : "cc-meta"}`}>{m.edited ? <i className="cc-edited">Edited · </i> : null}{timeLabel(m.t)}</span>;
  const quote = m.reply && (
    <button type="button" onClick={e => { e.stopPropagation(); onJump(m.reply!.id); }} className="cc-quote mb-1 block w-full rounded-md px-2 py-1 text-left" style={nameColor(quoted?.uid || m.reply.name)}>
      <span className="block text-[12px] font-bold truncate">{m.reply.name}</span>
      <span className="block text-[12.5px] truncate opacity-80" style={{ color: "inherit" }}><span className="cc-meta">{m.reply.preview}</span></span>
    </button>
  );
  return (
    <div data-mid={m.id}
      className={`flex items-end gap-1.5 rounded-2xl ${own ? "justify-end" : "justify-start"} ${groupEnd ? "mb-2" : "mb-0.5"}`}
      style={{ transform: dx ? `translateX(${dx}px)` : undefined, transition: dx ? "none" : "transform .2s ease" }}
      onTouchStart={e => { const t = e.touches[0]; touch.current = { x: t.clientX, y: t.clientY, locked: null }; }}
      onTouchMove={e => {
        const s = touch.current; if (!s) return; const t = e.touches[0];
        const mx = t.clientX - s.x; const my = t.clientY - s.y;
        if (s.locked === null && (Math.abs(mx) > 8 || Math.abs(my) > 8)) s.locked = Math.abs(mx) > Math.abs(my) && mx < 0;
        if (s.locked) setDx(Math.max(-72, Math.min(0, mx)));
      }}
      onTouchEnd={() => { if (dx <= -56) onReply(m); setDx(0); touch.current = null; }}>
      {!own && (groupEnd
        ? <button type="button" aria-label={`View ${m.name} profile`} onClick={() => onProfile(profile)}><Avatar profile={profile} /></button>
        : <span className="w-[34px] shrink-0" />)}
      <div onClick={e => { e.stopPropagation(); onMenu(m); }} role="button" tabIndex={0} aria-label={`Message from ${m.name}`}
        className={`cc-bubble relative max-w-[78%] min-w-0 cursor-pointer select-text ${sticker ? "" : `px-2.5 pt-1.5 pb-1 ${own ? "cc-out" : "cc-in"} ${groupStart ? "cc-first" : ""} ${groupEnd ? (own ? "cc-tail-out" : "cc-tail-in") : "cc-mid"}`}`}>
        {!own && groupStart && !sticker && (
          <button type="button" onClick={e => { e.stopPropagation(); onProfile(profile); }} className="flex items-center gap-1 text-[13px] font-bold truncate max-w-full text-left" style={nameColor(m.uid)}><span className="truncate">{m.name}</span>{m.ceo && <span className="cc-ceo-badge"><CrownSimple size={10} weight="fill" />CEO</span>}</button>
        )}
        {sticker && !own && groupStart && <span className="block text-[12px] font-bold mb-0.5 cc-pill rounded-full px-2 w-fit">{m.name}</span>}
        {quote}
        {m.kind === "image" && m.image && (
          <button type="button" onClick={e => { e.stopPropagation(); onImage(m.image!); }} className="block -mx-1 mt-0.5 overflow-hidden rounded-xl">
            <img src={m.image} alt="Shared photo" loading="lazy" className="max-h-72 w-full min-w-[160px] object-cover" />
          </button>
        )}
        {m.kind === "voice" && m.voice && <VoiceNote id={m.voice} dur={m.dur || 0} own={own} />}
        {sticker && m.sticker && (m.sticker.startsWith("https://")
          ? <img src={m.sticker} alt="Sticker" className="cc-sticker-pop h-32 w-32 object-contain drop-shadow-md" loading="lazy" />
          : <span className="cc-sticker-pop block text-[84px] leading-none drop-shadow-md" role="img" aria-label="Sticker">{m.sticker}</span>)}
        {m.text ? (
          <p className="text-[15px] leading-snug whitespace-pre-wrap break-words pr-1 mt-0.5">
            {m.text}<span className={`inline-block ${m.edited ? "w-[88px]" : "w-12"}`} aria-hidden="true" />
          </p>
        ) : null}
        <span className={`${m.text ? "absolute right-2.5 bottom-1" : "flex justify-end mt-0.5"}`}>{time}</span>
      </div>
      {dx < -10 && <ArrowBendUpLeft size={22} weight="bold" className="text-primary shrink-0" style={{ opacity: Math.min(1, -dx / 56) }} />}
    </div>
  );
});

const bars = (seed: string) => Array.from({ length: 28 }, (_, i) => {
  let h = 0; for (let k = 0; k < seed.length; k++) h = (h * 33 + seed.charCodeAt(k) + i * 7) >>> 0;
  return 25 + (h % 75);
});
let playingVoice: HTMLAudioElement | null = null;
function VoiceNote({ id, dur, own }: { id: string; dur: number; own: boolean }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "playing" | "paused">("idle");
  const [progress, setProgress] = useState(0);
  const heights = useMemo(() => bars(id), [id]);
  useEffect(() => () => { audio.current?.pause(); }, []);
  const toggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (state === "playing") { audio.current?.pause(); return; }
    if (!audio.current) {
      setState("loading");
      try {
        const url = await loadVoice(id);
        const el = new Audio(url);
        el.ontimeupdate = () => setProgress(el.duration ? el.currentTime / el.duration : el.currentTime / Math.max(1, dur));
        el.onplay = () => setState("playing");
        el.onpause = () => setState("paused");
        el.onended = () => { setState("idle"); setProgress(0); };
        audio.current = el;
      } catch { setState("idle"); toast.error("Voice message unavailable"); return; }
    }
    if (playingVoice && playingVoice !== audio.current) playingVoice.pause();
    playingVoice = audio.current;
    void audio.current.play().catch(() => setState("paused"));
  };
  return (
    <div className="flex items-center gap-2.5 py-1 pr-1 min-w-[210px]">
      <button type="button" onClick={toggle} aria-label={state === "playing" ? "Pause voice message" : "Play voice message"} className="cc-3d-primary h-10 w-10 shrink-0 rounded-full grid place-items-center">
        {state === "loading" ? <span className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" /> : state === "playing" ? <Pause size={18} weight="fill" /> : <Play size={18} weight="fill" />}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-[2px] h-6" aria-hidden="true">
          {heights.map((h, i) => <span key={i} className="w-[3px] rounded-full" style={{ height: `${h}%`, background: i / heights.length <= progress ? "hsl(var(--primary))" : own ? "hsl(var(--chat-out-fg) / .35)" : "hsl(var(--chat-meta) / .5)" }} />)}
        </div>
        <span className="text-[11px] cc-meta">{formatDuration(state === "idle" ? dur : progress * dur)}</span>
      </div>
    </div>
  );
}

type ComposerProps = {
  text: string; setText: (v: string) => void; inputRef: React.RefObject<HTMLTextAreaElement>; reply: ChatReply | null; clearReply: () => void;
  image: { url: string; local: string } | null; clearImage: () => void; uploading: boolean; sending: boolean;
  onSend: () => void; onAttach: () => void; panelOpen: boolean; togglePanel: () => void; onVoice: (blob: Blob, dur: number) => void;
  editing: boolean; cancelEdit: () => void; slowWait: number; isCeo: boolean;
};
function Composer({ text, setText, inputRef, reply, clearReply, image, clearImage, uploading, sending, onSend, onAttach, panelOpen, togglePanel, onVoice, editing, cancelEdit, slowWait, isCeo }: ComposerProps) {
  const [rec, setRec] = useState<{ start: number; secs: number } | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const cancelled = useRef(false);
  const timer = useRef<number>();
  const canSend = (!!text.trim() || (!!image?.url && !uploading)) && slowWait <= 0;
  const isCommand = isCeo && /^\/(ban|unban|warning|warn)\b/i.test(text.trim());

  const stopTracks = () => recorder.current?.stream.getTracks().forEach(t => t.stop());
  const startRec = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { toast.error("Voice recording is not supported here"); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const type = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm"].find(t => MediaRecorder.isTypeSupported(t)) || "";
      const r = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 24000 });
      chunks.current = []; cancelled.current = false;
      const start = Date.now();
      r.ondataavailable = e => { if (e.data.size) chunks.current.push(e.data); };
      r.onstop = () => {
        stopTracks(); window.clearInterval(timer.current);
        const secs = Math.min(MAX_VOICE_SECONDS, Math.round((Date.now() - start) / 1000));
        setRec(null);
        if (cancelled.current) return;
        if (secs < 1) { toast("Hold on — voice message is too short"); return; }
        onVoice(new Blob(chunks.current, { type: (r.mimeType || "audio/webm").split(";")[0] }), secs);
      };
      recorder.current = r; r.start(250);
      setRec({ start, secs: 0 });
      timer.current = window.setInterval(() => {
        const secs = Math.floor((Date.now() - start) / 1000);
        setRec(v => (v ? { ...v, secs } : v));
        if (secs >= MAX_VOICE_SECONDS && r.state === "recording") r.stop();
      }, 250);
    } catch { toast.error("Allow microphone access to send voice messages"); }
  };
  const finishRec = (cancel: boolean) => { cancelled.current = cancel; if (recorder.current?.state === "recording") recorder.current.stop(); };
  useEffect(() => () => { cancelled.current = true; if (recorder.current?.state === "recording") recorder.current.stop(); stopTracks(); window.clearInterval(timer.current); }, []);

  return (
    <div>
      {editing && (
        <div className="mb-2 flex items-center gap-2 px-1">
          <PencilSimple size={20} weight="bold" className="text-primary shrink-0" />
          <div className="min-w-0 flex-1 border-l-[3px] border-primary pl-2"><p className="text-[12.5px] font-bold text-primary">Edit message</p><p className="text-[12px] cc-meta truncate">Change the text and tap ✓</p></div>
          <button type="button" aria-label="Cancel edit" onClick={cancelEdit} className="h-9 w-9 grid place-items-center rounded-full text-muted-foreground"><X size={18} weight="bold" /></button>
        </div>
      )}
      {isCommand && <p className="mb-1.5 px-2 text-[11.5px] font-semibold text-primary flex items-center gap-1"><ShieldStar size={14} weight="fill" />CEO command · /ban 30s · 30m · 3h · permanent · /unban · /warning text</p>}
      {slowWait > 0 && !editing && <p className="mb-1.5 px-2 text-[12px] font-semibold cc-meta flex items-center gap-1"><Timer size={14} weight="bold" />Slow mode · next message in {Math.ceil(slowWait / 1000)}s</p>}
      {reply && (
        <div className="mb-2 flex items-center gap-2 px-1">
          <ArrowBendUpLeft size={20} weight="bold" className="text-primary shrink-0" />
          <div className="min-w-0 flex-1 border-l-[3px] border-primary pl-2">
            <p className="text-[12.5px] font-bold text-primary truncate">Reply to {reply.name}</p>
            <p className="text-[12.5px] cc-meta truncate">{reply.preview}</p>
          </div>
          <button type="button" aria-label="Cancel reply" onClick={clearReply} className="h-9 w-9 grid place-items-center rounded-full text-muted-foreground"><X size={18} weight="bold" /></button>
        </div>
      )}
      {image && (
        <div className="mb-2 flex items-center gap-2 px-1">
          <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl">
            <img src={image.local} alt="Selected photo" className="h-full w-full object-cover" />
            {uploading && <span className="absolute inset-0 grid place-items-center bg-foreground/40"><span className="h-5 w-5 rounded-full border-2 border-background border-t-transparent animate-spin" /></span>}
          </span>
          <p className="flex-1 text-[13px] cc-meta">{uploading ? "Uploading photo…" : "Photo ready — add a caption or send"}</p>
          <button type="button" aria-label="Remove photo" onClick={clearImage} className="h-9 w-9 grid place-items-center rounded-full text-muted-foreground"><X size={18} weight="bold" /></button>
        </div>
      )}
      {rec ? (
        <div className="flex items-center gap-2 h-12">
          <button type="button" onClick={() => finishRec(true)} aria-label="Cancel recording" className="cc-3d h-11 w-11 shrink-0 rounded-full grid place-items-center cc-rec"><Trash size={20} weight="bold" /></button>
          <div className="flex-1 flex items-center gap-2 rounded-full bg-secondary h-11 px-4">
            <span className="cc-rec-dot h-2.5 w-2.5 rounded-full" />
            <span className="font-mono text-sm font-bold tabular-nums">{formatDuration(rec.secs)}</span>
            <span className="text-xs cc-meta truncate">Recording · max {MAX_VOICE_SECONDS}s</span>
          </div>
          <button type="button" onClick={() => finishRec(false)} aria-label="Send voice message" className="cc-3d-primary h-11 w-11 shrink-0 rounded-full grid place-items-center"><PaperPlaneRight size={20} weight="fill" /></button>
        </div>
      ) : (
        <form className="flex items-end gap-1.5" onSubmit={e => { e.preventDefault(); onSend(); }}>
          <button type="button" onClick={togglePanel} aria-label="Stickers" aria-pressed={panelOpen} className={`cc-3d h-11 w-11 shrink-0 rounded-full grid place-items-center ${panelOpen ? "text-primary" : "text-muted-foreground"}`}>
            <Smiley size={23} weight={panelOpen ? "fill" : "duotone"} />
          </button>
          <div className="flex-1 min-w-0 flex items-end rounded-[22px] bg-secondary border border-border pl-3.5 pr-1">
            <textarea ref={inputRef} aria-label="Message" placeholder="Message" rows={1} maxLength={2000} value={text}
              onChange={e => { setText(e.target.value); const el = e.target; el.style.height = "auto"; el.style.height = `${Math.min(120, el.scrollHeight)}px`; }}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && window.matchMedia("(min-width: 960px)").matches) { e.preventDefault(); onSend(); } }}
              className="min-w-0 flex-1 resize-none bg-transparent py-[11px] text-[15px] leading-5 text-foreground placeholder:text-muted-foreground focus:outline-none" />
            <button type="button" onClick={onAttach} aria-label="Send photo" className="h-10 w-10 shrink-0 grid place-items-center rounded-full text-muted-foreground active:scale-90 transition-transform">
              <ImageSquare size={23} weight="duotone" />
            </button>
          </div>
          {slowWait > 0 && !editing
            ? <span aria-label="Slow mode timer" className="cc-3d h-11 w-11 shrink-0 rounded-full grid place-items-center font-mono text-[13px] font-black text-primary tabular-nums">{Math.ceil(slowWait / 1000)}</span>
            : canSend || sending || editing
            ? <button type="submit" disabled={sending || uploading} aria-label="Send message" className="cc-3d-primary h-11 w-11 shrink-0 rounded-full grid place-items-center">
                {sending ? <span className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" /> : editing ? <span className="text-[20px] font-black leading-none">✓</span> : <PaperPlaneRight size={21} weight="fill" />}
              </button>
            : <button type="button" onClick={startRec} aria-label="Record voice message" className="cc-3d-primary h-11 w-11 shrink-0 rounded-full grid place-items-center"><Microphone size={21} weight="fill" /></button>}
        </form>
      )}
    </div>
  );
}

function StickerPanel({ uid, onPick }: { uid: string; onPick: (s: string) => void }) {
  const [tab, setTab] = useState<"emoji" | "mine">("emoji");
  const [mine, setMine] = useState<{ id: string; url: string }[]>([]);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => subscribeMyStickers(uid, setMine), [uid]);
  const add = async (f?: File) => {
    if (!f) return;
    if (!/^image\/(png|webp|gif|jpeg)$/i.test(f.type)) { toast.error("Stickers must be images"); return; }
    if (f.size > 5 * 1024 * 1024) { toast.error("Sticker must be under 5 MB"); return; }
    setAdding(true);
    try { await addMySticker(uid, await uploadToImgbb(f)); setTab("mine"); toast.success("Sticker added"); }
    catch { toast.error("Could not add sticker"); }
    finally { setAdding(false); }
  };
  return (
    <div className="mt-2 rounded-2xl bg-secondary/60 border border-border overflow-hidden" onClick={e => e.stopPropagation()}>
      <div className="flex gap-1 p-1.5">
        {([["emoji", "Stickers", <Smiley key="e" size={18} weight="duotone" />], ["mine", "My stickers", <Sticker key="m" size={18} weight="duotone" />]] as const).map(([id, label, icon]) => (
          <button key={id} type="button" onClick={() => setTab(id)} aria-pressed={tab === id}
            className={`flex-1 h-9 rounded-xl text-[13px] font-bold flex items-center justify-center gap-1.5 ${tab === id ? "cc-3d text-primary" : "text-muted-foreground"}`}>{icon}{label}</button>
        ))}
      </div>
      <div className="h-[220px] overflow-y-auto px-2 pb-2">
        {tab === "emoji" ? (
          <div className="grid grid-cols-6 gap-1">
            {BUILT_IN_STICKERS.map(s => <button key={s} type="button" onClick={() => onPick(s)} aria-label={`Send ${s} sticker`} className="aspect-square rounded-xl text-[34px] leading-none grid place-items-center active:scale-90 transition-transform">{s}</button>)}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-2">
              <button type="button" disabled={adding} onClick={() => file.current?.click()} aria-label="Add sticker from your photos" className="cc-3d aspect-square rounded-2xl grid place-items-center text-primary">
                {adding ? <span className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" /> : <Plus size={28} weight="bold" />}
              </button>
              {mine.map(s => (
                <span key={s.id} className="relative">
                  <button type="button" onClick={() => !editing && onPick(s.url)} aria-label="Send my sticker" className="aspect-square w-full rounded-2xl grid place-items-center active:scale-90 transition-transform">
                    <img src={s.url} alt="" className="h-full w-full object-contain" loading="lazy" />
                  </button>
                  {editing && <button type="button" aria-label="Remove sticker" onClick={() => void removeMySticker(uid, s.id)} className="absolute -top-1 -right-1 h-6 w-6 rounded-full bg-destructive text-destructive-foreground grid place-items-center"><X size={13} weight="bold" /></button>}
                </span>
              ))}
            </div>
            {mine.length > 0 && <button type="button" onClick={() => setEditing(v => !v)} className="mt-2 w-full text-center text-xs font-semibold text-muted-foreground py-1">{editing ? "Done" : "Edit my stickers"}</button>}
            {mine.length === 0 && <p className="mt-3 text-center text-xs cc-meta">Tap + to turn any photo into your own sticker.</p>}
          </>
        )}
      </div>
      <input ref={file} type="file" accept="image/png,image/webp,image/gif,image/jpeg" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; void add(f); }} />
    </div>
  );
}
