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
- ✅ "Continue with Google" alongside email sign-in, plus a profile completion step for Google sign-ups (region, age band, 18+, consent). Requires the Google OAuth client + provider set up in Supabase.
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

### 🟡 0. Immediate
- ✅ Google sign-in live (2026-11-08): OAuth client published in Google Cloud, provider enabled in Supabase, tested by a second user.
- Supabase free projects pause after 7 days idle (happened 2026-10-25); keep it active or move to Pro before real users.

### 🟡 9. Owner analytics (post-vote data for the admin)
Decided 2026-11-09: only the admin sees analytics (hosts get their own with Instant Pulse); visible live while a question is open, refreshed every 20 s; owner small-group minimum is 5; region becomes a fixed list. Aggregates only; no individual voter rows ever leave the database. Groups or time slots under 5 voters show the voter count but not the answer split.

Order of work: analytics phase 1 → phase 2 → Instant Pulse (10) → analytics phase 3 → geographic radius (11).
- ✅ Phase 1 (built 2026-11-09, migration `20261109000000_admin_analytics.sql`): `/admin/q/[id]` per question with result, answer split by age band, votes per hour/day (viewer's time zone, empty slots shown), table view and CSV download; "At a glance" table of all published questions (voters, leading answer, lead in points) with CSV on `/admin`.
- ✅ Phase 2 (built 2026-11-10, migration `20261110000000_places_and_views.sql`): all-India state → district picker (LGD list, 36 states/UTs, 790 districts, observed 2026-11-09) on sign-up, `/complete-profile` and the account page; accounts with only a typed region are sent to `/complete-profile` once. Votes store `district_code`; analytics show By place (state or district) and turnout (people who opened a question vs voted; `question_views` has no timestamps). Votes cast before the change show as "Not recorded". To refresh the place list, regenerate the inserts from the LGD dump (https://ramseraph.github.io/opendata/lgd/) in a new migration.
- ⬜ Phase 3 (after Instant Pulse): live analytics for instant polls, shareable result image, age × region only where every cell clears the minimum.

### 🟡 10. Hosts and audiences (agreed 2026-11-10)
Decided 2026-11-10: host access by owner approval only; political/election polls by hosts need owner approval; guests vote without an account in live polls; the host picks the results mode per poll (default after voting); host polls are called **Pulse Live**.
Direction under discussion: open Pulse to other people running their own polls (lecturers, trainers, event MCs, RWAs, MLAs) while the owner keeps control. This changes Pulse from a single-owner poll site into a platform, so it is agreed before anything is built.

**Roles on one account** (a person can hold several; "audience" = member or guest):
| Role | Who | Can do |
|---|---|---|
| Owner (today's admin, 2FA) | Pulse team | Approve/suspend hosts, take down any poll, set limits, see platform-wide totals |
| Host (granted by owner) | Lecturers, trainers, MLAs, MCs | Create and run their own live polls; analytics for their own polls only |
| Member (signed-in audience) | Today's voters | Vote on public questions and live polls; age/place feed breakdowns |
| Guest (no account) | People in a room scanning a QR code | Vote in one live poll; invisible anonymous sign-in, no profile, no breakdowns |

**Owner control, enforced in the database:**
- Host access by application → owner approves; nobody hosts without approval.
- Per-host plan limits (active polls, voters per poll, features), changeable per host.
- Take-down: hiding a poll stops votes and removes it for everyone; suspending a host freezes all their polls.
- Audience "Report" button → report queue in the owner console.
- Sensitive topics (election/political) by hosts: blocked or held for owner approval.
- Host polls never appear on the public Pulse feed unless the owner features one; public questions stay owner-only.
- Kill switch: pause new hosts or all live polls (e.g. during elections).
- Audit log covers owner and host actions.
- Hosts only ever see totals with small-group hiding; emails and profiles never leave Pulse (keeps DPDP obligations with Pulse, and audiences stay Pulse's).

**Two products, one codebase:** Pulse Public (owner's curated questions, members) and Pulse Live (host-run polls joined by QR/code, presenter screen, guests allowed). Shared database, auth and analytics engine.

**Phases:** A. Foundations (roles, poll ownership, host status/limits, poll kinds, take-down; owner console Hosts + Reports) → B. Pulse Live, owner as the only host (QR/join code, presenter screen, guest voting; test at real events) → C. Hosts by invitation (apply form, approval queue, host dashboard and analytics, Report button, limits, sensitive-topic rule) → D. Open sign-up with free/paid plans (needs Vercel Pro, legal review, domain) → then geographic radius (11) and analytics phase 3.

**✅ Phase A (built 2026-11-10, migration `20261111000000_hosts_foundations.sql`, 31 database checks):** poll kinds (public / live), moderation state (ok / awaiting approval / hidden) with take-down and approval, a "politics or elections" flag that holds host polls for approval, results mode per poll, `hosts` table (status + per-host limits) with owner add-by-email / suspend / limits, platform switches (pause new hosts, pause all live polls), limits and switches enforced on poll publish and on every vote, audit log for all of it. Owner console: Hide / Restore / Approve on polls, Hosts section, Switches. Public site unchanged.

Technical notes for Pulse Live, kept from the earlier Instant Pulse draft:
- Host creates an instant poll → short join code + QR code + link (`/i/<code>`). Audience scans and votes in seconds, no account.
- Each browser gets a Supabase **anonymous sign-in** (a real user id with no email), so the database still enforces one vote per person per poll and all RLS rules keep working. Needs anonymous sign-ins enabled in Supabase, plus Turnstile to stop scripted voting.
- Schema: `questions.kind` (`standard` | `instant`), `join_code`, results visibility (after voting / live for everyone / presenter only). The vote trigger skips the region/age requirement for instant polls.
- Presenter screen (big, projector-friendly) with live bars pushed over Realtime broadcast instead of polling.
- Limits to state honestly: someone can vote again from another browser or private window; join codes expire when the session ends; optional geofence (milestone 11) narrows it to the room's area.

### ⬜ 11. Geographic radius per question
The admin decides where a question can be voted on.
- Admin sets a centre (pick on a map, or "use my current location") and a radius per question; empty = anywhere.
- Voter's browser asks for location permission at vote time; the database checks the distance in a vote function and rejects votes outside the circle. Only "inside / outside" is kept, never the exact coordinates (privacy, India's DPDP Act).
- Limits to state honestly: location can be faked by a determined person; phones are accurate to ~10–50 m outdoors, worse indoors; laptops often only know the city. Recommend a minimum radius of ~200 m; pair with a join code for live events.
- Later: constituency/ward boundaries (polygons) instead of circles, for the MLA use case.

### 6. Security tests
- Automated tests against a test database: voters can't change `role`, can't read `option_counts`, can't vote twice, update or delete votes, can't see results before voting; non-2FA admins can't write; breakdowns hide groups under 20; account deletion removes everything.

### 7. Share card, breakdowns, analytics
- Open Graph result image per question (`/q/[id]/opengraph-image`).
- Region breakdown alongside age, both using the under-20 rule.
- Privacy-friendly analytics (page views, vote conversion).

### 8. Soft launch
- Final legal review of privacy/terms, contact address, custom domain + `admin.` subdomain, environment variables in Vercel (upgrade to Pro if Pulse goes commercial), seed the first live questions.
