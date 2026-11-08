import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft, Camera, Check, ChevronRight, Copy, Crown, Heart, KeyRound, Loader2, Mail,
  Palette, Save, Smile, Sparkles, Trash2, Type, UserRound,
} from "lucide-react";
import { toast } from "sonner";
import {
  BIO_MAX, GENRES_MAX, NAME_MAX, PROFILE_ACCENTS, PROFILE_GENRES, PROFILE_MOODS,
  accentRgb, cleanBio, cleanName, moodOf, nameError, readCachedCard, sameCard, saveProfileCard, subscribeProfileCard,
  type ProfileCard,
} from "@/lib/profileCard";

type Props = {
  userId: string | null;
  email: string;
  displayName: string;
  avatar: ReactNode;
  backdrop: ReactNode;
  themeClass: string;
  fontClass: string;
  isPremium: boolean;
  frameName?: string;
  backdropName?: string;
  hasPhoto: boolean;
  photoUploading: boolean;
  onPickPhoto: () => void;
  onRemovePhoto: () => void;
  onSaveName: (name: string) => void;
  onBack: () => void;
  onOpenPassword: () => void;
  onOpenStudio: () => void;
};

/** Live 3D preview: tilts with the finger/mouse (transform only — cheap on low-end phones). */
const Card3D = memo(function Card3D({ name, card, avatar, backdrop, isPremium, fontClass }: {
  name: string; card: ProfileCard; avatar: ReactNode; backdrop: ReactNode; isPremium: boolean; fontClass: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const raf = useRef(0);
  const move = useCallback((e: React.PointerEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      el.style.setProperty("--ry", `${(x - 0.5) * 22}deg`);
      el.style.setProperty("--rx", `${(0.5 - y) * 16}deg`);
      el.style.setProperty("--mx", `${x * 100}%`);
      el.style.setProperty("--my", `${y * 100}%`);
      el.classList.add("is-tilting");
    });
  }, []);
  const leave = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    cancelAnimationFrame(raf.current);
    el.style.setProperty("--ry", "0deg");
    el.style.setProperty("--rx", "0deg");
    el.classList.remove("is-tilting");
  }, []);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  const mood = moodOf(card.mood);
  const glow = accentRgb(card.accent);
  return (
    <div className="pe-card3d" style={glow ? ({ "--pe-accent": glow } as React.CSSProperties) : undefined}>
      <div ref={ref} className="pe-tilt" onPointerMove={move} onPointerLeave={leave} onPointerCancel={leave} onPointerUp={leave}>
        <div className="pe-float">
          <div className="pe-card">
            <div className="pe-layer pe-bg">{backdrop}</div>
            <div className="pe-layer pe-shade" />
            <div className="pe-layer pe-shine" />
            <div className="pe-top pe-z1">
              <span className="pe-chip">RS ANIME<b>03</b> · MEMBER</span>
              {isPremium && <span className="pe-chip pe-chip-gold"><Crown className="h-3 w-3" /> PREMIUM</span>}
            </div>
            <div className="pe-body">
              <div className="pe-avatar pe-z3">{avatar}</div>
              <div className={`pe-copy pe-z2 ${fontClass}`}>
                <div className="profile-name-row"><h1>{name || "Your name"}</h1></div>
                {mood.id && <span className="pe-mood">{mood.emoji} {mood.label}</span>}
                <p className={card.bio ? "" : "pe-muted"}>{card.bio || "Add a short bio so people know your anime taste."}</p>
              </div>
            </div>
            <div className="pe-genres pe-z1">
              {card.genres.length ? card.genres.map((g) => <span key={g}>{g}</span>) : <span className="pe-muted">Pick favourite genres</span>}
            </div>
          </div>
        </div>
      </div>
      <div className="pe-floor" aria-hidden />
    </div>
  );
});

function Section({ icon: Icon, title, hint, right, children }: { icon: any; title: string; hint?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="pe-section">
      <header>
        <span className="pe-section-icon"><Icon className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1"><h3>{title}</h3>{hint && <p>{hint}</p>}</div>
        {right}
      </header>
      {children}
    </section>
  );
}

export default function EditProfilePanel(p: Props) {
  const [name, setName] = useState(p.displayName);
  const [saved, setSaved] = useState<ProfileCard>(() => readCachedCard(p.userId));
  const [card, setCard] = useState<ProfileCard>(saved);
  const [saving, setSaving] = useState(false);
  const touched = useRef(false);

  useEffect(() => {
    if (!p.userId) return;
    return subscribeProfileCard(p.userId, (c) => {
      setSaved(c);
      if (!touched.current) setCard(c);
    });
  }, [p.userId]);
  const edit = (patch: Partial<ProfileCard>) => { touched.current = true; setCard((c) => ({ ...c, ...patch })); };

  const nameErr = nameError(name);
  const nameDirty = cleanName(name) !== cleanName(p.displayName);
  const cardDirty = !sameCard({ ...card, bio: cleanBio(card.bio) }, saved);
  const dirty = nameDirty || cardDirty;

  const save = async () => {
    if (nameErr) { toast.error(nameErr); return; }
    if (!p.userId) return;
    setSaving(true);
    try {
      if (nameDirty) p.onSaveName(cleanName(name));
      if (cardDirty) { const c = await saveProfileCard(p.userId, card); setSaved(c); setCard(c); }
      touched.current = false;
      toast.success("Profile saved");
      p.onBack();
    } catch {
      toast.error("Could not save. Check your internet and try again.");
    }
    setSaving(false);
  };
  const discard = () => { touched.current = false; setName(p.displayName); setCard(saved); };

  const toggleGenre = (g: string) => {
    const has = card.genres.includes(g);
    if (!has && card.genres.length >= GENRES_MAX) { toast.info(`Pick up to ${GENRES_MAX} genres`); return; }
    edit({ genres: has ? card.genres.filter((x) => x !== g) : [...card.genres, g] });
  };
  const copyId = () => {
    if (!p.userId) return;
    navigator.clipboard?.writeText(p.userId).then(() => toast.success("User ID copied"), () => toast.error("Could not copy"));
  };
  const preview = useMemo(() => ({ ...card, bio: cleanBio(card.bio) }), [card]);

  return (
    <motion.div className={`pe-root fixed inset-0 z-[200] overflow-y-auto ${p.themeClass}`}
      initial={{ x: 34, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 34, opacity: 0 }} transition={{ type: "tween", duration: 0.28 }}>
      <div className="pe-topbar">
        <button type="button" onClick={p.onBack} className="pe-iconbtn" aria-label="Back"><ArrowLeft className="h-5 w-5" /></button>
        <div className="min-w-0 flex-1">
          <h2>Edit profile</h2>
          <p>{dirty ? "Unsaved changes" : "Everything is saved"}</p>
        </div>
        <button type="button" onClick={save} disabled={!dirty || saving || !!nameErr} className="pe-savebtn">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
        </button>
      </div>

      <div className="mx-auto w-full max-w-[560px] px-4 pb-32">
        <Card3D name={cleanName(name)} card={preview} avatar={p.avatar} backdrop={p.backdrop} isPremium={p.isPremium} fontClass={p.fontClass} />
        <p className="mt-1 text-center text-[10.5px] text-muted-foreground">Live preview · drag the card to tilt it</p>

        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <button type="button" onClick={p.onPickPhoto} disabled={p.photoUploading} className="pe-action">
            {p.photoUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
            <span>{p.hasPhoto ? "Change photo" : "Add photo"}</span>
          </button>
          <button type="button" onClick={p.onRemovePhoto} disabled={!p.hasPhoto || p.photoUploading} className="pe-action">
            <Trash2 className="h-4 w-4" /><span>Remove photo</span>
          </button>
        </div>
        <p className="mt-1.5 text-center text-[10px] text-muted-foreground">JPG, PNG or WebP · up to 10 MB</p>

        <Section icon={UserRound} title="Display name" hint="Shown on your profile and in chat"
          right={<span className={`pe-count ${name.length >= NAME_MAX ? "is-max" : ""}`}>{cleanName(name).length}/{NAME_MAX}</span>}>
          <input value={name} onChange={(e) => setName(e.target.value.slice(0, NAME_MAX + 5))} maxLength={NAME_MAX + 5}
            placeholder="Your name" className={`pe-input ${nameErr ? "is-error" : ""}`} aria-invalid={!!nameErr} />
          {nameErr && <p className="pe-error">{nameErr}</p>}
        </Section>

        <Section icon={Type} title="Bio" hint="A line about you and your anime taste"
          right={<span className={`pe-count ${card.bio.length >= BIO_MAX ? "is-max" : ""}`}>{card.bio.length}/{BIO_MAX}</span>}>
          <textarea value={card.bio} onChange={(e) => edit({ bio: e.target.value.slice(0, BIO_MAX) })} rows={3} maxLength={BIO_MAX}
            placeholder="e.g. One Piece forever. Watching Solo Leveling right now." className="pe-input pe-textarea" />
        </Section>

        <Section icon={Smile} title="Mood" hint="A small status on your card">
          <div className="pe-chips">
            {PROFILE_MOODS.map((m) => (
              <button key={m.id || "none"} type="button" onClick={() => edit({ mood: m.id })} className={`pe-chipbtn ${card.mood === m.id ? "is-on" : ""}`}>
                {m.emoji && <span aria-hidden>{m.emoji}</span>} {m.label}
              </button>
            ))}
          </div>
        </Section>

        <Section icon={Heart} title="Favourite genres" hint={`Pick up to ${GENRES_MAX}`}
          right={<span className="pe-count">{card.genres.length}/{GENRES_MAX}</span>}>
          <div className="pe-chips">
            {PROFILE_GENRES.map((g) => {
              const on = card.genres.includes(g);
              return (
                <button key={g} type="button" onClick={() => toggleGenre(g)} className={`pe-chipbtn ${on ? "is-on" : ""}`} aria-pressed={on}>
                  {on && <Check className="h-3 w-3" />} {g}
                </button>
              );
            })}
          </div>
        </Section>

        <Section icon={Palette} title="Card glow" hint="The light around your 3D card">
          <div className="pe-swatches">
            {PROFILE_ACCENTS.map((a) => (
              <button key={a.id || "theme"} type="button" onClick={() => edit({ accent: a.id })} aria-label={a.name} title={a.name}
                className={`pe-swatch ${card.accent === a.id ? "is-on" : ""}`}
                style={{ "--sw": a.rgb || "var(--pf-accent)" } as React.CSSProperties}>
                {card.accent === a.id && <Check className="h-3.5 w-3.5" />}
                <small>{a.name}</small>
              </button>
            ))}
          </div>
        </Section>

        <div className="pe-links">
          <button type="button" onClick={p.onOpenStudio} className="pe-link">
            <span className="pe-section-icon"><Sparkles className="h-4 w-4" /></span>
            <span className="min-w-0 flex-1 text-left"><strong>Profile Studio</strong><small>{[p.frameName, p.backdropName].filter(Boolean).join(" · ") || "Frames, backdrops, themes & name style"}</small></span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </button>
          <button type="button" onClick={p.onOpenPassword} className="pe-link">
            <span className="pe-section-icon"><KeyRound className="h-4 w-4" /></span>
            <span className="min-w-0 flex-1 text-left"><strong>Password & security</strong><small>Change password or reset it by email code</small></span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <Section icon={Mail} title="Account">
          <div className="pe-account">
            <div><small>Email</small><strong className="truncate">{p.email || "—"}</strong></div>
            {p.userId && (
              <button type="button" onClick={copyId}>
                <small>User ID</small><strong className="truncate font-mono text-[11px]">{p.userId}</strong><Copy className="h-3.5 w-3.5 shrink-0" />
              </button>
            )}
          </div>
        </Section>
      </div>

      {dirty && (
        <div className="pe-savebar">
          <span>Unsaved changes</span>
          <button type="button" onClick={discard} className="pe-ghost">Discard</button>
          <button type="button" onClick={save} disabled={saving || !!nameErr} className="pe-savebtn">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save
          </button>
        </div>
      )}
    </motion.div>
  );
}
