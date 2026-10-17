// Helpers for saving fetched job ads without failing a run on duplicates.
// Kept free of Deno and Supabase imports so they can be unit tested.

// Postgres "unique_violation".
export const UNIQUE_VIOLATION = '23505';

export interface DbError {
  code?: string;
  message: string;
}

// Keeps jobs the user hasn't saved yet: not matching a saved dedup hash or
// exact job URL, and not repeating an earlier job in this batch.
export const filterNewJobs = <T extends { job_url: string }>(
  jobs: T[],
  dedupHash: (job: T) => string,
  existingHashes: Iterable<string>,
  existingUrls: Iterable<string>,
): T[] => {
  const seenHashes = new Set(existingHashes);
  const seenUrls = new Set(existingUrls);

  return jobs.filter((job) => {
    const hash = dedupHash(job);
    if (seenHashes.has(hash) || (job.job_url && seenUrls.has(job.job_url))) return false;
    seenHashes.add(hash);
    if (job.job_url) seenUrls.add(job.job_url);
    return true;
  });
};

// Splits values into groups small enough for a PostgREST `in` filter in the URL.
export const chunk = <T>(values: T[], size: number): T[][] => {
  const groups: T[][] = [];
  for (let i = 0; i < values.length; i += size) groups.push(values.slice(i, i + size));
  return groups;
};

// Inserts all rows at once; if that hits a unique constraint (a job saved
// since the duplicate check, or by another user while job_url is unique
// across all users), inserts them one by one and skips only the duplicates.
// Any other error is thrown.
export const insertSkippingDuplicates = async <Row, Saved>(
  rows: Row[],
  insert: (rows: Row[]) => Promise<{ data: Saved[] | null; error: DbError | null }>,
): Promise<{ saved: Saved[]; skipped: number }> => {
  if (rows.length === 0) return { saved: [], skipped: 0 };

  const all = await insert(rows);
  if (!all.error) return { saved: all.data || [], skipped: 0 };
  if (all.error.code !== UNIQUE_VIOLATION) throw new Error(`Failed to insert job ads: ${all.error.message}`);

  const saved: Saved[] = [];
  let skipped = 0;

  for (const row of rows) {
    const one = await insert([row]);
    if (!one.error) {
      saved.push(...(one.data || []));
    } else if (one.error.code === UNIQUE_VIOLATION) {
      skipped++;
    } else {
      throw new Error(`Failed to insert job ads: ${one.error.message}`);
    }
  }

  return { saved, skipped };
};
