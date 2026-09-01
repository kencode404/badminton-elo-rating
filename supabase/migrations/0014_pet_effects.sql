-- Pet ownership effects — split into PASSIVE and ACTIVE.
--
-- PASSIVE (just owning a pet — stacks across pets):
--   Every owned pet contributes +1 shard/day. Own 2 pets → +2/day,
--   own all 4 → +4/day. Tracked via badminton_profiles.pets_last_payout_at.
--   claim_pet_daily() is called from the client on every useMyProfile
--   fetch — it floors the elapsed time since last payout into whole
--   days, credits shards = days × daily_rate, and advances the
--   timestamp by exactly that many days. Returns the number of
--   shards credited (0 if no full day has passed).
--
-- ACTIVE (only the equipped/deployed pet — does NOT stack):
--   vita  — no active effect
--   tard  — +1 ELO on every win
--   doux  — +2 ELO on every win
--   mort  — protects 20% of every ELO loss (multiplicative AFTER
--           the shield mitigation if one is armed, so Iron + Mort
--           stack: 50% off, then another 20% off the remainder)
--
-- Applied inside _settle_match_elo. Active effects do NOT consume
-- the pet — it's purely an ownership/equipped buff.
--
-- Safe to rerun.

-- =========================================================================
-- 1. pets_last_payout_at column
-- =========================================================================

alter table public.badminton_profiles
  add column if not exists pets_last_payout_at timestamptz not null default now();

-- =========================================================================
-- 2. claim_pet_daily — credit accumulated daily shards
-- =========================================================================

create or replace function public.badminton_claim_pet_daily()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_owned text[];
  v_last_payout timestamptz;
  v_now timestamptz := now();
  v_days int;
  v_rate int;
  v_amount int;
begin
  if v_caller is null then
    raise exception 'Must be signed in';
  end if;
  if v_caller = public.badminton_anonymous_user_id() then
    return 0;
  end if;

  select owned_pets, pets_last_payout_at
    into v_owned, v_last_payout
    from public.badminton_profiles where id = v_caller for update;

  -- Passive rate = 1 shard/day per owned pet (additive across pets).
  v_rate := coalesce(array_length(v_owned, 1), 0);

  if v_rate = 0 then
    return 0;
  end if;

  -- Whole days elapsed since last payout
  v_days := floor(extract(epoch from (v_now - v_last_payout)) / 86400)::int;
  if v_days <= 0 then
    return 0;
  end if;

  v_amount := v_days * v_rate;

  -- Advance the timestamp by exactly v_days × 1 day so partial days
  -- carry over into the next payout cycle.
  update public.badminton_profiles
     set shards = shards + v_amount,
         pets_last_payout_at = pets_last_payout_at + (v_days || ' days')::interval
   where id = v_caller;

  return v_amount;
end;
$$;

grant execute on function public.badminton_claim_pet_daily() to authenticated;

-- =========================================================================
-- 3. _settle_match_elo — apply deployed-pet active effects
--
-- Fourth override of this function (0010 → 0011 → 0012 → 0014).
--
-- Differences vs 0012:
--   * Read equipped_pet (NOT owned_pets) for each non-anonymous
--     participant. Only the deployed pet's active effect fires.
--   * On a WIN (raw delta > 0): equipped Tard → +1, Doux → +2.
--   * On a LOSS (raw delta < 0): equipped Mort → multiply the
--     post-shield delta by 0.8 (reduce loss by 20%). Stacks with
--     Iron/Aura shields multiplicatively.
-- =========================================================================

create or replace function public.badminton__settle_match_elo(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
  k_provisional constant int := 40;
  k_established constant int := 24;
  provisional_games constant int := 5;
  elo_divisor constant numeric := 400;
  margin_deadband constant int := 2;
  margin_divisor constant numeric := 21;
  margin_max_mult constant numeric := 2;
  shards_play constant int := 5;
  shards_win constant int := 5;
  shards_underdog constant int := 5;
  underdog_gap constant int := 2;
  shuttle_bonus constant int := 5;
  tard_win_bonus constant int := 1;
  doux_win_bonus constant int := 2;
  mort_loss_factor constant numeric := 0.8;  -- keep 80% of post-shield loss
  v_anon uuid := public.badminton_anonymous_user_id();
  v_shield text;
  v_booster text;
  v_raw_delta int;
  v_equipped_pet text;
  rating_a numeric;
  rating_b numeric;
  expected_a numeric;
  expected_b numeric;
  actual_a numeric;
  actual_b numeric;
  rating_col text;
  games_col text;
  peak_col text;
  participant record;
  current_rating int;
  current_games int;
  base_k int;
  effective_k numeric;
  team_actual numeric;
  team_expected numeric;
  delta int;
  score_diff int;
  margin_mult numeric;
  winning_team badminton_match_team;
  tier_avg_a numeric;
  tier_avg_b numeric;
  is_underdog_win boolean;
  shards_for_player int;
begin
  select * into m from public.badminton_matches where id = p_match_id for update;
  if not found then
    return;
  end if;

  if m.match_type = 'singles' then
    rating_col := 'singles_rating';
    games_col := 'singles_games_played';
    peak_col := 'peak_singles_rating';
  else
    rating_col := 'doubles_rating';
    games_col := 'doubles_games_played';
    peak_col := 'peak_doubles_rating';
  end if;

  execute format(
    'select avg(p.%I)::numeric
       from public.badminton_match_participants mp
       join public.badminton_profiles p on p.id = mp.user_id
      where mp.match_id = $1 and mp.team = $2::badminton_match_team',
    rating_col
  ) using p_match_id, 'A' into rating_a;

  execute format(
    'select avg(p.%I)::numeric
       from public.badminton_match_participants mp
       join public.badminton_profiles p on p.id = mp.user_id
      where mp.match_id = $1 and mp.team = $2::badminton_match_team',
    rating_col
  ) using p_match_id, 'B' into rating_b;

  expected_a := 1 / (1 + power(10, (rating_b - rating_a) / elo_divisor));
  expected_b := 1 - expected_a;

  if m.score_a > m.score_b then
    actual_a := 1; actual_b := 0;
    winning_team := 'A';
  else
    actual_a := 0; actual_b := 1;
    winning_team := 'B';
  end if;

  score_diff := abs(m.score_a - m.score_b);
  margin_mult := least(
    margin_max_mult,
    1 + greatest(0, score_diff - margin_deadband)::numeric / margin_divisor
  );

  execute format(
    'select avg(public.badminton_effective_tier_rank(p.%I, p.%I))::numeric
       from public.badminton_match_participants mp
       join public.badminton_profiles p on p.id = mp.user_id
      where mp.match_id = $1 and mp.team = $2::badminton_match_team
        and mp.user_id <> $3',
    rating_col, games_col
  ) using p_match_id, 'A', v_anon into tier_avg_a;

  execute format(
    'select avg(public.badminton_effective_tier_rank(p.%I, p.%I))::numeric
       from public.badminton_match_participants mp
       join public.badminton_profiles p on p.id = mp.user_id
      where mp.match_id = $1 and mp.team = $2::badminton_match_team
        and mp.user_id <> $3',
    rating_col, games_col
  ) using p_match_id, 'B', v_anon into tier_avg_b;

  is_underdog_win := false;
  if tier_avg_a is not null and tier_avg_b is not null then
    if winning_team = 'A' and (tier_avg_b - tier_avg_a) >= underdog_gap then
      is_underdog_win := true;
    elsif winning_team = 'B' and (tier_avg_a - tier_avg_b) >= underdog_gap then
      is_underdog_win := true;
    end if;
  end if;

  for participant in
    select user_id, team, slot
      from public.badminton_match_participants
     where match_id = p_match_id
  loop
    execute format('select %I, %I from public.badminton_profiles where id = $1', rating_col, games_col)
      using participant.user_id into current_rating, current_games;

    if participant.user_id = v_anon then
      update public.badminton_match_participants
         set rating_before = current_rating,
             rating_after = current_rating,
             rating_delta = 0,
             shards_earned = 0
       where match_id = p_match_id
         and user_id = participant.user_id
         and slot = participant.slot;
      continue;
    end if;

    base_k := case when current_games < provisional_games then k_provisional else k_established end;

    if participant.team = winning_team then
      effective_k := base_k * margin_mult;
    else
      effective_k := base_k;
    end if;

    if participant.team = 'A' then
      team_actual := actual_a; team_expected := expected_a;
    else
      team_actual := actual_b; team_expected := expected_b;
    end if;

    v_raw_delta := round(effective_k * (team_actual - team_expected));
    delta := v_raw_delta;
    v_shield := null;
    v_booster := null;
    v_equipped_pet := null;

    -- Read the player's equipped pet up front — relevant on both
    -- win (Tard/Doux) and loss (Mort) branches.
    select equipped_pet into v_equipped_pet
      from public.badminton_profiles where id = participant.user_id;

    if v_raw_delta < 0 then
      select armed_shield into v_shield
        from public.badminton_profiles where id = participant.user_id;
      if v_shield = 'iron' then
        delta := round(v_raw_delta::numeric / 2);
      elsif v_shield = 'aura' then
        delta := 0;
      else
        v_shield := null;
      end if;
      -- Mort active effect: 20% loss protection. Stacks with the
      -- shield multiplicatively (applied AFTER the shield, on the
      -- already-reduced delta). Mort isn't consumed.
      if v_equipped_pet = 'mort' then
        delta := round(delta::numeric * mort_loss_factor);
      end if;
    end if;

    if v_raw_delta > 0 then
      select armed_booster into v_booster
        from public.badminton_profiles where id = participant.user_id;
      if v_booster = 'shuttle' then
        delta := delta + shuttle_bonus;
      else
        v_booster := null;
      end if;
      -- Tard / Doux active win bonus — only the deployed pet's
      -- effect counts. Vita has no active effect.
      if v_equipped_pet = 'tard' then
        delta := delta + tard_win_bonus;
      elsif v_equipped_pet = 'doux' then
        delta := delta + doux_win_bonus;
      end if;
    end if;

    if participant.team = winning_team then
      shards_for_player := shards_play + shards_win
                          + case when is_underdog_win then shards_underdog else 0 end;
    else
      shards_for_player := shards_play;
    end if;

    update public.badminton_match_participants
       set rating_before = current_rating,
           rating_after = current_rating + delta,
           rating_delta = delta,
           shards_earned = shards_for_player,
           shield_consumed = v_shield,
           booster_consumed = v_booster
     where match_id = p_match_id
       and user_id = participant.user_id
       and slot = participant.slot;

    execute format(
      'update public.badminton_profiles
          set %I = %I + $1,
              %I = %I + 1,
              %I = greatest(%I, %I + $1),
              shards = shards + $3,
              armed_shield = case when $4::text is not null then null else armed_shield end,
              armed_booster = case when $5::text is not null then null else armed_booster end
        where id = $2',
      rating_col, rating_col,
      games_col, games_col,
      peak_col, peak_col, rating_col
    ) using delta, participant.user_id, shards_for_player, v_shield, v_booster;
  end loop;

  update public.badminton_matches
     set status = 'confirmed', confirmed_at = now(), elo_version = 2
   where id = p_match_id;

  perform public.badminton_refresh_anonymous_rating();
end;
$$;
