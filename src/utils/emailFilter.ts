// ============================================================
// emailFilter.ts
// Top-tier Email Filtering Layer — Gmail Sync Pipeline
// Goal: only recruitment/job-search emails should pass.
// ============================================================

export const TRUSTED_DOMAINS: ReadonlySet<string> = new Set([
  'greenhouse.io',
  'lever.co',
  'workday.com',
  'myworkdayjobs.com',
  'ashbyhq.com',
  'smartrecruiters.com',
  'icims.com',
  'jobvite.com',
  'successfactors.com',
  'recruitee.com',
  'teamtailor.com',
  'bamboohr.com',
  'linkedin.com',
  'indeed.com',
  'wellfound.com',
  'cord.co',
  'comeet.co',
  'rippling.com',
  'workable.com',
  'pinpoint.com',
  'breezy.hr',
  'jazz.co',
  'freshteam.com',
  'zohorecruit.com',
  'dover.com',
  'gem.com',
  'beamery.com',
  'hired.com',
  'ziprecruiter.com',
  'glassdoor.com',
]);

const HARD_BLOCK_DOMAINS: ReadonlySet<string> = new Set([
  'youtube.com',
  'google.youtube.com',
  'freecodecamp.org',
  'medium.com',
  'substack.com',
  'coursera.org',
  'udemy.com',
  'edx.org',
  'codecademy.com',
  'duolingo.com',
  'spotify.com',
  'netflix.com',
  'amazon.com',
  'paypal.com',
]);

const HARD_BLOCK_KEYWORDS: ReadonlyArray<string> = [
  'youtube premium',
  'premium subscription',
  'subscription renewed',
  'subscription confirmation',
  'newsletter',
  'weekly newsletter',
  'daily digest',
  'course',
  'free course',
  'tutorial',
  'webinar',
  'bootcamp',
  'learn javascript',
  'learn python',
  'event loop',
  'new video',
  'watch now',
  'unsubscribe',
  'promotion',
  'promo code',
  'discount',
  'sale',
  'limited time offer',
  'special offer',
  'coupon',
  'free shipping',
  'order confirmation',
  'receipt',
  'invoice',
  'billing',
  'payment received',
  'your cart',
  'abandoned cart',
  'bank statement',
  'utility bill',
];

const STRONG_RECRUITMENT_SIGNALS: ReadonlyArray<string> = [
  'thank you for applying',
  'thanks for applying',
  'application received',
  'we received your application',
  'your application has been received',
  'your application was submitted',
  'application submitted',
  'your application is under review',
  'we reviewed your application',
  'not moving forward',
  'will not be moving forward',
  'we regret to inform',
  'unfortunately',
  'not selected',
  'other candidates',
  'interview invitation',
  'schedule an interview',
  'schedule a call',
  'phone screen',
  'technical interview',
  'final interview',
  'coding challenge',
  'technical assessment',
  'online assessment',
  'take-home assignment',
  'hiring manager',
  'talent acquisition',
  'recruitment team',
  'recruiter',
  'job offer',
  'offer letter',
  'pleased to offer',
];

const WEAK_RECRUITMENT_SIGNALS: ReadonlyArray<string> = [
  'position',
  'role',
  'candidate',
  'job',
  'career',
  'opportunity',
  'hiring',
  'application',
  'cv',
  'resume',
];

export type FilterDecision = 'ACCEPTED' | 'REJECTED' | 'REVIEW';

export type FilterReasonCode =
  | 'TRUSTED_DOMAIN_STRONG_RECRUITMENT'
  | 'STRONG_RECRUITMENT_SIGNAL'
  | 'BORDERLINE_RECRUITMENT'
  | 'HARD_BLOCK_DOMAIN'
  | 'HARD_BLOCK_KEYWORDS'
  | 'MALFORMED_SENDER'
  | 'EMPTY_CONTENT'
  | 'NO_RECRUITMENT_SIGNAL'
  | 'WEAK_SIGNAL_ONLY'
  | 'MIXED_SIGNALS';

export interface RawEmail {
  messageId: string;
  sender: string;
  subject: string;
  snippet: string;
  receivedAt: number;
  confidence: number;
  gmailLabels?: string[];
}

export interface FilteredEmail {
  messageId: string;
  sender: string;
  subject: string;
  snippet: string;
  receivedAt: number;
  confidence: number;
  gmailLabels?: string[];

  decision: FilterDecision;
  reason: string;
  reasonCode: FilterReasonCode;

  trustedDomain: boolean;
  senderDomain: string;

  hardBlockSignalsFound: string[];
  strongRecruitmentSignalsFound: string[];
  weakRecruitmentSignalsFound: string[];

  jobRelevanceScore: number;
  passedFilter: boolean;
}

export interface FilterBatchResult {
  accepted: FilteredEmail[];
  rejected: FilteredEmail[];
  review: FilteredEmail[];
  totalProcessed: number;
  processingTimeMs: number;
}

const normalize = (value: string): string =>
  value
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const findMatches = (content: string, keywords: ReadonlyArray<string>): string[] =>
  keywords.filter((keyword) => content.includes(keyword));

export const extractSenderDomain = (sender: string): string | null => {
  if (!sender || typeof sender !== 'string') return null;

  const trimmed = sender.trim();
  if (!trimmed) return null;

  const angleMatch = trimmed.match(/<([^<>]+)>/);
  const emailStr = angleMatch ? angleMatch[1] : trimmed;

  const atIndex = emailStr.lastIndexOf('@');
  if (atIndex === -1 || atIndex === emailStr.length - 1) return null;

  const domain = emailStr.slice(atIndex + 1).toLowerCase().trim();
  if (!domain || domain.includes(' ') || !domain.includes('.')) return null;

  return domain;
};

export const isDomainTrusted = (domain: string): boolean => {
  const d = domain.toLowerCase();

  for (const trusted of TRUSTED_DOMAINS) {
    if (d === trusted || d.endsWith(`.${trusted}`)) return true;
  }

  return false;
};

const isHardBlockedDomain = (domain: string): boolean => {
  const d = domain.toLowerCase();

  for (const blocked of HARD_BLOCK_DOMAINS) {
    if (d === blocked || d.endsWith(`.${blocked}`)) return true;
  }

  return false;
};

const calculateJobRelevanceScore = ({
  trusted,
  strongSignals,
  weakSignals,
  hardBlocks,
  upstreamConfidence,
}: {
  trusted: boolean;
  strongSignals: string[];
  weakSignals: string[];
  hardBlocks: string[];
  upstreamConfidence: number;
}) => {
  let score = 0;

  score += Math.min(strongSignals.length * 25, 75);
  score += Math.min(weakSignals.length * 5, 15);

  if (trusted && strongSignals.length > 0) score += 20;
  if (trusted && strongSignals.length === 0) score += 5;

  score += Math.min(Math.round(upstreamConfidence * 0.1), 10);

  if (hardBlocks.length > 0) score -= 60;

  return Math.max(0, Math.min(100, score));
};

export const filterEmail = (email: RawEmail): FilteredEmail => {
  const { messageId, sender, subject, snippet, receivedAt, confidence, gmailLabels } = email;

  const base = {
    messageId,
    sender,
    subject,
    snippet,
    receivedAt,
    confidence,
    gmailLabels,
    trustedDomain: false,
    senderDomain: '',
    hardBlockSignalsFound: [] as string[],
    strongRecruitmentSignalsFound: [] as string[],
    weakRecruitmentSignalsFound: [] as string[],
    jobRelevanceScore: 0,
  };

  const domain = extractSenderDomain(sender);

  if (!domain) {
    return {
      ...base,
      decision: 'REJECTED',
      reason: 'Rejected: sender address is malformed or missing.',
      reasonCode: 'MALFORMED_SENDER',
      passedFilter: false,
    };
  }

  const combinedContent = normalize(`${subject} ${snippet}`);

  if (!combinedContent) {
    return {
      ...base,
      senderDomain: domain,
      decision: 'REJECTED',
      reason: 'Rejected: email has no subject or body content.',
      reasonCode: 'EMPTY_CONTENT',
      passedFilter: false,
    };
  }

  const trusted = isDomainTrusted(domain);
  const hardBlockedDomain = isHardBlockedDomain(domain);
  const hardBlockSignals = findMatches(combinedContent, HARD_BLOCK_KEYWORDS);
  const strongSignals = findMatches(combinedContent, STRONG_RECRUITMENT_SIGNALS);
  const weakSignals = findMatches(combinedContent, WEAK_RECRUITMENT_SIGNALS);

  const jobRelevanceScore = calculateJobRelevanceScore({
    trusted,
    strongSignals,
    weakSignals,
    hardBlocks: hardBlockSignals,
    upstreamConfidence: confidence,
  });

  const resultBase = {
    ...base,
    senderDomain: domain,
    trustedDomain: trusted,
    hardBlockSignalsFound: hardBlockSignals,
    strongRecruitmentSignalsFound: strongSignals,
    weakRecruitmentSignalsFound: weakSignals,
    jobRelevanceScore,
  };

  if (hardBlockedDomain && strongSignals.length === 0) {
    return {
      ...resultBase,
      decision: 'REJECTED',
      reason: `Rejected: sender domain "${domain}" is commonly non-recruitment and no strong hiring signal was found.`,
      reasonCode: 'HARD_BLOCK_DOMAIN',
      passedFilter: false,
    };
  }

  if (hardBlockSignals.length > 0 && strongSignals.length === 0) {
    return {
      ...resultBase,
      decision: 'REJECTED',
      reason: `Rejected: non-job signals found [${hardBlockSignals.join(', ')}] and no strong recruitment signal was detected.`,
      reasonCode: 'HARD_BLOCK_KEYWORDS',
      passedFilter: false,
    };
  }

  if (trusted && strongSignals.length > 0) {
    return {
      ...resultBase,
      decision: 'ACCEPTED',
      reason: `Accepted: trusted recruiting domain "${domain}" with strong recruitment signals [${strongSignals.join(', ')}].`,
      reasonCode: 'TRUSTED_DOMAIN_STRONG_RECRUITMENT',
      passedFilter: true,
    };
  }

  if (strongSignals.length >= 2 && jobRelevanceScore >= 70) {
    return {
      ...resultBase,
      decision: 'ACCEPTED',
      reason: `Accepted: multiple strong recruitment signals found [${strongSignals.join(', ')}].`,
      reasonCode: 'STRONG_RECRUITMENT_SIGNAL',
      passedFilter: true,
    };
  }

  if (strongSignals.length === 1 && jobRelevanceScore >= 55) {
    return {
      ...resultBase,
      decision: 'REVIEW',
      reason: `Review: one strong recruitment signal found [${strongSignals.join(', ')}], but not enough evidence for automatic acceptance.`,
      reasonCode: 'BORDERLINE_RECRUITMENT',
      passedFilter: true,
    };
  }

  if (hardBlockSignals.length > 0 && strongSignals.length > 0) {
    return {
      ...resultBase,
      decision: 'REVIEW',
      reason: `Review: mixed signals. Recruitment signals [${strongSignals.join(', ')}], but non-job signals [${hardBlockSignals.join(', ')}] also appeared.`,
      reasonCode: 'MIXED_SIGNALS',
      passedFilter: true,
    };
  }

  if (weakSignals.length > 0) {
    return {
      ...resultBase,
      decision: 'REVIEW',
      reason: `Review: only weak job-related terms found [${weakSignals.join(', ')}]. No strong recruitment signal.`,
      reasonCode: 'WEAK_SIGNAL_ONLY',
      passedFilter: true,
    };
  }

  return {
    ...resultBase,
    decision: 'REJECTED',
    reason: 'Rejected: no reliable recruitment signal found.',
    reasonCode: 'NO_RECRUITMENT_SIGNAL',
    passedFilter: false,
  };
};

export const filterEmailBatch = (emails: RawEmail[]): FilterBatchResult => {
  const start = Date.now();

  const results = emails.map(filterEmail);

  return {
    accepted: results.filter((result) => result.decision === 'ACCEPTED'),
    rejected: results.filter((result) => result.decision === 'REJECTED'),
    review: results.filter((result) => result.decision === 'REVIEW'),
    totalProcessed: results.length,
    processingTimeMs: Date.now() - start,
  };
};

export const getPassingEmails = (batch: FilterBatchResult): FilteredEmail[] => [
  ...batch.accepted,
  ...batch.review,
];

export const runEmailFilterStage = async (
  rawEmails: RawEmail[]
): Promise<{
  passing: FilteredEmail[];
  rejected: FilteredEmail[];
  stats: {
    total: number;
    accepted: number;
    review: number;
    rejected: number;
    acceptanceRate: number;
    processingTimeMs: number;
  };
}> => {
  const batch = filterEmailBatch(rawEmails);
  const passing = getPassingEmails(batch);

  return {
    passing,
    rejected: batch.rejected,
    stats: {
      total: batch.totalProcessed,
      accepted: batch.accepted.length,
      review: batch.review.length,
      rejected: batch.rejected.length,
      acceptanceRate:
        batch.totalProcessed > 0
          ? Math.round((passing.length / batch.totalProcessed) * 100)
          : 0,
      processingTimeMs: batch.processingTimeMs,
    },
  };
};