import { describe, expect, it } from 'vitest';
import { pickRating } from './lichess';
import { profileRating, type Profile } from './store';

describe('the Lichess rating used as your own', () => {
  it('rapid when there are rapid games', () => {
    expect(pickRating({ blitz: { games: 900, rating: 1500 }, rapid: { games: 12, rating: 1712.4, prov: true } })).toEqual({
      rating: 1712,
      speed: 'rapid',
      games: 12,
      provisional: true,
    });
  });

  it('without rapid games: the time control played most', () => {
    expect(pickRating({ rapid: { games: 0, rating: 1500 }, blitz: { games: 40, rating: 1400 }, classical: { games: 90, rating: 1600 } })?.speed).toBe('classical');
    expect(pickRating({ puzzle: { games: 500, rating: 2000 } })).toBeNull();
  });

  const base: Profile = { id: 'p', name: 'F', color: '#000', ratings: [1400, 1600], speeds: [], rating: 1500 };
  const lr = { user: 'Fred', rating: 1712, speed: 'rapid', games: 30, provisional: false, at: 0 };

  it('the profile uses it, unless typed in by hand or fetched for another username', () => {
    expect(profileRating({ ...base, lichess: 'fred', lichessRating: lr })).toBe(1712);
    expect(profileRating({ ...base, lichess: 'fred', lichessRating: lr, ratingManual: true })).toBe(1500);
    expect(profileRating({ ...base, lichess: 'someone', lichessRating: lr })).toBe(1500);
    expect(profileRating({ ...base, lichessRating: lr })).toBe(1500);
  });
});
