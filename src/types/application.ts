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

export interface Application {
  id: string;
  user_id: string;
  company_id: string | null;

  // CV / intelligence links
  cv_version_id: string | null;
  analysis_id?: string | null;

  role_title: string;
  application_link: string | null;
  source: string | null;
  status: ApplicationStatus;
  date_applied: string | null;
  email_used: string | null;
  referral: boolean;
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
  status_updated_at?: string | null;
  interview_possible?: boolean | null;
  rejection_reason?: string | null;
  rejection_category?: string | null;

  archived: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;

  companies?: {
    name: string;
  } | null;

  cv_versions?: {
    name: string;
    target_role: string | null;
    file_url?: string | null;
  } | null;

  recruiters?: {
    id: string;
    name: string;
    email: string | null;
  } | null;
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

  // New fields for Application Intelligence
  job_description: string;
  analysis_id: string;
  match_score: string;
  fit_label: string;
  role_category: string;
  cv_score_at_apply: string;
  status_updated_at: string;
  interview_possible: boolean;
  rejection_reason: string;
  rejection_category: string;
}
