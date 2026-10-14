# AGENTS.md

Pulse: a public current-affairs poll. Vote first, then see results. Roles: voter, admin.

**Continue from [PLAN.md](./PLAN.md).** Milestones 1 (product surface), 2 (schema + RLS in `supabase/migrations/`) and 4 (real voting) are done; 3 (auth) lacks Turnstile, rate limiting and custom SMTP; 5 (admin) has real 2FA but not the `admin.` subdomain. Provider is Supabase (free tier). Env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (in `.env.local` locally; Netlify not yet configured).

## Architecture

- Next.js 15 App Router, TypeScript, `src/` layout, `@/*` → `src/*`. Netlify deploys via `netlify.toml` (`npm run build`, publish `.next`).
- Route files (`src/app/**/page.tsx`) are thin server components that export metadata and render one client component from the same folder (`Dashboard.tsx`, `QuestionView.tsx`, `AdminConsole.tsx`, `AccountView.tsx`).
- **Auth is real (Supabase).** All account actions live in `src/lib/auth.ts` (client); UI never calls Supabase directly. `src/lib/session.ts` (server) loads the profile per request; the root layout passes it to `SessionProvider`, read with `useProfile()`. `src/middleware.ts` refreshes the session cookie and bounces signed-out visitors; voter pages also call `requireCompleteProfile()` (redirects to `/` or `/complete-profile`). Sign-in is email OTP: the default (locked) Supabase template sends a link to `/auth/callback`; the code box accepts 6–8 digits for when the template includes `{{ .Token }}` (needs custom SMTP). Google is hidden unless `NEXT_PUBLIC_GOOGLE_SIGNIN=on`. After sign-in/out use a full page load (`window.location.assign`) so the layout re-renders with the new session.
- **Questions, votes, results and admin actions are real too**, all in `src/lib/data.ts` (client); UI never calls Supabase directly. `useVoterData()` / `useAdminData()` load data and re-load on Supabase Realtime events on `questions` (RLS-filtered). Results come from `get_results` + `get_breakdown` (nothing until the caller has voted) and refresh every 20 s while a question is open; option totals are never readable by voters. "New" tags are per user in localStorage (`pulse-seen-<userId>`). `isVotable()` mirrors the database's `question_is_open` (status open, inside opens_at/closes_at).
- Admin console: `profile.role === 'admin'`, then Supabase MFA (TOTP) — first visit enrols an authenticator app, later visits challenge it. Admin writes and drafts need the resulting `aal2` session (enforced by `is_admin()` in the database). Totals via `admin_option_totals()`.
- In production `profiles.role` is never writable from the site; the owner sets it in the SQL editor.

## Database

- Schema and all security rules: `supabase/migrations/*.sql`. Never edit an applied migration; add a new timestamped file. Setup steps: `supabase/README.md`.
- Trigger/helper functions live in the `private` schema (not exposed by the API). Client-callable RPCs in `public`: `get_results`, `get_breakdown`, `complete_profile`, `admin_create_question`, `admin_option_totals`, `delete_my_account`, `is_admin`. Sample questions: `supabase/seed/sample_questions.sql` (run once by hand).
- `votes` accepts only `question_id, option_id` from the client; everything else comes from defaults/triggers.

## Styling conventions

- One global stylesheet, `src/app/globals.css`, with CSS custom properties. Theme is `html[data-theme="light|dark"]`, set before paint by an inline script in `layout.tsx` and toggled by `ThemeToggle` (stored as `pulse-theme`).
- Palette: ink `#14213d`, paper `#eef1f6`, pulse red `#e63e5c` (your vote, New tags, primary CTA), blue `#2f5bea` (result bars). Font: Bricolage Grotesque (`--font-bricolage`).
- Animate only `transform`/`opacity`; bars use `scaleX(var(--p))`. The global `prefers-reduced-motion` block neutralises all animation; keep new animations compatible (use `both`/`forwards` fill so end state still shows).
- Every interactive control must keep a visible `:focus-visible` outline. Custom radios/chips hide the native input but keep it focusable.

## Non-obvious decisions

- The welcome page hides the header logo and shows the large animated logo in the hero instead.
- The admin link is a deliberately faint text link in the bottom-right corner of the welcome page only. The admin console will move to `admin.<domain>` via middleware.
- Drafts are hidden from voters (`/q/[id]` treats them as not found).
