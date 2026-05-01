# ELO Rating Calculation — Reference Document

This file is the single source of truth for how ratings are calculated in the Badminton ELO app. If you change any constant or formula here, also update `src/lib/elo.ts` and add a note under [Change Log](#change-log).

---

## 1. Overview

Every player has **two completely independent ratings**:

| Rating          | Updated by               | Default | Stored in                      |
| --------------- | ------------------------ | ------- | ------------------------------ |
| Singles rating  | Singles matches only     | 1200    | `profiles.singles_rating`      |
| Doubles rating  | Doubles matches only     | 1200    | `profiles.doubles_rating`      |

**Rule of separation:** A singles result NEVER affects the doubles rating, and vice versa. Game counts (`singles_games_played`, `doubles_games_played`) are also tracked independently.

---

## 2. Constants

All constants are exported from [`src/lib/elo.ts`](../src/lib/elo.ts). To change the system, edit them there and update this section.

| Constant              | Value | Meaning                                                                |
| --------------------- | ----- | ---------------------------------------------------------------------- |
| `STARTING_RATING`     | 1200  | Initial rating for any new player, both singles and doubles.           |
| `K_PROVISIONAL`       | 40    | K-factor used while a player is in their provisional period.           |
| `K_ESTABLISHED`       | 24    | K-factor used after the provisional period.                            |
| `PROVISIONAL_GAMES`   | 5     | Number of games (per rating type) before a player is "established". Also drives the placement window in the UI. |
| `ELO_DIVISOR`         | 400   | Standard ELO scaling factor in the expected-score formula.             |
| `MATCH_EXPIRY_DAYS`   | 7     | A pending match auto-expires after this many days. No rating change.   |
| `MARGIN_DEADBAND`     | 2     | Score differences ≤ this trigger no margin-of-victory boost.           |
| `MARGIN_DIVISOR`      | 21    | Slope of the margin multiplier above the deadband.                     |
| `MARGIN_MAX_MULT`     | 2     | Hard cap on the winner's K multiplier from a blowout.                  |

### Why these values

- **STARTING_RATING = 1200**: Common casual-game default. Lower than chess's 1500 because we don't want big negative deltas to push new players below 1000 too quickly.
- **K_PROVISIONAL = 40 / PROVISIONAL_GAMES = 5**: A player hits 5 games quickly in a club setting. A high K during this window lets the rating find its true level fast instead of crawling there over months. The same threshold doubles as the UI "placement matches" window — no tier badge is shown until placement is complete.
- **K_ESTABLISHED = 24**: Slightly higher than chess's 16 because a small population produces less data per player; we want ratings to stay responsive. Lower this to 16 once the active player base is comfortably past ~30 players.
- **ELO_DIVISOR = 400**: Standard. Don't change unless you're switching to a different rating system entirely (e.g. Glicko).

---

## 3. The math

### 3.1 Expected score

For two players (or two teams) with ratings $R_A$ and $R_B$, the expected score for A is:

$$
E_A = \frac{1}{1 + 10^{(R_B - R_A) / 400}}
$$

And $E_B = 1 - E_A$.

This is a number between 0 and 1 that represents the probability of A winning, given the rating difference. A 400-point gap means the higher-rated side is expected to win ~91% of the time.

### 3.2 Actual score

| Outcome       | $S_A$ | $S_B$ |
| ------------- | ----- | ----- |
| A wins        | 1     | 0     |
| B wins        | 0     | 1     |

Ties are not currently supported — badminton matches always have a winner.

### 3.3 Rating update

For each player, an *effective* K is computed:

- **Loser:** $K_{\text{eff}} = K_{\text{base}}$ (no boost)
- **Winner:** $K_{\text{eff}} = K_{\text{base}} \cdot M$, where $M$ is the margin multiplier

Then the delta is:

$$
R_A' = R_A + K_{\text{eff}} \cdot (S_A - E_A)
$$

The delta is rounded to the nearest integer before being stored. Ratings are stored as integers.

### 3.3.1 Margin-of-victory multiplier (winner only)

$$
M = \min\left(2,\; 1 + \frac{\max(0,\; |s_A - s_B| - 2)}{21}\right)
$$

So a 21–19 game (diff 2) gives $M = 1$ and behaves exactly like classic ELO.
A 21–2 thrashing (diff 19) gives $M \approx 1.81$. A theoretical infinite gap caps at 2.

The multiplier applies to the **winning team's** K only; the losing team always uses base K. As a consequence the system is no longer strictly zero-sum: every match injects a small amount of rating into the pool. Over thousands of matches the average rating drifts up slowly, but rankings stay correct.

### 3.4 K-factor selection (per player, per rating type)

```
if games_played_in_this_rating_type < PROVISIONAL_GAMES:
    K = K_PROVISIONAL   # 40
else:
    K = K_ESTABLISHED   # 24
```

The threshold is checked **before** the current match is counted. A player playing their 10th-ever singles match still uses K=40 for that match; their 11th uses K=24.

---

## 4. Singles calculation — worked example

**Setup:**

- Alice: singles rating 1300, 15 singles games played → K=24
- Bob: singles rating 1250, 4 singles games played → K=40
- Result: Alice wins 21–18

**Step 1: Expected scores**

$$
E_A = \frac{1}{1 + 10^{(1250 - 1300)/400}} = \frac{1}{1 + 10^{-0.125}} \approx 0.5714
$$

$$
E_B = 1 - 0.5714 = 0.4286
$$

**Step 2: Actual scores**

$S_A = 1$, $S_B = 0$.

**Step 3: Deltas**

- Alice: $\Delta_A = 24 \cdot (1 - 0.5714) = 24 \cdot 0.4286 \approx +10.29 \rightarrow +10$
- Bob:   $\Delta_B = 40 \cdot (0 - 0.4286) = 40 \cdot (-0.4286) \approx -17.14 \rightarrow -17$

**Step 4: New ratings**

- Alice: 1300 + 10 = **1310**
- Bob: 1250 − 17 = **1233**

Note: Alice and Bob had different K-factors, so the deltas are asymmetric. This is expected — the system gives Bob's rating more room to move while it's still settling.

---

## 5. Doubles calculation — worked example

**Setup:**

- Team A: Alice (doubles 1300, established K=24) + Carol (doubles 1100, established K=24)
- Team B: Bob   (doubles 1250, provisional K=40) + Dave  (doubles 1400, established K=24)
- Result: Team A wins 21–17

**Step 1: Team ratings (mean of partners)**

- $R_A = (1300 + 1100) / 2 = 1200$
- $R_B = (1250 + 1400) / 2 = 1325$

**Step 2: Expected scores (using team ratings)**

$$
E_A = \frac{1}{1 + 10^{(1325 - 1200)/400}} = \frac{1}{1 + 10^{0.3125}} \approx 0.3294
$$

$E_B \approx 0.6706$.

**Step 3: Per-player deltas (each player uses their own K)**

Each player computes their own delta against their team's expected score and the team's actual score. **Equal split** means partners share the same `(S − E)` term, but each multiplies by their personal K.

- Alice: $\Delta = 24 \cdot (1 - 0.3294) \approx +16.09 \rightarrow +16$
- Carol: $\Delta = 24 \cdot (1 - 0.3294) \approx +16.09 \rightarrow +16$
- Bob:   $\Delta = 40 \cdot (0 - 0.6706) \approx -26.83 \rightarrow -27$
- Dave:  $\Delta = 24 \cdot (0 - 0.6706) \approx -16.09 \rightarrow -16$

**Step 4: New ratings**

- Alice: 1300 + 16 = **1316**
- Carol: 1100 + 16 = **1116**
- Bob:   1250 − 27 = **1223**
- Dave:  1400 − 16 = **1384**

Notes:
- Alice and Carol receive identical deltas because they're on the same team and both have K=24. This is the "equal split" rule.
- Bob's bigger drop reflects his provisional K=40 — he's still finding his level.
- The total rating change isn't zero-sum across the four players because of asymmetric K-factors. This is intentional and standard in ELO systems with provisional periods.

---

## 6. Edge cases & rules

| Situation                                        | Behavior                                                                    |
| ------------------------------------------------ | --------------------------------------------------------------------------- |
| Pending match older than 7 days                  | Auto-expired by scheduled job. `status = 'expired'`. No rating change.      |
| Any participant rejects                          | `status = 'rejected'`. No rating change.                                    |
| All participants accept                          | DB trigger calculates ratings, snapshots `rating_before` / `rating_after`.  |
| Same player on both teams of a doubles match     | Blocked at the UI and DB level. Cannot be created.                          |
| Score 0–0 or identical scores                    | Blocked at the UI level. Badminton always has a winner.                     |
| Player deletes account before confirmation       | Pending matches involving them are auto-rejected.                           |
| Rating drops below 0                             | Allowed mathematically but extremely unlikely. No floor enforced for now.   |

---

## 7. What we deliberately don't do (yet)

These are common ELO variants we've chosen to skip in v1 to keep the system simple. Add them only if real usage shows a need.

- **Margin-of-victory bonus.** A 21–5 win and a 21–19 win produce identical rating changes. ELO purists prefer this; add a multiplier like `ln(point_diff + 1)` if you want margins to matter.
- **Rating decay for inactivity.** Players who don't play for months keep their rating untouched.
- **Per-pair doubles ratings.** Each player has one doubles rating regardless of who they partner with. We could track pair ratings additionally but it complicates the UI.
- **Best-of-3 game tracking.** We store one final score, not per-game scores.
- **Glicko / Glicko-2.** More accurate for small populations but adds rating-deviation complexity. ELO is good enough at our scale.

---

## 8. How to change the system safely

1. Edit constants in [`src/lib/elo.ts`](../src/lib/elo.ts).
2. Update the corresponding row in [Section 2](#2-constants) of this document.
3. Add an entry to the [Change Log](#change-log) below: date, what changed, why.
4. Run the unit tests: `npm test`. Update test expectations if the formula intentionally changed.
5. **Do NOT retroactively recompute past matches.** Leave historical `rating_before` / `rating_after` snapshots untouched — they reflect the rules in effect at the time. Going forward, only new matches use the new constants.

If you're changing the *formula* (not just constants), also:
- Bump a `ELO_VERSION` constant in `elo.ts`
- Stamp the version onto each new match record so we can tell which rule set produced any given delta.

---

## 9. Change log

| Date       | Change                                  | Reason                                    |
| ---------- | --------------------------------------- | ----------------------------------------- |
| 2026-04-29 | Initial system: K=40→24 after 10 games, start 1200, equal-split doubles, single-number scores, 7-day expiry. | App launch with 5–10 player group. |
| 2026-04-30 | ELO_VERSION 1 → 2. Winner-only margin-of-victory multiplier added: `K_eff = K_base × min(2, 1 + max(0, diff − 2)/21)`. Loser keeps base K. | User feedback that a 21-2 win and a 21-19 win shouldn't reward identically. |
| 2026-05-01 | `PROVISIONAL_GAMES` 10 → 5. UI tier system added (Bronze/Silver/Gold/Diamond/Champion) — pure presentation over rating. Tier brackets aligned to a future 1000 starting rating; current 1200 start lands in Silver intentionally. | Faster onboarding to "established" rating, plus visible progression goals. |
