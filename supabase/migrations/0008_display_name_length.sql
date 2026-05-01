-- Tighten the display_name length cap from 40 to 15. Matches the new
-- client-side maxLength so the limit is enforced at every layer.
--
-- Steps:
--   1) Truncate any existing names longer than 15 chars to the first 15.
--   2) Swap the check constraint (1..40 → 1..15).
--   3) Patch handle_new_user so the email-derived fallback also fits.
--
-- Safe to rerun.

-- 1) Truncate any too-long names. Emit a NOTICE per row so the admin
--    can see who got changed.
do $$
declare
  r record;
begin
  for r in
    select id, display_name
      from public.profiles
     where char_length(display_name) > 15
  loop
    raise notice 'truncating display_name for %: % -> %',
      r.id, r.display_name, left(r.display_name, 15);
    update public.profiles
       set display_name = left(display_name, 15)
     where id = r.id;
  end loop;
end$$;

-- 2) Swap the check constraint.
alter table public.profiles
  drop constraint if exists profiles_display_name_check;

alter table public.profiles
  add constraint profiles_display_name_check
  check (char_length(display_name) between 1 and 15);

-- 3) Patch the auto-create trigger so the email-local fallback can
--    never violate the new cap.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(
      coalesce(
        new.raw_user_meta_data->>'display_name',
        split_part(new.email, '@', 1)
      ),
      15
    )
  );
  return new;
end;
$$;
