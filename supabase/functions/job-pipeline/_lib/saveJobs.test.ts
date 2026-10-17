import { describe, expect, it, vi } from 'vitest';

import { chunk, filterNewJobs, insertSkippingDuplicates, UNIQUE_VIOLATION } from './saveJobs.ts';

const job = (source: string, id: string, url: string) => ({ source, external_id: id, job_url: url });
const hash = (j: { source: string; external_id: string }) => `${j.source}:${j.external_id}`;

describe('filterNewJobs', () => {
  it('skips jobs already saved by hash or by exact URL, and repeats within the batch', () => {
    const jobs = [
      job('linkedin', '1', 'https://a.example/1'), // saved before (hash)
      job('indeed', '9', 'https://a.example/2'), // saved before under another source (URL)
      job('linkedin', '3', 'https://a.example/3'), // new
      job('google_jobs', '7', 'https://a.example/3'), // same posting again in this batch
      job('linkedin', '3', 'https://a.example/3?ref=x'), // same hash again in this batch
      job('linkedin', '4', 'https://a.example/4'), // new
    ];

    const kept = filterNewJobs(jobs, hash, ['linkedin:1'], ['https://a.example/2']);

    expect(kept.map((j) => j.job_url)).toEqual(['https://a.example/3', 'https://a.example/4']);
  });
});

describe('chunk', () => {
  it('splits into groups of the given size', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });
});

describe('insertSkippingDuplicates', () => {
  const duplicate = { code: UNIQUE_VIOLATION, message: 'duplicate key value violates unique constraint "job_ads_job_url_key"' };

  it('saves everything in one insert when there is no conflict', async () => {
    const insert = vi.fn(async (rows: string[]) => ({ data: rows.map((r) => ({ id: r })), error: null }));

    expect(await insertSkippingDuplicates(['a', 'b'], insert)).toEqual({ saved: [{ id: 'a' }, { id: 'b' }], skipped: 0 });
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('on a duplicate, saves the others one by one and skips only the duplicate', async () => {
    const taken = new Set(['b']);
    const insert = vi.fn(async (rows: string[]) =>
      rows.some((r) => taken.has(r)) ? { data: null, error: duplicate } : { data: rows.map((r) => ({ id: r })), error: null },
    );

    expect(await insertSkippingDuplicates(['a', 'b', 'c'], insert)).toEqual({ saved: [{ id: 'a' }, { id: 'c' }], skipped: 1 });
  });

  it('still fails on other database errors', async () => {
    const insert = vi.fn(async () => ({ data: null, error: { code: '42501', message: 'permission denied' } }));

    await expect(insertSkippingDuplicates(['a'], insert)).rejects.toThrow('Failed to insert job ads: permission denied');
  });

  it('does nothing for an empty batch', async () => {
    const insert = vi.fn();
    expect(await insertSkippingDuplicates([], insert)).toEqual({ saved: [], skipped: 0 });
    expect(insert).not.toHaveBeenCalled();
  });
});
