# Preview Modes

Hidden URL flags that prepend mock data to a real page so you can
inspect every visual variant without seeding the database. None of
them are linked from the UI; nothing is written to Supabase.

Drop the query param to return to a normal view.

---

## `?preview=tiers` — Leaderboard tier preview

**URL:** `/leaderboard?preview=tiers`
**Source:** [src/pages/LeaderboardPage.tsx](../src/pages/LeaderboardPage.tsx)
**Helper:** `buildPreviewRows(tab)`

Prepends six mock players (one per tier + a placement player) above
the real leaderboard so the per-tier row tints, glows, electric
sweep, medal artwork, and progress-bar states are all visible at
once. Mock players for the active tab (singles / doubles) get the
target rating; the inactive mode stays at 1000.

Mock players, descending by rating:

| Display name          | Rating | Games | Tier      |
| --------------------- | ------ | ----- | --------- |
| `[Preview] Predator`  | 1780   | 80    | Predator  |
| `[Preview] Diamond`   | 1500   | 50    | Diamond   |
| `[Preview] Gold`      | 1325   | 30    | Gold      |
| `[Preview] Silver`    | 1175   | 18    | Silver    |
| `[Preview] Bronze`    | 1040   | 12    | Bronze    |
| `[Preview] Newbie`    | 1000   | 2     | Placement |

Clicking a preview row opens the profile detail modal — it'll show
no profile data because the IDs aren't real (`preview-bronze`, etc.).
That's expected.

A small cyan banner at the top reminds you preview mode is active.

---

## `?preview=announcements` — Chat announcement preview

**URL:** `/?preview=announcements`  *(home / club chat)*
**Source:** [src/components/ClubChat.tsx](../src/components/ClubChat.tsx)
**Helper:** `buildPreviewAnnouncements()`

Prepends seven mock system messages above the real chat so all
new announcement variants render together. Useful when validating
the styling of `system_tier_up` and `system_streak_ended` without
playing matches that actually cross tier boundaries or break
streaks.

Mock messages, newest first:

| Kind                  | Player | Tier / Mode             | Notes                            |
| --------------------- | ------ | ----------------------- | -------------------------------- |
| `system_tier_up`      | Alice  | Bronze, singles         | Lowest tier card                 |
| `system_tier_up`      | Bob    | Silver, doubles         |                                  |
| `system_tier_up`      | Carol  | Gold, singles           |                                  |
| `system_tier_up`      | Dave   | Diamond, doubles        | Cyan accent + diamond image      |
| `system_tier_up`      | Erin   | Predator, doubles       | Red accent + predator image      |
| `system_streak_ended` | Frank  | 4-win singles streak    | One breaker (Carol)              |
| `system_streak_ended` | Gina   | 6-win doubles streak    | Two breakers (Carol & Dave)      |

The preview also seeds two breaker names (`preview-breaker-1` →
Carol, `preview-breaker-2` → Dave) so the streak-ended bubbles render
without a separate name fetch.

A small cyan banner at the top of the chat list confirms preview
mode is on.

---

## Adding a new preview mode

1. Pick a query param key (e.g. `?preview=newthing`) and read it via
   `useSearchParams()` inside the page/component.
2. Build a `buildPreview…()` function nearby that returns plausible
   mock objects matching the real type signatures.
3. Use a `useMemo` to merge mocks with real data when the preview
   flag is on.
4. Render a small cyan reminder banner so the mode is obvious.
5. Add a row to this doc.
