// Pure ELO calculation module. No DB calls, no side effects.
// See docs/ELO_CALCULATION.md for full math reference, examples, and rationale.

export const STARTING_RATING = 1200;
export const K_PROVISIONAL = 40;
export const K_ESTABLISHED = 24;
export const PROVISIONAL_GAMES = 5;
export const ELO_DIVISOR = 400;
export const MATCH_EXPIRY_DAYS = 7;

// Margin-of-victory tuning (winner only).
// score_diff <= MARGIN_DEADBAND  => multiplier 1.0 (no boost)
// score_diff >  MARGIN_DEADBAND  => multiplier 1 + (diff - deadband) / MARGIN_DIVISOR
// Capped at MARGIN_MAX_MULT.
export const MARGIN_DEADBAND = 2;
export const MARGIN_DIVISOR = 21;
export const MARGIN_MAX_MULT = 2;

// Bumped from 1 -> 2 when winner-only margin-of-victory boost was added.
export const ELO_VERSION = 2;

export type MatchType = 'singles' | 'doubles';
export type Team = 'A' | 'B';

export interface PlayerSnapshot {
  userId: string;
  rating: number;
  gamesPlayed: number;
}

export interface PlayerDelta {
  userId: string;
  ratingBefore: number;
  ratingAfter: number;
  ratingDelta: number;
  kFactor: number;
}

export function kFactor(gamesPlayed: number): number {
  return gamesPlayed < PROVISIONAL_GAMES ? K_PROVISIONAL : K_ESTABLISHED;
}

// Margin-of-victory multiplier applied to the WINNER's K only.
// Loser's K is never boosted.
export function marginMultiplier(scoreDiff: number): number {
  const effective = Math.max(0, scoreDiff - MARGIN_DEADBAND);
  return Math.min(MARGIN_MAX_MULT, 1 + effective / MARGIN_DIVISOR);
}

export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / ELO_DIVISOR));
}

export function teamRating(players: PlayerSnapshot[]): number {
  if (players.length === 0) {
    throw new Error('teamRating requires at least one player');
  }
  const sum = players.reduce((acc, p) => acc + p.rating, 0);
  return sum / players.length;
}

export interface MatchInput {
  type: MatchType;
  teamA: PlayerSnapshot[];
  teamB: PlayerSnapshot[];
  scoreA: number;
  scoreB: number;
}

export interface MatchResult {
  teamA: PlayerDelta[];
  teamB: PlayerDelta[];
  expectedA: number;
  expectedB: number;
  marginMultiplier: number;
  eloVersion: number;
}

export function calculateMatch(input: MatchInput): MatchResult {
  validateMatchInput(input);

  const ratingA = teamRating(input.teamA);
  const ratingB = teamRating(input.teamB);

  const expectedA = expectedScore(ratingA, ratingB);
  const expectedB = 1 - expectedA;

  const winnerIsA = input.scoreA > input.scoreB;
  const actualA = winnerIsA ? 1 : 0;
  const actualB = 1 - actualA;

  const scoreDiff = Math.abs(input.scoreA - input.scoreB);
  const mult = marginMultiplier(scoreDiff);

  const teamA = input.teamA.map((p) =>
    playerDelta(p, actualA, expectedA, winnerIsA ? mult : 1),
  );
  const teamB = input.teamB.map((p) =>
    playerDelta(p, actualB, expectedB, winnerIsA ? 1 : mult),
  );

  return {
    teamA,
    teamB,
    expectedA,
    expectedB,
    marginMultiplier: mult,
    eloVersion: ELO_VERSION,
  };
}

function playerDelta(
  player: PlayerSnapshot,
  actual: number,
  expected: number,
  kMultiplier: number,
): PlayerDelta {
  const baseK = kFactor(player.gamesPlayed);
  const effectiveK = baseK * kMultiplier;
  const rawDelta = effectiveK * (actual - expected);
  const ratingDelta = Math.round(rawDelta);
  return {
    userId: player.userId,
    ratingBefore: player.rating,
    ratingAfter: player.rating + ratingDelta,
    ratingDelta,
    kFactor: baseK,
  };
}

function validateMatchInput(input: MatchInput): void {
  const expectedSize = input.type === 'singles' ? 1 : 2;
  if (input.teamA.length !== expectedSize || input.teamB.length !== expectedSize) {
    throw new Error(
      `${input.type} match requires ${expectedSize} player(s) per team`,
    );
  }
  const ids = new Set<string>();
  for (const p of [...input.teamA, ...input.teamB]) {
    if (ids.has(p.userId)) {
      throw new Error(`Player ${p.userId} cannot appear twice in a match`);
    }
    ids.add(p.userId);
  }
  if (
    !Number.isInteger(input.scoreA) ||
    !Number.isInteger(input.scoreB) ||
    input.scoreA < 0 ||
    input.scoreB < 0
  ) {
    throw new Error('Scores must be non-negative integers');
  }
  if (input.scoreA === input.scoreB) {
    throw new Error('Scores cannot be tied');
  }
}
