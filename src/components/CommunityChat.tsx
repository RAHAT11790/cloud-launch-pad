import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { CHAT_SECURITY_READY, currentChatProfile, privateRoomId, sendChatMessage, subscribeChat, type ChatMessage, type ChatProfile } from "@/lib/communityChat";
import { uploadToImgbb } from "@/lib/imgbbUpload";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Copy, Film, Globe, ImagePlus, Loader2, MessageCircle, Send, ShieldCheck, Users, X } from "lucide-react";
import type { AnimeItem } from "@/data/animeData";
import { toast } from "sonner";

export default function CommunityChat({ isActive, allAnime, onAnimeClick, onLogin }: { isActive: boolean; allAnime: AnimeItem[]; onAnimeClick: (anime: AnimeItem) => void; onLogin: () => void }) {
  const [identity, setIdentity] = useState(currentChatProfile);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [recipient, setRecipient] = useState<ChatProfile | null>(null);
  const [profile, setProfile] = useState<ChatProfile | null>(null);
  const [view, setView] = useState<"chat" | "members">("chat");
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const [picker, setPicker] = useState(false);
  const [image, setImage] = useState("");
  const [movieId, setMovieId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const room = identity && recipient ? privateRoomId(identity.id, recipient.id) : "global";
  useEffect(() => onAuthStateChanged(auth, () => { setIdentity(currentChatProfile()); setRecipient(null); }), []);
  useEffect(() => {
    if (!isActive) return;
    setMessages([]); setError(false);
    return subscribeChat(room, setMessages, () => setError(true));
  }, [isActive, room]);
  useEffect(() => { if (isActive && view === "chat") end.current?.scrollIntoView({ block: "nearest" }); }, [messages, isActive, view]);
  const members = useMemo(() => [...new Map(messages.map(message => [message.sender.id, message.sender])).values()], [messages]);
  const movie = allAnime.find(item => item.id === movieId);
  const send = async () => {
    if (busy) return;
    setBusy(true);
    try { await sendChatMessage(room, text, { ...(image ? { image } : {}), ...(movieId ? { movieId } : {}) }, recipient || undefined); setText(""); setImage(""); setMovieId(""); }
    catch { toast.error("Message not sent. Please try again."); }
    finally { setBusy(false); }
  };
  const enabled = CHAT_SECURITY_READY && !!identity;
  return <section className="community-chat bg-background text-foreground" aria-label="Global chat">
    <header className="flex items-center gap-3 border-b border-border px-4 py-4">
      {recipient ? <Button variant="ghost" size="icon" aria-label="Back to global chat" onClick={() => setRecipient(null)}><ArrowLeft /></Button> : <Globe className="h-6 w-6 text-primary" />}
      <div className="min-w-0 flex-1"><h1 className="text-lg font-bold truncate">{recipient?.name || "Global Chat"}</h1><p className="text-xs text-muted-foreground">{recipient ? "Private conversation" : "RS ANIME03 · Community"}</p></div>
      <Button variant={view === "members" ? "secondary" : "ghost"} size="icon" title="Members" aria-label="Members" onClick={() => setView(view === "chat" ? "members" : "chat")}><Users /></Button>
    </header>
    <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4">
      {!CHAT_SECURITY_READY && <div className="border-l-2 border-primary pl-3 py-2"><p className="text-sm font-semibold flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" />Chat setup pending</p><p className="text-xs text-muted-foreground mt-1">Messages are unavailable until secure access is connected.</p></div>}
      {error && <p role="alert" className="text-sm text-destructive">Could not load messages. Reopen Chat to retry.</p>}
      {view === "members" ? <><h2 className="font-semibold">Members · {members.length}</h2>{members.map(member => <Button key={member.id} variant="ghost" className="w-full justify-start h-14" onClick={() => setProfile(member)}><Avatar profile={member} /><span className="truncate">{member.name}</span></Button>)}</> : <>
        {!messages.length && <div className="py-12 flex flex-col items-center gap-3 text-muted-foreground"><MessageCircle className="h-10 w-10" /><p className="text-sm">{CHAT_SECURITY_READY ? "No messages yet" : "Global conversation"}</p></div>}
        {messages.map(message => { const shared = allAnime.find(item => item.id === message.movieId); return <article key={message.id} className={`flex gap-2 ${message.sender.id === identity?.id ? "flex-row-reverse" : ""}`}>
          <Button variant="ghost" size="icon" className="shrink-0" aria-label={`View ${message.sender.name} profile`} onClick={() => setProfile(message.sender)}><Avatar profile={message.sender} /></Button>
          <div className="max-w-[80%] min-w-0 rounded-lg bg-secondary p-3"><div className="flex items-center gap-3 mb-1"><span className="font-semibold text-xs truncate">{message.sender.name}</span><time className="text-[10px] text-muted-foreground shrink-0">{new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></div>
            <p className="text-sm whitespace-pre-wrap break-words">{message.text}</p>
            {message.image && <img src={message.image} alt="Shared image" className="mt-2 max-h-64 w-full rounded object-contain" loading="lazy" />}
            {shared && <Button variant="ghost" className="mt-2 h-auto w-full whitespace-normal justify-start" onClick={() => onAnimeClick(shared)}><img src={shared.poster} alt="" className="w-10 aspect-[2/3] object-cover rounded" /><span className="text-xs text-left">{shared.title}</span></Button>}
          </div>
        </article>; })}<div ref={end} />
      </>}
    </div>
    <footer className="border-t border-border px-3 py-3 bg-background">
      {!identity && <Button variant="outline" className="w-full mb-2" onClick={onLogin}>Sign in to chat</Button>}
      {(image || movie) && <div className="flex items-center gap-2 mb-2 text-xs">{image && <img src={image} alt="Attachment" className="h-12 w-12 object-cover rounded" />}{movie && <span className="truncate">{movie.title}</span>}<Button variant="ghost" size="icon" aria-label="Remove attachment" onClick={() => { setImage(""); setMovieId(""); }}><X /></Button></div>}
      <form onSubmit={event => { event.preventDefault(); void send(); }} className="flex gap-1 items-end">
        <Button type="button" variant="ghost" size="icon" title="Attach image" aria-label="Attach image" disabled={!enabled || busy} onClick={() => file.current?.click()}><ImagePlus /></Button>
        <Button type="button" variant="ghost" size="icon" title="Share movie or series" aria-label="Share movie or series" disabled={!enabled || busy} onClick={() => setPicker(true)}><Film /></Button>
        <textarea aria-label="Message" placeholder="Message…" maxLength={2000} rows={1} disabled={!enabled || busy} value={text} onChange={event => setText(event.target.value)} className="min-w-0 flex-1 resize-none rounded-md bg-secondary px-3 py-2 text-sm border border-input focus:outline-none focus:ring-1 focus:ring-ring" />
        <Button type="submit" size="icon" aria-label="Send message" disabled={!enabled || busy || (!text.trim() && !image && !movieId)}>{busy ? <Loader2 className="animate-spin" /> : <Send />}</Button>
      </form>
      <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={async event => { const selected = event.target.files?.[0]; event.target.value = ""; if (!selected || !enabled) return; if (selected.size > 10 * 1024 * 1024) { toast.error("Image must be under 10 MB"); return; } setBusy(true); try { setImage(await uploadToImgbb(selected)); } catch { toast.error("Image upload failed"); } finally { setBusy(false); } }} />
    </footer>
    {profile && <div className="absolute inset-0 z-20 bg-background p-5 overflow-y-auto"><Button variant="ghost" size="icon" aria-label="Close member profile" onClick={() => setProfile(null)}><ArrowLeft /></Button><div className="mt-8 flex flex-col items-center gap-4"><Avatar profile={profile} large /><h2 className="text-xl font-bold break-words max-w-full">{profile.name}</h2><p className="text-xs text-muted-foreground break-all">ID · {profile.id}</p><Button variant="outline" onClick={() => { void navigator.clipboard.writeText(profile.id).then(() => toast.success("ID copied")).catch(() => toast.error("Could not copy ID")); }}><Copy />Copy ID</Button>{identity && identity.id !== profile.id && <Button disabled={!enabled} onClick={() => { setRecipient(profile); setProfile(null); setView("chat"); }}><MessageCircle />Message</Button>}</div></div>}
    {picker && <div className="absolute inset-0 z-20 bg-background p-4 overflow-y-auto"><div className="flex items-center justify-between"><h2 className="font-bold">Share a title</h2><Button variant="ghost" size="icon" aria-label="Close title picker" onClick={() => setPicker(false)}><X /></Button></div><input aria-label="Search titles" placeholder="Search titles" value={search} onChange={event => setSearch(event.target.value)} className="w-full my-4 p-3 bg-secondary border border-input rounded-md" />{allAnime.filter(item => item.title.toLowerCase().includes(search.toLowerCase())).slice(0, 50).map(item => <Button key={item.id} variant="ghost" className="flex w-full h-16 justify-start whitespace-normal" onClick={() => { setMovieId(item.id); setPicker(false); }}><img src={item.poster} alt="" className="w-8 aspect-[2/3] rounded object-cover" /><span className="text-left text-sm">{item.title}</span></Button>)}</div>}
  </section>;
}
function Avatar({ profile, large = false }: { profile: ChatProfile; large?: boolean }) {
  return <span className={`${large ? "h-24 w-24 text-3xl" : "h-8 w-8 text-xs"} shrink-0 rounded-full bg-secondary flex items-center justify-center overflow-hidden font-bold`}>{profile.photo ? <img src={profile.photo} alt={profile.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" /> : profile.name.slice(0, 1).toUpperCase()}</span>;
}