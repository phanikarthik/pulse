-- Owner analytics, phase 2 (PLAN.md milestone 9): a fixed list of places and question views.
--
--  * states / districts: India's 36 states and union territories and their districts, from
--    the Local Government Directory (LGD codes are the keys). Readable by everyone, so the
--    sign-up form can offer them before sign-in. The rows are inserted at the end of this file.
--  * profiles.district_code replaces typed regions. profiles.region is kept, now always set
--    from the district ("Mysuru, Karnataka") by trigger, so older code and votes keep working.
--  * votes.district_code is copied from the profile by prepare_vote, like region and age band.
--    Votes cast before this migration have no district.
--  * question_views: one row per person per question they opened (no timestamp), written only
--    through mark_question_seen(); unreadable except as admin totals.

-- ---------------------------------------------------------------------------
-- Places
-- ---------------------------------------------------------------------------

create table public.states (
  code  smallint primary key, -- LGD state code
  name  text not null unique,
  is_ut boolean not null default false
);

create table public.districts (
  code       integer primary key, -- LGD district code
  state_code smallint not null references public.states (code),
  name       text not null,
  unique (state_code, name)
);
create index districts_state_idx on public.districts (state_code);

alter table public.states    enable row level security;
alter table public.districts enable row level security;
revoke all on public.states, public.districts from anon, authenticated;
grant select on public.states, public.districts to anon, authenticated;
create policy "states: read all" on public.states for select to anon, authenticated using (true);
create policy "districts: read all" on public.districts for select to anon, authenticated using (true);

-- "Mysuru, Karnataka"
create function private.place_label(p_district integer)
returns text
language sql stable security definer set search_path = ''
as $$
  select d.name || ', ' || s.name
  from public.districts d join public.states s on s.code = d.state_code
  where d.code = p_district;
$$;

-- ---------------------------------------------------------------------------
-- Profiles and votes
-- ---------------------------------------------------------------------------

alter table public.profiles add column district_code integer references public.districts (code);
alter table public.votes add column district_code integer references public.districts (code);

-- region follows the district; a typed region can no longer be saved.
create function private.sync_profile_region()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.district_code is not null then
    new.region := private.place_label(new.district_code);
  elsif tg_op = 'UPDATE' then
    new.region := old.region;
  end if;
  return new;
end;
$$;

create trigger sync_profile_region
  before insert or update on public.profiles
  for each row execute function private.sync_profile_region();

revoke update on public.profiles from authenticated;
grant update (display_name, district_code, age_band) on public.profiles to authenticated;

-- Signup now sends district_code instead of region.
create or replace function private.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  band text := meta ->> 'age_band';
  dist integer := case when meta ->> 'district_code' ~ '^\d{1,9}$' then (meta ->> 'district_code')::integer end;
  name text := left(btrim(coalesce(nullif(btrim(meta ->> 'display_name'), ''),
                                   nullif(btrim(meta ->> 'full_name'), ''),
                                   split_part(coalesce(new.email, ''), '@', 1),
                                   'Voter')), 40);
begin
  insert into public.profiles (id, display_name, district_code, age_band, consented_at, role)
  values (
    new.id,
    coalesce(nullif(name, ''), 'Voter'),
    (select d.code from public.districts d where d.code = dist),
    case when band in ('18-24', '25-34', '35-44', '45-59', '60+') then band::public.age_band end,
    case when meta ->> 'adult' = 'true' and meta ->> 'consent' = 'true' then now() end,
    'voter'
  );
  return new;
end;
$$;

-- Voting needs a district now (people with only a typed region are asked to pick one).
create or replace function private.prepare_vote()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  p public.profiles%rowtype;
begin
  select * into p from public.profiles where id = new.user_id;
  if p.id is null or p.district_code is null or p.age_band is null or p.consented_at is null then
    raise exception 'Complete your profile before voting' using errcode = '42501';
  end if;
  new.region        := p.region;
  new.district_code := p.district_code;
  new.age_band      := p.age_band;
  new.created_at    := now();
  return new;
end;
$$;

-- Google sign-ups and people who still have a typed region fill this in once.
drop function public.complete_profile(text, text, public.age_band, boolean, boolean);
create function public.complete_profile(
  p_display_name text, p_district_code integer, p_age_band public.age_band, p_adult boolean, p_consent boolean
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
  if not exists (select 1 from public.districts d where d.code = p_district_code) then
    raise exception 'Pick your state and district' using errcode = '22023';
  end if;
  update public.profiles
     set display_name  = btrim(p_display_name),
         district_code = p_district_code,
         age_band      = p_age_band,
         consented_at  = coalesce(consented_at, now())
   where id = auth.uid();
end;
$$;

revoke all on function public.complete_profile(text, integer, public.age_band, boolean, boolean) from public, anon;
grant execute on function public.complete_profile(text, integer, public.age_band, boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Question views (turnout)
-- ---------------------------------------------------------------------------

create table public.question_views (
  question_id uuid not null references public.questions (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  primary key (question_id, user_id)
);
create index question_views_user_idx on public.question_views (user_id);

-- RLS on, no policies, no grants: written by mark_question_seen, read as admin totals.
alter table public.question_views enable row level security;
revoke all on public.question_views from anon, authenticated;

-- Called when a signed-in person opens a published question. Repeat calls change nothing.
create function public.mark_question_seen(p_question_id uuid)
returns void
language sql volatile security definer set search_path = ''
as $$
  insert into public.question_views (question_id, user_id)
  select q.id, auth.uid()
  from public.questions q
  where q.id = p_question_id and q.status in ('open', 'closed') and auth.uid() is not null
  on conflict do nothing;
$$;

-- Per question: people who opened it (or voted, for votes cast before views were recorded)
-- and people who voted.
create function public.admin_question_turnout()
returns table (question_id uuid, viewers integer, voters integer)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  return query
    select q.id,
           (select count(*)::integer from (
              select w.user_id from public.question_views w where w.question_id = q.id
              union
              select v.user_id from public.votes v where v.question_id = q.id) seen),
           (select count(*)::integer from public.votes v where v.question_id = q.id)
    from public.questions q;
end;
$$;

revoke all on function public.mark_question_seen(uuid) from public, anon;
revoke all on function public.admin_question_turnout() from public, anon;
grant execute on function public.mark_question_seen(uuid) to authenticated;
grant execute on function public.admin_question_turnout() to authenticated;

-- ---------------------------------------------------------------------------
-- Breakdowns by state and district (same signature, so existing grants stay)
-- ---------------------------------------------------------------------------

create or replace function public.admin_question_breakdown(p_question_id uuid, p_dimension text default 'age')
returns table (grp text, voters integer, option_id uuid, votes integer)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if p_dimension not in ('age', 'region', 'state', 'district') then
    raise exception 'Unknown breakdown: %', p_dimension using errcode = '22023';
  end if;

  return query
    with v as (
      select case p_dimension
               when 'age' then v.age_band::text
               when 'region' then initcap(lower(btrim(v.region)))
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

-- ---------------------------------------------------------------------------
-- Place list (LGD, observed 2026-11-09)
-- ---------------------------------------------------------------------------

insert into public.states (code, name, is_ut) values
  (35, 'Andaman and Nicobar Islands', true),
  (28, 'Andhra Pradesh', false),
  (12, 'Arunachal Pradesh', false),
  (18, 'Assam', false),
  (10, 'Bihar', false),
  (4, 'Chandigarh', true),
  (22, 'Chhattisgarh', false),
  (38, 'Dadra and Nagar Haveli and Daman and Diu', true),
  (7, 'Delhi', true),
  (30, 'Goa', false),
  (24, 'Gujarat', false),
  (6, 'Haryana', false),
  (2, 'Himachal Pradesh', false),
  (1, 'Jammu and Kashmir', true),
  (20, 'Jharkhand', false),
  (29, 'Karnataka', false),
  (32, 'Kerala', false),
  (37, 'Ladakh', true),
  (31, 'Lakshadweep', true),
  (23, 'Madhya Pradesh', false),
  (27, 'Maharashtra', false),
  (14, 'Manipur', false),
  (17, 'Meghalaya', false),
  (15, 'Mizoram', false),
  (13, 'Nagaland', false),
  (21, 'Odisha', false),
  (34, 'Puducherry', true),
  (3, 'Punjab', false),
  (8, 'Rajasthan', false),
  (11, 'Sikkim', false),
  (33, 'Tamil Nadu', false),
  (36, 'Telangana', false),
  (16, 'Tripura', false),
  (9, 'Uttar Pradesh', false),
  (5, 'Uttarakhand', false),
  (19, 'West Bengal', false);

insert into public.districts (code, state_code, name) values
  (1, 1, 'Anantnag'),
  (623, 1, 'Bandipora'),
  (3, 1, 'Baramulla'),
  (2, 1, 'Budgam'),
  (4, 1, 'Doda'),
  (626, 1, 'Ganderbal'),
  (5, 1, 'Jammu'),
  (7, 1, 'Kathua'),
  (620, 1, 'Kishtwar'),
  (622, 1, 'Kulgam'),
  (8, 1, 'Kupwara'),
  (10, 1, 'Poonch'),
  (11, 1, 'Pulwama'),
  (12, 1, 'Rajouri'),
  (621, 1, 'Ramban'),
  (627, 1, 'Reasi'),
  (624, 1, 'Samba'),
  (625, 1, 'Shopian'),
  (13, 1, 'Srinagar'),
  (14, 1, 'Udhampur'),
  (15, 2, 'Bilaspur'),
  (16, 2, 'Chamba'),
  (17, 2, 'Hamirpur'),
  (18, 2, 'Kangra'),
  (19, 2, 'Kinnaur'),
  (20, 2, 'Kullu'),
  (21, 2, 'Lahaul and Spiti'),
  (22, 2, 'Mandi'),
  (23, 2, 'Shimla'),
  (24, 2, 'Sirmaur'),
  (25, 2, 'Solan'),
  (26, 2, 'Una'),
  (27, 3, 'Amritsar'),
  (605, 3, 'Barnala'),
  (28, 3, 'Bathinda'),
  (29, 3, 'Faridkot'),
  (30, 3, 'Fatehgarh Sahib'),
  (651, 3, 'Fazilka'),
  (31, 3, 'Ferozepur'),
  (32, 3, 'Gurdaspur'),
  (33, 3, 'Hoshiarpur'),
  (34, 3, 'Jalandhar'),
  (35, 3, 'Kapurthala'),
  (36, 3, 'Ludhiana'),
  (737, 3, 'Malerkotla'),
  (37, 3, 'Mansa'),
  (38, 3, 'Moga'),
  (662, 3, 'Pathankot'),
  (41, 3, 'Patiala'),
  (42, 3, 'Rupnagar'),
  (608, 3, 'S.A.S Nagar'),
  (43, 3, 'Sangrur'),
  (40, 3, 'Shahid Bhagat Singh Nagar'),
  (39, 3, 'Sri Muktsar Sahib'),
  (609, 3, 'Tarn Taran'),
  (44, 4, 'Chandigarh'),
  (45, 5, 'Almora'),
  (46, 5, 'Bageshwar'),
  (47, 5, 'Chamoli'),
  (48, 5, 'Champawat'),
  (49, 5, 'Dehradun'),
  (50, 5, 'Haridwar'),
  (51, 5, 'Nainital'),
  (52, 5, 'Pauri Garhwal'),
  (53, 5, 'Pithoragarh'),
  (54, 5, 'Rudraprayag'),
  (55, 5, 'Tehri Garhwal'),
  (56, 5, 'Udham Singh Nagar'),
  (57, 5, 'Uttarkashi'),
  (58, 6, 'Ambala'),
  (59, 6, 'Bhiwani'),
  (701, 6, 'Charkhi Dadri'),
  (60, 6, 'Faridabad'),
  (61, 6, 'Fatehabad'),
  (62, 6, 'Gurugram'),
  (792, 6, 'Hansi'),
  (63, 6, 'Hisar'),
  (64, 6, 'Jhajjar'),
  (65, 6, 'Jind'),
  (66, 6, 'Kaithal'),
  (67, 6, 'Karnal'),
  (68, 6, 'Kurukshetra'),
  (69, 6, 'Mahendragarh'),
  (604, 6, 'Nuh'),
  (619, 6, 'Palwal'),
  (70, 6, 'Panchkula'),
  (71, 6, 'Panipat'),
  (72, 6, 'Rewari'),
  (73, 6, 'Rohtak'),
  (74, 6, 'Sirsa'),
  (75, 6, 'Sonipat'),
  (76, 6, 'Yamunanagar'),
  (77, 7, 'Central'),
  (796, 7, 'Central North'),
  (78, 7, 'East'),
  (79, 7, 'New Delhi'),
  (80, 7, 'North'),
  (81, 7, 'North East'),
  (82, 7, 'North West'),
  (795, 7, 'Old Delhi'),
  (794, 7, 'Outer North'),
  (83, 7, 'South'),
  (670, 7, 'South East'),
  (84, 7, 'South West'),
  (85, 7, 'West'),
  (86, 8, 'Ajmer'),
  (87, 8, 'Alwar'),
  (775, 8, 'Balotra'),
  (88, 8, 'Banswara'),
  (89, 8, 'Baran'),
  (90, 8, 'Barmer'),
  (774, 8, 'Beawar'),
  (91, 8, 'Bharatpur'),
  (92, 8, 'Bhilwara'),
  (93, 8, 'Bikaner'),
  (94, 8, 'Bundi'),
  (95, 8, 'Chittorgarh'),
  (96, 8, 'Churu'),
  (97, 8, 'Dausa'),
  (767, 8, 'Deeg'),
  (98, 8, 'Dholpur'),
  (768, 8, 'Didwana-Kuchaman'),
  (99, 8, 'Dungarpur'),
  (100, 8, 'Ganganagar'),
  (101, 8, 'Hanumangarh'),
  (102, 8, 'Jaipur'),
  (103, 8, 'Jaisalmer'),
  (104, 8, 'Jalore'),
  (105, 8, 'Jhalawar'),
  (106, 8, 'Jhunjhunu'),
  (107, 8, 'Jodhpur'),
  (108, 8, 'Karauli'),
  (770, 8, 'Khairthal-Tijara'),
  (109, 8, 'Kota'),
  (782, 8, 'Kotputli-Behror'),
  (110, 8, 'Nagaur'),
  (111, 8, 'Pali'),
  (772, 8, 'Phalodi'),
  (629, 8, 'Pratapgarh'),
  (112, 8, 'Rajsamand'),
  (777, 8, 'Salumbar'),
  (113, 8, 'Sawai Madhopur'),
  (114, 8, 'Sikar'),
  (115, 8, 'Sirohi'),
  (116, 8, 'Tonk'),
  (117, 8, 'Udaipur'),
  (118, 9, 'Agra'),
  (119, 9, 'Aligarh'),
  (121, 9, 'Ambedkar Nagar'),
  (640, 9, 'Amethi'),
  (154, 9, 'Amroha'),
  (122, 9, 'Auraiya'),
  (140, 9, 'Ayodhya'),
  (123, 9, 'Azamgarh'),
  (124, 9, 'Baghpat'),
  (125, 9, 'Bahraich'),
  (126, 9, 'Ballia'),
  (127, 9, 'Balrampur'),
  (128, 9, 'Banda'),
  (129, 9, 'Bara Banki'),
  (130, 9, 'Bareilly'),
  (131, 9, 'Basti'),
  (179, 9, 'Bhadohi'),
  (132, 9, 'Bijnor'),
  (133, 9, 'Budaun'),
  (134, 9, 'Bulandshahr'),
  (135, 9, 'Chandauli'),
  (136, 9, 'Chitrakoot'),
  (137, 9, 'Deoria'),
  (138, 9, 'Etah'),
  (139, 9, 'Etawah'),
  (141, 9, 'Farrukhabad'),
  (142, 9, 'Fatehpur'),
  (143, 9, 'Firozabad'),
  (144, 9, 'Gautam Buddha Nagar'),
  (145, 9, 'Ghaziabad'),
  (146, 9, 'Ghazipur'),
  (147, 9, 'Gonda'),
  (148, 9, 'Gorakhpur'),
  (149, 9, 'Hamirpur'),
  (661, 9, 'Hapur'),
  (150, 9, 'Hardoi'),
  (163, 9, 'Hathras'),
  (151, 9, 'Jalaun'),
  (152, 9, 'Jaunpur'),
  (153, 9, 'Jhansi'),
  (155, 9, 'Kannauj'),
  (156, 9, 'Kanpur Dehat'),
  (157, 9, 'Kanpur Nagar'),
  (633, 9, 'Kasganj'),
  (158, 9, 'Kaushambi'),
  (159, 9, 'Kheri'),
  (160, 9, 'Kushinagar'),
  (161, 9, 'Lalitpur'),
  (162, 9, 'Lucknow'),
  (165, 9, 'Mahoba'),
  (164, 9, 'Mahrajganj'),
  (166, 9, 'Mainpuri'),
  (167, 9, 'Mathura'),
  (168, 9, 'Mau'),
  (169, 9, 'Meerut'),
  (170, 9, 'Mirzapur'),
  (171, 9, 'Moradabad'),
  (172, 9, 'Muzaffarnagar'),
  (173, 9, 'Pilibhit'),
  (174, 9, 'Pratapgarh'),
  (120, 9, 'Prayagraj'),
  (175, 9, 'Rae Bareli'),
  (176, 9, 'Rampur'),
  (177, 9, 'Saharanpur'),
  (659, 9, 'Sambhal'),
  (178, 9, 'Sant Kabir Nagar'),
  (180, 9, 'Shahjahanpur'),
  (660, 9, 'Shamli'),
  (181, 9, 'Shrawasti'),
  (182, 9, 'Siddharthnagar'),
  (183, 9, 'Sitapur'),
  (184, 9, 'Sonbhadra'),
  (185, 9, 'Sultanpur'),
  (186, 9, 'Unnao'),
  (187, 9, 'Varanasi'),
  (188, 10, 'Araria'),
  (611, 10, 'Arwal'),
  (189, 10, 'Aurangabad'),
  (190, 10, 'Banka'),
  (191, 10, 'Begusarai'),
  (192, 10, 'Bhagalpur'),
  (193, 10, 'Bhojpur'),
  (194, 10, 'Buxar'),
  (195, 10, 'Darbhanga'),
  (196, 10, 'Gaya'),
  (197, 10, 'Gopalganj'),
  (198, 10, 'Jamui'),
  (199, 10, 'Jehanabad'),
  (200, 10, 'Kaimur (Bhabua)'),
  (201, 10, 'Katihar'),
  (202, 10, 'Khagaria'),
  (203, 10, 'Kishanganj'),
  (204, 10, 'Lakhisarai'),
  (205, 10, 'Madhepura'),
  (206, 10, 'Madhubani'),
  (207, 10, 'Munger'),
  (208, 10, 'Muzaffarpur'),
  (209, 10, 'Nalanda'),
  (210, 10, 'Nawada'),
  (211, 10, 'Pashchim Champaran'),
  (212, 10, 'Patna'),
  (213, 10, 'Purbi Champaran'),
  (214, 10, 'Purnia'),
  (215, 10, 'Rohtas'),
  (216, 10, 'Saharsa'),
  (217, 10, 'Samastipur'),
  (218, 10, 'Saran'),
  (219, 10, 'Sheikhpura'),
  (220, 10, 'Sheohar'),
  (221, 10, 'Sitamarhi'),
  (222, 10, 'Siwan'),
  (223, 10, 'Supaul'),
  (224, 10, 'Vaishali'),
  (225, 11, 'Gangtok'),
  (228, 11, 'Gyalshing'),
  (226, 11, 'Mangan'),
  (227, 11, 'Namchi'),
  (741, 11, 'Pakyong'),
  (742, 11, 'Soreng'),
  (628, 12, 'Anjaw'),
  (787, 12, 'Bichom'),
  (229, 12, 'Changlang'),
  (230, 12, 'Dibang Valley'),
  (231, 12, 'East Kameng'),
  (232, 12, 'East Siang'),
  (718, 12, 'Kamle'),
  (786, 12, 'Keyi Panyor'),
  (677, 12, 'Kra Daadi'),
  (233, 12, 'Kurung Kumey'),
  (724, 12, 'Leparada'),
  (234, 12, 'Lohit'),
  (666, 12, 'Longding'),
  (235, 12, 'Lower Dibang Valley'),
  (719, 12, 'Lower Siang'),
  (236, 12, 'Lower Subansiri'),
  (678, 12, 'Namsai'),
  (723, 12, 'Pakke Kessang'),
  (237, 12, 'Papum Pare'),
  (725, 12, 'Shi Yomi'),
  (679, 12, 'Siang'),
  (238, 12, 'Tawang'),
  (239, 12, 'Tirap'),
  (240, 12, 'Upper Siang'),
  (241, 12, 'Upper Subansiri'),
  (242, 12, 'West Kameng'),
  (243, 12, 'West Siang'),
  (758, 13, 'Chumoukedima'),
  (244, 13, 'Dimapur'),
  (614, 13, 'Kiphire'),
  (245, 13, 'Kohima'),
  (615, 13, 'Longleng'),
  (788, 13, 'Meluri'),
  (246, 13, 'Mokokchung'),
  (247, 13, 'Mon'),
  (764, 13, 'Niuland'),
  (736, 13, 'Noklak'),
  (613, 13, 'Peren'),
  (248, 13, 'Phek'),
  (765, 13, 'Shamator'),
  (757, 13, 'Tseminyu'),
  (249, 13, 'Tuensang'),
  (250, 13, 'Wokha'),
  (251, 13, 'Zunheboto'),
  (252, 14, 'Bishnupur'),
  (253, 14, 'Chandel'),
  (254, 14, 'Churachandpur'),
  (255, 14, 'Imphal East'),
  (256, 14, 'Imphal West'),
  (713, 14, 'Jiribam'),
  (711, 14, 'Kakching'),
  (717, 14, 'Kamjong'),
  (712, 14, 'Kangpokpi'),
  (714, 14, 'Noney'),
  (715, 14, 'Pherzawl'),
  (257, 14, 'Senapati'),
  (258, 14, 'Tamenglong'),
  (716, 14, 'Tengnoupal'),
  (259, 14, 'Thoubal'),
  (260, 14, 'Ukhrul'),
  (261, 15, 'Aizawl'),
  (262, 15, 'Champhai'),
  (726, 15, 'Hnahthial'),
  (728, 15, 'Khawzawl'),
  (263, 15, 'Kolasib'),
  (264, 15, 'Lawngtlai'),
  (265, 15, 'Lunglei'),
  (266, 15, 'Mamit'),
  (727, 15, 'Saitual'),
  (268, 15, 'Serchhip'),
  (267, 15, 'Siaha'),
  (269, 16, 'Dhalai'),
  (654, 16, 'Gomati'),
  (652, 16, 'Khowai'),
  (270, 16, 'North Tripura'),
  (653, 16, 'Sepahijala'),
  (271, 16, 'South Tripura'),
  (655, 16, 'Unakoti'),
  (272, 16, 'West Tripura'),
  (273, 17, 'East Garo Hills'),
  (657, 17, 'East Jaintia Hills'),
  (274, 17, 'East Khasi Hills'),
  (740, 17, 'Eastern West Khasi Hills'),
  (656, 17, 'North Garo Hills'),
  (276, 17, 'Ri Bhoi'),
  (277, 17, 'South Garo Hills'),
  (663, 17, 'South West Garo Hills'),
  (658, 17, 'South West Khasi Hills'),
  (278, 17, 'West Garo Hills'),
  (275, 17, 'West Jaintia Hills'),
  (279, 17, 'West Khasi Hills'),
  (739, 18, 'Bajali'),
  (616, 18, 'Baksa'),
  (280, 18, 'Barpeta'),
  (705, 18, 'Biswanath'),
  (281, 18, 'Bongaigaon'),
  (282, 18, 'Cachar'),
  (708, 18, 'Charaideo'),
  (612, 18, 'Chirang'),
  (283, 18, 'Darrang'),
  (284, 18, 'Dhemaji'),
  (285, 18, 'Dhubri'),
  (286, 18, 'Dibrugarh'),
  (299, 18, 'Dima Hasao'),
  (287, 18, 'Goalpara'),
  (288, 18, 'Golaghat'),
  (289, 18, 'Hailakandi'),
  (709, 18, 'Hojai'),
  (290, 18, 'Jorhat'),
  (291, 18, 'Kamrup'),
  (618, 18, 'Kamrup Metro'),
  (292, 18, 'Karbi Anglong'),
  (294, 18, 'Kokrajhar'),
  (295, 18, 'Lakhimpur'),
  (706, 18, 'Majuli'),
  (296, 18, 'Marigaon'),
  (297, 18, 'Nagaon'),
  (298, 18, 'Nalbari'),
  (300, 18, 'Sivasagar'),
  (301, 18, 'Sonitpur'),
  (707, 18, 'South Salmara Mancachar'),
  (293, 18, 'Sribhumi'),
  (756, 18, 'Tamulpur'),
  (302, 18, 'Tinsukia'),
  (617, 18, 'Udalguri'),
  (710, 18, 'West Karbi Anglong'),
  (664, 19, 'Alipurduar'),
  (305, 19, 'Bankura'),
  (307, 19, 'Birbhum'),
  (308, 19, 'Cooch Behar'),
  (310, 19, 'Dakshin Dinajpur'),
  (309, 19, 'Darjeeling'),
  (312, 19, 'Hooghly'),
  (313, 19, 'Howrah'),
  (314, 19, 'Jalpaiguri'),
  (703, 19, 'Jhargram'),
  (702, 19, 'Kalimpong'),
  (315, 19, 'Kolkata'),
  (316, 19, 'Malda'),
  (319, 19, 'Murshidabad'),
  (320, 19, 'Nadia'),
  (303, 19, 'North 24 Parganas'),
  (704, 19, 'Paschim Bardhaman'),
  (318, 19, 'Paschim Medinipur'),
  (306, 19, 'Purba Bardhaman'),
  (317, 19, 'Purba Medinipur'),
  (321, 19, 'Purulia'),
  (304, 19, 'South 24 Parganas'),
  (311, 19, 'Uttar Dinajpur'),
  (322, 20, 'Bokaro'),
  (323, 20, 'Chatra'),
  (324, 20, 'Deoghar'),
  (325, 20, 'Dhanbad'),
  (326, 20, 'Dumka'),
  (327, 20, 'East Singhbum'),
  (328, 20, 'Garhwa'),
  (329, 20, 'Giridih'),
  (330, 20, 'Godda'),
  (331, 20, 'Gumla'),
  (332, 20, 'Hazaribagh'),
  (333, 20, 'Jamtara'),
  (606, 20, 'Khunti'),
  (334, 20, 'Koderma'),
  (335, 20, 'Latehar'),
  (336, 20, 'Lohardaga'),
  (337, 20, 'Pakur'),
  (338, 20, 'Palamu'),
  (607, 20, 'Ramgarh'),
  (339, 20, 'Ranchi'),
  (340, 20, 'Sahebganj'),
  (341, 20, 'Saraikela Kharsawan'),
  (342, 20, 'Simdega'),
  (343, 20, 'West Singhbhum'),
  (344, 21, 'Anugola'),
  (345, 21, 'Balangir'),
  (346, 21, 'Baleshwar'),
  (347, 21, 'Baragada'),
  (348, 21, 'Bhadrak'),
  (349, 21, 'Boudh'),
  (351, 21, 'Debagada'),
  (352, 21, 'Dhenkanal'),
  (353, 21, 'Gajapati'),
  (354, 21, 'Ganjam'),
  (355, 21, 'Jagatsinghapur'),
  (356, 21, 'Jajpur'),
  (357, 21, 'Jharsuguda'),
  (358, 21, 'Kalahandi'),
  (359, 21, 'Kandhamala'),
  (350, 21, 'Kataka'),
  (360, 21, 'Kendrapada'),
  (361, 21, 'Kendujhar'),
  (362, 21, 'Khordha'),
  (363, 21, 'Koraput'),
  (364, 21, 'Malkangiri'),
  (365, 21, 'Mayurbhanj'),
  (366, 21, 'Nabarangpur'),
  (367, 21, 'Nayagada'),
  (368, 21, 'Nuapada'),
  (369, 21, 'Puri'),
  (370, 21, 'Rayagada'),
  (371, 21, 'Sambalpur'),
  (372, 21, 'Subarnapur'),
  (373, 21, 'Sundaragada'),
  (646, 22, 'Balod'),
  (644, 22, 'Balodabazar-Bhatapara'),
  (649, 22, 'Balrampur-Ramanujganj'),
  (374, 22, 'Bastar'),
  (650, 22, 'Bemetara'),
  (636, 22, 'Bijapur'),
  (375, 22, 'Bilaspur'),
  (376, 22, 'Dakshin Bastar Dantewada'),
  (377, 22, 'Dhamtari'),
  (378, 22, 'Durg'),
  (645, 22, 'Gariyaband'),
  (734, 22, 'Gaurela-Pendra-Marwahi'),
  (379, 22, 'Janjgir-Champa'),
  (380, 22, 'Jashpur'),
  (382, 22, 'Kabeerdham'),
  (759, 22, 'Khairagarh-Chhuikhadan-Gandai'),
  (643, 22, 'Kondagaon'),
  (383, 22, 'Korba'),
  (384, 22, 'Korea'),
  (385, 22, 'Mahasamund'),
  (760, 22, 'Manendragarh-Chirmiri-Bharatpur(M C B)'),
  (761, 22, 'Mohla-Manpur-Ambagarh Chouki'),
  (647, 22, 'Mungeli'),
  (637, 22, 'Narayanpur'),
  (386, 22, 'Raigarh'),
  (387, 22, 'Raipur'),
  (388, 22, 'Rajnandgaon'),
  (762, 22, 'Sakti'),
  (763, 22, 'Sarangarh-Bilaigarh'),
  (642, 22, 'Sukma'),
  (648, 22, 'Surajpur'),
  (389, 22, 'Surguja'),
  (381, 22, 'Uttar Bastar Kanker'),
  (667, 23, 'Agar-Malwa'),
  (639, 23, 'Alirajpur'),
  (390, 23, 'Anuppur'),
  (391, 23, 'Ashoknagar'),
  (392, 23, 'Balaghat'),
  (393, 23, 'Barwani'),
  (394, 23, 'Betul'),
  (395, 23, 'Bhind'),
  (396, 23, 'Bhopal'),
  (397, 23, 'Burhanpur'),
  (398, 23, 'Chhatarpur'),
  (399, 23, 'Chhindwara'),
  (400, 23, 'Damoh'),
  (401, 23, 'Datia'),
  (402, 23, 'Dewas'),
  (403, 23, 'Dhar'),
  (404, 23, 'Dindori'),
  (406, 23, 'Guna'),
  (407, 23, 'Gwalior'),
  (408, 23, 'Harda'),
  (410, 23, 'Indore'),
  (411, 23, 'Jabalpur'),
  (412, 23, 'Jhabua'),
  (413, 23, 'Katni'),
  (405, 23, 'Khandwa (East Nimar)'),
  (414, 23, 'Khargone (West Nimar)'),
  (784, 23, 'Maihar'),
  (415, 23, 'Mandla'),
  (416, 23, 'Mandsaur'),
  (766, 23, 'MAUGANJ'),
  (417, 23, 'Morena'),
  (409, 23, 'Narmadapuram'),
  (418, 23, 'Narsimhapur'),
  (419, 23, 'Neemuch'),
  (722, 23, 'Niwari'),
  (785, 23, 'Pandhurna'),
  (420, 23, 'Panna'),
  (421, 23, 'Raisen'),
  (422, 23, 'Rajgarh'),
  (423, 23, 'Ratlam'),
  (424, 23, 'Rewa'),
  (425, 23, 'Sagar'),
  (426, 23, 'Satna'),
  (427, 23, 'Sehore'),
  (428, 23, 'Seoni'),
  (429, 23, 'Shahdol'),
  (430, 23, 'Shajapur'),
  (431, 23, 'Sheopur'),
  (432, 23, 'Shivpuri'),
  (433, 23, 'Sidhi'),
  (638, 23, 'Singrauli'),
  (434, 23, 'Tikamgarh'),
  (435, 23, 'Ujjain'),
  (436, 23, 'Umaria'),
  (437, 23, 'Vidisha'),
  (438, 24, 'Ahmedabad'),
  (439, 24, 'Amreli'),
  (440, 24, 'Anand'),
  (672, 24, 'Arvalli'),
  (441, 24, 'Banas Kantha'),
  (442, 24, 'Bharuch'),
  (443, 24, 'Bhavnagar'),
  (676, 24, 'Botad'),
  (668, 24, 'Chhotaudepur'),
  (445, 24, 'Dahod'),
  (444, 24, 'Dangs'),
  (674, 24, 'Devbhumi Dwarka'),
  (446, 24, 'Gandhinagar'),
  (675, 24, 'Gir Somnath'),
  (447, 24, 'Jamnagar'),
  (448, 24, 'Junagadh'),
  (449, 24, 'Kachchh'),
  (450, 24, 'Kheda'),
  (451, 24, 'Mahesana'),
  (669, 24, 'Mahisagar'),
  (673, 24, 'Morbi'),
  (452, 24, 'Narmada'),
  (453, 24, 'Navsari'),
  (454, 24, 'Panch Mahals'),
  (455, 24, 'Patan'),
  (456, 24, 'Porbandar'),
  (457, 24, 'Rajkot'),
  (458, 24, 'Sabar Kantha'),
  (459, 24, 'Surat'),
  (460, 24, 'Surendranagar'),
  (641, 24, 'Tapi'),
  (461, 24, 'Vadodara'),
  (462, 24, 'Valsad'),
  (789, 24, 'Vav-Tharad'),
  (466, 27, 'Ahilyanagar'),
  (467, 27, 'Akola'),
  (468, 27, 'Amravati'),
  (470, 27, 'Beed'),
  (471, 27, 'Bhandara'),
  (472, 27, 'Buldhana'),
  (473, 27, 'Chandrapur'),
  (469, 27, 'Chhatrapati Sambhajinagar'),
  (488, 27, 'Dharashiv'),
  (474, 27, 'Dhule'),
  (475, 27, 'Gadchiroli'),
  (476, 27, 'Gondia'),
  (477, 27, 'Hingoli'),
  (478, 27, 'Jalgaon'),
  (479, 27, 'Jalna'),
  (480, 27, 'Kolhapur'),
  (481, 27, 'Latur'),
  (482, 27, 'Mumbai'),
  (483, 27, 'Mumbai Suburban'),
  (484, 27, 'Nagpur'),
  (485, 27, 'Nanded'),
  (486, 27, 'Nandurbar'),
  (487, 27, 'Nashik'),
  (665, 27, 'Palghar'),
  (489, 27, 'Parbhani'),
  (490, 27, 'Pune'),
  (491, 27, 'Raigad'),
  (492, 27, 'Ratnagiri'),
  (493, 27, 'Sangli'),
  (494, 27, 'Satara'),
  (495, 27, 'Sindhudurg'),
  (496, 27, 'Solapur'),
  (497, 27, 'Thane'),
  (498, 27, 'Wardha'),
  (499, 27, 'Washim'),
  (500, 27, 'Yavatmal'),
  (745, 28, 'Alluri Sitharama Raju'),
  (744, 28, 'Anakapalli'),
  (502, 28, 'Ananthapuramu'),
  (753, 28, 'Annamayya'),
  (750, 28, 'Bapatla'),
  (503, 28, 'Chittoor'),
  (747, 28, 'Dr. B.R. Ambedkar Konaseema'),
  (505, 28, 'East Godavari'),
  (748, 28, 'Eluru'),
  (506, 28, 'Guntur'),
  (746, 28, 'Kakinada'),
  (510, 28, 'Krishna'),
  (511, 28, 'Kurnool'),
  (790, 28, 'Markapuram'),
  (755, 28, 'Nandyal'),
  (749, 28, 'Ntr'),
  (751, 28, 'Palnadu'),
  (743, 28, 'Parvathipuram Manyam'),
  (791, 28, 'Polavaram'),
  (517, 28, 'Prakasam'),
  (515, 28, 'Sri Potti Sriramulu Nellore'),
  (754, 28, 'Sri Sathya Sai'),
  (519, 28, 'Srikakulam'),
  (752, 28, 'Tirupati'),
  (520, 28, 'Visakhapatnam'),
  (521, 28, 'Vizianagaram'),
  (523, 28, 'West Godavari'),
  (504, 28, 'Y.S.R. Kadapa'),
  (524, 29, 'Bagalkote'),
  (528, 29, 'Ballari'),
  (527, 29, 'Belagavi'),
  (526, 29, 'Bengaluru Rural'),
  (631, 29, 'Bengaluru South'),
  (525, 29, 'Bengaluru Urban'),
  (529, 29, 'Bidar'),
  (531, 29, 'Chamarajanagar'),
  (630, 29, 'Chikkaballapura'),
  (532, 29, 'Chikkamagaluru'),
  (533, 29, 'Chitradurga'),
  (534, 29, 'Dakshina Kannada'),
  (535, 29, 'Davanagere'),
  (536, 29, 'Dharwad'),
  (537, 29, 'Gadag'),
  (539, 29, 'Hassan'),
  (540, 29, 'Haveri'),
  (538, 29, 'Kalaburagi'),
  (541, 29, 'Kodagu'),
  (542, 29, 'Kolar'),
  (543, 29, 'Koppal'),
  (544, 29, 'Mandya'),
  (545, 29, 'Mysuru'),
  (546, 29, 'Raichur'),
  (547, 29, 'Shivamogga'),
  (548, 29, 'Tumakuru'),
  (549, 29, 'Udupi'),
  (550, 29, 'Uttara Kannada'),
  (738, 29, 'Vijayanagara'),
  (530, 29, 'Vijayapura'),
  (635, 29, 'Yadgir'),
  (793, 30, 'Kushavati'),
  (551, 30, 'North Goa'),
  (552, 30, 'South Goa'),
  (553, 31, 'Lakshadweep District'),
  (554, 32, 'Alappuzha'),
  (555, 32, 'Ernakulam'),
  (556, 32, 'Idukki'),
  (557, 32, 'Kannur'),
  (558, 32, 'Kasaragod'),
  (559, 32, 'Kollam'),
  (560, 32, 'Kottayam'),
  (561, 32, 'Kozhikode'),
  (562, 32, 'Malappuram'),
  (563, 32, 'Palakkad'),
  (564, 32, 'Pathanamthitta'),
  (565, 32, 'Thiruvananthapuram'),
  (566, 32, 'Thrissur'),
  (567, 32, 'Wayanad'),
  (610, 33, 'Ariyalur'),
  (730, 33, 'Chengalpattu'),
  (568, 33, 'Chennai'),
  (569, 33, 'Coimbatore'),
  (570, 33, 'Cuddalore'),
  (571, 33, 'Dharmapuri'),
  (572, 33, 'Dindigul'),
  (573, 33, 'Erode'),
  (729, 33, 'Kallakurichi'),
  (574, 33, 'Kancheepuram'),
  (575, 33, 'Kanniyakumari'),
  (576, 33, 'Karur'),
  (577, 33, 'Krishnagiri'),
  (578, 33, 'Madurai'),
  (735, 33, 'Mayiladuthurai'),
  (579, 33, 'Nagapattinam'),
  (580, 33, 'Namakkal'),
  (587, 33, 'Nilgiris'),
  (581, 33, 'Perambalur'),
  (582, 33, 'Pudukkottai'),
  (583, 33, 'Ramanathapuram'),
  (731, 33, 'Ranipet'),
  (584, 33, 'Salem'),
  (585, 33, 'Sivaganga'),
  (733, 33, 'Tenkasi'),
  (586, 33, 'Thanjavur'),
  (588, 33, 'Theni'),
  (589, 33, 'Thiruvallur'),
  (590, 33, 'Thiruvarur'),
  (594, 33, 'Thoothukkudi'),
  (591, 33, 'Tiruchirappalli'),
  (592, 33, 'Tirunelveli'),
  (732, 33, 'Tirupathur'),
  (634, 33, 'Tiruppur'),
  (593, 33, 'Tiruvannamalai'),
  (595, 33, 'Vellore'),
  (596, 33, 'Viluppuram'),
  (597, 33, 'Virudhunagar'),
  (598, 34, 'Karaikal'),
  (600, 34, 'Puducherry'),
  (603, 35, 'Nicobars'),
  (632, 35, 'North and Middle Andaman'),
  (602, 35, 'South Andamans'),
  (501, 36, 'Adilabad'),
  (690, 36, 'Bhadradri Kothagudem'),
  (686, 36, 'Hanumakonda'),
  (507, 36, 'Hyderabad'),
  (681, 36, 'Jagitial'),
  (689, 36, 'Jangoan'),
  (687, 36, 'Jayashankar Bhupalapally'),
  (695, 36, 'Jogulamba Gadwal'),
  (685, 36, 'Kamareddy'),
  (508, 36, 'Karimnagar'),
  (509, 36, 'Khammam'),
  (699, 36, 'Kumuram Bheem Asifabad'),
  (688, 36, 'Mahabubabad'),
  (512, 36, 'Mahabubnagar'),
  (684, 36, 'Mancherial'),
  (513, 36, 'Medak'),
  (700, 36, 'Medchal Malkajgiri'),
  (720, 36, 'Mulugu'),
  (694, 36, 'Nagarkurnool'),
  (514, 36, 'Nalgonda'),
  (721, 36, 'Narayanpet'),
  (680, 36, 'Nirmal'),
  (516, 36, 'Nizamabad'),
  (682, 36, 'Peddapalli'),
  (683, 36, 'Rajanna Sircilla'),
  (518, 36, 'Ranga Reddy'),
  (691, 36, 'Sangareddy'),
  (692, 36, 'Siddipet'),
  (696, 36, 'Suryapet'),
  (698, 36, 'Vikarabad'),
  (693, 36, 'Wanaparthy'),
  (522, 36, 'Warangal'),
  (697, 36, 'Yadadri Bhuvanagiri'),
  (798, 37, 'Changthang'),
  (801, 37, 'Drass'),
  (6, 37, 'Kargil'),
  (9, 37, 'Leh Ladakh'),
  (799, 37, 'Nubra'),
  (802, 37, 'Sankoo'),
  (797, 37, 'Sham'),
  (800, 37, 'Zanskar'),
  (465, 38, 'Dadra and Nagar Haveli'),
  (463, 38, 'Daman'),
  (464, 38, 'Diu');
