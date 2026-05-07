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
| `system_user_banned`  | Hank   | —                       | Quiet centered grey log line     |
| `system_season_reset` | Boss Ken | —                     | Quiet centered grey log line     |

The preview also seeds two breaker names (`preview-breaker-1` →
Carol, `preview-breaker-2` → Dave) so the streak-ended bubbles render
without a separate name fetch.

A small cyan banner at the top of the chat list confirms preview
mode is on.

---

## `?preview=tiers` — Profile stat-card preview

**URL:** `/profile?preview=tiers`
**Source:** [src/pages/ProfilePage.tsx](../src/pages/ProfilePage.tsx)

Adds an extra "Preview" section above *Past Seasons Record* with one
mock `Stat` card per tier (Bronze through Predator) plus a Placement
card, so the per-tier accent border + tinted background applied to
**Current Season** cards is visible across every tier without
needing matches at each rating bracket.

Each preview card uses a rating parked in the middle of its bracket
so the bar shows roughly 50% progress.

| Card label | Mock rating         | Notes                              |
| ---------- | ------------------- | ---------------------------------- |
| Bronze     | mid of 0–1099       | Bronze border + warm-brown tint    |
| Silver     | mid of 1100–1249    |                                    |
| Gold       | mid of 1250–1399    |                                    |
| Diamond    | mid of 1400–1599    | Cyan accent                        |
| Predator   | 1680                | Red accent (top tier)              |
| Placement  | 1000, 2 games       | Neutral grey border, no tier       |

Real *Current Season* card stays visible above the preview block —
nothing is overwritten.

The same query param also seeds three mock **Past Seasons Record**
snapshots above any real ones, so that section's tier-tinted cards
can be inspected before the first real `reset_season()` has run.
Past-season cards display final rank (not raw rating):

| Season | Doubles outcome           | Singles outcome           |
| ------ | ------------------------- | ------------------------- |
| S3     | #1 · Diamond · 19W · 68%  | #4 · Gold · 14W · 64%     |
| S2     | #5 · Gold · 14W · 58%     | #9 · Silver · 9W · 50%    |
| S1     | #12 · Silver · 7W · 44%   | #17 · Bronze · 5W · 42%   |

---

## `?preview=rankup-{tier}` / `?preview=rankdown-{tier}` — Rank-change overlay

**URLs (any path under AppShell):**
- `/?preview=rankup-bronze` … `/?preview=rankup-predator`
- `/?preview=rankdown-bronze` … `/?preview=rankdown-predator`

**Source:** [src/components/RankChangeOverlay.tsx](../src/components/RankChangeOverlay.tsx),
detection in [src/components/AppShell.tsx](../src/components/AppShell.tsx)

Fires the full-screen tier-change celebration: dark backdrop, huge
TierBadge floating in the center with rise (up) or fall (down)
animation, tier-colored sparks for promotions, the tier name in
giant display type, and an OK button to return to the app. Refresh
the page to replay the animation from scratch.

| Direction       | Header     | Halo behavior                    |
| --------------- | ---------- | -------------------------------- |
| `rankup-{tier}` | RANK UP!   | Tier-color glow + 16 sparks      |
| `rankdown-{tier}`| RANK DOWN | Desaturated dim pulse, no sparks |

Suggested QA URLs (cover everything in two refreshes):
- `/?preview=rankup-gold`
- `/?preview=rankdown-gold`

Same overlay component is used for the real triggering flow (TBD —
will fire when a system_tier_up message is received for the current
user, or a future `system_demote` message is added).

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
