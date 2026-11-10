-- Geographic radius per question (PLAN.md milestone 11).
--
--  * The owner (any question) or a host (their own live polls) can limit voting to people within
--    a radius of a point: geo_lat / geo_lng / geo_radius_m, plus geo_label, the place name
--    voters see ("Town Hall, Mysuru"). All four are set together, or none (vote from anywhere).
--  * Voting on such a question goes through cast_vote_at(), which receives the voter's
--    location, checks the distance and inserts the vote. The location is used for that check
--    only and never stored. A direct insert into votes is refused for these questions.
--  * Honest limits: a determined person can fake their location; phones are accurate to about
--    10-50 m outdoors and worse indoors; laptops often only know the city. Radius minimum 100 m.

alter table public.questions
  add column geo_lat      double precision,
  add column geo_lng      double precision,
  add column geo_radius_m integer,
  add column geo_label    text,
  add constraint questions_geofence_check check (
    num_nonnulls(geo_lat, geo_lng, geo_radius_m, geo_label) = 0
    or (num_nonnulls(geo_lat, geo_lng, geo_radius_m, geo_label) = 4
        and geo_lat between -90 and 90 and geo_lng between -180 and 180
        and geo_radius_m between 100 and 50000 and char_length(btrim(geo_label)) between 1 and 60)
  );

-- Great-circle distance in metres.
create function private.distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision
language sql immutable
as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)));
$$;

-- "450 m", "2.3 km"
create function private.fmt_distance(m double precision)
returns text
language sql immutable
as $$
  select case when m < 1000 then (round(m / 10) * 10)::integer || ' m'
              else to_char(m / 1000.0, 'FM999990.0') || ' km' end;
$$;

-- Vote on a location-limited question. Runs as the caller, so every RLS rule still applies.
-- p_accuracy_m: the browser's reported accuracy; very imprecise fixes are refused, and a little
-- of the accuracy (at most 50 m) is allowed as slack at the edge of the circle.
create function public.cast_vote_at(
  p_question_id uuid, p_option_id uuid, p_lat double precision, p_lng double precision, p_accuracy_m double precision
)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  g record;
  d double precision;
begin
  select * into g from private.geofence_of(p_question_id);
  if g.radius_m is not null then
    if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
      raise exception 'Share your location to vote on this question' using errcode = '22023';
    end if;
    if coalesce(p_accuracy_m, 1e9) > 1000 then
      raise exception 'Your location is too imprecise (about ±%). Try on a phone with location turned on, ideally outdoors.',
        private.fmt_distance(coalesce(p_accuracy_m, 1e9)) using errcode = '22023';
    end if;
    d := private.distance_m(g.lat, g.lng, p_lat, p_lng);
    if d > g.radius_m + least(p_accuracy_m, 50) then
      raise exception 'You seem to be about % from %. Only people within % can vote.',
        private.fmt_distance(d), g.label, private.fmt_distance(g.radius_m) using errcode = '42501';
    end if;
    perform set_config('pulse.geo_ok', p_question_id::text, true);
  end if;
  insert into public.votes (question_id, option_id) values (p_question_id, p_option_id);
  perform set_config('pulse.geo_ok', '', true);
end;
$$;

-- The geofence of a question, readable by cast_vote_at even when the caller can't read the
-- question row itself (guests in a live poll).
create function private.geofence_of(qid uuid)
returns table (lat double precision, lng double precision, radius_m integer, label text)
language sql stable security definer set search_path = ''
as $$
  select q.geo_lat, q.geo_lng, q.geo_radius_m, q.geo_label from public.questions q where q.id = qid;
$$;
grant execute on function private.geofence_of(uuid) to authenticated;

-- prepare_vote, as in 20261112000000_pulse_live.sql, plus: a location-limited question only
-- takes votes that came through cast_vote_at's distance check.
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
  if q.geo_radius_m is not null and coalesce(current_setting('pulse.geo_ok', true), '') <> q.id::text then
    raise exception 'Share your location to vote on this question' using errcode = '42501';
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

-- live_poll, as in 20261112000000_pulse_live.sql, plus the poll's place limit (label and radius
-- only; the centre point isn't sent to the audience).
create or replace function public.live_poll(p_code text)
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
    'geo', case when q.geo_radius_m is not null
                then jsonb_build_object('label', q.geo_label, 'radius_m', q.geo_radius_m) end,
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

revoke all on function public.cast_vote_at(uuid, uuid, double precision, double precision, double precision) from public, anon;
grant execute on function public.cast_vote_at(uuid, uuid, double precision, double precision, double precision) to authenticated;
