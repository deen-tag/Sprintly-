-- ============================================================
-- SPRINTLY — schéma de base de données
-- À exécuter dans Supabase : SQL Editor > New query > coller > Run
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
  created_at timestamptz not null default now()
);

create table if not exists participants (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references challenges(id) on delete cascade,
  pseudo text not null,
  video_link text not null,
  joined_at timestamptz not null default now(),
  unique (challenge_id, pseudo)
);
-- unicité insensible à la casse du pseudo au sein d'un défi
create unique index if not exists participants_challenge_pseudo_lower_idx
  on participants (challenge_id, lower(pseudo));

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

create table if not exists votes (
  id uuid primary key default gen_random_uuid(),
  duel_id uuid not null references duels(id) on delete cascade,
  voter_pseudo text not null,
  side text not null check (side in ('A', 'B')),
  created_at timestamptz not null default now()
);
create unique index if not exists votes_duel_voter_lower_idx
  on votes (duel_id, lower(voter_pseudo));

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  pseudo text not null,
  joined_at timestamptz not null default now()
);
create unique index if not exists users_pseudo_lower_idx on users (lower(pseudo));

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

-- Proposer un défi (statut "pending")
create or replace function create_challenge(
  p_emoji text, p_title text, p_author text, p_description text,
  p_rules jsonb, p_duration_minutes int
) returns challenges
language plpgsql security definer set search_path = public as $$
declare
  result challenges;
begin
  if trim(p_title) = '' or trim(p_author) = '' then
    raise exception 'title_and_author_required';
  end if;
  insert into challenges (emoji, title, author, description, rules, duration_minutes, status)
  values (coalesce(nullif(trim(p_emoji), ''), '🔥'), trim(p_title), trim(p_author),
          coalesce(nullif(trim(p_description), ''), 'Relève le défi et affronte la communauté.'),
          coalesce(p_rules, '[]'::jsonb), greatest(1, coalesce(p_duration_minutes, 30)), 'pending')
  returning * into result;
  return result;
end; $$;

-- Rejoindre un défi ouvert
create or replace function join_challenge(p_challenge_id uuid, p_pseudo text, p_video_link text)
returns participants
language plpgsql security definer set search_path = public as $$
declare
  ch challenges;
  result participants;
begin
  select * into ch from challenges where id = p_challenge_id for update;
  if ch is null then raise exception 'challenge_not_found'; end if;
  if ch.status <> 'open' then raise exception 'challenge_not_open'; end if;
  if ch.deadline is not null and now() >= ch.deadline then raise exception 'deadline_passed'; end if;
  if trim(p_pseudo) = '' or trim(p_video_link) = '' then raise exception 'pseudo_and_link_required'; end if;
  if exists (select 1 from participants where challenge_id = p_challenge_id and lower(pseudo) = lower(trim(p_pseudo))) then
    raise exception 'already_joined';
  end if;
  insert into participants (challenge_id, pseudo, video_link)
  values (p_challenge_id, trim(p_pseudo), trim(p_video_link))
  returning * into result;
  insert into users (pseudo)
  select trim(p_pseudo) where not exists (select 1 from users where lower(pseudo) = lower(trim(p_pseudo)));
  return result;
end; $$;

-- Voter dans un duel
create or replace function cast_vote(p_duel_id uuid, p_pseudo text, p_side text)
returns duels
language plpgsql security definer set search_path = public as $$
declare
  d duels;
  a_pseudo text;
  b_pseudo text;
begin
  select * into d from duels where id = p_duel_id for update;
  if d is null then raise exception 'duel_not_found'; end if;
  if d.closed then raise exception 'duel_closed'; end if;
  if p_side not in ('A', 'B') then raise exception 'invalid_side'; end if;

  select pseudo into a_pseudo from participants where id = d.participant_a;
  select pseudo into b_pseudo from participants where id = d.participant_b;
  if lower(coalesce(a_pseudo, '')) = lower(trim(p_pseudo)) or lower(coalesce(b_pseudo, '')) = lower(trim(p_pseudo)) then
    raise exception 'cannot_vote_own_duel';
  end if;
  if exists (select 1 from votes where duel_id = p_duel_id and lower(voter_pseudo) = lower(trim(p_pseudo))) then
    raise exception 'already_voted';
  end if;

  insert into votes (duel_id, voter_pseudo, side) values (p_duel_id, trim(p_pseudo), p_side);
  update duels set votes_a = votes_a + (case when p_side = 'A' then 1 else 0 end),
                   votes_b = votes_b + (case when p_side = 'B' then 1 else 0 end)
  where id = p_duel_id returning * into d;
  return d;
end; $$;

-- Clôturer un duel et attribuer le trophée
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

  select bool_and(closed) into all_closed from duels where challenge_id = d.challenge_id;
  if all_closed then
    update challenges set status = 'closed' where id = d.challenge_id;
  end if;

  return d;
end; $$;

-- Clore les inscriptions et tirer les duels au sort (auteur, après la deadline, OU admin à tout moment)
create or replace function draw_challenge(p_challenge_id uuid, p_pseudo text)
returns challenges
language plpgsql security definer set search_path = public as $$
declare
  ch challenges;
  pool uuid[];
  n int;
  i int;
  duel_no int := 0;
begin
  select * into ch from challenges where id = p_challenge_id for update;
  if ch is null then raise exception 'challenge_not_found'; end if;
  if ch.status <> 'open' then raise exception 'challenge_not_open'; end if;

  if not is_admin() then
    if p_pseudo is null or lower(trim(p_pseudo)) <> lower(ch.author) then
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

-- Savoir si un pseudo a déjà voté sur un duel (sans exposer la table votes)
create or replace function has_voted(p_duel_id uuid, p_pseudo text)
returns boolean
language sql security definer set search_path = public as $$
  select exists (
    select 1 from votes where duel_id = p_duel_id and lower(voter_pseudo) = lower(p_pseudo)
  );
$$;

-- Admin : voir aussi les défis en attente (contourne le filtre public de la vue index)
create or replace function admin_list_challenges()
returns setof challenges
language sql security definer set search_path = public as $$
  select * from challenges where is_admin() order by created_at desc;
$$;

-- ----------------------------------------------------------
-- DROITS D'EXÉCUTION
-- ----------------------------------------------------------

revoke all on challenges, participants, duels, votes, users, trophies, admins from anon, authenticated;
grant select on challenges, participants, duels, users, trophies to anon, authenticated;

grant execute on function
  create_challenge, join_challenge, cast_vote, close_duel, draw_challenge,
  approve_challenge, reject_challenge, admin_delete_challenge, admin_list_challenges, is_admin, has_voted
to anon, authenticated;

-- ----------------------------------------------------------
-- Pour te nommer admin une fois ton compte créé dans Authentication > Users :
-- insert into admins (user_id) values ('COLLE-ICI-L-UUID-DE-TON-COMPTE');
-- ----------------------------------------------------------
