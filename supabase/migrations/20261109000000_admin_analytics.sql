-- Owner analytics, phase 1 (PLAN.md milestone 9).
--
-- Admin-only (role=admin with a 2FA session), aggregates only: no function here returns a
-- user id or a single person's vote. Any group or time slot with fewer than
-- private.analytics_min_group() voters has its per-option counts hidden (null), so the
-- owner can't single out individuals either.

-- Smallest group whose answer split the owner may see. Change it with a new migration.
create function private.analytics_min_group()
returns integer
language sql immutable
as $$ select 5 $$;

-- Votes per option within each age band ('age') or region ('region').
-- Groups under the minimum return voters but votes = null.
create function public.admin_question_breakdown(p_question_id uuid, p_dimension text default 'age')
returns table (grp text, voters integer, option_id uuid, votes integer)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if p_dimension not in ('age', 'region') then
    raise exception 'Unknown breakdown: %', p_dimension using errcode = '22023';
  end if;

  return query
    with v as (
      select case when p_dimension = 'age' then v.age_band::text
                  else initcap(lower(btrim(v.region))) end as grp,
             v.option_id
      from public.votes v
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
    order by g.grp, o.position;
end;
$$;

-- Votes per hour or day (in the viewer's time zone), with the split per option.
-- Time slots under the minimum return voters but votes = null.
create function public.admin_question_timeline(
  p_question_id uuid, p_bucket text default 'hour', p_tz text default 'UTC'
)
returns table (bucket timestamptz, voters integer, option_id uuid, votes integer)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
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

revoke all on function public.admin_question_breakdown(uuid, text) from public, anon;
revoke all on function public.admin_question_timeline(uuid, text, text) from public, anon;
grant execute on function public.admin_question_breakdown(uuid, text) to authenticated;
grant execute on function public.admin_question_timeline(uuid, text, text) to authenticated;
