import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ─── types ────────────────────────────────────────────────────────────────────

type Recommendation = 'recommended' | 'possible' | 'stretch' | 'not_recommended';

interface ScoreRequest {
  job_ad_id?: string;
  cv_version_id?: string | null;
}

interface JobAd {
  id: string;
  user_id: string;
  title: string | null;
  company: string | null;
  location: string | null;
  work_model: string | null;
  salary_range: string | null;
  job_url: string | null;
  source: string | null;
  source_slug: string | null;
  description: string | null;
  parsed_required_skills?: string[] | null;
}

interface ScoreDimensions {
  skills: number;
  seniority: number;
  domain: number;
  logistics: number;
  language: number;
}

interface ScoreResult {
  match_score: number;
  fit_label: string;
  recommendation: Recommendation;
  matched_skills: string[];
  missing_skills: string[];
  concerns: string[];
  suggested_cv_angle: string;
  explanation: string;
  score_breakdown: ScoreDimensions;
}

interface JobSignals {
  seniority: 'junior' | 'mid' | 'senior' | 'lead' | 'any';
  domain: string;
  skills: string[];
  languages: string[];
  workModel: 'remote' | 'hybrid' | 'onsite' | 'any';
  locationHint: string;
}

interface CvSignals {
  seniority: 'junior' | 'mid' | 'senior' | 'lead' | 'any';
  domain: string;
  skills: string[];
  languages: string[];
  workModelPreference: 'remote' | 'hybrid' | 'onsite' | 'any';
  locationHint: string;
}

// ─── cors ─────────────────────────────────────────────────────────────────────

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

// ─── pure utilities ───────────────────────────────────────────────────────────

const clamp = (value: number, min = 0, max = 100) =>
  Math.max(min, Math.min(max, Math.round(value)));

const stripHtml = (value: string | null | undefined): string => {
  if (!value) return '';

  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s{2,}/g, ' ')
    .trim();
};

const safeArray = (value: unknown): string[] => {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(/[,;\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
};

const getRecommendation = (score: number): Recommendation => {
  if (score >= 85) return 'recommended';
  if (score >= 70) return 'possible';
  if (score >= 55) return 'stretch';
  return 'not_recommended';
};

const getFitLabel = (score: number) => {
  if (score >= 85) return 'Strong fit';
  if (score >= 70) return 'Good fit';
  if (score >= 55) return 'Stretch fit';
  return 'Low fit';
};

// ─── text extraction ──────────────────────────────────────────────────────────

const extractCvText = (cv: Record<string, unknown>): string => {
  const priorityFields = [
    'generated_cv',
    'cv_text',
    'content',
    'resume_text',
    'raw_text',
    'summary',
    'professional_summary',
    'target_role',
    'skills',
    'experience',
    'education',
    'projects',
    'certifications',
    'parsed_data',
    'sections',
  ];

  const chunks: string[] = [];

  for (const field of priorityFields) {
    const value = cv[field];

    if (!value) continue;

    if (typeof value === 'string') {
      chunks.push(`[${field}]\n${value}`);
    } else {
      try {
        chunks.push(`[${field}]\n${JSON.stringify(value)}`);
      } catch {
        // Skip values that cannot be stringified.
      }
    }
  }

  if (chunks.length === 0) {
    try {
      chunks.push(JSON.stringify(cv));
    } catch {
      return '';
    }
  }

  return stripHtml(chunks.join('\n\n')).slice(0, 14000);
};

const buildJobText = (job: JobAd): string =>
  stripHtml(
    [
      `Title: ${job.title || ''}`,
      `Company: ${job.company || ''}`,
      `Location: ${job.location || ''}`,
      `Work model: ${job.work_model || ''}`,
      `Salary: ${job.salary_range || ''}`,
      `Description:\n${job.description || ''}`,
      `Required skills: ${(job.parsed_required_skills || []).join(', ')}`,
    ].join('\n'),
  ).slice(0, 14000);

// ─── static signal extraction ─────────────────────────────────────────────────

const SENIORITY_PATTERNS: Record<JobSignals['seniority'], RegExp> = {
  junior: /\b(junior|jr\.?|entry[- ]level|0-2\s*years?|graduate|trainee|stażysta)\b/i,
  mid: /\b(mid[- ]?level|regular|2-5\s*years?|mid\b|regularny)\b/i,
  senior: /\b(senior|sr\.?|5\+?\s*years?|experienced|doświadczony|starszy)\b/i,
  lead: /\b(lead|principal|staff|architect|head of|tech lead|lider|kierownik)\b/i,
  any: /.*/,
};

const detectSeniority = (text: string): JobSignals['seniority'] => {
  for (const [level, regex] of Object.entries(SENIORITY_PATTERNS) as [
    JobSignals['seniority'],
    RegExp,
  ][]) {
    if (level !== 'any' && regex.test(text)) return level;
  }

  return 'any';
};

const DOMAIN_PATTERNS: Array<[string, RegExp]> = [
  [
    'IT Support / Helpdesk',
    /\b(helpdesk|help desk|it support|technical support|service desk|l1|l2|l3|itil|service now|servicenow|zendesk)\b/i,
  ],
  [
    'Software Engineering',
    /\b(software engineer|software developer|developer|full[- ]stack|backend|frontend|devops|sre|platform engineer)\b/i,
  ],
  [
    'Data / Analytics',
    /\b(data engineer|data scientist|analyst|bi developer|power bi|tableau|etl|machine learning|ml engineer)\b/i,
  ],
  [
    'QA / Testing',
    /\b(qa engineer|test engineer|quality assurance|automation tester|selenium|cypress|playwright)\b/i,
  ],
  [
    'Cybersecurity',
    /\b(security engineer|soc analyst|penetration|siem|threat|vulnerability|cybersecurity|infosec)\b/i,
  ],
  [
    'Cloud / Infrastructure',
    /\b(cloud engineer|aws|azure|gcp|terraform|kubernetes|sysadmin|system administrator|infrastructure)\b/i,
  ],
  [
    'Product / Project Mgmt',
    /\b(product manager|project manager|scrum master|agile coach|program manager|pm\b|pmo)\b/i,
  ],
  [
    'Sales / Customer Success',
    /\b(account manager|customer success|sales engineer|pre-sales|business development|bdm)\b/i,
  ],
  [
    'Finance / Accounting',
    /\b(accountant|finance|controller|bookkeeper|tax|treasury|księgowy|finansowy)\b/i,
  ],
  [
    'HR / Recruitment',
    /\b(recruiter|talent acquisition|hr business partner|hrbp|people ops|human resources)\b/i,
  ],
  ['Marketing', /\b(marketing|seo|sem|ppc|content|social media|growth hacker|demand gen)\b/i],
];

const detectDomain = (text: string): string => {
  for (const [domain, regex] of DOMAIN_PATTERNS) {
    if (regex.test(text)) return domain;
  }

  return 'General';
};

const detectWorkModel = (
  text: string,
  explicit?: string | null,
): 'remote' | 'hybrid' | 'onsite' | 'any' => {
  const haystack = `${explicit || ''} ${text}`.toLowerCase();

  if (/fully remote|100%\s*remote|remote[- ]only|praca zdalna|zdalnie/.test(haystack)) {
    return 'remote';
  }

  if (/hybrid|hybrydowy|partially remote|częściowo zdalnie/.test(haystack)) {
    return 'hybrid';
  }

  if (/on-?site|in[- ]office|on[- ]premise|stacjonarnie|w biurze/.test(haystack)) {
    return 'onsite';
  }

  return 'any';
};

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const extractSkillTokens = (text: string): string[] => {
  const lower = text.toLowerCase();

  const multiWordTerms = [
    'machine learning',
    'deep learning',
    'natural language processing',
    'computer vision',
    'active directory',
    'office 365',
    'microsoft 365',
    'google workspace',
    'power bi',
    'power automate',
    'power apps',
    'node.js',
    'next.js',
    'vue.js',
    'nuxt.js',
    'express.js',
    'react native',
    'flutter',
    'xamarin',
    'ci/cd',
    'rest api',
    'graphql',
    'web services',
    'test driven',
    'behavior driven',
    'customer support',
    'technical support',
    'customer success',
    'project management',
    'product management',
    'incident management',
    'change management',
    'problem management',
    'manual testing',
    'automation testing',
    'performance testing',
    'sql server',
    'ms sql',
    'oracle db',
    'spring boot',
    'asp.net',
    '.net core',
    'google cloud',
    'amazon web services',
  ];

  const singleWordTerms = [
    'javascript',
    'typescript',
    'python',
    'java',
    'kotlin',
    'swift',
    'go',
    'golang',
    'rust',
    'ruby',
    'php',
    'scala',
    'c#',
    'c++',
    'bash',
    'powershell',
    'react',
    'angular',
    'vue',
    'svelte',
    'tailwind',
    'bootstrap',
    'webpack',
    'node',
    'django',
    'flask',
    'fastapi',
    'rails',
    'laravel',
    'symfony',
    'postgresql',
    'mysql',
    'mongodb',
    'redis',
    'elasticsearch',
    'cassandra',
    'supabase',
    'firebase',
    'dynamodb',
    'aws',
    'azure',
    'gcp',
    'terraform',
    'ansible',
    'pulumi',
    'docker',
    'kubernetes',
    'helm',
    'nginx',
    'linux',
    'ubuntu',
    'debian',
    'git',
    'github',
    'gitlab',
    'bitbucket',
    'jenkins',
    'jira',
    'confluence',
    'notion',
    'servicenow',
    'zendesk',
    'freshdesk',
    'prometheus',
    'grafana',
    'datadog',
    'splunk',
    'kibana',
    'elk',
    'selenium',
    'playwright',
    'cypress',
    'jest',
    'pytest',
    'junit',
    'figma',
    'sketch',
    'zeplin',
    'invision',
    'scrum',
    'kanban',
    'agile',
    'waterfall',
    'itil',
    'prince2',
    'excel',
    'powerpoint',
    'word',
    'sharepoint',
    'tableau',
    'looker',
    'networking',
    'tcp/ip',
    'dns',
    'dhcp',
    'vpn',
    'firewall',
    'wireshark',
    'security',
    'cybersecurity',
    'owasp',
    'siem',
    'soc',
    'compliance',
    'api',
    'microservices',
    'kafka',
    'rabbitmq',
    'grpc',
    'salesforce',
    'sap',
    'dynamics',
    'hubspot',
    'communication',
    'leadership',
    'mentoring',
    'coaching',
    'english',
    'polish',
    'german',
    'french',
    'spanish',
  ];

  const frequency = new Map<string, number>();

  const countTerm = (term: string) => {
    let count = 0;
    let position = 0;

    while ((position = lower.indexOf(term, position)) !== -1) {
      count += 1;
      position += term.length;
    }

    if (count > 0) {
      frequency.set(term, (frequency.get(term) ?? 0) + count);
    }
  };

  for (const term of multiWordTerms) {
    countTerm(term);
  }

  for (const term of singleWordTerms) {
    const escaped = escapeRegex(term);

    // Edge-safe replacement for negative lookbehind.
    // Captures term boundaries without using (?<!...), which can be risky in some runtimes.
    const regex = new RegExp(`(^|[^a-z0-9+#.])${escaped}([^a-z0-9+#.]|$)`, 'gi');

    const hits = Array.from(lower.matchAll(regex)).length;

    if (hits > 0) {
      frequency.set(term, (frequency.get(term) ?? 0) + hits);
    }
  }

  return Array.from(frequency.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([term]) => term);
};

const extractLanguages = (text: string): string[] => {
  const languages: string[] = [];

  const patterns: [string, RegExp][] = [
    ['English', /\b(english|angielski|język angielski)\b/i],
    ['Polish', /\b(polish|polski|język polski)\b/i],
    ['German', /\b(german|deutsch|język niemiecki|niemiec)\b/i],
    ['French', /\b(french|français|język francuski)\b/i],
    ['Spanish', /\b(spanish|español|język hiszpański)\b/i],
    ['Czech', /\b(czech|čeština|język czeski)\b/i],
  ];

  for (const [language, regex] of patterns) {
    if (regex.test(text)) {
      languages.push(language);
    }
  }

  return languages;
};

const extractJobSignals = (job: JobAd): JobSignals => {
  const fullText = `${job.title || ''} ${job.description || ''} ${job.work_model || ''}`;

  return {
    seniority: detectSeniority(fullText),
    domain: detectDomain(fullText),
    skills: extractSkillTokens(fullText),
    languages: extractLanguages(fullText),
    workModel: detectWorkModel(fullText, job.work_model),
    locationHint: job.location || '',
  };
};

const extractCvSignals = (cvText: string): CvSignals => ({
  seniority: detectSeniority(cvText),
  domain: detectDomain(cvText),
  skills: extractSkillTokens(cvText),
  languages: extractLanguages(cvText),
  workModelPreference: detectWorkModel(cvText),
  locationHint: '',
});

// ─── dimension weights ────────────────────────────────────────────────────────

const getDimensionWeights = (domain: string): ScoreDimensions => {
  const base = {
    skills: 0.4,
    seniority: 0.2,
    domain: 0.2,
    logistics: 0.1,
    language: 0.1,
  };

  if (/IT Support|Helpdesk|Service Desk/i.test(domain)) {
    return {
      ...base,
      skills: 0.35,
      domain: 0.25,
    };
  }

  if (/Software Engineering/i.test(domain)) {
    return {
      ...base,
      skills: 0.45,
      seniority: 0.25,
      domain: 0.15,
      logistics: 0.1,
      language: 0.05,
    };
  }

  if (/Data|Analytics/i.test(domain)) {
    return {
      ...base,
      skills: 0.45,
      domain: 0.25,
      seniority: 0.15,
      logistics: 0.1,
      language: 0.05,
    };
  }

  if (/Cybersecurity/i.test(domain)) {
    return {
      ...base,
      skills: 0.4,
      domain: 0.3,
      seniority: 0.15,
      logistics: 0.1,
      language: 0.05,
    };
  }

  if (/Sales|Customer Success/i.test(domain)) {
    return {
      ...base,
      skills: 0.25,
      domain: 0.25,
      language: 0.25,
      logistics: 0.15,
      seniority: 0.1,
    };
  }

  if (/HR|Recruitment/i.test(domain)) {
    return {
      ...base,
      skills: 0.25,
      domain: 0.25,
      language: 0.25,
      logistics: 0.15,
      seniority: 0.1,
    };
  }

  return base;
};

// ─── fallback scorer ──────────────────────────────────────────────────────────

const fallbackScoreDimensions = (
  jobSignals: JobSignals,
  cvSignals: CvSignals,
): ScoreDimensions => {
  const cvSkillSet = new Set(cvSignals.skills);

  const matched = jobSignals.skills.filter((skill) => cvSkillSet.has(skill));

  const weightedTotal = jobSignals.skills.reduce((acc, _skill, index) => acc + 1 / (index + 1), 0);

  const weightedMatched = matched.reduce((acc, skill) => {
    const rank = jobSignals.skills.indexOf(skill);
    return acc + 1 / (rank + 1);
  }, 0);

  const skillsScore =
    jobSignals.skills.length > 0 ? clamp((weightedMatched / weightedTotal) * 100) : 50;

  const seniorityOrder: Record<JobSignals['seniority'], number> = {
    junior: 1,
    mid: 2,
    senior: 3,
    lead: 4,
    any: 2,
  };

  const jobLevel = seniorityOrder[jobSignals.seniority];
  const cvLevel = seniorityOrder[cvSignals.seniority];
  const difference = cvLevel - jobLevel;

  let seniorityScore: number;

  if (difference === 0) seniorityScore = 100;
  else if (difference === 1) seniorityScore = 80;
  else if (difference === -1) seniorityScore = 60;
  else if (difference >= 2) seniorityScore = 70;
  else seniorityScore = 35;

  if (jobSignals.seniority === 'any' || cvSignals.seniority === 'any') {
    seniorityScore = 75;
  }

  const domainScore =
    jobSignals.domain === cvSignals.domain
      ? 100
      : jobSignals.domain === 'General' || cvSignals.domain === 'General'
        ? 60
        : 35;

  let logisticsScore = 80;

  const jobModel = jobSignals.workModel;
  const cvModel = cvSignals.workModelPreference;

  if (jobModel !== 'any' && cvModel !== 'any') {
    logisticsScore = jobModel === cvModel ? 100 : jobModel === 'hybrid' ? 70 : 45;
  }

  if (jobModel === 'remote') {
    logisticsScore = Math.max(logisticsScore, 85);
  }

  let languageScore = 80;

  if (jobSignals.languages.length > 0) {
    const cvLanguages = new Set(cvSignals.languages.map((language) => language.toLowerCase()));
    const matchedLanguages = jobSignals.languages.filter((language) =>
      cvLanguages.has(language.toLowerCase()),
    );

    languageScore = clamp((matchedLanguages.length / jobSignals.languages.length) * 100);

    if (jobSignals.languages.includes('English') && !cvLanguages.has('english')) {
      languageScore = Math.max(languageScore, 50);
    }
  }

  return {
    skills: clamp(skillsScore),
    seniority: clamp(seniorityScore),
    domain: clamp(domainScore),
    logistics: clamp(logisticsScore),
    language: clamp(languageScore),
  };
};

const aggregateDimensions = (dimensions: ScoreDimensions, weights: ScoreDimensions): number =>
  clamp(
    dimensions.skills * weights.skills +
      dimensions.seniority * weights.seniority +
      dimensions.domain * weights.domain +
      dimensions.logistics * weights.logistics +
      dimensions.language * weights.language,
  );

const fallbackScore = (jobSignals: JobSignals, cvSignals: CvSignals): ScoreResult => {
  const dimensions = fallbackScoreDimensions(jobSignals, cvSignals);
  const weights = getDimensionWeights(jobSignals.domain);
  const score = aggregateDimensions(dimensions, weights);

  const matched = jobSignals.skills.filter((skill) => cvSignals.skills.includes(skill));
  const missing = jobSignals.skills.filter((skill) => !cvSignals.skills.includes(skill));

  const concerns: string[] = [];

  if (dimensions.seniority < 50) {
    concerns.push(
      `Seniority gap: job wants ${jobSignals.seniority}, CV shows ${cvSignals.seniority}.`,
    );
  }

  if (dimensions.domain < 50) {
    concerns.push(
      `Domain mismatch: job is ${jobSignals.domain}, CV is oriented toward ${cvSignals.domain}.`,
    );
  }

  if (dimensions.language < 60) {
    concerns.push(`Language gap: job requires ${jobSignals.languages.join(', ')}.`);
  }

  if (dimensions.logistics < 50) {
    concerns.push(`Work-model mismatch: job is ${jobSignals.workModel}.`);
  }

  const cvAngle =
    matched.length > 0
      ? `Emphasise ${matched.slice(0, 4).join(', ')} — these are your strongest overlaps with the role.`
      : `Focus on transferable skills from ${cvSignals.domain} that map onto ${jobSignals.domain}.`;

  return {
    match_score: score,
    fit_label: getFitLabel(score),
    recommendation: getRecommendation(score),
    matched_skills: matched.slice(0, 12),
    missing_skills: missing.slice(0, 12),
    concerns,
    suggested_cv_angle: cvAngle,
    explanation: `Fallback scoring was used. Skills: ${dimensions.skills}/100 · Seniority: ${dimensions.seniority}/100 · Domain: ${dimensions.domain}/100 · Logistics: ${dimensions.logistics}/100 · Language: ${dimensions.language}/100.`,
    score_breakdown: dimensions,
  };
};

// ─── AI scoring ───────────────────────────────────────────────────────────────

const extractJsonObject = (text: string): unknown => {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');

  if (start === -1 || end === -1 || end <= start) {
    throw new Error('AI response did not contain a JSON object.');
  }

  return JSON.parse(text.slice(start, end + 1));
};

const validateAiScore = (
  value: unknown,
  jobSignals: JobSignals,
  cvSignals: CvSignals,
): ScoreResult => {
  const raw = value as Record<string, unknown>;

  const rawScore = Number(raw.match_score ?? 0);
  const score = clamp(rawScore);

  const rawBreakdown = (raw.score_breakdown ?? {}) as Record<string, unknown>;

  const aiDimensions: ScoreDimensions = {
    skills: clamp(Number(rawBreakdown.skills ?? rawBreakdown.skill_match ?? score)),
    seniority: clamp(Number(rawBreakdown.seniority ?? rawBreakdown.experience ?? score)),
    domain: clamp(Number(rawBreakdown.domain ?? rawBreakdown.role_fit ?? score)),
    logistics: clamp(Number(rawBreakdown.logistics ?? score)),
    language: clamp(Number(rawBreakdown.language ?? rawBreakdown.keywords ?? score)),
  };

  const allSame = Object.values(aiDimensions).every((value) => value === aiDimensions.skills);

  const dimensions = allSame ? fallbackScoreDimensions(jobSignals, cvSignals) : aiDimensions;

  const weights = getDimensionWeights(jobSignals.domain);
  const finalScore = allSame ? aggregateDimensions(dimensions, weights) : score;

  const recommendation = (
    ['recommended', 'possible', 'stretch', 'not_recommended'].includes(String(raw.recommendation))
      ? raw.recommendation
      : getRecommendation(finalScore)
  ) as Recommendation;

  return {
    match_score: finalScore,
    fit_label: String(raw.fit_label || getFitLabel(finalScore)),
    recommendation,
    matched_skills: safeArray(raw.matched_skills).slice(0, 12),
    missing_skills: safeArray(raw.missing_skills).slice(0, 12),
    concerns: safeArray(raw.concerns).slice(0, 8),
    suggested_cv_angle: String(raw.suggested_cv_angle || ''),
    explanation: String(raw.explanation || ''),
    score_breakdown: dimensions,
  };
};

const buildScoringPrompt = (jobText: string, cvText: string, jobSignals: JobSignals): string => {
  const weights = getDimensionWeights(jobSignals.domain);

  const weightLines = [
    `  - skills (${Math.round(weights.skills * 100)}% weight): hard-skill overlap, tech stack match`,
    `  - seniority (${Math.round(weights.seniority * 100)}% weight): years of experience and responsibility level`,
    `  - domain (${Math.round(weights.domain * 100)}% weight): is this the same type of work?`,
    `  - logistics (${Math.round(weights.logistics * 100)}% weight): work model and location fit`,
    `  - language (${Math.round(weights.language * 100)}% weight): natural language requirements`,
  ].join('\n');

  return `You are a senior recruiter and ATS expert scoring a CV against a job description.

CONTEXT
- Job domain: ${jobSignals.domain}
- Job seniority: ${jobSignals.seniority}
- Work model: ${jobSignals.workModel}
- Key skills in JD: ${jobSignals.skills.slice(0, 15).join(', ')}
- Languages required: ${jobSignals.languages.join(', ') || 'not specified'}

SCORING DIMENSIONS AND WEIGHTS
${weightLines}

Compute a weighted average to get match_score (0–100).
Be strict: only give credit for skills and experience that are clearly evidenced in the CV.
Do NOT give benefit of the doubt for vague or missing details.

Scoring thresholds:
  85–100 → recommended
  70–84  → possible
  55–69  → stretch
  0–54   → not_recommended

Return ONLY valid JSON — no markdown, no explanation outside the JSON:

{
  "match_score": <weighted average 0–100>,
  "fit_label": "<Strong fit | Good fit | Stretch fit | Low fit>",
  "recommendation": "<recommended | possible | stretch | not_recommended>",
  "matched_skills": ["<skill>", ...],
  "missing_skills": ["<skill>", ...],
  "concerns": ["<specific concern>", ...],
  "suggested_cv_angle": "<1–2 sentences on how to tailor the CV for this role>",
  "explanation": "<2–3 sentences explaining the score rationale>",
  "score_breakdown": {
    "skills": <0–100>,
    "seniority": <0–100>,
    "domain": <0–100>,
    "logistics": <0–100>,
    "language": <0–100>
  }
}

JOB DESCRIPTION:
${jobText}

---

CV:
${cvText}`;
};

const scoreWithGroq = async (
  jobText: string,
  cvText: string,
  jobSignals: JobSignals,
  cvSignals: CvSignals,
): Promise<ScoreResult | null> => {
  const apiKey = Deno.env.get('GROQ_API_KEY');

  if (!apiKey) return null;

  const model = Deno.env.get('GROQ_MODEL') || 'llama-3.3-70b-versatile';
  const prompt = buildScoringPrompt(jobText, cvText, jobSignals);

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.15,
      max_tokens: 800,
      messages: [
        {
          role: 'system',
          content: 'You are a job-matching evaluator. Return only valid JSON. No markdown. No commentary.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    console.error('Groq scoring failed:', response.status, await response.text());
    return null;
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;

  if (!content) return null;

  return validateAiScore(extractJsonObject(content), jobSignals, cvSignals);
};

const scoreWithLlamaEndpoint = async (
  jobText: string,
  cvText: string,
  jobSignals: JobSignals,
  cvSignals: CvSignals,
): Promise<ScoreResult | null> => {
  const apiKey = Deno.env.get('LLAMA_API_KEY');
  const apiUrl = Deno.env.get('LLAMA_API_URL');
  const model = Deno.env.get('LLAMA_MODEL');

  if (!apiKey || !apiUrl) return null;

  const prompt = buildScoringPrompt(jobText, cvText, jobSignals);

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.15,
      max_tokens: 800,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    console.error('Llama scoring failed:', response.status, await response.text());
    return null;
  }

  const data = await response.json();

  const content =
    data?.choices?.[0]?.message?.content ||
    data?.completion ||
    data?.content ||
    data?.response;

  if (!content) return null;

  return validateAiScore(extractJsonObject(String(content)), jobSignals, cvSignals);
};

const scoreJob = async (
  jobText: string,
  cvText: string,
  jobSignals: JobSignals,
  cvSignals: CvSignals,
): Promise<ScoreResult> => {
  try {
    const groqResult = await scoreWithGroq(jobText, cvText, jobSignals, cvSignals);

    if (groqResult) return groqResult;
  } catch (error) {
    console.error('Groq cascade error:', error);
  }

  try {
    const llamaResult = await scoreWithLlamaEndpoint(jobText, cvText, jobSignals, cvSignals);

    if (llamaResult) return llamaResult;
  } catch (error) {
    console.error('Llama cascade error:', error);
  }

  return fallbackScore(jobSignals, cvSignals);
};

// ─── edge function handler ────────────────────────────────────────────────────

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders,
    });
  }

  if (request.method !== 'POST') {
    return jsonResponse(
      {
        success: false,
        error: 'Method not allowed.',
      },
      405,
    );
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse(
        {
          success: false,
          error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.',
        },
        500,
      );
    }

    const authHeader = request.headers.get('Authorization') || '';

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return jsonResponse(
        {
          success: false,
          error: 'Unauthorised.',
        },
        401,
      );
    }

    const body = (await request.json()) as ScoreRequest;
    const jobAdId = body.job_ad_id;
    const cvVersionId = body.cv_version_id;

    if (!jobAdId) {
      return jsonResponse(
        {
          success: false,
          error: 'job_ad_id is required.',
        },
        400,
      );
    }

    if (!cvVersionId) {
      return jsonResponse(
        {
          success: false,
          error: 'cv_version_id is required. Select a default CV first.',
        },
        400,
      );
    }

    const { data: job, error: jobError } = await supabase
      .from('job_ads')
      .select('*')
      .eq('id', jobAdId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (jobError) {
      return jsonResponse(
        {
          success: false,
          error: jobError.message,
        },
        500,
      );
    }

    if (!job) {
      return jsonResponse(
        {
          success: false,
          error: 'Job not found.',
        },
        404,
      );
    }

    const { data: cv, error: cvError } = await supabase
      .from('cv_versions')
      .select('*')
      .eq('id', cvVersionId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (cvError) {
      return jsonResponse(
        {
          success: false,
          error: cvError.message,
        },
        500,
      );
    }

    if (!cv) {
      return jsonResponse(
        {
          success: false,
          error: 'CV version not found.',
        },
        404,
      );
    }

    const typedJob = job as JobAd;
    const jobText = buildJobText(typedJob);
    const cvText = extractCvText(cv as Record<string, unknown>);

    if (!jobText) {
      return jsonResponse(
        {
          success: false,
          error: 'Job description is empty or unreadable.',
        },
        400,
      );
    }

    if (!cvText) {
      return jsonResponse(
        {
          success: false,
          error: 'CV content is empty or unreadable.',
        },
        400,
      );
    }

    const jobSignals = extractJobSignals(typedJob);
    const cvSignals = extractCvSignals(cvText);

    console.log('Job signals:', JSON.stringify(jobSignals));
    console.log('CV signals:', JSON.stringify(cvSignals));

    const score = await scoreJob(jobText, cvText, jobSignals, cvSignals);

    const matchPayload = {
      user_id: user.id,
      job_ad_id: jobAdId,
      cv_version_id: cvVersionId,
      match_score: score.match_score,
      fit_label: score.fit_label,
      recommendation: score.recommendation,
      matched_skills: score.matched_skills,
      missing_skills: score.missing_skills,
      concerns: score.concerns,
      suggested_cv_angle: score.suggested_cv_angle,
      explanation: score.explanation,
      score_breakdown: score.score_breakdown,
      raw_result: {
        ...score,
        job_signals: jobSignals,
        cv_signals: cvSignals,
      },
      ai_used: Boolean(Deno.env.get('GROQ_API_KEY') || Deno.env.get('LLAMA_API_KEY')),
    };

    const { data: existingMatch } = await supabase
      .from('job_match_results')
      .select('id')
      .eq('user_id', user.id)
      .eq('job_ad_id', jobAdId)
      .eq('cv_version_id', cvVersionId)
      .maybeSingle();

    const upsertQuery = existingMatch?.id
      ? supabase
          .from('job_match_results')
          .update(matchPayload)
          .eq('id', existingMatch.id)
          .eq('user_id', user.id)
      : supabase.from('job_match_results').insert(matchPayload);

    const { data: savedMatch, error: saveError } = await upsertQuery
      .select(
        'id, job_ad_id, cv_version_id, match_score, fit_label, recommendation, matched_skills, missing_skills, concerns, suggested_cv_angle, explanation, created_at',
      )
      .single();

    if (saveError) {
      return jsonResponse(
        {
          success: false,
          error: saveError.message,
        },
        500,
      );
    }

    const { error: updateJobError } = await supabase
      .from('job_ads')
      .update({
        best_match_score: score.match_score,
        best_fit_label: score.fit_label,
        recommendation: score.recommendation,
        matched_at: new Date().toISOString(),
      })
      .eq('id', jobAdId)
      .eq('user_id', user.id);

    if (updateJobError) {
      console.error('Failed to update job_ads cache:', updateJobError.message);
    }

    return jsonResponse(savedMatch);
  } catch (error) {
    console.error('score-job fatal error:', error);

    return jsonResponse(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error.',
      },
      500,
    );
  }
});