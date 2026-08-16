import { useState, useEffect, useCallback } from "react";
import {
  Play, Trophy, Dices, Share2, Swords, User, Flame, Check, Lock,
  Plus, ArrowLeft, ExternalLink, Copy, RefreshCw, Users, Clock, X, Search, ChevronDown,
} from "lucide-react";
import * as api from "./lib/api.js";

/* ---------------------------------------------------------
   SPRINTLY — application fonctionnelle
   Mêmes tokens visuels que la maquette d'origine.
   Défis réels, participation par lien vidéo, tirage au sort,
   duels, votes et trophées — persistés dans Supabase (Postgres),
   partagés entre tous les visiteurs du site, avec les règles
   métier appliquées côté base de données (fonctions RPC).
--------------------------------------------------------- */

const CORAL = "#FF5A4E";
const COBALT = "#3E6BFF";
const LIME = "#C7FF3A";
const GOLD = "#E8B84D";
const INK = "#0A0D14";
const INK2 = "#12161F";
const CHALK = "#F3F1EA";
const MUTE = "#9AA3B5"; // texte secondaire, éclairci pour rester lisible sur fond très sombre

const FONTS = `@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap');`;
const display = { fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.02em" };
const mono = { fontFamily: "'JetBrains Mono', monospace" };
const body = { fontFamily: "'Inter', sans-serif" };

/* ---------------- Petits utilitaires ---------------- */
// L'accès aux données (lecture/écriture) vit désormais dans ./lib/api.js,
// branché sur Supabase. Ici il ne reste que du pur formatage/affichage.

function getYouTubeId(link) {
  if (!link) return null;
  const m = link.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}
function fmtDelta(ts) {
  const ms = ts - Date.now();
  if (ms <= 0) return "clôturé";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h >= 24) return `${Math.floor(h / 24)}j ${h % 24}h`;
  if (h > 0) return `${h}h ${m}min`;
  return `${m}min`;
}

/* ---------------- Small UI atoms ---------------- */

function Seam({ progress = 100 }) {
  return (
    <div className="w-full h-1.5 flex overflow-hidden rounded-full" style={{ background: "#1B2130" }}>
      <div className="h-full transition-all duration-500" style={{ width: `${progress}%`, background: `linear-gradient(100deg, ${CORAL} 0%, ${CORAL} 45%, ${COBALT} 55%, ${COBALT} 100%)` }} />
    </div>
  );
}

function Chip({ children, color = LIME, filled = false }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold uppercase"
      style={{ color: filled ? INK : color, background: filled ? color : `${color}1A`, border: filled ? "none" : `1px solid ${color}55`, ...body, letterSpacing: "0.04em" }}
    >
      {children}
    </span>
  );
}

function Button({ children, onClick, variant = "lime", disabled, icon: Icon, type = "button" }) {
  const bg = variant === "lime" ? LIME : variant === "gold" ? GOLD : variant === "coral" ? CORAL : variant === "cobalt" ? COBALT : "transparent";
  const isGhost = variant === "ghost";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="w-full py-3.5 rounded-2xl font-bold flex items-center justify-center gap-2 transition-opacity"
      style={{
        background: isGhost ? "transparent" : bg,
        color: isGhost ? CHALK : INK,
        border: isGhost ? "1px solid #FFFFFF22" : "none",
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
        ...body,
      }}
    >
      {Icon && <Icon size={16} />}
      {children}
    </button>
  );
}

function Field({ label, children }) {
  return (
    <div className="mb-4">
      <div style={{ fontSize: 11, color: MUTE, fontWeight: 700 }} className="uppercase mb-2">{label}</div>
      {children}
    </div>
  );
}

function TextInput({ value, onChange, placeholder, mono: useMono, disabled }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className="w-full rounded-2xl px-4 py-3.5 outline-none"
      style={{ background: INK2, border: `1px solid #FFFFFF18`, color: CHALK, fontSize: 14, opacity: disabled ? 0.6 : 1, ...(useMono ? mono : body) }}
    />
  );
}

/* ---------------------------------------------------------
   RENDERERS VIDÉO PAR PLATEFORME
   detectPlatform() route chaque lien vers son renderer dédié.
   Aujourd'hui, seul YouTube peut être lu nativement dans cet
   environnement (scripts externes limités à cdnjs.cloudflare.com).
   TikTok et Instagram utilisent ExternalVideoCard en attendant
   un vrai déploiement, où TikTokEmbed / InstagramEmbed pourront
   charger tiktok.com/embed.js et le HTML oEmbed d'Instagram
   sans rien changer au reste du flux de duel/vote.
--------------------------------------------------------- */

function detectPlatform(link) {
  if (!link) return "other";
  if (getYouTubeId(link)) return "youtube";
  if (/tiktok\.com/.test(link)) return "tiktok";
  if (/instagram\.com/.test(link)) return "instagram";
  return "other";
}

function CardFrame({ c, name, badge, onClick, href, children }) {
  const commonStyle = { background: `linear-gradient(155deg, ${c}33, ${INK2} 70%)`, border: `1px solid ${c}44` };
  const inner = (
    <>
      <div className="flex items-center justify-between p-3">
        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase" style={{ background: `${c}22`, border: `1px solid ${c}55`, color: c, ...body, letterSpacing: "0.04em" }}>
          Performance du défi
        </span>
        <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: `${c}22`, border: `1px solid ${c}66` }}>
          <Play size={14} color={c} fill={c} />
        </div>
      </div>
      <div className="p-3">
        <div style={{ ...body, color: CHALK, fontWeight: 700, fontSize: 14 }}>🎥 Vidéo de {name}</div>
        <div style={{ ...body, color: MUTE, fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
          {badge} <ExternalLink size={10} />
        </div>
      </div>
      {children}
    </>
  );
  if (onClick) {
    return (
      <button onClick={onClick} className="relative w-full h-40 rounded-2xl overflow-hidden flex flex-col justify-between text-left" style={{ ...commonStyle, cursor: "pointer" }}>
        {inner}
      </button>
    );
  }
  return (
    <a href={href || "#"} target="_blank" rel="noreferrer" className="relative w-full h-40 rounded-2xl overflow-hidden flex flex-col justify-between no-underline" style={commonStyle}>
      {inner}
    </a>
  );
}

// Seule plateforme lisible nativement ici : embed public, aucun script tiers requis.
function YouTubeEmbed({ side, name, link }) {
  const c = side === "A" ? CORAL : COBALT;
  const ytId = getYouTubeId(link);
  const [playing, setPlaying] = useState(false);
  if (playing) {
    return (
      <div className="relative w-full h-40 rounded-2xl overflow-hidden" style={{ border: `1px solid ${c}44` }}>
        <iframe
          src={`https://www.youtube.com/embed/${ytId}?autoplay=1`}
          className="w-full h-full"
          style={{ border: "none" }}
          allow="autoplay; encrypted-media"
          allowFullScreen
          title={`Vidéo de ${name}`}
        />
      </div>
    );
  }
  return <CardFrame c={c} name={name} badge="Lire ici" onClick={() => setPlaying(true)} />;
}

// À activer sur le vrai domaine : charger tiktok.com/embed.js puis remplacer
// cette carte par le blockquote officiel (data-video-id extrait du lien).
function TikTokEmbed({ side, name, link }) {
  const c = side === "A" ? CORAL : COBALT;
  return <CardFrame c={c} name={name} badge="Voir sur TikTok" href={link} />;
}

// À activer sur le vrai domaine : appeler l'oEmbed Instagram (tokenless
// depuis juin 2026, à revérifier) et injecter le HTML retourné.
function InstagramEmbed({ side, name, link }) {
  const c = side === "A" ? CORAL : COBALT;
  return <CardFrame c={c} name={name} badge="Voir sur Instagram" href={link} />;
}

function ExternalVideoCard({ side, name, link }) {
  const c = side === "A" ? CORAL : COBALT;
  return <CardFrame c={c} name={name} badge="Voir la vidéo" href={link} />;
}

function VideoCard({ side, name, link }) {
  const platform = detectPlatform(link);
  if (platform === "youtube") return <YouTubeEmbed side={side} name={name} link={link} />;
  if (platform === "tiktok") return <TikTokEmbed side={side} name={name} link={link} />;
  if (platform === "instagram") return <InstagramEmbed side={side} name={name} link={link} />;
  return <ExternalVideoCard side={side} name={name} link={link} />;
}

function TopBar({ title, onBack, right }) {
  return (
    <div className="flex items-center justify-between px-5 pt-6 pb-3 max-w-2xl mx-auto w-full">
      <div className="flex items-center gap-3">
        {onBack && (
          <button onClick={onBack} className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: INK2, border: "1px solid #FFFFFF18" }}>
            <ArrowLeft size={15} color={CHALK} />
          </button>
        )}
        <div style={{ ...display, fontSize: 22, color: CHALK }}>{title}</div>
      </div>
      {right}
    </div>
  );
}

function Toast({ message, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2200);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-full z-50" style={{ background: CHALK, color: INK, ...body, fontSize: 13, fontWeight: 600, boxShadow: "0 10px 30px rgba(0,0,0,0.4)" }}>
      {message}
    </div>
  );
}

/* ---------------- Pseudo bar (persistent identity within session) ---------------- */

function AccountBar({ nav, toast, refreshSignal, onAccountChange }) {
  const [session, setSession] = useState(undefined); // undefined = chargement
  const [myPseudo, setMyPseudoState] = useState(null);
  const [step, setStep] = useState("idle"); // idle | email | sent | pseudo
  const [email, setEmail] = useState("");
  const [pseudoDraft, setPseudoDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const s = await api.getSession();
    setSession(s);
    setMyPseudoState(s ? await api.getMyPseudo() : null);
  }, []);

  useEffect(() => { refresh(); }, [refresh, refreshSignal]);
  useEffect(() => api.onAuthStateChange(() => refresh()), [refresh]);

  // Juste après la connexion, si le compte n'a pas encore de pseudo, on le demande.
  useEffect(() => {
    if (session && myPseudo === null && step === "idle") setStep("pseudo");
  }, [session, myPseudo, step]);

  const sendLink = async () => {
    if (!email.trim() || !email.includes("@")) { toast("Ajoute une adresse email valide."); return; }
    setBusy(true);
    try {
      await api.sendMagicLink(email.trim());
      setStep("sent");
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy(false);
    }
  };

  const savePseudo = async () => {
    if (!pseudoDraft.trim()) { toast("Choisis un pseudo."); return; }
    setBusy(true);
    try {
      const p = await api.setMyPseudo(pseudoDraft.trim());
      setMyPseudoState(p);
      setStep("idle");
      onAccountChange?.();
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (session === undefined) return <div style={{ width: 90, height: 28 }} />;

  if (step === "email") {
    return (
      <div className="flex items-center gap-2">
        <input
          autoFocus value={email} onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") sendLink(); }}
          placeholder="ton email"
          className="rounded-full px-3 py-1.5 outline-none"
          style={{ background: INK2, border: `1px solid ${LIME}55`, color: CHALK, fontSize: 12, width: 150, ...body }}
        />
        <button onClick={sendLink} disabled={busy} className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: LIME }}>
          <Check size={13} color={INK} />
        </button>
      </div>
    );
  }

  if (step === "sent") {
    return <div style={{ fontSize: 11, color: MUTE, ...body }}>✉️ Vérifie ta boîte mail</div>;
  }

  if (step === "pseudo") {
    return (
      <div className="flex items-center gap-2">
        <input
          autoFocus value={pseudoDraft} onChange={(e) => setPseudoDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") savePseudo(); }}
          placeholder="ton pseudo"
          className="rounded-full px-3 py-1.5 outline-none"
          style={{ background: INK2, border: `1px solid ${LIME}55`, color: CHALK, fontSize: 12, width: 120, ...body }}
        />
        <button onClick={savePseudo} disabled={busy} className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: LIME }}>
          <Check size={13} color={INK} />
        </button>
      </div>
    );
  }

  if (!session) {
    return (
      <button
        onClick={() => setStep("email")}
        className="flex items-center gap-1.5 px-3.5 py-2 rounded-full"
        style={{ background: LIME, border: "none", cursor: "pointer" }}
      >
        <User size={13} color={INK} />
        <span style={{ fontSize: 12, color: INK, fontWeight: 700, ...body }}>Se connecter</span>
      </button>
    );
  }

  return (
    <button
      onClick={() => nav("profile")}
      className="flex items-center gap-1.5 px-3.5 py-2 rounded-full"
      style={{ background: INK2, border: "1px solid #FFFFFF18", cursor: "pointer" }}
    >
      <User size={13} color={MUTE} />
      <span style={{ fontSize: 12, color: CHALK, ...body }}>{myPseudo || "…"}</span>
    </button>
  );
}

function HeaderBar({ nav, toast, refreshSignal, onAccountChange }) {
  return (
    <div className="w-full" style={{ borderBottom: "1px solid #FFFFFF0F", background: "#070A10" }}>
      <div className="max-w-2xl mx-auto px-5 py-2.5 flex items-center justify-between gap-3">
        <button onClick={() => nav("home")} className="flex items-center gap-2" style={{ background: "transparent", border: "none", cursor: "pointer" }}>
          <div style={{ ...display, fontSize: 16, color: LIME, letterSpacing: "0.08em" }}>SPRINTLY</div>
        </button>
        <AccountBar nav={nav} toast={toast} refreshSignal={refreshSignal} onAccountChange={onAccountChange} />
      </div>
    </div>
  );
}

function activeNavKey(route) {
  if (route.view === "create") return "creer";
  if (route.view === "profile") return "profil";
  if (route.view === "browse") return route.tab === "drawn" ? "duels" : "defis";
  if (route.view === "duels" || route.view === "duel") return "duels";
  if (route.view === "challenge" || route.view === "join" || route.view === "home") return "defis";
  return null;
}

function BottomNav({ nav, route }) {
  const active = activeNavKey(route);
  const items = [
    { key: "defis", label: "Défis", icon: Flame, onClick: () => nav("browse", { tab: "open" }) },
    { key: "duels", label: "Duels", icon: Swords, onClick: () => nav("browse", { tab: "drawn" }) },
    { key: "creer", label: "Créer", icon: Plus, onClick: () => nav("create") },
    { key: "profil", label: "Profil", icon: User, onClick: () => nav("profile") },
  ];
  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-40"
      style={{ background: "#070A10", borderTop: "1px solid #FFFFFF14", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="max-w-2xl mx-auto w-full flex items-stretch px-2">
        {items.map(({ key, label, icon: Icon, onClick }) => {
          const isActive = active === key;
          return (
            <button
              key={key}
              onClick={onClick}
              className="flex-1 flex flex-col items-center justify-center gap-1 py-2.5"
              style={{ background: "transparent", border: "none", cursor: "pointer" }}
            >
              <Icon size={20} color={isActive ? LIME : MUTE} />
              <span style={{ fontSize: 10, fontWeight: isActive ? 700 : 500, color: isActive ? LIME : MUTE, ...body }}>{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function requirePseudo(pseudo, setToast, openEditor) {
  if (!pseudo) {
    setToast("Connecte-toi d'abord, en haut de l'écran →");
    openEditor?.();
    return false;
  }
  return true;
}

/* ================= PAGES ================= */

function HomePage({ nav, toast }) {
  const [index, setIndex] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setIndex(await api.loadIndex());
    } catch (e) {
      toast(e.message);
      setIndex([]);
    }
  }, [toast]);
  useEffect(() => { refresh(); }, [refresh]);

  if (index === null) return <Loading />;

  const drawn = index.filter((c) => c.status === "drawn");
  const open = index.filter((c) => c.status === "open");
  const closed = index.filter((c) => c.status === "closed");
  const active = [...drawn, ...open].sort((a, b) => b.participantsCount - a.participantsCount);
  const featured = active[0] || null;
  const popular = active.slice(1, 4);

  const NavCard = ({ icon: Icon, title, subtitle, badge, gradient, onClick }) => (
    <button onClick={onClick} className="rounded-3xl p-4 text-left relative overflow-hidden" style={{ background: gradient, border: "1px solid #FFFFFF14", cursor: "pointer", minHeight: 108 }}>
      <Icon size={20} color={CHALK} />
      <div style={{ ...display, fontSize: 18, marginTop: 8 }}>{title}</div>
      <div style={{ fontSize: 11, color: MUTE, marginTop: 2 }}>{subtitle}</div>
      {badge != null && (
        <div className="absolute top-3 right-3 px-2 py-0.5 rounded-full whitespace-nowrap" style={{ background: `${GOLD}22`, border: `1px solid ${GOLD}55`, fontSize: 10, color: GOLD, fontWeight: 700 }}>{badge}</div>
      )}
    </button>
  );

  return (
    <div className="max-w-2xl mx-auto w-full">
      <div className="px-5 pb-2 pt-1" style={{ color: MUTE, fontSize: 13 }}>
        Relève le défi. Affronte quelqu'un. Prouve-le.
      </div>

      {/* À la une */}
      {featured && (
        <div className="px-5 mt-3">
          <div style={{ color: GOLD, fontSize: 11, fontWeight: 700, letterSpacing: "0.08em" }} className="uppercase mb-2">🔥 À la une</div>
          <button
            onClick={() => nav("challenge", { id: featured.id })}
            className="w-full rounded-3xl p-5 text-left relative overflow-hidden"
            style={{ background: `linear-gradient(135deg, ${CORAL}2E, ${INK2} 55%, ${COBALT}2E)`, border: `1px solid ${GOLD}33`, cursor: "pointer" }}
          >
            <div style={{ ...display, fontSize: 30, lineHeight: "0.95" }}>{featured.emoji} {featured.title}</div>
            <div className="flex items-center gap-2 mt-3">
              <Chip color={LIME}><Users size={11} className="inline mr-1" />{featured.participantsCount} participants</Chip>
              <Chip color={featured.status === "drawn" ? GOLD : CHALK}>
                {featured.status === "open" ? fmtDelta(featured.deadline) + " restant" : "duels en cours"}
              </Chip>
            </div>
          </button>
        </div>
      )}

      {/* Hub de navigation, 2x2 */}
      <div className="px-5 mt-6 grid grid-cols-2 gap-3">
        <NavCard icon={Flame} title="Défis" subtitle="Découvrir et participer" gradient={`linear-gradient(135deg, ${CORAL}22, ${INK2})`} onClick={() => nav("browse", { tab: "open" })} />
        <NavCard icon={Swords} title="Duels" subtitle="Voter maintenant" badge={drawn.length > 0 ? `${drawn.length} à voter` : null} gradient={`linear-gradient(135deg, ${GOLD}22, ${INK2})`} onClick={() => nav("browse", { tab: "drawn" })} />
        <NavCard icon={Plus} title="Créer" subtitle="Lance ton défi" gradient={`linear-gradient(135deg, ${LIME}22, ${INK2})`} onClick={() => nav("create")} />
        <NavCard icon={Trophy} title="Résultats" subtitle="Voir les gagnants" gradient={`linear-gradient(135deg, ${COBALT}22, ${INK2})`} onClick={() => nav("halloffame")} />
      </div>

      {/* Défis populaires, aperçu court */}
      {popular.length > 0 && (
        <div className="px-5 mt-6">
          <div className="flex items-center justify-between mb-2">
            <div style={{ color: LIME, fontSize: 11, fontWeight: 700, letterSpacing: "0.08em" }} className="uppercase">Défis populaires</div>
            <button onClick={refresh} style={{ background: "transparent", border: "none", color: MUTE, cursor: "pointer" }}><RefreshCw size={11} /></button>
          </div>
          <div className="flex flex-col gap-2">
            {popular.map((c) => (
              <button key={c.id} onClick={() => nav("challenge", { id: c.id })} className="rounded-2xl p-3 flex items-center justify-between text-left" style={{ background: INK2, border: "1px solid #FFFFFF10", cursor: "pointer" }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{c.emoji} {c.title}</div>
                <div style={{ fontSize: 11, color: MUTE }}>{c.participantsCount} participants</div>
              </button>
            ))}
          </div>
          <button onClick={() => nav("browse", { tab: "open" })} className="w-full text-center mt-2" style={{ fontSize: 12, color: MUTE, background: "transparent", border: "none", cursor: "pointer" }}>
            Voir tous les défis ({open.length + drawn.length}) →
          </button>
        </div>
      )}

      {index.length === 0 && (
        <div className="px-5 mt-6" style={{ fontSize: 13, color: MUTE }}>Aucun défi pour l'instant.</div>
      )}

      {closed.length > 0 && (
        <div className="px-5 mt-6">
          <button onClick={() => nav("browse", { tab: "closed" })} className="w-full flex items-center justify-between" style={{ background: "transparent", border: "none", cursor: "pointer" }}>
            <div style={{ color: MUTE, fontSize: 11, fontWeight: 700, letterSpacing: "0.08em" }} className="uppercase">Historique · Terminés ({closed.length})</div>
            <span style={{ color: MUTE, fontSize: 11 }}>→</span>
          </button>
        </div>
      )}

      <div className="px-5 mt-6">
        <button onClick={() => nav("profile")} className="w-full py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5" style={{ background: "transparent", border: "1px solid #FFFFFF22", color: MUTE, cursor: "pointer" }}>
          <User size={13} /> Mon profil
        </button>
      </div>
    </div>
  );
}

function BrowsePage({ initialTab, nav, toast }) {
  const [index, setIndex] = useState(null);
  const [tab, setTab] = useState(initialTab || "open");

  const refresh = useCallback(async () => {
    try {
      setIndex(await api.loadIndex());
    } catch (e) {
      toast(e.message);
      setIndex([]);
    }
  }, [toast]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { setTab(initialTab || "open"); }, [initialTab]);

  if (index === null) return <Loading />;

  const lists = {
    open: [...index.filter((c) => c.status === "open")].sort((a, b) => a.deadline - b.deadline),
    drawn: index.filter((c) => c.status === "drawn"),
    closed: index.filter((c) => c.status === "closed"),
  };
  const tabs = [
    { key: "open", label: "🔥 Ouverts", color: LIME },
    { key: "drawn", label: "⚔️ Duels", color: GOLD },
    { key: "closed", label: "🏁 Terminés", color: MUTE },
  ];
  const list = lists[tab];

  return (
    <div className="max-w-2xl mx-auto w-full px-5 pb-10">
      <div className="flex gap-2 mb-4">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className="flex-1 py-2 rounded-xl text-xs font-semibold" style={{ background: tab === t.key ? `${t.color}22` : "transparent", border: `1px solid ${tab === t.key ? t.color : "#FFFFFF22"}`, color: tab === t.key ? t.color : MUTE, cursor: "pointer" }}>
            {t.label} ({lists[t.key].length})
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-3">
        {list.length === 0 && <div style={{ fontSize: 13, color: MUTE }}>Rien ici pour l'instant.</div>}
        {list.map((c) => (
          <button
            key={c.id}
            onClick={() => nav("challenge", { id: c.id })}
            className="rounded-3xl p-4 relative overflow-hidden text-left"
            style={{ background: `linear-gradient(135deg, ${CORAL}22, ${INK2} 60%, ${COBALT}22)`, border: `1px solid #FFFFFF14`, cursor: "pointer" }}
          >
            <div style={{ ...display, fontSize: 24, lineHeight: "0.95" }}>{c.emoji} {c.title}</div>
            <div className="flex items-center gap-2 mt-3">
              <Chip color={LIME}><Users size={11} className="inline mr-1" />{c.participantsCount} participants</Chip>
              <Chip color={c.status === "drawn" ? GOLD : CHALK}>
                {c.status === "open" ? fmtDelta(c.deadline) + " restant" : c.status === "drawn" ? "duels en cours" : "clôturé"}
              </Chip>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function CreatePage({ nav, pseudo, toast }) {
  const [title, setTitle] = useState("");
  const [emoji, setEmoji] = useState("🔥");
  const [desc, setDesc] = useState("");
  const [minutes, setMinutes] = useState("30");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!requirePseudo(pseudo, toast)) return;
    if (!title.trim()) { toast("Donne un titre à ton défi."); return; }
    setBusy(true);
    const durationMinutes = Math.max(1, parseInt(minutes || "30", 10));
    let id;
    try {
      const ch = await api.createChallenge({
        emoji: emoji || "🔥",
        title: title.trim().toUpperCase(),
        description: desc.trim(),
        rules: ["Un seul essai visible", "Lien TikTok, Instagram ou YouTube", "Sois fair-play"],
        durationMinutes,
      });
      id = ch.id;
    } catch (e) {
      toast(e.message);
      setBusy(false);
      return;
    }
    setBusy(false);
    toast("Proposition envoyée — en attente de validation");
    // Tant qu'il est "pending", le défi n'est pas visible publiquement
    // (règle de sécurité côté base de données) : on revient à l'accueil.
    nav("home");
  };

  return (
    <div className="max-w-2xl mx-auto w-full px-5 pb-10">
      <div style={{ fontSize: 13, color: MUTE, marginBottom: 16 }}>
        Ta proposition sera examinée par l'équipe Sprintly avant d'apparaître sur le site.
      </div>
      <Field label="Titre du défi">
        <TextInput value={title} onChange={setTitle} placeholder="ex. FREESTYLE CHALLENGE #004" />
      </Field>
      <Field label="Émoji">
        <TextInput value={emoji} onChange={setEmoji} placeholder="🔥" />
      </Field>
      <Field label="Description">
        <TextInput value={desc} onChange={setDesc} placeholder="En quoi consiste le défi ?" />
      </Field>
      <Field label="Durée des inscriptions souhaitée (minutes, une fois validé)">
        <TextInput value={minutes} onChange={setMinutes} placeholder="30" mono />
      </Field>
      <Button icon={Flame} onClick={submit} disabled={busy}>{busy ? "Envoi…" : "Proposer ce défi"}</Button>
    </div>
  );
}

function ChallengePage({ id, nav, pseudo, toast }) {
  const [ch, setCh] = useState(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(async () => {
    try {
      setCh(await api.loadChallenge(id));
    } catch (e) {
      toast(e.message);
    }
  }, [id, toast]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { const t = setInterval(() => setTick((v) => v + 1), 15000); return () => clearInterval(t); }, []);

  if (!ch) return <Loading />;

  const alreadyIn = ch.participants.some((p) => p.pseudo.toLowerCase() === (pseudo || "").toLowerCase());
  const expired = ch.status === "open" && Date.now() >= ch.deadline;

  const isAuthor = pseudo && ch.author && pseudo.toLowerCase() === ch.author.toLowerCase();

  const closeAndDraw = async () => {
    if (!requirePseudo(pseudo, toast)) return;
    if (!isAuthor) { toast("Seul l'auteur du défi peut lancer le tirage."); return; }
    try {
      // Le tirage au sort et la création des duels sont faits de façon
      // atomique côté base de données (fonction draw_challenge), donc
      // aucun risque de collision entre deux clics simultanés.
      await api.drawChallenge(id);
      await refresh();
    } catch (e) {
      toast(e.message);
      await refresh();
    }
  };

  return (
    <div className="max-w-2xl mx-auto w-full px-5 pb-10">
      {ch.status === "pending" && (
        <div className="rounded-2xl p-3 mb-4 flex items-center gap-2" style={{ background: `${GOLD}14`, border: `1px solid ${GOLD}44` }}>
          <Lock size={14} color={GOLD} />
          <div style={{ fontSize: 12, color: CHALK }}>En attente de validation par l'équipe Sprintly — pas encore visible publiquement.</div>
        </div>
      )}
      <div className="rounded-2xl overflow-hidden mb-4 flex items-center justify-center" style={{ background: `linear-gradient(160deg, ${GOLD}33, ${INK2})`, border: `1px solid ${GOLD}44`, height: 130 }}>
        <div style={{ ...display, fontSize: 44 }}>{ch.emoji}</div>
      </div>

      <div style={{ ...display, fontSize: 30 }}>{ch.title}</div>
      <div style={{ fontSize: 12, color: MUTE, marginTop: 2 }}>lancé par {ch.author}</div>
      <div style={{ fontSize: 13, color: MUTE, marginTop: 6, lineHeight: 1.5 }}>{ch.description}</div>

      <div className="mt-4 rounded-2xl p-4" style={{ background: INK2, border: "1px solid #FFFFFF10" }}>
        <div style={{ fontSize: 11, color: LIME, fontWeight: 700, letterSpacing: "0.06em" }} className="uppercase mb-2">Règles</div>
        {ch.rules.map((r, i) => (
          <div key={i} className="flex items-start gap-2 mb-1.5">
            <Check size={14} color={LIME} style={{ marginTop: 2, flexShrink: 0 }} />
            <div style={{ fontSize: 13 }}>{r}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-3 mt-4">
        <div className="flex-1 rounded-2xl p-3 text-center" style={{ background: INK2, border: "1px solid #FFFFFF10" }}>
          <div style={{ ...mono, fontSize: 20, color: CHALK }}>{ch.participants.length}</div>
          <div style={{ fontSize: 10, color: MUTE }} className="uppercase">participants</div>
        </div>
        <div className="flex-1 rounded-2xl p-3 text-center" style={{ background: INK2, border: "1px solid #FFFFFF10" }}>
          <div style={{ ...mono, fontSize: 20, color: ch.status === "open" ? LIME : MUTE }}>
            {ch.status === "open" ? fmtDelta(ch.deadline) : ch.status === "drawn" ? `${Math.ceil(ch.duels.length)} duels` : "terminé"}
          </div>
          <div style={{ fontSize: 10, color: MUTE }} className="uppercase">{ch.status === "open" ? "avant clôture" : "statut"}</div>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-3">
        {ch.status === "open" && !expired && !alreadyIn && (
          <Button onClick={() => nav("join", { id })}>Participer</Button>
        )}
        {ch.status === "open" && alreadyIn && (
          <div className="rounded-2xl p-3 text-center" style={{ background: `${LIME}14`, border: `1px solid ${LIME}44`, fontSize: 13, color: LIME }}>
            ✓ Tu es inscrit à ce défi
          </div>
        )}
        {ch.status === "open" && expired && (
          <Button icon={Dices} variant="gold" onClick={closeAndDraw} disabled={ch.participants.length < 2}>
            {ch.participants.length < 2 ? "Pas assez de participants" : isAuthor ? "Clore les inscriptions et tirer les duels" : `Seul ${ch.author} peut lancer le tirage`}
          </Button>
        )}
        {(ch.status === "drawn" || ch.status === "closed") && (
          <Button icon={Swords} onClick={() => nav("duels", { id })}>Voir les duels</Button>
        )}
      </div>
    </div>
  );
}

const PENDING_JOIN_KEY = "sprintly_pending_join";

function JoinPage({ id, nav, toast, onPseudoMayHaveChanged }) {
  const [link, setLink] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("form"); // "form" | "email" | "sent"
  const [myPseudo, setMyPseudo] = useState(null);

  useEffect(() => {
    api.getMyPseudo().then((p) => { if (p) { setMyPseudo(p); setName(p); } });
  }, []);

  const doJoin = async () => {
    setBusy(true);
    try {
      await api.joinChallenge(id, name.trim(), link.trim());
      localStorage.removeItem(PENDING_JOIN_KEY);
      toast("Participation envoyée 🎉");
      onPseudoMayHaveChanged?.();
      nav("challenge", { id });
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!link.trim() || !name.trim()) { toast("Ajoute ton lien vidéo et ton pseudo."); return; }
    if (!confirm) { toast("Confirme que la vidéo est la tienne."); return; }
    const session = await api.getSession();
    if (session) { await doJoin(); return; }
    // Pas encore connecté : on garde le formulaire de côté et on ne demande
    // l'email qu'à cette dernière étape, pour ne perdre personne en route.
    localStorage.setItem(PENDING_JOIN_KEY, JSON.stringify({ id, name: name.trim(), link: link.trim() }));
    setStep("email");
  };

  const sendLink = async () => {
    if (!email.trim() || !email.includes("@")) { toast("Ajoute une adresse email valide."); return; }
    setBusy(true);
    try {
      await api.sendMagicLink(email.trim());
      setStep("sent");
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (step === "sent") {
    return (
      <div className="max-w-2xl mx-auto w-full px-5 pb-10 text-center">
        <div style={{ fontSize: 44, marginBottom: 12 }}>✉️</div>
        <div style={{ ...display, fontSize: 22, marginBottom: 8 }}>VÉRIFIE TA BOÎTE MAIL</div>
        <div style={{ fontSize: 13, color: MUTE, lineHeight: 1.5 }}>
          On t'a envoyé un lien à <span style={{ color: CHALK }}>{email}</span>. Clique dessus,
          tu reviens ici et ta participation part automatiquement — pas besoin de tout retaper.
        </div>
      </div>
    );
  }

  if (step === "email") {
    return (
      <div className="max-w-2xl mx-auto w-full px-5 pb-10">
        <button onClick={() => setStep("form")} className="flex items-center gap-2 mb-5" style={{ background: "transparent", border: "none", color: MUTE, cursor: "pointer", fontSize: 12 }}>
          <ArrowLeft size={14} /> Retour
        </button>
        <div style={{ ...display, fontSize: 22, marginBottom: 8 }}>DERNIÈRE ÉTAPE</div>
        <div style={{ fontSize: 13, color: MUTE, marginBottom: 20, lineHeight: 1.5 }}>
          Ton email sert juste à retrouver tes défis et tes vidéos plus tard. Pas de mot de passe.
        </div>
        <Field label="Ton email">
          <TextInput value={email} onChange={setEmail} placeholder="toi@email.com" mono />
        </Field>
        <Button onClick={sendLink} disabled={busy}>{busy ? "Envoi…" : "Recevoir mon lien de connexion"}</Button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto w-full px-5 pb-10">
      <div style={{ fontSize: 13, color: MUTE, marginBottom: 20 }}>30 secondes. Colle simplement ton lien.</div>
      <Field label="Lien de ta vidéo">
        <TextInput value={link} onChange={setLink} placeholder="tiktok.com/@toi/video/..." mono />
      </Field>
      <Field label="Ton pseudo">
        <TextInput value={name} onChange={setName} placeholder="ton pseudo" disabled={!!myPseudo} />
      </Field>
      <button onClick={() => setConfirm((v) => !v)} className="flex items-start gap-2 mb-5 text-left" style={{ background: "transparent", border: "none", cursor: "pointer" }}>
        <div className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: confirm ? LIME : "transparent", border: `1px solid ${confirm ? LIME : "#FFFFFF44"}` }}>
          {confirm && <Check size={13} color={INK} />}
        </div>
        <div style={{ fontSize: 12, color: MUTE, lineHeight: 1.4 }}>Je confirme que cette vidéo est la mienne et respecte le règlement du défi.</div>
      </button>
      <Button onClick={submit} disabled={busy}>{busy ? "Envoi…" : "Envoyer ma participation"}</Button>
    </div>
  );
}

function DuelsListPage({ id, nav, pseudo }) {
  const [ch, setCh] = useState(null);
  useEffect(() => { api.loadChallenge(id).then(setCh); }, [id]);
  if (!ch) return <Loading />;
  const pad = (n) => String(n).padStart(2, "0");

  return (
    <div className="max-w-2xl mx-auto w-full px-5 pb-10">
      <div style={{ fontSize: 13, color: MUTE }}>{ch.title}</div>
      <div style={{ fontSize: 12, color: MUTE, marginBottom: 14 }}>{ch.participants.length} participants · {ch.duels.length} duels</div>
      <div className="flex flex-col gap-2">
        {ch.duels.map((d) => {
          const isMine = pseudo && (d.a?.pseudo === pseudo || d.b?.pseudo === pseudo);
          return (
            <button key={d.id} onClick={() => nav("duel", { id, duelId: d.id })} className="rounded-2xl p-3 flex items-center justify-between text-left" style={{ background: INK2, border: isMine ? `1px solid ${LIME}66` : "1px solid #FFFFFF10", cursor: "pointer" }}>
              <div>
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span style={{ fontSize: 10, color: MUTE }} className="uppercase">Duel #{pad(d.no)}</span>
                  {isMine && <Chip color={LIME}>ton duel</Chip>}
                  {d.closed && <Chip color={GOLD}>clôturé</Chip>}
                </div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>
                  {d.a?.pseudo || "—"} <span style={{ color: MUTE, fontWeight: 400 }}>🆚</span> {d.b?.pseudo || "bye"}
                </div>
              </div>
              <div style={{ fontSize: 12, color: LIME, fontWeight: 600 }}>{d.closed ? "Voir →" : "Voter →"}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DuelPage({ id, duelId, nav, pseudo, toast }) {
  const [ch, setCh] = useState(null);
  const [voted, setVoted] = useState(false);
  const [chosenSide, setChosenSide] = useState(null);
  const [now, setNow] = useState(Date.now());
  const refresh = useCallback(async () => {
    try {
      setCh(await api.loadChallenge(id));
    } catch (e) {
      toast(e.message);
    }
  }, [id, toast]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    api.hasVoted(duelId).then(setVoted);
  }, [duelId]);
  // horloge en direct pour le temps restant avant clôture
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!ch) return <Loading />;
  const duel = ch.duels.find((d) => d.id === duelId);
  if (!duel) return <div className="px-5" style={{ color: MUTE }}>Duel introuvable.</div>;

  const hasVoted = voted;
  const isParticipant = pseudo && (duel.a?.pseudo === pseudo || duel.b?.pseudo === pseudo);

  const vote = async (side) => {
    if (isParticipant) { toast("Tu ne peux pas voter sur ton propre duel."); return; }
    if (hasVoted) { toast("Tu as déjà voté sur ce duel."); return; }
    if (duel.closed) { toast("Ce duel est clôturé."); return; }
    try {
      await api.castVote(duel.id, side);
      setVoted(true);
      setChosenSide(side);
      await refresh();
      toast("Vote enregistré ✓");
    } catch (e) {
      toast(e.message);
    }
  };

  const closeDuel = async () => {
    try {
      await api.closeDuel(duel.id);
      await refresh();
      toast("Duel clôturé — trophée attribué 🏆");
    } catch (e) {
      toast(e.message);
    }
  };

  const total = duel.votesA + duel.votesB;
  const pctA = total ? Math.round((duel.votesA / total) * 100) : 50;
  const pctB = 100 - pctA;
  const showResult = duel.closed;

  const shareDuel = async () => {
    const url = window.location.href;
    const title = `⚔️ ${duel.a?.pseudo || "?"} VS ${duel.b?.pseudo || "?"} — vote sur Sprintly !`;
    try {
      if (navigator.share) {
        await navigator.share({ title, text: title, url });
      } else {
        await navigator.clipboard.writeText(url);
        toast("Lien copié ! Envoie-le à tes potes 🔥");
      }
    } catch (e) {
      // partage annulé par l'utilisateur, on ne fait rien
    }
  };

  const ShareButton = ({ label }) => (
    <button onClick={shareDuel} className="w-full py-3 rounded-2xl font-bold flex items-center justify-center gap-2" style={{ background: `${LIME}18`, border: `1px solid ${LIME}55`, color: LIME, cursor: "pointer" }}>
      <Share2 size={16} /> {label}
    </button>
  );

  return (
    <div className="max-w-2xl mx-auto w-full px-5 pb-10">
      <div className="flex items-center justify-between mb-3">
        <div style={{ ...display, fontSize: 20 }}>⚔️ {(duel.a?.pseudo || "?").toUpperCase()} VS {(duel.b?.pseudo || "BYE").toUpperCase()}</div>
        <Chip color={CORAL}>Duel #{String(duel.no).padStart(2, "0")}</Chip>
      </div>

      {/* Priorité absolue : si tu es dans ce duel, on te pousse à le partager pour récupérer des votes */}
      {isParticipant && !duel.closed && duel.b && (
        <div className="rounded-2xl p-3 mb-3" style={{ background: `${LIME}12`, border: `1px solid ${LIME}44` }}>
          <div style={{ fontSize: 12, color: LIME, fontWeight: 700, marginBottom: 8 }}>⚡ C'est ton duel ! Fais voter tes potes</div>
          <ShareButton label="Partager mon duel" />
        </div>
      )}

      <div className="flex flex-col gap-3">
        <VideoCard side="A" name={duel.a?.pseudo || "?"} link={duel.a?.videoLink} />
        <div className="flex items-center justify-center -my-1">
          <div className="px-3 py-1 rounded-full" style={{ ...display, fontSize: 14, background: INK2, border: `1px solid ${GOLD}55`, color: GOLD }}>VS</div>
        </div>
        {duel.b ? <VideoCard side="B" name={duel.b.pseudo} link={duel.b.videoLink} /> : (
          <div className="rounded-2xl p-4 text-center" style={{ background: INK2, border: "1px solid #FFFFFF10", color: MUTE, fontSize: 13 }}>Pas d'adversaire — victoire automatique (nombre impair de participants).</div>
        )}
      </div>

      {duel.b && (
        <>
          {/* Compteur de votes + temps restant, toujours visibles */}
          <div className="flex items-center justify-center gap-3 mt-4" style={{ fontSize: 12, color: MUTE }}>
            <span>🗳️ {total} vote{total !== 1 ? "s" : ""}</span>
            {!duel.closed && duel.closesAt && (
              <>
                <span style={{ color: `${CHALK}33` }}>·</span>
                <span>⏱️ {fmtDelta(duel.closesAt)} restant</span>
              </>
            )}
          </div>

          {/* Barre de progression A/B en direct, dès qu'il y a des votes */}
          {total > 0 && (
            <div className="mt-2">
              <div className="w-full h-2 rounded-full overflow-hidden flex" style={{ background: INK2 }}>
                <div style={{ width: `${pctA}%`, background: CORAL }} />
                <div style={{ width: `${pctB}%`, background: COBALT }} />
              </div>
              <div className="flex items-center justify-between mt-1" style={{ fontSize: 11, color: MUTE }}>
                <span>{duel.a.pseudo} {pctA}%</span>
                <span>{pctB}% {duel.b.pseudo}</span>
              </div>
            </div>
          )}

          {showResult ? (
            <div className="rounded-2xl p-4 mt-4 text-center" style={{ background: `${GOLD}14`, border: `1px solid ${GOLD}44` }}>
              <div style={{ fontSize: 12, color: MUTE }}>Vainqueur du duel</div>
              <div style={{ ...display, fontSize: 26, color: GOLD, marginTop: 2 }}>{(duel.winner === "A" ? duel.a.pseudo : duel.b.pseudo).toUpperCase()} GAGNE</div>
              <div style={{ fontSize: 11, color: MUTE, marginTop: 6 }}>{total} votes au total</div>
              <div className="mt-4"><ShareButton label="Partager ce duel" /></div>
            </div>
          ) : (
            <div className="mt-4 flex flex-col gap-3">
              <div className="flex gap-3">
                <button onClick={() => vote("A")} disabled={hasVoted || isParticipant} className="flex-1 py-3 rounded-2xl font-bold" style={{ background: `${CORAL}22`, border: `1px solid ${CORAL}66`, color: CHALK, opacity: hasVoted || isParticipant ? 0.5 : 1, cursor: hasVoted || isParticipant ? "not-allowed" : "pointer" }}>Voter {duel.a.pseudo}</button>
                <button onClick={() => vote("B")} disabled={hasVoted || isParticipant} className="flex-1 py-3 rounded-2xl font-bold" style={{ background: `${COBALT}22`, border: `1px solid ${COBALT}66`, color: CHALK, opacity: hasVoted || isParticipant ? 0.5 : 1, cursor: hasVoted || isParticipant ? "not-allowed" : "pointer" }}>Voter {duel.b.pseudo}</button>
              </div>
              {hasVoted && (
                <>
                  <div style={{ fontSize: 12, color: LIME, textAlign: "center" }}>
                    ✓ {chosenSide ? `Tu as voté pour ${chosenSide === "A" ? duel.a.pseudo : duel.b.pseudo}` : "Tu as déjà voté sur ce duel"}
                  </div>
                  <ShareButton label="Partager ce duel" />
                </>
              )}
              {isParticipant && <div style={{ fontSize: 12, color: MUTE, textAlign: "center" }}>Tu es dans ce duel, tu ne peux pas voter</div>}
              {!isParticipant && !hasVoted && <ShareButton label="📤 Partager ce duel" />}
              <button onClick={closeDuel} className="text-center" style={{ fontSize: 12, color: MUTE, background: "transparent", border: "none", cursor: "pointer", textDecoration: "underline" }}>Clore ce duel maintenant</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ProfilePage({ pseudo, nav, toast }) {
  const [name, setName] = useState(pseudo || "");
  const [user, setUser] = useState(undefined);
  const [stats, setStats] = useState(null);
  const [participations, setParticipations] = useState([]);
  const [isMe, setIsMe] = useState(false);

  const search = useCallback(async (p) => {
    if (!p) return;
    setUser(await api.loadUser(p));
    setStats(await api.loadUserStats(p));
    setParticipations(await api.loadMyParticipations(p));
  }, []);

  // À l'arrivée sur la page, si un compte est connecté, on affiche direct
  // son activité (défis, vidéos, trophées) sans qu'il ait à taper son pseudo.
  useEffect(() => {
    (async () => {
      const myPseudo = await api.getMyPseudo();
      if (myPseudo) {
        setName(myPseudo);
        setIsMe(true);
        search(myPseudo);
      } else if (pseudo) {
        search(pseudo);
      }
    })();
  }, [pseudo, search]);

  return (
    <div className="max-w-2xl mx-auto w-full px-5 pb-10">
      <Field label={isMe ? "Mon activité" : "Voir le profil de"}>
        <div className="flex gap-2">
          <div className="flex-1"><TextInput value={name} onChange={(v) => { setName(v); setIsMe(false); }} placeholder="pseudo" /></div>
          <button onClick={() => search(name)} className="px-4 rounded-2xl" style={{ background: LIME, border: "none", cursor: "pointer" }}><User size={16} color={INK} /></button>
        </div>
      </Field>

      {user === undefined ? null : user === null ? (
        <div style={{ fontSize: 13, color: MUTE }}>Aucun profil trouvé pour "{name}".</div>
      ) : (
        <>
          <div className="flex items-center gap-3 mb-5">
            <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: `${COBALT}33`, border: `1px solid ${COBALT}` }}>
              <User size={22} color={CHALK} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{user.pseudo}</div>
              <div style={{ fontSize: 11, color: MUTE }}>{user.trophies.length} trophée{user.trophies.length > 1 ? "s" : ""}</div>
            </div>
          </div>
          {isMe && (
            <button
              onClick={async () => { await api.signOut(); toast("Déconnecté."); setUser(undefined); setName(""); setIsMe(false); }}
              className="mb-5"
              style={{ fontSize: 12, color: MUTE, background: "transparent", border: "none", cursor: "pointer", textDecoration: "underline" }}
            >
              Se déconnecter
            </button>
          )}
          {stats && stats.duelsPlayed > 0 && (
            <div className="flex gap-2 mb-5">
              <div className="flex-1 rounded-2xl p-3 text-center" style={{ background: INK2, border: "1px solid #FFFFFF10" }}>
                <div style={{ ...display, fontSize: 20, color: GOLD }}>{user.trophies.length}</div>
                <div style={{ fontSize: 10, color: MUTE }}>trophée{user.trophies.length > 1 ? "s" : ""}</div>
              </div>
              <div className="flex-1 rounded-2xl p-3 text-center" style={{ background: INK2, border: "1px solid #FFFFFF10" }}>
                <div style={{ ...display, fontSize: 20, color: CHALK }}>{stats.duelsPlayed}</div>
                <div style={{ fontSize: 10, color: MUTE }}>duel{stats.duelsPlayed > 1 ? "s" : ""}</div>
              </div>
              <div className="flex-1 rounded-2xl p-3 text-center" style={{ background: INK2, border: "1px solid #FFFFFF10" }}>
                <div style={{ ...display, fontSize: 20, color: LIME }}>{stats.winPct}%</div>
                <div style={{ fontSize: 10, color: MUTE }}>victoires</div>
              </div>
            </div>
          )}
          <div style={{ fontSize: 11, color: MUTE, fontWeight: 700 }} className="uppercase mb-2">Mes participations</div>
          <div className="flex flex-col gap-2 mb-5">
            {participations.length === 0 && <div style={{ fontSize: 13, color: MUTE }}>Tu n'as encore rejoint aucun défi.</div>}
            {participations.map((p, i) => (
              <button
                key={i}
                onClick={() => nav("challenge", { id: p.challengeId })}
                className="rounded-2xl p-3 flex items-center justify-between text-left"
                style={{ background: INK2, border: "1px solid #FFFFFF10", cursor: "pointer" }}
              >
                <div style={{ fontSize: 13, fontWeight: 600 }}>{p.emoji} {p.title}</div>
                <Chip color={p.status === "open" ? LIME : p.status === "drawn" ? GOLD : MUTE}>
                  {p.status === "open" ? "ouvert" : p.status === "drawn" ? "duels en cours" : "terminé"}
                </Chip>
              </button>
            ))}
          </div>

          <div style={{ fontSize: 11, color: MUTE, fontWeight: 700 }} className="uppercase mb-2">Collection de trophées</div>
          <div className="flex flex-col gap-2">
            {user.trophies.length === 0 && <div style={{ fontSize: 13, color: MUTE }}>Pas encore de trophée.</div>}
            {[...user.trophies].reverse().map((t, i) => (
              <div key={i} className="rounded-2xl p-3 flex items-center gap-3" style={{ background: i === 0 ? `${GOLD}14` : INK2, border: i === 0 ? `1px solid ${GOLD}55` : "1px solid #FFFFFF10" }}>
                <Trophy size={18} color={i === 0 ? GOLD : `${GOLD}88`} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>🏆 Victoire — {t.challengeTitle}</div>
                  <div style={{ fontSize: 10, color: MUTE }}>Duel remporté</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function HallOfFamePage({ nav }) {
  const PAGE_SIZE = 5;
  const [query, setQuery] = useState("");
  const [items, setItems] = useState(null); // null = chargement, [] = vide, undefined = erreur
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [winners, setWinners] = useState(null); // null = chargement, [] = vide/erreur

  useEffect(() => {
    api.loadRecentWinners({ limit: 8 }).then(setWinners).catch(() => setWinners([]));
  }, []);

  const fetchPage = useCallback(async (q, off, replace) => {
    try {
      const results = await api.searchClosedChallenges({ query: q, limit: PAGE_SIZE, offset: off });
      setHasMore(results.length === PAGE_SIZE);
      setItems((prev) => (replace ? results : [...(prev || []), ...results]));
    } catch (e) {
      setItems(undefined); // état d'erreur explicite, distinct du "vide"
    }
  }, []);

  // Nouvelle recherche (ou arrivée sur la page) : on repart de zéro.
  useEffect(() => {
    setItems(null);
    setOffset(0);
    fetchPage(query, 0, true);
  }, [query, fetchPage]);

  const loadMore = async () => {
    setLoadingMore(true);
    const nextOffset = offset + PAGE_SIZE;
    await fetchPage(query, nextOffset, false);
    setOffset(nextOffset);
    setLoadingMore(false);
  };

  return (
    <div className="max-w-2xl mx-auto w-full px-5 pb-10 flex flex-col gap-3">
      <div className="rounded-2xl flex items-center gap-2 px-3.5" style={{ background: INK2, border: "1px solid #FFFFFF14", height: 42 }}>
        <Search size={15} color={MUTE} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Chercher un défi ou un pseudo…"
          className="flex-1 bg-transparent outline-none"
          style={{ color: CHALK, fontSize: 13, ...body }}
        />
      </div>

      {winners && winners.length > 0 && (
        <div>
          <div style={{ fontSize: 11, color: MUTE, fontWeight: 700, letterSpacing: "0.08em" }} className="uppercase mb-2">Derniers gagnants</div>
          <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
            {winners.map((w) => (
              <button
                key={w.duelId}
                onClick={() => nav("challenge", { id: w.challengeId })}
                className="flex items-center gap-1.5 px-3 py-2 rounded-full flex-shrink-0"
                style={{ background: `${GOLD}14`, border: `1px solid ${GOLD}44`, cursor: "pointer" }}
              >
                <Trophy size={12} color={GOLD} />
                <span style={{ fontSize: 12, fontWeight: 700, color: CHALK, ...body }}>{w.pseudo}</span>
                <span style={{ fontSize: 14 }}>{w.challengeEmoji}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {items === null && <Loading />}

      {items === undefined && (
        <div style={{ fontSize: 13, color: MUTE }}>Le chargement des résultats a échoué. Réessaie dans un instant.</div>
      )}

      {items !== null && items !== undefined && items.length === 0 && (
        <div style={{ fontSize: 13, color: MUTE }}>
          {query ? "Aucun résultat pour cette recherche." : "Aucun défi terminé pour l'instant."}
        </div>
      )}

      {items !== null && items !== undefined && items.map((c) => (
        <div key={c.id} className="rounded-2xl p-4" style={{ background: `linear-gradient(120deg, ${GOLD}1A, ${INK2})`, border: `1px solid ${GOLD}44` }}>
          <div style={{ fontSize: 10, color: MUTE }} className="uppercase mb-1">{c.emoji} {c.title}</div>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10 }}>{c.participantsCount} participants · {c.duelsCount} duels</div>
          <button
            onClick={() => nav("challenge", { id: c.id })}
            className="flex items-center gap-1.5"
            style={{ background: "transparent", border: "none", cursor: "pointer", color: GOLD, fontSize: 12, fontWeight: 700 }}
          >
            <Trophy size={13} /> Voir tous les gagnants →
          </button>
        </div>
      ))}

      {items !== null && items !== undefined && items.length > 0 && hasMore && (
        <button
          onClick={loadMore}
          disabled={loadingMore}
          className="w-full flex items-center justify-center gap-1.5 py-2.5"
          style={{ background: "transparent", border: "none", cursor: loadingMore ? "not-allowed" : "pointer", color: MUTE, fontSize: 12, opacity: loadingMore ? 0.5 : 1 }}
        >
          {loadingMore ? "Chargement…" : `Voir ${PAGE_SIZE} de plus`} <ChevronDown size={14} />
        </button>
      )}
    </div>
  );
}

function Loading() {
  return <div className="px-5 py-10 text-center" style={{ color: MUTE, fontSize: 13 }}><RefreshCw size={16} className="animate-spin inline mr-2" />Chargement…</div>;
}

/* ================= APP SHELL / ROUTER ================= */

/* ---------------------------------------------------------
   ADMIN — espace séparé, hors navigation publique.
   Accessible uniquement via l'URL #/admin. L'accès est protégé
   par une vraie authentification Supabase (email + mot de passe) ;
   les actions d'administration (valider, refuser, supprimer,
   forcer un tirage) sont elles-mêmes vérifiées côté base de
   données (RLS + fonctions RPC), pas seulement côté écran.
--------------------------------------------------------- */

function AdminGate({ onUnlock }) {
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const session = await api.getAdminSession();
      if (session) onUnlock();
      setChecking(false);
    })();
  }, [onUnlock]);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await api.signInAdmin(email.trim(), password);
      const session = await api.getAdminSession();
      if (session) onUnlock();
      else setError("Ce compte n'a pas les droits administrateur.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (checking) return <Loading />;

  return (
    <div className="min-h-screen w-full flex items-center justify-center px-6" style={{ background: INK, color: CHALK, ...body }}>
      <style>{FONTS}</style>
      <div className="w-full max-w-sm">
        <div style={{ ...display, fontSize: 26, color: GOLD }} className="mb-1">SPRINTLY ADMIN</div>
        <div style={{ fontSize: 13, color: MUTE }} className="mb-5">Espace réservé — connecte-toi avec ton compte administrateur.</div>
        <div className="mb-3"><TextInput value={email} onChange={setEmail} placeholder="email" /></div>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="mot de passe"
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          className="w-full rounded-2xl px-4 py-3.5 outline-none"
          style={{ background: INK2, border: `1px solid #FFFFFF18`, color: CHALK, fontSize: 14, ...body }}
        />
        {error && <div style={{ fontSize: 12, color: CORAL, marginTop: 8 }}>{error}</div>}
        <div className="mt-4"><Button variant="gold" onClick={submit} disabled={busy}>{busy ? "Connexion…" : "Entrer"}</Button></div>
      </div>
    </div>
  );
}

function AdminDashboard() {
  const [index, setIndex] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const refresh = useCallback(async () => setIndex(await api.adminListChallenges()), []);
  useEffect(() => { refresh(); }, [refresh]);

  if (index === null) return <Loading />;

  const pending = index.filter((c) => c.status === "pending");
  const live = index.filter((c) => c.status === "open" || c.status === "drawn");
  const closed = index.filter((c) => c.status === "closed");

  const approve = async (id) => {
    setBusyId(id);
    try {
      await api.approveChallenge(id);
    } catch (e) {
      alert(e.message);
    }
    await refresh();
    setBusyId(null);
  };

  const reject = async (id) => {
    setBusyId(id);
    try {
      await api.rejectChallenge(id);
    } catch (e) {
      alert(e.message);
    }
    await refresh();
    setBusyId(null);
  };

  const forceDraw = async (id) => {
    setBusyId(id);
    try {
      await api.drawChallenge(id, null); // admin : contourne la vérification d'auteur/deadline
    } catch (e) {
      alert(e.message);
    }
    await refresh();
    setBusyId(null);
  };

  const remove = async (id) => {
    setBusyId(id);
    try {
      await api.adminDeleteChallenge(id);
    } catch (e) {
      alert(e.message);
    }
    await refresh();
    setBusyId(null);
  };

  const Row = ({ c, actions }) => (
    <div className="rounded-2xl p-3 flex items-center justify-between gap-3" style={{ background: INK2, border: "1px solid #FFFFFF10" }}>
      <div className="min-w-0">
        <div style={{ fontSize: 13, fontWeight: 700 }} className="truncate">{c.emoji} {c.title}</div>
        <div style={{ fontSize: 11, color: MUTE }}>{c.participantsCount} participants{c.deadline ? ` · ${fmtDelta(c.deadline)}` : ""}</div>
      </div>
      <div className="flex gap-1.5 flex-shrink-0">{actions}</div>
    </div>
  );

  const ActionBtn = ({ onClick, color, children }) => (
    <button onClick={onClick} disabled={busyId === null ? false : true} className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold" style={{ background: `${color}1A`, border: `1px solid ${color}55`, color, cursor: "pointer" }}>
      {children}
    </button>
  );

  return (
    <div className="max-w-2xl mx-auto w-full px-5 pb-16 pt-6">
      <div className="flex items-center justify-between mb-1">
        <div style={{ ...display, fontSize: 26, color: GOLD }}>SPRINTLY ADMIN</div>
        <button onClick={() => api.signOutAdmin().then(() => window.location.reload())} style={{ fontSize: 12, color: MUTE, background: "transparent", border: "none", cursor: "pointer", textDecoration: "underline" }}>Déconnexion</button>
      </div>
      <div style={{ fontSize: 13, color: MUTE }} className="mb-6">Tableau de bord — validation et gestion des défis.</div>

      <div className="mb-8">
        <div style={{ fontSize: 11, color: GOLD, fontWeight: 700 }} className="uppercase mb-2">En attente de validation ({pending.length})</div>
        <div className="flex flex-col gap-2">
          {pending.length === 0 && <div style={{ fontSize: 13, color: MUTE }}>Rien à valider.</div>}
          {pending.map((c) => (
            <Row key={c.id} c={c} actions={<>
              <ActionBtn color={LIME} onClick={() => approve(c.id)}>Publier</ActionBtn>
              <ActionBtn color={CORAL} onClick={() => reject(c.id)}>Refuser</ActionBtn>
            </>} />
          ))}
        </div>
      </div>

      <div className="mb-8">
        <div style={{ fontSize: 11, color: LIME, fontWeight: 700 }} className="uppercase mb-2">En cours ({live.length})</div>
        <div className="flex flex-col gap-2">
          {live.length === 0 && <div style={{ fontSize: 13, color: MUTE }}>Aucun défi en cours.</div>}
          {live.map((c) => (
            <Row key={c.id} c={c} actions={<>
              {c.status === "open" && <ActionBtn color={GOLD} onClick={() => forceDraw(c.id)}>Forcer le tirage</ActionBtn>}
              <ActionBtn color={CORAL} onClick={() => remove(c.id)}>Supprimer</ActionBtn>
            </>} />
          ))}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 11, color: MUTE, fontWeight: 700 }} className="uppercase mb-2">Terminés ({closed.length})</div>
        <div className="flex flex-col gap-2">
          {closed.map((c) => <Row key={c.id} c={c} actions={<ActionBtn color={CORAL} onClick={() => remove(c.id)}>Supprimer</ActionBtn>} />)}
        </div>
      </div>
    </div>
  );
}

function AdminPage() {
  const [unlocked, setUnlocked] = useState(false);
  if (!unlocked) return <AdminGate onUnlock={() => setUnlocked(true)} />;
  return (
    <div className="min-h-screen w-full" style={{ background: INK, color: CHALK, ...body }}>
      <style>{FONTS}</style>
      <AdminDashboard />
    </div>
  );
}


function parseHash() {
  const h = window.location.hash.replace(/^#\/?/, "");
  const parts = h.split("/").filter(Boolean);
  if (parts.length === 0) return { view: "home" };
  if (parts[0] === "create") return { view: "create" };
  if (parts[0] === "admin") return { view: "admin" };
  if (parts[0] === "profile") return { view: "profile" };
  if (parts[0] === "halloffame") return { view: "halloffame" };
  if (parts[0] === "browse") return { view: "browse", tab: parts[1] || "open" };
  if (parts[0] === "challenge" && parts[1]) {
    if (parts[2] === "join") return { view: "join", id: parts[1] };
    if (parts[2] === "duels") return { view: "duels", id: parts[1] };
    if (parts[2] === "duel" && parts[3]) return { view: "duel", id: parts[1], duelId: parts[3] };
    return { view: "challenge", id: parts[1] };
  }
  return { view: "home" };
}
function routeToHash(view, params = {}) {
  if (view === "home") return "#/";
  if (view === "create") return "#/create";
  if (view === "profile") return "#/profile";
  if (view === "halloffame") return "#/halloffame";
  if (view === "browse") return `#/browse/${params.tab || "open"}`;
  if (view === "challenge") return `#/challenge/${params.id}`;
  if (view === "join") return `#/challenge/${params.id}/join`;
  if (view === "duels") return `#/challenge/${params.id}/duels`;
  if (view === "duel") return `#/challenge/${params.id}/duel/${params.duelId}`;
  return "#/";
}

export default function SprintlyApp() {
  const [route, setRoute] = useState(() => (typeof window !== "undefined" ? parseHash() : { view: "home" }));
  const [pseudo, setPseudoState] = useState(null); // pseudo lié au compte connecté, ou null
  const [toastMsg, setToastMsg] = useState(null);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const bumpRefresh = () => setRefreshSignal((n) => n + 1);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const nav = (view, params) => { window.location.hash = routeToHash(view, params); };
  const toast = (msg) => setToastMsg(msg);

  // Le pseudo utilisé partout dans l'app (créer un défi, lancer un tirage,
  // voir "c'est mon duel") suit désormais le compte réellement connecté.
  useEffect(() => {
    const sync = () => api.getMyPseudo().then(setPseudoState).catch(() => setPseudoState(null));
    sync();
    return api.onAuthStateChange(sync);
  }, [refreshSignal]);

  // Après un clic sur le lien magique reçu par email, l'utilisateur revient
  // ici déjà connecté : on termine automatiquement l'envoi de sa vidéo,
  // sans qu'il ait à retaper quoi que ce soit.
  useEffect(() => {
    return api.onAuthStateChange(async (session) => {
      if (!session) return;
      const raw = localStorage.getItem(PENDING_JOIN_KEY);
      if (!raw) return;
      try {
        const pending = JSON.parse(raw);
        await api.joinChallenge(pending.id, pending.name, pending.link);
        localStorage.removeItem(PENDING_JOIN_KEY);
        toast("Participation envoyée 🎉");
        bumpRefresh();
        nav("challenge", { id: pending.id });
      } catch (e) {
        localStorage.removeItem(PENDING_JOIN_KEY);
        toast(e.message);
      }
    });
  }, []);

  if (route.view === "admin") return <AdminPage />;

  const titleFor = () => {
    switch (route.view) {
      case "home": return null;
      case "create": return "PROPOSER UN DÉFI";
      case "challenge": return null;
      case "join": return "PARTICIPER";
      case "duels": return "⚔️ LES DUELS";
      case "duel": return null;
      case "profile": return "PROFIL";
      case "halloffame": return "RÉSULTATS";
      case "browse": return "DÉFIS";
      default: return null;
    }
  };
  const canBack = route.view !== "home";
  const backTo = () => {
    if (route.view === "join" || route.view === "duels") return () => nav("challenge", { id: route.id });
    if (route.view === "duel") return () => nav("duels", { id: route.id });
    if (route.view === "challenge") return () => nav("home");
    return () => nav("home");
  };

  return (
    <div className="w-full flex flex-col" style={{ minHeight: "100dvh", background: INK, color: CHALK, ...body }}>
      <style>{FONTS}</style>
      <HeaderBar nav={nav} toast={toast} refreshSignal={refreshSignal} onAccountChange={bumpRefresh} />
      <div className="max-w-2xl mx-auto w-full px-5 pt-2">
        <Seam progress={100} />
      </div>

      {titleFor() && <TopBar title={titleFor()} onBack={canBack ? backTo() : null} />}
      {!titleFor() && canBack && (
        <div className="max-w-2xl mx-auto w-full px-5 pt-4">
          <button onClick={backTo()} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: INK2, border: "1px solid #FFFFFF18" }}>
            <ArrowLeft size={15} color={CHALK} />
          </button>
        </div>
      )}

      <div className="flex-1 pb-24">
        {route.view === "home" && <HomePage nav={nav} toast={toast} />}
        {route.view === "browse" && <BrowsePage initialTab={route.tab} nav={nav} toast={toast} />}
        {route.view === "create" && <CreatePage nav={nav} pseudo={pseudo} toast={toast} />}
        {route.view === "challenge" && <ChallengePage id={route.id} nav={nav} pseudo={pseudo} toast={toast} />}
        {route.view === "join" && <JoinPage id={route.id} nav={nav} toast={toast} onPseudoMayHaveChanged={bumpRefresh} />}
        {route.view === "duels" && <DuelsListPage id={route.id} nav={nav} pseudo={pseudo} />}
        {route.view === "duel" && <DuelPage id={route.id} duelId={route.duelId} nav={nav} pseudo={pseudo} toast={toast} />}
        {route.view === "profile" && <ProfilePage pseudo={pseudo} nav={nav} toast={toast} />}
        {route.view === "halloffame" && <HallOfFamePage nav={nav} />}
      </div>

      <BottomNav nav={nav} route={route} />

      {toastMsg && <Toast message={toastMsg} onDone={() => setToastMsg(null)} />}
    </div>
  );
}
