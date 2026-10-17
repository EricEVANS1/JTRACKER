import { describe, expect, it } from 'vitest';

import { getSignatureName, signOff } from './emailSignature';

describe('getSignatureName', () => {
  it('prefers the profile name, then the sign-in account name', () => {
    expect(getSignatureName('  Alice   Example ', { full_name: 'Account Name' })).toBe('Alice Example');
    expect(getSignatureName('', { full_name: 'Account Name', name: 'Other' })).toBe('Account Name');
    expect(getSignatureName(null, { name: 'Google Name' })).toBe('Google Name');
  });

  it('returns nothing rather than guessing', () => {
    expect(getSignatureName(null, null)).toBe('');
    expect(getSignatureName('   ', { full_name: 42 })).toBe('');
  });
});

describe('signOff', () => {
  it('signs with the name, or leaves the sign-off for the user to finish', () => {
    expect(signOff('Alice Example')).toBe('Best regards,\nAlice Example');
    expect(signOff('')).toBe('Best regards,');
  });
});
