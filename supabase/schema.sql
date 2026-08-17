-- ============================================================
-- SPRINTLY — schéma de base de données
-- À exécuter dans Supabase : SQL Editor > New query > coller > Run
-- (Ce fichier reflète l'état réel de la base en production au 17/08/2026)
-- ============================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------
-- TABLES
-- ----------------------------------------------------------

create table if not exists challenges (
  id uuid primary key default gen_random_uuid(),
  emoji text not null default '🔥',
  title text not null,
  author text not null,
  description text not null default '',
  rules jsonb not null default '[]'::jsonb,
  duration_minutes int not null default 30,
  deadline timestamptz,
  status text not null default 'pending'
    check (status in ('pending', 'open', 'drawn', 'closed', 'rejected')),
  created_at timestamptz not null default now(),
  -- compte à l'origine de la proposition (peut être vide pour d'anciens défis)
  user_id uuid references auth.users(id) on delete set null
);

create table if not exists participants (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references challenges(id) on delete cascade,
  pseudo text not null,
  video_link text not null,
  joined_at timestamptz not null default now(),
  -- compte du participant (peut être vide pour d'anciennes participations)
  user_id uuid references auth.users(id) on delete set null,
  unique (challenge_id, pseudo)
);
-- unicité insensible à la casse du pseudo au sein d'un défi
create unique index if not exists participants_challenge_pseudo_lower_idx
  on participants (challenge_id, lower(pseudo));
-- un compte ne peut participer qu'une seule fois à un même défi
create unique index if not exists participants_challenge_user_idx
  on participants (challenge_id, user_id) where (user_id is not null);

create table if not exists duels (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references challenges(id) on delete cascade,
  no int not null,
  participant_a uuid references participants(id),
  participant_b uuid references participants(id),
  votes_a int not null default 0,
  votes_b int not null default 0,
  closed boolean not null default false,
  bye boolean not null default false,
  winner text check (winner in ('A', 'B')),
  closes_at timestamptz,
  created_at timestamptz not null default now()
);

-- votes : identifiés par device (uuid côté client) + IP, plus par pseudo.
-- les lignes sont purgées à la clôture du duel (le score reste sur duels).
create table if not exists votes (
  id uuid primary key default gen_random_uuid(),
  duel_id uuid not null references duels(id) on delete cascade,
  side text not null check (side in ('A', 'B')),
  created_at timestamptz not null default now(),
  voter_device_id uuid,
  voter_ip inet
);
-- un device ne vote qu'une fois par duel
create unique index if not exists votes_duel_device_idx
  on votes (duel_id, voter_device_id);
-- utilisé pour compter les votes par IP (anti-abus, cf. max_votes_per_ip)
create index if not exists votes_duel_ip_idx
  on votes (duel_id, voter_ip);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  pseudo text not null,
  joined_at timestamptz not null default now(),
  -- compte Supabase Auth lié à ce pseudo (peut être vide pour un pseudo "orphelin")
  user_id uuid references auth.users(id) on delete set null
);
create unique index if not exists users_pseudo_lower_idx on users (lower(pseudo));
-- un compte ne possède qu'un seul pseudo
create unique index if not exists users_user_id_idx
  on users (user_id) where (user_id is not null);

create table if not exists trophies (
  id uuid primary key default gen_random_uuid(),
  winner_pseudo text not null,
  challenge_id uuid references challenges(id) on delete set null,
  challenge_title text not null,
  duel_id uuid unique references duels(id) on delete cascade,
  won_at timestamptz not null default now()
);

-- Comptes admin : lie un compte Supabase Auth (créé manuellement) au rôle admin.
create table if not exists admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create or replace function is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (select 1 from admins where user_id = auth.uid());
$$;

-- ----------------------------------------------------------
-- RLS — verrouillage complet des tables.
-- Toute écriture passe par les fonctions ci-dessous (security definer),
-- jamais par un insert/update/delete direct depuis le client.
-- ----------------------------------------------------------

alter table challenges enable row level security;
alter table participants enable row level security;
alter table duels enable row level security;
alter table votes enable row level security;
alter table users enable row level security;
alter table trophies enable row level security;
alter table admins enable row level security;

-- Lecture publique : uniquement les défis déjà validés (pas "pending"/"rejected").
create policy "public read published challenges" on challenges
  for select using (status in ('open', 'drawn', 'closed') or is_admin());

create policy "public read participants of published challenges" on participants
  for select using (
    exists (
      select 1 from challenges c
      where c.id = participants.challenge_id
        and (c.status in ('open', 'drawn', 'closed') or is_admin())
    )
  );

create policy "public read duels of published challenges" on duels
  for select using (
    exists (
      select 1 from challenges c
      where c.id = duels.challenge_id
        and (c.status in ('open', 'drawn', 'closed') or is_admin())
    )
  );

create policy "public read users" on users for select using (true);
create policy "public read trophies" on trophies for select using (true);

-- votes : jamais lus directement par le client (les compteurs sont sur duels).
-- admins : jamais lu/écrit par le client, seulement via is_admin().

-- ----------------------------------------------------------
-- FONCTIONS MÉTIER (security definer = s'exécutent avec les droits du
-- propriétaire, donc traversent les RLS ci-dessus en toute sécurité,
-- car chaque fonction vérifie elle-même ses propres règles).
-- ----------------------------------------------------------

-- Proposer un défi (statut "pending"). Nécessite d'être connecté et d'avoir
-- déjà un pseudo (cf. set_my_pseudo) : l'auteur est déduit du compte, plus
-- besoin de le saisir à la main.
create or replace function create_challenge(
  p_emoji text, p_title text, p_description text,
  p_rules jsonb, p_duration_minutes int
) returns challenges
language plpgsql security definer set search_path = public as $$
declare
  result challenges;
  uid uuid := auth.uid();
  my_pseudo text;
begin
  if uid is null then raise exception 'login_required'; end if;
  select pseudo into my_pseudo from users where user_id = uid;
  if my_pseudo is null then raise exception 'pseudo_required'; end if;
  if trim(p_title) = '' then raise exception 'title_and_author_required'; end if;
  insert into challenges (user_id, emoji, title, author, description, rules, duration_minutes, status)
  values (uid, coalesce(nullif(trim(p_emoji), ''), '🔥'), trim(p_title), my_pseudo,
          coalesce(nullif(trim(p_description), ''), 'Relève le défi et affronte la communauté.'),
          coalesce(p_rules, '[]'::jsonb), greatest(1, coalesce(p_duration_minutes, 30)), 'pending')
  returning * into result;
  return result;
end; $$;

-- Rejoindre un défi ouvert. Nécessite d'être connecté ; le pseudo se choisit
-- une seule fois (à la première participation) puis reste stable ensuite.
create or replace function join_challenge(p_challenge_id uuid, p_pseudo text, p_video_link text)
returns participants
language plpgsql security definer set search_path = public as $$
declare
  ch challenges;
  result participants;
  uid uuid := auth.uid();
  final_pseudo text;
  existing_pseudo text;
begin
  if uid is null then raise exception 'login_required'; end if;

  select * into ch from challenges where id = p_challenge_id for update;
  if ch is null then raise exception 'challenge_not_found'; end if;
  if ch.status <> 'open' then raise exception 'challenge_not_open'; end if;
  if ch.deadline is not null and now() >= ch.deadline then raise exception 'deadline_passed'; end if;
  if trim(p_video_link) = '' then raise exception 'pseudo_and_link_required'; end if;

  select pseudo into existing_pseudo from users where user_id = uid;
  final_pseudo := coalesce(existing_pseudo, nullif(trim(p_pseudo), ''));
  if final_pseudo is null then raise exception 'pseudo_and_link_required'; end if;

  if exists (select 1 from participants where challenge_id = p_challenge_id and user_id = uid) then
    raise exception 'already_joined';
  end if;
  if exists (select 1 from participants where challenge_id = p_challenge_id and lower(pseudo) = lower(final_pseudo)) then
    raise exception 'already_joined';
  end if;

  insert into participants (challenge_id, user_id, pseudo, video_link)
  values (p_challenge_id, uid, final_pseudo, trim(p_video_link))
  returning * into result;

  insert into users (user_id, pseudo)
  select uid, final_pseudo where not exists (select 1 from users where user_id = uid);

  return result;
end; $$;

-- Nombre max de votes autorisés depuis une même IP sur un même duel (anti-abus).
create or replace function max_votes_per_ip()
returns integer
language sql immutable as $$ select 3 $$;

-- Voter dans un duel. Identifié par un device_id (uuid généré côté client)
-- + l'IP (déduite du header x-forwarded-for transmis par PostgREST), avec
-- une limite de votes par IP pour limiter le bourrage d'urnes.
create or replace function cast_vote(p_duel_id uuid, p_device_id uuid, p_side text)
returns duels
language plpgsql security definer set search_path = public as $$
declare
  d duels;
  client_ip inet;
  ip_vote_count int;
begin
  select * into d from duels where id = p_duel_id for update;
  if d is null then raise exception 'duel_not_found'; end if;
  if d.closed then raise exception 'duel_closed'; end if;
  if p_side not in ('A', 'B') then raise exception 'invalid_side'; end if;
  if p_device_id is null then raise exception 'device_id_required'; end if;

  if exists (select 1 from votes where duel_id = p_duel_id and voter_device_id = p_device_id) then
    raise exception 'already_voted';
  end if;

  begin
    client_ip := split_part(current_setting('request.headers', true)::json->>'x-forwarded-for', ',', 1)::inet;
  exception when others then
    client_ip := null;
  end;

  if client_ip is not null then
    select count(*) into ip_vote_count from votes where duel_id = p_duel_id and voter_ip = client_ip;
    if ip_vote_count >= max_votes_per_ip() then
      raise exception 'too_many_votes_from_ip';
    end if;
  end if;

  insert into votes (duel_id, voter_device_id, voter_ip, side) values (p_duel_id, p_device_id, client_ip, p_side);
  update duels set votes_a = votes_a + (case when p_side = 'A' then 1 else 0 end),
                   votes_b = votes_b + (case when p_side = 'B' then 1 else 0 end)
  where id = p_duel_id returning * into d;
  return d;
end; $$;

-- Clôturer un duel et attribuer le trophée. Purge les votes du duel une fois
-- clos : le score final (votes_a/votes_b) est déjà figé, plus besoin des
-- lignes individuelles (ni des IP).
create or replace function close_duel(p_duel_id uuid)
returns duels
language plpgsql security definer set search_path = public as $$
declare
  d duels;
  ch challenges;
  winner_pseudo text;
  all_closed boolean;
begin
  select * into d from duels where id = p_duel_id for update;
  if d is null then raise exception 'duel_not_found'; end if;
  if d.closed then return d; end if;

  update duels set closed = true,
    winner = case
      when votes_a = votes_b then (case when random() < 0.5 then 'A' else 'B' end)
      when votes_a > votes_b then 'A' else 'B'
    end
  where id = p_duel_id returning * into d;

  select pseudo into winner_pseudo from participants
  where id = (case when d.winner = 'A' then d.participant_a else d.participant_b end);

  if winner_pseudo is not null then
    select * into ch from challenges where id = d.challenge_id;
    insert into trophies (winner_pseudo, challenge_id, challenge_title, duel_id)
    values (winner_pseudo, d.challenge_id, ch.title, d.id)
    on conflict (duel_id) do nothing;
  end if;

  delete from votes where duel_id = p_duel_id;

  select bool_and(closed) into all_closed from duels where challenge_id = d.challenge_id;
  if all_closed then
    update challenges set status = 'closed' where id = d.challenge_id;
  end if;

  return d;
end; $$;

-- Clore les inscriptions et tirer les duels au sort (auteur du défi, après la
-- deadline, OU admin à tout moment). L'auteur est vérifié via challenges.user_id.
create or replace function draw_challenge(p_challenge_id uuid)
returns challenges
language plpgsql security definer set search_path = public as $$
declare
  ch challenges;
  uid uuid := auth.uid();
  pool uuid[];
  n int;
  i int;
  duel_no int := 0;
begin
  select * into ch from challenges where id = p_challenge_id for update;
  if ch is null then raise exception 'challenge_not_found'; end if;
  if ch.status <> 'open' then raise exception 'challenge_not_open'; end if;

  if not is_admin() then
    if uid is null or ch.user_id is null or uid <> ch.user_id then
      raise exception 'not_author';
    end if;
    if ch.deadline is not null and now() < ch.deadline then
      raise exception 'deadline_not_passed';
    end if;
  end if;

  select array_agg(id order by random()) into pool from participants where challenge_id = p_challenge_id;
  n := coalesce(array_length(pool, 1), 0);
  if n < 2 then raise exception 'not_enough_participants'; end if;

  i := 1;
  while i <= n loop
    duel_no := duel_no + 1;
    if i + 1 <= n then
      insert into duels (challenge_id, no, participant_a, participant_b, closes_at)
      values (p_challenge_id, duel_no, pool[i], pool[i + 1], now() + interval '20 minutes');
    else
      insert into duels (challenge_id, no, participant_a, votes_a, closed, bye, winner, closes_at)
      values (p_challenge_id, duel_no, pool[i], 1, true, true, 'A', now());
    end if;
    i := i + 2;
  end loop;

  update challenges set status = 'drawn' where id = p_challenge_id returning * into ch;
  return ch;
end; $$;

-- Admin : valider une proposition
create or replace function approve_challenge(p_challenge_id uuid)
returns challenges
language plpgsql security definer set search_path = public as $$
declare ch challenges;
begin
  if not is_admin() then raise exception 'not_admin'; end if;
  update challenges set status = 'open', deadline = now() + (duration_minutes || ' minutes')::interval
  where id = p_challenge_id and status = 'pending' returning * into ch;
  if ch is null then raise exception 'challenge_not_pending'; end if;
  return ch;
end; $$;

-- Admin : refuser une proposition
create or replace function reject_challenge(p_challenge_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'not_admin'; end if;
  delete from challenges where id = p_challenge_id and status = 'pending';
end; $$;

-- Admin : supprimer un défi (à tout statut)
create or replace function admin_delete_challenge(p_challenge_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'not_admin'; end if;
  delete from challenges where id = p_challenge_id;
end; $$;

-- Savoir si un device a déjà voté sur un duel (sans exposer la table votes)
create or replace function has_voted(p_duel_id uuid, p_device_id uuid)
returns boolean
language sql security definer set search_path = public as $$
  select exists (
    select 1 from votes where duel_id = p_duel_id and voter_device_id = p_device_id
  );
$$;

-- Admin : voir aussi les défis en attente (contourne le filtre public de la vue index)
create or replace function admin_list_challenges()
returns setof challenges
language sql security definer set search_path = public as $$
  select * from challenges where is_admin() order by created_at desc;
$$;

-- Récupérer le pseudo lié au compte connecté (ou null si pas encore choisi)
create or replace function get_my_pseudo()
returns text
language sql security definer set search_path = public as $$
  select pseudo from users where user_id = auth.uid() limit 1;
$$;

-- Choisir son pseudo une bonne fois pour toutes (une seule fois par compte).
-- Récupère un pseudo "orphelin" existant (créé avant l'ajout de l'auth) s'il
-- n'est encore lié à aucun compte, sinon en crée un nouveau.
create or replace function set_my_pseudo(p_pseudo text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  clean text := nullif(trim(p_pseudo), '');
  existing_id uuid;
  existing_owner uuid;
begin
  if uid is null then raise exception 'login_required'; end if;
  if clean is null then raise exception 'pseudo_and_link_required'; end if;
  if exists (select 1 from users where user_id = uid) then
    raise exception 'pseudo_already_set';
  end if;

  select id, user_id into existing_id, existing_owner
    from users where lower(pseudo) = lower(clean);

  if existing_id is not null and existing_owner is not null then
    raise exception 'pseudo_taken';
  end if;

  if existing_id is not null then
    update users set user_id = uid where id = existing_id;
  else
    insert into users (user_id, pseudo) values (uid, clean);
  end if;

  return clean;
end; $$;

-- Derniers duels gagnés (pour un fil d'actualité par ex.)
create or replace function recent_duel_winners(p_limit int default 8)
returns table(
  duel_id uuid, winner_pseudo text, challenge_id uuid,
  challenge_emoji text, challenge_title text, created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select
    d.id as duel_id,
    case when d.winner = 'A' then pa.pseudo else pb.pseudo end as winner_pseudo,
    c.id as challenge_id, c.emoji as challenge_emoji, c.title as challenge_title,
    d.created_at
  from duels d
  join challenges c on c.id = d.challenge_id
  left join participants pa on pa.id = d.participant_a
  left join participants pb on pb.id = d.participant_b
  where d.closed = true and d.winner is not null
  order by d.created_at desc
  limit p_limit;
$$;

-- Recherche paginée dans les défis clôturés (par titre ou pseudo participant)
create or replace function search_closed_challenges(p_query text default null, p_limit int default 10, p_offset int default 0)
returns table(
  id uuid, emoji text, title text,
  participants_count bigint, duels_count bigint, created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select
    c.id, c.emoji, c.title,
    (select count(*) from participants p where p.challenge_id = c.id) as participants_count,
    (select count(*) from duels d where d.challenge_id = c.id) as duels_count,
    c.created_at
  from challenges c
  where c.status = 'closed'
    and (
      p_query is null or trim(p_query) = '' or
      c.title ilike '%' || p_query || '%' or
      exists (
        select 1 from participants p2
        where p2.challenge_id = c.id and p2.pseudo ilike '%' || p_query || '%'
      )
    )
  order by c.created_at desc
  limit p_limit offset p_offset;
$$;

-- Classement des joueurs ayant remporté le plus de duels
create or replace function top_winners(p_limit int default 5)
returns table(winner_pseudo text, wins bigint)
language sql stable security definer set search_path = public as $$
  select t.winner_pseudo, count(*) as wins
  from trophies t
  group by t.winner_pseudo
  order by wins desc, t.winner_pseudo asc
  limit p_limit;
$$;

-- Statistiques d'un joueur (nombre de duels joués et de victoires)
create or replace function user_stats(p_pseudo text)
returns table(duels_played int, wins int)
language sql security definer set search_path = public as $$
  select
    (
      select count(*)::int from duels d
      join participants pa on pa.id = d.participant_a
      left join participants pb on pb.id = d.participant_b
      where d.closed and not d.bye
        and (lower(pa.pseudo) = lower(p_pseudo) or lower(coalesce(pb.pseudo, '')) = lower(p_pseudo))
    ) as duels_played,
    (
      select count(*)::int from trophies t where lower(t.winner_pseudo) = lower(p_pseudo)
    ) as wins;
$$;

-- ----------------------------------------------------------
-- DROITS D'EXÉCUTION
-- ----------------------------------------------------------

revoke all on challenges, participants, duels, votes, users, trophies, admins from anon, authenticated;
grant select on challenges, participants, duels, users, trophies to anon, authenticated;

grant execute on function
  create_challenge, join_challenge, cast_vote, close_duel, draw_challenge,
  approve_challenge, reject_challenge, admin_delete_challenge, admin_list_challenges,
  is_admin, has_voted, get_my_pseudo, set_my_pseudo, max_votes_per_ip,
  recent_duel_winners, search_closed_challenges, top_winners, user_stats
to anon, authenticated;

-- ----------------------------------------------------------
-- Pour te nommer admin une fois ton compte créé dans Authentication > Users :
-- insert into admins (user_id) values ('COLLE-ICI-L-UUID-DE-TON-COMPTE');
-- ----------------------------------------------------------
