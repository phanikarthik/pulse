-- Pulse: schema, Row Level Security and database-enforced rules (Milestone 2).
--
-- Rules enforced here, not only in the UI:
--  * profiles.role is never writable by website roles (anon, authenticated, service_role).
--    Signup always creates 'voter'; the owner promotes themselves once in the SQL editor.
--  * Only role=admin with a 2FA session (JWT aal = 'aal2') can write questions/options.
--  * Signed-in users read open and closed questions; drafts are admin-only.
--  * votes are insert-only, for yourself, on open questions; one per question (PK).
--    region/age_band are copied from the profile by trigger, never taken from the client.
--  * option_counts is maintained by trigger and not readable; results come only from
--    get_results(), and only after the caller has voted.
--  * Breakdowns hide the result for any group under 20 voters.
--  * Every change to questions/options is written to admin_audit_log.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

create type public.age_band as enum ('18-24', '25-34', '35-44', '45-59', '60+');
create type public.user_role as enum ('voter', 'admin');
create type public.question_status as enum ('draft', 'open', 'closed');

-- Helpers and trigger functions live here; this schema is not exposed by the API.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 40),
  -- region / age_band / consented_at stay null until a Google sign-up completes their profile.
  region       text check (char_length(btrim(region)) between 1 and 60),
  age_band     public.age_band,
  consented_at timestamptz, -- 18+ confirmation and acceptance of terms + privacy policy
  role         public.user_role not null default 'voter',
  created_at   timestamptz not null default now()
);

create table public.questions (
  id         uuid primary key default gen_random_uuid(),
  topic      text not null check (char_length(btrim(topic)) between 1 and 40),
  body       text not null check (char_length(btrim(body)) between 1 and 160),
  status     public.question_status not null default 'draft',
  opens_at   timestamptz not null default now(),
  closes_at  timestamptz,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (closes_at is null or closes_at > opens_at)
);
create index questions_status_opens_idx on public.questions (status, opens_at desc);

create table public.options (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions (id) on delete cascade,
  label       text not null check (char_length(btrim(label)) between 1 and 80),
  position    smallint not null check (position between 1 and 4), -- at most 4 options
  unique (question_id, position),
  unique (id, question_id) -- lets votes prove the option belongs to the question
);

create table public.votes (
  question_id uuid not null references public.questions (id) on delete cascade,
  user_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  option_id   uuid not null,
  region      text not null,
  age_band    public.age_band not null,
  created_at  timestamptz not null default now(),
  primary key (question_id, user_id), -- one vote per person per question
  foreign key (option_id, question_id) references public.options (id, question_id) on delete cascade
);
create index votes_user_idx on public.votes (user_id);

create table public.option_counts (
  option_id   uuid primary key references public.options (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete cascade,
  votes       integer not null default 0 check (votes >= 0)
);
create index option_counts_question_idx on public.option_counts (question_id);

create table public.admin_audit_log (
  id          bigint generated always as identity primary key,
  admin_id    uuid references public.profiles (id) on delete set null,
  action      text not null check (action in ('create', 'update', 'close', 'reopen', 'delete')),
  question_id uuid, -- no FK: the entry must outlive a deleted question
  detail      text not null default '',
  created_at  timestamptz not null default now()
);
create index admin_audit_log_created_idx on public.admin_audit_log (created_at desc);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- role=admin AND a 2FA-verified session.
create function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
     and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin');
$$;

create function private.question_is_open(qid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.questions q
    where q.id = qid
      and q.status = 'open'
      and q.opens_at <= now()
      and (q.closes_at is null or q.closes_at > now())
  );
$$;

-- ---------------------------------------------------------------------------
-- Triggers: profiles
-- ---------------------------------------------------------------------------

-- Signup: always a voter. Profile fields come from the sign-up form's user metadata.
create function private.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  band text := meta ->> 'age_band';
  name text := left(btrim(coalesce(nullif(btrim(meta ->> 'display_name'), ''),
                                   nullif(btrim(meta ->> 'full_name'), ''),
                                   split_part(coalesce(new.email, ''), '@', 1),
                                   'Voter')), 40);
begin
  insert into public.profiles (id, display_name, region, age_band, consented_at, role)
  values (
    new.id,
    coalesce(nullif(name, ''), 'Voter'),
    nullif(left(btrim(coalesce(meta ->> 'region', '')), 60), ''),
    case when band in ('18-24', '25-34', '35-44', '45-59', '60+') then band::public.age_band end,
    case when meta ->> 'adult' = 'true' and meta ->> 'consent' = 'true' then now() end,
    'voter'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Second line of defence behind the column grants: website roles can never change role, id or created_at.
create function private.guard_profile_update()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('anon', 'authenticated', 'service_role')
     and (new.role is distinct from old.role
          or new.id is distinct from old.id
          or new.created_at is distinct from old.created_at) then
    raise exception 'profiles.role cannot be changed from the website' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger guard_profile_update
  before update on public.profiles
  for each row execute function private.guard_profile_update();

-- ---------------------------------------------------------------------------
-- Triggers: questions / options integrity
-- ---------------------------------------------------------------------------

-- A question that is not a draft must have 2-4 options. Deferred, so a question and its
-- options can be written in one transaction.
create function private.check_question_options()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  qid uuid;
  st  public.question_status;
  n   integer;
begin
  if tg_table_name = 'questions' then
    qid := new.id;
  elsif tg_op = 'DELETE' then
    qid := old.question_id;
  else
    qid := new.question_id;
  end if;

  select q.status into st from public.questions q where q.id = qid;
  if st is null or st = 'draft' then
    return null; -- deleted, or a draft still being edited
  end if;

  select count(*) into n from public.options o where o.question_id = qid;
  if n < 2 or n > 4 then
    raise exception 'A published question needs 2 to 4 options (has %)', n using errcode = '23514';
  end if;
  return null;
end;
$$;

create constraint trigger questions_need_options
  after insert or update on public.questions
  deferrable initially deferred
  for each row execute function private.check_question_options();

create constraint trigger options_keep_question_valid
  after insert or update or delete on public.options
  deferrable initially deferred
  for each row execute function private.check_question_options();

-- ---------------------------------------------------------------------------
-- Triggers: votes
-- ---------------------------------------------------------------------------

-- Copy region/age_band from the voter's profile; the client cannot supply them.
create function private.prepare_vote()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  p public.profiles%rowtype;
begin
  select * into p from public.profiles where id = new.user_id;
  if p.id is null or p.region is null or p.age_band is null or p.consented_at is null then
    raise exception 'Complete your profile before voting' using errcode = '42501';
  end if;
  new.region     := p.region;
  new.age_band   := p.age_band;
  new.created_at := now();
  return new;
end;
$$;

create trigger prepare_vote
  before insert on public.votes
  for each row execute function private.prepare_vote();

-- Votes are append-only, even for the service role. (Deletes happen only through account
-- or question deletion, via ON DELETE CASCADE.)
create function private.forbid_vote_update()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Votes cannot be changed' using errcode = '42501';
end;
$$;

create trigger forbid_vote_update
  before update on public.votes
  for each row execute function private.forbid_vote_update();

create function private.maintain_option_counts()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.option_counts as c (option_id, question_id, votes)
    values (new.option_id, new.question_id, 1)
    on conflict (option_id) do update set votes = c.votes + 1;
  else
    update public.option_counts
       set votes = greatest(votes - 1, 0)
     where option_id = old.option_id;
  end if;
  return null;
end;
$$;

create trigger maintain_option_counts
  after insert or delete on public.votes
  for each row execute function private.maintain_option_counts();

-- ---------------------------------------------------------------------------
-- Triggers: admin audit log
-- ---------------------------------------------------------------------------

create function private.audit_questions()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  act text;
  info text;
begin
  if tg_op = 'INSERT' then
    act := 'create';
    info := new.status || ': ' || new.body;
  elsif tg_op = 'DELETE' then
    act := 'delete';
    info := old.body;
  else
    -- Ignore bookkeeping changes (e.g. created_by set null when an admin deletes their account).
    if (new.topic, new.body, new.status, new.opens_at, new.closes_at)
       is not distinct from (old.topic, old.body, old.status, old.opens_at, old.closes_at) then
      return null;
    end if;
    if new.status = 'closed' and old.status <> 'closed' then
      act := 'close';
    elsif old.status = 'closed' and new.status = 'open' then
      act := 'reopen';
    else
      act := 'update';
    end if;
    info := case when new.status <> old.status
                 then old.status || ' → ' || new.status
                 else 'edited: ' || new.body end;
  end if;

  insert into public.admin_audit_log (admin_id, action, question_id, detail)
  values ((select p.id from public.profiles p where p.id = auth.uid()), act, coalesce(new.id, old.id), info);
  return null;
end;
$$;

create trigger audit_questions
  after insert or update or delete on public.questions
  for each row execute function private.audit_questions();

create function private.audit_options()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  qid uuid := case when tg_op = 'DELETE' then old.question_id else new.question_id end;
  q_created timestamptz;
begin
  select created_at into q_created from public.questions where id = qid;
  -- Skip cascades from a deleted question, and options written together with a new
  -- question (already covered by its 'create' entry).
  if q_created is null or q_created = now() then
    return null;
  end if;

  insert into public.admin_audit_log (admin_id, action, question_id, detail)
  values (
    (select p.id from public.profiles p where p.id = auth.uid()), 'update', qid,
    case tg_op
      when 'INSERT' then 'option added: ' || new.label
      when 'DELETE' then 'option removed: ' || old.label
      else 'option changed: ' || old.label || ' → ' || new.label
    end
  );
  return null;
end;
$$;

create trigger audit_options
  after insert or update or delete on public.options
  for each row execute function private.audit_options();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles        enable row level security;
alter table public.questions       enable row level security;
alter table public.options         enable row level security;
alter table public.votes           enable row level security;
alter table public.option_counts   enable row level security;
alter table public.admin_audit_log enable row level security;

-- Supabase grants everything to the API roles by default; start from nothing.
revoke all on public.profiles, public.questions, public.options, public.votes,
              public.option_counts, public.admin_audit_log
  from anon, authenticated;

-- profiles: own row only; role is not in the updatable columns.
grant select on public.profiles to authenticated;
grant update (display_name, region, age_band) on public.profiles to authenticated;

create policy "profiles: read own" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "profiles: update own" on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- questions: signed-in users see published questions; admins (2FA) see and write everything.
grant select, insert, update, delete on public.questions to authenticated;

create policy "questions: read published" on public.questions
  for select to authenticated
  using (status in ('open', 'closed') and opens_at <= now());
create policy "questions: admin read" on public.questions
  for select to authenticated using ((select public.is_admin()));
create policy "questions: admin insert" on public.questions
  for insert to authenticated
  with check ((select public.is_admin()) and created_by = (select auth.uid()));
create policy "questions: admin update" on public.questions
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "questions: admin delete" on public.questions
  for delete to authenticated using ((select public.is_admin()));

-- options: readable when their question is (the subquery is itself filtered by RLS).
grant select, insert, update, delete on public.options to authenticated;

create policy "options: read with question" on public.options
  for select to authenticated
  using (exists (select 1 from public.questions q where q.id = question_id));
create policy "options: admin insert" on public.options
  for insert to authenticated with check ((select public.is_admin()));
create policy "options: admin update" on public.options
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "options: admin delete" on public.options
  for delete to authenticated using ((select public.is_admin()));

-- votes: insert your own vote on an open question; read only your own. No update/delete.
grant select on public.votes to authenticated;
grant insert (question_id, option_id) on public.votes to authenticated;

create policy "votes: read own" on public.votes
  for select to authenticated using (user_id = (select auth.uid()));
create policy "votes: insert own on open question" on public.votes
  for insert to authenticated
  with check (user_id = (select auth.uid()) and private.question_is_open(question_id));

-- option_counts: RLS on, no policies, no grants. Read only through get_results().

-- admin_audit_log: admins (2FA) can read; nobody can write except the triggers.
grant select on public.admin_audit_log to authenticated;

create policy "audit: admin read" on public.admin_audit_log
  for select to authenticated using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- API functions
-- ---------------------------------------------------------------------------

-- Results for one question, only once the caller has voted on it.
create function public.get_results(p_question_id uuid)
returns table (option_id uuid, label text, "position" smallint, votes integer, is_mine boolean)
language sql stable security definer set search_path = ''
as $$
  with mine as (
    select v.option_id from public.votes v
    where v.question_id = p_question_id and v.user_id = auth.uid()
  )
  select o.id, o.label, o.position, coalesce(c.votes, 0), o.id = m.option_id
  from mine m
  join public.options o on o.question_id = p_question_id
  left join public.option_counts c on c.option_id = o.id
  order by o.position;
$$;

-- Share of each group that chose the caller's option. Groups under 20 voters get pct = null.
-- p_dimension: 'age' or 'region'.
create function public.get_breakdown(p_question_id uuid, p_dimension text default 'age')
returns table (grp text, voters integer, pct integer)
language plpgsql stable security definer set search_path = ''
as $$
declare
  my_option uuid;
begin
  if p_dimension not in ('age', 'region') then
    raise exception 'Unknown breakdown: %', p_dimension using errcode = '22023';
  end if;

  select v.option_id into my_option from public.votes v
  where v.question_id = p_question_id and v.user_id = auth.uid();
  if my_option is null then
    return; -- not voted: nothing
  end if;

  return query
    select g.grp,
           g.voters::integer,
           case when g.voters < 20 then null
                else round(100.0 * g.agree / g.voters)::integer end
    from (
      select case when p_dimension = 'age' then v.age_band::text
                  else initcap(lower(btrim(v.region))) end as grp,
             count(*) as voters,
             count(*) filter (where v.option_id = my_option) as agree
      from public.votes v
      where v.question_id = p_question_id
      group by 1
    ) g
    order by g.grp;
end;
$$;

-- Google sign-ups fill in what the sign-up form would have collected.
create function public.complete_profile(
  p_display_name text, p_region text, p_age_band public.age_band, p_adult boolean, p_consent boolean
)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if p_adult is not true or p_consent is not true then
    raise exception 'You must be 18 or over and accept the terms and privacy policy' using errcode = '22023';
  end if;
  update public.profiles
     set display_name = btrim(p_display_name),
         region       = btrim(p_region),
         age_band     = p_age_band,
         consented_at = coalesce(consented_at, now())
   where id = auth.uid();
end;
$$;

-- Admin: post a question with 2-4 options in one call. Runs as the caller, so RLS applies.
create function public.admin_create_question(
  p_topic text, p_body text, p_options text[],
  p_status public.question_status default 'draft', p_closes_at timestamptz default null
)
returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  qid uuid;
  labels text[];
begin
  if not public.is_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  select array_agg(btrim(l) order by i) into labels
  from unnest(p_options) with ordinality as t(l, i)
  where btrim(l) <> '';
  if coalesce(array_length(labels, 1), 0) not between 2 and 4 then
    raise exception 'A question needs 2 to 4 options' using errcode = '22023';
  end if;
  if (select count(distinct lower(l)) from unnest(labels) l) <> array_length(labels, 1) then
    raise exception 'Options must be different' using errcode = '22023';
  end if;

  insert into public.questions (topic, body, status, closes_at, created_by)
  values (btrim(p_topic), btrim(p_body), p_status, p_closes_at, auth.uid())
  returning id into qid;

  insert into public.options (question_id, label, position)
  select qid, l, i::smallint from unnest(labels) with ordinality as t(l, i);

  return qid;
end;
$$;

-- "Delete my account and data": removes the auth user, which cascades to the profile and
-- votes; the votes trigger recalculates option_counts.
create function public.delete_my_account()
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

-- Function privileges: nothing for anon; signed-in users only get the API functions.
revoke all on all functions in schema private from public, anon, authenticated, service_role;
grant usage on schema private to authenticated;
grant execute on function private.question_is_open(uuid) to authenticated;

revoke all on function public.is_admin() from public, anon;
revoke all on function public.get_results(uuid) from public, anon;
revoke all on function public.get_breakdown(uuid, text) from public, anon;
revoke all on function public.complete_profile(text, text, public.age_band, boolean, boolean) from public, anon;
revoke all on function public.admin_create_question(text, text, text[], public.question_status, timestamptz) from public, anon;
revoke all on function public.delete_my_account() from public, anon;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.get_results(uuid) to authenticated;
grant execute on function public.get_breakdown(uuid, text) to authenticated;
grant execute on function public.complete_profile(text, text, public.age_band, boolean, boolean) to authenticated;
grant execute on function public.admin_create_question(text, text, text[], public.question_status, timestamptz) to authenticated;
grant execute on function public.delete_my_account() to authenticated;

-- Stop future functions in public from being callable by anon by default.
alter default privileges in schema public revoke execute on functions from public, anon;

-- ---------------------------------------------------------------------------
-- Realtime: live "New question" events. Realtime applies the questions RLS policies, so
-- voters only receive published questions. Live counts will use a broadcast channel
-- (Milestone 4) because option_counts must stay unreadable.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.questions;
  end if;
end;
$$;
