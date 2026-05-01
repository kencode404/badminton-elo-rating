-- Drop the starting rating from 1200 to 1000.
-- Tier brackets were already designed around a 1000 baseline; this
-- change makes new signups land in Bronze (where the visible climb
-- starts) instead of Silver.
--
-- Existing rows are intentionally NOT touched. Their current ratings
-- represent real match history. The seasonal-reset feature (planned
-- separately) will re-baseline existing players when the time comes.
--
-- Safe to rerun.

alter table public.profiles
  alter column singles_rating set default 1000;

alter table public.profiles
  alter column doubles_rating set default 1000;
