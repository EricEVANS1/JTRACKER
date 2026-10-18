import { describe, expect, it } from 'vitest';

import { buildMatchAlert, isScheduleSecretValid, usersDueForSearch } from './schedule.ts';

describe('isScheduleSecretValid', () => {
  const secret = 'a-long-random-secret-0123456789';

  it('accepts only the exact secret, and refuses short or missing ones', () => {
    expect(isScheduleSecretValid(secret, secret)).toBe(true);
    expect(isScheduleSecretValid(`${secret}x`, secret)).toBe(false);
    expect(isScheduleSecretValid('wrong', secret)).toBe(false);
    expect(isScheduleSecretValid(null, secret)).toBe(false);
    expect(isScheduleSecretValid('short', 'short')).toBe(false); // secret too weak to trust
    expect(isScheduleSecretValid(secret, undefined)).toBe(false);
  });
});

describe('usersDueForSearch', () => {
  const now = Date.parse('2026-10-18T12:00:00Z');
  const minutesAgo = (m: number) => new Date(now - m * 60_000).toISOString();

  it('skips users searched in the last 50 minutes, longest-waiting first', () => {
    expect(
      usersDueForSearch(['recent', 'old', 'never', 'older', 'old'], { recent: minutesAgo(10), old: minutesAgo(120), older: minutesAgo(600) }, now),
    ).toEqual(['never', 'older', 'old']);
  });
});

describe('buildMatchAlert', () => {
  it('names the best matches in one notification', () => {
    expect(buildMatchAlert([])).toBeNull();
    expect(buildMatchAlert([{ title: 'Support Specialist', company: 'Acme', score: 82 }])).toEqual({
      type: 'job_match',
      title: 'New job match: Support Specialist at Acme',
      message: 'Support Specialist at Acme (82/100). Open Job Automation to review and apply early.',
    });

    const alert = buildMatchAlert([
      { title: 'A', company: 'X', score: 61 },
      { title: 'B', company: null, score: 90 },
      { title: 'C', company: 'Z', score: 75 },
      { title: 'D', company: 'W', score: 70 },
    ]);
    expect(alert?.title).toBe('4 new job matches');
    expect(alert?.message).toBe('B (90/100); C at Z (75/100); D at W (70/100) and 1 more. Open Job Automation to review and apply early.');
  });
});
