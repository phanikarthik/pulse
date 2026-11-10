-- Hosts and audiences, phase A (PLAN.md milestone 10): the owner stays in control of a
-- platform where approved hosts run their own Pulse Live polls.
--
--  * questions.kind: 'public' (the owner's curated questions, as before) or 'live' (Pulse Live,
--    run by a host). Live polls never appear in the public feed.
--  * questions.moderation: 'ok', 'awaiting_approval' (a host poll flagged as politics or
--    elections, held until the owner approves) or 'hidden' (taken down by the owner). Only
--    'ok' polls are visible to voters or accept votes. Hosts cannot change it.
--  * questions.results_mode: what a live poll's audience sees (used from phase B).
--  * hosts: who may host, granted only by the owner, with per-host limits. Suspending a host
--    freezes all of their polls.
--  * platform_settings: owner switches, e.g. pause every live poll at once.
--  * Every owner and host action is written to admin_audit_log.
-- The owner (role = 'admin', with 2FA) is exempt from host limits.

create type public.question_kind as enum ('public', 'live');
create type public.moderation_state as enum ('ok', 'awaiting_approval', 'hidden');
create type public.results_mode as enum ('after_vote', 'live', 'presenter');
create type public.host_status as enum ('pending', 'approved', 'suspended', 'rejected');

alter table public.questions
  add column kind         public.question_kind    not null default 'public',
  add column moderation   public.moderation_state not null default 'ok',
  add column sensitive    boolean                 not null default false, -- politics or elections
  add column results_mode public.results_mode     not null default 'after_vote';

create table public.hosts (
  user_id             uuid primary key references public.profiles (id) on delete cascade,
  status              public.host_status not null default 'pending',
  organisation        text check (char_length(organisation) <= 80),
  note                text check (char_length(note) <= 500), -- why they want to host
  max_active_polls    integer not null default 5 check (max_active_polls between 0 and 1000),
  max_voters_per_poll integer not null default 200 check (max_voters_per_poll between 1 and 100000),
  created_at          timestamptz not null default now(),
  decided_at          timestamptz,
  decided_by          uuid references public.profiles (id) on delete set null
);

create table public.platform_settings (
  id                  boolean primary key default true check (id), -- exactly one row
  applications_paused boolean not null default false, -- no new host applications (phase C)
  live_polls_paused   boolean not null default false, -- every live poll stops taking votes
  updated_at          timestamptz not null default now()
);
insert into public.platform_settings default values;

alter table public.admin_audit_log drop constraint admin_audit_log_action_check;
alter table public.admin_audit_log add constraint admin_audit_log_action_check
  check (action in ('create', 'update', 'close', 'reopen', 'delete', 'hide', 'restore', 'approve', 'host', 'settings'));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- An approved host (no 2FA needed; the owner's own actions still need it).
create function private.is_host()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.hosts h where h.user_id = auth.uid() and h.status = 'approved');
$$;

-- The poll's creator is the owner: no host limits apply.
create function private.created_by_owner(p_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.id = p_user and p.role = 'admin');
$$;

grant execute on function private.is_host() to authenticated;
grant execute on function private.created_by_owner(uuid) to authenticated;

-- Open for votes: published, not hidden or awaiting approval, inside its time window and, for
-- live polls, not paused and run by the owner or a host in good standing.
create or replace function private.question_is_open(qid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.questions q
    cross join public.platform_settings s
    left join public.hosts h on h.user_id = q.created_by
    where q.id = qid
      and q.status = 'open'
      and q.moderation = 'ok'
      and q.opens_at <= now()
      and (q.closes_at is null or q.closes_at > now())
      and (q.kind = 'public'
           or (not s.live_polls_paused
               and (private.created_by_owner(q.created_by) or h.status = 'approved')))
  );
$$;

-- ---------------------------------------------------------------------------
-- Questions: what hosts may write
-- ---------------------------------------------------------------------------

-- Runs as the caller (not security definer) so current_user tells the website roles apart
-- from the owner's SQL editor.
create function private.guard_question_write()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if current_user not in ('anon', 'authenticated') or public.is_admin() then
    return new; -- the owner, or the SQL editor
  end if;

  if new.kind <> 'live' then
    raise exception 'Hosts can only create Pulse Live polls' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.moderation := case when new.sensitive then 'awaiting_approval' else 'ok' end;
  else
    if new.created_by is distinct from old.created_by or new.kind is distinct from old.kind then
      raise exception 'A poll cannot change owner or type' using errcode = '42501';
    end if;
    new.moderation := case
      when old.moderation = 'hidden' then 'hidden'
      -- newly flagged, or a flagged poll's wording changed: back to the owner for approval
      when new.sensitive and (not old.sensitive or new.body is distinct from old.body
                              or new.topic is distinct from old.topic) then 'awaiting_approval'
      else old.moderation
    end;
  end if;
  return new;
end;
$$;

create trigger guard_question_write
  before insert or update on public.questions
  for each row execute function private.guard_question_write();

-- A host can have at most max_active_polls open polls at once.
create function private.check_host_poll_limit()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  lim integer;
  n   integer;
begin
  if new.kind <> 'live' or new.status <> 'open' or (tg_op = 'UPDATE' and old.status = 'open')
     or new.created_by is null or private.created_by_owner(new.created_by) then
    return new;
  end if;
  select h.max_active_polls into lim from public.hosts h where h.user_id = new.created_by;
  select count(*) into n from public.questions q
   where q.created_by = new.created_by and q.kind = 'live' and q.status = 'open' and q.id <> new.id;
  if n >= coalesce(lim, 0) then
    raise exception 'You can have at most % open polls. Close one first.', coalesce(lim, 0) using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger check_host_poll_limit
  before insert or update on public.questions
  for each row execute function private.check_host_poll_limit();

-- Public feed: public questions only, and never hidden ones.
drop policy "questions: read published" on public.questions;
create policy "questions: read published" on public.questions
  for select to authenticated
  using (kind = 'public' and moderation = 'ok' and status in ('open', 'closed') and opens_at <= now());

-- Hosts: their own live polls, whatever state they are in.
create policy "questions: host read own" on public.questions
  for select to authenticated
  using (kind = 'live' and created_by = (select auth.uid()));
create policy "questions: host insert" on public.questions
  for insert to authenticated
  with check (kind = 'live' and created_by = (select auth.uid()) and (select private.is_host()));
create policy "questions: host update" on public.questions
  for update to authenticated
  using (kind = 'live' and created_by = (select auth.uid()) and (select private.is_host()))
  with check (kind = 'live' and created_by = (select auth.uid()) and (select private.is_host()));
create policy "questions: host delete" on public.questions
  for delete to authenticated
  using (kind = 'live' and created_by = (select auth.uid()) and (select private.is_host()));

-- Options of a host's own live poll.
create function private.owns_live_poll(qid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_host() and exists (
    select 1 from public.questions q where q.id = qid and q.kind = 'live' and q.created_by = auth.uid()
  );
$$;
grant execute on function private.owns_live_poll(uuid) to authenticated;

create policy "options: host insert" on public.options
  for insert to authenticated with check (private.owns_live_poll(question_id));
create policy "options: host update" on public.options
  for update to authenticated
  using (private.owns_live_poll(question_id)) with check (private.owns_live_poll(question_id));
create policy "options: host delete" on public.options
  for delete to authenticated using (private.owns_live_poll(question_id));

-- ---------------------------------------------------------------------------
-- Votes: per-host voter limit
-- ---------------------------------------------------------------------------

create or replace function private.prepare_vote()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  p   public.profiles%rowtype;
  q   public.questions%rowtype;
  lim integer;
begin
  select * into p from public.profiles where id = new.user_id;
  if p.id is null or p.district_code is null or p.age_band is null or p.consented_at is null then
    raise exception 'Complete your profile before voting' using errcode = '42501';
  end if;

  select * into q from public.questions where id = new.question_id;
  if q.kind = 'live' and not private.created_by_owner(q.created_by) then
    select h.max_voters_per_poll into lim from public.hosts h where h.user_id = q.created_by;
    if (select count(*) from public.votes v where v.question_id = new.question_id) >= coalesce(lim, 0) then
      raise exception 'This poll has reached its voter limit' using errcode = '23514';
    end if;
  end if;

  new.region        := p.region;
  new.district_code := p.district_code;
  new.age_band      := p.age_band;
  new.created_at    := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Audit: moderation changes too
-- ---------------------------------------------------------------------------

create or replace function private.audit_questions()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  act text;
  info text;
begin
  if tg_op = 'INSERT' then
    act := 'create';
    info := new.kind || ' · ' || new.status || ': ' || new.body;
  elsif tg_op = 'DELETE' then
    act := 'delete';
    info := old.body;
  elsif new.moderation is distinct from old.moderation then
    act := case
      when new.moderation = 'hidden' then 'hide'
      when old.moderation = 'awaiting_approval' and new.moderation = 'ok' then 'approve'
      when new.moderation = 'ok' then 'restore'
      else 'update' end;
    info := old.moderation || ' → ' || new.moderation || ': ' || new.body;
  else
    -- Ignore bookkeeping changes (e.g. created_by set null when an admin deletes their account).
    if (new.topic, new.body, new.status, new.opens_at, new.closes_at, new.sensitive, new.results_mode)
       is not distinct from (old.topic, old.body, old.status, old.opens_at, old.closes_at, old.sensitive, old.results_mode) then
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

-- ---------------------------------------------------------------------------
-- Hosts and switches: RLS and owner functions
-- ---------------------------------------------------------------------------

alter table public.hosts enable row level security;
alter table public.platform_settings enable row level security;
revoke all on public.hosts, public.platform_settings from anon, authenticated;

-- A host can see their own status and limits. All changes go through the owner functions.
grant select on public.hosts to authenticated;
create policy "hosts: read own" on public.hosts
  for select to authenticated using (user_id = (select auth.uid()));

grant select on public.platform_settings to authenticated;
create policy "settings: read" on public.platform_settings for select to authenticated using (true);

create function private.log_owner_action(p_action text, p_detail text)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.admin_audit_log (admin_id, action, question_id, detail)
  values (auth.uid(), p_action, null, p_detail);
$$;

-- Every host and applicant, with the email they sign in with (owner only).
create function public.admin_list_hosts()
returns table (
  user_id uuid, display_name text, email text, status public.host_status, organisation text,
  max_active_polls integer, max_voters_per_poll integer, open_polls integer,
  created_at timestamptz, decided_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  return query
    select h.user_id, p.display_name, u.email::text, h.status, h.organisation,
           h.max_active_polls, h.max_voters_per_poll,
           (select count(*)::integer from public.questions q
             where q.created_by = h.user_id and q.kind = 'live' and q.status = 'open'),
           h.created_at, h.decided_at
    from public.hosts h
    join public.profiles p on p.id = h.user_id
    left join auth.users u on u.id = h.user_id
    order by (h.status = 'pending') desc, h.created_at desc;
end;
$$;

-- Make someone a host by the email they use for Pulse. They must have signed in once.
create function public.admin_add_host(p_email text, p_organisation text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid;
begin
  if not public.is_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  select u.id into uid from auth.users u
   join public.profiles p on p.id = u.id
   where lower(u.email) = lower(btrim(p_email));
  if uid is null then
    raise exception 'No Pulse account uses that email. Ask them to sign in to Pulse once, then add them.' using errcode = 'P0002';
  end if;
  insert into public.hosts (user_id, status, organisation, decided_at, decided_by)
  values (uid, 'approved', nullif(btrim(coalesce(p_organisation, '')), ''), now(), auth.uid())
  on conflict (user_id) do update
    set status = 'approved',
        organisation = coalesce(excluded.organisation, public.hosts.organisation),
        decided_at = now(), decided_by = auth.uid();
  perform private.log_owner_action('host', 'approved host ' || lower(btrim(p_email)));
  return uid;
end;
$$;

-- Approve, suspend, reject or restore a host, and set their limits.
create function public.admin_update_host(
  p_user_id uuid, p_status public.host_status, p_max_active_polls integer, p_max_voters_per_poll integer
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  old public.hosts%rowtype;
  who text;
begin
  if not public.is_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  select * into old from public.hosts where user_id = p_user_id;
  if old.user_id is null then
    raise exception 'Not a host' using errcode = 'P0002';
  end if;
  update public.hosts
     set status = p_status,
         max_active_polls = p_max_active_polls,
         max_voters_per_poll = p_max_voters_per_poll,
         decided_at = case when p_status <> old.status then now() else decided_at end,
         decided_by = case when p_status <> old.status then auth.uid() else decided_by end
   where user_id = p_user_id;
  select coalesce(u.email, p_user_id::text) into who from auth.users u where u.id = p_user_id;
  perform private.log_owner_action('host', who || ': ' ||
    case when p_status <> old.status then old.status || ' → ' || p_status || '; ' else '' end ||
    'limits ' || p_max_active_polls || ' open polls, ' || p_max_voters_per_poll || ' voters per poll');
end;
$$;

-- Owner switches.
create function public.admin_set_switch(p_name text, p_on boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if p_name = 'live_polls_paused' then
    update public.platform_settings set live_polls_paused = p_on, updated_at = now();
  elsif p_name = 'applications_paused' then
    update public.platform_settings set applications_paused = p_on, updated_at = now();
  else
    raise exception 'Unknown switch: %', p_name using errcode = '22023';
  end if;
  perform private.log_owner_action('settings', p_name || ' = ' || p_on);
end;
$$;

revoke all on function public.admin_list_hosts() from public, anon;
revoke all on function public.admin_add_host(text, text) from public, anon;
revoke all on function public.admin_update_host(uuid, public.host_status, integer, integer) from public, anon;
revoke all on function public.admin_set_switch(text, boolean) from public, anon;
grant execute on function public.admin_list_hosts() to authenticated;
grant execute on function public.admin_add_host(text, text) to authenticated;
grant execute on function public.admin_update_host(uuid, public.host_status, integer, integer) to authenticated;
grant execute on function public.admin_set_switch(text, boolean) to authenticated;
