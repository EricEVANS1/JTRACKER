export type ExtractionSource =
  | 'PATTERN_MATCH'
  | 'ATS_PATTERN'
  | 'SENDER_DISPLAY'
  | 'SUBJECT_FALLBACK'
  | 'UNKNOWN';

export interface ExtractionField<T> {
  value: T;
  source: ExtractionSource;
  fieldConfidence: number;
}

export interface ExtractedApplicationData {
  companyName: ExtractionField<string>;
  roleTitle: ExtractionField<string>;
  confidence: number;
  reason: string;
}

export interface EmailExtractionInput {
  subject: string;
  snippet: string;
  sender: string;
  atsDomain?: string;
}

const cleanText = (value: string): string =>
  value
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\u2019/g, "'")
    .replace(/\u2013/g, '-')
    .replace(/\u2014/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

const normalize = (value: string): string =>
  cleanText(value).toLowerCase();

const trimTrailingNoise = (value: string): string =>
  value
    .replace(/[\|\-–—]\s*(careers|jobs|recruiting|greenhouse|lever|workday|smartrecruiters).*$/i, '')
    .replace(/[,\.;:]+$/, '')
    .trim();

const removeTrailingSentenceNoise = (value: string): string =>
  value
    .replace(/\s+dear\s+.+$/i, '')
    .replace(/\s+hi\s+.+$/i, '')
    .replace(/\s+hello\s+.+$/i, '')
    .replace(/\s+thank\s+you\s+.+$/i, '')
    .replace(/\s+we\s+.+$/i, '')
    .replace(/\s+your\s+.+$/i, '')
    .trim();

const cleanCandidate = (value: string): string =>
  removeTrailingSentenceNoise(trimTrailingNoise(cleanText(value)))
    .replace(/^the position of\s+/i, '')
    .replace(/^position of\s+/i, '')
    .replace(/^the role of\s+/i, '')
    .replace(/^role of\s+/i, '')
    .replace(/^your recent job application for\s+/i, '')
    .replace(/^your application for\s+/i, '')
    .replace(/^application for\s+/i, '')
    .replace(/^job application for\s+/i, '')
    .replace(/^confirming your\s+/i, '')
    .replace(/^re:\s*/i, '')
    .replace(/^fwd:\s*/i, '')
    .replace(/^hi\s+.+$/i, '')
    .replace(/^dear\s+.+$/i, '')
    .trim();

const JUNK_VALUES = new Set([
  'the position',
  'a position',
  'the role',
  'a role',
  'our team',
  'our company',
  'us',
  'our organization',
  'the team',
  'this role',
  'this position',
  'unknown',
  'application',
  'your application',
  'job application',
  'careers',
  'jobs',
  '',
]);

const NON_ROLE_PHRASES = [
  'youtube premium',
  'freecodecamp',
  'newsletter',
  'course',
  'tutorial',
  'webinar',
  'subscription',
  'premium',
  'receipt',
  'invoice',
  'billing',
  'discount',
  'promo',
  'promotion',
  'sale',
  'event loop',
  'learn javascript',
  'learn python',
  'watch now',
  'new video',
  'weekly digest',
  'daily digest',
  'unsubscribe',
];

const GENERIC_ROLE_WORDS = [
  'engineer',
  'developer',
  'analyst',
  'specialist',
  'consultant',
  'manager',
  'designer',
  'intern',
  'internship',
  'graduate',
  'assistant',
  'administrator',
  'support',
  'tester',
  'qa',
  'data',
  'software',
  'backend',
  'frontend',
  'full stack',
  'full-stack',
  'devops',
  'product',
  'customer',
  'technical',
  'operations',
];

const isJunk = (value: string): boolean => {
  const v = normalize(value);

  return (
    v.length < 3 ||
    v.length > 120 ||
    JUNK_VALUES.has(v) ||
    /^\d+$/.test(v) ||
    NON_ROLE_PHRASES.some((phrase) => v.includes(phrase))
  );
};

const looksLikeRole = (value: string): boolean => {
  const v = normalize(value);

  if (isJunk(v)) return false;

  return GENERIC_ROLE_WORDS.some((word) => v.includes(word));
};

const looksLikeCompany = (value: string): boolean => {
  const v = normalize(value);

  if (isJunk(v)) return false;
  if (v.length < 2 || v.length > 80) return false;

  return true;
};

const SENDER_NOISE_PATTERN = new RegExp(
  [
    '\\brecruitment\\b',
    '\\brecruiting\\b',
    '\\brecruiter\\b',
    '\\bhiring team\\b',
    '\\bhiring\\b',
    '\\bhuman resources\\b',
    '\\btalent acquisition\\b',
    '\\btalent team\\b',
    '\\bpeople team\\b',
    '\\bpeople ops\\b',
    '\\bpeople operations\\b',
    '\\bhr\\b',
    '\\bvia\\s+\\w+\\b',
    '\\bno.?reply\\b',
    '\\bnoreply\\b',
    '\\bdo.?not.?reply\\b',
    '\\bjobs?\\b',
    '\\bcareers?\\b',
    '\\bteam\\b',
    '\\bnotifications?\\b',
  ].join('|'),
  'gi'
);

export const extractDisplayNameCompany = (sender: string): string => {
  const displayName = sender.split('<')[0].trim();

  if (!displayName) return '';

  return cleanCandidate(
    displayName
      .replace(SENDER_NOISE_PATTERN, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[-\s]+|[-\s]+$/g, '')
  );
};

interface PatternResult {
  role?: string;
  company?: string;
}

const ROLE_PATTERNS: Array<{
  re: RegExp;
  extract: (m: RegExpMatchArray) => PatternResult;
  requireRoleShape?: boolean;
}> = [
  {
    re: /thank you for applying to (.+?)\s*[-–—]\s*(.+?)(?:[,\.]|$)/i,
    extract: (m) => ({ company: m[1], role: m[2] }),
    requireRoleShape: true,
  },
  {
    re: /thank you for applying (?:for|to) (.+?)\s+at\s+(.+?)(?:[,\.]|$)/i,
    extract: (m) => ({ role: m[1], company: m[2] }),
    requireRoleShape: true,
  },
  {
    re: /thank you for applying for (?:the\s+)?(.+?)\s+(?:role|position)\s+at\s+(.+?)(?:[,\.]|$)/i,
    extract: (m) => ({ role: m[1], company: m[2] }),
    requireRoleShape: true,
  },
  {
    re: /your application for (?:the\s+)?(.+?)\s+(?:role|position)\s+at\s+(.+?)(?:[,\.]|$)/i,
    extract: (m) => ({ role: m[1], company: m[2] }),
    requireRoleShape: true,
  },
  {
    re: /application (?:for|to) (?:the\s+)?(.+?)\s+at\s+(.+?)(?:[,\.]|$)/i,
    extract: (m) => ({ role: m[1], company: m[2] }),
    requireRoleShape: true,
  },
  {
    re: /(?:for\s+)?the position of (.+?)\s+at\s+(.+?)(?:[,\.]|$)/i,
    extract: (m) => ({ role: m[1], company: m[2] }),
    requireRoleShape: true,
  },
  {
    re: /(?:for\s+)?the role of (.+?)\s+at\s+(.+?)(?:[,\.]|$)/i,
    extract: (m) => ({ role: m[1], company: m[2] }),
    requireRoleShape: true,
  },
  {
    re: /(.+?)\s+position\s+at\s+(.+?)(?:[,\.]|$)/i,
    extract: (m) => ({ role: m[1], company: m[2] }),
    requireRoleShape: true,
  },
  {
    re: /(.+?)\s+role\s+at\s+(.+?)(?:[,\.]|$)/i,
    extract: (m) => ({ role: m[1], company: m[2] }),
    requireRoleShape: true,
  },
  {
    re: /invited? (?:to|for) (?:an?\s+)?(?:interview|coding test|assessment|challenge)\s+(?:for|regarding)\s+(.+?)\s+at\s+(.+?)(?:[,\.]|$)/i,
    extract: (m) => ({ role: m[1], company: m[2] }),
    requireRoleShape: true,
  },
  {
    re: /(?:interview|assessment|coding challenge|technical test) (?:for|regarding)\s+(.+?)\s+at\s+(.+?)(?:[,\.]|$)/i,
    extract: (m) => ({ role: m[1], company: m[2] }),
    requireRoleShape: true,
  },
  {
    re: /submitting your application for the position of (.+?)(?:[,\.]|$)/i,
    extract: (m) => ({ role: m[1] }),
    requireRoleShape: true,
  },
  {
    re: /your application for (?:the\s+)?(.+?)(?:\s+(?:has been|was|is)\b|[,\.]|$)/i,
    extract: (m) => ({ role: m[1] }),
    requireRoleShape: true,
  },
  {
    re: /application received for (?:the\s+)?(.+?)(?:\s+(?:role|position)\b|[,\.]|$)/i,
    extract: (m) => ({ role: m[1] }),
    requireRoleShape: true,
  },
];

const COMPANY_PATTERNS: RegExp[] = [
  /thank you for your interest in (?:joining\s+)?(.+?)(?:[,\.]|$)/i,
  /thank you for considering (.+?)(?:[,\.]|$)/i,
  /your application to (.+?) has been/i,
  /application to (.+?) has been/i,
  /joining (?:the team at\s+)?(.+?)(?:[,\.!]|$)/i,
  /welcome to (.+?)(?:[,\.!]|$)/i,
];

const SUBJECT_STRIP_PHRASES = [
  /thank you for applying (?:to|for)/i,
  /thanks for applying (?:to|for)/i,
  /your application (?:for|to)/i,
  /application received(?: for)?/i,
  /application update(?: for)?/i,
  /we received your application(?: for)?/i,
  /next steps(?: for)?/i,
  /interview invitation(?: for)?/i,
  /assessment invitation(?: for)?/i,
  /coding challenge(?: for)?/i,
  /technical assessment(?: for)?/i,
];

const cleanSubjectFallback = (subject: string): string => {
  let result = subject;

  for (const phrase of SUBJECT_STRIP_PHRASES) {
    result = result.replace(phrase, '');
  }

  return cleanCandidate(result);
};

const SOURCE_LABELS: Record<ExtractionSource, string> = {
  PATTERN_MATCH: 'pattern match',
  ATS_PATTERN: 'ATS pattern',
  SENDER_DISPLAY: 'sender display name',
  SUBJECT_FALLBACK: 'subject fallback',
  UNKNOWN: 'not found',
};

const buildReason = (
  role: ExtractionField<string>,
  company: ExtractionField<string>,
  confidence: number
): string => {
  const parts: string[] = [];

  if (role.source !== 'UNKNOWN') {
    parts.push(
      `Role "${role.value}" via ${SOURCE_LABELS[role.source]} (${role.fieldConfidence}%)`
    );
  } else {
    parts.push('Role could not be confidently extracted');
  }

  if (company.source !== 'UNKNOWN') {
    parts.push(
      `company "${company.value}" via ${SOURCE_LABELS[company.source]} (${company.fieldConfidence}%)`
    );
  } else {
    parts.push('company could not be confidently extracted');
  }

  return `${parts.join('; ')}. Overall extraction confidence: ${confidence}%.`;
};

const calculateOverallConfidence = (
  role: ExtractionField<string>,
  company: ExtractionField<string>
): number => {
  if (role.source === 'UNKNOWN' && company.source === 'UNKNOWN') return 0;

  return Math.round(role.fieldConfidence * 0.55 + company.fieldConfidence * 0.45);
};

export const extractApplicationData = (
  input: EmailExtractionInput
): ExtractedApplicationData => {
  const { subject, snippet, sender } = input;

  const cleanedSubject = cleanText(subject);
  const cleanedSnippet = cleanText(snippet);
  const cleanedSender = cleanText(sender);

  const subjectContent = cleanedSubject;
  const fullContent = `${cleanedSubject} ${cleanedSnippet}`;

  let rawRole: string | undefined;
  let rawCompany: string | undefined;
  let roleSource: ExtractionSource = 'UNKNOWN';
  let companySource: ExtractionSource = 'UNKNOWN';
  let roleConfidence = 0;
  let companyConfidence = 0;

  for (const { re, extract, requireRoleShape } of ROLE_PATTERNS) {
    const matchSubject = subjectContent.match(re);
    const matchFull = matchSubject ?? fullContent.match(re);

    if (!matchFull) continue;

    const result = extract(matchFull);

    if (!rawRole && result.role) {
      const candidate = cleanCandidate(result.role);

      if (!isJunk(candidate) && (!requireRoleShape || looksLikeRole(candidate))) {
        rawRole = candidate;
        roleSource = 'PATTERN_MATCH';
        roleConfidence = 88;
      }
    }

    if (!rawCompany && result.company) {
      const candidate = cleanCandidate(result.company);

      if (looksLikeCompany(candidate)) {
        rawCompany = candidate;
        companySource = 'PATTERN_MATCH';
        companyConfidence = 88;
      }
    }

    if (rawRole && rawCompany) break;
  }

  if (!rawCompany) {
    for (const re of COMPANY_PATTERNS) {
      const match = fullContent.match(re);

      if (match?.[1]) {
        const candidate = cleanCandidate(match[1]);

        if (looksLikeCompany(candidate)) {
          rawCompany = candidate;
          companySource = 'PATTERN_MATCH';
          companyConfidence = 82;
          break;
        }
      }
    }
  }

  if (!rawCompany) {
    const displayCompany = extractDisplayNameCompany(cleanedSender);

    if (looksLikeCompany(displayCompany)) {
      rawCompany = displayCompany;
      companySource = 'SENDER_DISPLAY';
      companyConfidence = 62;
    }
  }

  if (!rawRole) {
    const fallback = cleanSubjectFallback(cleanedSubject);

    if (looksLikeRole(fallback)) {
      rawRole = fallback;
      roleSource = 'SUBJECT_FALLBACK';
      roleConfidence = 45;
    }
  }

  const roleFinal: ExtractionField<string> = {
    value: rawRole ?? 'Unknown Role',
    source: rawRole ? roleSource : 'UNKNOWN',
    fieldConfidence: rawRole ? roleConfidence : 0,
  };

  const companyFinal: ExtractionField<string> = {
    value: rawCompany ?? 'Unknown Company',
    source: rawCompany ? companySource : 'UNKNOWN',
    fieldConfidence: rawCompany ? companyConfidence : 0,
  };

  const confidence = calculateOverallConfidence(roleFinal, companyFinal);

  return {
    companyName: companyFinal,
    roleTitle: roleFinal,
    confidence,
    reason: buildReason(roleFinal, companyFinal, confidence),
  };
};

export const extractApplicationDataFromEmail = (
  subject: string,
  snippet: string,
  sender: string
): {
  companyName: string;
  roleTitle: string;
  confidence: number;
  reason: string;
  companyConfidence: number;
  roleConfidence: number;
  companySource: ExtractionSource;
  roleSource: ExtractionSource;
} => {
  const extracted = extractApplicationData({
    subject,
    snippet,
    sender,
  });

  return {
    companyName: extracted.companyName.value,
    roleTitle: extracted.roleTitle.value,
    confidence: extracted.confidence,
    reason: extracted.reason,
    companyConfidence: extracted.companyName.fieldConfidence,
    roleConfidence: extracted.roleTitle.fieldConfidence,
    companySource: extracted.companyName.source,
    roleSource: extracted.roleTitle.source,
  };
};

export const runExtractionStage = (
  emails: EmailExtractionInput[]
): Array<EmailExtractionInput & ExtractedApplicationData> =>
  emails.map((email) => ({
    ...email,
    ...extractApplicationData(email),
  }));