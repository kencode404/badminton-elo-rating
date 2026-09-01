-- Shard economy + shop shields.
--
-- Currency rules (awarded when a match settles):
--   * 5 shards just for playing (win or lose)
--   * +5 for winning (so 10 total for a win)
--   * +5 underdog bonus if the winning team's average tier is at
--     least 2 ranks below the losing team's average tier
--     (so 15 total for an underdog win)
--
-- Placement players (< 5 games in the mode) count as tier 0 (below
-- Bronze) for the underdog check — so a placement player beating a
-- Silver+ opponent triggers the bonus, which feels right for upsets.
--
-- Anonymous slots never earn shards (it isn't a real player) and are
-- excluded from the team-tier averages so they don't dilute the gap.
--
-- Shop items (v1) — single armed shield slot per player, shared
-- across singles + doubles:
--   * Iron Shield  (60 shards) — blocks 50% of next ELO loss
--   * Aura Shield  (110 shards) — blocks 100% of next ELO loss
-- A shield only consumes on a LOSS (rating_delta < 0). Wins, draws,
-- and unsettled matches leave it armed. Players can only hold one
-- shield at a time (buying is blocked while armed).
--
-- shards_earned and shield_consumed are stamped onto each
-- match_participants row alongside the ELO delta so we can later
-- break down "where did my shards/protection come from" in the UI.
--
-- Safe to rerun.

-- =========================================================================
-- 1. Columns
-- =========================================================================

alter table public.badminton_profiles
  add column if not exists shards int not null default 0
    check (shards >= 0);

-- One armed shield slot per profile. Values: null | 'iron' | 'aura'.
-- Consumed by _settle_match_elo on the first match where the player
-- takes a rating loss; cleared on use. Wins keep it armed.
alter table public.badminton_profiles
  add column if not exists armed_shield text;

do $$ begin
  alter table public.badminton_profiles
    add constraint profiles_armed_shield_chk
    check (armed_shield is null or armed_shield in ('iron', 'aura'));
exception when duplicate_object then null;
end $$;

alter table public.badminton_match_participants
  add column if not exists shards_earned int not null default 0
    check (shards_earned >= 0);

-- Which shield (if any) absorbed this loss. Mirrors badminton_profiles.armed_shield
-- values so the UI can render "Iron blocked 12 ELO" later.
alter table public.badminton_match_participants
  add column if not exists shield_consumed text;

do $$ begin
  alter table public.badminton_match_participants
    add constraint match_participants_shield_consumed_chk
    check (shield_consumed is null or shield_consumed in ('iron', 'aura'));
exception when duplicate_object then null;
end $$;

create index if not exists badminton_profiles_shards_idx
  on public.badminton_profiles (shards desc);

-- =========================================================================
-- 2. effective_tier_rank — placement-aware wrapper around tier_rank
--    Placement players (< 5 games in mode) → 0 (below Bronze).
-- =========================================================================

create or replace function public.badminton_effective_tier_rank(
  p_rating int,
  p_games int
) returns int
language sql
immutable
as $$
  select case
    when p_games < 5 then 0
    else public.badminton_tier_rank(public.badminton_rating_to_tier_key(p_rating))
  end;
$$;

grant execute on function public.badminton_effective_tier_rank(int, int) to authenticated;

-- =========================================================================
-- 3. _settle_match_elo — extend with shard awards
--    The body is duplicated from 0010 with two additions:
--      (a) compute per-team avg tier rank up front (real players only)
--      (b) inside the participant loop, award shards based on
--          win/lose + underdog status, stamp the row, bump the
--          profile balance.
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
  v_anon uuid := public.badminton_anonymous_user_id();
  v_shield text;
  v_raw_delta int;
  v_blocked_amount int;
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

  -- Team mean ratings — anonymous's rating is included naturally.
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

  -- Per-team avg tier rank — REAL players only. Anonymous excluded so
  -- it doesn't shift the gap. NULL if a team is all anonymous (in which
  -- case underdog can't be computed and the bonus simply doesn't fire).
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

  -- Loop every slot. Anonymous slots get rating_before/after=current,
  -- delta=0, and shards_earned=0 — no payouts to a system account.
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
    v_blocked_amount := 0;

    -- Shield consumption — only triggers on an actual loss (delta < 0).
    -- Iron blocks 50%, Aura blocks 100%. The shield slot is cleared in
    -- the same UPDATE that applies the rating change so a second
    -- match in the same batch can't double-spend it.
    if v_raw_delta < 0 then
      select armed_shield into v_shield
        from public.badminton_profiles where id = participant.user_id;
      if v_shield = 'iron' then
        delta := round(v_raw_delta::numeric / 2);
        v_blocked_amount := v_raw_delta - delta;  -- both negative; diff is the saved amount
      elsif v_shield = 'aura' then
        delta := 0;
        v_blocked_amount := -v_raw_delta;
      else
        v_shield := null;
      end if;
    end if;

    -- Shard payout: 5 (play) + 5 (win) + 5 (underdog win)
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
           shield_consumed = v_shield
     where match_id = p_match_id
       and user_id = participant.user_id
       and slot = participant.slot;

    -- Apply rating + games + peak + shards + clear shield (if consumed).
    -- Clearing happens via case-when so non-consumed rows are untouched.
    execute format(
      'update public.badminton_profiles
          set %I = %I + $1,
              %I = %I + 1,
              %I = greatest(%I, %I + $1),
              shards = shards + $3,
              armed_shield = case when $4::text is not null then null else armed_shield end
        where id = $2',
      rating_col, rating_col,
      games_col, games_col,
      peak_col, peak_col, rating_col
    ) using delta, participant.user_id, shards_for_player, v_shield;

    -- Hush unused warning when not in a loss branch
    perform v_blocked_amount;
  end loop;

  update public.badminton_matches
     set status = 'confirmed', confirmed_at = now(), elo_version = 2
   where id = p_match_id;

  -- Anonymous's rating drifts with the club average.
  perform public.badminton_refresh_anonymous_rating();
end;
$$;

-- =========================================================================
-- 4. buy_shield — atomic deduct-and-arm.
--    Validates: signed in, not anonymous, kind is iron|aura, no shield
--    already armed, sufficient shards. Decrements shards by the cost
--    and sets armed_shield in a single UPDATE so a double-click can't
--    buy twice.
-- =========================================================================

create or replace function public.badminton_buy_shield(p_kind text)
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

  if p_kind = 'iron' then
    v_cost := 60;
  elsif p_kind = 'aura' then
    v_cost := 110;
  else
    raise exception 'Unknown shield: %', p_kind;
  end if;

  select shards, armed_shield into v_current, v_armed
    from public.badminton_profiles where id = v_caller for update;

  if v_armed is not null then
    raise exception 'A shield is already armed';
  end if;
  if coalesce(v_current, 0) < v_cost then
    raise exception 'Not enough shards (need %, have %)', v_cost, coalesce(v_current, 0);
  end if;

  update public.badminton_profiles
     set shards = shards - v_cost,
         armed_shield = p_kind
   where id = v_caller
   returning shards into v_new_balance;

  return v_new_balance;
end;
$$;

grant execute on function public.badminton_buy_shield(text) to authenticated;
