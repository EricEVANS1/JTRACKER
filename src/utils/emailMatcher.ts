export interface MatchableApplication {
  id: string;
  role_title: string;
  status: string;
  companies?: {
    name: string;
  } | null;
}

export type MatchStrength = 'NONE' | 'WEAK' | 'MEDIUM' | 'STRONG';

export interface EmailApplicationMatch {
  applicationId: string;
  companyName: string;
  roleTitle: string;
  score: number;
  strength: MatchStrength;
  reason: string;
  shouldAutoLink: boolean;
  shouldReview: boolean;
}

const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'of',
  'for',
  'to',
  'in',
  'at',
  'with',
  'role',
  'position',
  'job',
  'application',
]);

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const tokenize = (value: string) =>
  normalize(value)
    .split(' ')
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));

const unique = <T,>(items: T[]) => Array.from(new Set(items));

const tokenOverlapScore = (a: string, b: string) => {
  const first = unique(tokenize(a));
  const second = unique(tokenize(b));

  if (first.length === 0 || second.length === 0) return 0;

  const overlap = first.filter((token) => second.includes(token)).length;
  const smallest = Math.min(first.length, second.length);

  return Math.round((overlap / smallest) * 100);
};

const exactOrContainsScore = (a: string, b: string) => {
  const first = normalize(a);
  const second = normalize(b);

  if (!first || !second) return 0;
  if (first === second) return 100;
  if (first.includes(second) || second.includes(first)) return 85;

  return 0;
};

const similarityScore = (a: string, b: string) => {
  return Math.max(exactOrContainsScore(a, b), tokenOverlapScore(a, b));
};

const getStrength = (score: number): MatchStrength => {
  if (score >= 85) return 'STRONG';
  if (score >= 65) return 'MEDIUM';
  if (score >= 45) return 'WEAK';
  return 'NONE';
};

const isUnknown = (value: string) => {
  const normalized = normalize(value);

  return (
    !normalized ||
    normalized === 'unknown' ||
    normalized === 'unknown role' ||
    normalized === 'unknown company'
  );
};

export const findBestApplicationMatch = (
  extractedCompany: string,
  extractedRole: string,
  applications: MatchableApplication[]
): EmailApplicationMatch | null => {
  if (isUnknown(extractedCompany) && isUnknown(extractedRole)) {
    return null;
  }

  let bestMatch: EmailApplicationMatch | null = null;

  for (const app of applications) {
    const appCompany = app.companies?.name || '';
    const appRole = app.role_title || '';

    const companyScore = isUnknown(extractedCompany)
      ? 0
      : similarityScore(appCompany, extractedCompany);

    const roleScore = isUnknown(extractedRole)
      ? 0
      : similarityScore(appRole, extractedRole);

    let score = 0;
    const reasons: string[] = [];

    if (companyScore >= 85) {
      score += 45;
      reasons.push(`strong company match (${companyScore}%)`);
    } else if (companyScore >= 65) {
      score += 32;
      reasons.push(`medium company match (${companyScore}%)`);
    } else if (companyScore >= 45) {
      score += 18;
      reasons.push(`weak company match (${companyScore}%)`);
    }

    if (roleScore >= 85) {
      score += 50;
      reasons.push(`strong role match (${roleScore}%)`);
    } else if (roleScore >= 65) {
      score += 35;
      reasons.push(`medium role match (${roleScore}%)`);
    } else if (roleScore >= 45) {
      score += 18;
      reasons.push(`weak role match (${roleScore}%)`);
    }

    if (companyScore >= 85 && roleScore >= 85) {
      score += 5;
      reasons.push('company and role both strongly matched');
    }

    if (companyScore === 0 && roleScore >= 85) {
      score -= 10;
      reasons.push('role matched but company missing');
    }

    if (companyScore >= 85 && roleScore === 0) {
      score -= 20;
      reasons.push('company matched but role missing');
    }

    score = Math.max(0, Math.min(100, score));

    const strength = getStrength(score);

    if (strength === 'NONE') continue;

    const candidate: EmailApplicationMatch = {
      applicationId: app.id,
      companyName: appCompany,
      roleTitle: appRole,
      score,
      strength,
      reason: reasons.join(', '),
      shouldAutoLink: score >= 85,
      shouldReview: score >= 65 && score < 85,
    };

    if (!bestMatch || candidate.score > bestMatch.score) {
      bestMatch = candidate;
    }
  }

  if (!bestMatch) return null;

  return bestMatch.score >= 65 ? bestMatch : null;
};