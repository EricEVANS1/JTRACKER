// src/lib/skillClassifier.ts
// JTracker Skill Intelligence
//
// Goal:
// - Master CV = truth source.
// - Job Description = targeting source.
// - Auto-add only JD skills that are supported by Master CV evidence.
// - Keep unsupported JD skills as optional gaps, not fake CV claims.

import type { ResumeBuilderState } from '../types/resumeBuilder';

export type SkillBucket =
  | 'confirmed'
  | 'jd_matched'
  | 'suggested'
  | 'missing'
  | 'review_required'
  | 'blocked';

export type SkillEvidenceSource =
  | 'master_skills'
  | 'master_summary'
  | 'master_experience'
  | 'master_projects'
  | 'master_education'
  | 'jd_matched_keywords'
  | 'jd_partial_keywords'
  | 'jd_missing_keywords'
  | 'jd_description'
  | 'blocked_rules'
  | 'inferred';

export type ClassifiedSkill = {
  keyword: string;
  bucket: SkillBucket;
  source: SkillEvidenceSource;
  evidence?: string;
  suggestion?: string;
  reason: string;
  confidence: number;
  autoAddToSummary: boolean;
  autoAddToSkills: boolean;
  requiresReview: boolean;
};

export type SkillBuckets = {
  confirmedSkills: ClassifiedSkill[];
  jdMatchedSkills: ClassifiedSkill[];
  suggestedSkills: ClassifiedSkill[];
  missingSkills: ClassifiedSkill[];
  reviewRequiredSkills: ClassifiedSkill[];
  blockedSkills: ClassifiedSkill[];
};

export type AnalysisRecordLike = {
  job_title?: string | null;
  jobTitle?: string | null;
  job_description?: string | null;
  jobDescription?: string | null;
  matched_keywords?: string[] | null;
  partial_keywords?: string[] | null;
  missing_keywords?: string[] | null;
  ats_keyword_evidence?: Array<{
    keyword?: string | null;
    status?: string | null;
    evidence?: string | null;
  }> | null;
  extended_data?: Record<string, unknown> | null;
};

type SkillRisk = 'safe' | 'medium' | 'specific' | 'blocked';

type SkillDefinition = {
  name: string;
  aliases: string[];
  category:
    | 'tool'
    | 'platform'
    | 'system'
    | 'networking'
    | 'database'
    | 'language'
    | 'support'
    | 'soft'
    | 'developer'
    | 'domain';
  risk: SkillRisk;
  requiresExactEvidence?: boolean;
  preferredCvLabel?: string;
  suggestion?: string;
};

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'in',
  'into',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
  'you',
  'your',
]);

const SUPPORT_ROLE_PATTERNS = [
  /\btechnical support\b/i,
  /\bit support\b/i,
  /\bhelp desk\b/i,
  /\bservice desk\b/i,
  /\bapplication support\b/i,
  /\bsupport engineer\b/i,
  /\bsupport specialist\b/i,
  /\bcustomer support\b/i,
  /\bdesktop support\b/i,
  /\boperations support\b/i,
];

const DEVELOPER_JD_PATTERNS = [
  /\btypescript\b/i,
  /\bjavascript\b/i,
  /\breact\b/i,
  /\bnode\b/i,
  /\bfrontend\b/i,
  /\bbackend\b/i,
  /\bfull.?stack\b/i,
  /\bsoftware development\b/i,
  /\bprogramming\b/i,
  /\bcoding\b/i,
];

const LABEL_PREFIX_REGEX =
  /^(languages?|technical skills?|soft skills?|tools?|platforms?|systems?|networking|support competencies|technical support competencies|certifications?|awards?|databases?)\s*:\s*/i;

export const canonical = (value: string | null | undefined): string => {
  return String(value ?? '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9+#./\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const unique = (values: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const clean = value.trim();
    const key = canonical(clean);

    if (clean && key && !seen.has(key)) {
      seen.add(key);
      out.push(clean);
    }
  }

  return out;
};

const uniqueByCanonical = <T extends { keyword: string }>(items: T[]): T[] => {
  const seen = new Set<string>();
  const out: T[] = [];

  for (const item of items) {
    const key = canonical(item.keyword);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }

  return out;
};

const normaliseSkillCandidate = (value: string): string => {
  return String(value ?? '')
    .replace(/^[-•]\s*/, '')
    .replace(LABEL_PREFIX_REGEX, '')
    .replace(/\s+/g, ' ')
    .trim();
};

const splitSkillList = (value: string | string[] | null | undefined): string[] => {
  if (Array.isArray(value)) return value.flatMap((item) => splitSkillList(item));

  return String(value ?? '')
    .split(/\n|,|;|\|/)
    .map(normaliseSkillCandidate)
    .filter(Boolean);
};

const stringifyUnknown = (value: unknown): string => {
  if (!value) return '';

  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  if (Array.isArray(value)) {
    return value.map(stringifyUnknown).filter(Boolean).join('\n');
  }

  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>)
      .map(stringifyUnknown)
      .filter(Boolean)
      .join('\n');
  }

  return '';
};

const getAnalysisText = (analysis: AnalysisRecordLike): string => {
  return [
    analysis.job_title,
    analysis.jobTitle,
    analysis.job_description,
    analysis.jobDescription,
    stringifyUnknown(analysis.extended_data),
    ...(analysis.matched_keywords ?? []),
    ...(analysis.partial_keywords ?? []),
    ...(analysis.missing_keywords ?? []),
    ...(analysis.ats_keyword_evidence ?? []).map((item) => item.keyword ?? ''),
  ]
    .filter(Boolean)
    .join('\n');
};

const wordsOf = (value: string): string[] => {
  return canonical(value)
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word));
};

const SKILL_LIBRARY: SkillDefinition[] = [
  // Core support skills
  {
    name: 'Technical support',
    aliases: ['technical support', 'it support', 'help desk', 'service desk', 'application support', 'support engineer', 'support specialist'],
    category: 'support',
    risk: 'safe',
  },
  {
    name: 'Troubleshooting',
    aliases: ['troubleshooting', 'troubleshoot', 'diagnose', 'diagnosis', 'diagnostics', 'problem solving'],
    category: 'support',
    risk: 'safe',
  },
  {
    name: 'Incident handling',
    aliases: ['incident', 'incidents', 'incident management', 'incident response', 'service incident'],
    category: 'support',
    risk: 'safe',
  },
  {
    name: 'Ticket handling',
    aliases: ['ticketing', 'tickets', 'ticket management', 'case handling', 'case management', 'call management database'],
    category: 'support',
    risk: 'safe',
  },
  {
    name: 'Escalation support',
    aliases: ['escalation', 'escalate', 'escalated', 'second line', 'engineering escalation'],
    category: 'support',
    risk: 'safe',
  },
  {
    name: 'Documentation',
    aliases: ['documentation', 'documented', 'case notes', 'knowledge base', 'kb', 'handover notes', 'resolution notes', 'runbook', 'procedures', 'checklists'],
    category: 'support',
    risk: 'safe',
  },
  {
    name: 'Customer communication',
    aliases: ['customer communication', 'client communication', 'stakeholder communication', 'verbal communication', 'written communication', 'customer service'],
    category: 'soft',
    risk: 'safe',
  },
  {
    name: 'Collaboration',
    aliases: ['collaboration', 'cross-functional collaboration', 'teamwork', 'worked with', 'collaborated', 'engineering team', 'product team', 'teams'],
    category: 'soft',
    risk: 'safe',
  },
  {
    name: 'Service monitoring',
    aliases: ['monitoring', 'service monitoring', 'system monitoring', 'network monitoring', 'server monitoring', 'operational monitoring', 'critical service metrics', 'service metrics', 'alerts', 'dashboards'],
    category: 'support',
    risk: 'medium',
  },
  {
    name: 'Process improvement',
    aliases: ['process improvement', 'workflow improvement', 'continuous improvement', 'efficiency improvement', 'improved workflow'],
    category: 'support',
    risk: 'safe',
  },
  {
    name: 'SLA support',
    aliases: ['sla', 'service level agreement', 'service level agreements', 'sla compliance'],
    category: 'support',
    risk: 'safe',
  },

  // Tools and platforms
  {
    name: 'Microsoft 365',
    aliases: ['microsoft 365', 'office 365', 'o365', 'm365', 'microsoft office'],
    category: 'tool',
    risk: 'safe',
  },
  {
    name: 'Microsoft Teams',
    aliases: ['microsoft teams', 'teams'],
    category: 'tool',
    risk: 'safe',
  },
  {
    name: 'Outlook',
    aliases: ['outlook', 'microsoft outlook'],
    category: 'tool',
    risk: 'safe',
  },
  {
    name: 'Excel',
    aliases: ['excel', 'microsoft excel', 'spreadsheets'],
    category: 'tool',
    risk: 'safe',
  },
  {
    name: 'Jira',
    aliases: ['jira', 'jira service management', 'atlassian jira'],
    category: 'tool',
    risk: 'safe',
  },
  {
    name: 'Confluence',
    aliases: ['confluence', 'atlassian confluence'],
    category: 'tool',
    risk: 'safe',
  },
  {
    name: 'Zendesk',
    aliases: ['zendesk'],
    category: 'tool',
    risk: 'safe',
  },
  {
    name: 'ServiceNow',
    aliases: ['servicenow', 'service now', 'itsm'],
    category: 'tool',
    risk: 'medium',
  },
  {
    name: 'Active Directory',
    aliases: ['active directory', 'ad', 'azure active directory', 'entra id'],
    category: 'platform',
    risk: 'medium',
  },
  {
    name: 'Citrix',
    aliases: ['citrix'],
    category: 'platform',
    risk: 'medium',
  },
  {
    name: 'VPN',
    aliases: ['vpn', 'virtual private network'],
    category: 'networking',
    risk: 'safe',
  },
  {
    name: 'Postman',
    aliases: ['postman'],
    category: 'tool',
    risk: 'medium',
  },
  {
    name: 'Git',
    aliases: ['git', 'version control'],
    category: 'developer',
    risk: 'medium',
    requiresExactEvidence: true,
  },

  // Systems and networking
  {
    name: 'Windows',
    aliases: ['windows', 'windows 10', 'windows 11', 'microsoft windows'],
    category: 'system',
    risk: 'safe',
  },
  {
    name: 'Operating systems',
    aliases: ['operating systems', 'operating system', 'os', 'system issues', 'software system connectivity issues', 'windows', 'windows 10', 'windows 11'],
    category: 'system',
    risk: 'safe',
  },
  {
    name: 'Connectivity troubleshooting',
    aliases: ['connectivity', 'connectivity troubleshooting', 'connection issues', 'network connectivity', 'software system connectivity'],
    category: 'networking',
    risk: 'safe',
  },
  {
    name: 'IP networking basics',
    aliases: ['ip networking', 'tcp/ip', 'ip network', 'networking basics', 'network troubleshooting', 'ports', 'protocols', 'computer networks'],
    category: 'networking',
    risk: 'medium',
  },
  {
    name: 'Linux basics',
    aliases: ['linux', 'linux basics', 'ubuntu', 'red hat', 'rhel'],
    category: 'system',
    risk: 'medium',
    requiresExactEvidence: true,
  },
  {
    name: 'Unix',
    aliases: ['unix'],
    category: 'system',
    risk: 'specific',
    requiresExactEvidence: true,
  },
  {
    name: 'Bash',
    aliases: ['bash', 'shell scripting', 'shell script'],
    category: 'system',
    risk: 'specific',
    requiresExactEvidence: true,
  },

  // Databases
  {
    name: 'SQL basics',
    aliases: ['sql', 'sql basics', 'mysql', 'mariadb', 'database basics', 'database queries', 'queries'],
    category: 'database',
    risk: 'medium',
  },
  {
    name: 'MySQL',
    aliases: ['mysql', 'mariadb'],
    category: 'database',
    risk: 'medium',
    requiresExactEvidence: true,
  },
  {
    name: 'PostgreSQL',
    aliases: ['postgresql', 'postgres'],
    category: 'database',
    risk: 'specific',
    requiresExactEvidence: true,
  },
  {
    name: 'Microsoft SQL Server',
    aliases: ['microsoft sql server', 'sql server', 'mssql'],
    category: 'database',
    risk: 'specific',
    requiresExactEvidence: true,
  },

  // Cloud / DevOps / developer
  {
    name: 'Docker',
    aliases: ['docker', 'containers', 'containerisation', 'containerization'],
    category: 'developer',
    risk: 'specific',
    requiresExactEvidence: true,
  },
  {
    name: 'AWS',
    aliases: ['aws', 'amazon web services'],
    category: 'platform',
    risk: 'specific',
    requiresExactEvidence: true,
  },
  {
    name: 'Azure',
    aliases: ['azure', 'microsoft azure'],
    category: 'platform',
    risk: 'specific',
    requiresExactEvidence: true,
  },
  {
    name: 'TypeScript',
    aliases: ['typescript'],
    category: 'developer',
    risk: 'specific',
    requiresExactEvidence: true,
  },
  {
    name: 'JavaScript',
    aliases: ['javascript', 'js'],
    category: 'developer',
    risk: 'specific',
    requiresExactEvidence: true,
  },
  {
    name: 'React',
    aliases: ['react', 'react.js', 'reactjs'],
    category: 'developer',
    risk: 'specific',
    requiresExactEvidence: true,
  },
  {
    name: 'Node.js',
    aliases: ['node', 'node.js', 'nodejs'],
    category: 'developer',
    risk: 'specific',
    requiresExactEvidence: true,
  },

  // Domain-specific claims that must not be invented
  {
    name: 'Access Control',
    aliases: ['access control', 'physical access control'],
    category: 'domain',
    risk: 'blocked',
    requiresExactEvidence: true,
  },
  {
    name: 'Video Surveillance',
    aliases: ['video surveillance', 'cctv', 'surveillance systems'],
    category: 'domain',
    risk: 'blocked',
    requiresExactEvidence: true,
  },
  {
    name: 'Lenel',
    aliases: ['lenel', 'onguard'],
    category: 'domain',
    risk: 'blocked',
    requiresExactEvidence: true,
  },
  {
    name: 'Electronic Security',
    aliases: ['electronic security', 'security products'],
    category: 'domain',
    risk: 'blocked',
    requiresExactEvidence: true,
  },
  {
    name: 'FTP/SFTP',
    aliases: ['ftp', 'sftp'],
    category: 'networking',
    risk: 'specific',
    requiresExactEvidence: true,
  },
  {
    name: 'Retailer POS',
    aliases: ['retailer pos', 'pos systems', 'point of sale'],
    category: 'domain',
    risk: 'blocked',
    requiresExactEvidence: true,
  },
  {
    name: 'AIX',
    aliases: ['aix'],
    category: 'system',
    risk: 'specific',
    requiresExactEvidence: true,
  },
  {
    name: 'VMS',
    aliases: ['vms'],
    category: 'system',
    risk: 'specific',
    requiresExactEvidence: true,
  },
];

const DEFINITION_BY_CANONICAL = new Map<string, SkillDefinition>();

for (const definition of SKILL_LIBRARY) {
  DEFINITION_BY_CANONICAL.set(canonical(definition.name), definition);
  for (const alias of definition.aliases) {
    DEFINITION_BY_CANONICAL.set(canonical(alias), definition);
  }
}

const definitionFor = (keyword: string): SkillDefinition | null => {
  const key = canonical(keyword);
  if (DEFINITION_BY_CANONICAL.has(key)) {
    return DEFINITION_BY_CANONICAL.get(key) ?? null;
  }

  return (
    SKILL_LIBRARY.find((definition) =>
      definition.aliases.some((alias) => canonical(alias) === key),
    ) ?? null
  );
};

const variantsForSkill = (keyword: string): string[] => {
  const definition = definitionFor(keyword);

  if (!definition) return [canonical(keyword)].filter(Boolean);

  return unique([definition.name, ...definition.aliases].map(canonical).filter(Boolean));
};

const textContainsCanonicalPhrase = (text: string, phrase: string): boolean => {
  const cleanText = ` ${canonical(text)} `;
  const cleanPhrase = canonical(phrase);

  if (!cleanPhrase) return false;

  if (cleanText.includes(` ${cleanPhrase} `)) return true;

  const phraseWords = wordsOf(cleanPhrase);
  if (phraseWords.length <= 1) return false;

  const textWords = new Set(wordsOf(cleanText));
  const matches = phraseWords.filter((word) => textWords.has(word));

  return matches.length / phraseWords.length >= 0.85;
};

const textContainsSkill = (text: string, keyword: string): boolean => {
  return variantsForSkill(keyword).some((variant) => textContainsCanonicalPhrase(text, variant));
};

const textContainsExactSkill = (text: string, keyword: string): boolean => {
  const definition = definitionFor(keyword);
  const exactVariants = definition ? [definition.name, ...definition.aliases] : [keyword];

  return exactVariants.some((variant) => {
    const cleanText = ` ${canonical(text)} `;
    const cleanVariant = canonical(variant);

    if (!cleanVariant) return false;
    return cleanText.includes(` ${cleanVariant} `);
  });
};

const readResumeTextParts = (resume: ResumeBuilderState): Array<{
  source: SkillEvidenceSource;
  text: string;
}> => {
  const parts: Array<{ source: SkillEvidenceSource; text: string }> = [];

  const skills = resume.skillsAwards;
  if (skills) {
    parts.push({
      source: 'master_skills',
      text: [
        skills.technicalSkills,
        skills.languages,
        skills.trainingCertifications,
        skills.awards,
      ].filter(Boolean).join('\n'),
    });
  }

  if (resume.summary) {
    parts.push({ source: 'master_summary', text: resume.summary });
  }

  for (const role of resume.experience ?? []) {
    parts.push({
      source: 'master_experience',
      text: [
        role.jobTitle,
        role.company,
        role.location,
        role.years,
        ...(role.bullets ?? []),
      ].filter(Boolean).join('\n'),
    });
  }

  for (const project of resume.projects ?? []) {
    parts.push({
      source: 'master_projects',
      text: [
        project.name,
        project.role,
        project.years,
        project.link,
        ...(project.bullets ?? []),
      ].filter(Boolean).join('\n'),
    });
  }

  for (const education of resume.education ?? []) {
    parts.push({
      source: 'master_education',
      text: [
        education.institution,
        education.degree,
        education.years,
        education.description,
      ].filter(Boolean).join('\n'),
    });
  }

  return parts;
};

const readResumeFullText = (resume: ResumeBuilderState): string =>
  readResumeTextParts(resume).map((part) => part.text).join('\n');

export const extractSkillsFromText = (value: string | null | undefined): string[] => {
  const text = String(value ?? '');
  if (!text.trim()) return [];

  const found: string[] = [];

  for (const definition of SKILL_LIBRARY) {
    if (definition.aliases.some((alias) => textContainsCanonicalPhrase(text, alias))) {
      found.push(definition.preferredCvLabel ?? definition.name);
    }
  }

  return unique(found);
};

export const findSkillEvidence = (
  keyword: string,
  resume: ResumeBuilderState,
): { source: SkillEvidenceSource; evidence: string } | null => {
  const definition = definitionFor(keyword);
  const requiresExact = Boolean(definition?.requiresExactEvidence);
  const parts = readResumeTextParts(resume);

  for (const part of parts) {
    const lines = part.text
      .split(/\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const matchingLine = lines.find((line) =>
      requiresExact ? textContainsExactSkill(line, keyword) : textContainsSkill(line, keyword),
    );

    if (matchingLine) {
      return {
        source: part.source,
        evidence: matchingLine.length > 220 ? `${matchingLine.slice(0, 220)}…` : matchingLine,
      };
    }

    const fullTextMatches = requiresExact
      ? textContainsExactSkill(part.text, keyword)
      : textContainsSkill(part.text, keyword);

    if (fullTextMatches) {
      return {
        source: part.source,
        evidence: part.text.length > 220 ? `${part.text.slice(0, 220)}…` : part.text,
      };
    }
  }

  return null;
};

export const skillExistsInMasterCV = (
  keyword: string,
  resume: ResumeBuilderState,
): boolean => Boolean(findSkillEvidence(keyword, resume));

const keywordInList = (keyword: string, values: string[] | null | undefined): boolean => {
  const target = definitionFor(keyword)?.name ?? keyword;

  return (values ?? []).some((value) => {
    const cleanValue = normaliseSkillCandidate(value);
    return (
      canonical(cleanValue) === canonical(target) ||
      canonical(cleanValue) === canonical(keyword) ||
      textContainsSkill(cleanValue, keyword)
    );
  });
};

const isSkillMentionedInJD = (keyword: string, analysis: AnalysisRecordLike): boolean => {
  const jdText = getAnalysisText(analysis);
  return textContainsSkill(jdText, keyword);
};

const isSupportRole = (analysis: AnalysisRecordLike): boolean => {
  const text = getAnalysisText(analysis);
  return SUPPORT_ROLE_PATTERNS.some((pattern) => pattern.test(text));
};

const jdExplicitlyRequiresDeveloperSkill = (
  keyword: string,
  analysis: AnalysisRecordLike,
): boolean => {
  const definition = definitionFor(keyword);

  if (definition?.category !== 'developer') return false;

  const jdText = getAnalysisText(analysis);
  return DEVELOPER_JD_PATTERNS.some((pattern) => pattern.test(jdText));
};

const isBlockedSkill = (
  keyword: string,
  resume: ResumeBuilderState,
  analysis: AnalysisRecordLike,
): boolean => {
  const definition = definitionFor(keyword);
  const hasEvidence = skillExistsInMasterCV(keyword, resume);

  if (definition?.risk === 'blocked' && !hasEvidence) {
    return true;
  }

  if (
    isSupportRole(analysis) &&
    definition?.category === 'developer' &&
    !jdExplicitlyRequiresDeveloperSkill(keyword, analysis)
  ) {
    return true;
  }

  return false;
};

export const extractSkillsFromAnalysis = (analysis: AnalysisRecordLike): string[] => {
  return unique([
    ...splitSkillList(analysis.matched_keywords),
    ...splitSkillList(analysis.partial_keywords),
    ...splitSkillList(analysis.missing_keywords),
    ...((analysis.ats_keyword_evidence ?? [])
      .map((item) => item.keyword)
      .filter(Boolean) as string[]),
    ...extractSkillsFromText(getAnalysisText(analysis)),
  ].map((skill) => definitionFor(skill)?.name ?? skill));
};

export const collectCandidateSkills = (
  resume: ResumeBuilderState,
  analysis: AnalysisRecordLike,
): string[] => {
  const existingSkills = [
    ...splitSkillList(resume.skillsAwards?.technicalSkills),
    ...splitSkillList(resume.skillsAwards?.languages),
    ...splitSkillList(resume.skillsAwards?.trainingCertifications),
    ...splitSkillList(resume.skillsAwards?.awards),
  ];

  const skillsFromMasterCvText = extractSkillsFromText(readResumeFullText(resume));
  const skillsFromJD = extractSkillsFromAnalysis(analysis);

  return unique(
    [...existingSkills, ...skillsFromMasterCvText, ...skillsFromJD]
      .map((item) => definitionFor(item)?.name ?? normaliseSkillCandidate(item))
      .filter(Boolean),
  );
};

const buildSuggestion = (keyword: string): string => {
  const definition = definitionFor(keyword);

  if (definition?.risk === 'blocked') {
    return 'Keep this out unless the Master CV clearly proves this specialist experience.';
  }

  if (definition?.requiresExactEvidence || definition?.risk === 'specific') {
    return `Add ${definition.name} only if the user confirms direct hands-on experience.`;
  }

  if (definition?.category === 'database') {
    return 'Add database wording only if the user actually ran queries or worked with databases.';
  }

  return 'Add this only if it is true to the user’s experience.';
};

const outputKeyword = (keyword: string): string => {
  const definition = definitionFor(keyword);
  return definition?.preferredCvLabel ?? definition?.name ?? normaliseSkillCandidate(keyword);
};

export const classifySkill = (
  keyword: string,
  resume: ResumeBuilderState,
  analysis: AnalysisRecordLike,
): ClassifiedSkill => {
  const cleanKeyword = outputKeyword(keyword);
  const definition = definitionFor(cleanKeyword);
  const evidence = findSkillEvidence(cleanKeyword, resume);
  const inMasterCV = Boolean(evidence);
  const inJD = isSkillMentionedInJD(cleanKeyword, analysis);

  const explicitlyMatched =
    keywordInList(cleanKeyword, analysis.matched_keywords) ||
    (analysis.ats_keyword_evidence ?? []).some(
      (item) =>
        textContainsSkill(item.keyword ?? '', cleanKeyword) &&
        ['matched', 'explicit', 'confirmed'].includes(canonical(item.status ?? '')),
    );

  const partiallyMatched =
    keywordInList(cleanKeyword, analysis.partial_keywords) ||
    (analysis.ats_keyword_evidence ?? []).some(
      (item) =>
        textContainsSkill(item.keyword ?? '', cleanKeyword) &&
        ['partial', 'inferred', 'suggested'].includes(canonical(item.status ?? '')),
    );

  const missing =
    keywordInList(cleanKeyword, analysis.missing_keywords) ||
    (inJD && !inMasterCV);

  if (isBlockedSkill(cleanKeyword, resume, analysis)) {
    return {
      keyword: cleanKeyword,
      bucket: 'blocked',
      source: 'blocked_rules',
      reason: `${cleanKeyword} is not proven by the Master CV and should not be inserted automatically.`,
      confidence: 0,
      autoAddToSummary: false,
      autoAddToSkills: false,
      requiresReview: true,
      suggestion: buildSuggestion(cleanKeyword),
    };
  }

  if (inMasterCV && inJD) {
    return {
      keyword: cleanKeyword,
      bucket: 'jd_matched',
      source: evidence?.source ?? 'master_skills',
      evidence: evidence?.evidence,
      reason: `${cleanKeyword} is required or useful for the JD and is supported by the Master CV.`,
      confidence: 0.95,
      autoAddToSummary: ['support', 'soft', 'system', 'networking', 'database', 'tool', 'platform'].includes(
        definition?.category ?? '',
      ),
      autoAddToSkills: true,
      requiresReview: false,
    };
  }

  if (inMasterCV) {
    return {
      keyword: cleanKeyword,
      bucket: 'confirmed',
      source: evidence?.source ?? 'master_skills',
      evidence: evidence?.evidence,
      reason: `${cleanKeyword} is supported by the Master CV.`,
      confidence: 0.85,
      autoAddToSummary: false,
      autoAddToSkills: false,
      requiresReview: false,
    };
  }

  if (explicitlyMatched) {
    return {
      keyword: cleanKeyword,
      bucket: 'review_required',
      source: 'jd_matched_keywords',
      reason: `${cleanKeyword} appears important for this JD, but it is not proven by the Master CV.`,
      confidence: 0.45,
      autoAddToSummary: false,
      autoAddToSkills: false,
      requiresReview: true,
      suggestion: buildSuggestion(cleanKeyword),
    };
  }

  if (partiallyMatched || inJD) {
    return {
      keyword: cleanKeyword,
      bucket: missing ? 'missing' : 'suggested',
      source: inJD ? 'jd_description' : 'jd_partial_keywords',
      reason: `${cleanKeyword} appears in the JD, but it is not proven by the Master CV.`,
      confidence: 0.3,
      autoAddToSummary: false,
      autoAddToSkills: false,
      requiresReview: true,
      suggestion: buildSuggestion(cleanKeyword),
    };
  }

  return {
    keyword: cleanKeyword,
    bucket: 'missing',
    source: 'inferred',
    reason: `${cleanKeyword} has no confirmed evidence in the Master CV.`,
    confidence: 0.1,
    autoAddToSummary: false,
    autoAddToSkills: false,
    requiresReview: true,
    suggestion: buildSuggestion(cleanKeyword),
  };
};

export const classifySkills = (
  resume: ResumeBuilderState,
  analysis: AnalysisRecordLike,
  keywords = collectCandidateSkills(resume, analysis),
): ClassifiedSkill[] => {
  return uniqueByCanonical(
    keywords
      .map((keyword) => classifySkill(keyword, resume, analysis))
      .filter((skill) => Boolean(skill.keyword)),
  );
};

export const bucketClassifiedSkills = (
  skills: ClassifiedSkill[],
): SkillBuckets => {
  return {
    confirmedSkills: skills.filter((skill) => skill.bucket === 'confirmed'),
    jdMatchedSkills: skills.filter((skill) => skill.bucket === 'jd_matched'),
    suggestedSkills: skills.filter((skill) => skill.bucket === 'suggested'),
    missingSkills: skills.filter((skill) => skill.bucket === 'missing'),
    reviewRequiredSkills: skills.filter((skill) => skill.bucket === 'review_required'),
    blockedSkills: skills.filter((skill) => skill.bucket === 'blocked'),
  };
};

export const getAutoSummarySkills = (
  skills: ClassifiedSkill[],
  limit = 5,
): string[] => {
  return skills
    .filter((skill) => skill.bucket === 'jd_matched' && skill.autoAddToSummary && !skill.requiresReview)
    .sort((a, b) => b.confidence - a.confidence)
    .map((skill) => skill.keyword)
    .slice(0, limit);
};

export const getAutoSkillsSectionItems = (
  skills: ClassifiedSkill[],
): string[] => {
  return skills
    .filter((skill) => skill.bucket === 'jd_matched' && skill.autoAddToSkills && !skill.requiresReview)
    .sort((a, b) => b.confidence - a.confidence)
    .map((skill) => skill.keyword);
};

export const getReviewRequiredSkillItems = (
  skills: ClassifiedSkill[],
): ClassifiedSkill[] => {
  return skills.filter((skill) => skill.bucket === 'review_required');
};

export const getClaimableGapItems = (
  skills: ClassifiedSkill[],
): ClassifiedSkill[] => {
  return skills.filter((skill) =>
    ['review_required', 'suggested', 'missing', 'blocked'].includes(skill.bucket),
  );
};
