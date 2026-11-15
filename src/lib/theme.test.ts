import { describe, expect, it } from 'vitest';

import { resolveTheme } from './theme';

describe('resolveTheme', () => {
  it('uses an explicit choice whatever the system prefers', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('follows the system when the preference is "system"', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
});
