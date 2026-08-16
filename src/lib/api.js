import { supabase } from "./supabaseClient.js";

/* ---------------------------------------------------------
   Identité anonyme pour voter sans inscription : un uuid généré
   une seule fois et gardé en localStorage sur cet appareil/navigateur.
--------------------------------------------------------- */
const DEVICE_ID_KEY = "sprintly_device_id";

export function getDeviceId() {
  if (typeof window === "undefined") return null;
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

/* ---------------------------------------------------------
   Couche d'accès aux données.
   Remplace les anciens helpers window.storage par de vraies
   requêtes/fonctions Supabase (Postgres + RLS + RPC atomiques).
--------------------------------------------------------- */

function mapDuel(row) {
  return {
    id: row.id,
    no: row.no,
    a: row.a ? { pseudo: row.a.pseudo, videoLink: row.a.video_link } : null,
    b: row.b ? { pseudo: row.b.pseudo, videoLink: row.b.video_link } : null,
    votesA: row.votes_a,
    votesB: row.votes_b,
    closed: row.closed,
    bye: row.bye,
    winner: row.winner,
    closesAt: row.closes_at ? new Date(row.closes_at).getTime() : null,
  };
}

function mapChallenge(ch, participants, duels) {
  return {
    id: ch.id,
    emoji: ch.emoji,
    title: ch.title,
    author: ch.author,
    description: ch.description,
    rules: ch.rules || [],
    durationMinutes: ch.duration_minutes,
    deadline: ch.deadline ? new Date(ch.deadline).getTime() : null,
    status: ch.status,
    createdAt: new Date(ch.created_at).getTime(),
    participants: (participants || []).map((p) => ({
      pseudo: p.pseudo,
      videoLink: p.video_link,
      joinedAt: new Date(p.joined_at).getTime(),
    })),
    duels: (duels || []).map(mapDuel),
  };
}

function friendlyError(err) {
  const code = err?.message || "";
  const map = {
    already_joined: "Ce pseudo a déjà rejoint ce défi.",
    login_required: "Connecte-toi d'abord, en haut de l'écran.",
    pseudo_required: "Choisis un pseudo avant de continuer.",
    pseudo_already_set: "Tu as déjà un pseudo sur ce compte.",
    pseudo_taken: "Ce pseudo est déjà pris.",
    challenge_not_open: "Ce défi n'est plus ouvert aux inscriptions.",
    deadline_passed: "Les inscriptions sont closes pour ce défi.",
    pseudo_and_link_required: "Ajoute ton lien vidéo et ton pseudo.",
    title_and_author_required: "Donne un titre à ton défi.",
    already_voted: "Tu as déjà voté sur ce duel.",
    too_many_votes_from_ip: "Trop de votes depuis cette connexion pour ce duel.",
    device_id_required: "Une erreur technique empêche le vote, recharge la page.",
    duel_closed: "Ce duel est clôturé.",
    not_author: "Seul l'auteur du défi peut lancer le tirage.",
    deadline_not_passed: "Les inscriptions ne sont pas encore closes.",
    not_enough_participants: "Pas assez de participants pour tirer les duels.",
    not_admin: "Action réservée aux administrateurs.",
    challenge_not_pending: "Ce défi n'est plus en attente de validation.",
  };
  return map[code] || "Une erreur est survenue. Réessaie.";
}

/* ---------------- Lecture ---------------- */

export async function loadIndex() {
  const { data, error } = await supabase
    .from("challenges")
    .select("id, emoji, title, status, deadline, participants(count)")
    .in("status", ["open", "drawn", "closed"])
    .order("created_at", { ascending: false });
  if (error) throw new Error(friendlyError(error));
  return (data || []).map((c) => ({
    id: c.id,
    emoji: c.emoji,
    title: c.title,
    status: c.status,
    deadline: c.deadline ? new Date(c.deadline).getTime() : null,
    participantsCount: c.participants?.[0]?.count || 0,
  }));
}

export async function loadChallenge(id) {
  const { data: ch, error } = await supabase.from("challenges").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(friendlyError(error));
  if (!ch) return null;
  const { data: participants } = await supabase
    .from("participants")
    .select("*")
    .eq("challenge_id", id)
    .order("joined_at");
  const { data: duels } = await supabase
    .from("duels")
    .select("*, a:participants!duels_participant_a_fkey(pseudo, video_link), b:participants!duels_participant_b_fkey(pseudo, video_link)")
    .eq("challenge_id", id)
    .order("no");
  return mapChallenge(ch, participants, duels);
}

export async function loadUser(pseudo) {
  const { data: u } = await supabase
    .from("users")
    .select("*")
    .ilike("pseudo", pseudo)
    .maybeSingle();
  if (!u) return null;
  const { data: trophies } = await supabase
    .from("trophies")
    .select("*")
    .ilike("winner_pseudo", pseudo)
    .order("won_at");
  return {
    pseudo: u.pseudo,
    joinedAt: new Date(u.joined_at).getTime(),
    trophies: (trophies || []).map((t) => ({
      challengeId: t.challenge_id,
      challengeTitle: t.challenge_title,
      duelId: t.duel_id,
      wonAt: new Date(t.won_at).getTime(),
    })),
  };
}

export async function loadUserStats(pseudo) {
  const { data, error } = await supabase.rpc("user_stats", { p_pseudo: pseudo });
  if (error || !data || data.length === 0) return { duelsPlayed: 0, wins: 0, winPct: 0 };
  const row = Array.isArray(data) ? data[0] : data;
  return {
    duelsPlayed: row.duels_played || 0,
    wins: row.wins || 0,
    winPct: row.duels_played > 0 ? Math.round((100 * row.wins) / row.duels_played) : 0,
  };
}

export async function loadMyParticipations(pseudo) {
  if (!pseudo) return [];
  const { data, error } = await supabase
    .from("participants")
    .select("challenge_id, video_link, joined_at, challenges(id, emoji, title, status)")
    .ilike("pseudo", pseudo)
    .order("joined_at", { ascending: false });
  if (error || !data) return [];
  return data
    .filter((p) => p.challenges)
    .map((p) => ({
      challengeId: p.challenges.id,
      emoji: p.challenges.emoji,
      title: p.challenges.title,
      status: p.challenges.status,
      videoLink: p.video_link,
      joinedAt: new Date(p.joined_at).getTime(),
    }));
}

export async function hasVoted(duelId) {
  const deviceId = getDeviceId();
  if (!deviceId) return false;
  const { data, error } = await supabase.rpc("has_voted", { p_duel_id: duelId, p_device_id: deviceId });
  if (error) return false;
  return !!data;
}

export async function searchClosedChallenges({ query = "", limit = 10, offset = 0 } = {}) {
  const { data, error } = await supabase.rpc("search_closed_challenges", {
    p_query: query || null,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw new Error(friendlyError(error));
  return (data || []).map((c) => ({
    id: c.id,
    emoji: c.emoji,
    title: c.title,
    participantsCount: c.participants_count || 0,
    duelsCount: c.duels_count || 0,
    createdAt: new Date(c.created_at).getTime(),
  }));
}

export async function loadRecentWinners({ limit = 8 } = {}) {
  const { data, error } = await supabase.rpc("recent_duel_winners", { p_limit: limit });
  if (error) throw new Error(friendlyError(error));
  return (data || [])
    .filter((w) => w.winner_pseudo)
    .map((w) => ({
      duelId: w.duel_id,
      pseudo: w.winner_pseudo,
      challengeId: w.challenge_id,
      challengeEmoji: w.challenge_emoji,
      challengeTitle: w.challenge_title,
      createdAt: new Date(w.created_at).getTime(),
    }));
}

export async function loadTopWinners({ limit = 5 } = {}) {
  const { data, error } = await supabase.rpc("top_winners", { p_limit: limit });
  if (error) throw new Error(friendlyError(error));
  return (data || []).map((w) => ({ pseudo: w.winner_pseudo, wins: w.wins }));
}

/* ---------------- Auth participant (lien magique) ---------------- */

// Envoie un email avec un lien de connexion. En cliquant dessus, la personne
// revient sur cette page déjà connectée (pas de mot de passe à créer).
export async function sendMagicLink(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { emailRedirectTo: window.location.href },
  });
  if (error) throw new Error("Impossible d'envoyer l'email. Vérifie l'adresse.");
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export function onAuthStateChange(callback) {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(session));
  return () => data.subscription.unsubscribe();
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function getMyPseudo() {
  const { data, error } = await supabase.rpc("get_my_pseudo");
  if (error) return null;
  return data || null;
}

export async function setMyPseudo(pseudo) {
  return rpc("set_my_pseudo", { p_pseudo: pseudo });
}

/* ---------------- Écriture (RPC atomiques) ---------------- */

async function rpc(fn, args) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(friendlyError(error));
  return data;
}

export async function createChallenge({ emoji, title, description, rules, durationMinutes }) {
  return rpc("create_challenge", {
    p_emoji: emoji, p_title: title, p_description: description,
    p_rules: rules, p_duration_minutes: durationMinutes,
  });
}

export async function joinChallenge(challengeId, pseudo, videoLink) {
  return rpc("join_challenge", { p_challenge_id: challengeId, p_pseudo: pseudo, p_video_link: videoLink });
}

export async function castVote(duelId, side) {
  return rpc("cast_vote", { p_duel_id: duelId, p_device_id: getDeviceId(), p_side: side });
}

export async function closeDuel(duelId) {
  return rpc("close_duel", { p_duel_id: duelId });
}

export async function drawChallenge(challengeId) {
  return rpc("draw_challenge", { p_challenge_id: challengeId });
}

/* ---------------- Admin ---------------- */

export async function adminListChallenges() {
  const { data, error } = await supabase.rpc("admin_list_challenges");
  if (error) throw new Error(friendlyError(error));
  return await Promise.all(
    (data || []).map(async (c) => {
      const { count } = await supabase
        .from("participants")
        .select("*", { count: "exact", head: true })
        .eq("challenge_id", c.id);
      return {
        id: c.id, emoji: c.emoji, title: c.title, status: c.status,
        deadline: c.deadline ? new Date(c.deadline).getTime() : null,
        participantsCount: count || 0,
      };
    })
  );
}

export async function approveChallenge(id) {
  return rpc("approve_challenge", { p_challenge_id: id });
}
export async function rejectChallenge(id) {
  return rpc("reject_challenge", { p_challenge_id: id });
}
export async function adminDeleteChallenge(id) {
  return rpc("admin_delete_challenge", { p_challenge_id: id });
}

/* ---------------- Auth admin ---------------- */

export async function signInAdmin(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error("Identifiants incorrects.");
  return data;
}
export async function signOutAdmin() {
  await supabase.auth.signOut();
}
export async function getAdminSession() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) return null;
  const { data: isAdmin } = await supabase.rpc("is_admin");
  return isAdmin ? data.session : null;
}
