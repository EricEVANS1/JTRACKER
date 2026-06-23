// src/lib/resumeTailoring.ts
// Master-CV-first, JD-aware tailoring for Resume Builder.
//
// Version history:
//  v1  (#1-#9)   Inline rewrite, claimable gaps, trim-before-discard, recency caps,
//                expanded verb upgrades, bullet splitting, skill synonyms,
//                self-consistent tailored guard, jdSignalStrength tracking.
//  v2  (#10-#12) Static tailored-phrase guard, SIGNAL_KEYWORDS map,
//                rewrite quality validator with BAD_REWRITE_PATTERNS.
//  v3  (#13-#20) Phrase-level duplicate tracker, conservative rewrite templates,
//                present-participle / tense fixer, UK English normaliser,
//                JD relevance skill filter + job-family mode,
//                unsupported-industry claim blocker,
//                skill review changes in output, final CV quality checker.

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
  | 'skill_review_needed'
  | 'language_moved'
  | 'certification_moved'
  | 'award_moved'
  | 'duplicate_removed';

export type TailoringChange = {
  type: TailoringChangeType;
  section: 'experience' | 'skillsAwards';
  before?: string;
  after?: string;
  /** Single, specific reason for this change. (#15) */
  reason: string;
  roleId?: string;
  roleTitle?: string;
  company?: string;
  bulletIndex?: number;
  riskLevel?: 'safe' | 'medium' | 'not_recommended';
  evidenceSource?: string;
  jdSignal?: string;
  jdSignalStrength?: 'explicit' | 'inferred';
  /** For skill changes: requires user confirmation before applying. (#18) */
  requiresReview?: boolean;
};

/** A missing keyword that the CV text can plausibly support. (#2/#19) */
export type ClaimableGap = {
  keyword: string;
  evidence: string;
  suggestion: string;
};

/** Issues found in the final tailored CV. (#20) */
export type QualityIssue = {
  severity: 'error' | 'warning' | 'info';
  category:
    | 'broken_bullet'
    | 'repeated_phrase'
    | 'wrong_tense'
    | 'overused_jd_phrase'
    | 'irrelevant_skill'
    | 'missing_jd_keyword'
    | 'too_many_bullets'
    | 'weak_bullet'
    | 'unsupported_claim';
  message: string;
  location?: string;
};

export type CVQualityReport = {
  score: number; // 0–100
  passed: boolean;
  issues: QualityIssue[];
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
  claimableGaps: ClaimableGap[];
  qualityReport: CVQualityReport; // (#20)
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
// Internal types
// ============================================================

type RiskLevel = 'safe' | 'medium' | 'not_recommended';
type RewriteStrategy = 'inline' | 'append' | 'template';
type JobFamily = 'support' | 'developer' | 'general';

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
  inlineRewrite?: string;
  rewriteStrategy: RewriteStrategy;
  reason: string;
  priority: number;
  requiresContext: (bullet: string, role: ExperienceItem) => boolean;
  isPresent: (bullet: string) => boolean;
  riskLevel: RiskLevel;
};

// ============================================================
// #11: Signal → keyword patterns for strength detection
// ============================================================

const SIGNAL_KEYWORDS: Record<TailoringSignal, RegExp[]> = {
  applicationSupport:      [/application support/i, /production application/i, /business application/i],
  troubleshooting:         [/troubleshoot/i, /diagnos/i, /technical support/i, /issue resolution/i],
  ticketing:               [/ticket/i, /jira/i, /zendesk/i, /servicenow/i, /case management/i],
  escalation:              [/escalat/i, /engineering team/i, /cross-functional/i, /high-impact/i],
  documentation:           [/document/i, /case notes/i, /knowledge base/i, /runbook/i, /handover/i],
  sla:                     [/sla/i, /service level/i, /timely/i, /follow-up/i],
  monitoring:              [/monitor/i, /log/i, /observability/i, /alert/i, /metric/i],
  rootCause:               [/root cause/i, /rca/i, /problem management/i, /repeat-issue/i],
  customerCommunication:   [/customer/i, /client/i, /communication/i, /stakeholder/i],
  collaboration:           [/collaborat/i, /cross-functional/i, /engineering/i, /vendor/i, /product team/i],
  serviceStability:        [/stability/i, /availability/i, /reliability/i, /performance/i],
  processImprovement:      [/process improvement/i, /automation/i, /workflow/i, /efficien/i],
};

// ============================================================
// Skill synonym map (#7)
// ============================================================

const SKILL_SYNONYMS: Record<string, string> = {
  'js':                    'JavaScript',
  'javascript':            'JavaScript',
  'ts':                    'TypeScript',
  'typescript':            'TypeScript',
  'node':                  'Node.js',
  'nodejs':                'Node.js',
  'node.js':               'Node.js',
  'postgres':              'PostgreSQL',
  'postgresql':            'PostgreSQL',
  'ms office':             'Microsoft 365',
  'office 365':            'Microsoft 365',
  'microsoft office':      'Microsoft 365',
  'ms 365':                'Microsoft 365',
  'microsoft 365':         'Microsoft 365',
  'o365':                  'Microsoft 365',
  'mssql':                 'SQL Server',
  'microsoft sql':         'SQL Server',
  'ad':                    'Active Directory',
  'k8s':                   'Kubernetes',
  'gh':                    'GitHub',
  'vscode':                'VS Code',
  'visual studio code':    'VS Code',
  'py':                    'Python',
  'reactjs':               'React',
  'react.js':              'React',
  'vuejs':                 'Vue.js',
  'vue':                   'Vue.js',
  'gcp':                   'Google Cloud',
  'google cloud platform': 'Google Cloud',
  'aws':                   'AWS',
  'amazon web services':   'AWS',
  'azure':                 'Azure',
  'microsoft azure':       'Azure',
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
    .map((v) => resolveSkillSynonym(clean(v)))
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
  const key    = canonical(phrase);
  return Boolean(key && source.includes(key));
};

const includesAny = (value: string, patterns: RegExp[]): boolean =>
  patterns.some((p) => p.test(value));

// ============================================================
// (#8) UK English normaliser
// ============================================================

const UK_EN_MAP: Array<[RegExp, string]> = [
  [/\banalyze\b/gi,          'analyse'],
  [/\banalyzed\b/gi,         'analysed'],
  [/\banalyzing\b/gi,        'analysing'],
  [/\banalysis\b/gi,         'analysis'],  // already correct, keep
  [/\boptimize\b/gi,         'optimise'],
  [/\boptimized\b/gi,        'optimised'],
  [/\boptimizing\b/gi,       'optimising'],
  [/\bprioritize\b/gi,       'prioritise'],
  [/\bprioritized\b/gi,      'prioritised'],
  [/\bprioritizing\b/gi,     'prioritising'],
  [/\bcustomize\b/gi,        'customise'],
  [/\bcustomized\b/gi,       'customised'],
  [/\brecognize\b/gi,        'recognise'],
  [/\brecognized\b/gi,       'recognised'],
  [/\borganize\b/gi,         'organise'],
  [/\borganized\b/gi,        'organised'],
  [/\borganization\b/gi,     'organisation'],
  [/\bbehavior\b/gi,         'behaviour'],
  [/\bbehaviors\b/gi,        'behaviours'],
  [/\bcenter\b/gi,           'centre'],
  [/\bcolor\b/gi,            'colour'],
  [/\blicense\b/gi,          'licence'],
  [/\bminimize\b/gi,         'minimise'],
  [/\bminimized\b/gi,        'minimised'],
  [/\bmaximize\b/gi,         'maximise'],
  [/\bmaximized\b/gi,        'maximised'],
  [/\bstandardize\b/gi,      'standardise'],
  [/\bstandardized\b/gi,     'standardised'],
  [/\butilize\b/gi,          'utilise'],
  [/\butilized\b/gi,         'utilised'],
  [/\bsynthesize\b/gi,       'synthesise'],
];

const applyUkEnglish = (value: string): string => {
  let output = value;
  for (const [pattern, replacement] of UK_EN_MAP) {
    output = output.replace(pattern, replacement);
  }
  return output;
};

// ============================================================
// (#6/#7) Present-participle and tense fixer
// ============================================================

const PARTICIPLE_TO_PAST: Array<[RegExp, string]> = [
  [/^Monitoring\b/,    'Monitored'],
  [/^Maintaining\b/,   'Maintained'],
  [/^Supporting\b/,    'Supported'],
  [/^Using\b/,         'Used'],
  [/^Ensuring\b/,      'Ensured'],
  [/^Sharing\b/,       'Shared'],
  [/^Managing\b/,      'Managed'],
  [/^Handling\b/,      'Handled'],
  [/^Resolving\b/,     'Resolved'],
  [/^Delivering\b/,    'Delivered'],
  [/^Providing\b/,     'Provided'],
  [/^Tracking\b/,      'Tracked'],
  [/^Updating\b/,      'Updated'],
  [/^Assisting\b/,     'Assisted'],
  [/^Documenting\b/,   'Documented'],
  [/^Responding\b/,    'Responded to'],
  [/^Escalating\b/,    'Escalated'],
  [/^Investigating\b/, 'Investigated'],
  [/^Collaborating\b/, 'Collaborated'],
  [/^Coordinating\b/,  'Coordinated'],
  [/^Working\b/,       'Worked'],
  [/^Helping\b/,       'Helped'],
  [/^Leading\b/,       'Led'],
  [/^Reviewing\b/,     'Reviewed'],
  [/^Testing\b/,       'Tested'],
  [/^Building\b/,      'Built'],
];

// Present-tense verbs that should be past tense on a CV
const PRESENT_TO_PAST: Array<[RegExp, string]> = [
  [/^Act as\b/i,       'Acted as'],
  [/^Acts as\b/i,      'Acted as'],
  [/^Analyse\b/i,      'Analysed'],
  [/^Analyze\b/i,      'Analysed'],
  [/^Monitor\b/i,      'Monitored'],
  [/^Manage\b/i,       'Managed'],
  [/^Resolve\b/i,      'Resolved'],
  [/^Deliver\b/i,      'Delivered'],
  [/^Support\b/i,      'Supported'],
  [/^Handle\b/i,       'Handled'],
  [/^Provide\b/i,      'Provided'],
  [/^Track\b/i,        'Tracked'],
  [/^Update\b/i,       'Updated'],
  [/^Assist\b/i,       'Assisted'],
  [/^Document\b/i,     'Documented'],
  [/^Respond\b/i,      'Responded to'],
  [/^Escalate\b/i,     'Escalated'],
  [/^Investigate\b/i,  'Investigated'],
  [/^Collaborate\b/i,  'Collaborated'],
  [/^Coordinate\b/i,   'Coordinated'],
  [/^Lead\b/i,         'Led'],
  [/^Review\b/i,       'Reviewed'],
  [/^Test\b/i,         'Tested'],
  [/^Build\b/i,        'Built'],
  [/^Create\b/i,       'Created'],
  [/^Maintain\b/i,     'Maintained'],
];

/**
 * Fix present-participle starts and present-tense verbs.
 * Only applied to past roles (roleIndex > 0) to avoid mangling current-role bullets.
 */
const fixTense = (value: string, isPastRole: boolean): string => {
  if (!isPastRole) return value;

  for (const [pattern, replacement] of PARTICIPLE_TO_PAST) {
    if (pattern.test(value)) return value.replace(pattern, replacement);
  }
  for (const [pattern, replacement] of PRESENT_TO_PAST) {
    if (pattern.test(value)) return value.replace(pattern, replacement);
  }
  return value;
};

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
  [/\b(jira|ticketing|tickets?)\b/i,                                              'ticketing'],
  [/\b(service\s*now|servicenow)\b/i,                                             'ServiceNow'],
  [/\b(zendesk)\b/i,                                                              'Zendesk'],
  [/\b(sla|service level agreement)\b/i,                                          'SLA'],
  [/\b(incident management|incident response|incidents?)\b/i,                     'incident management'],
  [/\b(problem management|root cause|rca|root-cause)\b/i,                         'root cause analysis'],
  [/\b(troubleshoot|troubleshooting|diagnos(?:e|is|tic))\b/i,                     'troubleshooting'],
  [/\b(log analysis|logs?|splunk|monitoring|observability)\b/i,                   'monitoring and log analysis'],
  [/\b(escalat(?:e|ion)|engineering team|bug report|defect)\b/i,                  'escalation'],
  [/\b(document(?:ation)?|knowledge base|case notes|runbook)\b/i,                 'documentation'],
  [/\b(api|postman|rest)\b/i,                                                     'API testing'],
  [/\b(sql|database|query)\b/i,                                                   'SQL'],
  [/\b(linux|red hat|rhel|ubuntu|windows|operating systems?)\b/i,                'operating systems'],
  [/\b(customer|client|stakeholder|b2b|partner|reseller|end customer)\b/i,        'customer communication'],
  [/\b(quality assurance|qa|testing|test cases?|regression|uat)\b/i,              'testing'],
  [/\b(process improvement|automation|workflow|efficien(?:cy|t))\b/i,             'process improvement'],
  [/\b(application support|business applications?|production applications?)\b/i,  'application support'],
  [/\b(access|video|cctv|security product|surveillance)\b/i,                      'technical product support'],
  [/\b(stability|performance|availability|reliability)\b/i,                       'stability and performance'],
  [/\b(collaborat(?:e|ion)|cross-functional|developers?|engineering)\b/i,         'cross-functional collaboration'],
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

  const inferred    = extractJdSignalsFromText(getJobDescription(analysis));
  const explicitSet = new Set(explicit.map(canonical));

  return [
    ...unique(explicit).map((keyword) => ({ keyword, strength: 'explicit' as const })),
    ...unique(inferred)
      .filter((keyword) => !explicitSet.has(canonical(keyword)))
      .map((keyword) => ({ keyword, strength: 'inferred' as const })),
  ];
};

const getStrengthForSignal = (
  signal: TailoringSignal,
  keywords: KeywordWithStrength[],
): 'explicit' | 'inferred' => {
  const patterns = SIGNAL_KEYWORDS[signal] ?? [];
  const hasExplicit = keywords.some(
    ({ keyword, strength }) => strength === 'explicit' && patterns.some((p) => p.test(keyword)),
  );
  return hasExplicit ? 'explicit' : 'inferred';
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
// (#12) Job-family detection
// ============================================================

const detectJobFamily = (analysis?: AnalysisRecordLike | null): JobFamily => {
  const jd = getJobDescription(analysis).toLowerCase();
  const title = String(
    analysis?.job_title ?? analysis?.jobTitle ?? '',
  ).toLowerCase();
  const combined = `${title} ${jd}`;

  const supportSignals = [
    /\bapplication support\b/,
    /\btechnical support\b/,
    /\bservice desk\b/,
    /\bhelp desk\b/,
    /\bincident management\b/,
    /\bsla\b/,
    /\bticket/,
    /\btroubleshoot/,
    /\bend user\b/,
    /\bcustomer support\b/,
  ];

  const developerSignals = [
    /\bsoftware engineer\b/,
    /\bfrontend\b/,
    /\bbackend\b/,
    /\bfull.?stack\b/,
    /\breact\b/,
    /\btypescript\b/,
    /\bnode\.?js\b/,
    /\bci\/cd\b/,
    /\bpull request\b/,
    /\bcode review\b/,
  ];

  const supportScore  = supportSignals.filter((p)  => p.test(combined)).length;
  const developerScore = developerSignals.filter((p) => p.test(combined)).length;

  if (supportScore >= 3 && supportScore > developerScore) return 'support';
  if (developerScore >= 3 && developerScore > supportScore) return 'developer';
  return 'general';
};

// ============================================================
// (#9/#12) JD relevance filter for skills
// ============================================================

/**
 * Skills that are only worth highlighting on a developer JD,
 * and should be downranked (not removed) on support JDs.
 */
const DEVELOPER_ONLY_SKILLS = new Set([
  canonical('TypeScript'),
  canonical('React'),
  canonical('Vue.js'),
  canonical('Angular'),
  canonical('Node.js'),
  canonical('Next.js'),
  canonical('GraphQL'),
  canonical('Webpack'),
  canonical('Babel'),
  canonical('Redux'),
  canonical('CSS'),
  canonical('HTML'),
  canonical('Sass'),
  canonical('Tailwind'),
  canonical('Storybook'),
  canonical('Jest'),
  canonical('Cypress'),
  canonical('Docker'),
  canonical('Kubernetes'),
  canonical('Terraform'),
  canonical('CI/CD'),
]);

/**
 * Skills that are relevant only to specific industry domains and must not be
 * added unless the Master CV explicitly proves them. (#10)
 */
const UNSUPPORTED_INDUSTRY_SKILLS = new Set([
  canonical('Lenel'),
  canonical('Access Control'),
  canonical('Video Surveillance'),
  canonical('CCTV'),
  canonical('Electronic Security'),
  canonical('Genetec'),
  canonical('Milestone'),
  canonical('OnGuard'),
  canonical('CCure'),
  canonical('Avigilon'),
]);

const filterSkillsForJobFamily = (
  skills: string[],
  jobFamily: JobFamily,
  changes: TailoringChange[],
): string[] => {
  const filtered: string[] = [];

  for (const skill of skills) {
    const key = canonical(skill);
    let requiresReview = false;
    let reason = '';

    if (UNSUPPORTED_INDUSTRY_SKILLS.has(key)) {
      reason =
        `"${skill}" describes specialist industry experience not evidenced in the Master CV. Review and keep only if you actually worked with it.`;
      requiresReview = true;
    } else if (DEVELOPER_ONLY_SKILLS.has(key) && jobFamily === 'support') {
      reason =
        `"${skill}" is developer-focused. Keep it only if the JD asks for it or it is genuinely relevant to this support role.`;
      requiresReview = true;
    }

    if (requiresReview) {
      changes.push({
        type: 'skill_review_needed',
        section: 'skillsAwards',
        before: skill,
        after: skill,
        reason,
        riskLevel: 'medium',
        requiresReview: true,
      });
    }

    // Keep the skill. The UI should let the user decide whether to remove or hide it.
    filtered.push(skill);
  }

  return filtered;
};

// ============================================================
// (#2/#19) Claimable gaps
// ============================================================

const CLAIMABLE_PROXIMITY_MAP: Array<{
  keyword: RegExp;
  evidencePattern: RegExp;
  suggestion: string;
}> = [
  {
    keyword:         /\bsql\b/i,
    evidencePattern: /\b(database|query|queries|db|data|report|reporting|records)\b/i,
    suggestion:      'Consider adding SQL to skills if you ran or wrote database queries in this role.',
  },
  {
    keyword:         /\bpython\b/i,
    evidencePattern: /\b(script|automat|data|report|tool|process)\b/i,
    suggestion:      'Consider adding Python if you used scripts or automation tools.',
  },
  {
    keyword:         /\bjira\b/i,
    evidencePattern: /\b(ticket|track|issue|case|workflow|sprint|agile|kanban)\b/i,
    suggestion:      'Consider adding Jira to skills if you tracked issues or tickets using any tool.',
  },
  {
    keyword:         /\bmonitoring\b/i,
    evidencePattern: /\b(alert|metric|dashboard|log|performance|uptime|incident|observe)\b/i,
    suggestion:      'Consider adding monitoring tools (e.g. Datadog, Splunk) if you reviewed system health.',
  },
  {
    keyword:         /\broot cause analysis\b/i,
    evidencePattern: /\b(recurring|repeat|investig|analy[sz]|post.mortem|prevent|improve)\b/i,
    suggestion:      'Consider mentioning root cause analysis if you investigated recurring issues.',
  },
  {
    keyword:         /\bactive directory\b/i,
    evidencePattern: /\b(user account|access|permiss|password|provisioning|ldap)\b/i,
    suggestion:      'Consider adding Active Directory if you managed user accounts or access rights.',
  },
  {
    keyword:         /\bservice now\b|servicenow/i,
    evidencePattern: /\b(ticket|itsm|incident|service desk|request|change management)\b/i,
    suggestion:      'Consider adding ServiceNow if you used an ITSM platform for ticket management.',
  },
  {
    keyword:         /\blinux\b/i,
    evidencePattern: /\b(server|terminal|command|bash|shell|rhel|ubuntu|red hat|unix)\b/i,
    suggestion:      'Consider adding Linux if you used the command line or managed Linux servers.',
  },
  {
    keyword:         /\bapi\b/i,
    evidencePattern: /\b(endpoint|rest|http|request|integration|postman|webhook)\b/i,
    suggestion:      'Consider adding API troubleshooting to skills if you worked with API integrations.',
  },
  {
    keyword:         /\bdocumentation\b/i,
    evidencePattern: /\b(process|procedure|runbook|knowledge|guide|wiki|note|case)\b/i,
    suggestion:      'Consider adding documentation to skills if you wrote guides, runbooks, or case notes.',
  },
];

const buildClaimableGaps = (
  missingKeywords: string[],
  experience: ExperienceItem[],
): ClaimableGap[] => {
  if (!missingKeywords.length) return [];
  const gaps: ClaimableGap[] = [];

  for (const keyword of missingKeywords) {
    const rule = CLAIMABLE_PROXIMITY_MAP.find(({ keyword: pattern }) => pattern.test(keyword));
    if (!rule) continue;

    outer: for (const role of experience) {
      for (let bIdx = 0; bIdx < (role.bullets?.length ?? 0); bIdx++) {
        if (rule.evidencePattern.test(clean(role.bullets![bIdx]))) {
          gaps.push({
            keyword:    clean(keyword),
            evidence:   `${role.company ?? 'Unknown company'} → ${role.jobTitle ?? 'Role'} → Bullet ${bIdx + 1}`,
            suggestion: rule.suggestion,
          });
          break outer;
        }
      }
    }
  }

  return gaps;
};

// ============================================================
// Classification
// ============================================================

const classifyKeyword = (keyword: string): 'technical' | 'language' | 'certification' | 'award' => {
  const value = clean(keyword);
  if (LANGUAGE_REGEX.test(value) && !TECH_HINT_REGEX.test(value)) return 'language';
  if (CERT_REGEX.test(value)) return 'certification';
  if (AWARD_REGEX.test(value)) return 'award';
  return 'technical';
};

const splitSkillsAwards = (skillsAwards: SkillsAwards) => {
  const technical: string[]      = [];
  const languages: string[]      = [];
  const certifications: string[] = [];
  const awards: string[]         = [];

  [
    ...splitLines(skillsAwards.technicalSkills),
    ...splitLines(skillsAwards.languages),
    ...splitLines(skillsAwards.trainingCertifications),
    ...splitLines(skillsAwards.awards),
  ].forEach((item) => {
    const bucket = classifyKeyword(item);
    if (bucket === 'language')      languages.push(item);
    else if (bucket === 'certification') certifications.push(item);
    else if (bucket === 'award')    awards.push(item);
    else                            technical.push(item);
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
  jobFamily: JobFamily,
): SkillsAwards => {
  const existing = splitSkillsAwards(current);
  const safeSkillKeywords = safeKeywords.filter(
    (keyword) =>
      !JD_ONLY_SKILL_DENYLIST.some((blocked) => canonical(blocked) === canonical(keyword)) &&
      !UNSUPPORTED_INDUSTRY_SKILLS.has(canonical(keyword)), // (#10)
  );

  const jdBuckets = splitSkillsAwards({
    technicalSkills:        safeSkillKeywords.join('\n'),
    languages:              '',
    trainingCertifications: '',
    awards:                 '',
  });

  jdBuckets.technical.forEach((keyword) => {
    if (!existing.technical.some((item) => canonical(item) === canonical(keyword))) {
      changes.push({
        type:           'technical_skill_added',
        section:        'skillsAwards',
        after:          keyword,
        reason:         `Added "${keyword}" because it was explicitly matched against the job description keywords.`,
        requiresReview: false,
      });
    }
  });

  // (#9/#12) Filter developer-only skills on support JDs
  const rawTechnical = unique([...existing.technical, ...jdBuckets.technical]);
  const filteredTechnical = filterSkillsForJobFamily(rawTechnical, jobFamily, changes);

  return {
    technicalSkills:        toLines(filteredTechnical),
    languages:              toLines(unique([...existing.languages, ...jdBuckets.languages])),
    trainingCertifications: toLines(unique([...existing.certifications, ...jdBuckets.certifications])),
    awards:                 toLines(unique([...existing.awards, ...jdBuckets.awards])),
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
  const cleaned   = clean(value);
  const wordCount = cleaned.split(/\s+/).filter(Boolean).length;
  return cleaned.length < 45 || wordCount <= 5;
};

const shouldMergeBulletFragment = (previous: string | undefined, current: string): boolean => {
  const prev  = clean(previous ?? '');
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

const normalizeBullets = (role: ExperienceItem, changes: TailoringChange[]): string[] => {
  const normalized: string[] = [];

  (role.bullets ?? []).map(clean).filter(Boolean).forEach((bullet, idx) => {
    const previous = normalized[normalized.length - 1];

    if (shouldMergeBulletFragment(previous, bullet)) {
      const merged = mergeBulletText(previous, bullet);
      normalized[normalized.length - 1] = merged;
      changes.push({
        type:        'bullet_fragments_merged',
        section:     'experience',
        roleId:      role.id,
        roleTitle:   role.jobTitle,
        company:     role.company,
        bulletIndex: Math.max(0, normalized.length - 1),
        before:      `${previous}\n${bullet}`,
        after:       merged,
        reason:      `Merged broken bullet fragment from original bullet ${idx + 1} because the two lines form a single incomplete sentence.`,
        riskLevel:   'safe',
        evidenceSource: buildEvidenceSource(role, idx),
      });
      return;
    }

    normalized.push(normaliseBulletSentence(bullet));
  });

  return normalized;
};

// ============================================================
// Bullet splitting (#6)
// ============================================================

const SPLIT_DELIMITERS = /;\s+|,\s+(?:and|while|also)\s+/i;

const splitLongBullet = (bullet: string): string[] => {
  const value = clean(bullet);
  if (value.length < 120) return [value];

  const parts = value.split(SPLIT_DELIMITERS);
  if (parts.length < 2) return [value];

  const valid = parts
    .map((p) => clean(p))
    .filter((p) => p.length >= 40 && !startsLikeContinuation(p));

  return valid.length >= 2 ? valid.map(normaliseBulletSentence) : [value];
};

// ============================================================
// Trim-before-discard (#3)
// ============================================================

const trimBaseForAppend = (text: string, maxLen: number): string => {
  if (text.length <= maxLen) return text;
  const shortened = text.replace(
    /,?\s+(and|as well as|including|such as|along with|whilst)[^.]+\.$/i,
    '.',
  );
  if (shortened.length <= maxLen) return shortened;
  return text.slice(0, maxLen).replace(/\s+\S*$/, '').trim();
};

// ============================================================
// Conservative rewrite templates (#5)
// ============================================================

type ConservativeTemplate = {
  signal: TailoringSignal;
  requiresContext: (bullet: string) => boolean;
  template: string;
  reason: string;
};

const CONSERVATIVE_TEMPLATES: ConservativeTemplate[] = [
  {
    signal: 'troubleshooting',
    requiresContext: (b) => SUPPORT_CONTEXT_REGEX.test(b),
    template:
      'Used {tools} to investigate, classify, and resolve technical support issues, applying structured troubleshooting at each stage.',
    reason:
      'Used a conservative troubleshooting template because the inline rewrite produced an unsafe sentence structure.',
  },
  {
    signal: 'monitoring',
    requiresContext: (b) =>
      /monitor|metric|dashboard|alert|log|production|incident|service/i.test(b),
    template:
      'Monitored service metrics and responded quickly to incidents affecting customer-facing systems.',
    reason:
      'Used a conservative monitoring template because the inline rewrite could not safely preserve the original bullet meaning.',
  },
  {
    signal: 'customerCommunication',
    requiresContext: (b) =>
      /customer|client|communicat|email|chat|phone|stakeholder/i.test(b),
    template:
      'Resolved software and hardware support issues across chat, email, and phone, keeping customers informed throughout.',
    reason:
      'Used a conservative customer communication template to preserve the original customer-facing context.',
  },
  {
    signal: 'escalation',
    requiresContext: (b) =>
      /complex|critical|escalat|incident|senior|high.impact/i.test(b),
    template:
      'Escalated complex technical issues to senior engineering teams with clear context, impact assessment, and troubleshooting history.',
    reason:
      'Used a conservative escalation template because the escalation signal required a complete sentence structure.',
  },
  {
    signal: 'documentation',
    requiresContext: (b) =>
      /maintain|document|case|process|knowledge|handover|support/i.test(b),
    template:
      'Maintained accurate case notes and handover documentation to support consistent service delivery and knowledge transfer.',
    reason:
      'Used a conservative documentation template because the original bullet did not provide enough context for a safe inline rewrite.',
  },
];

const findConservativeTemplate = (
  signal: TailoringSignal,
  bullet: string,
): ConservativeTemplate | undefined => {
  const keywordPatterns = SIGNAL_KEYWORDS[signal] ?? [];
  const hasKeywordEvidence = keywordPatterns.some((pattern) => pattern.test(bullet));

  const template = CONSERVATIVE_TEMPLATES.find(
    (item) => item.signal === signal && item.requiresContext(bullet),
  );

  if (template && (hasKeywordEvidence || template.requiresContext(bullet))) {
    return template;
  }

  return undefined;
};


const applyConservativeTemplate = (
  template: string,
): string => {
  // Replace {tools} placeholder with a safe generic
  return normaliseBulletSentence(
    template.replace(/\{tools\}/g, 'internal tooling'),
  );
};

// ============================================================
// (#13) Phrase-level global duplicate tracker
// ============================================================

/**
 * Tracks the exact JD phrases injected across the whole CV.
 * Prevents the same appended/rewritten phrase from appearing more than once.
 */
const buildPhraseTracker = () => {
  const usedPhrases = new Set<string>();
  return {
    has: (phrase: string) => usedPhrases.has(canonical(phrase)),
    mark: (phrase: string) => {
      const key = canonical(phrase);
      if (key) usedPhrases.add(key);
    },
    getAll: () => Array.from(usedPhrases),
  };
};

// ============================================================
// Static already-tailored guard (#10)
// ============================================================

const STATIC_TAILORED_PHRASE_REGEX =
  /\b(case documentation|handover notes|cross-functional triage|structured troubleshooting|ticketing workflows|root cause analysis|SLA-focused|monitoring signals|service stability|application issue investigation|high-impact cases|customer-facing communication|support workflows|repeat-issue prevention|conservative troubleshooting)\b/i;

const isAlreadyTailoredBullet = (
  bullet: string,
  candidates: SignalCandidate[],
): boolean =>
  STATIC_TAILORED_PHRASE_REGEX.test(bullet) ||
  candidates.some((c) => c.isPresent(bullet));

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
    hasTicketing:             has([/\bjira\b/i, /\bzendesk\b/i, /\bservicenow\b/i, /\bticket/i]),
    hasSla:                   has([/\bsla\b/i, /\bservice level/i]),
    hasTroubleshooting:       has([/\btroubleshooting\b/i, /\btechnical support\b/i, /\bdiagnos/i]),
    hasRootCause:             has([/\broot cause/i, /\brca\b/i]),
    hasDocumentation:         has([/\bdocument/i, /\bknowledge base/i, /\bcase notes/i, /\brunbook/i]),
    hasEscalation:            has([/\bescalat/i, /\bbug/i, /\bengineering team/i, /\bdefect/i]),
    hasMonitoring:            has([/\bmonitoring\b/i, /\blog analysis\b/i, /\blogs?\b/i, /\bsplunk\b/i, /\bobservability\b/i]),
    hasApplicationSupport:    has([/\bapplication support\b/i, /\bbusiness applications?\b/i, /\bproduction applications?\b/i]),
    hasPerformance:           has([/\bperformance\b/i, /\bstability\b/i, /\bavailability\b/i, /\breliability\b/i]),
    hasCustomerCommunication: has([/\bcommunicat/i, /\bcustomer\b/i, /\bclient\b/i, /\bstakeholder\b/i]),
    hasCollaboration:         has([/\bcollaborat/i, /\bcross-functional\b/i, /\bengineering team\b/i, /\bdeveloper/i]),
    hasProcessImprovement:    has([/\bprocess improvement\b/i, /\bautomation\b/i, /\bworkflow\b/i, /\befficien/i]),
  };
};

const roleText = (role: ExperienceItem): string =>
  [role.jobTitle, role.company, role.location, role.years, ...(role.bullets ?? [])].join(' ');

const roleLooksTechnical = (role: ExperienceItem): boolean =>
  includesAny(roleText(role), [
    /\btechnical support\b/i, /\bit support\b/i, /\bhelp desk\b/i,
    /\bservice desk\b/i,      /\bsupport engineer\b/i, /\bsupport specialist\b/i,
    /\bdesktop\b/i,           /\binfrastructure\b/i, /\bincident\b/i,
    /\bticket/i,              /\btroubleshoot/i, /\bapplication/i,
    /\bconnectivity\b/i,      /\bos\b/i,
  ]);

const getSignalCandidates = (
  safeKeywords: string[],
  jobDescription: string,
  role: ExperienceItem,
): SignalCandidate[] => {
  const bucket     = keywordBucket(safeKeywords, jobDescription);
  const isTechRole = roleLooksTechnical(role);
  const candidates: SignalCandidate[] = [];

  if (bucket.hasApplicationSupport) {
    candidates.push({
      signal: 'applicationSupport', phrase: 'supporting application issue investigation and resolution',
      inlineRewrite: 'Investigated and resolved application issues', rewriteStrategy: 'inline',
      reason: 'Changed the bullet to emphasise application issue investigation because the original bullet already describes technical resolution work in a support context.',
      priority: 1,
      requiresContext: (bullet) => SUPPORT_CONTEXT_REGEX.test(bullet) && isTechRole,
      isPresent: (bullet) => hasPhrase(bullet, 'application') || hasPhrase(bullet, 'issue investigation') || hasPhrase(bullet, 'application support'),
      riskLevel: 'safe',
    });
  }

  if (bucket.hasTroubleshooting) {
    candidates.push({
      signal: 'troubleshooting', phrase: 'using structured troubleshooting to diagnose user and system issues',
      inlineRewrite: 'Applied structured troubleshooting to diagnose and resolve', rewriteStrategy: 'inline',
      reason: 'Added structured troubleshooting language because the original bullet describes diagnosis or issue resolution — the exact skill the JD highlights.',
      priority: 2,
      requiresContext: (bullet) => /diagnos|investigat|resolve|resolved|issue|problem|error|bug|support|troubleshoot/i.test(bullet),
      isPresent: (bullet) => hasPhrase(bullet, 'troubleshooting') || hasPhrase(bullet, 'diagnos') || hasPhrase(bullet, 'structured troubleshooting'),
      riskLevel: 'safe',
    });
  }

  if (bucket.hasTicketing) {
    candidates.push({
      signal: 'ticketing', phrase: 'documenting and tracking support cases through ticketing workflows',
      rewriteStrategy: 'append',
      reason: 'Added ticketing workflow language because the original bullet describes case handling and the JD explicitly requires ticket management experience.',
      priority: 3,
      requiresContext: (bullet) => /ticket|case|track|workflow|queue|priority|support|issue|request/i.test(bullet),
      isPresent: (bullet) => hasPhrase(bullet, 'ticket') || hasPhrase(bullet, 'workflow') || hasPhrase(bullet, 'jira') || hasPhrase(bullet, 'zendesk') || hasPhrase(bullet, 'support cases'),
      riskLevel: 'safe',
    });
  }

  if (bucket.hasEscalation) {
    candidates.push({
      signal: 'escalation', phrase: 'owning the escalation pathway for high-impact cases requiring cross-functional triage',
      inlineRewrite: 'Escalated high-impact cases to cross-functional engineering teams with full context and impact assessment',
      rewriteStrategy: 'inline',
      reason: 'Reframed escalation as structured case ownership because the original bullet supports complex incident handling and the JD lists escalation as a required competency.',
      priority: 4,
      requiresContext: (bullet) => /complex|critical|senior|high-impact|escalat|incident|issue|support|resolve|resolved/i.test(bullet),
      isPresent: (bullet) => hasPhrase(bullet, 'escalat') || hasPhrase(bullet, 'cross-functional triage') || hasPhrase(bullet, 'high-impact cases'),
      riskLevel: 'safe',
    });
  }

  if (bucket.hasDocumentation) {
    candidates.push({
      signal: 'documentation', phrase: 'maintaining clear case documentation and handover notes for consistent follow-up',
      rewriteStrategy: 'append',
      reason: 'Added documentation language because the original bullet references process or case ownership and the JD requires knowledge base maintenance.',
      priority: 5,
      requiresContext: (bullet) => /maintain|document|case|process|knowledge|handover|support|issue|training/i.test(bullet),
      isPresent: (bullet) => hasPhrase(bullet, 'document') || hasPhrase(bullet, 'case note') || hasPhrase(bullet, 'handover') || hasPhrase(bullet, 'knowledge'),
      riskLevel: 'safe',
    });
  }

  if (bucket.hasSla) {
    candidates.push({
      signal: 'sla', phrase: 'supporting SLA-focused service delivery and timely follow-up',
      rewriteStrategy: 'append',
      reason: 'Added SLA language because the original bullet describes service delivery or resolution ownership and the JD requires SLA adherence.',
      priority: 6,
      requiresContext: (bullet) => /sla|timely|response|resolution|deadline|metric|kpi|incident|support|service/i.test(bullet),
      isPresent: (bullet) => hasPhrase(bullet, 'sla') || hasPhrase(bullet, 'service level') || hasPhrase(bullet, 'response time') || hasPhrase(bullet, 'timely follow-up'),
      riskLevel: 'safe',
    });
  }

  if (bucket.hasMonitoring) {
    candidates.push({
      signal: 'monitoring', phrase: 'using monitoring signals to accelerate issue investigation and response',
      rewriteStrategy: 'append',
      reason: 'Added monitoring language because the original bullet references alerts, metrics, or production incidents that align with the JD monitoring requirement.',
      priority: 7,
      requiresContext: (bullet) => /monitor|metric|dashboard|alert|log|production|incident|observability|service/i.test(bullet),
      isPresent: (bullet) => hasPhrase(bullet, 'monitoring') || hasPhrase(bullet, 'log review') || hasPhrase(bullet, 'observability') || hasPhrase(bullet, 'monitoring signals'),
      riskLevel: 'safe',
    });
  }

  if (bucket.hasRootCause) {
    candidates.push({
      signal: 'rootCause', phrase: 'supporting root cause analysis and repeat-issue prevention',
      rewriteStrategy: 'append',
      reason: 'Added root cause language because the original bullet describes recurring issue investigation or process improvement, which matches the JD problem management requirement.',
      priority: 8,
      requiresContext: (bullet) => /recurring|repeat|improve|improvement|process|analy[sz]e|investigat|prevent|incident|post-mortem|automation/i.test(bullet),
      isPresent: (bullet) => hasPhrase(bullet, 'root cause') || hasPhrase(bullet, 'rca') || hasPhrase(bullet, 'repeat-issue') || hasPhrase(bullet, 'prevention'),
      riskLevel: 'safe',
    });
  }

  if (bucket.hasCollaboration) {
    candidates.push({
      signal: 'collaboration', phrase: 'coordinating with cross-functional teams to move technical issues toward resolution',
      inlineRewrite: 'Coordinated with cross-functional engineering and product teams to escalate and resolve',
      rewriteStrategy: 'inline',
      reason: 'Added cross-functional collaboration language because the original bullet supports team-based resolution and the JD requires working with engineering or vendor teams.',
      priority: 9,
      requiresContext: (bullet) => /team|collaborat|engineering|vendor|operation|product|stakeholder|support|issue|resolve/i.test(bullet),
      isPresent: (bullet) => hasPhrase(bullet, 'collaborat') || hasPhrase(bullet, 'cross-functional') || hasPhrase(bullet, 'engineering team'),
      riskLevel: 'safe',
    });
  }

  if (bucket.hasCustomerCommunication) {
    candidates.push({
      signal: 'customerCommunication', phrase: 'translating technical updates into clear customer-facing communication',
      rewriteStrategy: 'append',
      reason: 'Added customer communication language because the original bullet supports direct customer interaction and the JD requires clear stakeholder-facing communication.',
      priority: 10,
      requiresContext: (bullet) => /customer|client|communicat|email|chat|phone|stakeholder|expectation|satisfaction/i.test(bullet),
      isPresent: (bullet) => hasPhrase(bullet, 'communication') || hasPhrase(bullet, 'customer-facing') || hasPhrase(bullet, 'technical updates'),
      riskLevel: 'safe',
    });
  }

  if (bucket.hasPerformance) {
    candidates.push({
      signal: 'serviceStability', phrase: 'contributing to service stability through fast investigation and follow-up',
      rewriteStrategy: 'append',
      reason: 'Added service stability language because the original bullet supports incident response or reliability work that the JD lists as a key requirement.',
      priority: 11,
      requiresContext: (bullet) => /incident|monitor|metric|stability|performance|availability|reliability|issue|service/i.test(bullet),
      isPresent: (bullet) => hasPhrase(bullet, 'stability') || hasPhrase(bullet, 'availability') || hasPhrase(bullet, 'reliability'),
      riskLevel: 'safe',
    });
  }

  if (bucket.hasProcessImprovement) {
    candidates.push({
      signal: 'processImprovement', phrase: 'strengthening support workflows through process improvement and automation thinking',
      rewriteStrategy: 'append',
      reason: 'Added process improvement language because the original bullet describes recurring issue analysis or workflow efficiency, matching the JD automation and efficiency requirement.',
      priority: 12,
      requiresContext: (bullet) => /process|improve|improvement|automation|workflow|recurring|repeat|efficien/i.test(bullet),
      isPresent: (bullet) => hasPhrase(bullet, 'process improvement') || hasPhrase(bullet, 'automation') || hasPhrase(bullet, 'workflow'),
      riskLevel: 'safe',
    });
  }

  return candidates.sort((a, b) => a.priority - b.priority);
};

// ============================================================
// Signal usage guards
// ============================================================

const canUseSignal = (
  roleUsage:   Record<string, number>,
  globalUsage: Record<string, number>,
  signal: TailoringSignal,
): boolean =>
  (roleUsage[signal] ?? 0) === 0 && (globalUsage[signal] ?? 0) === 0;

const markSignalUsed = (
  roleUsage:   Record<string, number>,
  globalUsage: Record<string, number>,
  signal: TailoringSignal,
) => {
  roleUsage[signal]   = (roleUsage[signal]   ?? 0) + 1;
  globalUsage[signal] = (globalUsage[signal] ?? 0) + 1;
};

// ============================================================
// Evidence source
// ============================================================

const buildEvidenceSource = (role: ExperienceItem, bulletIndex: number): string =>
  `Master CV → ${role.company ?? 'Unknown company'} → ${role.jobTitle ?? 'Experience role'} → Bullet ${bulletIndex + 1}`;

// ============================================================
// Action verb upgrades (#5)
// ============================================================

const actionVerbUpgrade = (value: string): string => {
  const trimmed = clean(value);
  const replacements: Array<[RegExp, string]> = [
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
    [/^assisted with\b/i,         'Supported'],
    [/^assisted in\b/i,           'Contributed to'],
    [/^was involved in\b/i,       'Contributed to'],
    [/^participated in\b/i,       'Contributed to'],
    [/^helped to\b/i,             ''],
    [/^tried to\b/i,              ''],
    [/^liaised with\b/i,          'Coordinated with'],
    [/^provided support\b/i,      'Delivered support for'],
    [/^provided support to\b/i,   'Supported'],
    [/^gave support\b/i,          'Provided support for'],
    [/^made sure\b/i,             'Ensured'],
    [/^ensured that\b/i,          'Ensured'],
    [/^took care of\b/i,          'Managed'],
    [/^took ownership of\b/i,     'Owned'],
    [/^performed\b/i,             'Executed'],
    [/^carried out\b/i,           'Executed'],
    [/^was tasked with\b/i,       'Delivered'],
    [/^was asked to\b/i,          'Delivered'],
    [/^played a role in\b/i,      'Contributed to'],
    [/^played a key role in\b/i,  'Led'],
    [/^supported in\b/i,          'Assisted with'],
    [/^acted as\b/i,              'Served as'],
    [/^looked after\b/i,          'Managed'],
    [/^looked into\b/i,           'Investigated'],
  ];

  for (const [pattern, replacement] of replacements) {
    if (pattern.test(trimmed)) {
      const upgraded = trimmed.replace(pattern, replacement).trim();
      return upgraded
        ? capitaliseBulletStart(upgraded)
        : capitaliseBulletStart(trimmed.replace(pattern, '').trim());
    }
  }
  return trimmed;
};

// ============================================================
// Noise removal
// ============================================================

const NOISY_INJECTED_PHRASES = [
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

const removeRepeatedTailoringNoise = (value: string): string => {
  let output = clean(value);
  for (const pattern of NOISY_INJECTED_PHRASES) {
    output = output.replace(pattern, '');
  }
  return clean(output).replace(/[,\s]+$/, '');
};

// ============================================================
// Rewrite quality validator (#12/#14)
// ============================================================

const BAD_REWRITE_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\b(resolve|diagnose|investigate|support)\s+and\s+(and|internal|service|tools)\b/i,   reason: 'Broken verb/object structure.' },
  { pattern: /\bteams\s+service\s+metrics\b/i,                                                      reason: 'Broken phrase: cross-functional teams service metrics.' },
  { pattern: /\bteams\s+(service|metrics|tools|issues|and)\b/i,                                     reason: 'Broken phrase after cross-functional teams.' },
  { pattern: /\bresolve\s+(top-tier\s+)?customer support\b/i,                                       reason: 'Invalid object: customer support cannot be resolved.' },
  { pattern: /\bresulting in\b.*?,\s*maintaining\b/i,                                               reason: 'Awkward stacked clause after a result statement.' },
  { pattern: /\bto\s+cross-functional teams\s+(service|metrics|tools|issues)\b/i,                   reason: 'Broken escalation phrase.' },
  { pattern: /\b(resolve|diagnose|investigate)\s*\.?\s*and\b/i,                                     reason: 'Duplicated connector after an action verb.' },
  { pattern: /\b(resolve|resolved|resolving)\s+(support|service delivery|communication)\b/i,        reason: 'Invalid object for a resolution verb.' },
  { pattern: /\b(application issues|technical issues|support cases)\s+(and|for|with)\s+(and|internal|service|metrics)\b/i, reason: 'Broken object continuation.' },
  { pattern: /\bLeveraged and\b/i,                                                                   reason: 'Action verb immediately followed by "and" — missing object.' },
  { pattern: /\bApplied and\b/i,                                                                     reason: 'Action verb immediately followed by "and" — missing object.' },
  { pattern: /\bEscalated .{0,30} service metrics\b/i,                                              reason: 'Escalation verb paired with invalid object "service metrics".' },
  { pattern: /\b\w+ed\s+and\s+(internal|service|tools|and)\b/i,                                    reason: 'Past-tense verb followed immediately by conjunction and invalid noun.' },
  { pattern: /,,/,                                                                                   reason: 'Double comma.' },
  { pattern: /\.\./,                                                                                 reason: 'Double full stop.' },
];

const validateRewrittenBullet = (
  original: string,
  rewritten: string,
): { valid: boolean; reason?: string } => {
  const cleaned = normaliseBulletSentence(rewritten);

  if (!cleaned || cleaned.length < 35)
    return { valid: false, reason: 'Rewrite is too short or empty.' };

  if (cleaned.length > 240)
    return { valid: false, reason: 'Rewrite is too long.' };

  for (const rule of BAD_REWRITE_PATTERNS) {
    if (rule.pattern.test(cleaned))
      return { valid: false, reason: rule.reason };
  }

  const originalWords  = new Set(canonical(original).split(' ').filter((w) => w.length > 2));
  const rewrittenWords = canonical(cleaned).split(' ').filter((w) => w.length > 2);
  const preservationRatio =
    rewrittenWords.filter((w) => originalWords.has(w)).length / Math.max(1, originalWords.size);

  if (originalWords.size >= 6 && preservationRatio < 0.35)
    return { valid: false, reason: 'Rewrite changed too much of the original Master CV meaning.' };

  return { valid: true };
};

// ============================================================
// Leading action phrase stripper (for inline rewrites)
// ============================================================

const removeLeadingActionPhrase = (value: string): string => {
  const cleaned  = clean(value).replace(/[.\s]+$/, '');
  const patterns = [
    /^Act(?:ed)? as\s+/i,   /^Served as\s+/i,    /^Delivered\s+/i,
    /^Provided\s+/i,        /^Supported\s+/i,     /^Managed\s+/i,
    /^Resolved\s+/i,        /^Investigated\s+/i,  /^Handled\s+/i,
    /^Monitored\s+/i,       /^Maintained\s+/i,    /^Coordinated\s+/i,
    /^Communicated\s+/i,    /^Enhanced\s+/i,      /^Analysed\s+/i,
    /^Analyzed\s+/i,        /^Executed\s+/i,      /^Leveraged\s+/i,
    /^Escalated\s+/i,       /^Collaborated\s+/i,  /^Responded\s+/i,
    /^Tracked\s+/i,         /^Updated\s+/i,       /^Documented\s+/i,
  ];
  for (const p of patterns) {
    if (p.test(cleaned)) return clean(cleaned.replace(p, ''));
  }
  return clean(cleaned.replace(/^[A-Z][a-z]+(?:\s+[a-z]+){0,2}\s+/i, ''));
};

// ============================================================
// Core bullet improvement
// ============================================================

const MAX_BULLET_LENGTH = 240;

const improveBullet = (
  bullet: string,
  role: ExperienceItem,
  safeKeywordsWithStrength: KeywordWithStrength[],
  roleUsage:   Record<string, number>,
  globalUsage: Record<string, number>,
  phraseTracker: ReturnType<typeof buildPhraseTracker>, // (#13)
  bulletIndex: number,
  isPastRole: boolean, // (#6/#7)
  analysis?: AnalysisRecordLike | null,
): {
  bullet: string;
  reason?: string;
  jdSignal?: TailoringSignal;
  jdSignalStrength?: 'explicit' | 'inferred';
  riskLevel?: RiskLevel;
  evidenceSource?: string;
  changeType?: TailoringChangeType;
} => {
  const original     = clean(bullet);
  if (!original)     return { bullet: '' };

  const jdText       = getJobDescription(analysis);
  const safeKeywords = safeKeywordsWithStrength.map((k) => k.keyword);
  const candidates   = getSignalCandidates(safeKeywords, jdText, role);

  // Guard: already tailored
  if (isAlreadyTailoredBullet(original, candidates))
    return { bullet: normaliseBulletSentence(applyUkEnglish(fixTense(original, isPastRole))) };

  // Clean noise, upgrade verb, fix tense, apply UK English
  const stripped  = removeRepeatedTailoringNoise(original);
  const verbFixed = actionVerbUpgrade(stripped);
  const tensed    = fixTense(verbFixed, isPastRole);
  const baseText  = applyUkEnglish(tensed);

  if (!baseText || isFragmentBullet(baseText))
    return { bullet: normaliseBulletSentence(baseText) };

  // Find available signal
  const availableCandidates = candidates.filter((c) => {
    return (
      c.requiresContext(baseText, role) &&
      !c.isPresent(baseText) &&
      canUseSignal(roleUsage, globalUsage, c.signal) &&
      !phraseTracker.has(c.phrase) // (#13) phrase-level duplicate check
    );
  });

  const selected = availableCandidates[0];

  if (!selected) {
    if (baseText !== original) {
      return {
        bullet: normaliseBulletSentence(baseText),
        reason: 'Cleaned action verb and applied tense/spelling normalisation while preserving the original Master CV fact.',
      };
    }
    return { bullet: normaliseBulletSentence(baseText) };
  }

  const keywordStrengthForSignal = getStrengthForSignal(selected.signal, safeKeywordsWithStrength);

  // --- Inline rewrite attempt ---
  let rewritten: string | undefined;
  let changeType: TailoringChangeType = 'bullet_optimized';
  let appliedTemplate: ConservativeTemplate | undefined;

  if (selected.rewriteStrategy === 'inline' && selected.inlineRewrite) {
    const withoutVerb  = removeLeadingActionPhrase(baseText);
    const candidate    = normaliseBulletSentence(applyUkEnglish(`${selected.inlineRewrite} ${withoutVerb}`));
    const validation   = validateRewrittenBullet(original, candidate);

    if (validation.valid && withoutVerb.length >= 10) {
      rewritten  = candidate;
      changeType = 'bullet_rewritten';
    } else {
      // (#5) Try conservative template before falling back to append
      const template = findConservativeTemplate(selected.signal, baseText);
      if (template) {
        const tplText   = applyConservativeTemplate(template.template);
        const tplValid  = validateRewrittenBullet(original, tplText);
        if (tplValid.valid) {
          rewritten  = tplText;
          changeType = 'bullet_rewritten';
          appliedTemplate = template;
        }
      }
      // Fall back to append
      if (!rewritten) {
        const trimmed = trimBaseForAppend(baseText, MAX_BULLET_LENGTH - selected.phrase.length - 2);
        rewritten  = appendPhrase(trimmed, selected.phrase);
        changeType = 'bullet_optimized';
      }
    }
  } else {
    // Append mode: (#5) try conservative template first if standard append looks risky
    const template = findConservativeTemplate(selected.signal, baseText);
    if (template) {
      const tplText  = applyConservativeTemplate(template.template);
      const tplValid = validateRewrittenBullet(original, tplText);
      if (tplValid.valid) {
        rewritten  = tplText;
        changeType = 'bullet_rewritten';
        appliedTemplate = template;
      }
    }
    if (!rewritten) {
      const trimmed = trimBaseForAppend(baseText, MAX_BULLET_LENGTH - selected.phrase.length - 2);
      rewritten  = appendPhrase(trimmed, selected.phrase);
    }
  }

  // Hard cap
  if (!rewritten || rewritten.length > MAX_BULLET_LENGTH) {
    return {
      bullet: normaliseBulletSentence(baseText),
      reason: baseText !== original
        ? 'Cleaned action verb; result was too long for phrase injection.'
        : undefined,
    };
  }

  // Final validation
  const finalValidation = validateRewrittenBullet(original, rewritten);
  if (!finalValidation.valid) {
    return {
      bullet:           normaliseBulletSentence(baseText),
      reason:           `Rejected unsafe rewrite (${finalValidation.reason}). Applied verb/tense cleanup only.`,
      jdSignal:         selected.signal,
      jdSignalStrength: keywordStrengthForSignal,
      riskLevel:        'not_recommended',
      evidenceSource:   buildEvidenceSource(role, bulletIndex),
      changeType,
    };
  }

  // (#13) Mark the actual injected wording globally.
  // Track appended phrases, inline rewrites, conservative templates, and the final rewritten bullet signature.
  markSignalUsed(roleUsage, globalUsage, selected.signal);
  phraseTracker.mark(selected.phrase);
  if (selected.inlineRewrite) phraseTracker.mark(selected.inlineRewrite);
  if (appliedTemplate?.template) phraseTracker.mark(appliedTemplate.template);
  phraseTracker.mark(rewritten);

  // Risk level (#9)
  const directMatch = safeKeywordsWithStrength.some(
    ({ keyword, strength }) =>
      strength === 'explicit' && canonical(original).includes(canonical(keyword)),
  );
  const riskLevel: RiskLevel =
    selected.riskLevel === 'safe' && (directMatch || keywordStrengthForSignal === 'explicit')
      ? 'safe'
      : 'medium';

  return {
    bullet:           normaliseBulletSentence(rewritten),
    reason:           selected.reason,
    jdSignal:         selected.signal,
    jdSignalStrength: keywordStrengthForSignal,
    riskLevel,
    evidenceSource:   buildEvidenceSource(role, bulletIndex),
    changeType,
  };
};

const appendPhrase = (value: string, phrase: string): string =>
  normaliseBulletSentence(`${value.replace(/[.\s]+$/, '')}, ${phrase}`);

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
// Recency-weighted bullet caps (#4/#11)
// ============================================================

const maxBulletsForRole = (roleIndex: number, currentCount: number): number => {
  const budgetByRecency = [6, 5, 4, 3, 2, 2]; // tightened vs previous version per (#11)
  const recencyBudget   = budgetByRecency[Math.min(roleIndex, budgetByRecency.length - 1)];
  return Math.min(recencyBudget, currentCount + 2);
};

// ============================================================
// Per-role optimiser
// ============================================================

const isRolePast = (role: ExperienceItem): boolean => {
  const years = String(role.years ?? '').trim();

  if (/\b(present|current|now)\b/i.test(years)) {
    return false;
  }

  if (/\d{4}/.test(years)) {
    return true;
  }

  return true;
};

const optimizeRoleBullets = (
  role: ExperienceItem,
  roleIndex: number,
  safeKeywordsWithStrength: KeywordWithStrength[],
  changes: TailoringChange[],
  globalUsage: Record<string, number>,
  phraseTracker: ReturnType<typeof buildPhraseTracker>,
  analysis?: AnalysisRecordLike | null,
): string[] => {
  const roleUsage:  Record<string, number> = {};
  const isPastRole  = isRolePast(role); // (#6/#7) derive past/current from role.years, not role index
  const cleanedBullets = normalizeBullets(role, changes);

  // Bullet splitting (#6)
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
          reason:      `Split long bullet into ${parts.length} shorter points (part ${partIdx + 1}) to improve scannability.`,
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
      bullet, role, safeKeywordsWithStrength,
      roleUsage, globalUsage, phraseTracker,
      index, isPastRole, analysis,
    );

    if (
      optimized.reason &&
      optimized.riskLevel !== 'not_recommended' &&
      optimized.bullet !== bullet
    ) {
      changes.push({
        type:             optimized.changeType ?? 'bullet_optimized',
        section:          'experience',
        roleId:           role.id,
        roleTitle:        role.jobTitle,
        company:          role.company,
        bulletIndex:      index,
        before:           bullet,
        after:            normaliseBulletSentence(optimized.bullet),
        reason:           optimized.reason,
        riskLevel:        optimized.riskLevel ?? 'safe',
        evidenceSource:   optimized.evidenceSource ?? buildEvidenceSource(role, index),
        jdSignal:         optimized.jdSignal,
        jdSignalStrength: optimized.jdSignalStrength,
      });
      return normaliseBulletSentence(optimized.bullet);
    }

    return normaliseBulletSentence(bullet);
  });

  const maxBullets = maxBulletsForRole(roleIndex, role.bullets?.length ?? 0);

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
  phraseTracker: ReturnType<typeof buildPhraseTracker>,
  analysis?: AnalysisRecordLike | null,
): ExperienceItem[] => {
  const globalUsage: Record<string, number> = {};

  return experience.map((role, roleIndex) => ({
    ...role,
    bullets: optimizeRoleBullets(
      role, roleIndex, safeKeywordsWithStrength,
      changes, globalUsage, phraseTracker, analysis,
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
    splitLines(value).filter((item) => !missingKeys.has(canonical(item))).join('\n');
  return {
    technicalSkills:        safe(skillsAwards.technicalSkills),
    languages:              safe(skillsAwards.languages),
    trainingCertifications: safe(skillsAwards.trainingCertifications),
    awards:                 safe(skillsAwards.awards),
  };
};

// ============================================================
// (#20) Final CV quality checker
// ============================================================


const WEAK_BULLET_INDICATORS =
  /^(helped|worked|did|handled|assisted|was involved|participated|made sure|tried|used to|would|could)/i;

const buildQualityReport = (
  resume: ResumeBuilderState,
  safeKeywords: string[],
  trackedPhrases: string[] = [],
): CVQualityReport => {
  const issues: QualityIssue[] = [];
  const phraseCounts = new Map<string, number>();

  for (const role of resume.experience ?? []) {
    const roleName = `${role.jobTitle ?? 'Role'} at ${role.company ?? 'Company'}`;
    const bullets  = role.bullets ?? [];

    // Too many bullets (#11)
    if (bullets.length > 6) {
      issues.push({
        severity: 'warning',
        category: 'too_many_bullets',
        message:  `${roleName} has ${bullets.length} bullets. Consider reducing to 4–6 for readability.`,
        location: roleName,
      });
    }

    for (const [bIdx, bullet] of bullets.entries()) {
      const location = `${roleName} → Bullet ${bIdx + 1}`;
      const value    = clean(bullet);

      // Broken bullet
      if (BAD_REWRITE_PATTERNS.some((r) => r.pattern.test(value))) {
        issues.push({
          severity: 'error',
          category: 'broken_bullet',
          message:  `Broken sentence structure detected: "${value.slice(0, 80)}…"`,
          location,
        });
      }

      // Wrong tense (past role, present-tense verb)
      if (isRolePast(role) && /^(Act|Manage|Resolve|Monitor|Support|Handle|Provide|Track)\b/.test(value)) {
        issues.push({
          severity: 'warning',
          category: 'wrong_tense',
          message:  `Bullet appears to use present tense in a past role: "${value.slice(0, 60)}…"`,
          location,
        });
      }

      // Present-participle start
      if (/^(Monitoring|Maintaining|Supporting|Using|Ensuring|Sharing|Managing)\b/.test(value)) {
        issues.push({
          severity: 'warning',
          category: 'wrong_tense',
          message:  `Bullet starts with a present participle — convert to past tense: "${value.slice(0, 60)}…"`,
          location,
        });
      }

      // Overused JD phrases: count the phrases actually injected by this tailoring run.
      for (const trackedPhrase of trackedPhrases) {
        const tracked = clean(trackedPhrase);
        if (!tracked || tracked.length < 8) continue;

        if (canonical(value).includes(canonical(tracked))) {
          const key = canonical(tracked);
          const count = (phraseCounts.get(key) ?? 0) + 1;
          phraseCounts.set(key, count);

          if (count > 1) {
            issues.push({
              severity: 'warning',
              category: 'overused_jd_phrase',
              message: `Phrase "${tracked}" appears more than once across the CV.`,
              location,
            });
          }
        }
      }

      // Weak bullet start
      if (WEAK_BULLET_INDICATORS.test(value)) {
        issues.push({
          severity: 'info',
          category: 'weak_bullet',
          message:  `Bullet starts with a weak verb: "${value.slice(0, 60)}…" — consider a stronger action verb.`,
          location,
        });
      }

      // Unsupported claim check
      for (const blocked of UNSUPPORTED_INDUSTRY_SKILLS) {
        if (canonical(value).includes(blocked)) {
          issues.push({
            severity: 'error',
            category: 'unsupported_claim',
            message:  `Bullet may contain an unsupported industry-specific claim. Verify this is in the Master CV: "${value.slice(0, 80)}…"`,
            location,
          });
        }
      }
    }
  }

  // Missing JD keywords
  const allBulletText = (resume.experience ?? [])
    .flatMap((r) => r.bullets ?? [])
    .join(' ')
    .toLowerCase();

  const allSkillsText = [
    resume.skillsAwards?.technicalSkills ?? '',
    resume.skillsAwards?.languages ?? '',
    resume.skillsAwards?.trainingCertifications ?? '',
  ].join(' ').toLowerCase();

  const combined = `${allBulletText} ${allSkillsText}`;

  for (const keyword of safeKeywords) {
    if (!combined.includes(canonical(keyword))) {
      issues.push({
        severity: 'info',
        category: 'missing_jd_keyword',
        message:  `JD keyword "${keyword}" does not appear in any bullet or skill. Consider adding it if supported.`,
      });
    }
  }

  // Score: start at 100, deduct per issue
  const deductions = issues.reduce((sum, issue) => {
    if (issue.severity === 'error')   return sum + 8;
    if (issue.severity === 'warning') return sum + 3;
    return sum + 1;
  }, 0);

  const score  = Math.max(0, Math.min(100, 100 - deductions));
  const passed = score >= 70 && issues.filter((i) => i.severity === 'error').length === 0;

  return { score, passed, issues };
};

// ============================================================
// Public entry point
// ============================================================

export const optimizeResumeForJob = ({
  resume,
  analysis,
}: OptimizeResumeForJobInput): OptimizeResumeForJobResult => {
  const changes: TailoringChange[] = [];

  const safeKeywordsWithStrength = getSafeJdKeywordsWithStrength(analysis);
  const safeKeywords             = safeKeywordsWithStrength.map((k) => k.keyword);
  const skippedMissingKeywords   = getSkippedMissingKeywords(analysis);
  const jobFamily                = detectJobFamily(analysis); // (#12)
  const phraseTracker            = buildPhraseTracker();     // (#13)

  // (#2/#19) Surface claimable gaps before stripping them
  const claimableGaps = buildClaimableGaps(skippedMissingKeywords, resume.experience);

  const optimizedSkills = buildSkillsAwards(
    removeUnsafeMissingFromSkills(resume.skillsAwards, skippedMissingKeywords),
    safeKeywords,
    changes,
    jobFamily,
  );

  const optimizedExperience = optimizeExperience(
    resume.experience,
    safeKeywordsWithStrength,
    changes,
    phraseTracker,
    analysis,
  );

  const tailoredResume: ResumeBuilderState = {
    ...resume,
    experience:   optimizedExperience,
    skillsAwards: optimizedSkills,
  };

  // (#20) Run quality checker on the final output
  const qualityReport = buildQualityReport(
    tailoredResume,
    safeKeywords,
    phraseTracker.getAll(),
  );

  return {
    resume:                tailoredResume,
    changes,
    usedKeywords:          safeKeywords,
    skippedMissingKeywords,
    claimableGaps,
    qualityReport,
  };
};