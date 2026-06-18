import type {
  CVProfile,
  JobAd,
  LLMConfig,
  ScoreResult,
  UserJobPreferences,
} from './types.ts';

const SKILL_KEYWORDS = [
  'active directory',
  'windows',
  'windows server',
  'linux',
  'macos',
  'networking',
  'tcp/ip',
  'dns',
  'dhcp',
  'vpn',
  'jira',
  'servicenow',
  'zendesk',
  'sql',
  'mysql',
  'postgresql',
  'python',
  'javascript',
  'typescript',
  'react',
  'node',
  'api',
  'postman',
  'aws',
  'azure',
  'google cloud',
  'docker',
  'kubernetes',
  'ci/cd',
  'troubleshooting',
  'technical support',
  'customer support',
  'help desk',
  'service desk',
  'incident management',
  'itil',
  'qa',
  'testing',
  'automation',
];

function normalise(value: unknown) {
  return String(value || '').toLowerCase();
}

function unique(items: string[]) {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function extractSkills(text: string) {
  const value = normalise(text);
  return SKILL_KEYWORDS.filter((skill) => value.includes(skill));
}

function getRecommendation(score: number): ScoreResult['recommendation'] {
  if (score >= 85) return 'recommended';
  if (score >= 70) return 'possible';
  if (score >= 55) return 'stretch';
  return 'not_recommended';
}

function getFitLabel(score: number) {
  if (score >= 85) return 'Strong Match';
  if (score >= 70) return 'Good Fit';
  if (score >= 55) return 'Possible Fit';
  return 'Weak Match';
}

function scoreTitle(jobTitle: string, preferences: UserJobPreferences) {
  const title = normalise(jobTitle);
  const targets = preferences.target_titles || [];

  if (targets.some((target) => title.includes(normalise(target)))) return 100;

  if (title.includes('support') && targets.some((target) => normalise(target).includes('support'))) {
    return 85;
  }

  if (title.includes('engineer') && targets.some((target) => normalise(target).includes('engineer'))) {
    return 75;
  }

  if (title.includes('junior') && targets.some((target) => normalise(target).includes('junior'))) {
    return 70;
  }

  return 45;
}

function scoreLocation(job: JobAd, preferences: UserJobPreferences) {
  const location = normalise(job.location);
  const preferred = preferences.preferred_locations || [];

  if (preferred.length === 0) return 70;

  if (preferred.some((item) => location.includes(normalise(item)))) return 100;

  if (location.includes('remote') && preferred.some((item) => normalise(item).includes('remote'))) {
    return 95;
  }

  if (location.includes('poland') && preferred.some((item) => normalise(item).includes('poland'))) {
    return 85;
  }

  return 45;
}

function scoreSeniority(job: JobAd) {
  const text = normalise(`${job.title} ${job.description}`);

  if (
    text.includes('senior') ||
    text.includes('lead') ||
    text.includes('manager') ||
    text.includes('principal') ||
    text.includes('architect')
  ) {
    return 35;
  }

  if (
    text.includes('junior') ||
    text.includes('entry') ||
    text.includes('associate') ||
    text.includes('specialist') ||
    text.includes('support')
  ) {
    return 90;
  }

  return 70;
}

function hasExcludedKeyword(job: JobAd, preferences: UserJobPreferences) {
  const text = normalise(`${job.title} ${job.description}`);
  const excluded = preferences.excluded_keywords || [];

  return excluded.filter((keyword) => text.includes(normalise(keyword)));
}

function buildCvText(cvProfile: CVProfile | null) {
  if (!cvProfile) return '';

  return [
    cvProfile.cv_text,
    cvProfile.profile_summary,
    cvProfile.structured_cv ? JSON.stringify(cvProfile.structured_cv) : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function ruleBasedScore(
  job: JobAd,
  cvProfile: CVProfile | null,
  preferences: UserJobPreferences,
): ScoreResult {
  const cvText = buildCvText(cvProfile);
  const jobText = `${job.title} ${job.description || ''} ${job.employment_type || ''}`;

  const cvSkills = extractSkills(cvText);
  const jobSkills = extractSkills(jobText);

  const matchedSkills = unique(jobSkills.filter((skill) => cvSkills.includes(skill)));
  const missingSkills = unique(jobSkills.filter((skill) => !cvSkills.includes(skill))).slice(0, 8);

  const skillScore =
    jobSkills.length === 0
      ? 65
      : Math.round((matchedSkills.length / Math.max(jobSkills.length, 1)) * 100);

  const titleScore = scoreTitle(job.title, preferences);
  const locationScore = scoreLocation(job, preferences);
  const seniorityScore = scoreSeniority(job);
  const salaryScore = job.salary_range ? 70 : 50;

  const excludedMatches = hasExcludedKeyword(job, preferences);

  let finalScore = Math.round(
    skillScore * 0.35 +
      titleScore * 0.25 +
      locationScore * 0.15 +
      seniorityScore * 0.15 +
      salaryScore * 0.10,
  );

  const concerns: string[] = [];

  if (excludedMatches.length > 0) {
    concerns.push(`Contains excluded keywords: ${excludedMatches.join(', ')}`);
    finalScore -= 20;
  }

  if (seniorityScore < 50) {
    concerns.push('May be too senior based on title or description.');
  }

  if (missingSkills.length > 0) {
    concerns.push(`Missing visible skills: ${missingSkills.slice(0, 5).join(', ')}`);
  }

  finalScore = Math.max(0, Math.min(100, finalScore));

  return {
    match_score: finalScore,
    fit_label: getFitLabel(finalScore),
    recommendation: getRecommendation(finalScore),
    skill_score: Math.max(0, Math.min(100, skillScore)),
    title_score: titleScore,
    location_score: locationScore,
    seniority_score: seniorityScore,
    salary_score: salaryScore,
    matched_skills: matchedSkills,
    missing_skills: missingSkills,
    concerns,
    suggested_cv_angle:
      finalScore >= 70
        ? 'Tailor the CV around technical support, troubleshooting, ticket handling, customer communication, and relevant tools from the job description.'
        : 'Only apply if you can clearly show transferable technical support, troubleshooting, and learning ability.',
    explanation:
      finalScore >= 70
        ? 'This role appears relevant based on your target titles, location preferences, and visible skill overlap.'
        : 'This role has limited visible overlap or may require skills/seniority not clearly present in the CV.',
    raw_result: {
      method: 'rule_based',
      cvSkills,
      jobSkills,
      excludedMatches,
    },
    ai_used: false,
  };
}

async function callLLM(
  job: JobAd,
  cvProfile: CVProfile | null,
  preferences: UserJobPreferences,
  llm: LLMConfig,
): Promise<Partial<ScoreResult> | null> {
  if (!llm.apiKey || !llm.apiUrl || !llm.model) {
    return null;
  }

  const prompt = `
You are scoring a real job for a job seeker in Poland.

Candidate CV/Profile:
${buildCvText(cvProfile).slice(0, 5000)}

Career goal:
${preferences.career_goal || 'Move into stronger technical support, cloud support, QA, or junior software engineering roles.'}

Target roles:
${(preferences.target_titles || []).join(', ')}

Preferred locations:
${(preferences.preferred_locations || []).join(', ')}

Job:
Title: ${job.title}
Company: ${job.company || 'Unknown'}
Location: ${job.location || 'Unknown'}
Work model: ${job.work_model || 'Unknown'}
Salary: ${job.salary_range || 'Not provided'}
Description:
${(job.description || '').slice(0, 4000)}

Return ONLY valid JSON:
{
  "match_score": 0,
  "fit_label": "Strong Match | Good Fit | Possible Fit | Weak Match",
  "recommendation": "recommended | possible | stretch | not_recommended",
  "matched_skills": [],
  "missing_skills": [],
  "concerns": [],
  "suggested_cv_angle": "",
  "explanation": ""
}
`.trim();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), llm.timeoutMs);

  try {
    const response = await fetch(llm.apiUrl, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${llm.apiKey}`,
      },
      body: JSON.stringify({
        model: llm.model,
        temperature: 0.2,
        max_tokens: 900,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      console.error('[scorer] LLM failed:', response.status, await response.text());
      return null;
    }

    const data = await response.json();
    const text =
      data.choices?.[0]?.message?.content ||
      data.choices?.[0]?.text ||
      data.content?.[0]?.text ||
      '';

    const clean = String(text).replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch (error) {
    console.error('[scorer] LLM scoring error:', error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function scoreJobAgainstCV(
  job: JobAd,
  cvProfile: CVProfile | null,
  preferences: UserJobPreferences,
  llm: LLMConfig,
): Promise<ScoreResult> {
  const base = ruleBasedScore(job, cvProfile, preferences);
  const ai = await callLLM(job, cvProfile, preferences, llm);

  if (!ai) return base;

  const aiScore = Number(ai.match_score);
  const safeScore = Number.isFinite(aiScore)
    ? Math.max(0, Math.min(100, Math.round(aiScore)))
    : base.match_score;

  return {
    ...base,
    match_score: safeScore,
    fit_label: ai.fit_label || getFitLabel(safeScore),
    recommendation:
      ai.recommendation === 'recommended' ||
      ai.recommendation === 'possible' ||
      ai.recommendation === 'stretch' ||
      ai.recommendation === 'not_recommended'
        ? ai.recommendation
        : getRecommendation(safeScore),
    matched_skills: Array.isArray(ai.matched_skills)
      ? ai.matched_skills
      : base.matched_skills,
    missing_skills: Array.isArray(ai.missing_skills)
      ? ai.missing_skills
      : base.missing_skills,
    concerns: Array.isArray(ai.concerns) ? ai.concerns : base.concerns,
    suggested_cv_angle: ai.suggested_cv_angle || base.suggested_cv_angle,
    explanation: ai.explanation || base.explanation,
    raw_result: {
      ...base.raw_result,
      ai_result: ai,
    },
    ai_used: true,
  };
}