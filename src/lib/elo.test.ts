import { describe, expect, it } from 'vitest';
import {
  ELO_VERSION,
  K_ESTABLISHED,
  K_PROVISIONAL,
  MARGIN_DEADBAND,
  MARGIN_MAX_MULT,
  PROVISIONAL_GAMES,
  STARTING_RATING,
  calculateMatch,
  expectedScore,
  kFactor,
  marginMultiplier,
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

describe('marginMultiplier', () => {
  it('is 1.0 inside the deadband (close games)', () => {
    expect(marginMultiplier(1)).toBe(1);
    expect(marginMultiplier(MARGIN_DEADBAND)).toBe(1);
  });

  it('starts boosting beyond the deadband', () => {
    expect(marginMultiplier(MARGIN_DEADBAND + 1)).toBeCloseTo(1 + 1 / 21, 6);
    expect(marginMultiplier(11)).toBeCloseTo(1 + 9 / 21, 6);
  });

  it('caps at MARGIN_MAX_MULT', () => {
    expect(marginMultiplier(1000)).toBe(MARGIN_MAX_MULT);
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
  it('Alice 1300/15g vs Bob 1250/4g, Alice wins 21-19 (no margin boost)', () => {
    // 21-19: diff=2, deadband => multiplier=1.0 → behaves like classic ELO.
    const result = calculateMatch({
      type: 'singles',
      teamA: [{ userId: 'alice', rating: 1300, gamesPlayed: 15 }],
      teamB: [{ userId: 'bob', rating: 1250, gamesPlayed: 4 }],
      scoreA: 21,
      scoreB: 19,
    });

    expect(result.marginMultiplier).toBe(1);
    expect(result.teamA[0].kFactor).toBe(K_ESTABLISHED);
    expect(result.teamB[0].kFactor).toBe(K_PROVISIONAL);
    expect(result.teamA[0].ratingDelta).toBe(10);
    expect(result.teamB[0].ratingDelta).toBe(-17);
    expect(result.teamA[0].ratingAfter).toBe(1310);
    expect(result.teamB[0].ratingAfter).toBe(1233);
  });

  it('a thrashing scales the winner up but leaves the loser unchanged', () => {
    // Same matchup as above, but 21-2.
    const closeResult = calculateMatch({
      type: 'singles',
      teamA: [{ userId: 'alice', rating: 1300, gamesPlayed: 15 }],
      teamB: [{ userId: 'bob', rating: 1250, gamesPlayed: 4 }],
      scoreA: 21,
      scoreB: 19,
    });
    const thrashResult = calculateMatch({
      type: 'singles',
      teamA: [{ userId: 'alice', rating: 1300, gamesPlayed: 15 }],
      teamB: [{ userId: 'bob', rating: 1250, gamesPlayed: 4 }],
      scoreA: 21,
      scoreB: 2,
    });

    // Winner gain grows
    expect(thrashResult.teamA[0].ratingDelta).toBeGreaterThan(closeResult.teamA[0].ratingDelta);
    // Loser loss is unchanged
    expect(thrashResult.teamB[0].ratingDelta).toBe(closeResult.teamB[0].ratingDelta);
  });

  it('exposes the margin multiplier on the result', () => {
    const result = calculateMatch({
      type: 'singles',
      teamA: [{ userId: 'a', rating: 1500, gamesPlayed: 50 }],
      teamB: [{ userId: 'b', rating: 1500, gamesPlayed: 50 }],
      scoreA: 21,
      scoreB: 12,
    });
    // diff 9 → 1 + 7/21 = 1.333…
    expect(result.marginMultiplier).toBeCloseTo(1 + 7 / 21, 6);
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
        scoreA: 21,
        scoreB: 19,
      }),
    ).toThrow();
  });

  it('rejects tied scores', () => {
    expect(() =>
      calculateMatch({
        type: 'singles',
        teamA: [{ userId: 'a', rating: 1200, gamesPlayed: 0 }],
        teamB: [{ userId: 'b', rating: 1200, gamesPlayed: 0 }],
        scoreA: 21,
        scoreB: 21,
      }),
    ).toThrow();
  });
});

describe('calculateMatch — doubles', () => {
  it('partners with same K share the same delta on the winning side', () => {
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
      scoreA: 21,
      scoreB: 19,
    });

    expect(result.marginMultiplier).toBe(1);
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
        scoreA: 21,
        scoreB: 19,
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
        scoreA: 21,
        scoreB: 19,
      }),
    ).toThrow();
  });
});

describe('starting rating constant', () => {
  it('is 1200 as documented', () => {
    expect(STARTING_RATING).toBe(1200);
  });
});

describe('ELO_VERSION', () => {
  it('is bumped to 2 when winner-only margin-of-victory boost was added', () => {
    expect(ELO_VERSION).toBe(2);
  });
});
