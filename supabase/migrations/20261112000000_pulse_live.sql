-- Hosts and audiences, phase B (PLAN.md milestone 10): Pulse Live.
--
--  * Every live poll gets a short join code (6 characters, no look-alikes such as 0/O, 1/I).
--    The audience opens /live/<code>.
--  * Guests vote without an account: the browser signs in anonymously (a Supabase user with no
--    email), so one-vote-per-person and every RLS rule still apply. Guests' votes carry no age
--    or place; signed-in members' votes on live polls still record theirs.
--  * live_poll(code): what the audience may see of a poll, including results only when the
--    poll's results mode allows. Draft, hidden and awaiting-approval polls look like "not found".
--  * host_create_live_poll / host_poll_totals: for approved hosts, their own polls only.
-- Hosts never see who voted; totals only.

alter table public.questions add column join_code text unique
  check (join_code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$');

alter table public.votes alter column region drop not null;
alter table public.votes alter column age_band drop not null;

-- Live polls get a join code on creation; it never changes afterwards.
create function private.assign_join_code()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text;
begin
  if tg_op = 'UPDATE' then
    new.join_code := old.join_code;
    return new;
  end if;
  if new.kind <> 'live' then
    new.join_code := null;
    return new;
  end if;
  loop
    select string_agg(substr(alphabet, 1 + floor(random() * length(alphabet))::integer, 1), '')
      into code from generate_series(1, 6);
    exit when not exists (select 1 from public.questions q where q.join_code = code);
  end loop;
  new.join_code := code;
  return new;
end;
$$;

create trigger assign_join_code
  before insert or update on public.questions
  for each row execute function private.assign_join_code();

-- Public questions still need a complete profile. Live polls take guests too; whatever the
-- voter's profile has (age, place) is copied, and nothing else.
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
  select * into q from public.questions where id = new.question_id;
  if p.id is null then
    raise exception 'Sign in before voting' using errcode = '42501';
  end if;
  if q.kind = 'public' and (p.district_code is null or p.age_band is null or p.consented_at is null) then
    raise exception 'Complete your profile before voting' using errcode = '42501';
  end if;

  if q.kind = 'live' and not private.created_by_owner(q.created_by) then
    select h.max_voters_per_poll into lim from public.hosts h where h.user_id = q.created_by;
    if (select count(*) from public.votes v where v.question_id = new.question_id) >= coalesce(lim, 0) then
      raise exception 'This poll has reached its voter limit' using errcode = '23514';
    end if;
  end if;

  if p.district_code is not null and p.age_band is not null then
    new.region        := p.region;
    new.district_code := p.district_code;
    new.age_band      := p.age_band;
  else
    new.region        := null;
    new.district_code := null;
    new.age_band      := null;
  end if;
  new.created_at := now();
  return new;
end;
$$;

-- Guests (anonymous sign-ins) don't get the public feed.
drop policy "questions: read published" on public.questions;
create policy "questions: read published" on public.questions
  for select to authenticated
  using (kind = 'public' and moderation = 'ok' and status in ('open', 'closed') and opens_at <= now()
         and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false));

-- The public-question result functions stay public-only, so a live poll's results mode
-- (e.g. presenter only) can't be bypassed through them.
create or replace function public.get_results(p_question_id uuid)
returns table (option_id uuid, label text, "position" smallint, votes integer, is_mine boolean)
language sql stable security definer set search_path = ''
as $$
  with mine as (
    select v.option_id from public.votes v
    join public.questions q on q.id = v.question_id and q.kind = 'public'
    where v.question_id = p_question_id and v.user_id = auth.uid()
  )
  select o.id, o.label, o.position, coalesce(c.votes, 0), o.id = m.option_id
  from mine m
  join public.options o on o.question_id = p_question_id
  left join public.option_counts c on c.option_id = o.id
  order by o.position;
$$;

create or replace function public.get_breakdown(p_question_id uuid, p_dimension text default 'age')
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
  join public.questions q on q.id = v.question_id and q.kind = 'public'
  where v.question_id = p_question_id and v.user_id = auth.uid();
  if my_option is null then
    return; -- not voted, or not a public question: nothing
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

-- ---------------------------------------------------------------------------
-- Audience
-- ---------------------------------------------------------------------------

-- A live poll by its join code, as the audience may see it, or null.
-- results: only when results_mode is 'live', or 'after_vote' once the caller voted (or the
-- poll closed). 'presenter' polls never show results here.
create function public.live_poll(p_code text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  q    public.questions%rowtype;
  mine uuid;
  show boolean;
begin
  select * into q from public.questions
   where join_code = upper(btrim(p_code)) and kind = 'live';
  if q.id is null or q.moderation <> 'ok' or q.status = 'draft' then
    return null;
  end if;
  select v.option_id into mine from public.votes v where v.question_id = q.id and v.user_id = auth.uid();
  show := q.results_mode = 'live'
          or (q.results_mode = 'after_vote' and (mine is not null or q.status = 'closed'));
  return jsonb_build_object(
    'id', q.id,
    'code', q.join_code,
    'topic', q.topic,
    'body', q.body,
    'status', q.status,
    'open', private.question_is_open(q.id),
    'results_mode', q.results_mode,
    'closes_at', q.closes_at,
    'my_option', mine,
    'options', (select jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label) order by o.position)
                from public.options o where o.question_id = q.id),
    'results', case when show then
                 (select jsonb_agg(jsonb_build_object('option_id', o.id, 'votes', coalesce(c.votes, 0)) order by o.position)
                  from public.options o left join public.option_counts c on c.option_id = o.id
                  where o.question_id = q.id)
               end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Hosts
-- ---------------------------------------------------------------------------

-- Create a live poll with 2-4 options in one call. Runs as the caller, so the host RLS rules,
-- the approval rule for politics polls and the open-poll limit all apply.
create function public.host_create_live_poll(
  p_topic text, p_body text, p_options text[], p_sensitive boolean,
  p_results_mode public.results_mode, p_open boolean
)
returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  qid uuid;
  labels text[];
begin
  if not (private.is_host() or public.is_admin()) then
    raise exception 'Only approved hosts can create Pulse Live polls' using errcode = '42501';
  end if;
  select array_agg(btrim(l) order by i) into labels
  from unnest(p_options) with ordinality as t(l, i)
  where btrim(l) <> '';
  if coalesce(array_length(labels, 1), 0) not between 2 and 4 then
    raise exception 'A poll needs 2 to 4 options' using errcode = '22023';
  end if;
  if (select count(distinct lower(l)) from unnest(labels) l) <> array_length(labels, 1) then
    raise exception 'Options must be different' using errcode = '22023';
  end if;

  insert into public.questions (topic, body, status, kind, sensitive, results_mode, created_by)
  values (btrim(p_topic), btrim(p_body), case when p_open then 'open' else 'draft' end::public.question_status,
          'live', coalesce(p_sensitive, false), p_results_mode, auth.uid())
  returning id into qid;

  insert into public.options (question_id, label, position)
  select qid, l, i::smallint from unnest(labels) with ordinality as t(l, i);

  return qid;
end;
$$;

-- Vote totals and voter counts for the caller's own live polls (the owner sees all).
create function public.host_poll_totals()
returns table (option_id uuid, question_id uuid, votes integer)
language sql stable security definer set search_path = ''
as $$
  select c.option_id, c.question_id, c.votes
  from public.option_counts c
  join public.questions q on q.id = c.question_id
  where q.kind = 'live' and (q.created_by = auth.uid() or public.is_admin());
$$;

revoke all on function public.live_poll(text) from public, anon;
revoke all on function public.host_create_live_poll(text, text, text[], boolean, public.results_mode, boolean) from public, anon;
revoke all on function public.host_poll_totals() from public, anon;
grant execute on function public.live_poll(text) to authenticated;
grant execute on function public.host_create_live_poll(text, text, text[], boolean, public.results_mode, boolean) to authenticated;
grant execute on function public.host_poll_totals() to authenticated;
