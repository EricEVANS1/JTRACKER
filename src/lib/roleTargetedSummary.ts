// src/lib/roleTargetedSummary.ts
// Role-targeted, evidence-controlled Professional Summary Generator.
// Master CV = source of truth. JD = targeting guide.

import type {
  AnalysisRecord,
  ResumeBuilderState,
} from '../types/resumeBuilder';

export type DetailedRoleFamily =
  | 'operations'
  | 'qa'
  | 'software'
  | 'support'
  | 'data'
  | 'cyber'
  | 'general';

export type SummaryClassifiedSkillLike = {
  keyword?: string | null;
  bucket?: string | null;
  confidence?: number | null;
  requiresReview?: boolean | null;
  autoAddToSummary?: boolean | null;
};

export type SummaryInput = {
  resume: ResumeBuilderState;
  analysis?: Partial<AnalysisRecord> | null;
  jobTitle?: string | null;
  classifiedSkills?: SummaryClassifiedSkillLike[];
  originalSummary?: string | null;
};

export type SummaryResult = {
  summary: string;
  usedSkills: string[];
  roleFamily: DetailedRoleFamily;
  experienceAnchor: string;
};

const ROLE_FAMILY_PATTERNS: Array<{ pattern: RegExp; family: DetailedRoleFamily }> = [
  { pattern: /\b(operations|ops|infrastructure|site reliability|sre|devops|server admin|system admin|systems admin)\b/i, family: 'operations' },
  { pattern: /\b(qa|quality|tester|testing|test engineer|automation qa|game tester)\b/i, family: 'qa' },
  { pattern: /\b(software engineer|software developer|developer|programmer|full.?stack|frontend|front-end|backend|back-end|react|node|typescript)\b/i, family: 'software' },
  { pattern: /\b(support|help desk|service desk|desktop|it support|technical support|application support|customer support)\b/i, family: 'support' },
  { pattern: /\b(data analyst|data scientist|business intelligence|bi\b|analytics|reporting analyst)\b/i, family: 'data' },
  { pattern: /\b(security|cybersecurity|information security|iam|identity access|soc|secops)\b/i, family: 'cyber' },
];

const NON_SOFTWARE_UNSAFE_SKILLS = new Set([
  'typescript',
  'javascript',
  'react',
  'node',
  'node.js',
  'frontend',
  'backend',
  'full stack',
  'software development',
  'coding',
  'programming',
  'github',
]);

const HIGH_RISK_SKILLS = new Set([
  'access control',
  'video surveillance',
  'lenel',
  'electronic security',
  'microsoft sql server',
  'sql server',
  'postgresql',
  'aws',
  'azure',
  'azure devops',
  'docker',
  'ansible',
  'bash',
  'powershell',
  'nginx',
  'iis',
  'aix',
  'vms',
  'retailer pos',
]);

const ROLE_FALLBACK_SKILLS: Record<DetailedRoleFamily, string[]> = {
  operations: [
    'IT operations support',
    'incident handling',
    'operating systems',
    'service monitoring',
    'documentation',
  ],
  support: [
    'technical troubleshooting',
    'incident handling',
    'ticket handling',
    'customer communication',
    'escalation support',
  ],
  qa: [
    'manual testing',
    'defect reporting',
    'test case execution',
    'documentation',
    'quality validation',
  ],
  software: [
    'web application development',
    'databases',
    'structured problem solving',
    'collaboration',
    'maintainable solutions',
  ],
  data: [
    'data analysis',
    'reporting',
    'analytical thinking',
    'stakeholder communication',
    'problem solving',
  ],
  cyber: [
    'security awareness',
    'incident handling',
    'risk-focused thinking',
    'documentation',
    'system protection',
  ],
  general: [
    'problem solving',
    'documentation',
    'communication',
    'collaboration',
    'adaptability',
  ],
};

const SUMMARY_TEMPLATES: Record<DetailedRoleFamily, string> = {
  operations:
    '{role} candidate with experience in {experience}, incident handling, and infrastructure-related troubleshooting. Skilled in {skills}. Strong communicator with an analytical mindset and experience working with technical teams to resolve operational issues.',
  support:
    '{role} with experience troubleshooting user issues, handling incidents, managing tickets, and supporting escalations. Skilled in {skills}. Strong customer communicator with a structured approach to documentation, problem solving, and service quality.',
  qa:
    '{role} with experience in {experience}, defect reporting, test execution, and user-focused quality validation. Skilled in {skills}. Detail-oriented and able to document issues clearly, reproduce defects, and support product quality improvements.',
  software:
    '{role} with experience building technical projects, working with databases, and applying structured problem solving to application development. Skilled in {skills}. Able to learn quickly, collaborate with teams, and deliver maintainable solutions.',
  data:
    '{role} with experience in {experience}, data analysis, and reporting. Skilled in {skills}. Able to translate information into actionable insights and communicate findings clearly to stakeholders.',
  cyber:
    '{role} with experience in {experience}, incident handling, and security-focused support. Skilled in {skills}. Strong communicator with a focus on protecting systems and data through structured investigation and documentation.',
  general:
    '{role} with experience in {experience} and {skills}. Strong communicator with a problem-solving mindset and ability to adapt quickly to new tools and environments.',
};

const cleanText = (value?: string | null): string =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

const sentenceCase = (value: string): string => {
  const clean = cleanText(value);
  if (!clean) return clean;
  return clean.charAt(0).toUpperCase() + clean.slice(1);
};

const normaliseSummary = (value: string): string => {
  let summary = cleanText(value)
    .replace(/\s+,/g, ',')
    .replace(/,\s*,/g, ', ')
    .replace(/\s+\./g, '.')
    .replace(/\.\s*\./g, '.')
    .replace(/\bSkilled in\.\s*/gi, '')
    .trim();

  summary = summary
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentenceCase(sentence.trim()))
    .filter(Boolean)
    .join(' ');

  if (summary && !/[.!?]$/.test(summary)) summary += '.';

  const sentences = summary.match(/[^.!?]+[.!?]+/g) ?? [summary];
  if (sentences.length > 3) summary = sentences.slice(0, 3).join(' ');

  const words = summary.split(/\s+/).filter(Boolean);
  if (words.length > 75) {
    summary = words.slice(0, 75).join(' ').replace(/[,;:]$/, '');
    if (!/[.!?]$/.test(summary)) summary += '.';
  }

  return summary;
};

const canonical = (value?: string | null): string =>
  cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9+#./\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const unique = (values: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values.map(cleanText).filter(Boolean)) {
    const key = canonical(value);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(value);
    }
  }

  return out;
};

const humanList = (items: string[]): string => {
  const clean = unique(items).slice(0, 5);
  if (!clean.length) return '';
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(', ')}, and ${clean[clean.length - 1]}`;
};

const cleanJobTitle = (value?: string | null): string => {
  const raw = cleanText(value);
  if (!raw) return '';

  const roleMatch = raw.match(
    /\bAs\s+(?:a|an)\s+([^,.]+?)(?:,|\syou\s+will|\syou'll|\sresponsible|\syour\s)/i,
  );

  const candidate = roleMatch?.[1] || raw.split(',')[0] || raw;

  const lower = candidate.toLowerCase();
  const badSignals = [
    'you will',
    'responsible for',
    'we are looking',
    'the role',
    'this role',
    'join us',
    'your tasks',
  ];

  if (candidate.length > 80 || badSignals.some((signal) => lower.includes(signal))) {
    return '';
  }

  return candidate.trim();
};

export const detectDetailedRoleFamily = (jobTitle?: string | null): DetailedRoleFamily => {
  const title = cleanText(jobTitle);

  for (const item of ROLE_FAMILY_PATTERNS) {
    if (item.pattern.test(title)) return item.family;
  }

  return 'general';
};

const getAnalysisRoleTitle = (analysis?: Partial<AnalysisRecord> | null): string => {
  const extended = (analysis?.extended_data ?? {}) as Record<string, unknown>;

  return cleanJobTitle(
    analysis?.job_title ||
      String(extended.job_title ?? '') ||
      String(extended.target_role ?? '') ||
      String(extended.role_category ?? ''),
  );
};

const inferRoleFromResume = (resume: ResumeBuilderState): string =>
  cleanJobTitle(
    resume.personal.jobTitle ||
      resume.experience?.[0]?.jobTitle ||
      'Technical Professional',
  );

const displaySkill = (skill: string): string => {
  const key = canonical(skill);

  const names: Record<string, string> = {
    'sql': 'SQL basics',
    'sql basics': 'SQL basics',
    'ip networking': 'IP networking basics',
    'tcp/ip': 'IP networking basics',
    'windows': 'Windows',
    'operating systems': 'operating systems',
    'technical support': 'technical support',
    'it operations support': 'IT operations support',
    'incident handling': 'incident handling',
    'ticket handling': 'ticket handling',
    'service monitoring': 'service monitoring',
    'active directory': 'Active Directory',
    'microsoft 365': 'Microsoft 365',
    'office 365': 'Microsoft 365',
    'jira': 'Jira',
    'zendesk': 'Zendesk',
    'documentation': 'documentation',
    'customer communication': 'customer communication',
    'collaboration': 'collaboration',
    'analytical thinking': 'analytical thinking',
    'problem solving': 'problem solving',
    'troubleshooting': 'troubleshooting',
    'connectivity troubleshooting': 'connectivity troubleshooting',
    'escalation support': 'escalation support',
  };

  return names[key] ?? cleanText(skill);
};

const isSafeForRoleFamily = (skill: string, roleFamily: DetailedRoleFamily): boolean => {
  const key = canonical(skill);

  if (roleFamily !== 'software' && NON_SOFTWARE_UNSAFE_SKILLS.has(key)) {
    return false;
  }

  if (HIGH_RISK_SKILLS.has(key)) {
    return false;
  }

  return true;
};

export const getSummarySafeSkills = (
  classifiedSkills: SummaryClassifiedSkillLike[] = [],
  roleFamily: DetailedRoleFamily = 'general',
): string[] => {
  return unique(
    classifiedSkills
      .filter((skill) => {
        const bucket = canonical(skill.bucket);
        const confidence = typeof skill.confidence === 'number' ? skill.confidence : 0;

        return (
          Boolean(skill.keyword) &&
          ['confirmed', 'jd_matched'].includes(bucket) &&
          confidence >= 0.7 &&
          !skill.requiresReview
        );
      })
      .map((skill) => displaySkill(skill.keyword ?? ''))
      .filter((skill) => isSafeForRoleFamily(skill, roleFamily)),
  ).slice(0, 5);
};

const extractExperienceAnchor = (
  resume: ResumeBuilderState,
  roleFamily: DetailedRoleFamily,
): string => {
  const latestRole = resume.experience?.[0];

  if (latestRole?.jobTitle) {
    const role = cleanText(latestRole.jobTitle);
    const company = cleanText(latestRole.company);

    if (company) return `${role} at ${company}`;
    return role;
  }

  const fallback: Record<DetailedRoleFamily, string> = {
    operations: 'IT support and operational troubleshooting',
    support: 'technical support and customer-facing troubleshooting',
    qa: 'manual testing and defect reporting',
    software: 'web application development and technical projects',
    data: 'analysis, reporting, and structured problem solving',
    cyber: 'technical support, incident handling, and security awareness',
    general: 'technical support, documentation, and problem solving',
  };

  return fallback[roleFamily];
};

const removeUnsafeSkillMentions = (
  summary: string,
  roleFamily: DetailedRoleFamily,
): string => {
  let output = summary;

  const unsafe =
    roleFamily === 'software'
      ? [...HIGH_RISK_SKILLS]
      : [...HIGH_RISK_SKILLS, ...NON_SOFTWARE_UNSAFE_SKILLS];

  for (const term of unsafe) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    output = output.replace(new RegExp(`\\b${escaped}\\b\\s*,?\\s*`, 'gi'), '');
  }

  return output
    .replace(/,\s*,/g, ', ')
    .replace(/,\s*\./g, '.')
    .replace(/\bSkilled in\s*\./gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
};

export const buildRoleTargetedSummary = (
  input: SummaryInput,
): SummaryResult => {
  const role =
    cleanJobTitle(input.jobTitle) ||
    getAnalysisRoleTitle(input.analysis) ||
    inferRoleFromResume(input.resume);

  const roleFamily = detectDetailedRoleFamily(role);
  const safeSkills = getSummarySafeSkills(input.classifiedSkills ?? [], roleFamily);
  const fallbackSkills = ROLE_FALLBACK_SKILLS[roleFamily].filter((skill) =>
    isSafeForRoleFamily(skill, roleFamily),
  );

  const usedSkills = safeSkills.length
    ? safeSkills
    : fallbackSkills.slice(0, 5);

  const skillsText = humanList(usedSkills);
  const experienceAnchor = extractExperienceAnchor(input.resume, roleFamily);

  const template = SUMMARY_TEMPLATES[roleFamily] ?? SUMMARY_TEMPLATES.general;

  const summary = normaliseSummary(
    removeUnsafeSkillMentions(
      template
        .replace(/\{role\}/g, role)
        .replace(/\{experience\}/g, experienceAnchor)
        .replace(/\{skills\}/g, skillsText || 'technical troubleshooting and problem solving'),
      roleFamily,
    ),
  );

  return {
    summary,
    usedSkills,
    roleFamily,
    experienceAnchor,
  };
};
