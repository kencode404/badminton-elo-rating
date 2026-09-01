-- Shop boosters — a second consumable slot, separate from shields.
--
-- v1 ships one booster:
--   * Shuttle Strike (50 shards) — your NEXT WIN gives +5 extra ELO
--     on top of the normal delta. Losses keep it armed. Singles or
--     doubles, whichever you win first.
--
-- Design choices:
--   * Separate slot from armed_shield, so a player can have a shield
--     AND a booster active simultaneously. They target opposite
--     outcomes (shield = mitigate loss, booster = amplify win), so
--     stacking is intentional.
--   * Buying is blocked while the slot is occupied (same UX as
--     shields — one at a time, no upgrade path in v1).
--   * armed_booster / booster_consumed are open text columns (not an
--     enum) so adding new booster kinds later is just a code change.
--
-- Safe to rerun.

-- =========================================================================
-- 1. Columns
-- =========================================================================

alter table public.badminton_profiles
  add column if not exists armed_booster text;

do $$ begin
  alter table public.badminton_profiles
    add constraint profiles_armed_booster_chk
    check (armed_booster is null or armed_booster in ('shuttle'));
exception when duplicate_object then null;
end $$;

alter table public.badminton_match_participants
  add column if not exists booster_consumed text;

do $$ begin
  alter table public.badminton_match_participants
    add constraint match_participants_booster_consumed_chk
    check (booster_consumed is null or booster_consumed in ('shuttle'));
exception when duplicate_object then null;
end $$;

-- =========================================================================
-- 2. _settle_match_elo — apply booster bonus on a win
--
-- This is the third override of this function (after 0010 → 0011).
-- Differences vs 0011:
--   (a) declare v_booster + v_booster_bonus
--   (b) AFTER shield logic and BEFORE writing the participant row,
--       if the player won (raw delta > 0), check armed_booster and
--       add the bonus
--   (c) clear armed_booster in the same UPDATE that applies the
--       rating change
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
  v_anon uuid := public.badminton_anonymous_user_id();
  v_shield text;
  v_booster text;
  v_raw_delta int;
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

    -- Shield consumption — only on an actual loss.
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
    end if;

    -- Booster consumption — only on an actual win.
    -- Note: applied to the raw delta sign, NOT the post-shield delta,
    -- since a shield + win can't co-occur (shields trigger on loss).
    if v_raw_delta > 0 then
      select armed_booster into v_booster
        from public.badminton_profiles where id = participant.user_id;
      if v_booster = 'shuttle' then
        delta := delta + shuttle_bonus;
      else
        v_booster := null;
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

    -- Apply rating + games + peak + shards + clear consumed slots.
    -- Both shield and booster can clear in the same UPDATE.
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

-- =========================================================================
-- 3. buy_booster — atomic deduct-and-arm (mirrors buy_shield)
-- =========================================================================

create or replace function public.badminton_buy_booster(p_kind text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_cost int;
  v_current int;
  v_armed text;
  v_new_balance int;
begin
  if v_caller is null then
    raise exception 'Must be signed in';
  end if;
  if v_caller = public.badminton_anonymous_user_id() then
    raise exception 'Anonymous cannot buy';
  end if;

  if p_kind = 'shuttle' then
    v_cost := 50;
  else
    raise exception 'Unknown booster: %', p_kind;
  end if;

  select shards, armed_booster into v_current, v_armed
    from public.badminton_profiles where id = v_caller for update;

  if v_armed is not null then
    raise exception 'A booster is already armed';
  end if;
  if coalesce(v_current, 0) < v_cost then
    raise exception 'Not enough shards (need %, have %)', v_cost, coalesce(v_current, 0);
  end if;

  update public.badminton_profiles
     set shards = shards - v_cost,
         armed_booster = p_kind
   where id = v_caller
   returning shards into v_new_balance;

  return v_new_balance;
end;
$$;

grant execute on function public.badminton_buy_booster(text) to authenticated;
