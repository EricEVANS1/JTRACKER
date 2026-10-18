// A short celebration when the user records a new job offer.
//
// Pages call celebrateOffer() right after a save that moved an application to
// "offer" succeeded; <OfferCelebration /> in the app layout shows it. Nothing
// here reads or changes application data, so loading a page never celebrates,
// and each application is celebrated at most once on this device.

export const OFFER_CELEBRATION_EVENT = 'jtracker:offer-received';

const CELEBRATED_KEY = 'jtracker.celebratedOffers';
const PREFERENCE_KEY = 'jtracker.celebrations';
// Enough to never repeat in practice without growing forever.
const MAX_REMEMBERED = 200;

export interface OfferCelebrationDetail {
  applicationId: string;
  roleTitle?: string | null;
  companyName?: string | null;
}

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

// localStorage can be missing or blocked (private mode, tests); then nothing is remembered.
const defaultStorage = (): KeyValueStorage | null => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
};

// True when this save turns an application into an offer for the first time:
// it wasn't an offer before and had never reached the offer stage.
export const isNewOffer = (
  newStatus: string,
  previous: { status?: string | null; offer_received_at?: string | null } | null | undefined,
) => newStatus === 'offer' && previous?.status !== 'offer' && !previous?.offer_received_at;

export const areCelebrationsEnabled = (storage: KeyValueStorage | null = defaultStorage()) => {
  try {
    return storage?.getItem(PREFERENCE_KEY) !== 'off';
  } catch {
    return true;
  }
};

export const setCelebrationsEnabled = (enabled: boolean, storage: KeyValueStorage | null = defaultStorage()) => {
  try {
    storage?.setItem(PREFERENCE_KEY, enabled ? 'on' : 'off');
  } catch {
    // Not saved; the setting lasts for this page only.
  }
};

const readCelebrated = (storage: KeyValueStorage | null): string[] => {
  try {
    const parsed = JSON.parse(storage?.getItem(CELEBRATED_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
};

// Records the offer and says whether it should be celebrated (false when it
// already was). Also guards within the page when storage isn't available.
const celebratedThisPage = new Set<string>();

export const claimOfferCelebration = (applicationId: string, storage: KeyValueStorage | null = defaultStorage()) => {
  if (!applicationId || celebratedThisPage.has(applicationId)) return false;

  const celebrated = readCelebrated(storage);
  if (celebrated.includes(applicationId)) return false;

  celebratedThisPage.add(applicationId);
  try {
    storage?.setItem(CELEBRATED_KEY, JSON.stringify([...celebrated, applicationId].slice(-MAX_REMEMBERED)));
  } catch {
    // The page-level guard still prevents a repeat until reload.
  }
  return true;
};

// Shows the celebration if it's turned on and this offer hasn't had one.
export const celebrateOffer = (detail: OfferCelebrationDetail, storage: KeyValueStorage | null = defaultStorage()) => {
  if (!areCelebrationsEnabled(storage) || !claimOfferCelebration(detail.applicationId, storage)) return false;
  if (typeof window === 'undefined') return false;

  window.dispatchEvent(new CustomEvent<OfferCelebrationDetail>(OFFER_CELEBRATION_EVENT, { detail }));
  return true;
};

export const resetOfferCelebrationsForTests = () => celebratedThisPage.clear();
