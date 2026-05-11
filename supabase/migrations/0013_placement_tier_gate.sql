-- Suppress tier-up chat announcements while a player is in placement
-- (their first 5 matches in a mode). When their 5th match in that
-- mode settles, announce their revealed tier — that single message
-- replaces every per-match tier-up they would have generated during
-- placement.
--
-- Scope:
--   * system_tier_up for an in-placement player → suppressed
--   * Exactly at games_played = 5 → emit a single system_tier_up
--     for every participant in the match (winner OR loser), since
--     placement reveal is independent of who won this match.
--   * Past placement (games_played > 5) → unchanged behavior.
--   * system_streak / system_streak_ended → unchanged (placement
--     players' streaks still announce).
--
-- Safe to rerun.

create or replace function public.refresh_chat_streak_messages()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  participant record;
  v_streak int;
  participant_won boolean;
  v_old_tier text;
  v_new_tier text;
  v_winner_ids uuid[];
  v_loser_streak int;
  v_games int;
  v_placement_games constant int := 5;
begin
  select array_agg(mp.user_id)
    into v_winner_ids
  from public.match_participants mp
  where mp.match_id = new.id
    and (
      (mp.team = 'A' and new.score_a > new.score_b)
      or (mp.team = 'B' and new.score_b > new.score_a)
    );

  for participant in
    select user_id, team, rating_before, rating_after
      from public.match_participants
     where match_id = new.id
  loop
    participant_won :=
      (participant.team = 'A' and new.score_a > new.score_b)
      or (participant.team = 'B' and new.score_b > new.score_a);

    -- Post-match games_played for this mode (settle_match already
    -- incremented it).
    if new.match_type = 'singles' then
      select singles_games_played into v_games
        from public.profiles where id = participant.user_id;
    else
      select doubles_games_played into v_games
        from public.profiles where id = participant.user_id;
    end if;

    -- Placement-complete reveal — fires for every participant whose
    -- 5th game just settled, regardless of win/loss.
    if v_games = v_placement_games and participant.rating_after is not null then
      insert into public.chat_messages
        (kind, user_id, match_type, tier_key, expires_at)
      values
        ('system_tier_up', participant.user_id, new.match_type,
         public.rating_to_tier_key(participant.rating_after),
         now() + interval '30 days');
    end if;

    if participant_won then
      -- (a) Existing on-going streak announcement (placement-agnostic).
      v_streak := public.current_streak_for_user_mode(
        participant.user_id, new.match_type);
      if v_streak >= 2 then
        insert into public.chat_messages
          (kind, user_id, match_type, streak_count, expires_at)
        values
          ('system_streak', participant.user_id, new.match_type, v_streak,
           now() + interval '30 days');
      end if;

      -- (b) Tier-up announcement: only after placement is over
      -- (games_played > 5). The exact placement-complete game is
      -- handled by the placement reveal block above.
      if v_games > v_placement_games
         and participant.rating_before is not null
         and participant.rating_after is not null then
        v_old_tier := public.rating_to_tier_key(participant.rating_before);
        v_new_tier := public.rating_to_tier_key(participant.rating_after);
        if v_new_tier <> v_old_tier
           and public.tier_rank(v_new_tier) > public.tier_rank(v_old_tier) then
          insert into public.chat_messages
            (kind, user_id, match_type, tier_key, expires_at)
          values
            ('system_tier_up', participant.user_id, new.match_type,
             v_new_tier, now() + interval '30 days');
        end if;
      end if;

    else
      -- (c) Streak-ended (placement-agnostic).
      if v_winner_ids is not null and array_length(v_winner_ids, 1) >= 1 then
        v_loser_streak := public.streak_before_match(
          participant.user_id, new.match_type, new.id);
        if v_loser_streak >= 2 then
          insert into public.chat_messages
            (kind, user_id, match_type, streak_count, breaker_user_ids, expires_at)
          values
            ('system_streak_ended', participant.user_id, new.match_type,
             v_loser_streak, v_winner_ids,
             now() + interval '30 days');
        end if;
      end if;
    end if;
  end loop;

  delete from public.chat_messages
   where kind in ('system_streak', 'system_tier_up', 'system_streak_ended')
     and expires_at is not null
     and expires_at < now();

  return new;
end;
$$;
