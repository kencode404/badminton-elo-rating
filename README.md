# Badminton ELO

Mobile-first PWA for tracking ELO ratings in a badminton club. Singles and doubles ratings are tracked **independently** per player, and every match must be confirmed by **all participants** before it counts.

Stack: Vite + React + TypeScript + Tailwind + Supabase (auth, Postgres, Realtime). Installable to phone home screen via PWA, also works in any browser.

## Quick start

```bash
# 1. Install
npm install

# 2. Configure env (already populated for the current Supabase project)
#    .env.local exists; copy .env.example for a fresh project

# 3. Run dev server
npm run dev

# 4. Run tests
npm test
```

## Database setup

The app lives in a Supabase project that is **shared with another app**, so every
database object is prefixed `badminton_` (tables, enum types, functions/RPCs,
indexes, the `auth.users` trigger, the `badminton_avatars` storage bucket).
Keep that prefix on anything new.

Open the Supabase SQL editor for the project and run the files in
[supabase/migrations/](supabase/migrations/) in order (`0001` … `0015`; all are
idempotent). Together they create:

- `badminton_profiles`, `badminton_matches`, `badminton_match_participants`, chat, season tables
- Auth trigger that auto-creates a profile row on sign-up — only for sign-ups tagged
  `app = 'badminton'` in user metadata, because `auth.users` is shared; other sign-ins
  (Google, accounts from the other app) get a profile via `badminton_ensure_profile()`
- Match-validation trigger (team sizes, no duplicate players)
- ELO settlement trigger that fires when the last participant confirms
- Row Level Security policies on all tables
- Realtime publications for live notifications
- `badminton_expire_old_matches()` function (call from a scheduled job)

Moving data from the previous stand-alone project: see
[scripts/migrate-to-shared/README.md](scripts/migrate-to-shared/README.md).

## Project layout

```
docs/ELO_CALCULATION.md   ← How ratings are computed. Read first if changing rating logic.
src/lib/elo.ts            ← Pure ELO functions. No DB calls. Heavily tested.
src/lib/elo.test.ts       ← Unit tests including the worked examples from the doc.
src/lib/supabase.ts       ← Supabase client.
src/lib/database.types.ts ← Hand-written DB row types.
src/pages/                ← Route-level pages.
src/components/           ← Shared UI: AppShell, ThemeProvider, NotificationBell.
supabase/migrations/      ← SQL schema + policies. Source of truth for the DB.
```

## Key design decisions

| Decision | Choice |
| --- | --- |
| Singles vs doubles ratings | Strictly separate, never mixed |
| Match confirmation | All participants must accept; any rejection voids it |
| Pending match expiry | 7 days |
| Score format | Single number per side (e.g. 21–18) |
| Doubles delta distribution | Equal split between partners |
| Starting rating | 1200 |
| K-factor | 40 for first 10 games per rating type, then 24 |

See [docs/ELO_CALCULATION.md](docs/ELO_CALCULATION.md) for the full rating system reference.

## Notification model

Pending confirmations show a badge on the bell icon in the header. When a player opens the app or is currently online and gets invited to a match, a popup invites them to accept or reject. Powered by Supabase Realtime subscriptions on `match_participants`.

## Security note

The Supabase **anon key** is designed to be public — it ships in the client bundle. Security comes from Row Level Security policies (defined in [supabase/migrations/0001_init.sql](supabase/migrations/0001_init.sql)). Never disable RLS on these tables.
