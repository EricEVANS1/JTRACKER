// src/lib/resumeTailoring.ts
// Master-CV-first, JD-aware tailoring for Resume Builder.
//
// Improvements in this version:
//  1. Inline rewrite mode — signals can rewrite the action verb + object, not just append
//  2. Claimable gaps output — missing keywords provable from CV content surfaced to UI
//  3. Trim-before-discard on 240-char limit — shortens base before giving up on improvement
//  4. Recency-weighted bullet caps — recent roles get more bullet budget
//  5. Expanded action verb upgrade list — covers the most common CV undervaluation patterns
//  6. Bullet splitting — long bullets with two independent clauses become two bullets
//  7. Skill synonym collapse — prevents "JS" and "JavaScript" coexisting
//  8. Self-consistent already-tailored guard — uses live SignalCandidate.isPresent checks
//  9. jdSignalStrength tracking — explicit vs inferred signals, reduces false medium flags
// 10. Static already-tailored guard — catches old tailored phrases even if the new JD lacks that signal
// 11. Signal keyword map — improves risk scoring and signal-strength detection
// 12. Rewrite quality validator — blocks broken inline rewrites before review

import type {
  ExperienceItem,
  ResumeBuilderState,
  SkillsAwards,
} from '../types/resumeBuilder';

// ============================================================
// Public types
// ============================================================

export type TailoringChangeType =
  | 'bullet_optimized'
  | 'bullet_rewritten'
  | 'bullet_split'
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
  riskLevel?: 'safe' | 'medium' | 'not_recommended';
  evidenceSource?: string;
  jdSignal?: string;
  jdSignalStrength?: 'explicit' | 'inferred'; // #9
};

/** A missing keyword that the CV text can plausibly support. */
export type ClaimableGap = {
  keyword: string;
  evidence: string;  // e.g. "Google Cloud → Support Engineer → Bullet 2"
  suggestion: string;
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
  claimableGaps: ClaimableGap[]; // #2
};

// ============================================================
// Regexes
// ============================================================

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

// ============================================================
// Types
// ============================================================

type RiskLevel = 'safe' | 'medium' | 'not_recommended';
type RewriteStrategy = 'inline' | 'append'; // #1

type TailoringSignal =
  | 'applicationSupport'
  | 'troubleshooting'
  | 'ticketing'
  | 'escalation'
  | 'documentation'
  | 'sla'
  | 'monitoring'
  | 'rootCause'
  | 'customerCommunication'
  | 'collaboration'
  | 'serviceStability'
  | 'processImprovement';

type SignalCandidate = {
  signal: TailoringSignal;
  phrase: string;
  /** For inline mode: the rewritten action clause to inject at the start. */
  inlineRewrite?: string; // #1
  rewriteStrategy: RewriteStrategy; // #1
  reason: string;
  priority: number;
  requiresContext: (bullet: string, role: ExperienceItem) => boolean;
  isPresent: (bullet: string) => boolean;
  riskLevel: RiskLevel;
};

const SIGNAL_KEYWORDS: Record<TailoringSignal, RegExp[]> = {
  applicationSupport: [/application support/i, /application/i, /production application/i],
  troubleshooting: [/troubleshoot/i, /diagnos/i, /technical support/i, /issue resolution/i],
  ticketing: [/ticket/i, /jira/i, /zendesk/i, /servicenow/i, /case management/i],
  escalation: [/escalat/i, /engineering team/i, /cross-functional/i, /high-impact/i],
  documentation: [/document/i, /case notes/i, /knowledge base/i, /runbook/i, /handover/i],
  sla: [/sla/i, /service level/i, /timely/i, /follow-up/i],
  monitoring: [/monitor/i, /log/i, /observability/i, /alert/i, /metric/i],
  rootCause: [/root cause/i, /rca/i, /problem management/i, /repeat-issue/i],
  customerCommunication: [/customer/i, /client/i, /communication/i, /stakeholder/i],
  collaboration: [/collaborat/i, /cross-functional/i, /engineering/i, /vendor/i, /product team/i],
  serviceStability: [/stability/i, /availability/i, /reliability/i, /performance/i],
  processImprovement: [/process improvement/i, /automation/i, /workflow/i, /efficien/i],
};

// ============================================================
// Skill synonym map (#7)
// ============================================================

const SKILL_SYNONYMS: Record<string, string> = {
  'js':                'JavaScript',
  'javascript':        'JavaScript',
  'ts':                'TypeScript',
  'typescript':        'TypeScript',
  'node':              'Node.js',
  'nodejs':            'Node.js',
  'node.js':           'Node.js',
  'postgres':          'PostgreSQL',
  'postgresql':        'PostgreSQL',
  'ms office':         'Microsoft 365',
  'office 365':        'Microsoft 365',
  'microsoft office':  'Microsoft 365',
  'ms 365':            'Microsoft 365',
  'microsoft 365':     'Microsoft 365',
  'o365':              'Microsoft 365',
  'mssql':             'SQL Server',
  'microsoft sql':     'SQL Server',
  'ad':                'Active Directory',
  'k8s':               'Kubernetes',
  'gh':                'GitHub',
  'vscode':            'VS Code',
  'visual studio code':'VS Code',
  'py':                'Python',
  'reactjs':           'React',
  'react.js':          'React',
  'vuejs':             'Vue.js',
  'vue':               'Vue.js',
  'gcp':               'Google Cloud',
  'google cloud platform': 'Google Cloud',
  'aws':               'AWS',
  'amazon web services': 'AWS',
  'azure':             'Azure',
  'microsoft azure':   'Azure',
};

const resolveSkillSynonym = (value: string): string => {
  const key = value.toLowerCase().trim();
  return SKILL_SYNONYMS[key] ?? value;
};

// ============================================================
// String utilities
// ============================================================

const clean = (value: unknown): string =>
  String(value ?? '')
    .replace(/^[-•]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();

const capitaliseBulletStart = (value: string): string => {
  const cleaned = clean(value);
  if (!cleaned) return '';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
};

const normaliseBulletSentence = (value: string): string => {
  let cleaned = capitaliseBulletStart(value);
  if (!cleaned) return '';

  cleaned = cleaned
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/([,.;:])\1+/g, '$1')
    .replace(/\.\s*,/g, ',')
    .replace(/\.\s+(and|or|but)\b/gi, ' $1')
    .replace(/,\s*\./g, '.')
    .replace(/\s+/g, ' ')
    .trim();

  cleaned = cleaned.replace(/[.\s]+$/, '');
  return `${cleaned}.`;
};

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
  values
    .map((v) => resolveSkillSynonym(clean(v))) // #7: synonym collapse before dedup
    .filter(Boolean)
    .forEach((value) => {
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

// ============================================================
// Analysis helpers
// ============================================================

const getJobDescription = (analysis?: AnalysisRecordLike | null): string =>
  String(
    analysis?.job_description ??
      analysis?.jobDescription ??
      analysis?.extended_data?.job_description ??
      analysis?.extended_data?.jobDescription ??
      '',
  );

const JD_SIGNAL_PATTERNS: Array<[RegExp, string]> = [
  [/\b(jira|ticketing|tickets?)\b/i,                                                  'ticketing'],
  [/\b(service\s*now|servicenow)\b/i,                                                  'ServiceNow'],
  [/\b(zendesk)\b/i,                                                                   'Zendesk'],
  [/\b(sla|service level agreement)\b/i,                                               'SLA'],
  [/\b(incident management|incident response|incidents?)\b/i,                          'incident management'],
  [/\b(problem management|root cause|rca|root-cause)\b/i,                              'root cause analysis'],
  [/\b(troubleshoot|troubleshooting|diagnos(?:e|is|tic))\b/i,                          'troubleshooting'],
  [/\b(log analysis|logs?|splunk|monitoring|observability)\b/i,                        'monitoring and log analysis'],
  [/\b(escalat(?:e|ion)|engineering team|bug report|defect)\b/i,                       'escalation'],
  [/\b(document(?:ation)?|knowledge base|case notes|runbook)\b/i,                      'documentation'],
  [/\b(api|postman|rest)\b/i,                                                          'API testing'],
  [/\b(sql|database|query)\b/i,                                                        'SQL'],
  [/\b(linux|red hat|rhel|ubuntu|windows|operating systems?)\b/i,                     'operating systems'],
  [/\b(customer|client|stakeholder|b2b|partner|reseller|end customer)\b/i,             'customer communication'],
  [/\b(quality assurance|qa|testing|test cases?|regression|uat)\b/i,                   'testing'],
  [/\b(process improvement|automation|workflow|efficien(?:cy|t))\b/i,                  'process improvement'],
  [/\b(application support|business applications?|production applications?)\b/i,       'application support'],
  [/\b(access|video|cctv|security product|surveillance)\b/i,                           'technical product support'],
  [/\b(stability|performance|availability|reliability)\b/i,                            'stability and performance'],
  [/\b(collaborat(?:e|ion)|cross-functional|developers?|engineering)\b/i,              'cross-functional collaboration'],
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

/** #9: returns keywords with their signal strength */
type KeywordWithStrength = {
  keyword: string;
  strength: 'explicit' | 'inferred';
};

const getSafeJdKeywordsWithStrength = (
  analysis?: AnalysisRecordLike | null,
): KeywordWithStrength[] => {
  if (!analysis) return [];

  const explicit: string[] = [
    ...splitLines(analysis.matched_keywords),
    ...splitLines(analysis.partial_keywords),
    ...(Array.isArray(analysis.ats_keyword_evidence)
      ? analysis.ats_keyword_evidence
          .filter((item) => item?.status === 'matched' || item?.status === 'partial')
          .map((item) => clean(item?.keyword))
          .filter(Boolean)
      : []),
    ...(Array.isArray(analysis.extended_data?.ats_keyword_evidence)
      ? analysis.extended_data.ats_keyword_evidence
          .filter((item: any) => item?.status === 'matched' || item?.status === 'partial')
          .map((item: any) => clean(item?.keyword))
          .filter(Boolean)
      : []),
  ];

  const inferred = extractJdSignalsFromText(getJobDescription(analysis));

  const explicitSet = new Set(explicit.map(canonical));

  const all: KeywordWithStrength[] = [
    ...unique(explicit).map((keyword) => ({ keyword, strength: 'explicit' as const })),
    ...unique(inferred)
      .filter((keyword) => !explicitSet.has(canonical(keyword)))
      .map((keyword) => ({ keyword, strength: 'inferred' as const })),
  ];

  return all;
};



const getStrengthForSignal = (
  signal: TailoringSignal,
  keywords: KeywordWithStrength[],
): 'explicit' | 'inferred' => {
  const patterns = SIGNAL_KEYWORDS[signal] ?? [];

  const explicitMatch = keywords.some(({ keyword, strength }) => {
    return strength === 'explicit' && patterns.some((pattern) => pattern.test(keyword));
  });

  if (explicitMatch) return 'explicit';

  const inferredMatch = keywords.some(({ keyword, strength }) => {
    return strength === 'inferred' && patterns.some((pattern) => pattern.test(keyword));
  });

  return inferredMatch ? 'inferred' : 'inferred';
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

// ============================================================
// #2: Claimable gaps
// ============================================================

const CLAIMABLE_PROXIMITY_MAP: Array<{
  keyword: RegExp;
  evidencePattern: RegExp;
  suggestion: string;
}> = [
  {
    keyword: /\bsql\b/i,
    evidencePattern: /\b(database|query|queries|db|data|report|reporting|records)\b/i,
    suggestion: 'Consider adding SQL to skills if you ran or wrote database queries in this role.',
  },
  {
    keyword: /\bpython\b/i,
    evidencePattern: /\b(script|automat|data|report|tool|process)\b/i,
    suggestion: 'Consider adding Python if you used scripts or automation tools.',
  },
  {
    keyword: /\bjira\b/i,
    evidencePattern: /\b(ticket|track|issue|case|workflow|sprint|agile|kanban)\b/i,
    suggestion: 'Consider adding Jira to skills if you tracked issues or tickets using any tool.',
  },
  {
    keyword: /\bmonitoring\b/i,
    evidencePattern: /\b(alert|metric|dashboard|log|performance|uptime|incident|observe)\b/i,
    suggestion: 'Consider adding monitoring tools (e.g. Datadog, Splunk) if you reviewed system health.',
  },
  {
    keyword: /\broot cause analysis\b/i,
    evidencePattern: /\b(recurring|repeat|investig|analy[sz]|post.mortem|prevent|improve)\b/i,
    suggestion: 'Consider mentioning root cause analysis if you investigated recurring issues.',
  },
  {
    keyword: /\bactive directory\b/i,
    evidencePattern: /\b(user account|access|permiss|password|provisioning|ldap|ad)\b/i,
    suggestion: 'Consider adding Active Directory if you managed user accounts or access rights.',
  },
  {
    keyword: /\bservice now\b|servicenow/i,
    evidencePattern: /\b(ticket|itsm|incident|service desk|request|change management)\b/i,
    suggestion: 'Consider adding ServiceNow if you used an ITSM platform for ticket management.',
  },
  {
    keyword: /\blinux\b/i,
    evidencePattern: /\b(server|terminal|command|bash|shell|rhel|ubuntu|red hat|unix)\b/i,
    suggestion: 'Consider adding Linux if you used the command line or managed Linux servers.',
  },
  {
    keyword: /\bapi\b/i,
    evidencePattern: /\b(endpoint|rest|http|request|integration|postman|webhook)\b/i,
    suggestion: 'Consider adding API troubleshooting to skills if you worked with API integrations.',
  },
  {
    keyword: /\bdocumentation\b/i,
    evidencePattern: /\b(process|procedure|runbook|knowledge|guide|wiki|note|case)\b/i,
    suggestion: 'Consider adding documentation to skills if you wrote guides, runbooks, or case notes.',
  },
];

const buildClaimableGaps = (
  missingKeywords: string[],
  experience: ExperienceItem[],
): ClaimableGap[] => {
  if (!missingKeywords.length) return [];

  const gaps: ClaimableGap[] = [];

  for (const keyword of missingKeywords) {
    const rule = CLAIMABLE_PROXIMITY_MAP.find(({ keyword: pattern }) =>
      pattern.test(keyword),
    );
    if (!rule) continue;

    // Search all bullets across all roles for proximity evidence
    for (const role of experience) {
      for (let bIdx = 0; bIdx < (role.bullets?.length ?? 0); bIdx++) {
        const bullet = clean(role.bullets![bIdx]);
        if (rule.evidencePattern.test(bullet)) {
          gaps.push({
            keyword: clean(keyword),
            evidence: `${role.company ?? 'Unknown company'} → ${role.jobTitle ?? 'Role'} → Bullet ${bIdx + 1}`,
            suggestion: rule.suggestion,
          });
          break; // one evidence source per keyword is enough
        }
      }

      // Break outer loop once we have evidence for this keyword
      if (gaps.some((g) => canonical(g.keyword) === canonical(keyword))) break;
    }
  }

  return gaps;
};

// ============================================================
// Classification
// ============================================================

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

// ============================================================
// Skills section builder
// ============================================================

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

  // #7: synonym collapse happens inside unique()
  const technical     = unique([...existing.technical, ...jdBuckets.technical]);
  const languages     = unique([...existing.languages, ...jdBuckets.languages]);
  const certifications = unique([...existing.certifications, ...jdBuckets.certifications]);
  const awards        = unique([...existing.awards, ...jdBuckets.awards]);

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

// ============================================================
// Fragment detection & merging
// ============================================================

const startsLikeContinuation = (value: string): boolean =>
  /^(and|or|but|system|systems|software|hardware|connectivity|network|application|applications|resulting|reducing|offering|using|while|with|for|to|in|of|by|through|ensuring|sharing|phone)\b/i.test(value);

const endsLikeIncomplete = (value: string): boolean =>
  /(,\s*|\band\b|\bor\b|\bfor\b|\bwith\b|\bof\b|\bto\b|\bin\b|\busing\b|\bcomplex software\b|\bsoftware\b|\bhardware\b|\bos\b|\bsystem\b|\bsystems\b)$/i.test(
    value.replace(/[.\s]+$/, ''),
  );

const isVeryShortFragment = (value: string): boolean => {
  const cleaned = clean(value);
  const wordCount = cleaned.split(/\s+/).filter(Boolean).length;
  return cleaned.length < 45 || wordCount <= 5;
};

const shouldMergeBulletFragment = (
  previous: string | undefined,
  current: string,
): boolean => {
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
  const cur  = clean(current).replace(/^[.\s]+/, '');
  if (!prev) return normaliseBulletSentence(cur);
  if (!cur)  return normaliseBulletSentence(prev);
  if (/^(and|or|but)\b/i.test(cur))
    return normaliseBulletSentence(`${prev} ${cur}`);
  if (/^(resulting|reducing|offering|using|while|with|through|by|ensuring)\b/i.test(cur))
    return normaliseBulletSentence(`${prev}, ${cur}`);
  return normaliseBulletSentence(`${prev}, ${cur}`);
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
        roleId:     role.id,
        roleTitle:  role.jobTitle,
        company:    role.company,
        bulletIndex: Math.max(0, normalized.length - 1),
        before: `${previous}\n${bullet}`,
        after:  merged,
        reason: `Merged broken bullet fragment from original bullet ${idx + 1}.`,
        riskLevel: 'safe',
        evidenceSource: buildEvidenceSource(role, idx),
      });
      return;
    }

    normalized.push(normaliseBulletSentence(bullet));
  });

  return normalized;
};

// ============================================================
// #6: Bullet splitting
// ============================================================

const SPLIT_DELIMITERS = /;\s+|,\s+(?:and|while|also)\s+/i;

const splitLongBullet = (bullet: string): string[] => {
  const value = clean(bullet);
  if (value.length < 120) return [value]; // not long enough to bother

  const parts = value.split(SPLIT_DELIMITERS);
  if (parts.length < 2) return [value];

  const valid = parts
    .map((p) => clean(p))
    .filter((p) => p.length >= 40 && !startsLikeContinuation(p));

  if (valid.length < 2) return [value];

  return valid.map(normaliseBulletSentence);
};

// ============================================================
// #3: Trim-before-discard
// ============================================================

const trimBaseForAppend = (text: string, maxLen: number): string => {
  if (text.length <= maxLen) return text;

  // Drop trailing "and X" / "as well as Y" / "including Y" / "such as Y" clauses
  const shortened = text.replace(
    /,?\s+(and|as well as|including|such as|along with|whilst)[^.]+\.$/i,
    '.',
  );

  if (shortened.length <= maxLen) return shortened;

  // Last resort: hard truncate at word boundary
  return text.slice(0, maxLen).replace(/\s+\S*$/, '').trim();
};

// ============================================================
// Signal catalogue
// ============================================================

const isFragmentBullet = (bullet: string): boolean => {
  const value = clean(bullet);
  if (!value) return true;
  return isVeryShortFragment(value) && startsLikeContinuation(value);
};

const keywordBucket = (safeKeywords: string[], jobDescription = '') => {
  const source = `${safeKeywords.join(' ')} ${jobDescription}`;
  const has = (patterns: RegExp[]) => patterns.some((p) => p.test(source));

  return {
    hasTicketing:            has([/\bjira\b/i, /\bzendesk\b/i, /\bservicenow\b/i, /\bticket/i]),
    hasIncident:             has([/\bincident\b/i, /\bincident management\b/i]),
    hasSla:                  has([/\bsla\b/i, /\bservice level/i]),
    hasTroubleshooting:      has([/\btroubleshooting\b/i, /\btechnical support\b/i, /\bdiagnos/i]),
    hasRootCause:            has([/\broot cause/i, /\banalysis\b/i, /\brca\b/i]),
    hasDocumentation:        has([/\bdocument/i, /\bknowledge base/i, /\bcase notes/i, /\brunbook/i]),
    hasEscalation:           has([/\bescalat/i, /\bbug/i, /\bengineering team/i, /\bdefect/i]),
    hasMonitoring:           has([/\bmonitoring\b/i, /\blog analysis\b/i, /\blogs?\b/i, /\bsplunk\b/i, /\bobservability\b/i]),
    hasCustomer:             has([/\bcustomer\b/i, /\bclient\b/i, /\bstakeholder\b/i, /\bb2b\b/i, /\bpartner\b/i, /\breseller\b/i]),
    hasTesting:              has([/\btesting\b/i, /\bqa\b/i, /\btest cases?\b/i, /\bregression\b/i, /\buat\b/i]),
    hasApplicationSupport:   has([/\bapplication support\b/i, /\bbusiness applications?\b/i, /\bproduction applications?\b/i]),
    hasPerformance:          has([/\bperformance\b/i, /\bstability\b/i, /\bavailability\b/i, /\breliability\b/i]),
    hasCustomerCommunication:has([/\bcommunicat/i, /\bcustomer\b/i, /\bclient\b/i, /\bstakeholder\b/i, /\bpartner\b/i]),
    hasCollaboration:        has([/\bcollaborat/i, /\bcross-functional\b/i, /\bengineering team\b/i, /\bdeveloper/i]),
    hasProcessImprovement:   has([/\bprocess improvement\b/i, /\bautomation\b/i, /\bworkflow\b/i, /\befficien/i]),
  };
};

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
    /\bconnectivity\b/i,
    /\bos\b/i,
  ]);

const getSignalCandidates = (
  safeKeywords: string[],
  jobDescription: string,
  role: ExperienceItem,
): SignalCandidate[] => {
  const bucket = keywordBucket(safeKeywords, jobDescription);
  const isTechRole = roleLooksTechnical(role);
  const candidates: SignalCandidate[] = [];

  if (bucket.hasApplicationSupport) {
    candidates.push({
      signal:          'applicationSupport',
      phrase:          'supporting application issue investigation and resolution',
      inlineRewrite:   'Investigated and resolved application issues',    // #1
      rewriteStrategy: 'inline',
      reason: 'Reframed as application support because the Master CV bullet already describes technical issue handling.',
      priority: 1,
      requiresContext: (bullet) => SUPPORT_CONTEXT_REGEX.test(bullet) && isTechRole,
      isPresent: (bullet) =>
        hasPhrase(bullet, 'application') ||
        hasPhrase(bullet, 'issue investigation') ||
        hasPhrase(bullet, 'application support'),
      riskLevel: 'safe',
    });
  }

  if (bucket.hasTroubleshooting) {
    candidates.push({
      signal:          'troubleshooting',
      phrase:          'using structured troubleshooting to diagnose user and system issues',
      inlineRewrite:   'Applied structured troubleshooting to diagnose and resolve',
      rewriteStrategy: 'inline',
      reason: 'Added structured troubleshooting language because the Master CV bullet already describes support, diagnosis, or issue resolution.',
      priority: 2,
      requiresContext: (bullet) =>
        /diagnos|investigat|resolve|resolved|issue|problem|error|bug|support|troubleshoot/i.test(bullet),
      isPresent: (bullet) =>
        hasPhrase(bullet, 'troubleshooting') ||
        hasPhrase(bullet, 'diagnos') ||
        hasPhrase(bullet, 'structured troubleshooting'),
      riskLevel: 'safe',
    });
  }

  if (bucket.hasTicketing) {
    candidates.push({
      signal:          'ticketing',
      phrase:          'documenting and tracking support cases through ticketing workflows',
      rewriteStrategy: 'append',
      reason: 'Added ticketing workflow language because the Master CV bullet already describes case handling, support queues, or issue tracking.',
      priority: 3,
      requiresContext: (bullet) =>
        /ticket|case|track|workflow|queue|priority|support|issue|request/i.test(bullet),
      isPresent: (bullet) =>
        hasPhrase(bullet, 'ticket') ||
        hasPhrase(bullet, 'workflow') ||
        hasPhrase(bullet, 'jira') ||
        hasPhrase(bullet, 'zendesk') ||
        hasPhrase(bullet, 'support cases'),
      riskLevel: 'safe',
    });
  }

  if (bucket.hasEscalation) {
    candidates.push({
      signal:          'escalation',
      phrase:          'owning the escalation pathway for high-impact cases requiring cross-functional triage',
      inlineRewrite:   'Owned escalation of high-impact cases to cross-functional teams',
      rewriteStrategy: 'inline',
      reason: 'Reframed escalation as case ownership because the Master CV bullet supports complex support or incident handling.',
      priority: 4,
      requiresContext: (bullet) =>
        /complex|critical|senior|high-impact|escalat|incident|issue|support|resolve|resolved/i.test(bullet),
      isPresent: (bullet) =>
        hasPhrase(bullet, 'escalat') ||
        hasPhrase(bullet, 'cross-functional triage') ||
        hasPhrase(bullet, 'high-impact cases'),
      riskLevel: 'safe',
    });
  }

  if (bucket.hasDocumentation) {
    candidates.push({
      signal:          'documentation',
      phrase:          'maintaining clear case documentation and handover notes for consistent follow-up',
      rewriteStrategy: 'append',
      reason: 'Added one documentation-focused clause because the Master CV bullet supports support process ownership.',
      priority: 5,
      requiresContext: (bullet) =>
        /maintain|document|case|process|knowledge|handover|support|issue|training|best practices/i.test(bullet),
      isPresent: (bullet) =>
        hasPhrase(bullet, 'document') ||
        hasPhrase(bullet, 'case note') ||
        hasPhrase(bullet, 'handover') ||
        hasPhrase(bullet, 'knowledge'),
      riskLevel: 'safe',
    });
  }

  if (bucket.hasSla) {
    candidates.push({
      signal:          'sla',
      phrase:          'supporting SLA-focused service delivery and timely follow-up',
      rewriteStrategy: 'append',
      reason: 'Added SLA language because the Master CV bullet already describes service delivery, incident response, or resolution ownership.',
      priority: 6,
      requiresContext: (bullet) =>
        /sla|timely|response|resolution|deadline|metric|kpi|incident|support|service/i.test(bullet),
      isPresent: (bullet) =>
        hasPhrase(bullet, 'sla') ||
        hasPhrase(bullet, 'service level') ||
        hasPhrase(bullet, 'response time') ||
        hasPhrase(bullet, 'timely follow-up'),
      riskLevel: 'safe',
    });
  }

  if (bucket.hasMonitoring) {
    candidates.push({
      signal:          'monitoring',
      phrase:          'using monitoring signals to accelerate issue investigation and response',
      rewriteStrategy: 'append',
      reason: 'Added monitoring language because the Master CV bullet references metrics, incidents, alerts, or production issues.',
      priority: 7,
      requiresContext: (bullet) =>
        /monitor|metric|dashboard|alert|log|production|incident|observability|service/i.test(bullet),
      isPresent: (bullet) =>
        hasPhrase(bullet, 'monitoring') ||
        hasPhrase(bullet, 'log review') ||
        hasPhrase(bullet, 'observability') ||
        hasPhrase(bullet, 'monitoring signals'),
      riskLevel: 'safe',
    });
  }

  if (bucket.hasRootCause) {
    candidates.push({
      signal:          'rootCause',
      phrase:          'supporting root cause analysis and repeat-issue prevention',
      rewriteStrategy: 'append',
      reason: 'Added root-cause language because the Master CV bullet already describes recurring issue analysis or process improvement.',
      priority: 8,
      requiresContext: (bullet) =>
        /recurring|repeat|improve|improvement|process|analy[sz]e|investigat|prevent|incident|post-mortem|automation/i.test(bullet),
      isPresent: (bullet) =>
        hasPhrase(bullet, 'root cause') ||
        hasPhrase(bullet, 'rca') ||
        hasPhrase(bullet, 'repeat-issue') ||
        hasPhrase(bullet, 'prevention'),
      riskLevel: 'safe',
    });
  }

  if (bucket.hasCollaboration) {
    candidates.push({
      signal:          'collaboration',
      phrase:          'coordinating with cross-functional teams to move technical issues toward resolution',
      inlineRewrite:   'Coordinated with cross-functional engineering and product teams to resolve',
      rewriteStrategy: 'inline',
      reason: 'Added collaboration language because the Master CV bullet supports team-based technical issue resolution.',
      priority: 9,
      requiresContext: (bullet) =>
        /team|collaborat|engineering|vendor|operation|product|stakeholder|support|issue|resolve/i.test(bullet),
      isPresent: (bullet) =>
        hasPhrase(bullet, 'collaborat') ||
        hasPhrase(bullet, 'cross-functional') ||
        hasPhrase(bullet, 'engineering team'),
      riskLevel: 'safe',
    });
  }

  if (bucket.hasCustomerCommunication) {
    candidates.push({
      signal:          'customerCommunication',
      phrase:          'translating technical updates into clear customer-facing communication',
      rewriteStrategy: 'append',
      reason: 'Added customer-communication language because the Master CV bullet supports direct customer or stakeholder interaction.',
      priority: 10,
      requiresContext: (bullet) =>
        /customer|client|communicat|email|chat|phone|stakeholder|expectation|cultural|satisfaction/i.test(bullet),
      isPresent: (bullet) =>
        hasPhrase(bullet, 'communication') ||
        hasPhrase(bullet, 'customer-facing') ||
        hasPhrase(bullet, 'technical updates'),
      riskLevel: 'safe',
    });
  }

  if (bucket.hasPerformance) {
    candidates.push({
      signal:          'serviceStability',
      phrase:          'contributing to service stability through fast investigation and follow-up',
      rewriteStrategy: 'append',
      reason: 'Added service-stability language because the Master CV bullet supports incident response, monitoring, or reliability work.',
      priority: 11,
      requiresContext: (bullet) =>
        /incident|monitor|metric|stability|performance|availability|reliability|issue|service/i.test(bullet),
      isPresent: (bullet) =>
        hasPhrase(bullet, 'stability') ||
        hasPhrase(bullet, 'availability') ||
        hasPhrase(bullet, 'reliability'),
      riskLevel: 'safe',
    });
  }

  if (bucket.hasProcessImprovement) {
    candidates.push({
      signal:          'processImprovement',
      phrase:          'strengthening support workflows through process improvement and automation thinking',
      rewriteStrategy: 'append',
      reason: 'Added process-improvement language because the Master CV bullet supports recurring issue analysis, improvement, or automation work.',
      priority: 12,
      requiresContext: (bullet) =>
        /process|improve|improvement|automation|workflow|recurring|repeat|efficien/i.test(bullet),
      isPresent: (bullet) =>
        hasPhrase(bullet, 'process improvement') ||
        hasPhrase(bullet, 'automation') ||
        hasPhrase(bullet, 'workflow'),
      riskLevel: 'safe',
    });
  }

  return candidates.sort((a, b) => a.priority - b.priority);
};

// ============================================================
// Signal usage guards
// ============================================================

const canUseSignal = (
  roleUsage: Record<string, number>,
  globalUsage: Record<string, number>,
  signal: TailoringSignal,
): boolean =>
  (roleUsage[signal] ?? 0) === 0 && (globalUsage[signal] ?? 0) === 0;

const markSignalUsed = (
  roleUsage: Record<string, number>,
  globalUsage: Record<string, number>,
  signal: TailoringSignal,
) => {
  roleUsage[signal]  = (roleUsage[signal]  ?? 0) + 1;
  globalUsage[signal] = (globalUsage[signal] ?? 0) + 1;
};

// ============================================================
// Evidence source helper
// ============================================================

const buildEvidenceSource = (role: ExperienceItem, bulletIndex: number): string => {
  const company = role.company  ?? 'Unknown company';
  const title   = role.jobTitle ?? 'Experience role';
  return `Master CV → ${company} → ${title} → Bullet ${bulletIndex + 1}`;
};

// ============================================================
// #5: Expanded action verb upgrades
// ============================================================

const actionVerbUpgrade = (value: string): string => {
  const trimmed = clean(value);
  const replacements: Array<[RegExp, string]> = [
    // Original set
    [/^handled\b/i,               'Managed'],
    [/^helped\b/i,                'Supported'],
    [/^worked on\b/i,             'Contributed to'],
    [/^did\b/i,                   'Completed'],
    [/^was responsible for\b/i,   'Owned'],
    [/^dealt with\b/i,            'Resolved'],
    [/^talked to\b/i,             'Communicated with'],
    [/^answered\b/i,              'Responded to'],
    [/^fixed\b/i,                 'Resolved'],
    [/^checked\b/i,               'Investigated'],
    // #5: Expanded set
    [/^assisted with\b/i,          'Supported'],
    [/^assisted in\b/i,            'Contributed to'],
    [/^was involved in\b/i,        'Contributed to'],
    [/^participated in\b/i,        'Contributed to'],
    [/^helped to\b/i,              ''],          // strip "helped to" → use root verb
    [/^tried to\b/i,               ''],          // strip "tried to"
    [/^liaised with\b/i,           'Coordinated with'],
    [/^provided support\b/i,       'Delivered support for'],
    [/^provided support to\b/i,    'Supported'],
    [/^gave support\b/i,           'Provided support for'],
    [/^made sure\b/i,              'Ensured'],
    [/^ensured that\b/i,           'Ensured'],
    [/^took care of\b/i,           'Managed'],
    [/^took ownership of\b/i,      'Owned'],
    [/^performed\b/i,              'Executed'],
    [/^carried out\b/i,            'Executed'],
    [/^was tasked with\b/i,        'Delivered'],
    [/^was asked to\b/i,           'Delivered'],
    [/^played a role in\b/i,       'Contributed to'],
    [/^played a key role in\b/i,   'Led'],
    [/^supported in\b/i,           'Assisted with'],
    [/^acted as\b/i,               'Served as'],
    [/^used\b/i,                   'Leveraged'],
    [/^looked after\b/i,           'Managed'],
    [/^looked into\b/i,            'Investigated'],
  ];

  for (const [pattern, replacement] of replacements) {
    if (pattern.test(trimmed)) {
      const upgraded = trimmed.replace(pattern, replacement).trim();
      // If replacement is empty (e.g. "helped to"), capitalise whatever follows
      return upgraded
        ? capitaliseBulletStart(upgraded)
        : capitaliseBulletStart(trimmed.replace(pattern, '').trim());
    }
  }

  return trimmed;
};

// ============================================================
// Repeated tailoring noise removal
// ============================================================

const removeRepeatedTailoringNoise = (value: string): string => {
  let output = clean(value);
  const noisyPhrases = [
    /,\s*using structured troubleshooting to diagnose user(?: and system)? issues/gi,
    /,\s*maintaining clear documentation(?:, case notes, and handover details| and case notes)?/gi,
    /,\s*escalating complex cases with clear context, impact, and troubleshooting history/gi,
    /,\s*documenting and tracking cases through structured ticketing workflows/gi,
    /,\s*supporting SLA-focused service delivery and timely follow-up/gi,
    /,\s*supporting application issue investigation and resolution/gi,
    /,\s*owning the escalation pathway for high-impact cases requiring cross-functional triage/gi,
    /,\s*using monitoring signals to accelerate issue investigation and response/gi,
    /,\s*supporting root cause analysis and repeat-issue prevention/gi,
    /,\s*contributing to service stability through fast investigation and follow-up/gi,
    /,\s*strengthening support workflows through process improvement and automation thinking/gi,
    /,\s*translating technical updates into clear customer-facing communication/gi,
    /,\s*coordinating with cross-functional teams to move technical issues toward resolution/gi,
    /,\s*maintaining clear case documentation and handover notes for consistent follow-up/gi,
    /,\s*documenting and tracking support cases through ticketing workflows/gi,
  ];
  noisyPhrases.forEach((pattern) => {
    output = output.replace(pattern, '');
  });
  return clean(output).replace(/[,\s]+$/, '');
};

// ============================================================
// #8: Self-consistent already-tailored guard
// ============================================================

const STATIC_TAILORED_PHRASE_REGEX =
  /\b(case documentation|handover notes|cross-functional triage|structured troubleshooting|ticketing workflows|root cause analysis|SLA-focused|monitoring signals|service stability|application issue investigation|high-impact cases|customer-facing communication|support workflows)\b/i;

const isAlreadyTailoredBullet = (
  bullet: string,
  candidates: SignalCandidate[],
): boolean =>
  STATIC_TAILORED_PHRASE_REGEX.test(bullet) ||
  candidates.some((candidate) => candidate.isPresent(bullet));

// ============================================================
// Core bullet improvement
// ============================================================

const appendPhrase = (value: string, phrase: string): string =>
  normaliseBulletSentence(`${value.replace(/[.\s]+$/, '')}, ${phrase}`);

const removeLeadingActionPhrase = (value: string): string => {
  const cleaned = clean(value).replace(/[.\s]+$/, '');

  const patterns = [
    /^Act(?:ed)? as\s+/i,
    /^Served as\s+/i,
    /^Delivered\s+/i,
    /^Provided\s+/i,
    /^Supported\s+/i,
    /^Managed\s+/i,
    /^Resolved\s+/i,
    /^Investigated\s+/i,
    /^Handled\s+/i,
    /^Monitored\s+/i,
    /^Maintained\s+/i,
    /^Coordinated\s+/i,
    /^Communicated\s+/i,
    /^Enhanced\s+/i,
    /^Analysed\s+/i,
    /^Analyzed\s+/i,
    /^Executed\s+/i,
    /^Leveraged\s+/i,
  ];

  for (const pattern of patterns) {
    if (pattern.test(cleaned)) {
      return clean(cleaned.replace(pattern, ''));
    }
  }

  return clean(cleaned.replace(/^[A-Z][a-z]+(?:\s+[a-z]+){0,2}\s+/i, ''));
};

const MAX_BULLET_LENGTH = 240;

const BAD_REWRITE_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\b(resolve|diagnose|investigate|support)\s+and\s+(and|internal|service|tools)\b/i,
    reason: 'Broken verb/object structure.',
  },
  {
    pattern: /\bteams\s+service\s+metrics\b/i,
    reason: 'Broken phrase: cross-functional teams service metrics.',
  },
  {
    pattern: /\bteams\s+(service|metrics|tools|issues|and)\b/i,
    reason: 'Broken phrase after cross-functional teams.',
  },
  {
    pattern: /\bresolve\s+(top-tier\s+)?customer support\b/i,
    reason: 'Invalid object: customer support cannot be resolved.',
  },
  {
    pattern: /\bresulting in\b.*?,\s*maintaining\b/i,
    reason: 'Awkward stacked clause after a result statement.',
  },
  {
    pattern: /\bto\s+cross-functional teams\s+(service|metrics|tools|issues)\b/i,
    reason: 'Broken escalation phrase.',
  },
  {
    pattern: /\b(resolve|diagnose|investigate)\s*\.?\s*and\b/i,
    reason: 'Duplicated connector after an action verb.',
  },
  {
    pattern: /\b(resolve|resolved|resolving)\s+(support|service delivery|communication)\b/i,
    reason: 'Invalid object for a resolution verb.',
  },
  {
    pattern: /\b(application issues|technical issues|support cases)\s+(and|for|with)\s+(and|internal|service|metrics)\b/i,
    reason: 'Broken object continuation.',
  },
];

const validateRewrittenBullet = (
  original: string,
  rewritten: string,
): { valid: boolean; reason?: string } => {
  const cleaned = normaliseBulletSentence(rewritten);

  if (!cleaned || cleaned.length < 35) {
    return { valid: false, reason: 'Rewrite is too short or empty.' };
  }

  if (cleaned.length > MAX_BULLET_LENGTH) {
    return { valid: false, reason: 'Rewrite is too long.' };
  }

  for (const rule of BAD_REWRITE_PATTERNS) {
    if (rule.pattern.test(cleaned)) {
      return { valid: false, reason: rule.reason };
    }
  }

  const originalWords = new Set(
    canonical(original)
      .split(' ')
      .filter((word) => word.length > 2),
  );

  const rewrittenWords = canonical(cleaned)
    .split(' ')
    .filter((word) => word.length > 2);

  const preservedWords = rewrittenWords.filter((word) => originalWords.has(word));
  const preservationRatio = preservedWords.length / Math.max(1, originalWords.size);

  if (originalWords.size >= 6 && preservationRatio < 0.35) {
    return {
      valid: false,
      reason: 'Rewrite changed too much of the original Master CV meaning.',
    };
  }

  return { valid: true };
};

const improveBullet = (
  bullet: string,
  role: ExperienceItem,
  safeKeywordsWithStrength: KeywordWithStrength[],
  roleUsage: Record<string, number>,
  globalUsage: Record<string, number>,
  bulletIndex: number,
  analysis?: AnalysisRecordLike | null,
): {
  bullet: string;
  reason?: string;
  jdSignal?: TailoringSignal;
  jdSignalStrength?: 'explicit' | 'inferred'; // #9
  riskLevel?: RiskLevel;
  evidenceSource?: string;
  changeType?: TailoringChangeType;
} => {
  const original = clean(bullet);
  if (!original) return { bullet: '' };

  const jdText    = getJobDescription(analysis);
  const safeKeywords = safeKeywordsWithStrength.map((k) => k.keyword);
  const candidates = getSignalCandidates(safeKeywords, jdText, role);

  // #8: self-consistent guard
  if (isAlreadyTailoredBullet(original, candidates)) {
    return { bullet: normaliseBulletSentence(original) };
  }

  const stripped  = removeRepeatedTailoringNoise(original);
  const baseText  = actionVerbUpgrade(stripped);

  if (!baseText || isFragmentBullet(baseText)) {
    return { bullet: normaliseBulletSentence(baseText) };
  }

  const availableCandidates = candidates.filter((candidate) => {
    const contextMatches   = candidate.requiresContext(baseText, role);
    const alreadyPresent   = candidate.isPresent(baseText);
    const availableGlobally = canUseSignal(roleUsage, globalUsage, candidate.signal);
    return contextMatches && !alreadyPresent && availableGlobally;
  });

  const selected = availableCandidates[0];

  if (!selected) {
    if (baseText !== original) {
      return {
        bullet: normaliseBulletSentence(baseText),
        reason: 'Cleaned repeated tailoring phrases while preserving the original Master CV fact.',
      };
    }
    return { bullet: normaliseBulletSentence(baseText) };
  }

  // #9: determine signal strength for this candidate using signal-specific keyword patterns.
  const keywordStrengthForSignal = getStrengthForSignal(
    selected.signal,
    safeKeywordsWithStrength,
  );

  // #1: inline rewrite vs append
  let rewritten: string;
  let changeType: TailoringChangeType = 'bullet_optimized';

  if (selected.rewriteStrategy === 'inline' && selected.inlineRewrite) {
    // Extract the object/complement from the original bullet.
    // We drop common leading action phrases and keep the factual object.
    const withoutVerb = removeLeadingActionPhrase(baseText);

    const candidate = `${selected.inlineRewrite} ${withoutVerb}`;
    const finalText = normaliseBulletSentence(candidate);

    // Only use inline rewrite if the result is clean, not too long, and passes quality validation.
    if (
      finalText.length <= MAX_BULLET_LENGTH &&
      withoutVerb.length >= 10 &&
      validateRewrittenBullet(original, finalText).valid
    ) {
      rewritten  = finalText;
      changeType = 'bullet_rewritten';
    } else {
      // Fall back to conservative append if inline rewrite is unsafe.
      const trimmed = trimBaseForAppend(baseText, MAX_BULLET_LENGTH - selected.phrase.length - 2);
      rewritten  = appendPhrase(trimmed, selected.phrase);
      changeType = 'bullet_optimized';
    }
  } else {
    // #3: trim base before deciding to discard
    const trimmed  = trimBaseForAppend(baseText, MAX_BULLET_LENGTH - selected.phrase.length - 2);
    rewritten  = appendPhrase(trimmed, selected.phrase);
  }

  // Hard cap — should rarely be reached after trimming
  if (rewritten.length > MAX_BULLET_LENGTH) {
    if (baseText !== original) {
      return {
        bullet: normaliseBulletSentence(baseText),
        reason: 'Cleaned action verb; result was too long for phrase injection.',
      };
    }
    return { bullet: normaliseBulletSentence(baseText) };
  }

  const validation = validateRewrittenBullet(original, rewritten);

  if (!validation.valid) {
    return {
      bullet: normaliseBulletSentence(baseText),
      reason: `Rejected unsafe rewrite: ${validation.reason}`,
      jdSignal: selected.signal,
      jdSignalStrength: keywordStrengthForSignal,
      riskLevel: 'not_recommended',
      evidenceSource: buildEvidenceSource(role, bulletIndex),
      changeType,
    };
  }

  markSignalUsed(roleUsage, globalUsage, selected.signal);

  // #9: risk level accounts for signal strength
  const directMatch = safeKeywordsWithStrength.some(
    ({ keyword, strength }) => strength === 'explicit' && canonical(original).includes(canonical(keyword)),
  );

  const riskLevel: RiskLevel =
    selected.riskLevel === 'safe' && directMatch
      ? 'safe'
      : selected.riskLevel === 'safe' && keywordStrengthForSignal === 'explicit'
        ? 'safe'
        : 'medium';

  return {
    bullet:            normaliseBulletSentence(rewritten),
    reason:            selected.reason,
    jdSignal:          selected.signal,
    jdSignalStrength:  keywordStrengthForSignal,
    riskLevel,
    evidenceSource:    buildEvidenceSource(role, bulletIndex),
    changeType,
  };
};

// ============================================================
// Deduplication
// ============================================================

const dedupeBullets = (
  role: ExperienceItem,
  bullets: string[],
  changes: TailoringChange[],
): string[] => {
  const seen   = new Set<string>();
  const output: string[] = [];

  bullets.map(clean).filter(Boolean).forEach((bullet, idx) => {
    const key = canonical(bullet);
    if (seen.has(key)) {
      changes.push({
        type:        'duplicate_removed',
        section:     'experience',
        roleId:      role.id,
        roleTitle:   role.jobTitle,
        company:     role.company,
        bulletIndex: idx,
        before:      bullet,
        reason:      'Removed a duplicate experience bullet.',
      });
      return;
    }
    seen.add(key);
    output.push(bullet);
  });

  return output;
};

// ============================================================
// #4: Recency-weighted bullet caps
// ============================================================

const maxBulletsForRole = (roleIndex: number, currentCount: number): number => {
  // Give recent roles more bullet budget; cap very old roles tightly
  const budgetByRecency = [8, 6, 5, 4, 3, 2];
  const recencyBudget   = budgetByRecency[Math.min(roleIndex, budgetByRecency.length - 1)];
  // Never expand beyond current count + 2 (e.g. via splits)
  return Math.min(recencyBudget, currentCount + 2);
};

// ============================================================
// Per-role optimiser
// ============================================================

const optimizeRoleBullets = (
  role: ExperienceItem,
  roleIndex: number, // #4
  safeKeywordsWithStrength: KeywordWithStrength[],
  changes: TailoringChange[],
  globalUsage: Record<string, number>,
  analysis?: AnalysisRecordLike | null,
): string[] => {
  const roleUsage: Record<string, number> = {};
  const cleanedBullets = normalizeBullets(role, changes);

  // #6: Split long bullets before improvement
  const splitBullets: string[] = [];
  cleanedBullets.forEach((bullet, idx) => {
    const parts = splitLongBullet(bullet);
    if (parts.length > 1) {
      parts.forEach((part, partIdx) => {
        changes.push({
          type:        'bullet_split',
          section:     'experience',
          roleId:      role.id,
          roleTitle:   role.jobTitle,
          company:     role.company,
          bulletIndex: idx,
          before:      bullet,
          after:       part,
          reason:      `Split long bullet into ${parts.length} shorter, more scannable points (part ${partIdx + 1}).`,
          riskLevel:   'safe',
          evidenceSource: buildEvidenceSource(role, idx),
        });
      });
      splitBullets.push(...parts);
    } else {
      splitBullets.push(bullet);
    }
  });

  const improvedBullets = splitBullets.map((bullet, index) => {
    const optimized = improveBullet(
      bullet,
      role,
      safeKeywordsWithStrength,
      roleUsage,
      globalUsage,
      index,
      analysis,
    );

    if (
      optimized.reason &&
      optimized.riskLevel !== 'not_recommended' &&
      optimized.bullet !== bullet
    ) {
      changes.push({
        type:              optimized.changeType ?? 'bullet_optimized',
        section:           'experience',
        roleId:            role.id,
        roleTitle:         role.jobTitle,
        company:           role.company,
        bulletIndex:       index,
        before:            bullet,
        after:             normaliseBulletSentence(optimized.bullet),
        reason:            optimized.reason,
        riskLevel:         optimized.riskLevel ?? 'safe',
        evidenceSource:    optimized.evidenceSource ?? buildEvidenceSource(role, index),
        jdSignal:          optimized.jdSignal,
        jdSignalStrength:  optimized.jdSignalStrength, // #9
      });
      return normaliseBulletSentence(optimized.bullet);
    }

    return normaliseBulletSentence(bullet);
  });

  const maxBullets = maxBulletsForRole(roleIndex, role.bullets?.length ?? 0); // #4

  return dedupeBullets(role, improvedBullets, changes)
    .map(normaliseBulletSentence)
    .slice(0, maxBullets);
};

// ============================================================
// Experience optimiser
// ============================================================

const optimizeExperience = (
  experience: ExperienceItem[],
  safeKeywordsWithStrength: KeywordWithStrength[],
  changes: TailoringChange[],
  analysis?: AnalysisRecordLike | null,
): ExperienceItem[] => {
  const globalUsage: Record<string, number> = {};

  return experience.map((role, roleIndex) => ({  // #4: pass index
    ...role,
    bullets: optimizeRoleBullets(
      role,
      roleIndex,
      safeKeywordsWithStrength,
      changes,
      globalUsage,
      analysis,
    ),
  }));
};

// ============================================================
// Missing keyword cleanup
// ============================================================

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
    technicalSkills:        safe(skillsAwards.technicalSkills),
    languages:              safe(skillsAwards.languages),
    trainingCertifications: safe(skillsAwards.trainingCertifications),
    awards:                 safe(skillsAwards.awards),
  };
};

// ============================================================
// Public entry point
// ============================================================

export const optimizeResumeForJob = ({
  resume,
  analysis,
}: OptimizeResumeForJobInput): OptimizeResumeForJobResult => {
  const changes: TailoringChange[] = [];

  // #9: build keywords with strength metadata
  const safeKeywordsWithStrength = getSafeJdKeywordsWithStrength(analysis);
  const safeKeywords             = safeKeywordsWithStrength.map((k) => k.keyword);
  const skippedMissingKeywords   = getSkippedMissingKeywords(analysis);

  // #2: surface provable claimable gaps before stripping them
  const claimableGaps = buildClaimableGaps(
    skippedMissingKeywords,
    resume.experience,
  );

  const optimizedSkills = buildSkillsAwards(
    removeUnsafeMissingFromSkills(resume.skillsAwards, skippedMissingKeywords),
    safeKeywords,
    changes,
  );

  return {
    resume: {
      ...resume,
      experience: optimizeExperience(
        resume.experience,
        safeKeywordsWithStrength,
        changes,
        analysis,
      ),
      skillsAwards: optimizedSkills,
    },
    changes,
    usedKeywords:           safeKeywords,
    skippedMissingKeywords,
    claimableGaps,          // #2
  };
};