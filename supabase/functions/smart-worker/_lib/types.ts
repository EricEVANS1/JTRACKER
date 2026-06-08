// ============================================================
// types.ts — all shared interfaces for smart-worker
// ============================================================

export interface LLMConfig {
  apiKey: string;
  apiUrl: string;
  models: string[];
  timeoutMs: number;
  maxRetries: number;
  retryDelaysMs: number[];
}

export interface LockedExperience {
  title: string;
  company: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
  raw_bullets: string[];
  technologies: string[];
}

export interface LockedEducation {
  degree: string;
  institution: string;
  year: string | null;
}

export interface LockedCertification {
  name: string;
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

export interface SectionFlags {
  summary: boolean;
  experience: boolean;
  education: boolean;
  skills: boolean;
  projects: boolean;
  certifications: boolean;
}

export interface LockedSkills {
  technical: string[];
  tools: string[];
  soft: string[];
  languages: string[];
}

export interface StructuredCV {
  locked: {
    contact: LockedContact;
    experience: LockedExperience[];
    education: LockedEducation[];
    certifications: LockedCertification[];
    total_years_experience: number | null;
    seniority_level: string;
    has_sections: SectionFlags;
  };
  locked_skills: LockedSkills;
  parsed_at: string;
  parse_version: number;
  cv_text_hash?: string;
}

export interface CVSuggestions {
  summary: string;
  experience_bullets: Record<string, string[]>;
  skills_emphasis: string[];
  keyword_suggestions: Array<{
    keyword: string;
    priority?: 'critical' | 'important' | 'nice-to-have';
    reason: string;
    jd_context?: string;
    transferable_from?: string | null;
    confidence?: 'confirmed_missing' | 'possibly_covered' | 'nice_to_add';
    section: 'skills' | 'summary' | 'experience';
    accepted: boolean;
    rejected?: boolean;
  }>;
  generated_for_job_title: string | null;
  generated_for_jd_hash: string | null;
  generated_at: string;
}

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

export interface FieldValidationReport {
  experience_checked: number;
  experience_passed: number;
  experience_corrected: number;
  experience_dropped: number;
  education_checked: number;
  education_passed: number;
  education_corrected: number;
  education_dropped: number;
  certifications_checked: number;
  certifications_passed: number;
  certifications_corrected: number;
  certifications_dropped: number;
  details: string[];
}

export interface DetectedRole {
  raw_header: string;
  title: string;
  company: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
  raw_bullets: string[];
  raw_text: string;
}

export interface DetectedEducation {
  raw_line: string;
  year: string | null;
}

export interface DetectedCertification {
  raw_line: string;
  year: string | null;
}

export interface DeterministicParse {
  contact: LockedContact;
  has_sections: SectionFlags;
  detected_roles: DetectedRole[];
  detected_education: DetectedEducation[];
  detected_certifications: DetectedCertification[];
  skills: LockedSkills;
  total_years_experience: number | null;
  seniority_level: string;
}

export interface LearningContext {
  hasPastData: boolean;
  contextBlock: string;
}

export interface KeywordEvidenceRecord {
  keyword: string;
  normalized_keyword: string;
  priority: 'must_have' | 'required' | 'nice_to_have';
  status: 'matched' | 'partial' | 'missing';
  confidence: number;
  matched_as: string | null;
  evidence: Array<{ source: string; text: string }>;
}

export interface DeterministicScores {
  keyword_score: number;
  must_have_score: number;
  required_skill_score: number;
  nice_to_have_score: number;
  ats_structure_score: number;
  evidence_strength_score: number;
  quantified_achievement_score: number;
}

export interface AnalysisResult {
  recommended_to_apply?: string;
  qualification_verdict?: string;

  overall_job_fit_score?: number;
  transferability_score?: number;
  ats_match_score?: number;
  seniority_match_score?: number;
  skill_gap_score?: number;

  score_breakdown?: Record<string, unknown>;

  matched_keywords?: string[];
  missing_keywords?: string[];
  partial_keywords?: string[];

  strengths?: string[];
  gaps?: string[];
  ai_recommendations?: string[];
  cv_improvement_actions?: string[];

  strongest_transferable_skills?: string[];
  critical_missing_skills?: string[];
  learnable_missing_skills?: string[];
  nice_to_have_missing_skills?: string[];

  role_category?: string;
  deterministic_scores?: DeterministicScores;
  keyword_evidence?: KeywordEvidenceRecord[];
  risk_flags?: string[];
  suggested_focus_areas?: string[];

  is_truncated?: boolean;
}

export interface SectionWeightProfile {
  summary: number;
  experience: number;
  education: number;
  skills: number;
  projects: number;
  certifications: number;
}