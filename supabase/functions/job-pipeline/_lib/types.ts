export interface UserJobPreferences {
  id?: string;
  user_id: string;
  default_cv_version_id: string | null;
  target_titles: string[];
  preferred_locations: string[];
  work_model: 'any' | 'remote' | 'hybrid' | 'onsite';
  min_match_score: number;
  excluded_keywords: string[];
  career_goal: string | null;
  enabled_sources: string[];
  max_job_age_days: number;
  automation_enabled: boolean;
}

export interface CVProfile {
  cv_version_id: string | null;
  cv_text: string | null;
  structured_cv: Record<string, unknown> | null;
  profile_summary?: string | null;
}

export interface RawJob {
  source: 'google_jobs' | 'indeed';
  external_id: string;
  title: string;
  company: string;
  location: string | null;
  job_url: string;
  description: string | null;
  salary_range: string | null;
  employment_type: string | null;
  work_model: 'remote' | 'hybrid' | 'onsite' | 'any';
  source_posted_at: string | null;
  raw_data: Record<string, unknown>;
}

export interface JobAd {
  id: string;
  user_id: string;
  title: string;
  company: string | null;
  location: string | null;
  work_model: string | null;
  salary_range: string | null;
  job_url: string;
  source: string | null;
  source_slug: string | null;
  source_id: string | null;
  source_posted_at: string | null;
  dedup_hash: string | null;
  description: string | null;
  employment_type: string | null;
  raw_data: Record<string, unknown> | null;
  best_match_score: number | null;
  best_fit_label: string | null;
  recommendation: string | null;
}

export interface LLMConfig {
  apiKey: string;
  apiUrl: string;
  model: string;
  timeoutMs: number;
}

export interface ScoreResult {
  match_score: number;
  fit_label: string;
  recommendation: 'recommended' | 'possible' | 'stretch' | 'not_recommended';
  skill_score: number;
  title_score: number;
  location_score: number;
  seniority_score: number;
  salary_score: number;
  matched_skills: string[];
  missing_skills: string[];
  concerns: string[];
  suggested_cv_angle: string;
  explanation: string;
  raw_result: Record<string, unknown>;
  ai_used: boolean;
}