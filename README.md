# Pulse

A public poll for current-affairs questions. People sign up, vote on live questions, and only then see how everyone else voted. Admins post questions; voters see them flagged as **New** on their dashboard.

## What's here

The full product surface is clickable today, running on sample data stored in your browser:

- **Welcome** (`/`): pitch with Sign in / Create account tabs (email one-time code, Google, Turnstile placeholder, 18+ and consent).
- **Dashboard** (`/dashboard`): greeting, open questions with red "New" tags, filters, and a live toast when a question is posted (try the admin console in a second tab).
- **Question** (`/q/[id]`): options first; after voting, animated result bars, "X% agree with you", Share on X, Copy result, and an age breakdown that hides groups under 20.
- **Admin** (`/admin`, faint link bottom-right of the welcome page): "Not authorised" for voters, a 2FA step for admins, then post / close / reopen / delete and an audit log. The preview includes a clearly labelled "Preview as admin" option.
- **Account** (`/account`): edit profile, sign out, delete account and data.
- **Privacy** and **Terms** pages.

## Tech

- Next.js 15 (App Router, TypeScript), deployed on Vercel
- Plain CSS with custom properties (light/dark), Bricolage Grotesque via `next/font`
- Planned: Supabase (Postgres + RLS, auth, Realtime), Cloudflare Turnstile, rate limiting

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000. Any email and any 6-digit code will sign you in during the preview.

Environment variables (in `.env.local` locally and in Vercel project settings, never in code): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Later: `TURNSTILE_SECRET_KEY` (server only).

## Roadmap

See [PLAN.md](./PLAN.md). Next up: the database schema and security policies, then real auth and signup, real voting with Realtime, the admin subdomain with 2FA, security tests, share cards and analytics, and launch.
