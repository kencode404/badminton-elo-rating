// Pure ELO calculation module. No DB calls, no side effects.
// See docs/ELO_CALCULATION.md for full math reference, examples, and rationale.

export const STARTING_RATING = 1200;
export const K_PROVISIONAL = 40;
export const K_ESTABLISHED = 24;
export const PROVISIONAL_GAMES = 10;
export const ELO_DIVISOR = 400;
export const MATCH_EXPIRY_DAYS = 7;

export const ELO_VERSION = 1;

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
  winner: Team;
}

export interface MatchResult {
  teamA: PlayerDelta[];
  teamB: PlayerDelta[];
  expectedA: number;
  expectedB: number;
  eloVersion: number;
}

export function calculateMatch(input: MatchInput): MatchResult {
  validateMatchInput(input);

  const ratingA = teamRating(input.teamA);
  const ratingB = teamRating(input.teamB);

  const expectedA = expectedScore(ratingA, ratingB);
  const expectedB = 1 - expectedA;

  const actualA = input.winner === 'A' ? 1 : 0;
  const actualB = 1 - actualA;

  const teamA = input.teamA.map((p) => playerDelta(p, actualA, expectedA));
  const teamB = input.teamB.map((p) => playerDelta(p, actualB, expectedB));

  return {
    teamA,
    teamB,
    expectedA,
    expectedB,
    eloVersion: ELO_VERSION,
  };
}

function playerDelta(
  player: PlayerSnapshot,
  actual: number,
  expected: number,
): PlayerDelta {
  const k = kFactor(player.gamesPlayed);
  const rawDelta = k * (actual - expected);
  const ratingDelta = Math.round(rawDelta);
  return {
    userId: player.userId,
    ratingBefore: player.rating,
    ratingAfter: player.rating + ratingDelta,
    ratingDelta,
    kFactor: k,
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
}
