// ============================================================
// smart-worker/index.ts
// v6.4.2 — safe tailored CV draft
//
// Stable features:
// - SSE streaming works
// - Dynamic JD parsing
// - Synonym matching
// - Role detection
// - Weighted scoring
// - Role-specific recommendations
// - Actionable missing-skill advice
// - Safe tailored CV draft
// - Simple ATS evidence
// - Safe Supabase save
//
// Disabled for stability:
// - LLM parsing
// - Heavy ATS matcher
// - cached structured_cv usage
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import {
  getCorsHeaders,
  sseHeaders,
  sendSse,
  errorResponse,
} from './_lib/cors.ts';

type AtsEvidenceStatus = 'matched' | 'partial' | 'missing';
type AtsEvidencePriority = 'critical' | 'required' | 'nice_to_have' | 'inferred';

type AtsEvidenceItem = {
  keyword: string;
  canonical: string;
  status: AtsEvidenceStatus;
  priority: AtsEvidencePriority;
  matched_as?: string | null;
  evidence: string[];
  reason?: string | null;
};

const deduplicateKeywords = (items: unknown[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of items) {
    const value = String(item ?? '').trim();
    const key = value.toLowerCase();

    if (!value || seen.has(key)) continue;

    seen.add(key);
    result.push(value);
  }

  return result;
};

const canonical = (keyword: unknown): string =>
  String(keyword ?? '')
    .toLowerCase()
    .replace(/[^\w\s.+#/:-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const safeArray = <T = any>(value: unknown): T[] =>
  Array.isArray(value) ? (value as T[]) : [];

const keywordSynonyms: Record<string, string[]> = {
  'Office 365': ['office 365', 'o365', 'microsoft 365', 'm365'],
  'Active Directory': ['active directory', 'ad', 'azure ad', 'entra id'],

  'Technical Support': [
    'technical support',
    'tech support',
    'support engineer',
    'technical support engineer',
    'troubleshooting',
    'diagnose',
    'diagnostics',
  ],

  'Customer Support': [
    'customer support',
    'customer service',
    'customer care',
    'client support',
    'customer experience',
    'customer success',
  ],

  'Application Support': [
    'application support',
    'app support',
    'production support',
    'software support',
    'platform support',
  ],

  'IT Support': [
    'it support',
    'help desk',
    'helpdesk',
    'service desk',
    'desktop support',
    'end user support',
  ],

  'Service Desk': [
    'service desk',
    'help desk',
    'helpdesk',
    '1st line',
    'first line',
    'l1 support',
  ],

  'Help Desk': ['help desk', 'helpdesk', 'service desk'],

  'Incident Management': [
    'incident management',
    'incidents',
    'incident handling',
    'incident resolution',
    'incident response',
  ],

  'Log Analysis': [
    'log analysis',
    'logs',
    'log review',
    'troubleshooting logs',
  ],

  Monitoring: ['monitoring', 'alerts', 'observability', 'alerting'],

  ServiceNow: ['servicenow', 'service now'],
  Jira: ['jira', 'atlassian jira', 'ticketing system'],
  Zendesk: ['zendesk', 'ticketing system'],
  CRM: ['crm', 'customer relationship management'],

  SQL: ['sql', 'mysql', 'postgresql', 'database queries', 'database'],
  MySQL: ['mysql', 'sql database'],
  PostgreSQL: ['postgresql', 'postgres', 'sql database'],

  Linux: ['linux', 'unix', 'ubuntu', 'shell'],
  Unix: ['unix', 'linux'],
  Bash: ['bash', 'shell scripting', 'shell script', 'terminal'],
  Python: ['python', 'python scripting'],
  JavaScript: ['javascript', 'js'],
  TypeScript: ['typescript', 'ts'],
  React: ['react', 'react.js', 'reactjs'],
  'Node.js': ['node.js', 'nodejs', 'node'],
  API: ['api', 'rest api', 'restful api'],
  REST: ['rest', 'rest api', 'restful api'],
  Postman: ['postman', 'api testing'],

  Docker: ['docker', 'containers', 'containerisation', 'containerization'],
  Kubernetes: ['kubernetes', 'k8s'],

  Git: ['git', 'version control'],
  GitHub: ['github', 'git hub'],

  Windows: ['windows', 'windows 10', 'windows 11'],
  VPN: ['vpn', 'virtual private network'],
  Citrix: ['citrix'],

  'Manual Testing': ['manual testing', 'test cases', 'qa testing'],
  'Automation Testing': ['automation testing', 'automated testing'],

  QA: ['qa', 'quality assurance', 'testing'],

  'Bug Reporting': [
    'bug reporting',
    'defect reporting',
    'bug tracking',
  ],

  Communication: [
    'communication',
    'communicate',
    'written communication',
  ],

  'Problem Solving': [
    'problem solving',
    'problem-solving',
    'troubleshooting',
  ],

  Teamwork: ['teamwork', 'collaboration', 'team collaboration'],

  Ownership: ['ownership', 'accountability'],

  Collaboration: ['collaboration', 'cross-functional'],

  'Analytical Thinking': [
    'analytical thinking',
    'analysis',
    'analytical skills',
  ],

  Empathy: ['empathy', 'customer empathy'],

  'Stakeholder Management': [
    'stakeholder management',
    'stakeholders',
  ],
};

const extractKeywordsFromText = (
  sourceText: string,
  keywords: string[],
): string[] => {
  const text = sourceText.toLowerCase();

  return keywords.filter((keyword) => {
    const directMatch = text.includes(keyword.toLowerCase());

    if (directMatch) return true;

    const synonyms = keywordSynonyms[keyword] ?? [];

    return synonyms.some((synonym) =>
      text.includes(synonym.toLowerCase()),
    );
  });
};

const findMatchedEvidence = (
  sourceText: string,
  keyword: string,
): string | null => {
  const text = sourceText.toLowerCase();
  const keywordLower = keyword.toLowerCase();

  if (text.includes(keywordLower)) {
    return keyword;
  }

  const synonyms = keywordSynonyms[keyword] ?? [];

  const matchedSynonym = synonyms.find((synonym) =>
    text.includes(synonym.toLowerCase()),
  );

  return matchedSynonym ?? null;
};

const calculateMatchPercent = (
  cvText: string,
  keywords: string[],
): {
  matched: string[];
  missing: string[];
  percent: number;
} => {
  const uniqueKeywords = deduplicateKeywords(keywords);

  const matched = uniqueKeywords.filter((keyword) =>
    Boolean(findMatchedEvidence(cvText, keyword)),
  );

  const missing = uniqueKeywords.filter((keyword) =>
    !findMatchedEvidence(cvText, keyword),
  );

  const percent = uniqueKeywords.length
    ? Math.round((matched.length / uniqueKeywords.length) * 100)
    : 0;

  return {
    matched,
    missing,
    percent,
  };
};

const detectRoleCategory = (jobDescription: string): string => {
  const text = jobDescription.toLowerCase();

  const roleSignals: Record<string, string[]> = {
    'Application Support': [
      'application support',
      'app support',
      'production support',
      'platform support',
      'software support',
      'linux',
      'sql',
      'bash',
      'monitoring',
      'logs',
      'log analysis',
      'incident',
      'l2',
      'second line',
      '2nd line',
    ],

    'Technical Support': [
      'technical support',
      'support engineer',
      'technical support engineer',
      'troubleshooting',
      'diagnose',
      'diagnostics',
      'hardware',
      'software issues',
      'technical issues',
      'root cause',
    ],

    'IT Support / Service Desk': [
      'service desk',
      'help desk',
      'helpdesk',
      'active directory',
      'office 365',
      'microsoft 365',
      'password reset',
      '1st line',
      'first line',
      'desktop support',
      'end user support',
    ],

    'Customer Support': [
      'customer support',
      'customer service',
      'customer care',
      'client support',
      'zendesk',
      'crm',
      'customer relationship',
      'customer experience',
      'customer success',
    ],

    'QA / Software Testing': [
      'qa',
      'quality assurance',
      'testing',
      'test cases',
      'bug reporting',
      'bug tracking',
      'regression',
      'manual testing',
      'automation testing',
      'selenium',
      'playwright',
      'cypress',
    ],

    'Software Engineering': [
      'software engineer',
      'developer',
      'frontend',
      'backend',
      'full stack',
      'react',
      'typescript',
      'javascript',
      'node.js',
      'api',
      'database',
      'github',
      'git',
    ],

    'Data / BI': [
      'data analyst',
      'business intelligence',
      'power bi',
      'tableau',
      'analytics',
      'dashboard',
      'reporting',
      'data visualisation',
      'data visualization',
    ],

    Cybersecurity: [
      'cybersecurity',
      'security analyst',
      'soc',
      'siem',
      'vulnerability',
      'incident response',
      'security monitoring',
      'security operations',
    ],
  };

  let bestRole = 'Unknown / Hybrid';
  let bestScore = 0;

  for (const [role, signals] of Object.entries(roleSignals)) {
    const score = signals.reduce((count, signal) => {
      return text.includes(signal.toLowerCase()) ? count + 1 : count;
    }, 0);

    if (score > bestScore) {
      bestScore = score;
      bestRole = role;
    }
  }

  return bestScore > 0 ? bestRole : 'Unknown / Hybrid';
};

const buildRoleSpecificRecommendations = (
  roleCategory: string,
  requiredMissing: string[],
  toolsMissing: string[],
  niceToHaveMissing: string[],
): string[] => {
  const recommendations: string[] = [];
  const role = roleCategory || 'Unknown / Hybrid';

  if (role === 'Application Support') {
    recommendations.push(
      'For application support roles, make sure the CV clearly shows examples of incident handling, log review, SQL/Linux troubleshooting, monitoring, escalation, and production support.',
    );
  }

  if (role === 'Technical Support') {
    recommendations.push(
      'For technical support roles, strengthen examples around troubleshooting, diagnostics, customer updates, ticket ownership, escalation, and clear technical communication.',
    );
  }

  if (role === 'IT Support / Service Desk') {
    recommendations.push(
      'For IT support or service desk roles, highlight Office 365, Active Directory, password resets, remote support, SLA handling, user support, and ticketing tools.',
    );
  }

  if (role === 'Customer Support') {
    recommendations.push(
      'For customer support roles, show customer communication, CRM or ticketing experience, complaint handling, SLA awareness, and examples of resolving customer issues.',
    );
  }

  if (role === 'QA / Software Testing') {
    recommendations.push(
      'For QA roles, highlight manual testing, test cases, bug reporting, regression testing, Jira usage, reproduction steps, and clear defect documentation.',
    );
  }

  if (role === 'Software Engineering') {
    recommendations.push(
      'For software engineering roles, make sure the CV shows projects, GitHub work, APIs, databases, frontend/backend features, debugging, and measurable technical outcomes.',
    );
  }

  if (role === 'Data / BI') {
    recommendations.push(
      'For data or BI roles, highlight reporting, dashboards, SQL, Excel, analytics, data cleaning, data visualisation, and business impact.',
    );
  }

  if (role === 'Cybersecurity') {
    recommendations.push(
      'For cybersecurity roles, highlight incident response, security monitoring, vulnerability handling, SIEM/log analysis, risk awareness, and escalation processes.',
    );
  }

  if (role === 'Unknown / Hybrid') {
    recommendations.push(
      'The role appears hybrid, so prioritise the strongest requirements from the job description and align your CV around the most repeated technical and support keywords.',
    );
  }

  if (requiredMissing.length) {
    recommendations.push(
      `The most important missing required skills are: ${requiredMissing
        .slice(0, 5)
        .join(', ')}. Add them only if they are genuinely supported by your experience.`,
    );
  }

  if (toolsMissing.length) {
    recommendations.push(
      `The CV should better show relevant tools if you have used them: ${toolsMissing
        .slice(0, 5)
        .join(', ')}.`,
    );
  }

  if (niceToHaveMissing.length) {
    recommendations.push(
      `Nice-to-have gaps include: ${niceToHaveMissing
        .slice(0, 4)
        .join(', ')}. These can improve the match, but they are lower priority than required skills.`,
    );
  }

  return recommendations.slice(0, 6);
};

const buildActionableGapAdvice = (
  requiredMissing: string[],
  toolsMissing: string[],
  niceToHaveMissing: string[],
  roleCategory: string,
): string[] => {
  const advice: string[] = [];

  const skillAdvice: Record<string, string> = {
    SQL: 'Add one bullet showing database querying, reporting, data checks, troubleshooting, or SQL-based investigation if you have done it.',
    MySQL: 'Mention MySQL only if you used it for database queries, student/project systems, reporting, or backend troubleshooting.',
    PostgreSQL: 'Mention PostgreSQL only if you used it for queries, backend work, data checks, or application troubleshooting.',
    Linux: 'Add one bullet showing command-line troubleshooting, logs, permissions, services, files, or basic Linux administration.',
    Unix: 'Add Unix/Linux evidence through command-line troubleshooting, logs, service checks, permissions, or shell usage.',
    Bash: 'Add a supported example of shell scripting, command-line automation, log checks, or troubleshooting with terminal commands.',
    Python: 'Add a project or work example showing Python scripting, automation, data handling, backend logic, or troubleshooting.',
    JavaScript: 'Add evidence of JavaScript usage in a project, frontend feature, bug fix, or web application.',
    TypeScript: 'Mention TypeScript through project work, typed React components, frontend logic, or production-quality code.',
    React: 'Add a project bullet showing React components, UI features, state handling, forms, dashboards, or API integration.',
    'Node.js': 'Add a backend/project bullet showing Node.js APIs, Express routes, server logic, authentication, or database integration.',
    API: 'Add a bullet showing API usage, REST requests, Postman testing, endpoint debugging, or integration work.',
    REST: 'Mention REST through API testing, endpoint integration, request/response troubleshooting, or backend project work.',
    Postman: 'Add Postman only if you used it for API testing, request validation, debugging, or integration checks.',
    Jira: 'Mention Jira through ticket handling, escalation notes, bug reports, sprint tasks, investigation updates, or status tracking.',
    ServiceNow: 'Mention ServiceNow through incident tickets, user support cases, SLA updates, escalation, or service desk workflows.',
    Zendesk: 'Mention Zendesk through customer tickets, SLA handling, case updates, complaint resolution, or support workflows.',
    CRM: 'Mention CRM experience through customer records, case tracking, follow-ups, complaint handling, or account support.',
    'Office 365': 'Add Office 365 evidence through Outlook, Teams, Exchange, account support, mailbox issues, or M365 troubleshooting.',
    'Active Directory': 'Add Active Directory evidence through account checks, password resets, user access support, groups, or identity troubleshooting.',
    Windows: 'Add Windows support evidence through troubleshooting, user issues, device setup, updates, drivers, or remote assistance.',
    VPN: 'Mention VPN support through connectivity troubleshooting, access checks, remote user issues, or network diagnostics.',
    Citrix: 'Mention Citrix only if you supported virtual apps, login issues, user access, or remote desktop environments.',
    Docker: 'Mention Docker through local development, containers, deployment testing, or project environment setup.',
    Kubernetes: 'Mention Kubernetes only if you used it for deployments, pods, logs, services, or cloud/container operations.',
    Monitoring: 'Add monitoring evidence through alert handling, dashboards, service checks, production issues, or incident response.',
    'Log Analysis': 'Add a bullet showing how you reviewed logs to identify errors, reproduce issues, escalate clearly, or resolve incidents.',
    'Incident Management': 'Add evidence of incident ownership, prioritisation, SLA handling, escalation, root-cause notes, or customer updates.',
    'Technical Support': 'Add technical support evidence through troubleshooting steps, diagnostics, customer communication, ticket ownership, and escalation.',
    'Customer Support': 'Add customer support evidence through case handling, communication, de-escalation, SLA, CRM, and successful resolution.',
    'Application Support': 'Add application support evidence through production issues, logs, SQL checks, monitoring, incident handling, and escalation.',
    'IT Support': 'Add IT support evidence through user support, device/software troubleshooting, remote support, O365, AD, and ticketing systems.',
    'Service Desk': 'Add service desk evidence through first-line support, password resets, ticket triage, SLA updates, and user communication.',
    'Help Desk': 'Add help desk evidence through user support, ticket handling, troubleshooting, escalation, and resolution documentation.',
    QA: 'Add QA evidence through test execution, bug reports, reproduction steps, regression testing, or clear defect documentation.',
    'Manual Testing': 'Add manual testing evidence through test cases, exploratory testing, regression checks, and defect reporting.',
    'Automation Testing': 'Mention automation testing only if you used Selenium, Playwright, Cypress, scripts, or automated test execution.',
    'Bug Reporting': 'Add bug reporting evidence through clear steps to reproduce, expected vs actual results, severity, screenshots/logs, and Jira tickets.',
    Git: 'Add Git evidence through version control, branches, commits, pull requests, or project collaboration.',
    GitHub: 'Add GitHub evidence through repositories, project links, pull requests, issues, or documented portfolio work.',
  };

  const addAdviceFor = (keywords: string[], limit: number) => {
    for (const keyword of keywords.slice(0, limit)) {
      const mappedAdvice = skillAdvice[keyword];

      if (mappedAdvice) {
        advice.push(mappedAdvice);
      } else {
        advice.push(
          `Add a supported example showing your experience with ${keyword}, if you have it.`,
        );
      }
    }
  };

  addAdviceFor(requiredMissing, 5);
  addAdviceFor(toolsMissing, 4);

  if (niceToHaveMissing.length) {
    advice.push(
      `Lower-priority nice-to-have skills include ${niceToHaveMissing
        .slice(0, 4)
        .join(', ')}. Add them only if they are supported by real experience, coursework, or projects.`,
    );
  }

  if (roleCategory === 'Application Support') {
    advice.push(
      'For this role family, prioritise bullets that combine issue, tool, action, and outcome, for example: investigated alerts, checked logs/SQL, escalated with evidence, and restored or improved service.',
    );
  }

  if (roleCategory === 'Technical Support') {
    advice.push(
      'For this role family, prioritise troubleshooting stories that show diagnosis, customer communication, ownership, escalation, and resolution.',
    );
  }

  if (roleCategory === 'IT Support / Service Desk') {
    advice.push(
      'For this role family, prioritise user-support examples involving tickets, SLA, O365, Active Directory, remote support, and clear documentation.',
    );
  }

  if (roleCategory === 'QA / Software Testing') {
    advice.push(
      'For this role family, prioritise examples of test cases, defect reports, reproduction steps, regression checks, and collaboration with developers.',
    );
  }

  if (roleCategory === 'Software Engineering') {
    advice.push(
      'For this role family, prioritise project bullets that show feature delivery, APIs, databases, debugging, GitHub, and measurable technical outcomes.',
    );
  }

  if (!advice.length) {
    advice.push(
      'The CV already covers the main detected requirements. Improve it by adding measurable achievements, tools used, and clearer outcomes for each relevant role.',
    );
  }

  return deduplicateKeywords(advice).slice(0, 10);
};

const buildSafeTailoredCvDraft = (
  cvText: string,
  structuredJD: any,
  analysisResult: any,
): string => {
  const roleCategory = structuredJD.role_category ?? 'Target Role';
  const jobTitle = structuredJD.job_title ?? roleCategory;

  const matchedKeywords = deduplicateKeywords(
    analysisResult.matched_keywords ?? [],
  ).slice(0, 14);

  const missingKeywords = deduplicateKeywords(
    analysisResult.missing_keywords ?? [],
  ).slice(0, 10);

  const strongestSkills = deduplicateKeywords(
    analysisResult.strongest_transferable_skills ?? [],
  ).slice(0, 8);

  const recommendations = deduplicateKeywords([
    ...(analysisResult.ai_recommendations ?? []),
    ...(analysisResult.cv_improvement_actions ?? []),
  ]).slice(0, 8);

  const summaryLines = [
    `Target Role: ${jobTitle}`,
    `Detected Role Family: ${roleCategory}`,
    `Match Verdict: ${analysisResult.qualification_verdict ?? 'Not available'}`,
    `Overall Score: ${analysisResult.overall_job_fit_score ?? 0}/100`,
  ];

  const matchedSection = matchedKeywords.length
    ? matchedKeywords.map((keyword) => `- ${keyword}`).join('\n')
    : '- No strong keyword matches detected yet.';

  const strongestSection = strongestSkills.length
    ? strongestSkills.map((skill) => `- ${skill}`).join('\n')
    : '- No transferable skills detected yet.';

  const missingSection = missingKeywords.length
    ? missingKeywords.map((keyword) => `- ${keyword}`).join('\n')
    : '- No major missing keywords detected.';

  const recommendationSection = recommendations.length
    ? recommendations.map((item) => `- ${item}`).join('\n')
    : '- Add measurable achievements and clearer role-specific evidence.';

  return [
    'TAILORED CV DRAFT',
    '=================',
    '',
    ...summaryLines,
    '',
    'TARGETED PROFESSIONAL SUMMARY',
    '-----------------------------',
    `Candidate with experience relevant to ${roleCategory}, with evidence connected to ${
      matchedKeywords.slice(0, 6).join(', ') || 'the target role requirements'
    }. This draft is based only on the existing CV text and detected job requirements.`,
    '',
    'MATCHED SKILLS TO EMPHASISE',
    '--------------------------',
    matchedSection,
    '',
    'STRONGEST TRANSFERABLE SKILLS',
    '----------------------------',
    strongestSection,
    '',
    'MISSING OR WEAKLY SHOWN REQUIREMENTS',
    '------------------------------------',
    missingSection,
    '',
    'SAFE IMPROVEMENT ACTIONS',
    '------------------------',
    recommendationSection,
    '',
    'IMPORTANT FACT-LOCK NOTE',
    '------------------------',
    'Do not add missing skills unless they are genuinely supported by your real experience, coursework, projects, or certifications.',
    '',
    'ORIGINAL CV TEXT',
    '----------------',
    cvText,
  ].join('\n');
};

const fallbackStructuredCV = (cvText: string) => {
  const lines = cvText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const skills = extractKeywordsFromText(cvText, [
    'Linux',
    'Unix',
    'SQL',
    'Bash',
    'Python',
    'JavaScript',
    'TypeScript',
    'React',
    'Node.js',
    'PHP',
    'MySQL',
    'PostgreSQL',
    'Zendesk',
    'CRM',
    'Jira',
    'Confluence',
    'ServiceNow',
    'Customer Support',
    'Customer Service',
    'Technical Support',
    'Application Support',
    'IT Support',
    'Service Desk',
    'Help Desk',
    'Troubleshooting',
    'Incident Management',
    'Monitoring',
    'Log Analysis',
    'Active Directory',
    'Office 365',
    'Windows',
    'VPN',
    'Citrix',
    'Docker',
    'Git',
    'GitHub',
    'Postman',
    'Manual Testing',
    'QA',
    'Bug Reporting',
  ]);

  const languages = extractKeywordsFromText(cvText, [
    'English',
    'Polish',
    'German',
    'French',
    'Spanish',
    'Shona',
  ]);

  const certifications = extractKeywordsFromText(cvText, [
    'Google IT Support',
    'ITIL',
    'ISTQB',
    'AWS',
    'Azure',
    'CompTIA',
    'CCNA',
  ]);

  return {
    personal_info: {},
    summary: lines.slice(0, 4).join(' '),
    experience: [],
    education: [],
    projects: [],
    certifications,
    languages,
    skills,
    raw_text: cvText,
    text: cvText,
  };
};

const fallbackStructuredJD = (jobDescription: string) => {
  const text = jobDescription.toLowerCase();

  const hasAny = (terms: string[]) =>
    terms.some((term) => text.includes(term.toLowerCase()));

  const requiredSkills = extractKeywordsFromText(jobDescription, [
    'Linux',
    'Unix',
    'SQL',
    'Bash',
    'Python',
    'JavaScript',
    'TypeScript',
    'React',
    'Node.js',
    'PHP',
    'MySQL',
    'PostgreSQL',
    'Zendesk',
    'CRM',
    'Jira',
    'Confluence',
    'ServiceNow',
    'Customer Support',
    'Customer Service',
    'Customer Care',
    'Technical Support',
    'Application Support',
    'IT Support',
    'Service Desk',
    'Help Desk',
    'Troubleshooting',
    'Incident Management',
    'Monitoring',
    'Log Analysis',
    'Knowledge Base',
    'Manual Testing',
    'Automation Testing',
    'API',
    'REST',
    'Postman',
    'Active Directory',
    'Office 365',
    'Windows',
    'VPN',
    'Citrix',
  ]);

  const niceToHaveSkills = extractKeywordsFromText(jobDescription, [
    'AWS',
    'Azure',
    'GCP',
    'Docker',
    'Kubernetes',
    'Splunk',
    'Grafana',
    'Kibana',
    'Jenkins',
    'Bitbucket',
    'CI/CD',
    'Selenium',
    'Playwright',
    'Cypress',
  ]);

  const tools = extractKeywordsFromText(jobDescription, [
    'Zendesk',
    'CRM',
    'Jira',
    'Confluence',
    'ServiceNow',
    'Salesforce',
    'Git',
    'GitHub',
    'Bitbucket',
    'Postman',
    'Docker',
    'Kubernetes',
    'Splunk',
    'Office 365',
    'Active Directory',
    'Excel',
    'Teams',
    'Outlook',
  ]);

  const languages = extractKeywordsFromText(jobDescription, [
    'English',
    'Polish',
    'German',
    'French',
    'Spanish',
  ]);

  const roleCategory = detectRoleCategory(jobDescription);

  const lines = jobDescription
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const possibleTitle = lines.find((line) =>
    /engineer|specialist|analyst|developer|support|consultant|tester|manager|administrator|associate|representative/i.test(line),
  );

  const seniority = hasAny(['intern', 'internship'])
    ? 'internship'
    : hasAny(['junior', 'entry level', 'graduate'])
      ? 'junior'
      : hasAny(['senior', 'lead', 'principal'])
        ? 'senior'
        : hasAny(['mid', 'regular'])
          ? 'mid'
          : null;

  return {
    job_title: possibleTitle ?? null,
    company_name: null,
    role_category: roleCategory,
    seniority,

    responsibilities: lines
      .map((line) => line.replace(/^[-•*]\s*/, '').trim())
      .filter((line) => line.length > 25)
      .slice(0, 10),

    required_skills: requiredSkills,
    nice_to_have_skills: niceToHaveSkills,
    tools,
    languages,

    certifications: extractKeywordsFromText(jobDescription, [
      'ITIL',
      'ISTQB',
      'AWS',
      'Azure',
      'Google Cloud',
      'CCNA',
      'CompTIA',
    ]),

    education_requirements: hasAny([
      'bachelor',
      'degree',
      'computer science',
      'computer engineering',
      'information technology',
    ])
      ? ['Bachelor degree or related education']
      : [],

    experience_requirements: lines
      .filter((line) =>
        /years?|experience|l1|l2|1st line|2nd line|first line|second line/i.test(line),
      )
      .slice(0, 5),

    soft_skills: extractKeywordsFromText(jobDescription, [
      'Communication',
      'Problem Solving',
      'Teamwork',
      'Customer Relationship',
      'Ownership',
      'Collaboration',
      'Analytical Thinking',
      'Empathy',
      'Stakeholder Management',
    ]),

    raw_summary: jobDescription.slice(0, 800),
  };
};

const fallbackAnalysisResult = (
  structuredCV: any,
  structuredJD: any,
  cvText: string,
) => {
  const cvLower = cvText.toLowerCase();

  const requiredSkills = deduplicateKeywords(
    structuredJD.required_skills ?? [],
  );

  const tools = deduplicateKeywords(
    structuredJD.tools ?? [],
  );

  const languages = deduplicateKeywords(
    structuredJD.languages ?? [],
  );

  const niceToHaveSkills = deduplicateKeywords(
    structuredJD.nice_to_have_skills ?? [],
  );

  const softSkills = deduplicateKeywords(
    structuredJD.soft_skills ?? [],
  );

  const requiredMatch = calculateMatchPercent(cvText, requiredSkills);
  const toolsMatch = calculateMatchPercent(cvText, tools);
  const languageMatch = calculateMatchPercent(cvText, languages);
  const niceToHaveMatch = calculateMatchPercent(cvText, niceToHaveSkills);
  const softSkillMatch = calculateMatchPercent(cvText, softSkills);

  const hasSupportExperience =
    Boolean(findMatchedEvidence(cvText, 'Technical Support')) ||
    Boolean(findMatchedEvidence(cvText, 'Customer Support')) ||
    Boolean(findMatchedEvidence(cvText, 'Application Support')) ||
    Boolean(findMatchedEvidence(cvText, 'IT Support')) ||
    cvLower.includes('ticket') ||
    cvLower.includes('troubleshooting') ||
    cvLower.includes('incident');

  const hasSoftwareExperience =
    Boolean(findMatchedEvidence(cvText, 'React')) ||
    Boolean(findMatchedEvidence(cvText, 'TypeScript')) ||
    Boolean(findMatchedEvidence(cvText, 'JavaScript')) ||
    Boolean(findMatchedEvidence(cvText, 'Node.js')) ||
    Boolean(findMatchedEvidence(cvText, 'Python')) ||
    cvLower.includes('php') ||
    cvLower.includes('mysql') ||
    cvLower.includes('github');

  const hasQaExperience =
    Boolean(findMatchedEvidence(cvText, 'QA')) ||
    Boolean(findMatchedEvidence(cvText, 'Manual Testing')) ||
    Boolean(findMatchedEvidence(cvText, 'Bug Reporting')) ||
    cvLower.includes('test case') ||
    cvLower.includes('bug');

  let transferabilityBonus = 0;

  if (hasSupportExperience) transferabilityBonus += 6;
  if (hasSoftwareExperience) transferabilityBonus += 4;
  if (hasQaExperience) transferabilityBonus += 3;

  transferabilityBonus = Math.min(transferabilityBonus, 10);

  const weightedScore = Math.round(
    requiredMatch.percent * 0.45 +
      toolsMatch.percent * 0.2 +
      languageMatch.percent * 0.1 +
      niceToHaveMatch.percent * 0.1 +
      softSkillMatch.percent * 0.05 +
      transferabilityBonus,
  );

  const overallScore = Math.max(0, Math.min(weightedScore, 100));

  const allMatched = deduplicateKeywords([
    ...requiredMatch.matched,
    ...toolsMatch.matched,
    ...languageMatch.matched,
    ...niceToHaveMatch.matched,
    ...softSkillMatch.matched,
  ]);

  const allMissing = deduplicateKeywords([
    ...requiredMatch.missing,
    ...toolsMatch.missing,
    ...languageMatch.missing,
    ...niceToHaveMatch.missing,
    ...softSkillMatch.missing,
  ]);

  const criticalMissingSkills = requiredMatch.missing.slice(0, 8);

  const learnableMissingSkills = deduplicateKeywords([
    ...toolsMatch.missing,
    ...niceToHaveMatch.missing,
  ]).slice(0, 8);

  const strongestTransferableSkills = allMatched.slice(0, 10);

  const qualificationVerdict =
    overallScore >= 75
      ? 'Strong match'
      : overallScore >= 60
        ? 'Good match'
        : overallScore >= 45
          ? 'Possible match'
          : 'Weak match';

  const recommendedToApply =
    overallScore >= 55 ||
    (overallScore >= 45 && hasSupportExperience);

  const dynamicRecommendations = buildRoleSpecificRecommendations(
    structuredJD.role_category,
    requiredMatch.missing,
    toolsMatch.missing,
    niceToHaveMatch.missing,
  );

  if (languageMatch.missing.length) {
    dynamicRecommendations.push(
      `The job description mentions language requirements not clearly found in the CV: ${languageMatch.missing
        .slice(0, 3)
        .join(', ')}. If accurate, add them to the language section.`,
    );
  }

  if (!dynamicRecommendations.length) {
    dynamicRecommendations.push(
      'The CV already covers many of the job requirements. Improve it further by adding measurable achievements and clearer role-specific impact.',
    );
  }

  const actionableGapAdvice = buildActionableGapAdvice(
    criticalMissingSkills,
    toolsMatch.missing,
    niceToHaveMatch.missing,
    structuredJD.role_category,
  );

  return {
    recommended_to_apply: recommendedToApply,
    qualification_verdict: qualificationVerdict,

    overall_job_fit_score: overallScore,
    ats_match_score: requiredMatch.percent,
    transferability_score: Math.min(
      overallScore + transferabilityBonus,
      100,
    ),
    seniority_match_score: 70,
    skill_gap_score: Math.max(100 - overallScore, 0),

    matched_keywords: allMatched,
    missing_keywords: allMissing,
    partial_keywords: [],

    strongest_transferable_skills: strongestTransferableSkills,

    critical_missing_skills: criticalMissingSkills,
    learnable_missing_skills: learnableMissingSkills,
    nice_to_have_missing_skills: niceToHaveMatch.missing,

    strengths: allMatched.slice(0, 10).map((keyword: string) => ({
      title: keyword,
      description: `The CV shows evidence related to ${keyword}.`,
    })),

    gaps: allMissing.slice(0, 10).map((keyword: string) => ({
      title: keyword,
      description: `The job description mentions ${keyword}, but it was not clearly found in the CV.`,
    })),

    ai_recommendations: dynamicRecommendations.slice(0, 8),

    cv_improvement_actions: actionableGapAdvice,

    score_breakdown: {
      deterministic_fallback: true,
      synonym_matching_enabled: true,
      role_detection_enabled: true,
      weighted_scoring_enabled: true,
      role_specific_recommendations_enabled: true,
      actionable_gap_advice_enabled: true,
      role_category: structuredJD.role_category,

      required_skills_score: requiredMatch.percent,
      tools_score: toolsMatch.percent,
      language_score: languageMatch.percent,
      nice_to_have_score: niceToHaveMatch.percent,
      soft_skills_score: softSkillMatch.percent,
      transferability_bonus: transferabilityBonus,

      weights: {
        required_skills: 45,
        tools: 20,
        languages: 10,
        nice_to_have: 10,
        soft_skills: 5,
        transferability_bonus: 10,
      },

      matched_keywords: allMatched.length,
      missing_keywords: allMissing.length,
    },

    is_truncated: false,
  };
};

const buildSimpleAtsEvidenceItems = (
  analysisResult: any,
  cvText: string,
): AtsEvidenceItem[] => {
  const matched = deduplicateKeywords(
    safeArray(analysisResult.matched_keywords),
  );

  const partial = deduplicateKeywords(
    safeArray(analysisResult.partial_keywords),
  );

  const missing = deduplicateKeywords(
    safeArray(analysisResult.missing_keywords),
  );

  const matchedItems: AtsEvidenceItem[] = matched.map((keyword) => {
    const matchedEvidence = findMatchedEvidence(cvText, keyword) ?? keyword;

    return {
      keyword,
      canonical: canonical(keyword),
      status: 'matched',
      priority: 'required',
      matched_as: matchedEvidence,
      evidence: [matchedEvidence],
      reason: 'Keyword or accepted synonym found in CV text.',
    };
  });

  const partialItems: AtsEvidenceItem[] = partial.map((keyword) => ({
    keyword,
    canonical: canonical(keyword),
    status: 'partial',
    priority: 'required',
    matched_as: keyword,
    evidence: [keyword],
    reason: 'Keyword partially supported by CV text.',
  }));

  const missingItems: AtsEvidenceItem[] = missing.map((keyword) => ({
    keyword,
    canonical: canonical(keyword),
    status: 'missing',
    priority: 'required',
    matched_as: null,
    evidence: [],
    reason:
      'Keyword was found in the job description but not clearly found in the CV.',
  }));

  return [...matchedItems, ...partialItems, ...missingItems];
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: getCorsHeaders(req),
    });
  }

  if (req.method !== 'POST') {
    return errorResponse(req, 'Method not allowed', 405);
  }

  return new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          sendSse(controller, 'progress', {
            step: 'starting',
            message: 'Starting CV intelligence analysis...',
            percent: 5,
          });

          console.log('[SMART-WORKER VERSION]', {
            version: 'v6.4.2-safe-tailored-cv-draft',
            timestamp: new Date().toISOString(),
          });

          const supabaseUrl = Deno.env.get('SUPABASE_URL');
          const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

          if (!supabaseUrl || !supabaseServiceKey) {
            sendSse(controller, 'error', {
              message: 'Supabase environment variables are not configured',
            });
            controller.close();
            return;
          }

          const authHeader = req.headers.get('Authorization');

          if (!authHeader) {
            sendSse(controller, 'error', {
              message: 'Missing Authorization header',
            });
            controller.close();
            return;
          }

          sendSse(controller, 'progress', {
            step: 'auth',
            message: 'Checking your session...',
            percent: 10,
          });

          const supabase = createClient(supabaseUrl, supabaseServiceKey);

          const {
            data: { user },
            error: authError,
          } = await supabase.auth.getUser(
            authHeader.replace('Bearer ', ''),
          );

          if (authError || !user) {
            sendSse(controller, 'error', {
              message: 'Unauthorized',
            });
            controller.close();
            return;
          }

          const body = await req.json();

          const cv_version_id = body?.cv_version_id;
          const job_description = body?.job_description;

          if (!cv_version_id || !job_description?.trim()) {
            sendSse(controller, 'error', {
              message: 'cv_version_id and job_description are required',
            });
            controller.close();
            return;
          }

          if (job_description.length > 20_000) {
            sendSse(controller, 'error', {
              message: 'Job description is too long. Please shorten it.',
            });
            controller.close();
            return;
          }

          sendSse(controller, 'progress', {
            step: 'loading_cv',
            message: 'Loading your CV...',
            percent: 18,
          });

          console.log('SMART WORKER DEBUG:', {
            cv_version_id,
            auth_user_id: user.id,
            safe_mode: true,
            synonym_matching_enabled: true,
            role_detection_enabled: true,
            weighted_scoring_enabled: true,
            role_specific_recommendations_enabled: true,
            actionable_gap_advice_enabled: true,
            safe_tailored_cv_draft_enabled: true,
          });

          const { data: cvVersion, error: cvError } = await supabase
            .from('cv_versions')
            .select('id, user_id, cv_text, file_url')
            .eq('id', cv_version_id)
            .maybeSingle();

          if (cvError || !cvVersion) {
            console.error('CV VERSION NOT FOUND:', {
              cv_version_id,
              auth_user_id: user.id,
              cvError,
            });

            sendSse(controller, 'error', {
              message: `CV version not found. ID received: ${cv_version_id}`,
            });

            controller.close();
            return;
          }

          if (cvVersion.user_id && cvVersion.user_id !== user.id) {
            sendSse(controller, 'error', {
              message:
                'This CV belongs to a different user session. Please refresh and sign in again.',
            });

            controller.close();
            return;
          }

          const cvText = cvVersion.cv_text?.trim() || '';

          if (!cvText) {
            sendSse(controller, 'error', {
              message:
                'This CV has no extracted text yet. Please extract CV text before running analysis.',
            });

            controller.close();
            return;
          }

          if (cvText.length < 100) {
            sendSse(controller, 'error', {
              message:
                'The extracted CV text is too short. Please re-upload a readable CV.',
            });

            controller.close();
            return;
          }

          sendSse(controller, 'progress', {
            step: 'parsing_cv',
            message: 'Reading CV text safely...',
            percent: 28,
          });

          console.log('[CV SAFE MODE] Ignoring cached structured_cv.');

          const cvCacheHit = false;
          const structuredCV = fallbackStructuredCV(cvText);

          sendSse(controller, 'progress', {
            step: 'parsing_jd',
            message: 'Extracting job requirements dynamically...',
            percent: 36,
          });

          const structuredJD = fallbackStructuredJD(job_description);

          sendSse(controller, 'progress', {
            step: 'analysis',
            message: 'Calculating weighted job fit...',
            percent: 55,
          });

          const analysisResult = fallbackAnalysisResult(
            structuredCV,
            structuredJD,
            cvText,
          );

          const matchedKeywords = deduplicateKeywords(
            analysisResult.matched_keywords ?? [],
          );

          const missingKeywords = deduplicateKeywords(
            analysisResult.missing_keywords ?? [],
          );

          const partialKeywords = deduplicateKeywords(
            analysisResult.partial_keywords ?? [],
          );

          const atsEvidenceItems = buildSimpleAtsEvidenceItems(
            analysisResult,
            cvText,
          );

          const atsMatchedCount = atsEvidenceItems.filter(
            (item) => item.status === 'matched',
          ).length;

          const atsPartialCount = atsEvidenceItems.filter(
            (item) => item.status === 'partial',
          ).length;

          const atsMissingCount = atsEvidenceItems.filter(
            (item) => item.status === 'missing',
          ).length;

          const atsCriticalMissingCount = atsEvidenceItems.filter(
            (item) =>
              item.status === 'missing' &&
              (item.priority === 'critical' || item.priority === 'required'),
          ).length;

          const atsEvidenceSummary = {
            total_requirements: atsEvidenceItems.length,
            matched_count: atsMatchedCount,
            partial_count: atsPartialCount,
            missing_count: atsMissingCount,
            deterministic_score: analysisResult.ats_match_score ?? 0,
            coverage_ratio: atsEvidenceItems.length
              ? (atsMatchedCount + atsPartialCount * 0.5) /
                atsEvidenceItems.length
              : 0,
            critical_missing_count: atsCriticalMissingCount,
          };

          const primaryScore = Number(
            analysisResult.overall_job_fit_score ??
              analysisResult.ats_match_score ??
              50,
          );

          const weightedScoreComponents = {
            deterministic_fallback: true,
            synonym_matching_enabled: true,
            role_detection_enabled: true,
            weighted_scoring_enabled: true,
            role_specific_recommendations_enabled: true,
            actionable_gap_advice_enabled: true,
            safe_tailored_cv_draft_enabled: true,
            detected_role_category: structuredJD.role_category,
            overall_score: primaryScore,
            ats_match_score: analysisResult.ats_match_score ?? 0,
            transferability_score: analysisResult.transferability_score ?? 0,
            seniority_match_score: analysisResult.seniority_match_score ?? 0,
            skill_gap_score: analysisResult.skill_gap_score ?? 0,
            matched_keywords: matchedKeywords.length,
            missing_keywords: missingKeywords.length,
            partial_keywords: partialKeywords.length,
            score_breakdown: analysisResult.score_breakdown ?? {},
            ultra_safe_mode: true,
          };

          sendSse(controller, 'progress', {
            step: 'cv_generation',
            message: 'Preparing safe tailored CV draft...',
            percent: 68,
          });

          const generatedCv = buildSafeTailoredCvDraft(
            cvText,
            structuredJD,
            analysisResult,
          );

          const cvSuggestions = null;

          sendSse(controller, 'progress', {
            step: 'saving',
            message: 'Saving analysis results...',
            percent: 90,
          });

          const { data: savedAnalysis, error: saveError } = await supabase
            .from('cv_analyses')
            .insert({
              user_id: user.id,
              cv_version_id,
              job_description,
              job_title: structuredJD.job_title ?? null,
              company_name: structuredJD.company_name ?? null,

              score: primaryScore,
              score_breakdown: analysisResult.score_breakdown ?? {},

              matched_keywords: matchedKeywords,
              missing_keywords: missingKeywords,
              partial_keywords: partialKeywords,

              ats_evidence: atsEvidenceSummary,
              ats_keyword_evidence: atsEvidenceItems,
              ats_strengths: analysisResult.strengths ?? [],
              ats_risks: analysisResult.gaps ?? [],

              strengths: analysisResult.strengths ?? [],
              gaps: analysisResult.gaps ?? [],

              suggestions: [
                ...(analysisResult.ai_recommendations ?? []),
                ...(analysisResult.cv_improvement_actions ?? []),
              ],

              generated_cv: generatedCv,
              role_category: structuredJD.role_category ?? null,

              extended_data: {
                recommended_to_apply:
                  analysisResult.recommended_to_apply,
                qualification_verdict:
                  analysisResult.qualification_verdict,

                transferability_score:
                  analysisResult.transferability_score,
                ats_match_score: analysisResult.ats_match_score,
                seniority_match_score:
                  analysisResult.seniority_match_score,
                skill_gap_score: analysisResult.skill_gap_score,

                strongest_transferable_skills:
                  analysisResult.strongest_transferable_skills ?? [],

                critical_missing_skills:
                  analysisResult.critical_missing_skills ?? [],
                learnable_missing_skills:
                  analysisResult.learnable_missing_skills ?? [],
                nice_to_have_missing_skills:
                  analysisResult.nice_to_have_missing_skills ?? [],

                ai_recommendations:
                  analysisResult.ai_recommendations ?? [],
                cv_improvement_actions:
                  analysisResult.cv_improvement_actions ?? [],

                is_truncated: false,
                structured_jd: structuredJD,
                weighted_score_components: weightedScoreComponents,

                ats_evidence_summary: atsEvidenceSummary,
                ats_keyword_evidence: atsEvidenceItems,

                fact_lock: true,
                cv_cache_hit: cvCacheHit,
                suggestions_disabled_temporarily: true,
                deterministic_dynamic_fallback_enabled: true,
                synonym_matching_enabled: true,
                role_detection_enabled: true,
                weighted_scoring_enabled: true,
                role_specific_recommendations_enabled: true,
                actionable_gap_advice_enabled: true,
                safe_tailored_cv_draft_enabled: true,
                detected_role_category: structuredJD.role_category,
                llm_required_for_analysis: false,
                extraction_inside_sse: false,
                cpu_safe_mode: true,
                ultra_safe_mode: true,
                ats_matcher_disabled_temporarily: true,
                cached_structured_cv_ignored: true,
              },
            })
            .select()
            .single();

          if (saveError) {
            console.error('Failed to save analysis:', saveError);
          }

          const { error: updateError } = await supabase
            .from('cv_versions')
            .update({
              last_score: primaryScore,
              last_analyzed_at: new Date().toISOString(),
            })
            .eq('id', cv_version_id)
            .eq('user_id', user.id);

          if (updateError) {
            console.error('Failed to update cv_versions:', updateError);
          }

          const fullAnalysis = {
            ...(savedAnalysis ?? {}),

            recommended_to_apply:
              analysisResult.recommended_to_apply,
            qualification_verdict:
              analysisResult.qualification_verdict,

            overall_job_fit_score: primaryScore,
            score: primaryScore,

            transferability_score:
              analysisResult.transferability_score,
            ats_match_score: analysisResult.ats_match_score,
            seniority_match_score:
              analysisResult.seniority_match_score,
            skill_gap_score: analysisResult.skill_gap_score,

            strongest_transferable_skills:
              analysisResult.strongest_transferable_skills ?? [],

            critical_missing_skills:
              analysisResult.critical_missing_skills ?? [],
            learnable_missing_skills:
              analysisResult.learnable_missing_skills ?? [],
            nice_to_have_missing_skills:
              analysisResult.nice_to_have_missing_skills ?? [],

            ai_recommendations:
              analysisResult.ai_recommendations ?? [],
            cv_improvement_actions:
              analysisResult.cv_improvement_actions ?? [],

            matched_keywords: matchedKeywords,
            missing_keywords: missingKeywords,
            partial_keywords: partialKeywords,

            ats_evidence: atsEvidenceSummary,
            ats_keyword_evidence: atsEvidenceItems,
            ats_strengths: analysisResult.strengths ?? [],
            ats_risks: analysisResult.gaps ?? [],

            strengths: analysisResult.strengths ?? [],
            gaps: analysisResult.gaps ?? [],

            generated_cv: generatedCv,
            score_breakdown: analysisResult.score_breakdown ?? {},

            job_title: structuredJD.job_title ?? null,
            company_name: structuredJD.company_name ?? null,

            is_truncated: false,
            structured_cv: structuredCV,
            cv_suggestions: cvSuggestions,

            id: savedAnalysis?.id ?? 'unsaved',
            user_id: user.id,
            cv_version_id,
            created_at:
              savedAnalysis?.created_at ?? new Date().toISOString(),

            save_warning: saveError
              ? 'Analysis completed but could not be saved.'
              : null,

            role_category: structuredJD.role_category ?? null,
            suggestions_disabled_temporarily: true,
            deterministic_dynamic_fallback_enabled: true,
            synonym_matching_enabled: true,
            role_detection_enabled: true,
            weighted_scoring_enabled: true,
            role_specific_recommendations_enabled: true,
            actionable_gap_advice_enabled: true,
            safe_tailored_cv_draft_enabled: true,
            detected_role_category: structuredJD.role_category,
            llm_required_for_analysis: false,
            extraction_inside_sse: false,
            cpu_safe_mode: true,
            ultra_safe_mode: true,
            ats_matcher_disabled_temporarily: true,
            cached_structured_cv_ignored: true,
          };

          sendSse(controller, 'progress', {
            step: 'complete',
            message: 'Analysis complete.',
            percent: 100,
          });

          sendSse(controller, 'complete', {
            analysis: fullAnalysis,
            learning_context_used: false,
            patterns_updated: false,
          });

          controller.close();
        } catch (err) {
          console.error('Unhandled error:', err);

          try {
            sendSse(controller, 'error', {
              message:
                err instanceof Error
                  ? err.message
                  : 'An unknown internal error occurred',
            });
          } catch (sseError) {
            console.error('[SSE error send failed]', sseError);
          }

          controller.close();
        }
      },
    }),
    {
      headers: sseHeaders(req),
      status: 200,
    },
  );
});