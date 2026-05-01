-- Shorten the placement window from 10 games to 5 (per mode).
-- Players still use K_PROVISIONAL = 40 during this window so their
-- rating finds its level fast, then K drops to 24 once they're
-- 'established'. The starting rating itself is unchanged for now;
-- that change is reserved for the future seasonal-reset feature.
--
-- Updates settle_match in place. Safe to rerun.

create or replace function public.settle_match(p_match_id uuid)
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
  rating_a numeric;
  rating_b numeric;
  expected_a numeric;
  expected_b numeric;
  actual_a numeric;
  actual_b numeric;
  rating_col text;
  games_col text;
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
  winning_team match_team;
begin
  select * into m from public.matches where id = p_match_id for update;
  if not found or m.status <> 'pending' then
    return;
  end if;

  if exists (
    select 1 from public.match_participants
    where match_id = p_match_id and confirmation <> 'accepted'
  ) then
    return;
  end if;

  if m.match_type = 'singles' then
    rating_col := 'singles_rating';
    games_col := 'singles_games_played';
  else
    rating_col := 'doubles_rating';
    games_col := 'doubles_games_played';
  end if;

  execute format(
    'select avg(p.%I)::numeric
       from public.match_participants mp
       join public.profiles p on p.id = mp.user_id
      where mp.match_id = $1 and mp.team = $2::match_team',
    rating_col
  ) using p_match_id, 'A' into rating_a;

  execute format(
    'select avg(p.%I)::numeric
       from public.match_participants mp
       join public.profiles p on p.id = mp.user_id
      where mp.match_id = $1 and mp.team = $2::match_team',
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
  margin_mult := least(margin_max_mult, 1 + greatest(0, score_diff - margin_deadband)::numeric / margin_divisor);

  for participant in
    select user_id, team from public.match_participants where match_id = p_match_id
  loop
    execute format('select %I, %I from public.profiles where id = $1', rating_col, games_col)
      using participant.user_id into current_rating, current_games;

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

    delta := round(effective_k * (team_actual - team_expected));

    update public.match_participants
       set rating_before = current_rating,
           rating_after = current_rating + delta,
           rating_delta = delta
     where match_id = p_match_id and user_id = participant.user_id;

    execute format(
      'update public.profiles set %I = %I + $1, %I = %I + 1 where id = $2',
      rating_col, rating_col, games_col, games_col
    ) using delta, participant.user_id;
  end loop;

  update public.matches
     set status = 'confirmed', confirmed_at = now(), elo_version = 2
   where id = p_match_id;
end;
$$;
