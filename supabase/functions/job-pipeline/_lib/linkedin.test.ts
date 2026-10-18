import { describe, expect, it } from 'vitest';

import { canonicalLinkedInJobUrl, findLinkedInJobLink, linkedInJobId, linkedInSearchQuery, linkedInSearchUrl } from './linkedin.ts';

// Shaped like SerpAPI google_jobs results.
const viaLinkedIn = {
  title: 'Data Analyst',
  company_name: 'Acme',
  via: 'LinkedIn',
  share_link: 'https://www.google.com/search?ibp=htl;jobs&q=data+analyst#htivrt=jobs&htidocid=abc',
  apply_options: [
    { title: 'Acme Careers', link: 'https://careers.acme.example/jobs/123' },
    { title: 'LinkedIn', link: 'https://pl.linkedin.com/jobs/view/data-analyst-at-acme-3812345678?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply' },
  ],
};

describe('findLinkedInJobLink', () => {
  it('picks the LinkedIn posting from the apply options', () => {
    expect(findLinkedInJobLink(viaLinkedIn)).toContain('linkedin.com/jobs/view/data-analyst-at-acme-3812345678');
  });

  it('ignores results without a LinkedIn posting, and LinkedIn pages that are not postings', () => {
    expect(findLinkedInJobLink({ apply_options: [{ link: 'https://www.indeed.com/viewjob?jk=1' }] })).toBeNull();
    expect(findLinkedInJobLink({ apply_options: [{ link: 'https://www.linkedin.com/jobs/search?keywords=analyst' }] })).toBeNull();
    expect(findLinkedInJobLink({ apply_options: [{ link: 'https://www.linkedin.com.evil.example/jobs/view/1234567' }] })).toBeNull();
    expect(findLinkedInJobLink({})).toBeNull();
  });
});

describe('linkedInJobId and canonicalLinkedInJobUrl', () => {
  it('reduces every form of a posting link to one URL', () => {
    const forms = [
      'https://pl.linkedin.com/jobs/view/data-analyst-at-acme-3812345678?utm_source=google_jobs_apply',
      'https://www.linkedin.com/jobs/view/3812345678/',
      'https://linkedin.com/jobs/view/3812345678?refId=abc&trackingId=xyz',
    ];

    expect(forms.map(linkedInJobId)).toEqual(['3812345678', '3812345678', '3812345678']);
    expect(new Set(forms.map(canonicalLinkedInJobUrl))).toEqual(new Set(['https://www.linkedin.com/jobs/view/3812345678/']));
  });

  it('keeps the path when there is no numeric id', () => {
    expect(linkedInJobId('https://www.linkedin.com/jobs/view/some-role')).toBeNull();
    expect(canonicalLinkedInJobUrl('https://uk.linkedin.com/jobs/view/some-role?trk=x')).toBe('https://www.linkedin.com/jobs/view/some-role');
  });
});

describe('linkedInSearchQuery', () => {
  it('puts the location, and a remote or hybrid preference, in the query', () => {
    expect(linkedInSearchQuery('Data Analyst', 'London')).toBe('Data Analyst London');
    expect(linkedInSearchQuery('Data Analyst', ' Remote ')).toBe('Data Analyst remote');
    expect(linkedInSearchQuery('Data Analyst', 'Warsaw', 'onsite')).toBe('Data Analyst Warsaw');
    expect(linkedInSearchQuery('Data Analyst', 'Warsaw', 'hybrid')).toBe('Data Analyst Warsaw hybrid');
    expect(linkedInSearchQuery('Data Analyst', 'Remote', 'remote')).toBe('Data Analyst remote');
  });
});

describe('linkedInSearchUrl', () => {
  const params = (url: string) => Object.fromEntries(new URL(url).searchParams);

  it('applies Date posted, work model and experience level, newest first', () => {
    const url = linkedInSearchUrl({
      title: 'Support Specialist',
      location: 'Warsaw',
      maxAgeDays: 1,
      workModel: 'onsite',
      experienceLevels: ['entry', 'associate'],
    });

    expect(url.startsWith('https://www.linkedin.com/jobs/search/?')).toBe(true);
    expect(params(url)).toEqual({
      keywords: 'Support Specialist',
      location: 'Warsaw',
      f_TPR: 'r86400',
      f_WT: '1',
      f_E: '2,3',
      sortBy: 'DD',
    });
  });

  it('maps each Date posted option and leaves out "Any time" and "Any"', () => {
    expect(params(linkedInSearchUrl({ title: 'A', location: 'B', maxAgeDays: 7 })).f_TPR).toBe('r604800');
    expect(params(linkedInSearchUrl({ title: 'A', location: 'B', maxAgeDays: 30 })).f_TPR).toBe('r2592000');
    expect(params(linkedInSearchUrl({ title: 'A', location: 'B', maxAgeDays: 0, workModel: 'any' }))).toEqual({
      keywords: 'A',
      location: 'B',
      sortBy: 'DD',
    });
  });

  it('turns a "Remote" location into the Remote filter', () => {
    expect(params(linkedInSearchUrl({ title: 'A', location: 'Remote', workModel: 'onsite' }))).toEqual({
      keywords: 'A',
      f_WT: '2',
      sortBy: 'DD',
    });
  });
});
