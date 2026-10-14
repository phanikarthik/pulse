# AGENTS.md

Pulse: a public current-affairs poll. Vote first, then see results. Roles: voter, admin.

**Continue from [PLAN.md](./PLAN.md).** Milestones 1 (product surface) and 2 (schema + RLS in `supabase/migrations/`) are done. Provider is Supabase (free tier). Next is Milestone 3 (auth + signup), which needs the Supabase env vars set in Netlify.

## Architecture

- Next.js 15 App Router, TypeScript, `src/` layout, `@/*` → `src/*`. Netlify deploys via `netlify.toml` (`npm run build`, publish `.next`).
- Route files (`src/app/**/page.tsx`) are thin server components that export metadata and render one client component from the same folder (`Dashboard.tsx`, `QuestionView.tsx`, `AdminConsole.tsx`, `AccountView.tsx`).
- **All stubbed data is in `src/lib/fixtures.ts`. All stubbed behaviour (session, votes, admin writes, audit log) is in `src/lib/demo-store.ts`**, a localStorage-backed store read through `useStore()` (`useSyncExternalStore`). Cross-tab `storage` events stand in for Realtime. UI code must only call the functions exported from `demo-store.ts`, so later milestones can replace them with Supabase calls / server actions without touching components.
- `demo-store.ts` deliberately mirrors the database rules to come: `castVote` is insert-only, one per question; `getResults` returns `null` until the caller has voted (like the planned `get_results` SQL function); age groups under `MIN_GROUP` (20) return `pct: null`; admin writes call `assertAdmin` (role=admin AND 2FA) and append to `audit`.
- `RequireUser` is a client-side guard for the stub session; replace with server-side checks in middleware.
- `demoBecomeAdmin` and the "Preview as admin" control exist only for the preview. Remove them in the admin milestone. In production `profiles.role` is never writable from the site.

## Database

- Schema and all security rules: `supabase/migrations/*.sql`. Never edit an applied migration; add a new timestamped file. Setup steps: `supabase/README.md`.
- Trigger/helper functions live in the `private` schema (not exposed by the API). Client-callable RPCs in `public`: `get_results`, `get_breakdown`, `complete_profile`, `admin_create_question`, `delete_my_account`, `is_admin`.
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
