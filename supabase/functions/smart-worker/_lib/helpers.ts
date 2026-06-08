// ============================================================
// _lib/helpers.ts
// Pure utility functions — no side effects
// ============================================================

export function makeRoleKey(company: string, title: string): string {
  return `${company}__${title}`
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function hashString(str: string): string {
  let hash = 0;

  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }

  return Math.abs(hash).toString(36);
}

export function getScoreBand(score: number): string {
  if (score >= 90) return '90-100';
  if (score >= 80) return '80-89';
  if (score >= 70) return '70-79';
  if (score >= 60) return '60-69';
  if (score >= 50) return '50-59';
  return '0-49';
}

export function deduplicateKeywords(keywords: string[]): string[] {
  const seen = new Map<string, string>();

  for (const keyword of keywords) {
    const trimmed = keyword.trim();
    if (!trimmed) continue;

    const key = trimmed.toLowerCase();

    if (!seen.has(key)) {
      seen.set(key, trimmed);
    }
  }

  return Array.from(seen.values());
}

export function deduplicateStringsCaseInsensitive(values: string[]): string[] {
  const seen = new Map<string, string>();

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;

    const key = trimmed.toLowerCase();

    if (!seen.has(key)) {
      seen.set(key, trimmed);
    }
  }

  return Array.from(seen.values());
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));