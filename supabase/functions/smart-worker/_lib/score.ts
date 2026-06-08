// ============================================================
// _lib/score.ts
// Pass 2: section-aware scoring using locked facts
// Model receives structured data, not raw CV text.
// ============================================================

import { callLLM } from './llm.ts';
import { ANALYSIS_SYSTEM } from './prompts.ts';
import type {
  AnalysisResult,
  LLMConfig,
  StructuredCV,
  StructuredJD,
} from './types.ts';

export async function scoreStructured(
  cv: StructuredCV,
  jd: StructuredJD,
  learningContextBlock: string,
  config: LLMConfig,
  deterministicContextBlock = '',
): Promise<AnalysisResult> {
  const prompt = buildScoringPrompt(cv, jd, `${learningContextBlock || ''}\n${deterministicContextBlock || ''}`);

  const result = await callLLM(
    prompt,
    ANALYSIS_SYSTEM,
    config,
    5000,
  ) as Partial<AnalysisResult>;

  return normalizeAnalysisResult(result);
}

function buildScoringPrompt(
  cv: StructuredCV,
  jd: StructuredJD,
  contextBlock: string,
): string {
  const l = cv.locked;

  return `${contextBlock || ''}

You have pre-parsed LOCKED FACTS for the CV and structured requirements for the JD.
Use these for accurate, consistent scoring. Do not re-interpret raw text.

=== CANDIDATE LOCKED FACTS ===
Name: ${l.contact?.name ?? 'Unknown'}
Seniority: ${l.seniority_level} | Years experience: ${l.total_years_experience ?? 'unknown'}

EXPERIENCE (${l.experience.length} roles):
${l.experience.map((e) =>
  `• ${e.title} at ${e.company} (${e.start_date} – ${e.end_date})
  Bullets: ${e.raw_bullets.slice(0, 3).join(' | ') || 'No bullets listed'}
  Tech: ${e.technologies.join(', ') || 'none listed'}`
).join('\n') || 'No experience listed'}

SKILLS:
  Technical: ${cv.locked_skills.technical.join(', ') || 'None listed'}
  Tools: ${cv.locked_skills.tools.join(', ') || 'None listed'}
  Soft: ${cv.locked_skills.soft.join(', ') || 'None listed'}
  Languages: ${cv.locked_skills.languages.join(', ') || 'None listed'}

EDUCATION:
${l.education.map((e) =>
  `• ${e.degree} — ${e.institution || 'institution unknown'} (${e.year ?? 'year unknown'})`
).join('\n') || 'None listed'}

CERTIFICATIONS:
${l.certifications.map((c) => `• ${c.name}${c.issuer ? ` — ${c.issuer}` : ''}`).join('\n') || 'None'}

CV SECTIONS PRESENT:
${Object.entries(l.has_sections).filter(([, v]) => v).map(([k]) => k).join(', ') || 'None detected'}

=== JD REQUIREMENTS ===
Role: ${jd.job_title}${jd.company_name ? ` at ${jd.company_name}` : ''}
Category: ${jd.role_category} | Seniority: ${jd.seniority_required} | Domain: ${jd.domain}
Required years: ${jd.required_experience_years ?? 'not specified'}

MUST-HAVE KEYWORDS:
${jd.must_have_keywords.join(', ') || 'Not specified'}

REQUIRED SKILLS:
${jd.required_skills.join(', ') || 'Not specified'}

NICE TO HAVE:
${jd.nice_to_have_skills.join(', ') || 'Not specified'}

KEY RESPONSIBILITIES:
${jd.key_responsibilities.slice(0, 8).map((r) => `• ${r}`).join('\n') || 'Not specified'}

EDUCATION REQUIREMENTS:
${jd.education_requirements.join(', ') || 'Not specified'}

=== SCORING INSTRUCTIONS ===
- Compare jd.must_have_keywords against ALL cv skills, tools, and experience bullets.
- Treat the DETERMINISTIC EVIDENCE LAYER as the source of truth for confirmed, partial, and missing keyword evidence.
- Do not mark a keyword as matched unless it is confirmed or strongly supported by partial evidence.
- Apply synonym matching per your system instructions.
- For transferability, map experience bullets to JD responsibilities even if terminology differs.
- For seniority, compare cv seniority_level + years vs jd requirements.
- For ATS, penalise missing standard sections.
- Do NOT default all scores to 75. Scores must differ meaningfully.

Return ONLY this JSON. No markdown. No explanation:
{
  "job_title": "${escapeJson(jd.job_title)}",
  "company_name": ${jd.company_name ? `"${escapeJson(jd.company_name)}"` : 'null'},
  "recommended_to_apply": "YES | YES — Tailor CV First | MAYBE | NO",
  "qualification_verdict": "Qualified | Borderline Qualified | Not Qualified",
  "overall_job_fit_score": 0,
  "transferability_score": 0,
  "ats_match_score": 0,
  "seniority_match_score": 0,
  "skill_gap_score": 0,
  "score_breakdown": {
    "skills": 0,
    "experience": 0,
    "keywords": 0,
    "achievements": 0,
    "ats": 0
  },
  "strongest_transferable_skills": [],
  "critical_missing_skills": [],
  "learnable_missing_skills": [],
  "nice_to_have_missing_skills": [],
  "matched_keywords": [],
  "missing_keywords": [],
  "partial_keywords": [],
  "strengths": [],
  "gaps": [],
  "ai_recommendations": [],
  "cv_improvement_actions": [],
  "role_category": "${escapeJson(jd.role_category)}",
  "is_truncated": false
}`;
}

function normalizeAnalysisResult(
  result: Partial<AnalysisResult>,
): AnalysisResult {
  return {
    recommended_to_apply: result.recommended_to_apply ?? 'MAYBE',
    qualification_verdict:
      result.qualification_verdict ?? 'Borderline Qualified',

    overall_job_fit_score: clampScore(result.overall_job_fit_score),
    transferability_score: clampScore(result.transferability_score),
    ats_match_score: clampScore(result.ats_match_score),
    seniority_match_score: clampScore(result.seniority_match_score),
    skill_gap_score: clampScore(result.skill_gap_score),

    score_breakdown: result.score_breakdown ?? {},

    strongest_transferable_skills:
      Array.isArray(result.strongest_transferable_skills)
        ? result.strongest_transferable_skills
        : [],

    critical_missing_skills:
      Array.isArray(result.critical_missing_skills)
        ? result.critical_missing_skills
        : [],

    learnable_missing_skills:
      Array.isArray(result.learnable_missing_skills)
        ? result.learnable_missing_skills
        : [],

    nice_to_have_missing_skills:
      Array.isArray(result.nice_to_have_missing_skills)
        ? result.nice_to_have_missing_skills
        : [],

    matched_keywords:
      Array.isArray(result.matched_keywords)
        ? result.matched_keywords
        : [],

    missing_keywords:
      Array.isArray(result.missing_keywords)
        ? result.missing_keywords
        : [],

    partial_keywords:
      Array.isArray(result.partial_keywords)
        ? result.partial_keywords
        : [],

    strengths:
      Array.isArray(result.strengths)
        ? result.strengths
        : [],

    gaps:
      Array.isArray(result.gaps)
        ? result.gaps
        : [],

    ai_recommendations:
      Array.isArray(result.ai_recommendations)
        ? result.ai_recommendations
        : [],

    cv_improvement_actions:
      Array.isArray(result.cv_improvement_actions)
        ? result.cv_improvement_actions
        : [],

    is_truncated: Boolean(result.is_truncated),
  };
}

function clampScore(value: unknown): number {
  const n = typeof value === 'number' ? value : 50;
  return Math.min(100, Math.max(0, Math.round(n)));
}

function escapeJson(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}