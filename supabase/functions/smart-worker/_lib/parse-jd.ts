// ============================================================
// _lib/parse-jd.ts
// Pass 1B: parse JD into structured requirements
// ============================================================

import { callLLM } from './llm.ts';
import { PARSE_JD_SYSTEM } from './prompts.ts';
import type { LLMConfig, StructuredJD } from './types.ts';

const COMMON_TECH_TERMS = [
  'JavaScript',
  'TypeScript',
  'Python',
  'Java',
  'React',
  'React.js',
  'Node.js',
  'Express',
  'Next.js',
  'SQL',
  'PostgreSQL',
  'MySQL',
  'MongoDB',
  'Supabase',
  'Firebase',
  'REST',
  'GraphQL',
  'Docker',
  'Kubernetes',
  'AWS',
  'Azure',
  'GCP',
  'Git',
  'GitHub',
  'GitHub Actions',
  'CI/CD',
  'Jira',
  'Agile',
  'Scrum',
  'Linux',
  'API',
  'APIs',
  'SaaS',
  'Customer Support',
  'Technical Support',
  'Troubleshooting',
  'Incident Management',
];

export async function parseJD(
  jobDescription: string,
  config: LLMConfig,
): Promise<StructuredJD> {
  const prompt = `Parse this job description. Be precise about must-have vs nice-to-have.
Extract ALL technical keywords — even ones mentioned only once.

JOB DESCRIPTION:
${jobDescription.slice(0, 5000)}

Return ONLY this JSON:
{
  "job_title": "exact job title from JD",
  "company_name": null,
  "role_category": "broad category e.g. Software Engineer, IT Support, Data Analyst, Product Manager",
  "seniority_required": "junior | mid-level | senior | lead",
  "must_have_keywords": ["every keyword that appears as required or essential"],
  "required_skills": ["skills explicitly listed as required"],
  "nice_to_have_skills": ["skills listed as desirable, preferred, or advantageous"],
  "key_responsibilities": ["each distinct responsibility from the JD"],
  "required_experience_years": null,
  "education_requirements": ["any degree or qualification requirements"],
  "domain": "industry domain e.g. fintech, SaaS, enterprise IT, healthcare"
}`;

  const result = await callLLM(
    prompt,
    PARSE_JD_SYSTEM,
    config,
    1800,
  ) as Partial<StructuredJD>;

  const defaults: StructuredJD = {
    job_title: 'Unknown Role',
    company_name: null,
    role_category: 'General',
    seniority_required: 'mid-level',
    must_have_keywords: [],
    required_skills: [],
    nice_to_have_skills: [],
    key_responsibilities: [],
    required_experience_years: null,
    education_requirements: [],
    domain: 'General',
  };

  const parsed: StructuredJD = {
    ...defaults,
    ...result,
    must_have_keywords: Array.isArray(result.must_have_keywords)
      ? result.must_have_keywords
      : [],
    required_skills: Array.isArray(result.required_skills)
      ? result.required_skills
      : [],
    nice_to_have_skills: Array.isArray(result.nice_to_have_skills)
      ? result.nice_to_have_skills
      : [],
    key_responsibilities: Array.isArray(result.key_responsibilities)
      ? result.key_responsibilities
      : [],
    education_requirements: Array.isArray(result.education_requirements)
      ? result.education_requirements
      : [],
  };

  if (parsed.must_have_keywords.length === 0) {
    parsed.must_have_keywords = extractKeywordsFallback(jobDescription);
  }

  if (
    parsed.required_skills.length === 0 &&
    parsed.must_have_keywords.length > 0
  ) {
    parsed.required_skills = parsed.must_have_keywords.slice(0, 15);
  }

  return parsed;
}

export function extractKeywordsFallback(jobDescription: string): string[] {
  const found = new Map<string, string>();

  for (const term of COMMON_TECH_TERMS) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'i');
    const match = jobDescription.match(regex);

    if (match) {
      found.set(term.toLowerCase(), match[0]);
    }
  }

  return Array.from(found.values()).slice(0, 25);
}