// src/types/resumeBuilder.ts
// Shared Resume Builder types used by ResumeBuilderPage and resumeTailoring.
// Keep all Resume Builder data-shape definitions here to avoid duplicate
// ResumeBuilderState declarations across the app.

export type TemplateId = 'single' | 'two_column' | 'modern' | 'clean' | 'classic_ats';

export type PageSize = 'a4' | 'letter';

export type FontFamily = 'serif' | 'sans' | 'mono';

export type CustomSectionType = 'text' | 'items' | 'skills';

export type FormattingSettings = {
  template: TemplateId;
  pageSize: PageSize;
  margins: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
  spacing: {
    section: number;
    item: number;
    line: number;
  };
  fontSize: {
    base: number;
    headers: number;
  };
  fonts: {
    header: FontFamily;
    body: FontFamily;
  };
  compactMode: boolean;
};

export type PersonalInfo = {
  fullName: string;
  jobTitle: string;
  email: string;
  phone: string;
  location: string;
  website: string;
  linkedin: string;
  github: string;
};

export type ExperienceItem = {
  id: string;
  jobTitle: string;
  company: string;
  location: string;
  years: string;
  bullets: string[];
};

export type EducationItem = {
  id: string;
  institution: string;
  degree: string;
  years: string;
  description: string;
};

export type ProjectItem = {
  id: string;
  name: string;
  role: string;
  years: string;
  link: string;
  bullets: string[];
};

export type SkillsAwards = {
  technicalSkills: string;
  languages: string;
  trainingCertifications: string;
  awards: string;
};

export type CustomSection = {
  id: string;
  title: string;
  type: CustomSectionType;
  content: string;
  items: string[];
  visible: boolean;
  collapsed: boolean;
};

export type SectionVisibility = {
  personal: boolean;
  summary: boolean;
  experience: boolean;
  education: boolean;
  projects: boolean;
  skillsAwards: boolean;
};

export type ResumeBuilderState = {
  personal: PersonalInfo;
  summary: string;
  experience: ExperienceItem[];
  education: EducationItem[];
  projects: ProjectItem[];
  skillsAwards: SkillsAwards;
  customSections: CustomSection[];
  sectionVisibility: SectionVisibility;
};

export type AnalysisRecord = {
  id: string;
  user_id: string;
  cv_version_id: string;
  job_title: string | null;
  company_name: string | null;
  generated_cv: string | null;
  score: number | null;
  matched_keywords?: string[] | null;
  partial_keywords?: string[] | null;
  missing_keywords?: string[] | null;
  ats_keyword_evidence?: any[] | null;
  extended_data?: any;
  job_description?: string | null;
};

export type CvVersionRecord = {
  id: string;
  name?: string | null;
  target_role?: string | null;
  cv_text: string | null;
  structured_cv: any | null;
  cv_suggestions?: any | null;
  last_score?: number | null;
  last_analyzed_at?: string | null;
  source_analysis_id?: string | null;
  parent_cv_version_id?: string | null;
};
