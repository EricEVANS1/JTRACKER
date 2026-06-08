// src/lib/resumeTailoring.ts
// Safe deterministic tailoring for Resume Builder.
// This file only optimizes:
// - Experience bullet points
// - Skills & competencies
//
// It does not touch layout, personal information, education, projects, save, or export.
// It does not add missing_keywords automatically.

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

type ExperienceItem = {
  id: string;
  jobTitle: string;
  company: string;
  location: string;
  years: string;
  bullets: string[];
};

type SkillsAwards = {
  technicalSkills: string;
  languages: string;
  trainingCertifications: string;
  awards: string;
};

type ResumeBuilderState = {
  personal: unknown;
  summary: string;
  experience: ExperienceItem[];
  education: unknown[];
  projects: unknown[];
  skillsAwards: SkillsAwards;
  customSections: unknown[];
  sectionVisibility: unknown;
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

  return unique([...directKeywords, ...evidenceKeywords, ...extendedEvidence]);
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
  };
};

const improveBulletLightly = (
  bullet: string,
  safeKeywords: string[],
  roleUsage: Record<string, number>,
): { bullet: string; reason?: string } => {
  const value = clean(bullet);
  if (!value || isFragmentBullet(value)) return { bullet };

  const bucket = keywordBucket(safeKeywords);

  // Each role can receive each enhancement once only.
  if (
    SUPPORT_CONTEXT_REGEX.test(value) &&
    bucket.hasIncident &&
    !hasPhrase(value, 'incident') &&
    (roleUsage.incident ?? 0) < 1
  ) {
    roleUsage.incident = (roleUsage.incident ?? 0) + 1;
    return {
      bullet: `${value.replace(/[.\s]+$/, '')}, supporting incident management.`,
      reason: 'Added one incident-management phrase based on matched JD evidence.',
    };
  }

  if (
    SUPPORT_CONTEXT_REGEX.test(value) &&
    bucket.hasTroubleshooting &&
    !hasPhrase(value, 'troubleshooting') &&
    (roleUsage.troubleshooting ?? 0) < 1
  ) {
    roleUsage.troubleshooting = (roleUsage.troubleshooting ?? 0) + 1;
    return {
      bullet: `${value.replace(/[.\s]+$/, '')}, using structured troubleshooting.`,
      reason: 'Added one troubleshooting phrase based on matched JD evidence.',
    };
  }

  if (
    SUPPORT_CONTEXT_REGEX.test(value) &&
    bucket.hasSla &&
    !hasPhrase(value, 'sla') &&
    (roleUsage.sla ?? 0) < 1
  ) {
    roleUsage.sla = (roleUsage.sla ?? 0) + 1;
    return {
      bullet: `${value.replace(/[.\s]+$/, '')}, supporting SLA-focused service delivery.`,
      reason: 'Added one SLA phrase based on matched JD evidence.',
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
      bullet: `${value.replace(/[.\s]+$/, '')}, supporting root cause analysis.`,
      reason: 'Added one root-cause phrase based on matched JD evidence.',
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
