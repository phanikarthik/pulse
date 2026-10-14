-- Milestone 4/5: vote totals for the admin console.
-- option_counts stays unreadable to everyone; admins with a 2FA session get the totals
-- through this function (voters only ever see results via get_results, after voting).

create function public.admin_option_totals()
returns table (option_id uuid, question_id uuid, votes integer)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  return query
    select c.option_id, c.question_id, c.votes from public.option_counts c;
end;
$$;

revoke all on function public.admin_option_totals() from public, anon;
grant execute on function public.admin_option_totals() to authenticated;
