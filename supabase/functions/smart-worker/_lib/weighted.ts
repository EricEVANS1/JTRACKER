// ============================================================
// _lib/weighted.ts
// Deterministic weighted scoring formula
//
// Weights: AI (40%) + keywords (25%) + seniority (15%)
//        + sections (10%) + skills overlap (10%)
//
// Prevents score inflation from an overly optimistic model.
// ============================================================

import type { AnalysisResult, StructuredCV, StructuredJD } from './types.ts';

export interface ScoreComponents {
  aiScore: number;
  keywordScore: number;
  sectionScore: number;
  seniorityScore: number;
  skillsScore: number;
}

export function computeWeightedScore(
  analysis: AnalysisResult,
  cv: StructuredCV,
  jd: StructuredJD,
): number {
  const c = computeScoreComponents(analysis, cv, jd);

  const deterministicKeywordScore = analysis.deterministic_scores?.keyword_score;
  const keywordScore = typeof deterministicKeywordScore === 'number'
    ? Math.round(c.keywordScore * 0.45 + deterministicKeywordScore * 0.55)
    : c.keywordScore;

  const weighted =
    c.aiScore * 0.30 +
    keywordScore * 0.30 +
    c.seniorityScore * 0.15 +
    c.sectionScore * 0.10 +
    c.skillsScore * 0.15;

  return Math.round(clamp(weighted, 0, 100));
}

export function computeScoreComponents(
  analysis: AnalysisResult,
  cv: StructuredCV,
  jd: StructuredJD,
): ScoreComponents {
  const aiScore = clamp(
    analysis.overall_job_fit_score ?? 50,
    0,
    100,
  );

  const matched = analysis.matched_keywords?.length ?? 0;
  const missing = analysis.missing_keywords?.length ?? 0;
  const total = matched + missing;

  const keywordScore = total > 0
    ? Math.round((matched / total) * 100)
    : 50;

  const s = cv.locked.has_sections;

  const sectionScore = clamp(
    (s.summary ? 20 : 0) +
      (s.experience ? 30 : 0) +
      (s.education ? 20 : 0) +
      (s.skills ? 20 : 0) +
      (s.projects ? 5 : 0) +
      (s.certifications ? 5 : 0),
    0,
    100,
  );

  const seniorityScore = computeSeniorityScore(
    cv.locked.seniority_level,
    jd.seniority_required,
  );

  const cvAllSkills = [
    ...(cv.locked_skills.technical ?? []),
    ...(cv.locked_skills.tools ?? []),
    ...(cv.locked_skills.soft ?? []),
    ...(cv.locked_skills.languages ?? []),
    ...(cv.locked.experience?.flatMap((e) => e.technologies ?? []) ?? []),
    ...(cv.locked.certifications?.map((c) => c.name) ?? []),
  ]
    .map((skill) => skill.toLowerCase().trim())
    .filter(Boolean);

  const jdRequired = [
    ...(jd.required_skills ?? []),
    ...(jd.must_have_keywords ?? []),
  ]
    .map((skill) => skill.toLowerCase().trim())
    .filter(Boolean);

  const uniqueRequired = Array.from(new Set(jdRequired));

  const skillMatches = uniqueRequired.filter((required) =>
    cvAllSkills.some(
      (candidateSkill) =>
        candidateSkill.includes(required) ||
        required.includes(candidateSkill),
    )
  ).length;

  const skillsScore = uniqueRequired.length > 0
    ? Math.round((skillMatches / uniqueRequired.length) * 100)
    : 50;

  return {
    aiScore,
    keywordScore: typeof analysis.deterministic_scores?.keyword_score === 'number'
      ? Math.round(keywordScore * 0.45 + analysis.deterministic_scores.keyword_score * 0.55)
      : keywordScore,
    sectionScore,
    seniorityScore,
    skillsScore,
  };
}

function computeSeniorityScore(
  cvLevelRaw: string | null | undefined,
  jdLevelRaw: string | null | undefined,
): number {
  const levels = ['junior', 'mid-level', 'senior', 'lead'];

  const cvLevel = normalizeLevel(cvLevelRaw);
  const jdLevel = normalizeLevel(jdLevelRaw);

  const diff = Math.abs(
    levels.indexOf(cvLevel) - levels.indexOf(jdLevel),
  );

  if (diff === 0) return 100;
  if (diff === 1) return 70;
  if (diff === 2) return 40;
  return 20;
}

function normalizeLevel(level: string | null | undefined): string {
  const value = (level ?? 'mid-level').toLowerCase();

  if (value.includes('junior') || value.includes('entry')) return 'junior';
  if (value.includes('senior')) return 'senior';
  if (value.includes('lead') || value.includes('principal')) return 'lead';
  if (value.includes('mid')) return 'mid-level';

  return 'mid-level';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}