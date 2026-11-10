-- Hosts and audiences, phase C (PLAN.md milestone 10): hosts by application, reports, and
-- analytics for hosts' own polls.
--
--  * apply_to_host(): a signed-in member (not a guest) applies; the owner approves or rejects
--    in the console. Closed while platform_settings.applications_paused. A rejected applicant
--    can apply again after 30 days.
--  * reports: anyone who can see a live poll (guests too) can report it once. Reports never
--    hide anything by themselves; the owner reviews them and hides the poll or dismisses them.
--  * admin_question_breakdown / admin_question_timeline now also serve a host for their own
--    live polls (same small-group hiding). Guests' votes carry no age or place and show as
--    "Not given".

alter table public.admin_audit_log drop constraint admin_audit_log_action_check;
alter table public.admin_audit_log add constraint admin_audit_log_action_check
  check (action in ('create', 'update', 'close', 'reopen', 'delete', 'hide', 'restore', 'approve',
                    'host', 'settings', 'apply', 'report'));

-- ---------------------------------------------------------------------------
-- Applying to host
-- ---------------------------------------------------------------------------

create function public.apply_to_host(p_organisation text, p_note text, p_agree boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  h public.hosts%rowtype;
  p public.profiles%rowtype;
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Sign in to apply' using errcode = '42501';
  end if;
  select * into p from public.profiles where id = auth.uid();
  if p.consented_at is null then
    raise exception 'Finish your profile first' using errcode = '42501';
  end if;
  if (select s.applications_paused from public.platform_settings s) then
    raise exception 'Host applications are closed right now. Please try again later.' using errcode = '42501';
  end if;
  if p_agree is not true then
    raise exception 'Please agree to the host rules' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_note, ''))) not between 20 and 500 then
    raise exception 'Tell us in 20 to 500 characters how you would use Pulse Live' using errcode = '22023';
  end if;

  select * into h from public.hosts where user_id = auth.uid();
  if h.status in ('approved', 'pending') then
    raise exception 'You have already applied' using errcode = '23505';
  elsif h.status = 'suspended' then
    raise exception 'Your hosting is suspended. Contact the Pulse team.' using errcode = '42501';
  elsif h.status = 'rejected' and h.decided_at > now() - interval '30 days' then
    raise exception 'You can apply again from %', to_char(h.decided_at + interval '30 days', 'DD Mon YYYY') using errcode = '42501';
  end if;

  insert into public.hosts (user_id, status, organisation, note, created_at)
  values (auth.uid(), 'pending', nullif(left(btrim(coalesce(p_organisation, '')), 80), ''), btrim(p_note), now())
  on conflict (user_id) do update
    set status = 'pending', organisation = excluded.organisation, note = excluded.note,
        created_at = now(), decided_at = null, decided_by = null;
  perform private.log_owner_action('apply', p.display_name || ' applied to host');
end;
$$;

-- The owner's host list now includes each applicant's note.
drop function public.admin_list_hosts();
create function public.admin_list_hosts()
returns table (
  user_id uuid, display_name text, email text, status public.host_status, organisation text, note text,
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
    select h.user_id, p.display_name, u.email::text, h.status, h.organisation, h.note,
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

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------

create type public.report_reason as enum ('offensive', 'misleading', 'spam', 'political', 'other');
create type public.report_status as enum ('open', 'resolved', 'dismissed');

create table public.reports (
  id          bigint generated always as identity primary key,
  question_id uuid not null references public.questions (id) on delete cascade,
  reporter    uuid not null references public.profiles (id) on delete cascade,
  reason      public.report_reason not null,
  detail      text check (char_length(detail) <= 300),
  status      public.report_status not null default 'open',
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id) on delete set null,
  unique (question_id, reporter) -- one report per person per poll
);
create index reports_open_idx on public.reports (question_id) where status = 'open';

-- RLS on, no policies, no grants: written by report_poll, read by the owner's functions.
alter table public.reports enable row level security;
revoke all on public.reports from anon, authenticated;

-- Report a live poll you can see. A second report from the same person is ignored.
create function public.report_poll(p_question_id uuid, p_reason public.report_reason, p_detail text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if not exists (select 1 from public.questions q
                 where q.id = p_question_id and q.kind = 'live' and q.moderation = 'ok' and q.status <> 'draft') then
    raise exception 'Poll not found' using errcode = 'P0002';
  end if;
  insert into public.reports (question_id, reporter, reason, detail)
  values (p_question_id, auth.uid(), p_reason, nullif(left(btrim(coalesce(p_detail, '')), 300), ''))
  on conflict (question_id, reporter) do nothing;
end;
$$;

-- Polls with open reports, most reported first (owner only).
create function public.admin_list_reports()
returns table (
  question_id uuid, body text, join_code text, moderation public.moderation_state, host_email text,
  open_reports integer, reasons text[], details text[], last_reported timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  return query
    select q.id, q.body, q.join_code, q.moderation, u.email::text,
           count(*)::integer,
           array_agg(distinct r.reason::text),
           (array_agg(r.detail order by r.created_at desc) filter (where r.detail is not null))[1:5],
           max(r.created_at)
    from public.reports r
    join public.questions q on q.id = r.question_id
    left join auth.users u on u.id = q.created_by
    where r.status = 'open'
    group by q.id, q.body, q.join_code, q.moderation, u.email
    order by count(*) desc, max(r.created_at) desc;
end;
$$;

-- Close a poll's open reports: hide the poll (resolved) or keep it (dismissed).
create function public.admin_resolve_reports(p_question_id uuid, p_hide boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  n integer;
  body text;
begin
  if not public.is_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  update public.reports
     set status = case when p_hide then 'resolved' else 'dismissed' end::public.report_status,
         resolved_at = now(), resolved_by = auth.uid()
   where question_id = p_question_id and status = 'open';
  get diagnostics n = row_count;
  if p_hide then
    update public.questions set moderation = 'hidden' where id = p_question_id; -- audited as 'hide'
  end if;
  select q.body into body from public.questions q where q.id = p_question_id;
  perform private.log_owner_action('report',
    (case when p_hide then 'hid poll after ' else 'dismissed ' end) || n || ' report(s): ' || coalesce(body, '?'));
end;
$$;

-- ---------------------------------------------------------------------------
-- Analytics for hosts' own polls
-- ---------------------------------------------------------------------------

-- The owner for any poll; an approved host for their own live polls.
create function private.can_view_analytics(qid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_admin() or (private.is_host() and exists (
    select 1 from public.questions q where q.id = qid and q.kind = 'live' and q.created_by = auth.uid()));
$$;
grant execute on function private.can_view_analytics(uuid) to authenticated;

create or replace function public.admin_question_breakdown(p_question_id uuid, p_dimension text default 'age')
returns table (grp text, voters integer, option_id uuid, votes integer)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.can_view_analytics(p_question_id) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if p_dimension not in ('age', 'region', 'state', 'district') then
    raise exception 'Unknown breakdown: %', p_dimension using errcode = '22023';
  end if;

  return query
    with v as (
      select case p_dimension
               when 'age' then coalesce(v.age_band::text, 'Not given')
               when 'region' then coalesce(initcap(lower(btrim(v.region))), 'Not given')
               when 'state' then coalesce(s.name, 'Not recorded')
               else coalesce(d.name || ', ' || s.name, 'Not recorded')
             end as grp,
             v.option_id
      from public.votes v
      left join public.districts d on d.code = v.district_code
      left join public.states s on s.code = d.state_code
      where v.question_id = p_question_id
    ), g as (
      select v.grp, count(*)::integer as voters from v group by 1
    )
    select g.grp,
           g.voters,
           o.id,
           case when g.voters < private.analytics_min_group() then null
                else (select count(*)::integer from v where v.grp = g.grp and v.option_id = o.id) end
    from g
    cross join public.options o
    where o.question_id = p_question_id
    order by g.voters desc, g.grp, o.position;
end;
$$;

create or replace function public.admin_question_timeline(
  p_question_id uuid, p_bucket text default 'hour', p_tz text default 'UTC'
)
returns table (bucket timestamptz, voters integer, option_id uuid, votes integer)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.can_view_analytics(p_question_id) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if p_bucket not in ('hour', 'day') then
    raise exception 'Unknown time slot: %', p_bucket using errcode = '22023';
  end if;

  return query
    with v as (
      select date_trunc(p_bucket, v.created_at, p_tz) as bucket, v.option_id
      from public.votes v
      where v.question_id = p_question_id
    ), b as (
      select v.bucket, count(*)::integer as voters from v group by 1
    )
    select b.bucket,
           b.voters,
           o.id,
           case when b.voters < private.analytics_min_group() then null
                else (select count(*)::integer from v where v.bucket = b.bucket and v.option_id = o.id) end
    from b
    cross join public.options o
    where o.question_id = p_question_id
    order by b.bucket, o.position;
end;
$$;

revoke all on function public.apply_to_host(text, text, boolean) from public, anon;
revoke all on function public.admin_list_hosts() from public, anon;
revoke all on function public.report_poll(uuid, public.report_reason, text) from public, anon;
revoke all on function public.admin_list_reports() from public, anon;
revoke all on function public.admin_resolve_reports(uuid, boolean) from public, anon;
grant execute on function public.apply_to_host(text, text, boolean) to authenticated;
grant execute on function public.admin_list_hosts() to authenticated;
grant execute on function public.report_poll(uuid, public.report_reason, text) to authenticated;
grant execute on function public.admin_list_reports() to authenticated;
grant execute on function public.admin_resolve_reports(uuid, boolean) to authenticated;
