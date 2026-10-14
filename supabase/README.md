# Supabase setup

The database schema and every security rule live in `migrations/`. The website itself never gets to decide who is an admin or who can see results; Postgres does.

## 1. Create the project
In the Supabase dashboard (organization **pulse**): **New project** → name `pulse`, pick the region closest to your voters (US East matches the Netlify functions region), set a strong database password and store it in your password manager.

## 2. Apply the migration
Either:
- **SQL editor** (simplest): open **SQL Editor → New query**, paste the whole of `migrations/20261014000000_pulse_schema.sql`, click **Run**. It should finish with "Success. No rows returned".
- **Supabase CLI**: `npx supabase login`, `npx supabase link --project-ref <your-project-ref>`, `npx supabase db push`.

Apply it once, to an empty project. Later milestones add new migration files rather than editing this one.

## 3. Add the keys to Netlify
Project settings → **API** in Supabase shows the values. In Netlify: **Project configuration → Environment variables**:

| Variable | Supabase value | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `anon` / publishable key | Safe in the browser; RLS protects the data |
| `SUPABASE_SERVICE_ROLE_KEY` | `service_role` / secret key | Mark as **secret**, server only, never commit it |

Never put these values in code, chat or commit messages.

## 4. Make yourself admin (once, after you have signed up on the site)
Sign up on Pulse like any voter (Milestone 3), then in the SQL editor:

```sql
update public.profiles set role = 'admin'
where id = (select id from auth.users where email = 'you@example.com');
```

This only works from the SQL editor. The site's roles (`anon`, `authenticated`, and even `service_role`) are blocked from changing `role`. You will also need to enrol a TOTP authenticator (Milestone 5); admin writes require a 2FA session (`aal2`).

## What the migration enforces
- `profiles`: read/update own row only; `role` is not updatable from the site (column grants + trigger). Signup always creates a `voter`.
- `questions` / `options`: signed-in users read open and closed questions; drafts and all writes need `role = 'admin'` **and** a 2FA session. Body ≤ 160 chars; published questions need 2–4 options.
- `votes`: insert-only, own `user_id`, open questions only, one per question (primary key). Region and age band are copied from the profile by trigger. No update or delete.
- `option_counts`: kept up to date by trigger, not readable. Results come from `get_results(question_id)`, which returns nothing until you've voted.
- `get_breakdown(question_id, 'age' | 'region')`: groups under 20 voters return `pct = null`.
- `admin_audit_log`: every create / edit / close / reopen / delete on questions and options, written by trigger; admins can read, nobody can write.
- `delete_my_account()`: deletes the auth user, profile and votes, and recalculates counts.
- `complete_profile(...)`: for Google sign-ups to add region, age band, 18+ and consent before voting.
- Realtime is enabled on `questions` (RLS-filtered) for live "New question" toasts.
