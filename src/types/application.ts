export type ApplicationStatus =
  | 'wishlist'
  | 'applied'
  | 'confirmation_received'
  | 'assessment'
  | 'interview'
  | 'final_interview'
  | 'offer'
  | 'rejected'
  | 'withdrawn'
  | 'ghosted'
  | 'archived';

export type ApplicationOutcomeReason =
  | 'rejected_before_interview'
  | 'rejected_after_assessment'
  | 'rejected_after_interview'
  | 'offer_received'
  | 'offer_declined'
  | 'offer_accepted'
  | 'withdrawn'
  | 'ghosted'
  | 'no_response'
  | null;

export interface ApplicationCompany {
  id?: string;
  name: string;
  website?: string | null;
  industry?: string | null;
  location?: string | null;
}

export interface ApplicationCVVersion {
  id?: string;
  name: string;
  target_role: string | null;
  file_url?: string | null;
}

export interface ApplicationRecruiter {
  id: string;
  name: string;
  email: string | null;
}

export interface Application {
  id: string;
  user_id: string;

  // Relational links
  company_id: string | null;
  cv_version_id: string | null;
  recruiter_id?: string | null;
  analysis_id?: string | null;
  job_ad_id?: string | null;

  // Core application information
  role_title: string;
  application_link: string | null;
  source: string | null;
  status: ApplicationStatus;
  date_applied: string | null;
  email_used: string | null;
  referral: boolean | null;
  location: string | null;
  job_type: string | null;
  salary_range: string | null;
  notes: string | null;

  // Job description / CV intelligence
  job_description?: string | null;
  match_score?: number | null;
  fit_label?: string | null;
  role_category?: string | null;
  cv_score_at_apply?: number | null;
  cv_version_used?: string | null;
  interview_possible?: boolean | null;
  rejection_reason?: string | null;
  rejection_category?: string | null;

  // Lifecycle tracking
  response_received_at?: string | null;
  assessment_received_at?: string | null;
  interview_started_at?: string | null;
  final_interview_started_at?: string | null;
  offer_received_at?: string | null;
  rejected_at?: string | null;
  withdrawn_at?: string | null;
  ghosted_at?: string | null;
  last_status_changed_at?: string | null;
  status_updated_at?: string | null;

  // Interview journey / outcome tracking
  reached_interview?: boolean | null;
  rejected_after_interview?: boolean | null;
  final_response_pending?: boolean | null;
  interview_count?: number | null;
  outcome_reason?: ApplicationOutcomeReason | string | null;

  // Archive tracking
  archived: boolean | null;
  archived_at: string | null;

  // Timestamps
  created_at: string;
  updated_at: string | null;

  // Joined data from Supabase
  companies?: ApplicationCompany | null;
  cv_versions?: ApplicationCVVersion | null;
  recruiters?: ApplicationRecruiter | null;
}

export interface ApplicationFormData {
  company_name: string;
  role_title: string;
  application_link: string;
  source: string;
  status: ApplicationStatus;
  date_applied: string;
  email_used: string;
  referral: boolean;
  location: string;
  job_type: string;
  salary_range: string;
  notes: string;
  cv_version_id: string;
  recruiter_id: string;

  // Application Intelligence
  job_description: string;
  analysis_id: string;
  match_score: string;
  fit_label: string;
  role_category: string;
  cv_score_at_apply: string;
  cv_version_used: string;
  interview_possible: boolean;
  rejection_reason: string;
  rejection_category: string;

  // Lifecycle tracking
  response_received_at: string;
  assessment_received_at: string;
  interview_started_at: string;
  final_interview_started_at: string;
  offer_received_at: string;
  rejected_at: string;
  withdrawn_at: string;
  ghosted_at: string;
  last_status_changed_at: string;
  status_updated_at: string;

  // Interview journey / outcome tracking
  reached_interview: boolean;
  rejected_after_interview: boolean;
  final_response_pending: boolean;
  interview_count: string;
  outcome_reason: string;
}