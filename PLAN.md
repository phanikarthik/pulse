# Pulse — product roadmap

Pulse is a public poll on current-affairs questions: people sign up, vote, and only then see how everyone else voted. One site, one login, two roles (voter, admin).

The product surface comes first so the experience can be reviewed end to end; each later milestone replaces a stubbed piece with the real, database-enforced version. All stubbed behaviour lives in `src/lib/fixtures.ts` and `src/lib/demo-store.ts`, and the UI only talks to the exported functions in `demo-store.ts`, so the swap is contained.

## Decision: Supabase (free tier)

Confirmed 2026-10-14: Supabase for Postgres, auth (email OTP, Google, TOTP 2FA) and Realtime, on the free plan while building. Before soft launch: upgrade to Pro (free projects pause after a week idle and have no backups) or accept that, and configure custom SMTP (the built-in sender is for testing only).

## Milestones

### ✅ 1. Product surface (done)
Welcome page with Sign in / Create account tabs, signup form (display name, region, age band, 18+, consent, Turnstile placeholder), voter dashboard with "New" tags and live toast, question page with hidden-until-voted results, animated bars, "X% agree with you", Share on X / Copy result, age breakdown with the under-20 privacy floor, admin console (2FA step, post/close/reopen/delete, audit log), account page with "Delete my account and data", privacy policy and terms. Light/dark themes, Bricolage Grotesque, heartbeat logo animation, reduced-motion support, visible focus.

### ✅ 2. Database and security policies (written; apply to the Supabase project per `supabase/README.md`)
- SQL migrations for `profiles`, `questions` (body ≤160 via CHECK), `options`, `votes` (PK `question_id, user_id`), `option_counts`, `admin_audit_log`.
- RLS on every table. `profiles`: select/update own row only; a trigger or column grant blocks any change to `role`; a signup trigger inserts `role='voter'`.
- `is_admin()` helper: `role='admin'` AND `auth.jwt()->>'aal' = 'aal2'`. Only admins can write `questions`/`options`.
- `votes`: INSERT only where `user_id = auth.uid()` and the question is open; no UPDATE/DELETE policies. `region`/`age_band` copied from the profile by trigger, not from the client.
- `option_counts` maintained by a trigger on `votes`; no select policy (not directly readable).
- `get_results(question_id)` `SECURITY DEFINER`: returns counts only if the caller has a vote; `get_breakdown(...)` suppresses groups under 20.
- Audit triggers on `questions`/`options` write to `admin_audit_log`.
- `delete_my_account()` removes profile and votes (counts recalculated by trigger) and the auth user.
- Also: `complete_profile()` for Google sign-ups, `admin_create_question()` (2–4 options, atomic), Realtime publication on `questions`. Verified locally against Postgres with 42 security checks (to become the Milestone 6 suite).

### 🟡 3. Auth and signup (mostly done)
- ✅ Supabase client/server helpers (`@supabase/ssr`), email sign-in (link now, code once the template is editable), session in cookies.
- ✅ Profile completion step for Google sign-ups (region, age band, 18+, consent). Google itself is hidden until the provider is enabled (`NEXT_PUBLIC_GOOGLE_SIGNIN=on`).
- ✅ Server-side session checks in middleware and on each voter page; real profile edit, sign out and account deletion.
- ⬜ Server-side Turnstile check (`TURNSTILE_SECRET_KEY`) before creating an account; rate limit signup and OTP requests per IP and email (Supabase's built-in OTP limits apply meanwhile).
- ⬜ Custom SMTP (e.g. Resend, needs a domain) so emails reach the public and the template can include `{{ .Token }}`.

### ✅ 4. Voter dashboard and voting on real data (done)
- ✅ Dashboard and question page read questions via RLS; "New" tags per user in localStorage (a `question_seen` table can replace this if cross-device matters).
- ✅ Voting inserts directly under RLS (insert-only, one per question, open questions only); results via `get_results` / `get_breakdown`, refreshed every 20 s.
- ✅ Supabase Realtime on `questions` for live "New question" toasts.
- ⬜ Rate limit votes per user; push live result counts over a broadcast channel instead of polling.

### 🟡 5. Admin area and 2FA (mostly done)
- ✅ TOTP enrolment and challenge (Supabase MFA); the database requires `aal2` for every admin read of drafts and every write.
- ✅ Post/close/reopen/delete, vote totals (`admin_option_totals`) and the audit log wired to the database. Preview-only "Preview as admin" removed.
- ⬜ Serve the console on `admin.<domain>` (Next.js middleware rewrite to `/admin`); block `/admin` on the main host. Needs a domain.
- ⬜ Edit an existing question's text/options (the database already audits edits).

### 6. Security tests
- Automated tests against a test database: voters can't change `role`, can't read `option_counts`, can't vote twice, update or delete votes, can't see results before voting; non-2FA admins can't write; breakdowns hide groups under 20; account deletion removes everything.

### 7. Share card, breakdowns, analytics
- Open Graph result image per question (`/q/[id]/opengraph-image`).
- Region breakdown alongside age, both using the under-20 rule.
- Privacy-friendly analytics (page views, vote conversion).

### 8. Soft launch
- Final legal review of privacy/terms, contact address, custom domain + `admin.` subdomain, environment variables in Vercel (upgrade to Pro if Pulse goes commercial), seed the first live questions.
