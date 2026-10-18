import { describe, expect, it } from 'vitest';

import {
  applyJobFilters,
  classifyWorkModel,
  datePostedFromMaxAge,
  estimateExperienceLevel,
  isClosedPosting,
  isPostedWithin,
  matchesWorkModel,
  maxAgeFromDatePosted,
} from './jobFilters.ts';

const NOW = Date.parse('2026-10-18T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString();

describe('date posted', () => {
  it('maps LinkedIn presets to stored days and back, including old values', () => {
    expect(['past_24_hours', 'past_week', 'past_month', 'any_time'].map((v) => maxAgeFromDatePosted(v as never))).toEqual([1, 7, 30, 0]);
    expect([1, 3, 7, 14, 30, 0, null, 90].map(datePostedFromMaxAge)).toEqual([
      'past_24_hours', 'past_week', 'past_week', 'past_month', 'past_month', 'any_time', 'past_week', 'any_time',
    ]);
  });

  it('keeps only dated jobs inside the window', () => {
    expect(isPostedWithin(hoursAgo(5), 1, NOW)).toBe(true);
    expect(isPostedWithin(hoursAgo(24.5), 1, NOW)).toBe(true); // "1 day ago", checked a little later
    expect(isPostedWithin(hoursAgo(48), 1, NOW)).toBe(false);
    expect(isPostedWithin(hoursAgo(24 * 200), 30, NOW)).toBe(false); // six months old
    expect(isPostedWithin(hoursAgo(24 * 200), 0, NOW)).toBe(true); // any time
    expect(isPostedWithin(null, 30, NOW)).toBe(false); // undated: hidden
    expect(isPostedWithin('not a date', 0, NOW)).toBe(false);
  });
});

describe('closed postings', () => {
  it('spots postings that are no longer open', () => {
    expect(isClosedPosting('Support Specialist. No longer accepting applications.')).toBe(true);
    expect(isClosedPosting('Ta oferta wygasła')).toBe(true);
    expect(isClosedPosting('We are accepting applications until Friday')).toBe(false);
  });
});

describe('work model', () => {
  it('classifies hybrid before remote, and needs a clear remote signal', () => {
    expect(classifyWorkModel({ title: 'Support Specialist', description: 'Hybrid: 2 days remote, 3 in the office' })).toBe('hybrid');
    expect(classifyWorkModel({ title: 'Support Specialist (Remote)' })).toBe('remote');
    expect(classifyWorkModel({ title: 'Support Specialist', location: 'Warsaw' }, true)).toBe('remote');
    expect(classifyWorkModel({ title: 'Specjalista', description: 'Praca zdalna, pełny etat' })).toBe('remote');
    expect(classifyWorkModel({ title: 'Support Specialist', description: 'Sorry, no remote work for this role' })).toBe(null);
    expect(classifyWorkModel({ title: 'Support Specialist', description: 'Praca stacjonarna w Warszawie' })).toBe('onsite');
  });

  it('treats unstated as on-site, like LinkedIn', () => {
    expect(matchesWorkModel('onsite', null)).toBe(true);
    expect(matchesWorkModel('onsite', 'remote')).toBe(false);
    expect(matchesWorkModel('remote', null)).toBe(false);
    expect(matchesWorkModel('any', 'hybrid')).toBe(true);
  });
});

describe('experience level', () => {
  it('reads the title first, including Polish terms', () => {
    expect(estimateExperienceLevel({ title: 'IT Support Intern' })).toBe('internship');
    expect(estimateExperienceLevel({ title: 'Stażysta w dziale IT' })).toBe('internship');
    expect(estimateExperienceLevel({ title: 'Junior Support Specialist' })).toBe('entry');
    expect(estimateExperienceLevel({ title: 'Młodszy specjalista ds. wsparcia' })).toBe('entry');
    expect(estimateExperienceLevel({ title: 'Senior Support Engineer' })).toBe('mid_senior');
    expect(estimateExperienceLevel({ title: 'IT Support Team Leader' })).toBe('mid_senior');
    expect(estimateExperienceLevel({ title: 'Head of IT Support' })).toBe('director');
    expect(estimateExperienceLevel({ title: 'VP of Customer Support' })).toBe('executive');
  });

  it('does not match words inside other words', () => {
    expect(estimateExperienceLevel({ title: 'Customer Support Specialist', description: 'Help our leading clients' })).toBe('associate');
    expect(estimateExperienceLevel({ title: 'Internal Systems Analyst' })).toBe('associate');
  });

  it('falls back to the description, then Associate', () => {
    expect(estimateExperienceLevel({ title: 'Support Specialist', description: 'Entry level role, training provided.' })).toBe('entry');
    expect(estimateExperienceLevel({ title: 'Support Specialist', description: 'You have 5+ years of experience.' })).toBe('mid_senior');
    expect(estimateExperienceLevel({ title: 'Support Specialist', description: '2-3 years in a helpdesk.' })).toBe('associate');
    expect(estimateExperienceLevel({ title: 'Support Specialist' })).toBe('associate');
  });
});

describe('applyJobFilters', () => {
  it('keeps matching jobs and counts why the others were removed', () => {
    const jobs = [
      { title: 'Junior Support Specialist', location: 'Warsaw', source_posted_at: hoursAgo(6) }, // kept
      { title: 'Support Specialist', location: 'Warsaw', source_posted_at: null }, // undated
      { title: 'Support Specialist', location: 'Warsaw', source_posted_at: hoursAgo(24 * 180) }, // six months
      { title: 'Support Specialist', description: 'No longer accepting applications', source_posted_at: hoursAgo(3) }, // closed
      { title: 'Support Specialist (Remote)', source_posted_at: hoursAgo(3) }, // remote
      { title: 'Senior Support Specialist', location: 'Warsaw', source_posted_at: hoursAgo(3) }, // level
      { title: 'Support Specialist', location: 'Warsaw', source_posted_at: hoursAgo(10) }, // associate, kept
    ];

    const { kept, removed } = applyJobFilters(
      jobs,
      { max_job_age_days: 1, work_model: 'onsite', experience_levels: ['entry', 'associate'] },
      { now: NOW },
    );

    expect(kept.map((j) => j.title)).toEqual(['Junior Support Specialist', 'Support Specialist']);
    expect(removed).toEqual({ date: 2, closed: 1, work_model: 1, experience_level: 1 });
  });

  it('with no level chosen and any work model, only date and closed filters apply', () => {
    const { kept } = applyJobFilters(
      [{ title: 'Senior Support (Remote)', source_posted_at: hoursAgo(3) }],
      { max_job_age_days: 7, work_model: 'any', experience_levels: [] },
      { now: NOW },
    );
    expect(kept).toHaveLength(1);
  });
});
