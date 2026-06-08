// ============================================================
// JTracker CV Intelligence Engine — TypeScript Types
// v5 — Fact-Lock Architecture
//
// structured_cv = locked facts (never AI-modified)
// cv_suggestions = AI editable layer (user must approve)
// generated_cv   = safely assembled output
// ============================================================

// ============================================================
// LOCKED FACTS — parsed from CV, immutable
// These are the source of truth. AI cannot change these.
// ============================================================

export interface LockedExperience {
  title: string;           // e.g. "Technical Support Specialist"
  company: string;         // e.g. "Teleperformance"
  start_date: string;      // e.g. "Sep 2024"
  end_date: string;        // e.g. "Mar 2026" or "Present"
  is_current: boolean;
  raw_bullets: string[];   // Original bullet points verbatim from CV
  technologies: string[];  // Technologies mentioned in this role
}

export interface LockedEducation {
  degree: string;          // e.g. "BSc Computer Science"
  institution: string;     // e.g. "University of Warsaw"
  year: string | null;     // e.g. "2022"
}

export interface LockedCertification {
  name: string;            // e.g. "AWS Solutions Architect"
  issuer: string | null;
  year: string | null;
}

export interface LockedContact {
  name: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  linkedin: string | null;
  portfolio: string | null;
}

// Top-level locked facts store — stored in cv_versions.structured_cv
export interface StructuredCV {
  locked: {
    contact: LockedContact;
    experience: LockedExperience[];
    education: LockedEducation[];
    certifications: LockedCertification[];
    // Metadata derived from facts — not editable but not user-facing
    total_years_experience: number | null;
    seniority_level: 'junior' | 'mid-level' | 'senior' | 'lead';
    has_sections: {
      summary: boolean;
      experience: boolean;
      education: boolean;
      skills: boolean;
      projects: boolean;
      certifications: boolean;
    };
  };
  // Raw skills extracted from CV — locked (AI cannot remove these)
  // but AI can ADD suggestions on top via cv_suggestions
  locked_skills: {
    technical: string[];
    tools: string[];
    soft: string[];
    languages: string[];   // spoken languages e.g. "English", "Polish"
  };
  // Parsing metadata
  parsed_at: string;       // ISO timestamp
  parse_version: number;   // increment when parse logic changes
}

// ============================================================
// AI SUGGESTIONS — editable layer, stored in cv_versions.cv_suggestions
// AI fills these. User approves/rejects. Never treated as facts.
// ============================================================

export interface ExperienceBullets {
  // Key = `${company}__${title}` normalised (lowercase, underscores)
  // Value = AI-improved bullet points for that role
  [companyRoleKey: string]: string[];
}

export interface KeywordSuggestion {
  keyword: string;
  reason: string;          // e.g. "Appears in JD but not in your CV"
  section: 'skills' | 'summary' | 'experience';
  accepted: boolean;       // user must set to true to include in output
}

// Top-level suggestions store — stored in cv_versions.cv_suggestions
export interface CVSuggestions {
  // AI-rewritten professional summary
  // User can edit this text before it goes into the final CV
  summary: string;

  // Per-role improved bullet points
  // AI cannot change title/company/dates — only bullet content
  experience_bullets: ExperienceBullets;

  // Skills to highlight/emphasise (reordered from locked_skills)
  // AI cannot add skills not in locked_skills or keyword_suggestions
  skills_emphasis: string[];

  // Keywords user must manually accept before they appear in CV
  keyword_suggestions: KeywordSuggestion[];

  // Which JD this suggestion set was generated for
  generated_for_job_title: string | null;
  generated_for_jd_hash: string | null;  // hash of JD text to detect stale suggestions
  generated_at: string;   // ISO timestamp
}

// ============================================================
// STRUCTURED JD — parsed JD requirements (not stored, used per-analysis)
// ============================================================
export interface StructuredJD {
  job_title: string;
  company_name: string | null;
  role_category: string;
  seniority_required: string;
  must_have_keywords: string[];
  required_skills: string[];
  nice_to_have_skills: string[];
  key_responsibilities: string[];
  required_experience_years: number | null;
  education_requirements: string[];
  domain: string;
}

// ============================================================
// ASSEMBLED CV — what the Edge Function returns as generated_cv
// Built by the assembler from locked facts + accepted suggestions
// ============================================================
export interface AssembledCV {
  // The final plain-text CV string — stored in cv_analyses.generated_cv
  text: string;

  // Audit trail — what the assembler used
  used_ai_summary: boolean;
  used_ai_bullets: string[];      // which company_role_keys used AI bullets
  accepted_keywords: string[];    // which keyword suggestions were injected
  locked_facts_count: number;     // number of locked fields used
}

// ============================================================
// SCORE BREAKDOWN
// ============================================================
export interface ScoreBreakdown {
  skills: number;
  experience: number;
  keywords: number;
  achievements: number;
  ats: number;
}

export interface FeedbackItem {
  title: string;
  detail: string;
}

export interface TransferableSkill {
  skill: string;
  reason: string;
}

export type RecommendedToApply = 'YES' | 'YES — Tailor CV First' | 'MAYBE' | 'NO';
export type QualificationVerdict = 'Qualified' | 'Borderline Qualified' | 'Not Qualified';

// ============================================================
// FULL ANALYSIS — returned by Edge Function + stored in cv_analyses
// ============================================================
// ============================================================
// FULL ANALYSIS — returned by Edge Function + stored in cv_analyses
// ============================================================
export interface CVAnalysis {
  // DB identity
  id: string;
  user_id: string;
  cv_version_id: string;
  created_at: string;

  // Job info (from structured JD parse — never from AI hallucination)
  job_title: string | null;
  company_name: string | null;
  job_description: string;

  // Career intelligence decision
  recommended_to_apply: RecommendedToApply;
  qualification_verdict: QualificationVerdict;

  // Scores
  score: number;
  overall_job_fit_score: number;
  transferability_score: number;
  ats_match_score: number;
  seniority_match_score: number;
  skill_gap_score: number;
  score_breakdown: ScoreBreakdown;

  // Transferable skills
  strongest_transferable_skills: TransferableSkill[];

  // Skill gaps — classified
  critical_missing_skills: string[];
  learnable_missing_skills: string[];
  nice_to_have_missing_skills: string[];

  // Keywords
  matched_keywords: string[];
  missing_keywords: string[];
  partial_keywords: string[];

  // Deterministic ATS evidence layer
  ats_evidence?: {
    total_requirements: number;
    matched_count: number;
    partial_count: number;
    missing_count: number;
    deterministic_score: number;
    coverage_ratio: number;
    critical_missing_count: number;
  };

  ats_keyword_evidence?: Array<{
    keyword: string;
    canonical: string;
    status: 'matched' | 'partial' | 'missing';
    priority: 'required' | 'nice_to_have' | 'inferred';
    evidence: string[];
    reason: string;
  }>;

  ats_strengths?: string[];
  ats_risks?: string[];

  // Qualitative feedback
  strengths: FeedbackItem[];
  gaps: FeedbackItem[];

  // Recommendations
  ai_recommendations: string[];
  cv_improvement_actions: string[];

  // Generated CV — safely assembled from locked facts + suggestions
  generated_cv: string | null;

  // Structured data returned to client for Resume Builder
  structured_cv: StructuredCV | null;
  cv_suggestions: CVSuggestions | null;

  // Flags
  is_truncated: boolean;
  save_warning: string | null;
  role_category: string | null;
}
// ============================================================
// EDGE FUNCTION RESPONSE
// ============================================================
export interface AnalyzeResponse {
  analysis: CVAnalysis;
  learning_context_used: boolean;
  patterns_updated: boolean;
  error?: string;
}

// ============================================================
// ANALYSER UI STATE
// ============================================================
export type AnalyzerStep =
  | 'idle'
  | 'starting'
  | 'auth'
  | 'loading_cv'
  | 'extracting_cv'
  | 'parsing_cv'
  | 'parsing_jd'
  | 'learning_context'
  | 'analysis'
  | 'cv_generation'
  | 'saving'
  | 'complete'
  | 'error';

export interface AnalyzerState {
  step: 'idle' | 'analyzing' | 'done' | 'error';
  error: string | null;
  analysis: CVAnalysis | null;
  learningContextUsed: boolean;
  progressMessage: string;
  progressPercent: number;
}

// ============================================================
// CV VERSION WITH INTELLIGENCE FIELDS
// ============================================================
export interface CVVersionWithIntelligence {
  id: string;
  name: string;
  target_role: string | null;
  notes: string | null;
  file_url: string | null;
  cv_text: string | null;
  cv_text_extracted_at: string | null;
  structured_cv: StructuredCV | null;      // locked facts
  cv_suggestions: CVSuggestions | null;    // AI suggestions
  last_score: number | null;
  last_analyzed_at: string | null;
  created_at: string;
}

// ============================================================
// SCORING PATTERN (learning engine)
// ============================================================
export interface CVScoringPattern {
  id: string;
  user_id: string;
  role_category: string;
  score_band: string;
  pattern_summary: string;
  keyword_signals: string[];
  sample_count: number;
  source_analysis_id: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================
// ASSEMBLER INPUT — what the assembler function receives
// ============================================================
export interface AssemblerInput {
  lockedFacts: StructuredCV;
  suggestions: CVSuggestions;
  acceptedKeywords: string[];   // keyword_suggestions where accepted=true
  useAiSummary: boolean;
  useAiBullets: boolean;
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

export function getRecommendationColor(rec: RecommendedToApply): string {
  switch (rec) {
    case 'YES':                   return 'text-emerald-700 bg-emerald-50 border-emerald-200';
    case 'YES — Tailor CV First': return 'text-blue-700 bg-blue-50 border-blue-200';
    case 'MAYBE':                 return 'text-amber-700 bg-amber-50 border-amber-200';
    case 'NO':                    return 'text-red-700 bg-red-50 border-red-200';
    default:                      return 'text-slate-700 bg-slate-50 border-slate-200';
  }
}

export function getVerdictColor(verdict: QualificationVerdict): string {
  switch (verdict) {
    case 'Qualified':             return 'text-emerald-700';
    case 'Borderline Qualified':  return 'text-amber-700';
    case 'Not Qualified':         return 'text-red-700';
    default:                      return 'text-slate-700';
  }
}

export function getScoreColor(score: number): string {
  if (score >= 75) return 'text-emerald-600';
  if (score >= 60) return 'text-blue-600';
  if (score >= 45) return 'text-amber-600';
  return 'text-red-600';
}

export function getScoreBgColor(score: number): string {
  if (score >= 75) return 'bg-emerald-50 border-emerald-200';
  if (score >= 60) return 'bg-blue-50 border-blue-200';
  if (score >= 45) return 'bg-amber-50 border-amber-200';
  return 'bg-red-50 border-red-200';
}

export function getScoreBand(score: number): string {
  if (score >= 90) return '90-100';
  if (score >= 80) return '80-89';
  if (score >= 70) return '70-79';
  if (score >= 60) return '60-69';
  if (score >= 50) return '50-59';
  return '0-49';
}

// Generates a stable key for a role in ExperienceBullets
export function makeRoleKey(company: string, title: string): string {
  return `${company}__${title}`
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_');
}

// Simple hash of a string — used to detect stale suggestions
export function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}