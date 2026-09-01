# Migrating to the shared Supabase project

Moves this app from its own Supabase project (`sagogwylktikoqhvgmps`) into
the project shared with the other app (`mfjuuigfghzpqvjwobwg`). Every
database object is prefixed `badminton_` there so nothing collides with the
other app: tables, enum types, functions/RPCs, indexes, the `auth.users`
trigger, the storage bucket and its policies.

## What you need

| Item | Where |
| --- | --- |
| `psql` | Already on this machine: `C:\OSGeo4W\bin\psql.exe` (v13 client, fine) |
| OLD project connection URI | Old project → **Connect** → *Session pooler* URI (port 5432; the pooler is IPv4, direct is IPv6-only) |
| NEW project connection URI | Same, on the new project |
| OLD + NEW **service_role** keys | Project Settings → API. Only for `03_copy_avatars.mjs`; never ship these |

Run everything from this directory unless stated otherwise.

## 1. Schema on the new project

In the **new** project's SQL editor run, in order,
`supabase/migrations/0001_init.sql` … `0015_shared_project.sql`.
(Or run the generated one-shot file `00_schema.sql` in this directory.)
They are all idempotent.

`0010` creates the anonymous system user in `auth.users` and `0007` grants
admin to `khieng96@gmail.com` — that grant only takes effect once that user
exists in the new project (step 3), so re-run `0007` after the import if
the admin flag is missing.

## 2. Export from the old project

```powershell
mkdir data
psql "<OLD_URI>" -f 01_export.sql
```

Produces `data/*.sql` — one name-keyed JSON insert per row, so the old
project's physical column order does not matter. The script prints row
counts at the end; keep them for the check in step 3.

## 3. Import into the new project

```powershell
psql "<NEW_URI>" -f 02_import.sql
```

Single transaction: any error rolls the whole thing back, fix and re-run.
At the end it prints:

* **Merged accounts** — emails that already existed in the shared project.
  Those people were *not* duplicated; their badminton rows now point at
  their existing user id and they sign in with their existing (other-app)
  password. Everyone else keeps their id and password hash exactly as before.
* Row counts — compare with the export.

`auth.users` is shared, so the other app's sign-up trigger (if it has one)
fires for every imported user and may create rows in the other app's
tables. Check that app's user table afterwards and clean up if needed.

## 4. Copy avatars

```powershell
$env:OLD_SERVICE_KEY = '...'
$env:NEW_SERVICE_KEY = '...'
node ..\..\scripts\migrate-to-shared\03_copy_avatars.mjs   # or run from repo root
```

Object paths stay `{user_id}/avatar.jpg`; `02_import.sql` already rewrote
`avatar_url` on the profiles. Merged accounts (step 3) keep their old
folder name, so their current picture still loads but they need to
re-upload once to get a folder that matches their new id.

## 5. Project settings on the new project

Nothing in SQL covers these — mirror them from the old project's dashboard:

* **Authentication → Providers**: Email (confirm-email setting), Google
  (client id/secret). Add `https://mfjuuigfghzpqvjwobwg.supabase.co/auth/v1/callback`
  to the Google OAuth client's authorized redirect URIs.
* **Authentication → URL configuration**: Site URL + redirect URLs for the
  deployed app and `http://localhost:5173`.
* **Authentication → Email templates / SMTP** if customised.
* **Storage**: bucket `badminton_avatars` is created by `0002`; confirm it is
  public.
* **Database → Replication / Realtime**: `0001` + `0005` add the badminton
  tables to `supabase_realtime`; confirm in the dashboard.
* Any scheduled call of `badminton_expire_old_matches()` (pg_cron / edge
  function) — recreate it if one existed.

## 6. Cut over

1. Put the old project in read-only / pause it so no new matches land there.
2. Run steps 2–4 (fast; minutes).
3. Deploy the app with the new `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
   (the values now in `.env.local`; the old ones are in `.env.old-project.local`).
4. Users' existing sessions were issued by the old project and will not be
   valid — everyone signs in again once.

## Rollback

Until step 6.3 nothing touches the old project. To back out, redeploy with
the old env values from `.env.old-project.local`.
