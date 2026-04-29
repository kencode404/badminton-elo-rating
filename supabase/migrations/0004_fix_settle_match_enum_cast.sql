-- Fix 42883 "operator does not exist: match_team = text" inside settle_match.
--
-- The function builds dynamic SQL like `... where mp.team = $2 ...` and binds
-- the literal 'A' or 'B'. The bound parameter is text, but `mp.team` is the
-- match_team enum, and Postgres has no implicit text → enum cast.
--
-- Fix: cast $2 to match_team in the dynamic SQL.
-- Safe to rerun.

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
  provisional_games constant int := 10;
  elo_divisor constant numeric := 400;
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
  k int;
  team_actual numeric;
  team_expected numeric;
  delta int;
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
  else
    actual_a := 0; actual_b := 1;
  end if;

  for participant in
    select user_id, team from public.match_participants where match_id = p_match_id
  loop
    execute format('select %I, %I from public.profiles where id = $1', rating_col, games_col)
      using participant.user_id into current_rating, current_games;

    k := case when current_games < provisional_games then k_provisional else k_established end;

    if participant.team = 'A' then
      team_actual := actual_a; team_expected := expected_a;
    else
      team_actual := actual_b; team_expected := expected_b;
    end if;

    delta := round(k * (team_actual - team_expected));

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
     set status = 'confirmed', confirmed_at = now()
   where id = p_match_id;
end;
$$;
