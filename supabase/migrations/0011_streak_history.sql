-- Make streak announcements append-only so the chat retains history.
--
-- Previously the trigger replaced (or removed) a player's streak
-- announcement on every confirmed match — fine for a "current state"
-- board, wrong for a chat where past system messages should remain
-- as the timeline of what happened.
--
-- Now: every confirmed match where a player has a 2+ streak in that
-- mode appends a new system message. Losses don't post anything (and
-- don't delete previous wins). 30-day expiry still applies.
--
-- Drops the unique (user_id, match_type) WHERE kind='system_streak'
-- index since the same player can have many streak messages over time.
-- Safe to rerun.

drop index if exists public.chat_messages_active_streak_unique;

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
begin
  for participant in
    select user_id, team from public.match_participants where match_id = new.id
  loop
    participant_won :=
      (participant.team = 'A' and new.score_a > new.score_b)
      or (participant.team = 'B' and new.score_b > new.score_a);

    if participant_won then
      v_streak := public.current_streak_for_user_mode(participant.user_id, new.match_type);
      if v_streak >= 2 then
        insert into public.chat_messages
          (kind, user_id, match_type, streak_count, expires_at)
        values
          ('system_streak', participant.user_id, new.match_type, v_streak,
           now() + interval '30 days');
      end if;
    end if;
  end loop;

  -- Lazy cleanup of expired rows. User chat messages with expires_at
  -- = null are kept indefinitely.
  delete from public.chat_messages
  where kind = 'system_streak'
    and expires_at is not null
    and expires_at < now();

  return new;
end;
$$;
