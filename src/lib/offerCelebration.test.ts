import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  areCelebrationsEnabled,
  celebrateOffer,
  claimOfferCelebration,
  isNewOffer,
  OFFER_CELEBRATION_EVENT,
  resetOfferCelebrationsForTests,
  setCelebrationsEnabled,
} from './offerCelebration';

const memoryStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
};

beforeEach(() => resetOfferCelebrationsForTests());
afterEach(() => vi.unstubAllGlobals());

describe('isNewOffer', () => {
  it('is true only for the first move to offer', () => {
    expect(isNewOffer('offer', { status: 'final_interview' })).toBe(true);
    expect(isNewOffer('offer', null)).toBe(true); // created as an offer
    expect(isNewOffer('offer', { status: 'offer' })).toBe(false);
    expect(isNewOffer('offer', { status: 'interview', offer_received_at: '2026-10-01T10:00:00Z' })).toBe(false);
    expect(isNewOffer('interview', { status: 'applied' })).toBe(false);
  });
});

describe('claimOfferCelebration', () => {
  it('celebrates each application once, remembered across page loads', () => {
    const storage = memoryStorage();
    expect(claimOfferCelebration('app-1', storage)).toBe(true);
    expect(claimOfferCelebration('app-1', storage)).toBe(false);

    resetOfferCelebrationsForTests(); // a new page load
    expect(claimOfferCelebration('app-1', storage)).toBe(false);
    expect(claimOfferCelebration('app-2', storage)).toBe(true);
  });

  it('still avoids repeats on the same page when storage is unavailable', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(claimOfferCelebration('app-1', broken)).toBe(true);
    expect(claimOfferCelebration('app-1', broken)).toBe(false);
  });
});

describe('celebrateOffer', () => {
  it('announces a new offer once, and not at all when turned off', () => {
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    const seen: unknown[] = [];
    target.addEventListener(OFFER_CELEBRATION_EVENT, (event) => seen.push((event as CustomEvent).detail));

    const storage = memoryStorage();
    const detail = { applicationId: 'app-1', roleTitle: 'Support Specialist', companyName: 'Acme' };

    expect(celebrateOffer(detail, storage)).toBe(true);
    expect(celebrateOffer(detail, storage)).toBe(false);
    expect(seen).toEqual([detail]);

    setCelebrationsEnabled(false, storage);
    expect(areCelebrationsEnabled(storage)).toBe(false);
    expect(celebrateOffer({ applicationId: 'app-2' }, storage)).toBe(false);
    expect(seen).toHaveLength(1);

    setCelebrationsEnabled(true, storage);
    expect(celebrateOffer({ applicationId: 'app-3' }, storage)).toBe(true);
  });
});
