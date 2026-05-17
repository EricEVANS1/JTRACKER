export interface SharedOpportunity {
  id: string;
  sender_user_id: string | null;
  recipient_user_id: string | null;
  application_id: string | null;
  public_share_id: string | null;
  role_title: string;
  company_name: string | null;
  location: string | null;
  job_link: string | null;
  note: string | null;
  include_status: boolean;
  include_notes: boolean;
  include_experience: boolean;
  status_snapshot?: string | null;
  notes_snapshot?: string | null;
  created_at: string;
  added_to_applications_at?: string | null;
  added_application_id?: string | null;
  sender_profile?: {
    full_name: string | null;
    email: string | null;
  } | null;
}

export interface ShareableApplicationSnapshot {
  id: string;
  role_title: string;
  application_link: string | null;
  location: string | null;
  status: string;
  notes: string | null;
  companies?: {
    name: string;
  } | null;
}
