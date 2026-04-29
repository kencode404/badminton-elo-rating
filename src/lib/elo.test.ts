import { describe, expect, it } from 'vitest';
import {
  K_ESTABLISHED,
  K_PROVISIONAL,
  PROVISIONAL_GAMES,
  STARTING_RATING,
  calculateMatch,
  expectedScore,
  kFactor,
  teamRating,
} from './elo';

describe('kFactor', () => {
  it('uses provisional K for new players', () => {
    expect(kFactor(0)).toBe(K_PROVISIONAL);
    expect(kFactor(PROVISIONAL_GAMES - 1)).toBe(K_PROVISIONAL);
  });

  it('switches to established K at the threshold', () => {
    expect(kFactor(PROVISIONAL_GAMES)).toBe(K_ESTABLISHED);
    expect(kFactor(PROVISIONAL_GAMES + 50)).toBe(K_ESTABLISHED);
  });
});

describe('expectedScore', () => {
  it('returns 0.5 for equal ratings', () => {
    expect(expectedScore(1500, 1500)).toBeCloseTo(0.5, 6);
  });

  it('gives higher expected score to higher rating', () => {
    const e = expectedScore(1600, 1400);
    expect(e).toBeGreaterThan(0.5);
    expect(e).toBeLessThan(1);
  });

  it('400-point gap yields ~0.909 win probability', () => {
    expect(expectedScore(1800, 1400)).toBeCloseTo(10 / 11, 3);
  });

  it('is symmetric: E(A,B) + E(B,A) = 1', () => {
    expect(expectedScore(1300, 1500) + expectedScore(1500, 1300)).toBeCloseTo(1, 6);
  });
});

describe('teamRating', () => {
  it('returns the mean of partner ratings', () => {
    expect(
      teamRating([
        { userId: 'a', rating: 1300, gamesPlayed: 0 },
        { userId: 'b', rating: 1100, gamesPlayed: 0 },
      ]),
    ).toBe(1200);
  });

  it('throws on empty team', () => {
    expect(() => teamRating([])).toThrow();
  });
});

describe('calculateMatch — singles', () => {
  it('matches the worked example in ELO_CALCULATION.md (Alice 1300/15g vs Bob 1250/4g, Alice wins)', () => {
    const result = calculateMatch({
      type: 'singles',
      teamA: [{ userId: 'alice', rating: 1300, gamesPlayed: 15 }],
      teamB: [{ userId: 'bob', rating: 1250, gamesPlayed: 4 }],
      winner: 'A',
    });

    expect(result.teamA[0].kFactor).toBe(K_ESTABLISHED);
    expect(result.teamB[0].kFactor).toBe(K_PROVISIONAL);
    expect(result.teamA[0].ratingDelta).toBe(10);
    expect(result.teamB[0].ratingDelta).toBe(-17);
    expect(result.teamA[0].ratingAfter).toBe(1310);
    expect(result.teamB[0].ratingAfter).toBe(1233);
  });

  it('asymmetric K means deltas are not zero-sum', () => {
    const result = calculateMatch({
      type: 'singles',
      teamA: [{ userId: 'a', rating: 1500, gamesPlayed: 0 }],
      teamB: [{ userId: 'b', rating: 1500, gamesPlayed: 100 }],
      winner: 'A',
    });
    const sum = result.teamA[0].ratingDelta + result.teamB[0].ratingDelta;
    expect(sum).not.toBe(0);
  });

  it('rejects wrong team size for singles', () => {
    expect(() =>
      calculateMatch({
        type: 'singles',
        teamA: [
          { userId: 'a', rating: 1200, gamesPlayed: 0 },
          { userId: 'b', rating: 1200, gamesPlayed: 0 },
        ],
        teamB: [{ userId: 'c', rating: 1200, gamesPlayed: 0 }],
        winner: 'A',
      }),
    ).toThrow();
  });
});

describe('calculateMatch — doubles', () => {
  it('partners with same K share the same delta (equal split)', () => {
    const result = calculateMatch({
      type: 'doubles',
      teamA: [
        { userId: 'alice', rating: 1300, gamesPlayed: 50 },
        { userId: 'carol', rating: 1100, gamesPlayed: 50 },
      ],
      teamB: [
        { userId: 'bob', rating: 1250, gamesPlayed: 4 },
        { userId: 'dave', rating: 1400, gamesPlayed: 50 },
      ],
      winner: 'A',
    });

    expect(result.teamA[0].ratingDelta).toBe(result.teamA[1].ratingDelta);
    expect(result.teamA[0].ratingDelta).toBe(16);
    expect(result.teamB[0].kFactor).toBe(K_PROVISIONAL);
    expect(result.teamB[1].kFactor).toBe(K_ESTABLISHED);
    expect(result.teamB[0].ratingDelta).toBe(-27);
    expect(result.teamB[1].ratingDelta).toBe(-16);
  });

  it('rejects duplicate players across both teams', () => {
    expect(() =>
      calculateMatch({
        type: 'doubles',
        teamA: [
          { userId: 'a', rating: 1200, gamesPlayed: 0 },
          { userId: 'b', rating: 1200, gamesPlayed: 0 },
        ],
        teamB: [
          { userId: 'a', rating: 1200, gamesPlayed: 0 },
          { userId: 'c', rating: 1200, gamesPlayed: 0 },
        ],
        winner: 'A',
      }),
    ).toThrow();
  });

  it('rejects wrong team size for doubles', () => {
    expect(() =>
      calculateMatch({
        type: 'doubles',
        teamA: [{ userId: 'a', rating: 1200, gamesPlayed: 0 }],
        teamB: [
          { userId: 'b', rating: 1200, gamesPlayed: 0 },
          { userId: 'c', rating: 1200, gamesPlayed: 0 },
        ],
        winner: 'A',
      }),
    ).toThrow();
  });
});

describe('starting rating constant', () => {
  it('is 1200 as documented', () => {
    expect(STARTING_RATING).toBe(1200);
  });
});
