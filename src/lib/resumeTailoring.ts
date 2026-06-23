// src/lib/resumeTailoring.ts
// Master-CV-first, JD-aware tailoring for Resume Builder.
// It rewrites existing Master CV bullets for role alignment and returns
// per-bullet changes so the UI can show Original -> Improved -> Reason.

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
  roleId?: string;
  roleTitle?: string;
  company?: string;
  bulletIndex?: number;
};

type AnalysisRecordLike = {
  job_title?: string | null;
  jobTitle?: string | null;
  matched_keywords?: string[] | null;
  partial_keywords?: string[] | null;
  missing_keywords?: string[] | null;
  ats_keyword_evidence?: Array<{
    keyword?: string | null;
    status?: 'matched' | 'partial' | 'missing' | string | null;
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
  /\b(sql|python|javascript|typescript|react|node|java|c#|c\+\+|php|html|css|jira|servicenow|zendesk|salesforce|active directory|microsoft 365|office 365|windows|linux|red hat|rhel|ubuntu|azure|aws|gcp|docker|kubernetes|git|github|power bi|tableau|excel|api|postman|vpn|citrix|vmware|hyper-v|sap|crm|service desk|incident|troubleshooting|monitoring)\b/i;

const SUPPORT_CONTEXT_REGEX =
  /\b(support|assist|resolve|resolved|troubleshoot|troubleshooting|incident|ticket|tickets|customer|client|service|escalation|technical|software|hardware|connectivity|system|systems|application|applications|case|cases|issue|issues|diagnos|investigat)\b/i;

const clean = (value: unknown): string =>
  String(value ?? '')
    .replace(/^[-•]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();

const canonical = (value: unknown): string =>
  clean(value)
    .toLowerCase()
    .replace(/\+/g, ' plus ')
    .replace(/&/g, ' and ')
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
  return Boolean(key && source.includes(key));
};

const includesAny = (value: string, patterns: RegExp[]): boolean =>
  patterns.some((pattern) => pattern.test(value));

const getJobDescription = (analysis?: AnalysisRecordLike | null): string =>
  String(
    analysis?.job_description ??
      analysis?.jobDescription ??
      analysis?.extended_data?.job_description ??
      analysis?.extended_data?.jobDescription ??
      '',
  );

const JD_SIGNAL_PATTERNS: Array<[RegExp, string]> = [
  [/\b(jira|ticketing|tickets?)\b/i, 'ticketing'],
  [/\b(service\s*now|servicenow)\b/i, 'ServiceNow'],
  [/\b(zendesk)\b/i, 'Zendesk'],
  [/\b(sla|service level agreement)\b/i, 'SLA'],
  [/\b(incident management|incident response|incidents?)\b/i, 'incident management'],
  [/\b(problem management|root cause|rca|root-cause)\b/i, 'root cause analysis'],
  [/\b(troubleshoot|troubleshooting|diagnos(?:e|is|tic))\b/i, 'troubleshooting'],
  [/\b(log analysis|logs?|splunk|monitoring|observability)\b/i, 'monitoring and log analysis'],
  [/\b(escalat(?:e|ion)|engineering team|bug report|defect)\b/i, 'escalation'],
  [/\b(document(?:ation)?|knowledge base|case notes|runbook)\b/i, 'documentation'],
  [/\b(api|postman|rest)\b/i, 'API testing'],
  [/\b(sql|database|query)\b/i, 'SQL'],
  [/\b(linux|red hat|rhel|ubuntu|windows|operating systems?)\b/i, 'operating systems'],
  [/\b(customer|client|stakeholder|b2b|partner|reseller|end customer)\b/i, 'customer communication'],
  [/\b(quality assurance|qa|testing|test cases?|regression|uat)\b/i, 'testing'],
  [/\b(process improvement|automation|workflow|efficien(?:cy|t))\b/i, 'process improvement'],
  [/\b(application support|business applications?|production applications?)\b/i, 'application support'],
  [/\b(access|video|cctv|security product|surveillance)\b/i, 'technical product support'],
  [/\b(stability|performance|availability|reliability)\b/i, 'stability and performance'],
  [/\b(collaborat(?:e|ion)|cross-functional|developers?|engineering)\b/i, 'cross-functional collaboration'],
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

  const jdTextSignals = extractJdSignalsFromText(getJobDescription(analysis));

  return unique([
    ...directKeywords,
    ...evidenceKeywords,
    ...extendedEvidence,
    ...jdTextSignals,
  ]);
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

const JD_ONLY_SKILL_DENYLIST = [
  'access and video products',
  'technical product support',
];

const buildSkillsAwards = (
  current: SkillsAwards,
  safeKeywords: string[],
  changes: TailoringChange[],
): SkillsAwards => {
  const existing = splitSkillsAwards(current);
  const safeSkillKeywords = safeKeywords.filter(
    (keyword) =>
      !JD_ONLY_SKILL_DENYLIST.some(
        (blocked) => canonical(blocked) === canonical(keyword),
      ),
  );

  const jdBuckets = splitSkillsAwards({
    technicalSkills: safeSkillKeywords.join('\n'),
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
  /^(and|or|but|system|systems|software|hardware|connectivity|network|application|applications|resulting|reducing|offering|using|while|with|for|to|in|of|by|through|ensuring|sharing|phone)\b/i.test(value);

const endsLikeIncomplete = (value: string): boolean =>
  /(,\s*|\band\b|\bor\b|\bfor\b|\bwith\b|\bof\b|\bto\b|\bin\b|\busing\b|\bcomplex software\b|\bsoftware\b|\bhardware\b|\bos\b|\bsystem\b|\bsystems\b)$/i.test(value.replace(/[.\s]+$/, ''));

const isVeryShortFragment = (value: string): boolean => {
  const cleaned = clean(value);
  const wordCount = cleaned.split(/\s+/).filter(Boolean).length;
  return cleaned.length < 45 || wordCount <= 5;
};

const shouldMergeBulletFragment = (previous: string | undefined, current: string): boolean => {
  const prev = clean(previous ?? '');
  const value = clean(current);

  if (!prev || !value) return false;
  if (startsLikeContinuation(value)) return true;
  if (isVeryShortFragment(value) && !/[.!?]$/.test(prev)) return true;
  if (endsLikeIncomplete(prev)) return true;

  return false;
};

const mergeBulletText = (previous: string, current: string): string => {
  const prev = clean(previous).replace(/[.\s]+$/, '');
  const cur = clean(current);

  if (!prev) return cur;
  if (!cur) return prev;
  if (/^(and|or|but)\b/i.test(cur)) return `${prev} ${cur}.`;
  if (/^(resulting|reducing|offering|using|while|with|through|by|ensuring)\b/i.test(cur)) {
    return `${prev}, ${cur}.`;
  }
  return `${prev}, ${cur}.`;
};

const normalizeBullets = (
  role: ExperienceItem,
  changes: TailoringChange[],
): string[] => {
  const normalized: string[] = [];

  (role.bullets ?? []).map(clean).filter(Boolean).forEach((bullet, idx) => {
    const previous = normalized[normalized.length - 1];

    if (shouldMergeBulletFragment(previous, bullet)) {
      const merged = mergeBulletText(previous, bullet);
      normalized[normalized.length - 1] = merged;

      changes.push({
        type: 'bullet_fragments_merged',
        section: 'experience',
        roleId: role.id,
        roleTitle: role.jobTitle,
        company: role.company,
        bulletIndex: Math.max(0, normalized.length - 1),
        before: `${previous}\n${bullet}`,
        after: merged,
        reason: `Merged broken bullet fragment from original bullet ${idx + 1}.`,
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
  return isVeryShortFragment(value) && startsLikeContinuation(value);
};

const keywordBucket = (safeKeywords: string[], jobDescription = '') => {
  const source = `${safeKeywords.join(' ')} ${jobDescription}`;
  const has = (patterns: RegExp[]) => patterns.some((pattern) => pattern.test(source));

  return {
    hasTicketing: has([/\bjira\b/i, /\bzendesk\b/i, /\bservicenow\b/i, /\bticket/i]),
    hasIncident: has([/\bincident\b/i, /\bincident management\b/i]),
    hasSla: has([/\bsla\b/i, /\bservice level/i]),
    hasTroubleshooting: has([/\btroubleshooting\b/i, /\btechnical support\b/i, /\bdiagnos/i]),
    hasRootCause: has([/\broot cause/i, /\banalysis\b/i, /\brca\b/i]),
    hasDocumentation: has([/\bdocument/i, /\bknowledge base/i, /\bcase notes/i, /\brunbook/i]),
    hasEscalation: has([/\bescalat/i, /\bbug/i, /\bengineering team/i, /\bdefect/i]),
    hasMonitoring: has([/\bmonitoring\b/i, /\blog analysis\b/i, /\blogs?\b/i, /\bsplunk\b/i, /\bobservability\b/i]),
    hasCustomer: has([/\bcustomer\b/i, /\bclient\b/i, /\bstakeholder\b/i, /\bb2b\b/i, /\bpartner\b/i, /\breseller\b/i]),
    hasTesting: has([/\btesting\b/i, /\bqa\b/i, /\btest cases?\b/i, /\bregression\b/i, /\buat\b/i]),
    hasApplicationSupport: has([/\bapplication support\b/i, /\bbusiness applications?\b/i, /\bproduction applications?\b/i]),
    hasPerformance: has([/\bperformance\b/i, /\bstability\b/i, /\bavailability\b/i, /\breliability\b/i]),
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
    [/^talked to\b/i, 'Communicated with'],
    [/^answered\b/i, 'Responded to'],
    [/^fixed\b/i, 'Resolved'],
    [/^checked\b/i, 'Investigated'],
  ];

  for (const [pattern, replacement] of replacements) {
    if (pattern.test(trimmed)) return trimmed.replace(pattern, replacement);
  }
  return trimmed;
};

const removeRepeatedTailoringNoise = (value: string): string => {
  let output = clean(value);
  const noisyPhrases = [
    /,\s*using structured troubleshooting to diagnose user(?: and system)? issues/gi,
    /,\s*maintaining clear documentation(?:, case notes, and handover details| and case notes)?/gi,
    /,\s*escalating complex cases with clear context, impact, and troubleshooting history/gi,
    /,\s*documenting and tracking cases through structured ticketing workflows/gi,
    /,\s*supporting SLA-focused service delivery and timely follow-up/gi,
  ];

  noisyPhrases.forEach((pattern) => {
    output = output.replace(pattern, '');
  });

  return clean(output).replace(/[,\s]+$/, '');
};

const appendPhrase = (value: string, phrase: string): string =>
  `${value.replace(/[.\s]+$/, '')}, ${phrase}.`;

const roleText = (role: ExperienceItem): string =>
  [role.jobTitle, role.company, role.location, role.years, ...(role.bullets ?? [])].join(' ');

const roleLooksTechnical = (role: ExperienceItem): boolean =>
  includesAny(roleText(role), [
    /\btechnical support\b/i,
    /\bit support\b/i,
    /\bhelp desk\b/i,
    /\bservice desk\b/i,
    /\bsupport engineer\b/i,
    /\bsupport specialist\b/i,
    /\bdesktop\b/i,
    /\binfrastructure\b/i,
    /\bincident\b/i,
    /\bticket/i,
    /\btroubleshoot/i,
    /\bapplication/i,
    /\bconnectivity/i,
    /\bos\b/i,
  ]);

const improveBullet = (
  bullet: string,
  role: ExperienceItem,
  safeKeywords: string[],
  roleUsage: Record<string, number>,
  analysis?: AnalysisRecordLike | null,
): { bullet: string; reason?: string } => {
  const original = clean(bullet);
  const value = actionVerbUpgrade(removeRepeatedTailoringNoise(original));

  if (!value || isFragmentBullet(value)) return { bullet: value };

  const bucket = keywordBucket(safeKeywords, getJobDescription(analysis));
  const supportContext = SUPPORT_CONTEXT_REGEX.test(value);
  const technicalRole = roleLooksTechnical(role);

  if (
    technicalRole &&
    supportContext &&
    bucket.hasApplicationSupport &&
    !hasPhrase(value, 'application') &&
    (roleUsage.applicationSupport ?? 0) < 1
  ) {
    roleUsage.applicationSupport = (roleUsage.applicationSupport ?? 0) + 1;
    return {
      bullet: appendPhrase(value, 'supporting application issue investigation and resolution'),
      reason: 'Reworded the Master CV bullet with JD language for application support.',
    };
  }

  if (
    supportContext &&
    bucket.hasTroubleshooting &&
    !hasPhrase(value, 'troubleshooting') &&
    !hasPhrase(value, 'diagnos') &&
    (roleUsage.troubleshooting ?? 0) < 1
  ) {
    roleUsage.troubleshooting = (roleUsage.troubleshooting ?? 0) + 1;
    return {
      bullet: appendPhrase(value, 'using structured troubleshooting to diagnose user and system issues'),
      reason: 'Aligned the Master CV bullet with JD signals for troubleshooting and diagnostics.',
    };
  }

  if (
    supportContext &&
    bucket.hasTicketing &&
    !hasPhrase(value, 'ticket') &&
    !hasPhrase(value, 'case') &&
    (roleUsage.ticketing ?? 0) < 1
  ) {
    roleUsage.ticketing = (roleUsage.ticketing ?? 0) + 1;
    return {
      bullet: appendPhrase(value, 'documenting and tracking support cases through ticketing workflows'),
      reason: 'Aligned the Master CV bullet with JD signals for ticketing and case management.',
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
      bullet: appendPhrase(value, 'escalating complex cases with clear impact, evidence, and troubleshooting context'),
      reason: 'Aligned the Master CV bullet with JD signals for escalation and cross-functional support.',
    };
  }

  if (
    supportContext &&
    bucket.hasDocumentation &&
    !hasPhrase(value, 'document') &&
    !hasPhrase(value, 'case note') &&
    (roleUsage.documentation ?? 0) < 1
  ) {
    roleUsage.documentation = (roleUsage.documentation ?? 0) + 1;
    return {
      bullet: appendPhrase(value, 'maintaining clear documentation, case notes, and handover details'),
      reason: 'Aligned the Master CV bullet with JD signals for documentation.',
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
      bullet: appendPhrase(value, 'supporting SLA-focused service delivery and timely follow-up'),
      reason: 'Aligned the Master CV bullet with JD signals for SLA/service delivery.',
    };
  }

  if (
    /monitor|metric|dashboard|alert|production|issue|problem|incident|investigat/i.test(value) &&
    bucket.hasMonitoring &&
    !hasPhrase(value, 'monitoring') &&
    !hasPhrase(value, 'log') &&
    (roleUsage.monitoring ?? 0) < 1
  ) {
    roleUsage.monitoring = (roleUsage.monitoring ?? 0) + 1;
    return {
      bullet: appendPhrase(value, 'supporting monitoring, log review, and issue investigation'),
      reason: 'Aligned the Master CV bullet with JD signals for monitoring/log analysis.',
    };
  }

  if (
    /recurring|repeat|improve|improvement|process|analy[sz]e|investigat|monitoring|metrics/i.test(value) &&
    bucket.hasRootCause &&
    !hasPhrase(value, 'root cause') &&
    (roleUsage.rootCause ?? 0) < 1
  ) {
    roleUsage.rootCause = (roleUsage.rootCause ?? 0) + 1;
    return {
      bullet: appendPhrase(value, 'supporting root cause analysis and repeat-issue prevention'),
      reason: 'Aligned the Master CV bullet with JD signals for analysis/root-cause thinking.',
    };
  }

  if (value !== original) {
    return {
      bullet: value,
      reason: 'Cleaned repeated tailoring phrases while preserving the original Master CV fact.',
    };
  }

  return { bullet: value };
};

const dedupeBullets = (
  role: ExperienceItem,
  bullets: string[],
  changes: TailoringChange[],
): string[] => {
  const seen = new Set<string>();
  const output: string[] = [];

  bullets.map(clean).filter(Boolean).forEach((bullet, idx) => {
    const key = canonical(bullet);

    if (seen.has(key)) {
      changes.push({
        type: 'duplicate_removed',
        section: 'experience',
        roleId: role.id,
        roleTitle: role.jobTitle,
        company: role.company,
        bulletIndex: idx,
        before: bullet,
        reason: 'Removed a duplicate experience bullet.',
      });
      return;
    }

    seen.add(key);
    output.push(bullet);
  });

  return output;
};

const maxBulletsForRole = (role: ExperienceItem): number => {
  const current = role.bullets?.length ?? 0;
  if (current <= 3) return 5;
  if (current <= 5) return 5;
  return Math.min(current, 6);
};

const optimizeRoleBullets = (
  role: ExperienceItem,
  safeKeywords: string[],
  changes: TailoringChange[],
  analysis?: AnalysisRecordLike | null,
): string[] => {
  const roleUsage: Record<string, number> = {};
  const cleanedBullets = normalizeBullets(role, changes);

  const improvedBullets = cleanedBullets.map((bullet, index) => {
    const optimized = improveBullet(bullet, role, safeKeywords, roleUsage, analysis);

    if (
      optimized.reason &&
      optimized.bullet !== bullet &&
      optimized.bullet.length <= 240
    ) {
      changes.push({
        type: 'bullet_optimized',
        section: 'experience',
        roleId: role.id,
        roleTitle: role.jobTitle,
        company: role.company,
        bulletIndex: index,
        before: bullet,
        after: optimized.bullet,
        reason: optimized.reason,
      });
      return optimized.bullet;
    }

    return bullet;
  });

  return dedupeBullets(role, improvedBullets, changes).slice(0, maxBulletsForRole(role));
};

const optimizeExperience = (
  experience: ExperienceItem[],
  safeKeywords: string[],
  changes: TailoringChange[],
  analysis?: AnalysisRecordLike | null,
): ExperienceItem[] =>
  experience.map((role) => ({
    ...role,
    bullets: optimizeRoleBullets(role, safeKeywords, changes, analysis),
  }));

const removeUnsafeMissingFromSkills = (
  skillsAwards: SkillsAwards,
  skippedMissingKeywords: string[],
): SkillsAwards => {
  if (!skippedMissingKeywords.length) return skillsAwards;

  const missingKeys = new Set(skippedMissingKeywords.map(canonical));
  const safe = (value: string) =>
    splitLines(value)
      .filter((item) => !missingKeys.has(canonical(item)))
      .join('\n');

  return {
    technicalSkills: safe(skillsAwards.technicalSkills),
    languages: safe(skillsAwards.languages),
    trainingCertifications: safe(skillsAwards.trainingCertifications),
    awards: safe(skillsAwards.awards),
  };
};

export const optimizeResumeForJob = ({
  resume,
  analysis,
}: OptimizeResumeForJobInput): OptimizeResumeForJobResult => {
  const changes: TailoringChange[] = [];
  const safeKeywords = getSafeJdKeywords(analysis);
  const skippedMissingKeywords = getSkippedMissingKeywords(analysis);

  const optimizedSkills = buildSkillsAwards(
    removeUnsafeMissingFromSkills(resume.skillsAwards, skippedMissingKeywords),
    safeKeywords,
    changes,
  );

  return {
    resume: {
      ...resume,
      experience: optimizeExperience(resume.experience, safeKeywords, changes, analysis),
      skillsAwards: optimizedSkills,
    },
    changes,
    usedKeywords: safeKeywords,
    skippedMissingKeywords,
  };
};
