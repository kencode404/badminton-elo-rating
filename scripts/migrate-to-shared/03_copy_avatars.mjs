// Copy every object in the OLD project's `avatars` bucket to the NEW
// project's `badminton_avatars` bucket, keeping the same object paths
// ({user_id}/avatar.jpg). 02_import.sql already rewrote avatar_url on the
// profiles to point at the new bucket, so once this finishes the pictures
// show up again.
//
// Needs the SERVICE ROLE key of both projects (Dashboard → Project
// Settings → API). Run from the repo root so @supabase/supabase-js resolves:
//
//   set OLD_SERVICE_KEY=...   (PowerShell: $env:OLD_SERVICE_KEY='...')
//   set NEW_SERVICE_KEY=...
//   node scripts/migrate-to-shared/03_copy_avatars.mjs
//
// Idempotent: uploads use upsert, so re-running just overwrites.

import { createClient } from '@supabase/supabase-js';

const OLD_URL = process.env.OLD_URL ?? 'https://sagogwylktikoqhvgmps.supabase.co';
const NEW_URL = process.env.NEW_URL ?? 'https://mfjuuigfghzpqvjwobwg.supabase.co';
const OLD_BUCKET = process.env.OLD_BUCKET ?? 'avatars';
const NEW_BUCKET = process.env.NEW_BUCKET ?? 'badminton_avatars';
const { OLD_SERVICE_KEY, NEW_SERVICE_KEY } = process.env;

if (!OLD_SERVICE_KEY || !NEW_SERVICE_KEY) {
  console.error('Set OLD_SERVICE_KEY and NEW_SERVICE_KEY (service_role keys) in the environment.');
  process.exit(1);
}

const oldDb = createClient(OLD_URL, OLD_SERVICE_KEY, { auth: { persistSession: false } });
const newDb = createClient(NEW_URL, NEW_SERVICE_KEY, { auth: { persistSession: false } });

async function listRecursive(client, bucket, prefix = '') {
  const out = [];
  let offset = 0;
  const limit = 1000;
  for (;;) {
    const { data, error } = await client.storage.from(bucket).list(prefix, { limit, offset });
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
    for (const entry of data ?? []) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      // Folders come back with id === null.
      if (entry.id === null) out.push(...(await listRecursive(client, bucket, path)));
      else out.push({ path, mimetype: entry.metadata?.mimetype ?? 'application/octet-stream' });
    }
    if (!data || data.length < limit) break;
    offset += limit;
  }
  return out;
}

const files = await listRecursive(oldDb, OLD_BUCKET);
console.log(`${files.length} object(s) in ${OLD_URL} / ${OLD_BUCKET}`);

let ok = 0;
const failed = [];
for (const f of files) {
  try {
    const { data: blob, error: dlErr } = await oldDb.storage.from(OLD_BUCKET).download(f.path);
    if (dlErr) throw dlErr;
    const { error: upErr } = await newDb.storage
      .from(NEW_BUCKET)
      .upload(f.path, blob, { contentType: f.mimetype, upsert: true, cacheControl: '3600' });
    if (upErr) throw upErr;
    ok += 1;
    console.log(`copied ${f.path}`);
  } catch (err) {
    failed.push({ path: f.path, error: err?.message ?? String(err) });
    console.error(`FAILED ${f.path}: ${err?.message ?? err}`);
  }
}

console.log(`\n${ok} copied, ${failed.length} failed`);
if (failed.length) process.exit(2);
