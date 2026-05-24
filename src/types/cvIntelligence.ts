// ============================================================
// JTracker CV Intelligence Engine — TypeScript Types
// Updated for full career intelligence schema
// ============================================================

// ------------------------------------------------------------
// Score breakdown across 5 dimensions
// ------------------------------------------------------------
export interface ScoreBreakdown {
  skills: number;
  experience: number;
  keywords: number;
  achievements: number;
  ats: number;
}

// ------------------------------------------------------------
// Feedback item (strength or gap)
// ------------------------------------------------------------
export interface FeedbackItem {
  title: string;
  detail: string;
}

// ------------------------------------------------------------
// Transferable skill with reasoning
// ------------------------------------------------------------
export interface TransferableSkill {
  skill: string;
  reason: string;
}

// ------------------------------------------------------------
// Recommendation values
// ------------------------------------------------------------
export type RecommendedToApply = 'YES' | 'YES — Tailor CV First' | 'MAYBE' | 'NO';
export type QualificationVerdict = 'Qualified' | 'Borderline Qualified' | 'Not Qualified';

// ------------------------------------------------------------
// Full analysis result — returned by Edge Function
// ------------------------------------------------------------
export interface CVAnalysis {
  // DB fields
  id: string;
  user_id: string;
  cv_version_id: string;
  created_at: string;

  // Job info
  job_title: string | null;
  company_name: string | null;
  job_description: string;

  // Career intelligence decision
  recommended_to_apply: RecommendedToApply;
  qualification_verdict: QualificationVerdict;

  // Scores
  score: number;                    // primary score (overall_job_fit_score)
  overall_job_fit_score: number;
  transferability_score: number;
  ats_match_score: number;
  seniority_match_score: number;
  skill_gap_score: number;
  score_breakdown: ScoreBreakdown;

  // Transferable skills
  strongest_transferable_skills: TransferableSkill[];

  // Skill gap classification
  critical_missing_skills: string[];
  learnable_missing_skills: string[];
  nice_to_have_missing_skills: string[];

  // Keywords
  matched_keywords: string[];
  missing_keywords: string[];
  partial_keywords: string[];

  // Qualitative feedback
  strengths: FeedbackItem[];
  gaps: FeedbackItem[];

  // Recommendations
  ai_recommendations: string[];
  cv_improvement_actions: string[];

  // Generated CV
  generated_cv: string | null;

  // Learning engine
  role_category: string | null;
}

// ------------------------------------------------------------
// What the Edge Function returns
// ------------------------------------------------------------
export interface AnalyzeResponse {
  analysis: CVAnalysis;
  learning_context_used: boolean;
  patterns_updated: boolean;
  error?: string;
}

// ------------------------------------------------------------
// Analyzer UI state
// ------------------------------------------------------------
export type AnalyzerStep = 'idle' | 'extracting' | 'analyzing' | 'done' | 'error';

export interface AnalyzerState {
  step: AnalyzerStep;
  error: string | null;
  analysis: CVAnalysis | null;
  learningContextUsed: boolean;
}

// ------------------------------------------------------------
// CV version with intelligence fields
// ------------------------------------------------------------
export interface CVVersionWithIntelligence {
  id: string;
  name: string;
  target_role: string | null;
  notes: string | null;
  file_url: string | null;
  cv_text: string | null;
  cv_text_extracted_at: string | null;
  last_score: number | null;
  last_analyzed_at: string | null;
  created_at: string;
}

// ------------------------------------------------------------
// Scoring pattern (learning engine memory)
// ------------------------------------------------------------
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

// ------------------------------------------------------------
// Helper functions
// ------------------------------------------------------------
export function getRecommendationColor(rec: RecommendedToApply): string {
  switch (rec) {
    case 'YES':                  return 'text-emerald-700 bg-emerald-50 border-emerald-200';
    case 'YES — Tailor CV First': return 'text-blue-700 bg-blue-50 border-blue-200';
    case 'MAYBE':                return 'text-amber-700 bg-amber-50 border-amber-200';
    case 'NO':                   return 'text-red-700 bg-red-50 border-red-200';
    default:                     return 'text-slate-700 bg-slate-50 border-slate-200';
  }
}

export function getVerdictColor(verdict: QualificationVerdict): string {
  switch (verdict) {
    case 'Qualified':            return 'text-emerald-700';
    case 'Borderline Qualified': return 'text-amber-700';
    case 'Not Qualified':        return 'text-red-700';
    default:                     return 'text-slate-700';
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