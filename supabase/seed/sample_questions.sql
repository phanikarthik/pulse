-- Sample questions so there is something to vote on. Run once in the SQL editor.
-- Each question and its options are written in one statement, because a published
-- question must have 2-4 options when the transaction ends. Vote counts start at zero.

begin;

with q as (
  insert into public.questions (topic, body, status, opens_at, closes_at)
  values ('Work', 'Should employers be required to offer a four-day working week option?', 'open',
          now() - interval '3 hours', now() + interval '7 days')
  returning id
)
insert into public.options (question_id, label, position)
select q.id, o.label, o.pos from q,
  (values ('Yes, by law', 1), ('Encourage it, don''t require it', 2), ('No, leave it to employers', 3)) as o(label, pos);

with q as (
  insert into public.questions (topic, body, status, opens_at, closes_at)
  values ('Education', 'Should smartphones be banned in schools for under-16s for the whole school day?', 'open',
          now() - interval '20 hours', now() + interval '5 days')
  returning id
)
insert into public.options (question_id, label, position)
select q.id, o.label, o.pos from q,
  (values ('Yes, full-day ban', 1), ('Only during lessons', 2), ('No ban', 3)) as o(label, pos);

with q as (
  insert into public.questions (topic, body, status, opens_at)
  values ('Technology', 'Should AI-generated images in political ads carry a mandatory label?', 'open',
          now() - interval '30 hours')
  returning id
)
insert into public.options (question_id, label, position)
select q.id, o.label, o.pos from q,
  (values ('Yes', 1), ('No', 2)) as o(label, pos);

with q as (
  insert into public.questions (topic, body, status, opens_at, closes_at)
  values ('Cities', 'Would you support free public transport, funded by a congestion charge on city centres?', 'open',
          now() - interval '2 days', now() + interval '3 days')
  returning id
)
insert into public.options (question_id, label, position)
select q.id, o.label, o.pos from q,
  (values ('Strongly support', 1), ('Somewhat support', 2), ('Somewhat oppose', 3), ('Strongly oppose', 4)) as o(label, pos);

with q as (
  insert into public.questions (topic, body, status, opens_at, closes_at)
  values ('Politics', 'Should the national voting age be lowered to 16?', 'closed',
          now() - interval '8 days', now() - interval '1 day')
  returning id
)
insert into public.options (question_id, label, position)
select q.id, o.label, o.pos from q,
  (values ('Yes', 1), ('No', 2), ('Not sure', 3)) as o(label, pos);

with q as (
  insert into public.questions (topic, body, status)
  values ('Housing', 'Should short-term holiday lets be capped at 90 nights a year in big cities?', 'draft')
  returning id
)
insert into public.options (question_id, label, position)
select q.id, o.label, o.pos from q,
  (values ('Yes', 1), ('No', 2)) as o(label, pos);

commit;
