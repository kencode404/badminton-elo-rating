-- Pets — permanent shop unlocks (unlike shields/boosters, never consumed).
--
-- v1 ships four tiered dino pets — price + a minimum tier rank gate.
-- Eligibility is the player's BEST tier across singles + doubles
-- (so being Predator in one mode unlocks the top pet even if the
-- other mode is still Silver).
--
-- Pet      Color    Price   Min tier
-- ----     ------   -----   ----------
-- vita     green    350     Silver+   (rank ≥ 2)
-- tard     yellow   500     Gold+     (rank ≥ 3)
-- doux     blue     600     Diamond+  (rank ≥ 4)
-- mort     red      700     Predator  (rank = 5)
--
-- Tier ranks come from effective_tier_rank (0=placement, 1=bronze,
-- 2=silver, 3=gold, 4=diamond, 5=predator). Placement players (< 5
-- games) can't buy any pet — they need to finish placement first.
--
-- Each is a one-time purchase. Once owned, the player can equip any
-- pet they own to display next to their avatar on the leaderboard.
-- Buying auto-equips ONLY when nothing is currently equipped — once
-- you have an active pet, new purchases land in your collection but
-- you keep your current display until you explicitly tap Equip.
-- equip_pet accepts NULL to unequip (show no pet).
--
-- Schema choices:
--   * owned_pets text[] — array of pet keys. Permits future
--     additions without schema churn.
--   * equipped_pet text — single key, must be in owned_pets when
--     non-null. Enforced by the equip_pet RPC.
--   * Both default to empty/null so existing rows are unaffected.
--
-- Safe to rerun.

-- =========================================================================
-- 1. Columns
-- =========================================================================

alter table public.profiles
  add column if not exists owned_pets text[] not null default '{}'::text[];

alter table public.profiles
  add column if not exists equipped_pet text;

do $$ begin
  alter table public.profiles
    add constraint profiles_equipped_pet_chk
    check (equipped_pet is null or equipped_pet in ('doux', 'mort', 'tard', 'vita'));
exception when duplicate_object then null;
end $$;

-- =========================================================================
-- 2. buy_pet — deduct, add to owned, auto-equip
-- =========================================================================

create or replace function public.buy_pet(p_kind text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_cost int;
  v_required_tier int;
  v_singles_tier int;
  v_doubles_tier int;
  v_best_tier int;
  v_current_shards int;
  v_owned text[];
  v_singles_rating int;
  v_singles_games int;
  v_doubles_rating int;
  v_doubles_games int;
  v_new_balance int;
begin
  if v_caller is null then
    raise exception 'Must be signed in';
  end if;
  if v_caller = public.anonymous_user_id() then
    raise exception 'Anonymous cannot buy';
  end if;

  -- Per-pet price + minimum tier rank gate.
  if p_kind = 'vita' then
    v_cost := 350; v_required_tier := 2;  -- silver+
  elsif p_kind = 'tard' then
    v_cost := 500; v_required_tier := 3;  -- gold+
  elsif p_kind = 'doux' then
    v_cost := 600; v_required_tier := 4;  -- diamond+
  elsif p_kind = 'mort' then
    v_cost := 700; v_required_tier := 5;  -- predator
  else
    raise exception 'Unknown pet: %', p_kind;
  end if;

  select singles_rating, singles_games_played,
         doubles_rating, doubles_games_played,
         shards, owned_pets
    into v_singles_rating, v_singles_games,
         v_doubles_rating, v_doubles_games,
         v_current_shards, v_owned
    from public.profiles where id = v_caller for update;

  -- Best tier across both modes — being Predator in either mode
  -- qualifies you for the top pet.
  v_singles_tier := public.effective_tier_rank(v_singles_rating, v_singles_games);
  v_doubles_tier := public.effective_tier_rank(v_doubles_rating, v_doubles_games);
  v_best_tier := greatest(v_singles_tier, v_doubles_tier);

  if v_best_tier < v_required_tier then
    raise exception
      'This pet requires tier rank % (singles or doubles); your best is %',
      v_required_tier, v_best_tier;
  end if;

  if p_kind = any(coalesce(v_owned, '{}'::text[])) then
    raise exception 'You already own this pet';
  end if;
  if coalesce(v_current_shards, 0) < v_cost then
    raise exception 'Not enough shards (need %, have %)',
      v_cost, coalesce(v_current_shards, 0);
  end if;

  -- Auto-equip the new pet ONLY when nothing is currently equipped
  -- (preserves the player's display choice once they've made one).
  update public.profiles
     set shards = shards - v_cost,
         owned_pets = array_append(coalesce(owned_pets, '{}'::text[]), p_kind),
         equipped_pet = coalesce(equipped_pet, p_kind)
   where id = v_caller
   returning shards into v_new_balance;

  return v_new_balance;
end;
$$;

grant execute on function public.buy_pet(text) to authenticated;

-- =========================================================================
-- 3. equip_pet — swap which pet is displayed (must already own it).
--    Pass NULL to unequip.
-- =========================================================================

create or replace function public.equip_pet(p_kind text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_owned text[];
begin
  if v_caller is null then
    raise exception 'Must be signed in';
  end if;

  if p_kind is null then
    update public.profiles set equipped_pet = null where id = v_caller;
    return;
  end if;

  if p_kind not in ('doux', 'mort', 'tard', 'vita') then
    raise exception 'Unknown pet: %', p_kind;
  end if;

  select owned_pets into v_owned
    from public.profiles where id = v_caller;
  if not (p_kind = any(coalesce(v_owned, '{}'::text[]))) then
    raise exception 'You do not own this pet';
  end if;

  update public.profiles set equipped_pet = p_kind where id = v_caller;
end;
$$;

grant execute on function public.equip_pet(text) to authenticated;
