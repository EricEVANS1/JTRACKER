// src/lib/resumeTailoring.ts
// Safe deterministic tailoring for Resume Builder.
// This file only optimizes:
// - Experience bullet points
// - Skills & competencies
//
// It does not touch layout, personal information, education, projects, save, or export.
// It does not add missing_keywords automatically.


import type {
  ExperienceItem,
  ResumeBuilderState,
  SkillsAwards,
} from '../types/resumeBuilder';

export type TailoringChangeType =
  | 'bullet_optimized'
  | 'bullet_fragments_merged'
  | 'technical_skill_added'
  | 'language_moved'
  | 'certification_moved'
  | 'award_moved'
  | 'duplicate_removed';

export type TailoringChange = {
  type: TailoringChangeType;
  section: 'experience' | 'skillsAwards';
  before?: string;
  after?: string;
  reason: string;
};


type AnalysisRecordLike = {
  matched_keywords?: string[] | null;
  partial_keywords?: string[] | null;
  missing_keywords?: string[] | null;
  ats_keyword_evidence?: Array<{
    keyword?: string | null;
    status?: 'matched' | 'partial' | 'missing' | string | null;
    kind?: string | null;
    source?: string | null;
    confidence?: string | null;
  }> | null;
  extended_data?: any;
  job_description?: string | null;
  jobDescription?: string | null;
};

export type OptimizeResumeForJobInput = {
  resume: ResumeBuilderState;
  analysis?: AnalysisRecordLike | null;
};

export type OptimizeResumeForJobResult = {
  resume: ResumeBuilderState;
  changes: TailoringChange[];
  usedKeywords: string[];
  skippedMissingKeywords: string[];
};

const LANGUAGE_REGEX =
  /\b(english|german|polish|shona|french|spanish|portuguese|italian|dutch|arabic|chinese|mandarin|japanese|korean|russian|ukrainian|native|fluent|bilingual|intermediate|advanced|basic|a1|a2|b1|b2|c1|c2)\b/i;

const CERT_REGEX =
  /\b(certified|certificate|certification|google it support|aws certified|azure fundamentals|az-900|itil|comptia|ccna|pmp|prince2|scrum master|professional certificate)\b/i;

const AWARD_REGEX =
  /\b(award|honou?r|winner|achievement|recognition|scholarship|employee of the month|hackathon)\b/i;

const TECH_HINT_REGEX =
  /\b(sql|python|javascript|typescript|react|node|java|c#|c\+\+|php|html|css|jira|servicenow|zendesk|salesforce|active directory|microsoft 365|office 365|windows|linux|azure|aws|gcp|docker|kubernetes|git|github|power bi|tableau|excel|api|postman|vpn|citrix|vmware|hyper-v|sap|crm|service desk|incident|troubleshooting|monitoring)\b/i;

const SUPPORT_CONTEXT_REGEX =
  /\b(support|assist|resolve|resolved|troubleshoot|troubleshooting|incident|ticket|tickets|customer|client|service|escalation|technical|software|hardware|connectivity|system|systems|application|applications)\b/i;

const clean = (value: unknown): string =>
  String(value ?? '')
    .replace(/^[-•]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();

const canonical = (value: unknown): string =>
  clean(value)
    .toLowerCase()
    .replace(/\+/g, ' plus ')
    .replace(/[^a-z0-9.#\-/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const splitLines = (value: unknown): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap((item) => splitLines(item));

  return String(value)
    .split(/\n|,|;|\|/)
    .map(clean)
    .filter(Boolean);
};


const JD_SIGNAL_PATTERNS: Array<[RegExp, string]> = [
  [/\b(jira|ticketing|tickets?)\b/i, 'ticketing'],
  [/\b(service\s*now|servicenow)\b/i, 'ServiceNow'],
  [/\b(sla|service level agreement)\b/i, 'SLA'],
  [/\b(incident management|incident response|incidents?)\b/i, 'incident management'],
  [/\b(troubleshoot|troubleshooting|diagnos(?:e|is|tic))\b/i, 'troubleshooting'],
  [/\b(log analysis|logs?|splunk|monitoring|observability)\b/i, 'monitoring and log analysis'],
  [/\b(escalat(?:e|ion)|engineering team|bug report|defect)\b/i, 'escalation'],
  [/\b(document(?:ation)?|knowledge base|case notes|runbook)\b/i, 'documentation'],
  [/\b(api|postman|rest)\b/i, 'API testing'],
  [/\b(sql|database|query)\b/i, 'SQL'],
  [/\b(linux|windows|operating systems?)\b/i, 'operating systems'],
  [/\b(customer|client|stakeholder|b2b)\b/i, 'customer communication'],
  [/\b(quality assurance|qa|testing|test cases?|regression|uat)\b/i, 'testing'],
  [/\b(process improvement|automation|workflow|efficien(?:cy|t))\b/i, 'process improvement'],
];

const extractJdSignalsFromText = (value: unknown): string[] => {
  const text = String(value ?? '');
  if (!text.trim()) return [];

  return unique(
    JD_SIGNAL_PATTERNS
      .filter(([pattern]) => pattern.test(text))
      .map(([, signal]) => signal),
  );
};

const unique = (values: string[]): string[] => {
  const seen = new Set<string>();
  const output: string[] = [];

  values.map(clean).filter(Boolean).forEach((value) => {
    const key = canonical(value);
    if (!seen.has(key)) {
      seen.add(key);
      output.push(value);
    }
  });

  return output;
};

const toLines = (values: string[]): string => unique(values).join('\n');

const hasPhrase = (text: string, phrase: string): boolean => {
  const source = canonical(text);
  const key = canonical(phrase);
  if (!key) return false;
  return source.includes(key);
};

const getSafeJdKeywords = (analysis?: AnalysisRecordLike | null): string[] => {
  if (!analysis) return [];

  const directKeywords = [
    ...splitLines(analysis.matched_keywords),
    ...splitLines(analysis.partial_keywords),
  ];

  const evidenceKeywords = Array.isArray(analysis.ats_keyword_evidence)
    ? analysis.ats_keyword_evidence
        .filter((item) => item?.status === 'matched' || item?.status === 'partial')
        .map((item) => clean(item?.keyword))
        .filter(Boolean)
    : [];

  const extendedEvidence = Array.isArray(analysis.extended_data?.ats_keyword_evidence)
    ? analysis.extended_data.ats_keyword_evidence
        .filter((item: any) => item?.status === 'matched' || item?.status === 'partial')
        .map((item: any) => clean(item?.keyword))
        .filter(Boolean)
    : [];

  const jdTextSignals = extractJdSignalsFromText(
    analysis.job_description ?? analysis.jobDescription ?? analysis.extended_data?.job_description,
  );

  return unique([...directKeywords, ...evidenceKeywords, ...extendedEvidence, ...jdTextSignals]);
};

const getSkippedMissingKeywords = (analysis?: AnalysisRecordLike | null): string[] =>
  unique([
    ...splitLines(analysis?.missing_keywords),
    ...(Array.isArray(analysis?.ats_keyword_evidence)
      ? analysis.ats_keyword_evidence
          .filter((item) => item?.status === 'missing')
          .map((item) => clean(item?.keyword))
      : []),
  ]);

const classifyKeyword = (
  keyword: string,
): 'technical' | 'language' | 'certification' | 'award' => {
  const value = clean(keyword);

  if (LANGUAGE_REGEX.test(value) && !TECH_HINT_REGEX.test(value)) return 'language';
  if (CERT_REGEX.test(value)) return 'certification';
  if (AWARD_REGEX.test(value)) return 'award';

  return 'technical';
};

const splitSkillsAwards = (skillsAwards: SkillsAwards) => {
  const technical: string[] = [];
  const languages: string[] = [];
  const certifications: string[] = [];
  const awards: string[] = [];

  [
    ...splitLines(skillsAwards.technicalSkills),
    ...splitLines(skillsAwards.languages),
    ...splitLines(skillsAwards.trainingCertifications),
    ...splitLines(skillsAwards.awards),
  ].forEach((item) => {
    const bucket = classifyKeyword(item);

    if (bucket === 'language') languages.push(item);
    else if (bucket === 'certification') certifications.push(item);
    else if (bucket === 'award') awards.push(item);
    else technical.push(item);
  });

  return { technical, languages, certifications, awards };
};

const buildSkillsAwards = (
  current: SkillsAwards,
  safeKeywords: string[],
  changes: TailoringChange[],
): SkillsAwards => {
  const existing = splitSkillsAwards(current);
  const jdBuckets = splitSkillsAwards({
    technicalSkills: safeKeywords.join('\n'),
    languages: '',
    trainingCertifications: '',
    awards: '',
  });

  const technical = unique([...existing.technical, ...jdBuckets.technical]);
  const languages = unique([...existing.languages, ...jdBuckets.languages]);
  const certifications = unique([...existing.certifications, ...jdBuckets.certifications]);
  const awards = unique([...existing.awards, ...jdBuckets.awards]);

  jdBuckets.technical.forEach((keyword) => {
    if (!existing.technical.some((item) => canonical(item) === canonical(keyword))) {
      changes.push({
        type: 'technical_skill_added',
        section: 'skillsAwards',
        after: keyword,
        reason: `Added "${keyword}" because it was matched or partially matched against the job description.`,
      });
    }
  });

  return {
    technicalSkills: toLines(technical),
    languages: toLines(languages),
    trainingCertifications: toLines(certifications),
    awards: toLines(awards),
  };
};

const startsLikeContinuation = (value: string): boolean =>
  /^(and|or|but|system|systems|software|hardware|connectivity|application|applications|resulting|reducing|offering|using|while|with|for|to|in|of|by|through)\b/i.test(value);

const endsLikeIncomplete = (value: string): boolean =>
  /(,\s*|\band\b|\bor\b|\bfor\b|\bwith\b|\bof\b|\bto\b|\bin\b|\busing\b|\bcomplex software\b|\bsoftware\b|\bhardware\b|\bsystem\b|\bsystems\b)$/i.test(value.replace(/[.\s]+$/, ''));

const isVeryShortFragment = (value: string): boolean => {
  const cleaned = clean(value);
  const wordCount = cleaned.split(/\s+/).filter(Boolean).length;

  return cleaned.length < 45 || wordCount <= 5;
};

const shouldMergeBulletFragment = (previous: string | undefined, current: string): boolean => {
  const prev = clean(previous ?? '');
  const value = clean(current);

  if (!prev || !value) return false;

  // Clear continuation fragments:
  // "system", "and connectivity issues...", "resulting in zero..."
  if (startsLikeContinuation(value)) return true;

  // Short fragments usually come from wrapped/generated text being split into bullets.
  if (isVeryShortFragment(value) && !/[.!?]$/.test(prev)) return true;

  // Previous bullet is clearly incomplete, so attach the current line.
  if (endsLikeIncomplete(prev)) return true;

  return false;
};

const mergeBulletText = (previous: string, current: string): string => {
  const prev = clean(previous).replace(/[.\s]+$/, '');
  const cur = clean(current);

  if (!prev) return cur;
  if (!cur) return prev;

  if (/^(and|or|but)\b/i.test(cur)) {
    return `${prev} ${cur}.`;
  }

  if (/^(resulting|reducing|offering|using|while|with|through|by)\b/i.test(cur)) {
    return `${prev}, ${cur}.`;
  }

  return `${prev}, ${cur}.`;
};

const normalizeBullets = (
  bullets: string[],
  changes: TailoringChange[],
): string[] => {
  const normalized: string[] = [];

  bullets.map(clean).filter(Boolean).forEach((bullet) => {
    const previous = normalized[normalized.length - 1];

    if (shouldMergeBulletFragment(previous, bullet)) {
      const merged = mergeBulletText(previous, bullet);
      normalized[normalized.length - 1] = merged;

      changes.push({
        type: 'bullet_fragments_merged',
        section: 'experience',
        before: `${previous}\n${bullet}`,
        after: merged,
        reason: 'Merged a broken bullet fragment into the previous bullet.',
      });

      return;
    }

    normalized.push(bullet);
  });

  return normalized;
};

const isFragmentBullet = (bullet: string): boolean => {
  const value = clean(bullet);
  if (!value) return true;

  // After normalizeBullets(), only skip obvious leftovers.
  if (isVeryShortFragment(value) && startsLikeContinuation(value)) return true;

  return false;
};

const keywordBucket = (safeKeywords: string[]) => {
  const has = (patterns: RegExp[]) =>
    safeKeywords.some((keyword) => patterns.some((pattern) => pattern.test(keyword)));

  return {
    hasTicketing: has([/\bjira\b/i, /\bzendesk\b/i, /\bservicenow\b/i, /\bticket/i]),
    hasIncident: has([/\bincident\b/i, /\bincident management\b/i]),
    hasSla: has([/\bsla\b/i, /\bservice level/i]),
    hasTroubleshooting: has([/\btroubleshooting\b/i, /\btechnical support\b/i]),
    hasRootCause: has([/\broot cause/i, /\banalysis\b/i]),
    hasDocumentation: has([/\bdocument/i, /\bknowledge base/i, /\bcase notes/i]),
    hasEscalation: has([/\bescalat/i, /\bbug/i, /\bengineering team/i]),
    hasMonitoring: has([/\bmonitoring\b/i, /\blog analysis\b/i, /\blogs?\b/i, /\bsplunk\b/i]),
    hasCustomer: has([/\bcustomer\b/i, /\bclient\b/i, /\bstakeholder\b/i, /\bb2b\b/i]),
    hasTesting: has([/\btesting\b/i, /\bqa\b/i, /\btest cases?\b/i, /\bregression\b/i]),
  };
};

const actionVerbUpgrade = (value: string): string => {
  const trimmed = clean(value);

  const replacements: Array<[RegExp, string]> = [
    [/^handled\b/i, 'Managed'],
    [/^helped\b/i, 'Supported'],
    [/^worked on\b/i, 'Contributed to'],
    [/^did\b/i, 'Completed'],
    [/^was responsible for\b/i, 'Owned'],
    [/^dealt with\b/i, 'Resolved'],
  ];

  for (const [pattern, replacement] of replacements) {
    if (pattern.test(trimmed)) return trimmed.replace(pattern, replacement);
  }

  return trimmed;
};

const appendPhrase = (value: string, phrase: string): string =>
  `${value.replace(/[.\s]+$/, '')}, ${phrase}.`;

const improveBulletLightly = (
  bullet: string,
  safeKeywords: string[],
  roleUsage: Record<string, number>,
): { bullet: string; reason?: string } => {
  const value = actionVerbUpgrade(bullet);
  if (!value || isFragmentBullet(value)) return { bullet };

  const bucket = keywordBucket(safeKeywords);
  const supportContext = SUPPORT_CONTEXT_REGEX.test(value);

  // Highest-value, JD-aware improvements first. Each role receives a specific
  // enhancement once, preventing keyword stuffing and keeping the CV truthful.
  if (
    supportContext &&
    bucket.hasTicketing &&
    !hasPhrase(value, 'ticket') &&
    (roleUsage.ticketing ?? 0) < 1
  ) {
    roleUsage.ticketing = (roleUsage.ticketing ?? 0) + 1;
    return {
      bullet: appendPhrase(value, 'documenting and tracking support cases through ticketing workflows'),
      reason: 'Aligned this bullet with JD signals for ticketing/case management.',
    };
  }

  if (
    supportContext &&
    bucket.hasTroubleshooting &&
    !hasPhrase(value, 'troubleshooting') &&
    (roleUsage.troubleshooting ?? 0) < 1
  ) {
    roleUsage.troubleshooting = (roleUsage.troubleshooting ?? 0) + 1;
    return {
      bullet: appendPhrase(value, 'using structured troubleshooting to diagnose user issues'),
      reason: 'Aligned this bullet with JD signals for troubleshooting and diagnostics.',
    };
  }

  if (
    supportContext &&
    bucket.hasEscalation &&
    !hasPhrase(value, 'escalat') &&
    (roleUsage.escalation ?? 0) < 1
  ) {
    roleUsage.escalation = (roleUsage.escalation ?? 0) + 1;
    return {
      bullet: appendPhrase(value, 'escalating complex cases to specialist teams with clear context'),
      reason: 'Aligned this bullet with JD signals for escalation and cross-functional support.',
    };
  }

  if (
    supportContext &&
    bucket.hasDocumentation &&
    !hasPhrase(value, 'document') &&
    (roleUsage.documentation ?? 0) < 1
  ) {
    roleUsage.documentation = (roleUsage.documentation ?? 0) + 1;
    return {
      bullet: appendPhrase(value, 'maintaining clear documentation and case notes'),
      reason: 'Aligned this bullet with JD signals for documentation.',
    };
  }

  if (
    supportContext &&
    bucket.hasSla &&
    !hasPhrase(value, 'sla') &&
    (roleUsage.sla ?? 0) < 1
  ) {
    roleUsage.sla = (roleUsage.sla ?? 0) + 1;
    return {
      bullet: appendPhrase(value, 'supporting SLA-focused service delivery'),
      reason: 'Aligned this bullet with JD signals for SLA/service delivery.',
    };
  }

  if (
    /monitor|metric|dashboard|alert|production|issue|problem|incident/i.test(value) &&
    bucket.hasMonitoring &&
    !hasPhrase(value, 'monitoring') &&
    (roleUsage.monitoring ?? 0) < 1
  ) {
    roleUsage.monitoring = (roleUsage.monitoring ?? 0) + 1;
    return {
      bullet: appendPhrase(value, 'supporting monitoring and issue investigation'),
      reason: 'Aligned this bullet with JD signals for monitoring/log analysis.',
    };
  }

  if (
    /recurring|repeat|improve|improvement|process|analy[sz]e|monitoring|metrics/i.test(value) &&
    bucket.hasRootCause &&
    !hasPhrase(value, 'root cause') &&
    (roleUsage.rootCause ?? 0) < 1
  ) {
    roleUsage.rootCause = (roleUsage.rootCause ?? 0) + 1;
    return {
      bullet: appendPhrase(value, 'supporting root cause analysis'),
      reason: 'Aligned this bullet with JD signals for analysis/root-cause thinking.',
    };
  }

  if (
    /test|verify|validate|quality|bug|defect|release/i.test(value) &&
    bucket.hasTesting &&
    !hasPhrase(value, 'testing') &&
    (roleUsage.testing ?? 0) < 1
  ) {
    roleUsage.testing = (roleUsage.testing ?? 0) + 1;
    return {
      bullet: appendPhrase(value, 'supporting validation and testing activities'),
      reason: 'Aligned this bullet with JD signals for testing/quality assurance.',
    };
  }

  if (value !== clean(bullet)) {
    return {
      bullet: value,
      reason: 'Strengthened the bullet with a clearer action verb while preserving the original meaning.',
    };
  }

  return { bullet };
};

const optimizeExperience = (
  experience: ExperienceItem[],
  safeKeywords: string[],
  changes: TailoringChange[],
): ExperienceItem[] =>
  experience.map((role) => {
    const roleUsage: Record<string, number> = {};
    const cleanedBullets = normalizeBullets(role.bullets, changes);

    return {
      ...role,
      bullets: cleanedBullets.map((bullet) => {
        const optimized = improveBulletLightly(bullet, safeKeywords, roleUsage);

        if (optimized.reason && optimized.bullet !== bullet && optimized.bullet.length <= 220) {
          changes.push({
            type: 'bullet_optimized',
            section: 'experience',
            before: bullet,
            after: optimized.bullet,
            reason: optimized.reason,
          });

          return optimized.bullet;
        }

        return bullet;
      }),
    };
  });

export const optimizeResumeForJob = ({
  resume,
  analysis,
}: OptimizeResumeForJobInput): OptimizeResumeForJobResult => {
  const changes: TailoringChange[] = [];
  const safeKeywords = getSafeJdKeywords(analysis);
  const skippedMissingKeywords = getSkippedMissingKeywords(analysis);

  return {
    resume: {
      ...resume,
      experience: optimizeExperience(resume.experience, safeKeywords, changes),
      skillsAwards: buildSkillsAwards(resume.skillsAwards, safeKeywords, changes),
    },
    changes,
    usedKeywords: safeKeywords,
    skippedMissingKeywords,
  };
};
