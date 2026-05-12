-- Edit a pending match — scores + players only, match_type is fixed.
--
-- Allowed when:
--   1) caller is the match's created_by
--   2) match.status = 'pending'
--   3) nobody besides the creator has accepted yet
-- Otherwise raises an exception.
--
-- The edit rewrites match_participants (delete + re-insert) so the
-- lineup can change freely. The creator is re-stamped as 'accepted'
-- automatically; everyone else starts at 'pending'. Match scores are
-- updated in place. The settle trigger doesn't fire because Team B
-- has zero accepts immediately after the rewrite.
--
-- Safe to rerun.

create or replace function public.update_pending_match(
  p_match_id uuid,
  p_partner_id uuid,                 -- nullable; pass NULL for singles
  p_opponent_ids uuid[],
  p_score_a int,
  p_score_b int
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
  v_caller uuid := auth.uid();
begin
  select * into m from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'Match not found';
  end if;
  if m.created_by <> v_caller then
    raise exception 'Only the match creator can edit it';
  end if;
  if m.status <> 'pending' then
    raise exception 'Match is no longer pending';
  end if;

  -- Guard: no non-creator may have accepted yet. We don't want to
  -- silently invalidate someone else's prior acceptance of the old
  -- data.
  if exists (
    select 1 from public.match_participants
     where match_id = p_match_id
       and user_id <> v_caller
       and confirmation = 'accepted'
  ) then
    raise exception 'Cannot edit — another player has already accepted';
  end if;

  -- Validate scores
  if p_score_a is null or p_score_b is null then
    raise exception 'Scores are required';
  end if;
  if p_score_a < 0 or p_score_b < 0 then
    raise exception 'Scores cannot be negative';
  end if;
  if p_score_a = p_score_b then
    raise exception 'Scores cannot be tied';
  end if;

  -- Validate participant count vs match_type (which is NOT editable)
  if m.match_type = 'singles' then
    if p_partner_id is not null then
      raise exception 'Singles has no partner';
    end if;
    if coalesce(array_length(p_opponent_ids, 1), 0) <> 1 then
      raise exception 'Singles needs exactly 1 opponent';
    end if;
  else
    if p_partner_id is null then
      raise exception 'Doubles needs a partner';
    end if;
    if coalesce(array_length(p_opponent_ids, 1), 0) <> 2 then
      raise exception 'Doubles needs exactly 2 opponents';
    end if;
    -- No duplicates
    if (
      select count(distinct id) from unnest(
        array[v_caller, p_partner_id] || p_opponent_ids
      ) as id
    ) <> 4 then
      raise exception 'Players must be unique';
    end if;
  end if;

  -- Apply: scores + participants
  update public.matches
     set score_a = p_score_a,
         score_b = p_score_b
   where id = p_match_id;

  delete from public.match_participants where match_id = p_match_id;

  insert into public.match_participants (match_id, user_id, team, confirmation)
  values (p_match_id, v_caller, 'A', 'accepted');

  if m.match_type = 'doubles' then
    insert into public.match_participants (match_id, user_id, team, confirmation)
    values (p_match_id, p_partner_id, 'A', 'pending');
  end if;

  insert into public.match_participants (match_id, user_id, team, confirmation)
  select p_match_id, opponent_id, 'B', 'pending'
    from unnest(p_opponent_ids) as opponent_id;
end;
$$;

grant execute on function public.update_pending_match(uuid, uuid, uuid[], int, int) to authenticated;
