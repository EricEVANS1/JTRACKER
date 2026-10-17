// src/pages/ResumeBuilderPage.tsx
// Resume Builder — integrated into JTracker design system.
// Matches AppLayout's bg-slate-50, sidebar nav, slate-900 accents.
// PDF and DOCX export load jspdf, docx and file-saver (dependencies) on demand.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  EyeOff,
  FileText,
  GripVertical,
  Loader2,
  Plus,
  RefreshCcw,
  Save,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { optimizeResumeForJob, type TailoringChange, type CVQualityReport, type ClaimableGap } from '../lib/resumeTailoring';
import {
  clearDraft,
  draftDiffersFrom,
  getDraftKey,
  readDraft,
  serializeEditorState,
  writeDraft,
  type ResumeDraft,
} from '../lib/resumeDraft';
import type {
  AnalysisRecord,
  CvVersionRecord,
  CustomSection,
  CustomSectionType,
  EducationItem,
  ExperienceItem,
  FormattingSettings,
  FontFamily,
  PersonalInfo,
  ProjectItem,
  ResumeBuilderState,
  SectionVisibility,
  SkillsAwards,
  TemplateId,
} from '../types/resumeBuilder';



// ---- PDF / DOCX — loaded on first export to keep the page bundle small ----
// A failed load (network, or a deploy while the page is open) isn't cached,
// so trying the export again retries it.

// Shown to the user when an export tool can't be loaded.
class ExportToolError extends Error {}

const EXPORT_TOOL_MESSAGE = (kind: string) =>
  `The ${kind} export tool couldn't be loaded. Check your connection and try again; reload the page if it keeps happening.`;
let jsPDF: any = null;
let docxLib: any = null;
let fileSaverLib: any = null;

const loadPdfLib = async () => {
  if (!jsPDF) {
    try { const m = await import('jspdf'); jsPDF = m.jsPDF; } catch { jsPDF = null; }
  }
  return jsPDF;
};
const loadDocxLib = async () => {
  if (!docxLib) {
    try { docxLib = await import('docx'); } catch { docxLib = null; }
  }
  return docxLib;
};
const loadFileSaver = async () => {
  if (!fileSaverLib) {
    try { fileSaverLib = await import('file-saver'); } catch { fileSaverLib = null; }
  }
  return fileSaverLib;
};

// ============================================================
// TYPES
// ============================================================

// ============================================================
// CONSTANTS
// ============================================================
const uid = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const defaultFormatting: FormattingSettings = {
  template: 'single', pageSize: 'a4',
  margins: { top: 12, bottom: 12, left: 14, right: 14 },
  spacing: { section: 3, item: 2, line: 3 },
  fontSize: { base: 3, headers: 3 },
  fonts: { header: 'sans', body: 'sans' },
  compactMode: false,
};

const emptyResume: ResumeBuilderState = {
  personal: { fullName: '', jobTitle: '', email: '', phone: '', location: '', website: '', linkedin: '', github: '' },
  summary: '', experience: [], education: [], projects: [],
  skillsAwards: { technicalSkills: '', languages: '', trainingCertifications: '', awards: '' },
  customSections: [],
  sectionVisibility: { personal: true, summary: true, experience: true, education: true, projects: true, skillsAwards: true },
};


type ProfileDefaults = Partial<PersonalInfo>;

type ResumeBuilderImportPayload = {
  source?: string;
  analysisId?: string | null;
  cvVersionId?: string | null;
  jobTitle?: string;
  companyName?: string;
  roleCategory?: string;
  score?: number | null;
  generatedCv?: string;
  matchedKeywords?: string[];
  missingKeywords?: string[];
  recommendations?: string[];
  cvName?: string;
  selectedCvName?: string;
  selectedApplicationId?: string | null;
  jobDescription?: string;
  importedAt?: string;
};

type BulletReviewItem = {
  id: string;
  accepted: boolean;
  roleId?: string;
  roleTitle?: string;
  company?: string;
  bulletIndex?: number;
  before: string;
  after: string;
  reason: string;
  changeType: TailoringChange['type'];
  // Safety metadata passed through from TailoringChange
  riskLevel?: TailoringChange['riskLevel'];
  evidenceSource?: string;
  jdSignal?: string;
  jdSignalStrength?: 'explicit' | 'inferred';
};

type SkillReviewItem = {
  id: string;
  type: TailoringChange['type'];
  label: string;
  before?: string;
  after?: string;
  reason: string;
  riskLevel?: TailoringChange['riskLevel'];
  requiresReview?: boolean;
};



const wordSimilarity = (a: string, b: string): number => {
  const wordsA = new Set(a.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean));

  if (!wordsA.size || !wordsB.size) return 0;

  const intersection = [...wordsA].filter((word) => wordsB.has(word)).length;
  const union = new Set([...wordsA, ...wordsB]).size;

  return intersection / union;
};


const isReviewableBulletChange = (
  change: TailoringChange,
): change is TailoringChange & { before: string; after: string } => {
  return (
    (change.type === 'bullet_optimized' ||
      change.type === 'bullet_rewritten') &&
    change.riskLevel !== 'not_recommended' &&
    change.section === 'experience' &&
    Boolean(change.before?.trim()) &&
    Boolean(change.after?.trim()) &&
    change.before?.trim() !== change.after?.trim() &&
    wordSimilarity(change.before ?? '', change.after ?? '') < 0.82
  );
};


const extractKeywordFromMissingMessage = (message: string): string => {
  const quoted = message.match(/"([^"]+)"/)?.[1];
  if (quoted) return quoted;

  return message
    .replace(/^JD keyword\s*/i, '')
    .replace(/\s*does not appear.*$/i, '')
    .trim();
};

const simplifyIssueMessage = (issue: CVQualityReport['issues'][number]): string => {
  if (issue.category === 'unsupported_claim') {
    const quoted = issue.message.match(/"([^"]+)"/)?.[1];
    const afterColon = issue.message.match(/:\s*([^".]+)\.?$/)?.[1];
    return `Remove unsupported skill${quoted || afterColon ? `: ${quoted || afterColon}` : ''}`;
  }

  if (issue.category === 'wrong_tense') {
    return issue.location ? `Fix tense in ${issue.location}` : 'Fix tense in a past role bullet';
  }

  if (issue.category === 'broken_bullet') {
    return issue.location ? `Fix broken sentence in ${issue.location}` : 'Fix a broken bullet sentence';
  }

  if (issue.category === 'repeated_phrase' || issue.category === 'overused_jd_phrase') {
    return 'Reduce repeated wording';
  }

  return issue.message;
};

const CVReadinessCard: React.FC<{
  report: CVQualityReport;
  skillReviewItems: SkillReviewItem[];
  claimableGaps: ClaimableGap[];
  onDismiss: () => void;
}> = ({ report, skillReviewItems, claimableGaps, onDismiss }) => {
  const blockers = report.issues.filter((issue) =>
    issue.category === 'unsupported_claim' ||
    issue.category === 'wrong_tense' ||
    issue.category === 'broken_bullet'
  );

  const missingKeywords = report.issues
    .filter((issue) => issue.category === 'missing_jd_keyword')
    .map((issue) => extractKeywordFromMissingMessage(issue.message))
    .filter(Boolean);

  const optionalKeywords = claimableGaps
    .map((gap) => gap.keyword)
    .filter(Boolean)
    .filter((keyword, index, arr) =>
      arr.findIndex((item) => item.toLowerCase() === keyword.toLowerCase()) === index,
    );

  const reviewSkills = skillReviewItems
    .filter((item) => item.requiresReview)
    .filter((item, index, arr) =>
      arr.findIndex((other) => other.label.toLowerCase() === item.label.toLowerCase()) === index,
    );

  const tone = report.passed ? 'emerald' : blockers.length ? 'red' : 'amber';
  const status = report.passed ? 'Ready to send' : blockers.length ? 'Fix before sending' : 'Needs review';

  const scoreClass =
    tone === 'emerald'
      ? 'text-emerald-600'
      : tone === 'red'
        ? 'text-red-600'
        : 'text-amber-600';

  const barClass =
    tone === 'emerald'
      ? 'bg-emerald-500'
      : tone === 'red'
        ? 'bg-red-500'
        : 'bg-amber-500';

  return (
    <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            CV Readiness
          </p>
          <h3 className="mt-1 text-lg font-bold text-slate-900">{status}</h3>
          <p className="mt-1 text-sm text-slate-500">
            JTracker improved the CV for this job and kept risky claims out of the final version.
          </p>
        </div>

        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-center">
            <div className={`text-2xl font-bold ${scoreClass}`}>{report.score}</div>
            <div className="text-xs font-medium text-slate-500">/100</div>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Dismiss CV readiness"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="mt-4 h-2 rounded-full bg-slate-100">
        <div
          className={`h-2 rounded-full ${barClass}`}
          style={{ width: `${Math.max(0, Math.min(report.score, 100))}%` }}
        />
      </div>

      {blockers.length > 0 && (
        <div className="mt-5 rounded-xl border border-red-100 bg-red-50 p-4">
          <h4 className="text-sm font-semibold text-red-800">Fix before sending</h4>
          <ul className="mt-2 space-y-1 text-sm text-red-700">
            {blockers.slice(0, 4).map((issue, index) => (
              <li key={`${issue.category}-${index}`}>• {simplifyIssueMessage(issue)}</li>
            ))}
          </ul>
        </div>
      )}

      {reviewSkills.length > 0 && (
        <div className="mt-4 rounded-xl border border-amber-100 bg-amber-50 p-4">
          <h4 className="text-sm font-semibold text-amber-800">Review optional skills</h4>
          <p className="mt-1 text-xs text-amber-700">
            Add these only if they are true to your experience.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {reviewSkills.slice(0, 8).map((item) => (
              <span
                key={item.id}
                className="rounded-full bg-white px-3 py-1 text-xs font-medium text-amber-700 ring-1 ring-amber-200"
              >
                {item.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {(optionalKeywords.length > 0 || missingKeywords.length > 0) && (
        <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-4">
          <h4 className="text-sm font-semibold text-slate-800">Missing or optional JD keywords</h4>
          <p className="mt-1 text-xs text-slate-500">
            These can help screening, but only add them if they are accurate.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {[...optionalKeywords, ...missingKeywords]
              .filter((keyword, index, arr) =>
                arr.findIndex((item) => item.toLowerCase() === keyword.toLowerCase()) === index,
              )
              .slice(0, 12)
              .map((keyword) => (
                <span
                  key={keyword}
                  className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200"
                >
                  {keyword}
                </span>
              ))}
          </div>
        </div>
      )}

      {blockers.length === 0 && reviewSkills.length === 0 && optionalKeywords.length === 0 && (
        <div className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-700">
          Looks good. You can review the CV and export it.
        </div>
      )}
    </div>
  );
};


const mergeProfileDefaultsIntoPersonal = (
  personal: PersonalInfo,
  profileDefaults: ProfileDefaults,
  forceLinks = false,
): PersonalInfo => {
  const website = forceLinks
    ? cleanWebsiteValue(profileDefaults.website || personal.website || '')
    : cleanWebsiteValue(personal.website || profileDefaults.website || '');

  return {
    ...personal,
    fullName: personal.fullName || profileDefaults.fullName || '',
    jobTitle: cleanJobTitleValue(personal.jobTitle || profileDefaults.jobTitle || ''),
    email: personal.email || profileDefaults.email || '',
    phone: personal.phone || profileDefaults.phone || '',
    location: personal.location || profileDefaults.location || '',
    website,
    linkedin: forceLinks
      ? profileDefaults.linkedin || personal.linkedin || ''
      : personal.linkedin || profileDefaults.linkedin || '',
    github: forceLinks
      ? profileDefaults.github || personal.github || ''
      : personal.github || profileDefaults.github || '',
  };
};

type SavedBuilderVersion = {
  id: string;
  name: string;
  sourceAnalysisId: string | null;
  sourceCvVersionId: string | null;
  companyName: string | null;
};

type BuilderDraft = ResumeDraft<ResumeBuilderState, FormattingSettings, SavedBuilderVersion>;

const LEAVE_MESSAGE =
  'You have unsaved changes to this CV. They are kept as a draft in this browser tab, but are not saved to CV Manager. Leave anyway?';

const formatDraftTime = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const readBuilderState = (cvVersion?: CvVersionRecord | null): ResumeBuilderState | null => {
  const structured = cvVersion?.structured_cv;
  const suggestions = cvVersion?.cv_suggestions;

  const state =
    structured?.builder_state ??
    structured?.resume_builder?.builder_state ??
    suggestions?.builder_state ??
    suggestions?.resume_builder?.builder_state ??
    null;

  if (!state?.personal || !Array.isArray(state?.experience)) return null;
  return state as ResumeBuilderState;
};

const readBuilderFormatting = (cvVersion?: CvVersionRecord | null): FormattingSettings => {
  const structured = cvVersion?.structured_cv;
  const suggestions = cvVersion?.cv_suggestions;

  return (
    structured?.formatting ??
    structured?.resume_builder?.formatting ??
    suggestions?.formatting ??
    suggestions?.resume_builder?.formatting ??
    defaultFormatting
  ) as FormattingSettings;
};

const templateOptions: Array<{ id: TemplateId; label: string; description: string }> = [
  { id: 'classic_ats', label: 'Classic ATS', description: 'Recommended job-application CV' },
  { id: 'single', label: 'Single Column', description: 'ATS-safe traditional layout' },
  { id: 'two_column', label: 'Two Column', description: 'Side column layout' },
  { id: 'modern', label: 'Modern', description: 'Clean modern layout' },
  { id: 'clean', label: 'Minimal', description: 'Ultra-clean layout' },
];

// ============================================================
// TEXT UTILITIES
// ============================================================
const makeSafeFileName = (name?: string | null) =>
  (name?.trim() || 'optimized-cv').replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-').toLowerCase();

const cleanJobTitleValue = (value?: string | null): string => {
  const raw = String(value || '').trim();

  if (!raw) return '';

  const roleMatch = raw.match(
    /\bAs\s+(?:a|an)\s+([^,.]+?)(?:,|\syou\s+will|\syou'll|\sresponsible|\syour\s)/i,
  );

  if (roleMatch?.[1]) return roleMatch[1].trim();

  const beforeComma = raw.split(',')[0]?.trim() || raw;

  const badSignals = [
    'you will',
    'you are responsible',
    'responsible for',
    'we are looking',
    'join our',
    'this role',
    'the role',
    'deliver',
    'delivering',
    'ensuring',
    'providing',
    'end-customers',
    'authorized partners',
    'value added resellers',
  ];

  const lower = beforeComma.toLowerCase();

  if (beforeComma.length > 70 || badSignals.some((signal) => lower.includes(signal))) {
    return '';
  }

  return beforeComma;
};




const inferJobTitleFromText = (value?: string | null): string => {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const lines = raw
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const firstUsefulLine = lines.find((line) => {
    const lower = line.toLowerCase();
    return (
      line.length <= 80 &&
      !line.includes('@') &&
      !/^https?:\/\//i.test(line) &&
      !/^\+?\d/.test(line) &&
      !['summary', 'professional summary', 'experience', 'education', 'skills'].includes(lower)
    );
  });

  const summaryLead = raw.match(
    /^\s*([A-Z][A-Za-z/&.\-\s]{2,70}?)\s+with\s+experience\b/i,
  )?.[1];

  const titleLikeLine = lines.find((line) =>
    /\b(engineer|specialist|analyst|developer|consultant|administrator|representative|support|technician|manager|assistant|coordinator|officer|expert)\b/i.test(line) &&
    line.length <= 80 &&
    !line.includes('@'),
  );

  const candidates = [summaryLead, titleLikeLine, firstUsefulLine];

  for (const candidate of candidates) {
    const cleaned = cleanJobTitleValue(candidate || '');
    if (cleaned) return cleaned;
  }

  return '';
};

const resolveBuilderJobTitle = (
  analysis?: AnalysisRecord | null,
  resume?: ResumeBuilderState | null,
  cvVersion?: CvVersionRecord | null,
): string => {
  const extendedData = analysis?.extended_data as Record<string, unknown> | null | undefined;

  const candidates = [
    analysis?.job_title,
    extendedData?.job_title,
    extendedData?.target_role,
    extendedData?.role_category,
    cvVersion?.target_role,
    resume?.personal?.jobTitle,
    inferJobTitleFromText(resume?.summary),
  ];

  for (const candidate of candidates) {
    const cleaned = cleanJobTitleValue(String(candidate || ''));
    if (cleaned) return cleaned;
  }

  return '';
};

const applyResolvedJobTitle = (
  currentResume: ResumeBuilderState,
  resolvedTitle: string,
): ResumeBuilderState => {
  const cleanedTitle = cleanJobTitleValue(
    currentResume.personal.jobTitle || resolvedTitle || inferJobTitleFromText(currentResume.summary) || '',
  );

  return {
    ...currentResume,
    personal: {
      ...currentResume.personal,
      jobTitle: cleanedTitle,
    },
  };
};



const isBadWebsiteValue = (value?: string | null): boolean => {
  const raw = String(value || '').trim().toLowerCase();

  if (!raw) return false;

  const emailProviders = [
    'gmail.com',
    'outlook.com',
    'hotmail.com',
    'yahoo.com',
    'icloud.com',
    'proton.me',
    'protonmail.com',
    'live.com',
  ];

  return emailProviders.some((provider) => {
    return (
      raw === provider ||
      raw === `https://${provider}` ||
      raw === `http://${provider}` ||
      raw.includes(`@${provider}`)
    );
  });
};

const cleanWebsiteValue = (value?: string | null): string => {
  const raw = String(value || '').trim();

  if (!raw || isBadWebsiteValue(raw)) return '';

  return raw;
};

const isWeakSummaryValue = (value?: string | null): boolean => {
  const raw = String(value || '').trim().toLowerCase();

  if (!raw) return true;

  const weakSignals = [
    'i focus on my goals',
    'i willingly take up challenges',
    'i always lend a helping hand',
    'treat people the way i would like',
    'friendly atmosphere',
    'hard worker, team player',
    'c<>team',
    'a<t/u> work',
  ];

  return weakSignals.some((signal) => raw.includes(signal));
};

const buildFallbackProfessionalSummary = (
  jobTitle?: string | null,
  matchedKeywords?: string[] | null,
): string => {
  const cleanTitle = cleanJobTitleValue(jobTitle) || 'Technical Support Engineer';

  const keywords = Array.isArray(matchedKeywords)
    ? matchedKeywords.filter(Boolean).slice(0, 8)
    : [];

  const keywordText = keywords.length
    ? ` Skilled in ${keywords.join(', ')}.`
    : '';

  return `${cleanTitle} with experience in technical troubleshooting, incident investigation, ticket handling, customer communication, and escalation support. Able to analyse reported issues, document findings clearly, collaborate with technical teams, and support users through structured problem resolution.${keywordText}`;
};


const joinContact = (p: PersonalInfo) => [p.email, p.phone, p.location, p.website, p.linkedin, p.github].filter(Boolean).join(' | ');
const headingKey = (line: string) => line.trim().toLowerCase().replace(/[:\-]/g, '').replace(/\s+/g, ' ');

const splitGeneratedCv = (cvText: string) => {
  const sections: Record<string, string> = { contact: '', summary: '', experience: '', skills: '', education: '', projects: '', certifications: '', additional: '' };
  const map: Record<string, keyof typeof sections> = {
    contact: 'contact', 'personal details': 'contact', 'personal information': 'contact',
    summary: 'summary', 'professional summary': 'summary', profile: 'summary',
    experience: 'experience', 'work experience': 'experience', 'professional experience': 'experience',
    skills: 'skills', 'technical skills': 'skills', 'core skills': 'skills',
    education: 'education', projects: 'projects', certifications: 'certifications',
    certificates: 'certifications', awards: 'additional', 'additional information': 'additional',
  };
  let current: keyof typeof sections = 'contact';
  cvText.replace(/\r\n/g, '\n').split('\n').forEach(line => {
    const found = map[headingKey(line)];
    if (found) current = found;
    else sections[current] += `${line}\n`;
  });
  Object.keys(sections).forEach(key => { sections[key] = sections[key].trim(); });
  return sections;
};

const parsePersonal = (contact: string, fallbackTitle?: string | null): PersonalInfo => {
  const lines = contact.split('\n').map(l => l.trim()).filter(Boolean);
  const all = lines.join(' | ');
  const email = all.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || '';
  const phone = all.match(/(\+?\d[\d\s().-]{7,}\d)/)?.[0]?.replace(/\s+/g, ' ').trim() || '';
  const urls: string[] = all.match(/(?:https?:\/\/)?(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s|,]*)?/gi) || [];
  const linkedin = urls.find(u => u.toLowerCase().includes('linkedin')) || '';
  const github = urls.find(u => u.toLowerCase().includes('github')) || '';
  const website = urls.find(u => !u.toLowerCase().includes('linkedin') && !u.toLowerCase().includes('github') && !u.includes('@')) || '';
  const firstLine = lines[0] || '';
  const fullName = firstLine && !firstLine.includes('@') && !/\d/.test(firstLine) ? firstLine.replace(/[|,].*$/, '').trim() : '';
  return {
    fullName,
    jobTitle: cleanJobTitleValue(fallbackTitle),
    email,
    phone,
    location: '',
    website: cleanWebsiteValue(website),
    linkedin,
    github,
  };
};

const DATE_RANGE_REGEX =
  /((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{4}|\d{1,2}\/\d{4}|\d{4})\s*[-–—]\s*((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{4}|\d{1,2}\/\d{4}|\d{4}|present|current|now)/i;

const cleanPart = (value: string) =>
  String(value || '')
    .replace(/^[-•]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();

const parseRoleLine = (line: string): Partial<ExperienceItem> => {
  const clean = cleanPart(line);
  const dateMatch = clean.match(DATE_RANGE_REGEX);
  const years = dateMatch ? dateMatch[0] : '';
  const withoutDate = years
    ? clean.replace(years, '').replace(/[|,–—-]+\s*$/, '').trim()
    : clean;

  const parts = withoutDate
    .split(/\s+\|\s+|\s+–\s+|\s+—\s+|\s+-\s+|,\s+/)
    .map(cleanPart)
    .filter(Boolean);

  return {
    jobTitle: parts[0] || withoutDate,
    company: parts[1] || '',
    location: parts.slice(2).join(', '),
    years,
  };
};

const looksLikeRole = (line: string) => {
  const clean = cleanPart(line);
  if (!clean) return false;
  if (/^[-•]/.test(clean)) return false;

  const hasRoleWord =
    /engineer|specialist|analyst|manager|developer|consultant|assistant|administrator|representative|expert|lead|coordinator|officer|support|intern|trainee|associate|agent|advisor|technician|subject matter/i.test(clean);

  const hasSeparator = /\s+\|\s+|\s+–\s+|\s+—\s+|\s+-\s+|,\s+/.test(clean);
  const hasDate = DATE_RANGE_REGEX.test(clean);

  return clean.length < 150 && (hasRoleWord || (hasSeparator && hasDate));
};

const parseExperience = (text: string): ExperienceItem[] => {
  const lines = text.split('\n').map(cleanPart).filter(Boolean);
  const out: ExperienceItem[] = [];
  let current: ExperienceItem | null = null;

  lines.forEach(line => {
    const clean = cleanPart(line);

    if (looksLikeRole(clean)) {
      if (current) out.push(current);
      const parsed = parseRoleLine(clean);

      current = {
        id: uid(),
        jobTitle: parsed.jobTitle || clean,
        company: parsed.company || '',
        location: parsed.location || '',
        years: parsed.years || '',
        bullets: [],
      };

      return;
    }

    if (!current) current = { id: uid(), jobTitle: '', company: '', location: '', years: '', bullets: [] };

    const date = clean.match(DATE_RANGE_REGEX);
    if (date && !current.years) {
      current.years = date[0];
      const left = clean.replace(date[0], '').replace(/[|,–—-]+\s*$/, '').trim();
      if (left && !current.company) current.company = left;
      return;
    }

    if (!current.company && clean.length < 80 && !/^[-•]/.test(line)) {
      current.company = clean;
    } else {
      current.bullets.push(clean.replace(/^[-•]\s*/, ''));
    }
  });

  if (current) out.push(current);
  return out.filter(i => i.jobTitle || i.company || i.years || i.bullets.length);
};

const DEGREE_REGEX =
  /\b(bachelor|master|bsc|ba|msc|ma|mba|phd|doctorate|diploma|certificate|certification|degree|engineering|computer science|information technology)\b/i;

const INSTITUTION_REGEX =
  /\b(university|college|school|academy|akademia|institute|institut|polytechnic|business school|faculty|vistula)\b/i;

const parseEducation = (text: string): EducationItem[] => {
  const lines = text.split('\n').map(cleanPart).filter(Boolean);
  if (!lines.length) return [];

  const yearsLine = lines.find(l => DATE_RANGE_REGEX.test(l) || /\b(19|20)\d{2}\b/.test(l)) || '';
  const degreeLine = lines.find(l => DEGREE_REGEX.test(l)) || '';
  const institutionLine =
    lines.find(l => INSTITUTION_REGEX.test(l) && l !== degreeLine && l !== yearsLine) ||
    lines.find(l => l !== degreeLine && l !== yearsLine) ||
    '';

  const used = new Set([institutionLine, degreeLine, yearsLine].filter(Boolean));
  const description = lines.filter(l => !used.has(l)).join('\n');

  return [{
    id: uid(),
    institution: institutionLine,
    degree: degreeLine,
    years: yearsLine.match(DATE_RANGE_REGEX)?.[0] || yearsLine,
    description,
  }].filter(i => i.institution || i.degree || i.years || i.description);
};

const parseProjects = (text: string): ProjectItem[] => {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  return [{ id: uid(), name: lines[0], role: '', years: '', link: '', bullets: lines.slice(1).map(l => l.replace(/^[-•]\s*/, '')) }];
};

const resumeFromGeneratedCv = (generatedCv: string, fallbackTitle?: string | null): ResumeBuilderState => {
  const sections = splitGeneratedCv(generatedCv);
  return {
    ...emptyResume,
    personal: parsePersonal(sections.contact, fallbackTitle),
    summary: sections.summary,
    experience: parseExperience(sections.experience),
    education: parseEducation(sections.education),
    projects: parseProjects(sections.projects),
    skillsAwards: classifySkillsIntoSections([
      ...stringList(sections.skills),
      ...stringList(sections.certifications),
      ...stringList(sections.additional),
    ]),
  };
};

// ============================================================
// STRUCTURED-FIRST RESUME BUILDER MAPPING
// ============================================================
const stringList = (value: any): string[] => {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value
      .flatMap((item) => stringList(item))
      .map(cleanPart)
      .filter(Boolean);
  }

  if (typeof value === 'object') {
    const parts = [
      value.name,
      value.title,
      value.skill,
      value.value,
      value.issuer,
    ].filter(Boolean);

    return parts.length ? [parts.join(' - ')] : [];
  }

  return String(value)
    .split(/\n|,|;|\|/)
    .map(cleanPart)
    .filter(Boolean);
};

const unique = (values: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];

  values.map(cleanPart).filter(Boolean).forEach((value) => {
    const key = value.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(value);
    }
  });

  return out;
};

const asLines = (values: string[]) => unique(values).join('\n');

const getLocked = (cvVersion?: CvVersionRecord | null) =>
  cvVersion?.structured_cv?.locked ?? cvVersion?.structured_cv ?? null;

const getLockedSkills = (cvVersion?: CvVersionRecord | null) =>
  cvVersion?.structured_cv?.locked_skills ?? cvVersion?.structured_cv?.skills ?? {};

const periodOf = (item: any) =>
  [
    item?.years,
    item?.period,
    item?.date,
    item?.dates,
    item?.duration,
    item?.start_date && item?.end_date ? `${item.start_date} - ${item.end_date}` : '',
    item?.startDate && item?.endDate ? `${item.startDate} - ${item.endDate}` : '',
  ].find(Boolean) || '';

const bulletListOf = (item: any): string[] =>
  unique([
    ...stringList(item?.raw_bullets),
    ...stringList(item?.bullets),
    ...stringList(item?.responsibilities),
    ...stringList(item?.achievements),
    ...stringList(item?.description),
  ]);

const experienceFromMasterCv = (cvVersion?: CvVersionRecord | null): ExperienceItem[] => {
  const experience = getLocked(cvVersion)?.experience;
  if (!Array.isArray(experience) || !experience.length) return [];

  return experience
    .map((item: any) => ({
      id: uid(),
      jobTitle: item?.title || item?.jobTitle || item?.job_title || item?.position || item?.role || '',
      company: item?.company || item?.employer || item?.organisation || item?.organization || '',
      location: item?.location || '',
      years: periodOf(item),
      bullets: bulletListOf(item),
    }))
    .filter((item: ExperienceItem) => item.jobTitle || item.company || item.years || item.bullets.length);
};

const educationFromMasterCv = (cvVersion?: CvVersionRecord | null): EducationItem[] => {
  const education = getLocked(cvVersion)?.education;
  if (!Array.isArray(education) || !education.length) return [];

  return education
    .map((item: any) => ({
      id: uid(),
      institution: item?.institution || item?.school || item?.university || item?.college || '',
      degree: item?.degree || item?.qualification || item?.program || item?.course || '',
      years: periodOf(item),
      description: stringList(item?.description).join('\n'),
    }))
    .filter((item: EducationItem) => item.institution || item.degree || item.years || item.description);
};

const LANGUAGE_REGEX =
  /\b(english|german|polish|shona|french|spanish|portuguese|italian|dutch|arabic|chinese|mandarin|japanese|korean|russian|ukrainian|native|fluent|bilingual|intermediate|advanced|basic|a1|a2|b1|b2|c1|c2)\b/i;

const CERT_REGEX =
  /\b(certified|certificate|certification|google it support|aws certified|azure fundamentals|az-900|itil|comptia|ccna|pmp|prince2|scrum master|professional certificate)\b/i;

const AWARD_REGEX =
  /\b(award|honou?r|winner|achievement|recognition|scholarship|employee of the month|hackathon)\b/i;

const TECH_HINT_REGEX =
  /\b(sql|python|javascript|typescript|react|node|java|c#|c\+\+|php|html|css|jira|servicenow|zendesk|salesforce|active directory|microsoft office|office 365|microsoft 365|excel|citrix|exchange|vpn|outlook|teams|postman|sap|crm)\b/i;

const classifySkillsIntoSections = (values: string[]): SkillsAwards => {
  const technical: string[] = [];
  const languages: string[] = [];
  const certifications: string[] = [];
  const awards: string[] = [];

  unique(values).forEach((item) => {
    if (LANGUAGE_REGEX.test(item) && !TECH_HINT_REGEX.test(item)) languages.push(item);
    else if (CERT_REGEX.test(item)) certifications.push(item);
    else if (AWARD_REGEX.test(item)) awards.push(item);
    else technical.push(item);
  });

  return {
    technicalSkills: asLines(technical),
    languages: asLines(languages),
    trainingCertifications: asLines(certifications),
    awards: asLines(awards),
  };
};

const skillsFromMasterCv = (cvVersion?: CvVersionRecord | null): SkillsAwards => {
  const lockedSkills = getLockedSkills(cvVersion);
  const locked = getLocked(cvVersion);

  const technical = [
    ...stringList(lockedSkills?.technical),
    ...stringList(lockedSkills?.tools),
    ...stringList(lockedSkills?.platforms),
    ...stringList(lockedSkills?.software),
  ];

  const languages = [
    ...stringList(lockedSkills?.languages),
    ...stringList(locked?.languages),
  ];

  const certifications = Array.isArray(locked?.certifications)
    ? locked.certifications.map((item: any) =>
        typeof item === 'string'
          ? item
          : [item?.name, item?.issuer].filter(Boolean).join(' - '),
      )
    : [];

  return {
    technicalSkills: asLines(technical),
    languages: asLines(languages),
    trainingCertifications: asLines(certifications),
    awards: '',
  };
};

const skillsFromAnalysis = (analysis?: AnalysisRecord | null): SkillsAwards => {
  const evidence = Array.isArray(analysis?.ats_keyword_evidence)
    ? analysis?.ats_keyword_evidence ?? []
    : [];

  const evidenceTerms = evidence
    .filter((item: any) => item?.status === 'matched' || item?.status === 'partial')
    .map((item: any) => item?.keyword)
    .filter(Boolean);

  // Safe rule: add matched + partial JD terms only.
  // Do not add missing_keywords as facts.
  return classifySkillsIntoSections([
    ...stringList(analysis?.matched_keywords),
    ...stringList(analysis?.partial_keywords),
    ...stringList(evidenceTerms),
  ]);
};

const mergeSkills = (...blocks: SkillsAwards[]): SkillsAwards => ({
  technicalSkills: asLines(blocks.flatMap((block) => stringList(block.technicalSkills))),
  languages: asLines(blocks.flatMap((block) => stringList(block.languages))),
  trainingCertifications: asLines(blocks.flatMap((block) => stringList(block.trainingCertifications))),
  awards: asLines(blocks.flatMap((block) => stringList(block.awards))),
});

const mergePersonalFromMaster = (
  fallback: PersonalInfo,
  cvVersion?: CvVersionRecord | null,
  fallbackTitle?: string | null,
): PersonalInfo => {
  const contact = getLocked(cvVersion)?.contact ?? {};

  return {
    fullName: contact?.full_name || contact?.fullName || contact?.name || fallback.fullName,
    jobTitle: cleanJobTitleValue(fallbackTitle || fallback.jobTitle),
    email: contact?.email || fallback.email,
    phone: contact?.phone || fallback.phone,
    location: contact?.location || fallback.location,
    website: cleanWebsiteValue(contact?.website || contact?.portfolio || fallback.website),
    linkedin: contact?.linkedin || fallback.linkedin,
    github: contact?.github || fallback.github,
  };
};

const resumeFromStructuredData = (
  generatedCv: string,
  fallbackTitle?: string | null,
  analysis?: AnalysisRecord | null,
  cvVersion?: CvVersionRecord | null,
): ResumeBuilderState => {
  const fallback = resumeFromGeneratedCv(generatedCv, fallbackTitle);

  const masterExperience = experienceFromMasterCv(cvVersion);
  const masterEducation = educationFromMasterCv(cvVersion);

  const cleanTitle = cleanJobTitleValue(fallbackTitle || fallback.personal.jobTitle);

  const safeSummary = isWeakSummaryValue(fallback.summary)
    ? buildFallbackProfessionalSummary(cleanTitle, analysis?.matched_keywords ?? [])
    : fallback.summary.trim();

  return {
    ...fallback,
    personal: mergePersonalFromMaster(
      {
        ...fallback.personal,
        jobTitle: cleanTitle,
        website: cleanWebsiteValue(fallback.personal.website),
      },
      cvVersion,
      cleanTitle,
    ),
    summary: safeSummary,
    experience: masterExperience.length ? masterExperience : fallback.experience,
    education: masterEducation.length ? masterEducation : fallback.education,
    skillsAwards: mergeSkills(
      fallback.skillsAwards,
      skillsFromMasterCv(cvVersion),
      skillsFromAnalysis(analysis),
    ),
  };
};


const resumeFromImportedGeneratedCv = (
  payload: ResumeBuilderImportPayload,
  profileDefaults: ProfileDefaults,
): ResumeBuilderState => {
  const generatedCv = payload.generatedCv?.trim() || '';

  const fallbackTitle =
    payload.jobTitle ||
    payload.roleCategory ||
    'Tailored CV';

  const recommendations = Array.isArray(payload.recommendations)
    ? payload.recommendations.filter(Boolean)
    : [];

  const missingKeywords = Array.isArray(payload.missingKeywords)
    ? payload.missingKeywords.filter(Boolean)
    : [];

  const matchedKeywords = Array.isArray(payload.matchedKeywords)
    ? payload.matchedKeywords.filter(Boolean)
    : [];

  const customSections: CustomSection[] = [
    {
      id: uid(),
      title: 'Imported Tailored CV Draft',
      type: 'text',
      content: generatedCv,
      items: [],
      visible: true,
      collapsed: false,
    },
  ];

  if (recommendations.length) {
    customSections.push({
      id: uid(),
      title: 'CV Improvement Actions',
      type: 'items',
      content: '',
      items: recommendations.slice(0, 12),
      visible: true,
      collapsed: false,
    });
  }

  if (missingKeywords.length) {
    customSections.push({
      id: uid(),
      title: 'Missing Keywords To Review',
      type: 'items',
      content: '',
      items: missingKeywords.slice(0, 20),
      visible: true,
      collapsed: false,
    });
  }

  if (matchedKeywords.length) {
    customSections.push({
      id: uid(),
      title: 'Matched Keywords',
      type: 'items',
      content: '',
      items: matchedKeywords.slice(0, 20),
      visible: false,
      collapsed: true,
    });
  }

  return {
    ...emptyResume,

    personal: mergeProfileDefaultsIntoPersonal(
      {
        ...emptyResume.personal,
        jobTitle: fallbackTitle,
      },
      profileDefaults,
      true,
    ),

    summary: generatedCv,

    experience: [],

    education: [],

    projects: [],

    skillsAwards: {
      technicalSkills: matchedKeywords.join('\n'),
      languages: '',
      trainingCertifications: '',
      awards: '',
    },

    customSections,

    sectionVisibility: {
      personal: true,
      summary: true,
      experience: true,
      education: true,
      projects: true,
      skillsAwards: true,
    },
  };
};

// ============================================================
// COMPACT SKILLS OUTPUT
// Editor keeps one skill per line, but preview/export uses compact grouped lines.
// This matches the user's normal CV format.
//
// jobTitle is optional — when provided it is used to derive a more specific
// label for the catch-all competency group (e.g. "IT Support Competencies"
// rather than the generic "Support Competencies").
// ============================================================
const SKILL_LABEL_PREFIX_REGEX =
  /^(languages?|technical skills?|soft skills?|tools?|platforms?|systems?|networking|support competencies|technical support competencies|certifications?|awards?)\s*:\s*/i;

const normalizeSkillValue = (value: string) =>
  String(value || '')
    .replace(/^[-•]\s*/, '')
    .replace(SKILL_LABEL_PREFIX_REGEX, '')
    .replace(/\s+/g, ' ')
    .trim();

const skillItems = (value: string): string[] =>
  value
    .split(/\n|,|;|\|/)
    .map(normalizeSkillValue)
    .filter(Boolean);

const skillKey = (value: string) =>
  normalizeSkillValue(value)
    .toLowerCase()
    .replace(/\bmicrosoft teams\b/g, 'teams')
    .replace(/\boffice 365\b|\bo365\b|\bm365\b/g, 'microsoft 365')
    .replace(/\bms office\b|\bmicrosoft office\b/g, 'microsoft 365')
    .replace(/\bjira service management\b/g, 'jira')
    .replace(/\bwindows server\b|\bwindows 10\b|\bwindows 11\b|\bmicrosoft windows\b/g, 'windows')
    .replace(/\blinux server\b|\bunix\/linux\b/g, 'linux basics')
    .replace(/\boperating system\b|\boperating systems\b|\bos\b/g, 'operating systems')
    .replace(/\btcp\/ip\b|\btcp ip\b|\bip network\b|\bnetworking basics\b|\bnetworking\b/g, 'ip networking')
    .replace(/\bsql basics\b|\bsql\b/g, 'sql basics')
    .replace(/\bmicrosoft sql server\b|\bms sql\b|\bsql server\b/g, 'ms sql')
    .replace(/\bazure devops\b|\bado\b/g, 'azure devops')
    .replace(/\btypeScript\b|\btypescript\b/g, 'typescript')
    .replace(/\bcase handling\b|\bticketing\b|\bticket management\b/g, 'ticket handling')
    .replace(/\bcase notes\b|\bhandover notes\b|\bknowledge base\b/g, 'documentation')
    .replace(/\bcross-functional collaboration\b|\bcollaboration\b|\bteamwork\b/g, 'collaboration')
    .replace(/\bproblem-solving\b/g, 'problem solving')
    .trim();

const displaySkillName = (value: string): string => {
  const clean = normalizeSkillValue(value);
  const key = skillKey(clean);

  const names: Record<string, string> = {
    'microsoft 365': 'Microsoft 365',
    excel: 'Excel',
    jira: 'Jira',
    confluence: 'Confluence',
    'active directory': 'Active Directory',
    zendesk: 'Zendesk',
    teams: 'Microsoft Teams',
    windows: 'Windows',
    'operating systems': 'Operating systems',
    'ip networking': 'IP networking basics',
    'connectivity': 'Connectivity troubleshooting',
    'sql basics': 'SQL basics',
    sql: 'SQL basics',
    'ms sql': 'MS SQL',
    'linux basics': 'Linux basics',
    powershell: 'PowerShell',
    bash: 'Bash',
    ansible: 'Ansible',
    docker: 'Docker',
    postgresql: 'PostgreSQL',
    'azure devops': 'Azure DevOps',
    nginx: 'NGINX',
    iis: 'IIS',
    'it operations support': 'IT operations support',
    'it infrastructure': 'IT infrastructure',
    'server administration': 'Server administration',
    'change management': 'Change management',
    'system performance monitoring': 'System performance monitoring',
    'technical support': 'Technical support',
    troubleshooting: 'Troubleshooting',
    'incident management': 'Incident handling',
    'ticket handling': 'Ticket handling',
    escalation: 'Escalation support',
    documentation: 'Documentation',
    'customer communication': 'Customer communication',
    'problem solving': 'Problem solving',
    monitoring: 'Service monitoring',
    collaboration: 'Collaboration',
    'process improvement': 'Process improvement',
  };

  return names[key] ?? clean;
};

const compactUnique = (values: string[]) => {
  const seen = new Set<string>();
  const out: string[] = [];

  values.map(displaySkillName).filter(Boolean).forEach((value) => {
    const key = skillKey(value);

    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(value);
    }
  });

  return out;
};

const isSupportTargetRole = (jobTitle?: string | null): boolean =>
  /\b(technical support|it support|help desk|service desk|application support|desktop support|support engineer|support specialist|customer support|operations engineer|junior operations engineer|it operations|infrastructure|server administration|systems administration)\b/i.test(
    jobTitle ?? '',
  );

const shouldHideSkillForSupportCV = (skill: string, jobTitle?: string | null): boolean => {
  if (!isSupportTargetRole(jobTitle)) return false;

  const key = skillKey(skill);

  const developerOnly = [
    'typescript',
    'javascript',
    'react',
    'node',
    'node.js',
    'frontend',
    'backend',
    'full stack',
    'software development',
    'coding',
    'programming',
    'github',
  ];

  return developerOnly.includes(key);
};

const pickSkillGroup = (items: string[], patterns: RegExp[]) =>
  items.filter((item) => patterns.some((pattern) => pattern.test(item)));

const removePicked = (items: string[], picked: string[]) => {
  const pickedKeys = new Set(picked.map(skillKey));
  return items.filter((item) => !pickedKeys.has(skillKey(item)));
};

const orderSkills = (items: string[], preferredOrder: string[]): string[] => {
  const cleanItems = compactUnique(items);

  return cleanItems.sort((a, b) => {
    const aIndex = preferredOrder.findIndex((item) => skillKey(item) === skillKey(a));
    const bIndex = preferredOrder.findIndex((item) => skillKey(item) === skillKey(b));

    if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;

    return aIndex - bIndex;
  });
};

const joinCompact = (items: string[], limit = 10) =>
  compactUnique(items).slice(0, limit).join(', ');

/**
 * Derives a context-aware label for the catch-all competency group from the
 * target job title. Falls back to "Support Competencies" when the title gives
 * no usable signal.
 */
const deriveCatchAllLabel = (jobTitle: string | null | undefined): string => {
  const title = (jobTitle ?? '').trim().toLowerCase();

  if (!title) return 'Support Competencies';

  const rules: Array<[RegExp, string]> = [
    [/service\s+desk/i, 'Service Desk Competencies'],
    [/help\s+desk/i, 'Help Desk Competencies'],
    [/it\s+support/i, 'IT Support Competencies'],
    [/technical\s+support/i, 'Technical Support Competencies'],
    [/desktop\s+support/i, 'Desktop Support Competencies'],
    [/operations\s+engineer|it\s+operations|infrastructure/i, 'IT Operations Competencies'],
    [/server\s+admin|systems?\s+admin/i, 'Infrastructure Competencies'],
    [/network\s*(engineer|admin)/i, 'Network Engineering Competencies'],
    [/software\s+engineer/i, 'Engineering Competencies'],
    [/data\s+analy/i, 'Data & Analytics Competencies'],
    [/business\s+analy/i, 'Business Analysis Competencies'],
    [/project\s+manag/i, 'Project Management Competencies'],
    [/product\s+manag/i, 'Product Management Competencies'],
    [/customer\s+success/i, 'Customer Success Competencies'],
    [/customer\s+service/i, 'Customer Service Competencies'],
    [/sales/i, 'Sales Competencies'],
    [/market/i, 'Marketing Competencies'],
    [/devops/i, 'DevOps Competencies'],
    [/secur/i, 'Security Competencies'],
    [/finance|accounting/i, 'Finance Competencies'],
    [/hr|human\s+resource/i, 'HR Competencies'],
  ];

  for (const [pattern, label] of rules) {
    if (pattern.test(title)) return label;
  }

  return 'Support Competencies';
};

/**
 * Formats the skills & awards state into compact, screening-friendly grouped lines.
 * Goal: skills should support the target role without flooding the CV.
 */
const formatCompactSkillsSection = (
  skillsAwards: SkillsAwards,
  jobTitle?: string | null,
): string[] => {
  const rawTechnical = skillItems(skillsAwards.technicalSkills).filter(
    (skill) => !shouldHideSkillForSupportCV(skill, jobTitle),
  );
  const rawLanguages = skillItems(skillsAwards.languages);
  const rawCerts = skillItems(skillsAwards.trainingCertifications);
  const rawAwards = skillItems(skillsAwards.awards);

  const languageFromTechnical = pickSkillGroup(rawTechnical, [
    /\b(english|german|polish|shona|french|spanish|portuguese|italian|dutch|arabic|mandarin|chinese|japanese|korean)\b/i,
  ]);

  const languages = compactUnique([...rawLanguages, ...languageFromTechnical]);

  let remaining = removePicked(compactUnique(rawTechnical), languageFromTechnical);

  const tools = orderSkills(
    pickSkillGroup(remaining, [
      /\b(zendesk|jira|confluence|servicenow|salesforce|hubspot|active directory|microsoft 365|office 365|microsoft office|excel|citrix|exchange|vpn|outlook|teams|postman|sap|crm|git)\b/i,
    ]),
    ['Microsoft 365', 'Excel', 'Jira', 'Confluence', 'Active Directory', 'Zendesk', 'Microsoft Teams', 'Postman', 'Git'],
  );
  remaining = removePicked(remaining, tools);

  const systemsNetworking = orderSkills(
    pickSkillGroup(remaining, [
      /\b(windows|linux|linux basics|unix|tcp\/ip|tcp|ip networking|ip network|ports?|protocols?|computer networks?|networking|dns|dhcp|vpn|configurations?|hardware|software|operating systems?|connectivity|server administration|it infrastructure)\b/i,
    ]),
    ['Windows', 'Operating systems', 'Connectivity troubleshooting', 'IP networking basics', 'VPN', 'IT infrastructure', 'Server administration', 'Hardware', 'Software', 'Linux basics'],
  );
  remaining = removePicked(remaining, systemsNetworking);

  const databases = orderSkills(
    pickSkillGroup(remaining, [
      /\b(sql basics|sql|mysql|postgresql|database|databases|ms sql|microsoft sql server|sql server)\b/i,
    ]),
    ['SQL basics', 'MySQL', 'PostgreSQL', 'MS SQL'],
  );
  remaining = removePicked(remaining, databases);

  const supportCompetencies = orderSkills(
    pickSkillGroup(remaining, [
      /\b(it operations support|technical support|troubleshooting|incident|incident management|sla|service level|service level agreements?|root cause|ticket handling|ticketing|support|escalation|monitoring|system performance monitoring|change management|operational dashboards?|prioritization|prioritisation|ownership|clear written communication|communication|collaboration|teamwork|problem solving|analytical thinking|decision making|documentation|process improvement|complaint resolution|customer communication)\b/i,
    ]),
    [
      'IT operations support',
      'Technical support',
      'Troubleshooting',
      'Incident handling',
      'Ticket handling',
      'Escalation support',
      'Documentation',
      'SLA support',
      'Service monitoring',
      'System performance monitoring',
      'Customer communication',
      'Collaboration',
      'Analytical thinking',
      'Problem solving',
      'Process improvement',
      'Complaint resolution',
    ],
  );
  remaining = removePicked(remaining, supportCompetencies);

  const catchAllLabel = deriveCatchAllLabel(jobTitle);
  const lines: string[] = [];

  if (languages.length) {
    lines.push(`Languages: ${joinCompact(languages, 6)}`);
  }

  if (tools.length) {
    lines.push(`Tools & Platforms: ${joinCompact(tools, 10)}`);
  }

  if (systemsNetworking.length) {
    lines.push(`Systems & Networking: ${joinCompact(systemsNetworking, 8)}`);
  }

  if (databases.length) {
    lines.push(`Databases: ${joinCompact(databases, 5)}`);
  }

  if (supportCompetencies.length || remaining.length) {
    lines.push(`${catchAllLabel}: ${joinCompact([...supportCompetencies, ...remaining], 10)}`);
  }

  if (rawCerts.length) {
    lines.push(`Certifications: ${joinCompact(rawCerts, 6)}`);
  }

  if (rawAwards.length) {
    lines.push(`Awards: ${joinCompact(rawAwards, 6)}`);
  }

  return lines;
};

// ============================================================
// PLAIN TEXT BUILDER
// ============================================================
const buildPlainTextResume = (state: ResumeBuilderState, jobTitle?: string | null): string => {
  const sections: string[] = [];
  const contact = [state.personal.fullName, state.personal.jobTitle, joinContact(state.personal)].filter(Boolean).join('\n');
  if (state.sectionVisibility.personal && contact) sections.push(contact);
  if (state.sectionVisibility.summary && state.summary.trim()) sections.push(`PROFESSIONAL SUMMARY\n${state.summary.trim()}`);
  if (state.sectionVisibility.experience && state.experience.length) {
    const text = state.experience.map(item => {
      const header = [item.jobTitle, item.company, item.location, item.years].filter(Boolean).join(' | ');
      const bullets = item.bullets.filter(Boolean).map(b => `• ${b}`).join('\n');
      return [header, bullets].filter(Boolean).join('\n');
    }).join('\n\n');
    if (text.trim()) sections.push(`EXPERIENCE\n${text}`);
  }
  if (state.sectionVisibility.education && state.education.length) {
    const text = state.education.map(i => [[i.institution, i.degree, i.years].filter(Boolean).join(' | '), i.description].filter(Boolean).join('\n')).join('\n\n');
    if (text.trim()) sections.push(`EDUCATION\n${text}`);
  }
  if (state.sectionVisibility.projects && state.projects.length) {
    const text = state.projects.map(item => [[item.name, item.role, item.years, item.link].filter(Boolean).join(' | '), item.bullets.filter(Boolean).map(b => `• ${b}`).join('\n')].filter(Boolean).join('\n')).join('\n\n');
    if (text.trim()) sections.push(`PROJECTS\n${text}`);
  }
  if (state.sectionVisibility.skillsAwards) {
    // Pass jobTitle so the catch-all group label is role-specific in plain text too.
    const compactSkills = formatCompactSkillsSection(state.skillsAwards, jobTitle)
      .map(line => `• ${line}`)
      .join('\n');

    if (compactSkills.trim()) {
      sections.push(`TECHNICAL SKILLS & COMPETENCIES\n${compactSkills}`);
    }
  }
  state.customSections.filter(s => s.visible).forEach(s => {
    const content = s.type === 'text' ? s.content : s.items.filter(Boolean).map(item => `• ${item}`).join('\n');
    if (content.trim()) sections.push(`${s.title.toUpperCase()}\n${content.trim()}`);
  });
  return sections.join('\n\n');
};

// ============================================================
// EXPORT FUNCTIONS
// ============================================================
const exportAsPDF = async (
  state: ResumeBuilderState,
  formatting: FormattingSettings,
  jobTitle?: string | null,
  fileName = 'resume.pdf',
) => {
  if (!buildPlainTextResume(state, jobTitle).trim()) return;

  const PDF = await loadPdfLib();
  if (!PDF) throw new ExportToolError(EXPORT_TOOL_MESSAGE('PDF'));

  const doc = new PDF({
    unit: 'mm',
    format: formatting.pageSize === 'a4' ? 'a4' : 'letter',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const template = formatting.template;
  const classic = template === 'classic_ats';
  const modern = template === 'modern';
  const clean = template === 'clean';
  const two = template === 'two_column';

  const margin = {
    top: formatting.margins.top,
    right: formatting.margins.right,
    bottom: formatting.margins.bottom,
    left: formatting.margins.left,
  };

  const baseFont = formatting.compactMode
    ? 8 + formatting.fontSize.base * 0.6
    : classic
      ? 9 + formatting.fontSize.base * 0.45
      : 8 + formatting.fontSize.base * 0.75;

  const headingFont = baseFont + formatting.fontSize.headers * 0.7 + (modern ? 1.2 : 0);
  const nameFont = headingFont + (classic ? 5 : modern ? 6 : 4);
  const lineHeight = formatting.compactMode ? baseFont * 0.45 : baseFont * (0.48 + formatting.spacing.line * 0.025);
  const itemGap = formatting.compactMode ? 1.5 : 2 + formatting.spacing.item * 0.35;
  const sectionGap = formatting.compactMode ? 3 : 3.5 + formatting.spacing.section * 0.55;
  const accent = modern ? [37, 99, 235] : [17, 24, 39];

  const bodyFont = formatting.fonts.body === 'serif' ? 'times' : formatting.fonts.body === 'mono' ? 'courier' : 'helvetica';
  const headerFont = formatting.fonts.header === 'serif' ? 'times' : formatting.fonts.header === 'mono' ? 'courier' : 'helvetica';

  let y = margin.top;

  const mainLeft = margin.left;
  const mainRight = pageWidth - margin.right;
  const contentWidth = mainRight - mainLeft;

  const sideWidth = two ? Math.min(52, contentWidth * 0.31) : 0;
  const gap = two ? 7 : 0;
  const bodyLeft = two ? mainLeft + sideWidth + gap : mainLeft;
  const bodyWidth = two ? contentWidth - sideWidth - gap : contentWidth;

  const ensureSpace = (needed = 8) => {
    if (y + needed > pageHeight - margin.bottom) {
      doc.addPage();
      y = margin.top;
    }
  };

  const setText = (font = bodyFont, style: 'normal' | 'bold' | 'italic' = 'normal', size = baseFont, color: number[] = [17, 24, 39]) => {
    doc.setFont(font, style);
    doc.setFontSize(size);
    doc.setTextColor(color[0], color[1], color[2]);
  };

  const drawWrapped = (
    value: string,
    x: number,
    width: number,
    options?: { bullet?: boolean; bold?: boolean; italic?: boolean; size?: number; color?: number[] },
  ) => {
    const cleanValue = String(value || '').trim();
    if (!cleanValue) return;

    setText(bodyFont, options?.bold ? 'bold' : options?.italic ? 'italic' : 'normal', options?.size ?? baseFont, options?.color);
    const prefix = options?.bullet ? '• ' : '';
    const lines = doc.splitTextToSize(`${prefix}${cleanValue}`, width);

    lines.forEach((line: string) => {
      ensureSpace(lineHeight + 2);
      doc.text(line, x, y);
      y += lineHeight;
    });
  };

  const heading = (title: string, x = bodyLeft, width = bodyWidth) => {
    ensureSpace(headingFont + 5);
    y += sectionGap * 0.35;

    setText(headerFont, 'bold', headingFont, accent);
    doc.text(title.toUpperCase(), x, y);

    const lineY = y + 1.5;
    doc.setDrawColor(modern ? 147 : 17, modern ? 197 : 24, modern ? 253 : 39);
    doc.setLineWidth(classic || clean ? 0.45 : modern ? 0.7 : 0.25);
    doc.line(x, lineY, x + width, lineY);

    y += headingFont * 0.45 + 3;
  };

  const roleHeader = (left: string, right: string, x = bodyLeft, width = bodyWidth) => {
    ensureSpace(lineHeight + 3);
    setText(bodyFont, 'bold', baseFont);

    const rightWidth = right ? doc.getTextWidth(right) : 0;
    doc.text(left || '', x, y);

    if (right) {
      doc.text(right, x + width - rightWidth, y);
    }

    y += lineHeight;
  };

  const subLine = (left: string, right = '', x = bodyLeft, width = bodyWidth) => {
    ensureSpace(lineHeight + 2);
    setText(bodyFont, classic ? 'italic' : 'normal', baseFont, [55, 65, 81]);

    const rightWidth = right ? doc.getTextWidth(right) : 0;
    doc.text(left || '', x, y);

    if (right) {
      doc.text(right, x + width - rightWidth, y);
    }

    y += lineHeight;
  };

  // Header
  if (state.sectionVisibility.personal) {
    const fullName = state.personal.fullName || 'Your Name';
    const contact = joinContact(state.personal);

    if (classic || clean) {
      setText(headerFont, 'bold', nameFont);
      doc.text(fullName, pageWidth / 2, y, { align: 'center' });
      y += nameFont * 0.45 + 2;

      if (state.personal.jobTitle && !classic) {
        setText(bodyFont, 'bold', baseFont, [55, 65, 81]);
        doc.text(state.personal.jobTitle, pageWidth / 2, y, { align: 'center' });
        y += lineHeight;
      }

      if (contact) {
        setText(bodyFont, 'normal', baseFont - 0.5, [55, 65, 81]);
        doc.text(contact, pageWidth / 2, y, { align: 'center' });
        y += lineHeight + sectionGap;
      }
    } else {
      setText(headerFont, 'bold', nameFont, accent);
      doc.text(fullName.toUpperCase(), mainLeft, y);
      y += nameFont * 0.45 + 2;

      if (state.personal.jobTitle) {
        setText(bodyFont, modern ? 'bold' : 'normal', baseFont, modern ? [30, 64, 175] : [55, 65, 81]);
        doc.text(state.personal.jobTitle, mainLeft, y);
        y += lineHeight;
      }

      if (contact) {
        setText(bodyFont, 'normal', baseFont - 0.5, [75, 85, 99]);
        doc.text(contact, mainLeft, y);
        y += lineHeight + sectionGap;
      }

      if (modern) {
        doc.setDrawColor(37, 99, 235);
        doc.setLineWidth(1);
        doc.line(mainLeft, y - sectionGap * 0.6, mainRight, y - sectionGap * 0.6);
      }
    }
  }

  // Optional side column for two-column template.
  if (two && state.sectionVisibility.skillsAwards) {
    const savedY = y;
    let sideY = y;

    const sideText = (value: string, opts?: { bold?: boolean; size?: number }) => {
      const prevY = y;
      y = sideY;
      drawWrapped(value, mainLeft, sideWidth, { ...opts, size: opts?.size ?? baseFont - 0.6 });
      sideY = y;
      y = prevY;
    };

    const sideHeading = (title: string) => {
      const prevY = y;
      y = sideY;
      heading(title, mainLeft, sideWidth);
      sideY = y;
      y = prevY;
    };

    const skills = formatCompactSkillsSection(state.skillsAwards, jobTitle);
    if (skills.length) {
      sideHeading('Skills');
      skills.forEach(line => sideText(line, { size: baseFont - 0.8 }));
    }

    doc.setDrawColor(229, 231, 235);
    doc.setLineWidth(0.2);
    doc.line(mainLeft + sideWidth + gap / 2, savedY - 1, mainLeft + sideWidth + gap / 2, pageHeight - margin.bottom);

    y = savedY;
  }

  // Main content
  if (state.sectionVisibility.summary && state.summary.trim()) {
    heading(classic ? 'Profile' : 'Professional Summary');
    drawWrapped(state.summary.trim(), bodyLeft, bodyWidth);
    y += sectionGap * 0.35;
  }

  if (classic && state.sectionVisibility.education && state.education.length) {
    heading('Education');
    state.education.forEach(edu => {
      roleHeader(edu.institution, edu.years);
      if (edu.degree) subLine(edu.degree);
      if (edu.description) drawWrapped(edu.description, bodyLeft, bodyWidth, { color: [55, 65, 81] });
      y += itemGap;
    });
  }

  if (state.sectionVisibility.experience && state.experience.length) {
    heading(classic ? 'Work Experience' : 'Experience');

    state.experience.forEach(exp => {
      if (classic) {
        roleHeader(exp.company || exp.jobTitle, exp.location);
        subLine(exp.company ? exp.jobTitle : '', exp.years);
      } else {
        roleHeader(exp.jobTitle, exp.years);
        if (exp.company || exp.location) {
          subLine([exp.company, exp.location].filter(Boolean).join(' · '));
        }
      }

      exp.bullets.filter(Boolean).forEach(b => drawWrapped(b, bodyLeft + 2.5, bodyWidth - 2.5, { bullet: true }));
      y += itemGap;
    });
  }

  if (!classic && state.sectionVisibility.education && state.education.length) {
    heading('Education');
    state.education.forEach(edu => {
      roleHeader(edu.institution, edu.years);
      if (edu.degree) subLine(edu.degree);
      if (edu.description) drawWrapped(edu.description, bodyLeft, bodyWidth, { color: [55, 65, 81] });
      y += itemGap;
    });
  }

  if (!two && state.sectionVisibility.skillsAwards) {
    const skills = formatCompactSkillsSection(state.skillsAwards, jobTitle);
    if (skills.length) {
      heading('Technical Skills & Competencies');
      skills.forEach(line => drawWrapped(line, bodyLeft + 2.5, bodyWidth - 2.5, { bullet: true }));
      y += sectionGap * 0.35;
    }
  }

  if (state.sectionVisibility.projects && state.projects.length) {
    heading(classic ? 'Project Experience' : 'Projects');

    state.projects.forEach(project => {
      roleHeader(project.name, project.years);
      if (project.role || project.link) {
        subLine([project.role, project.link].filter(Boolean).join(' · '));
      }
      project.bullets.filter(Boolean).forEach(b => drawWrapped(b, bodyLeft + 2.5, bodyWidth - 2.5, { bullet: true }));
      y += itemGap;
    });
  }

  state.customSections.filter(s => s.visible).forEach(section => {
    const content = section.type === 'text'
      ? [section.content]
      : section.items.filter(Boolean);

    if (!content.some(Boolean)) return;

    heading(section.title);
    content.filter(Boolean).forEach(item => drawWrapped(item, bodyLeft + (section.type === 'text' ? 0 : 2.5), bodyWidth - 2.5, { bullet: section.type !== 'text' }));
    y += sectionGap * 0.35;
  });

  doc.save(fileName);
};

const exportAsDOCX = async (state: ResumeBuilderState, jobTitle?: string | null, fileName = 'resume.docx') => {
  const text = buildPlainTextResume(state, jobTitle);
  if (!text.trim()) return;
  const docx = await loadDocxLib();
  const fs = await loadFileSaver();
  if (!docx || !fs) throw new ExportToolError(EXPORT_TOOL_MESSAGE('DOCX'));
  const { Document, Packer, Paragraph, TextRun } = docx;
  const paragraphs = text.split('\n').map((line: string) => {
    const isHeading = line.trim() && line.trim() === line.trim().toUpperCase() && line.trim().length < 50;
    return new Paragraph({ children: [new TextRun({ text: line || ' ', size: isHeading ? 24 : 21, bold: Boolean(isHeading) })], spacing: { after: line.trim() ? 90 : 70 } });
  });
  const doc = new Document({ sections: [{ properties: {}, children: paragraphs }] });
  const blob = await Packer.toBlob(doc);
  fs.saveAs(blob, fileName);
};

// ============================================================
// MAIN PAGE
// ============================================================
export const ResumeBuilderPage: React.FC = () => {
  const params = useParams();

  const rawAnalysisId = params.analysisId;
  const cvVersionId = params.cvVersionId;

  const analysisId =
    rawAnalysisId &&
    !['editor', 'flow', 'start', 'history', 'saved'].includes(rawAnalysisId)
      ? rawAnalysisId
      : undefined;
  const navigate = useNavigate();
  const location = useLocation();
  // A tailored CV handed over by the Resume Builder Flow page through
  // navigation state (kept in memory, never in browser storage).
  const importedDraftRef = useRef<ResumeBuilderImportPayload | null>(
    (location.state as { resumeBuilderImport?: ResumeBuilderImportPayload } | null)?.resumeBuilderImport ?? null,
  );
  const [analysis, setAnalysis] = useState<AnalysisRecord | null>(null);
  const [resume, setResume] = useState<ResumeBuilderState>(emptyResume);
  const [originalResume, setOriginalResume] = useState<ResumeBuilderState>(emptyResume);
  const [profileDefaults, setProfileDefaults] = useState<ProfileDefaults>({});
  const [formatting, setFormatting] = useState<FormattingSettings>(defaultFormatting);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState<'pdf' | 'docx' | null>(null);
  // The Resume Builder CV version that Save updates. Set when a saved builder
  // CV is opened, or after the first save; null means Save creates a new one.
  const [savedVersion, setSavedVersion] = useState<SavedBuilderVersion | null>(null);
  // Snapshot of the content last loaded or saved; edits are anything that
  // differs from it. null while loading.
  const [baseline, setBaseline] = useState<string | null>(null);
  const [draftKey, setDraftKey] = useState<string | null>(null);
  // An autosaved draft found on load, waiting for Restore or Discard.
  const [pendingDraft, setPendingDraft] = useState<BuilderDraft | null>(null);
  const [savedMsg, setSavedMsg] = useState('');
  const [error, setError] = useState('');
  // Only a failed load replaces the editor; errors from saving, exporting or
  // tailoring are shown inside it (in `error`) so the edits stay on screen.
  const [loadError, setLoadError] = useState('');
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'editor' | 'preview'>('editor');
  const [bulletReviewOpen, setBulletReviewOpen] = useState(false);
  const [bulletReviewItems, setBulletReviewItems] = useState<BulletReviewItem[]>([]);
  const [bulletReviewResume, setBulletReviewResume] =
    useState<ResumeBuilderState | null>(null);
  const [summaryReviewChange, setSummaryReviewChange] =
    useState<TailoringChange | null>(null);
  const [summaryReviewAccepted, setSummaryReviewAccepted] = useState(true);
  const [qualityReport, setQualityReport] = useState<CVQualityReport | null>(null);
  const [skillReviewItems, setSkillReviewItems] = useState<SkillReviewItem[]>([]);
  const [claimableGaps, setClaimableGaps] = useState<ClaimableGap[]>([]);

  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackSaving, setFeedbackSaving] = useState(false);
  const [lastImprovementStats, setLastImprovementStats] = useState({
    acceptedCount: 0,
    rejectedCount: 0,
    totalCount: 0,
  });
 const [collapsed, setCollapsed] = useState({
  formatting: true,
  personal: false,
  summary: false,
  experience: false,
  education: false,
  projects: true,
  skillsAwards: false,
});
  // Resolved job title — kept separately so it's available for skills formatting
  // even before the analysis record is stored in state.
  const jobTitle = resolveBuilderJobTitle(analysis, resume);

  const plainText = useMemo(
    () => buildPlainTextResume(resume, jobTitle),
    [resume, jobTitle],
  );
  const fileBase = makeSafeFileName(
    jobTitle ? `${jobTitle} cv` : resume.personal.fullName || 'optimized-cv',
  );

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError('');
        setLoadError('');
        setSavedVersion(null);
        setBaseline(null);
        setPendingDraft(null);
        setQualityReport(null);
        setSkillReviewItems([]);
        setClaimableGaps([]);

        const { data: { user }, error: ue } = await supabase.auth.getUser();
        if (ue || !user) throw new Error('You must be logged in.');

        const key = getDraftKey({ userId: user.id, cvVersionId, analysisId });
        setDraftKey(key);

        // Records what was loaded, and offers an autosaved draft that differs
        // from it. Content that exists nowhere else (an imported draft) starts
        // out as unsaved.
        const finishLoad = (
          loadedResume: ResumeBuilderState,
          loadedFormatting: FormattingSettings,
          unsaved = false,
        ) => {
          const snapshot = serializeEditorState(loadedResume, loadedFormatting);
          const draft = readDraft<ResumeBuilderState, FormattingSettings, SavedBuilderVersion>(key);

          setBaseline(unsaved ? '' : snapshot);
          if (draftDiffersFrom(draft, snapshot)) setPendingDraft(draft);
        };

        const { data: profileData } = await supabase
          .from('profiles')
          .select('full_name, email, linkedin_url, github_url, portfolio_url')
          .eq('id', user.id)
          .maybeSingle();

        const loadedProfileDefaults: ProfileDefaults = {
          fullName: profileData?.full_name || '',
          email: profileData?.email || user.email || '',
          linkedin: profileData?.linkedin_url || '',
          github: profileData?.github_url || '',
          website: profileData?.portfolio_url || '',
        };

        setProfileDefaults(loadedProfileDefaults);

        const importedPayload = importedDraftRef.current;

        if (!analysisId && !cvVersionId && importedPayload) {
          try {
            if (importedPayload.generatedCv?.trim()) {
              const importedResume = resumeFromImportedGeneratedCv(
                importedPayload,
                loadedProfileDefaults,
              );

              const importedAnalysis: AnalysisRecord | null =
                importedPayload.analysisId
                  ? ({
                      id: importedPayload.analysisId,
                      cv_version_id: importedPayload.cvVersionId ?? null,
                      job_title:
                        importedPayload.jobTitle ||
                        importedPayload.roleCategory ||
                        null,
                      company_name: importedPayload.companyName || null,
                      job_description: importedPayload.jobDescription || null,
                      generated_cv: importedPayload.generatedCv,
                      score: importedPayload.score ?? null,
                      matched_keywords: importedPayload.matchedKeywords ?? [],
                      partial_keywords: [],
                      missing_keywords: importedPayload.missingKeywords ?? [],
                      ats_keyword_evidence: [],
                      extended_data: {
                        imported_from: importedPayload.source ?? 'resume_builder_flow',
                        role_category: importedPayload.roleCategory ?? null,
                        recommendations: importedPayload.recommendations ?? [],
                        imported_at: importedPayload.importedAt ?? null,
                      },
                    } as unknown as AnalysisRecord)
                  : null;

              const resolvedTitle = resolveBuilderJobTitle(importedAnalysis, importedResume);
              const finalImportedResume = applyResolvedJobTitle(importedResume, resolvedTitle);

              setAnalysis(importedAnalysis);
              setResume(finalImportedResume);
              setOriginalResume(finalImportedResume);
              setFormatting(defaultFormatting);
              finishLoad(finalImportedResume, defaultFormatting, true);

              setSavedMsg(
                'Imported tailored CV draft into Resume Builder. Review the Imported Tailored CV Draft section below.',
              );
              setTimeout(() => setSavedMsg(''), 3000);

              return;
            }
          } catch (importError) {
            console.error('Failed to import Resume Builder draft:', importError instanceof Error ? importError.name : 'unknown');
          }
        }

        if (cvVersionId) {
          const { data: savedCv, error: savedError } = await supabase
            .from('cv_versions')
            .select('id, name, target_role, cv_text, structured_cv, cv_suggestions, last_score, last_analyzed_at, source_analysis_id, parent_cv_version_id')
            .eq('id', cvVersionId)
            .eq('user_id', user.id)
            .maybeSingle();

          if (savedError || !savedCv) throw new Error('Saved builder CV was not found.');

          const cvRecord = savedCv as CvVersionRecord;
          const savedState = readBuilderState(cvRecord);
          const fallbackResume = cvRecord.cv_text
            ? resumeFromGeneratedCv(cvRecord.cv_text, cvRecord.target_role)
            : emptyResume;

          const hydratedResume = {
            ...(savedState ?? fallbackResume),
            personal: mergeProfileDefaultsIntoPersonal(
              (savedState ?? fallbackResume).personal,
              loadedProfileDefaults,
              true,
            ),
          };

          const resolvedTitle = resolveBuilderJobTitle(null, hydratedResume, cvRecord);
          const finalResume = applyResolvedJobTitle(hydratedResume, resolvedTitle);

          const loadedFormatting = readBuilderFormatting(cvRecord);
          setFormatting(loadedFormatting);
          setAnalysis(null);
          // Only versions the builder saved are updated in place; an uploaded
          // CV opened here is kept as is and the first save makes a copy.
          setSavedVersion(
            cvRecord.structured_cv?.source === 'resume_builder'
              ? {
                  id: cvRecord.id,
                  name: cvRecord.name || 'Resume Builder CV',
                  sourceAnalysisId: cvRecord.source_analysis_id ?? cvRecord.structured_cv?.source_analysis_id ?? null,
                  sourceCvVersionId: cvRecord.parent_cv_version_id ?? cvRecord.structured_cv?.source_cv_version_id ?? null,
                  companyName: cvRecord.structured_cv?.company_name ?? null,
                }
              : null,
          );
          setResume(finalResume);
          setOriginalResume(finalResume);
          finishLoad(finalResume, loadedFormatting);
          return;
        }

        if (!analysisId) {
          const hydratedEmpty = {
            ...emptyResume,
            personal: mergeProfileDefaultsIntoPersonal(emptyResume.personal, loadedProfileDefaults, true),
          };
          setResume(hydratedEmpty);
          setOriginalResume(hydratedEmpty);
          setFormatting(defaultFormatting);
          finishLoad(hydratedEmpty, defaultFormatting);
          return;
        }

        const { data, error: ae } = await supabase.from('cv_analyses')
          .select(`
            id,
            user_id,
            cv_version_id,
            job_title,
            company_name,
            job_description,
            generated_cv,
            score,
            matched_keywords,
            partial_keywords,
            missing_keywords,
            ats_keyword_evidence,
            extended_data
          `)
          .eq('id', analysisId).eq('user_id', user.id).single();
        if (ae || !data) throw new Error('Analysis not found.');
        const record = data as AnalysisRecord;
        if (!record.generated_cv?.trim()) throw new Error('This analysis does not have a generated CV yet.');

        const { data: cvVersion } = await supabase
          .from('cv_versions')
          .select('id, cv_text, structured_cv, cv_suggestions')
          .eq('id', record.cv_version_id)
          .eq('user_id', user.id)
          .maybeSingle();

        const parsed = resumeFromStructuredData(
          record.generated_cv,
          record.job_title,
          record,
          cvVersion as CvVersionRecord | null,
        );

        const hydratedPersonal = mergeProfileDefaultsIntoPersonal(
        parsed.personal,
        loadedProfileDefaults,
         true,
);

        const initialResolvedTitle = resolveBuilderJobTitle(record, {
          ...parsed,
          personal: hydratedPersonal,
        });

        const hydratedResume = {
          ...parsed,
          personal: {
            ...hydratedPersonal,
            jobTitle: hydratedPersonal.jobTitle || initialResolvedTitle,
          },
          summary: isWeakSummaryValue(parsed.summary)
            ? buildFallbackProfessionalSummary(
                hydratedPersonal.jobTitle || initialResolvedTitle || record.job_title,
                record.matched_keywords ?? [],
              )
            : parsed.summary,
        };

        const resolvedTitle = resolveBuilderJobTitle(record, hydratedResume);
        const finalResume = applyResolvedJobTitle(hydratedResume, resolvedTitle);

        setAnalysis(record);
        setResume(finalResume);
        setOriginalResume(finalResume);
        setFormatting(defaultFormatting);
        finishLoad(finalResume, defaultFormatting);
      } catch (err) { setLoadError(err instanceof Error ? err.message : 'Failed to load Resume Builder.'); }
      finally { setLoading(false); }
    };
    load();
  }, [analysisId, cvVersionId]);

  // Drop the hand-off from browser history once read, so it isn't kept with
  // the page or imported again on reload (the unsaved draft covers reloads).
  useEffect(() => {
    if ((location.state as { resumeBuilderImport?: unknown } | null)?.resumeBuilderImport) {
      navigate(location.pathname + location.search, { replace: true, state: null });
    }
  }, [location, navigate]);

  const isDirty = useMemo(
    () => baseline !== null && serializeEditorState(resume, formatting) !== baseline,
    [baseline, resume, formatting],
  );

  // Autosave edits to this tab's draft; drop the draft once nothing is unsaved.
  // Paused while an older draft is waiting for Restore or Discard.
  useEffect(() => {
    if (!draftKey || baseline === null || pendingDraft) return;

    if (!isDirty) {
      clearDraft(draftKey);
      return;
    }

    writeDraft(draftKey, { resume, formatting, savedVersion, savedAt: new Date().toISOString() });
  }, [draftKey, baseline, pendingDraft, isDirty, resume, formatting, savedVersion]);

  // Warn before leaving with unsaved changes: reloads and closing the tab, and
  // in-app links (the sidebar). The draft above covers the browser Back button.
  useEffect(() => {
    if (!isDirty) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    const handleLinkClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const link = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return;

      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;

      if (!window.confirm(LEAVE_MESSAGE)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('click', handleLinkClick, true);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('click', handleLinkClick, true);
    };
  }, [isDirty]);

  const leaveTo = (path: string) => {
    if (isDirty && !window.confirm(LEAVE_MESSAGE)) return;
    navigate(path);
  };

  const handleRestoreDraft = () => {
    if (!pendingDraft) return;

    setResume(pendingDraft.resume);
    setFormatting(pendingDraft.formatting);
    if (pendingDraft.savedVersion) setSavedVersion(pendingDraft.savedVersion);
    setPendingDraft(null);
  };

  const handleDiscardDraft = () => {
    if (draftKey) clearDraft(draftKey);
    setPendingDraft(null);
  };

  const flash = (msg: string) => { setSavedMsg(msg); setTimeout(() => setSavedMsg(''), 3000); };

  // Runs a PDF/DOCX export and reports failures in the page instead of a pop-up.
  const runExport = async (kind: 'pdf' | 'docx', task: () => Promise<void>) => {
    setError('');
    setExporting(kind);
    try {
      await task();
    } catch (err) {
      setError(
        err instanceof ExportToolError
          ? err.message
          : `The ${kind.toUpperCase()} file couldn't be created. Please try again.`,
      );
    } finally {
      setExporting(null);
    }
  };

  const handleSave = async (asNew = false) => {
    try {
      setSaving(true); setError('');
      if (!plainText.trim()) throw new Error('Resume is empty.');
      const { data: { user }, error: ue } = await supabase.auth.getUser();
      if (ue || !user) throw new Error('Not logged in.');

      // What is being saved; edits made while the save is in flight stay unsaved.
      const savingSnapshot = serializeEditorState(resume, formatting);

      // A saved version opened on its own has no analysis loaded, so keep the
      // links it already has.
      const sourceAnalysisId = analysis?.id ?? savedVersion?.sourceAnalysisId ?? null;
      const sourceCvVersionId = analysis?.cv_version_id ?? savedVersion?.sourceCvVersionId ?? null;
      const companyName = analysis?.company_name ?? savedVersion?.companyName ?? null;
      const savedAt = new Date().toISOString();
      const targetRole = jobTitle || resume.personal.jobTitle || null;

      const builderPayload = {
        source: 'resume_builder',
        builder_state: resume,
        formatting,
        source_analysis_id: sourceAnalysisId,
        source_cv_version_id: sourceCvVersionId,
        job_title: targetRole,
        company_name: companyName,
        saved_at: savedAt,
      };
      const contents = {
        target_role: targetRole,
        cv_text: plainText,
        structured_cv: builderPayload,
        cv_suggestions: {
          builder_state: resume,
          formatting,
          source_analysis_id: sourceAnalysisId,
          source_cv_version_id: sourceCvVersionId,
        },
      };

      if (savedVersion && !asNew) {
        const { data: updated, error: updateError } = await supabase
          .from('cv_versions')
          .update({
            ...contents,
            ...(analysis ? { last_score: analysis.score || null, last_analyzed_at: savedAt } : {}),
          })
          .eq('id', savedVersion.id)
          .eq('user_id', user.id)
          .select('id');
        if (updateError) throw updateError;
        if (!updated?.length) {
          throw new Error('This CV version no longer exists in CV Manager. Use "Save as new" to keep your changes.');
        }
        setBaseline(savingSnapshot);
        flash(`Saved changes to "${savedVersion.name}".`);
        return;
      }

      const name = `${jobTitle || resume.personal.fullName || 'Optimized CV'} — Builder`;
      const { data: created, error: ie } = await supabase
        .from('cv_versions')
        .insert({
          user_id: user.id,
          name,
          ...contents,
          last_score: analysis?.score || null,
          last_analyzed_at: savedAt,
          source_analysis_id: sourceAnalysisId,
          parent_cv_version_id: sourceCvVersionId,
        })
        .select('id, name')
        .single();
      if (ie) throw ie;

      setSavedVersion({
        id: created.id,
        name: created.name || name,
        sourceAnalysisId,
        sourceCvVersionId,
        companyName,
      });
      setBaseline(savingSnapshot);
      flash('Saved as a new CV version in CV Manager.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to save.'); }
    finally { setSaving(false); }
  };

  const handleUseSettingsProfile = () => {
    setResume((current) => ({
      ...current,
      personal: mergeProfileDefaultsIntoPersonal(
        current.personal,
        profileDefaults,
        true,
      ),
    }));

    flash('Personal information updated from Settings.');
  };

  const handleImproveBulletsWithJD = () => {
    if (!analysis) {
      flash('Open this builder from a CV analysis to use JD-aware bullet improvement.');
      return;
    }

    const tailored = optimizeResumeForJob({ resume, analysis });

    setQualityReport(tailored.qualityReport);
    setClaimableGaps(tailored.claimableGaps ?? []);

    // Extract the summary change (if any) so the user can review it separately
    const summaryChange = tailored.changes.find(
      (change) =>
        change.type === 'summary_tailored' &&
        change.section === 'summary' &&
        change.before?.trim() !== change.after?.trim() &&
        Boolean(change.after?.trim()),
    ) ?? null;

    const reviewItems: BulletReviewItem[] = tailored.changes
      .filter(isReviewableBulletChange)
      .map((change, index) => ({
        id: `${change.roleId ?? 'role'}-${change.bulletIndex ?? index}-${index}`,
        accepted: true,
        roleId: change.roleId,
        roleTitle: change.roleTitle,
        company: change.company,
        bulletIndex: change.bulletIndex,
        before: change.before,
        after: change.after,
        reason: change.reason,
        changeType: change.type,
        riskLevel: change.riskLevel,
        evidenceSource: change.evidenceSource,
        jdSignal: change.jdSignal,
        jdSignalStrength: change.jdSignalStrength,
      }));

    const nextSkillReviewItems: SkillReviewItem[] = tailored.changes
      .filter(
        (change) =>
          change.section === 'skillsAwards' &&
          change.type === 'skill_review_needed' &&
          change.riskLevel !== 'not_recommended',
      )
      .map((change, index) => ({
        id: `skill-${change.type}-${index}`,
        type: change.type,
        label: change.after || change.before || 'Skill change',
        before: change.before,
        after: change.after,
        reason: change.reason,
        riskLevel: change.riskLevel,
        requiresReview: change.requiresReview,
      }));

    setSkillReviewItems(nextSkillReviewItems);

    const safeSkillUpdates = tailored.changes.filter(
      (change) =>
        change.section === 'skillsAwards' &&
        change.type === 'technical_skill_added' &&
        !change.requiresReview,
    ).length;

    const reviewNeededCount = nextSkillReviewItems.filter((item) => item.requiresReview).length;

    if (!reviewItems.length && !safeSkillUpdates && !reviewNeededCount && !(tailored.claimableGaps ?? []).length) {
      flash('No safe JD improvements were found from the current Master CV evidence. CV Quality Report updated.');
      return;
    }

    if (!reviewItems.length && (safeSkillUpdates || reviewNeededCount)) {
      setResume(tailored.resume);
      setOriginalResume(tailored.resume);

      const parts = [
        safeSkillUpdates ? `${safeSkillUpdates} matched skill item(s)` : '',
        reviewNeededCount ? `${reviewNeededCount} skill item(s) flagged for review` : '',
      ].filter(Boolean);

      flash(`${parts.join(' and ')} updated. CV Quality Report is ready.`);
      return;
    }

    setBulletReviewResume(tailored.resume);
    setBulletReviewItems(reviewItems);
    setSummaryReviewChange(summaryChange);
    setSummaryReviewAccepted(true);
    setBulletReviewOpen(true);

    flash(`${reviewItems.length} JD improvement(s) ready for review. CV Quality Report is ready.`);
  };

  const toggleBulletReviewItem = (id: string) => {
    setBulletReviewItems((items) =>
      items.map((item) =>
        item.id === id ? { ...item, accepted: !item.accepted } : item,
      ),
    );
  };

  const setAllBulletReviewItems = (accepted: boolean) => {
    setBulletReviewItems((items) => items.map((item) => ({ ...item, accepted })));
  };

  const applySelectedBulletImprovements = () => {
    if (!bulletReviewResume) {
      setBulletReviewOpen(false);
      return;
    }

    const acceptedCount = bulletReviewItems.filter((item) => item.accepted).length;

    if (!acceptedCount) {
      setBulletReviewOpen(false);
      flash('No JD improvements were applied.');
      return;
    }

    const rejectedItems = bulletReviewItems.filter((item) => !item.accepted);

    const nextResume: ResumeBuilderState = {
      ...bulletReviewResume,
      experience: bulletReviewResume.experience.map((role) => {
        const rejectedForRole = rejectedItems.filter(
          (item) => item.roleId === role.id,
        );

        if (!rejectedForRole.length) return role;

        const currentRole = resume.experience.find((item) => item.id === role.id);

        return {
          ...role,
          bullets: role.bullets.map((bullet, index) => {
            const rejected = rejectedForRole.find(
              (item) => item.bulletIndex === index,
            );

            if (!rejected) return bullet;

            const originalAtIndex = currentRole?.bullets?.[index];

            return originalAtIndex || rejected.before || bullet;
          }),
        };
      }),
    };

    const rejectedCount = bulletReviewItems.length - acceptedCount;

    // If the user rejected the summary rewrite, restore the original summary
    const finalSummary =
      summaryReviewChange && !summaryReviewAccepted
        ? summaryReviewChange.before ?? nextResume.summary
        : nextResume.summary;

    setResume({ ...nextResume, summary: finalSummary ?? nextResume.summary });
    setOriginalResume({ ...nextResume, summary: finalSummary ?? nextResume.summary });
    setBulletReviewOpen(false);
    setBulletReviewResume(null);
    setBulletReviewItems([]);
    setSummaryReviewChange(null);

    setLastImprovementStats({
      acceptedCount,
      rejectedCount,
      totalCount: bulletReviewItems.length,
    });
    setFeedbackOpen(true);

    flash(`Applied ${acceptedCount} reviewed JD improvement(s).`);
  };

  const closeBulletReview = () => {
    setBulletReviewOpen(false);
    setBulletReviewResume(null);
    setBulletReviewItems([]);
    setSummaryReviewChange(null);
  };

  const submitImprovementFeedback = async (
    rating: 'accurate' | 'partly' | 'inaccurate',
  ) => {
    try {
      setFeedbackSaving(true);
      setError('');

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        throw new Error('You must be logged in to submit feedback.');
      }

      const { error: insertError } = await supabase
        .from('resume_improvement_feedback')
        .insert({
          user_id: user.id,
          analysis_id: analysis?.id ?? null,
          cv_version_id: analysis?.cv_version_id ?? null,
          improvement_type: 'experience_bullets',
          rating,
          feedback_text: feedbackText.trim() || null,
          accepted_count: lastImprovementStats.acceptedCount,
          rejected_count: lastImprovementStats.rejectedCount,
          total_count: lastImprovementStats.totalCount,
          metadata: {
            job_title: analysis?.job_title ?? resume.personal.jobTitle ?? null,
            company_name: analysis?.company_name ?? null,
            score: analysis?.score ?? null,
            accepted_count: lastImprovementStats.acceptedCount,
            rejected_count: lastImprovementStats.rejectedCount,
            total_count: lastImprovementStats.totalCount,
            quality_score: qualityReport?.score ?? null,
            quality_passed: qualityReport?.passed ?? null,
            quality_issue_categories: qualityReport?.issues.map((issue) => issue.category) ?? [],
          },
        });

      if (insertError) throw insertError;

      setFeedbackOpen(false);
      setFeedbackText('');

      flash('Thanks. Your feedback was saved.');
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to save improvement feedback.',
      );
    } finally {
      setFeedbackSaving(false);
    }
  };

  // State updaters
  const upPersonal = (key: keyof PersonalInfo, value: string) => setResume(p => ({ ...p, personal: { ...p.personal, [key]: value } }));
  const toggleVis = (key: keyof SectionVisibility) => setResume(p => ({ ...p, sectionVisibility: { ...p.sectionVisibility, [key]: !p.sectionVisibility[key] } }));
  const upExp = (id: string, patch: Partial<ExperienceItem>) => setResume(p => ({ ...p, experience: p.experience.map(i => i.id === id ? { ...i, ...patch } : i) }));
  const addExp = () => setResume(p => ({ ...p, experience: [...p.experience, { id: uid(), jobTitle: '', company: '', location: '', years: '', bullets: [''] }] }));
  const delExp = (id: string) => setResume(p => ({ ...p, experience: p.experience.filter(i => i.id !== id) }));
  const upExpBullet = (id: string, idx: number, val: string) => setResume(p => ({ ...p, experience: p.experience.map(i => i.id === id ? { ...i, bullets: i.bullets.map((b, n) => n === idx ? val : b) } : i) }));
  const addExpBullet = (id: string) => setResume(p => ({ ...p, experience: p.experience.map(i => i.id === id ? { ...i, bullets: [...i.bullets, ''] } : i) }));
  const delExpBullet = (id: string, idx: number) => setResume(p => ({ ...p, experience: p.experience.map(i => i.id === id ? { ...i, bullets: i.bullets.filter((_, n) => n !== idx) } : i) }));
  const upEdu = (id: string, patch: Partial<EducationItem>) => setResume(p => ({ ...p, education: p.education.map(i => i.id === id ? { ...i, ...patch } : i) }));
  const addEdu = () => setResume(p => ({ ...p, education: [...p.education, { id: uid(), institution: '', degree: '', years: '', description: '' }] }));
  const delEdu = (id: string) => setResume(p => ({ ...p, education: p.education.filter(i => i.id !== id) }));
  const upProj = (id: string, patch: Partial<ProjectItem>) => setResume(p => ({ ...p, projects: p.projects.map(i => i.id === id ? { ...i, ...patch } : i) }));
  const addProj = () => setResume(p => ({ ...p, projects: [...p.projects, { id: uid(), name: '', role: '', years: '', link: '', bullets: [''] }] }));
  const delProj = (id: string) => setResume(p => ({ ...p, projects: p.projects.filter(i => i.id !== id) }));
  const upProjBullet = (id: string, idx: number, val: string) => setResume(p => ({ ...p, projects: p.projects.map(i => i.id === id ? { ...i, bullets: i.bullets.map((b, n) => n === idx ? val : b) } : i) }));
  const addProjBullet = (id: string) => setResume(p => ({ ...p, projects: p.projects.map(i => i.id === id ? { ...i, bullets: [...i.bullets, ''] } : i) }));
  const delProjBullet = (id: string, idx: number) => setResume(p => ({ ...p, projects: p.projects.map(i => i.id === id ? { ...i, bullets: i.bullets.filter((_, n) => n !== idx) } : i) }));
  const upSkills = (key: keyof SkillsAwards, val: string) => setResume(p => ({ ...p, skillsAwards: { ...p.skillsAwards, [key]: val } }));
  const addCustom = (s: CustomSection) => setResume(p => ({ ...p, customSections: [...p.customSections, s] }));
  const upCustom = (id: string, patch: Partial<CustomSection>) => setResume(p => ({ ...p, customSections: p.customSections.map(s => s.id === id ? { ...s, ...patch } : s) }));
  const delCustom = (id: string) => setResume(p => ({ ...p, customSections: p.customSections.filter(s => s.id !== id) }));

  if (loading) return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="flex items-center gap-3 text-slate-500">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-sm">Loading Resume Builder...</span>
      </div>
    </div>
  );

  if (loadError && !analysis && (analysisId || cvVersionId)) return (
    <div className="max-w-lg">
      <button onClick={() => navigate(-1)} className="mb-6 inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900">
        <ArrowLeft size={16} />Back
      </button>
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6">
        <h2 className="font-semibold text-red-700 mb-2">Resume Builder Error</h2>
        <p className="text-sm text-red-600">{loadError}</p>
      </div>
    </div>
  );

  return (
    <div>
      {/* Page header — matches JTracker page pattern */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <button onClick={() => leaveTo('/cv-manager')} className="mb-2 inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900 transition">
            <ArrowLeft size={15} />Back to CV Manager
          </button>
          <h1 className="text-2xl font-bold text-slate-900">Resume Builder</h1>
          {savedVersion && (
            <p className="text-sm text-slate-500 mt-1">
              Editing <span className="font-medium text-slate-700">{savedVersion.name}</span>
            </p>
          )}
          {analysis && (
            <p className="text-sm text-slate-500 mt-1">
              Based on analysis for{' '}
              <span className="font-medium text-slate-700">{jobTitle || 'target role'}</span>
              {analysis.score != null && <span className="ml-2 text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">Score: {analysis.score}/100</span>}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => { setResume(originalResume); setFormatting(defaultFormatting); setQualityReport(null); setSkillReviewItems([]); setClaimableGaps([]); flash('Reset to original.'); }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 transition">
            <RefreshCcw size={15} />Reset
          </button>
          <button onClick={() => runExport('pdf', () => exportAsPDF(resume, formatting, jobTitle, `${fileBase}.pdf`))}
            disabled={exporting !== null}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 transition disabled:opacity-50">
            {exporting === 'pdf' ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}PDF
          </button>
          <button onClick={() => runExport('docx', () => exportAsDOCX(resume, jobTitle, `${fileBase}.docx`))}
            disabled={exporting !== null}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 transition disabled:opacity-50">
            {exporting === 'docx' ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}ATS DOCX
          </button>
          {isDirty && (
            <span className="self-center text-xs font-medium text-amber-600">Unsaved changes</span>
          )}
          {savedVersion && (
            <button onClick={() => handleSave(true)} disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 transition disabled:opacity-50">
              <Plus size={15} />Save as new
            </button>
          )}
          <button onClick={() => handleSave()} disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 transition disabled:opacity-50">
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            {saving ? 'Saving...' : savedVersion ? 'Save changes' : 'Save to CV Manager'}
          </button>
        </div>
      </div>

      {pendingDraft && (
        <div className="mb-4 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 sm:flex-row sm:items-center sm:justify-between">
          <p>
            You have unsaved changes to this CV from {formatDraftTime(pendingDraft.savedAt)} that were not saved to CV Manager.
          </p>
          <div className="flex shrink-0 gap-2">
            <button onClick={handleDiscardDraft}
              className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100 transition">
              Discard
            </button>
            <button onClick={handleRestoreDraft}
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 transition">
              Restore changes
            </button>
          </div>
        </div>
      )}

      {savedMsg && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
          ✓ {savedMsg}
        </div>
      )}
      {(error || loadError) && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error || loadError}
        </div>
      )}

      {qualityReport && (
        <CVReadinessCard
          report={qualityReport}
          skillReviewItems={skillReviewItems}
          claimableGaps={claimableGaps}
          onDismiss={() => {
            setQualityReport(null);
            setSkillReviewItems([]);
            setClaimableGaps([]);
          }}
        />
      )}

      {/* Mobile tab switcher */}
      <div className="flex xl:hidden mb-4 rounded-xl border border-slate-200 bg-white overflow-hidden">
        <button onClick={() => setActiveTab('editor')} className={`flex-1 py-2.5 text-sm font-medium transition ${activeTab === 'editor' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
          Editor
        </button>
        <button onClick={() => setActiveTab('preview')} className={`flex-1 py-2.5 text-sm font-medium transition ${activeTab === 'preview' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
          Preview
        </button>
      </div>

      {/* Main grid */}
      {feedbackOpen && (
        <div className="mb-4 rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
            <div className="flex-1">
              <h3 className="font-semibold text-indigo-900">
                Were these JD improvements accurate?
              </h3>

              <p className="text-sm text-indigo-700 mt-1">
                You applied {lastImprovementStats.acceptedCount} of{' '}
                {lastImprovementStats.totalCount} suggested improvement(s).
                Your feedback helps JTracker improve future bullet rewrites.
              </p>

              <textarea
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                rows={2}
                placeholder="Optional: what should be improved?"
                className="mt-3 w-full rounded-xl border border-indigo-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
            </div>

            <div className="flex flex-wrap gap-2 lg:justify-end">
              <button
                type="button"
                disabled={feedbackSaving}
                onClick={() => submitImprovementFeedback('accurate')}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                Yes, accurate
              </button>

              <button
                type="button"
                disabled={feedbackSaving}
                onClick={() => submitImprovementFeedback('partly')}
                className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
              >
                Partly
              </button>

              <button
                type="button"
                disabled={feedbackSaving}
                onClick={() => submitImprovementFeedback('inaccurate')}
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                No, inaccurate
              </button>

              <button
                type="button"
                disabled={feedbackSaving}
                onClick={() => setFeedbackOpen(false)}
                className="rounded-xl border border-indigo-200 bg-white px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
              >
                Later
              </button>
            </div>
          </div>
        </div>
      )}


      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_560px] gap-6 items-start">

        {/* EDITOR PANEL */}
        <div className={`space-y-4 xl:max-h-[calc(100vh-180px)] xl:overflow-y-auto xl:pr-2 xl:pb-8 ${activeTab === 'preview' ? 'hidden xl:block' : ''}`}>

          <EditorCard title="Template & Formatting" collapsed={collapsed.formatting} onToggle={() => setCollapsed(p => ({ ...p, formatting: !p.formatting }))}>
            <FormattingPanel formatting={formatting} onChange={setFormatting} />
          </EditorCard>

          <EditorCard
            title="Personal Information"
            collapsed={collapsed.personal}
            onToggle={() => setCollapsed(p => ({ ...p, personal: !p.personal }))}
            visible={resume.sectionVisibility.personal}
            onToggleVisible={() => toggleVis('personal')}
            action={
              <button
                type="button"
                onClick={handleUseSettingsProfile}
                className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              >
                Use Settings Profile
              </button>
            }
          >
            <PersonalEditor personal={resume.personal} onChange={upPersonal} />
          </EditorCard>

          <EditorCard title="Professional Summary" collapsed={collapsed.summary} onToggle={() => setCollapsed(p => ({ ...p, summary: !p.summary }))} visible={resume.sectionVisibility.summary} onToggleVisible={() => toggleVis('summary')}>
            <TextareaField label="Summary" value={resume.summary} onChange={val => setResume(p => ({ ...p, summary: val }))} rows={5} />
          </EditorCard>

          <EditorCard title="Experience" collapsed={collapsed.experience} onToggle={() => setCollapsed(p => ({ ...p, experience: !p.experience }))} visible={resume.sectionVisibility.experience} onToggleVisible={() => toggleVis('experience')}
            action={
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleImproveBulletsWithJD}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 text-xs font-medium text-indigo-700 hover:bg-indigo-100 transition"
                >
                  <Sparkles size={13} />Improve with JD
                </button>
                <AddBtn onClick={addExp} label="Add Role" />
              </div>
            }>
            <ExperienceEditor items={resume.experience} onUpdate={upExp} onRemove={delExp} onAddBullet={addExpBullet} onUpdateBullet={upExpBullet} onRemoveBullet={delExpBullet} />
          </EditorCard>

          <EditorCard title="Education" collapsed={collapsed.education} onToggle={() => setCollapsed(p => ({ ...p, education: !p.education }))} visible={resume.sectionVisibility.education} onToggleVisible={() => toggleVis('education')}
            action={<AddBtn onClick={addEdu} label="Add School" />}>
            <EducationEditor items={resume.education} onUpdate={upEdu} onRemove={delEdu} />
          </EditorCard>

          <EditorCard title="Projects" collapsed={collapsed.projects} onToggle={() => setCollapsed(p => ({ ...p, projects: !p.projects }))} visible={resume.sectionVisibility.projects} onToggleVisible={() => toggleVis('projects')}
            action={<AddBtn onClick={addProj} label="Add Project" />}>
            <ProjectsEditor items={resume.projects} onUpdate={upProj} onRemove={delProj} onAddBullet={addProjBullet} onUpdateBullet={upProjBullet} onRemoveBullet={delProjBullet} />
          </EditorCard>

          <EditorCard title="Skills & Awards" collapsed={collapsed.skillsAwards} onToggle={() => setCollapsed(p => ({ ...p, skillsAwards: !p.skillsAwards }))} visible={resume.sectionVisibility.skillsAwards} onToggleVisible={() => toggleVis('skillsAwards')}>
            <SkillsAwardsEditor skillsAwards={resume.skillsAwards} onChange={upSkills} />
          </EditorCard>

          {resume.customSections.map(section => (
            <EditorCard key={section.id} title={section.title} collapsed={section.collapsed} onToggle={() => upCustom(section.id, { collapsed: !section.collapsed })}
              visible={section.visible} onToggleVisible={() => upCustom(section.id, { visible: !section.visible })} onDelete={() => delCustom(section.id)}>
              <CustomSectionEditor section={section} onChange={patch => upCustom(section.id, patch)} />
            </EditorCard>
          ))}

          <button type="button" onClick={() => setShowCustomModal(true)}
            className="w-full border-2 border-dashed border-slate-200 rounded-xl py-4 text-sm font-medium text-slate-500 hover:border-slate-400 hover:text-slate-700 hover:bg-white transition inline-flex items-center justify-center gap-2">
            <Plus size={16} />Add Custom Section
          </button>
        </div>

        {/* PREVIEW PANEL */}
        <div className={`${activeTab === 'editor' ? 'hidden xl:block' : ''}`}>
          <div className="xl:sticky xl:top-6">
            <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
              <div className="border-b border-slate-200 px-5 py-3 flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-700">Live Preview</span>
                <span className="text-xs text-slate-400">{formatting.pageSize === 'a4' ? 'A4' : 'US Letter'}</span>
              </div>
              <div className="p-5 bg-slate-50 xl:max-h-[calc(100vh-240px)] overflow-y-auto flex justify-center">
                <ResumePreview resume={resume} formatting={formatting} jobTitle={jobTitle} />
              </div>
            </div>

            {/* Plain text preview */}
            <details className="mt-4 rounded-xl border border-slate-200 bg-white overflow-hidden">
              <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-slate-600 hover:text-slate-900">
                Plain text (ATS view)
              </summary>
              <pre className="px-5 pb-4 text-xs text-slate-600 whitespace-pre-wrap font-mono leading-relaxed max-h-40 overflow-y-auto">
                {plainText || 'Start filling in your details to see the output.'}
              </pre>
            </details>
          </div>
        </div>
      </div>

      {bulletReviewOpen && (
        <BulletImprovementReviewModal
          items={bulletReviewItems}
          onToggle={toggleBulletReviewItem}
          onAcceptAll={() => setAllBulletReviewItems(true)}
          onRejectAll={() => setAllBulletReviewItems(false)}
          onApply={applySelectedBulletImprovements}
          onClose={closeBulletReview}
          summaryChange={summaryReviewChange}
          summaryAccepted={summaryReviewAccepted}
          onToggleSummary={() => setSummaryReviewAccepted((v) => !v)}
        />
      )}

      {showCustomModal && (
        <CustomSectionModal onClose={() => setShowCustomModal(false)} onAdd={s => { addCustom(s); setShowCustomModal(false); }} />
      )}
    </div>
  );
};

// ============================================================
// EDITOR CARD — matches JTracker card style
// ============================================================
const EditorCard: React.FC<{
  title: string; children: React.ReactNode; collapsed?: boolean;
  onToggle?: () => void; visible?: boolean; onToggleVisible?: () => void;
  onDelete?: () => void; action?: React.ReactNode;
}> = ({ title, children, collapsed, onToggle, visible = true, onToggleVisible, onDelete, action }) => (
  <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
    <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100">
      <div className="flex items-center gap-2">
        <GripVertical size={14} className="text-slate-300" />
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      </div>
      <div className="flex items-center gap-1">
        {action}
        {onToggleVisible && (
          <button type="button" onClick={onToggleVisible} className="p-1.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition">
            {visible ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>
        )}
        {onDelete && (
          <button type="button" onClick={onDelete} className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 transition">
            <Trash2 size={14} />
          </button>
        )}
        {onToggle && (
          <button type="button" onClick={onToggle} className="p-1.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition">
            {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
        )}
      </div>
    </div>
    {!collapsed && <div className="p-5">{children}</div>}
  </div>
);

// ============================================================
// FORM PRIMITIVES — matches JTracker input style
// ============================================================
const inputCls = 'border border-slate-200 rounded-lg px-3 py-2 text-sm w-full bg-white focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-transparent placeholder:text-slate-400 transition';
const labelCls = 'block text-xs font-medium text-slate-500 mb-1.5';

const Field: React.FC<{ label: string; value: string; onChange: (v: string) => void; placeholder?: string }> = ({ label, value, onChange, placeholder }) => (
  <label className="block">
    <span className={labelCls}>{label}</span>
    <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={inputCls} />
  </label>
);

const TextareaField: React.FC<{ label: string; value: string; onChange: (v: string) => void; rows?: number; placeholder?: string }> = ({ label, value, onChange, rows = 4, placeholder }) => (
  <label className="block">
    <span className={labelCls}>{label}</span>
    <textarea value={value} onChange={e => onChange(e.target.value)} rows={rows} placeholder={placeholder}
      className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-full bg-white focus:outline-none focus:ring-2 focus:ring-slate-400 placeholder:text-slate-400 transition resize-y" />
  </label>
);

const AddBtn: React.FC<{ label: string; onClick: () => void }> = ({ label, onClick }) => (
  <button type="button" onClick={onClick} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 transition">
    <Plus size={13} />{label}
  </button>
);

const StepSelector: React.FC<{ label: string; value: number; onChange: (v: number) => void }> = ({ label, value, onChange }) => (
  <div className="flex items-center gap-3 mb-3">
    <span className="text-xs text-slate-600 w-20">{label}</span>
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map(step => (
        <button key={step} type="button" onClick={() => onChange(step)}
          className={`h-7 w-7 rounded text-xs font-semibold border transition ${value === step ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400'}`}>
          {step}
        </button>
      ))}
    </div>
  </div>
);

const FontChoice: React.FC<{ label: string; value: FontFamily; onChange: (v: FontFamily) => void }> = ({ label, value, onChange }) => (
  <div className="flex items-center gap-3 mb-3">
    <span className="text-xs text-slate-600 w-20">{label}</span>
    <div className="flex flex-wrap gap-1">
      {([
        ['serif', 'Serif ★', 'Highly recommended for traditional job application CVs'],
        ['sans', 'Sans', 'Clean modern CV text'],
        ['mono', 'Mono', 'Technical monospace text'],
      ] as const).map(([id, labelText, hint]) => (
        <button
          key={id}
          type="button"
          title={hint}
          onClick={() => onChange(id)}
          className={`px-3 h-7 rounded text-xs font-semibold border transition ${value === id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400'}`}
        >
          {labelText}
        </button>
      ))}
    </div>
  </div>
);

// ============================================================
// FORMATTING PANEL
// ============================================================
const FormattingPanel: React.FC<{ formatting: FormattingSettings; onChange: React.Dispatch<React.SetStateAction<FormattingSettings>> }> = ({ formatting, onChange }) => (
  <div className="space-y-5">
    <div>
      <span className={labelCls}>Template</span>
      <div className="grid grid-cols-2 gap-2">
        {templateOptions.map(o => (
          <button key={o.id} type="button" onClick={() => onChange(p => ({ ...p, template: o.id }))}
            className={`border rounded-lg p-3 text-left transition ${formatting.template === o.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white hover:border-slate-400'}`}>
            <div className="flex items-center gap-2 mb-1"><FileText size={14} /><span className="text-xs font-semibold">{o.label}</span></div>
            <p className={`text-xs ${formatting.template === o.id ? 'text-slate-300' : 'text-slate-400'}`}>{o.description}</p>
          </button>
        ))}
      </div>
    </div>
    <div>
      <span className={labelCls}>Page Size</span>
      <div className="flex gap-2">
        {(['a4', 'letter'] as const).map(size => (
          <button key={size} type="button" onClick={() => onChange(p => ({ ...p, pageSize: size }))}
            className={`flex-1 py-2 rounded-lg border text-xs font-medium transition ${formatting.pageSize === size ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400'}`}>
            {size === 'a4' ? 'A4' : 'US Letter'}
          </button>
        ))}
      </div>
    </div>
    <div>
      <span className={labelCls}>Spacing</span>
      <StepSelector label="Sections" value={formatting.spacing.section} onChange={v => onChange(p => ({ ...p, spacing: { ...p.spacing, section: v } }))} />
      <StepSelector label="Items" value={formatting.spacing.item} onChange={v => onChange(p => ({ ...p, spacing: { ...p.spacing, item: v } }))} />
      <StepSelector label="Lines" value={formatting.spacing.line} onChange={v => onChange(p => ({ ...p, spacing: { ...p.spacing, line: v } }))} />
    </div>
    <div>
      <span className={labelCls}>Font Size</span>
      <StepSelector label="Body" value={formatting.fontSize.base} onChange={v => onChange(p => ({ ...p, fontSize: { ...p.fontSize, base: v } }))} />
      <StepSelector label="Headers" value={formatting.fontSize.headers} onChange={v => onChange(p => ({ ...p, fontSize: { ...p.fontSize, headers: v } }))} />
    </div>
    <div>
      <span className={labelCls}>Text Type</span>
      <p className="text-xs text-slate-400 mb-2">Serif is highly recommended for traditional job application CVs.</p>
      <FontChoice label="Headers" value={formatting.fonts.header} onChange={v => onChange(p => ({ ...p, fonts: { ...p.fonts, header: v } }))} />
      <FontChoice label="Body" value={formatting.fonts.body} onChange={v => onChange(p => ({ ...p, fonts: { ...p.fonts, body: v } }))} />
    </div>
    <div className="flex items-center gap-3">
      <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
        <input type="checkbox" checked={formatting.compactMode} onChange={e => onChange(p => ({ ...p, compactMode: e.target.checked }))} className="rounded" />
        Compact mode
      </label>
    </div>
  </div>
);

// ============================================================
// SECTION EDITORS
// ============================================================
const PersonalEditor: React.FC<{ personal: PersonalInfo; onChange: (k: keyof PersonalInfo, v: string) => void }> = ({ personal, onChange }) => (
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
    <Field label="Full Name" value={personal.fullName} onChange={v => onChange('fullName', v)} />
    <Field label="Job Title" value={personal.jobTitle} onChange={v => onChange('jobTitle', v)} />
    <Field label="Email" value={personal.email} onChange={v => onChange('email', v)} />
    <Field label="Phone" value={personal.phone} onChange={v => onChange('phone', v)} />
    <Field label="Location" value={personal.location} onChange={v => onChange('location', v)} placeholder="City, Country" />
    <Field label="LinkedIn" value={personal.linkedin} onChange={v => onChange('linkedin', v)} />
    <Field label="Portfolio / Website" value={personal.website} onChange={v => onChange('website', v)} />
    <Field label="GitHub" value={personal.github} onChange={v => onChange('github', v)} />
  </div>
);

const ExperienceEditor: React.FC<{
  items: ExperienceItem[]; onUpdate: (id: string, p: Partial<ExperienceItem>) => void; onRemove: (id: string) => void;
  onAddBullet: (id: string) => void; onUpdateBullet: (id: string, i: number, v: string) => void; onRemoveBullet: (id: string, i: number) => void;
}> = ({ items, onUpdate, onRemove, onAddBullet, onUpdateBullet, onRemoveBullet }) => !items.length
  ? <EmptyBlock text="No experience entries yet. Click Add Role above." />
  : <div className="space-y-4">
    {items.map(item => (
      <div key={item.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <div className="flex justify-end mb-3">
          <button type="button" onClick={() => onRemove(item.id)} className="text-slate-400 hover:text-red-500 transition"><Trash2 size={15} /></button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <Field label="Job Title" value={item.jobTitle} onChange={v => onUpdate(item.id, { jobTitle: v })} />
          <Field label="Company" value={item.company} onChange={v => onUpdate(item.id, { company: v })} />
          <Field label="Location" value={item.location} onChange={v => onUpdate(item.id, { location: v })} />
          <Field label="Period" value={item.years} onChange={v => onUpdate(item.id, { years: v })} placeholder="Jan 2022 – Present" />
        </div>
        <div className="flex items-center justify-between mb-2">
          <span className={labelCls}>Bullet Points</span>
          <button type="button" onClick={() => onAddBullet(item.id)} className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium">
            <Plus size={12} />Add point
          </button>
        </div>
        <div className="space-y-2">
          {item.bullets.map((bullet, idx) => (
            <div key={idx} className="flex gap-2">
              <textarea value={bullet} onChange={e => onUpdateBullet(item.id, idx, e.target.value)} rows={2}
                className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-full bg-white focus:outline-none focus:ring-2 focus:ring-slate-400 resize-y" />
              <button type="button" onClick={() => onRemoveBullet(item.id, idx)} className="text-slate-300 hover:text-red-500 transition flex-shrink-0 mt-1"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      </div>
    ))}
  </div>;

const EducationEditor: React.FC<{ items: EducationItem[]; onUpdate: (id: string, p: Partial<EducationItem>) => void; onRemove: (id: string) => void }> =
  ({ items, onUpdate, onRemove }) => !items.length
    ? <EmptyBlock text="No education entries yet. Click Add School above." />
    : <div className="space-y-4">
      {items.map(item => (
        <div key={item.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="flex justify-end mb-3"><button type="button" onClick={() => onRemove(item.id)} className="text-slate-400 hover:text-red-500 transition"><Trash2 size={15} /></button></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <Field label="Institution" value={item.institution} onChange={v => onUpdate(item.id, { institution: v })} />
            <Field label="Degree" value={item.degree} onChange={v => onUpdate(item.id, { degree: v })} />
            <Field label="Years" value={item.years} onChange={v => onUpdate(item.id, { years: v })} />
          </div>
          <TextareaField label="Description (optional)" value={item.description} onChange={v => onUpdate(item.id, { description: v })} rows={2} />
        </div>
      ))}
    </div>;

const ProjectsEditor: React.FC<{
  items: ProjectItem[]; onUpdate: (id: string, p: Partial<ProjectItem>) => void; onRemove: (id: string) => void;
  onAddBullet: (id: string) => void; onUpdateBullet: (id: string, i: number, v: string) => void; onRemoveBullet: (id: string, i: number) => void;
}> = ({ items, onUpdate, onRemove, onAddBullet, onUpdateBullet, onRemoveBullet }) => !items.length
  ? <EmptyBlock text="No project entries yet." />
  : <div className="space-y-4">
    {items.map(item => (
      <div key={item.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <div className="flex justify-end mb-3"><button type="button" onClick={() => onRemove(item.id)} className="text-slate-400 hover:text-red-500 transition"><Trash2 size={15} /></button></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <Field label="Project Name" value={item.name} onChange={v => onUpdate(item.id, { name: v })} />
          <Field label="Role / Tech" value={item.role} onChange={v => onUpdate(item.id, { role: v })} />
          <Field label="Years" value={item.years} onChange={v => onUpdate(item.id, { years: v })} />
          <Field label="Link" value={item.link} onChange={v => onUpdate(item.id, { link: v })} />
        </div>
        <div className="flex items-center justify-between mb-2">
          <span className={labelCls}>Points</span>
          <button type="button" onClick={() => onAddBullet(item.id)} className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium"><Plus size={12} />Add</button>
        </div>
        {item.bullets.map((bullet, idx) => (
          <div key={idx} className="flex gap-2 mb-2">
            <textarea value={bullet} onChange={e => onUpdateBullet(item.id, idx, e.target.value)} rows={2}
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-full bg-white focus:outline-none focus:ring-2 focus:ring-slate-400 resize-y" />
            <button type="button" onClick={() => onRemoveBullet(item.id, idx)} className="text-slate-300 hover:text-red-500 transition mt-1"><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
    ))}
  </div>;

const SkillsAwardsEditor: React.FC<{ skillsAwards: SkillsAwards; onChange: (k: keyof SkillsAwards, v: string) => void }> = ({ skillsAwards, onChange }) => (
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
    <TextareaField label="Technical Skills" value={skillsAwards.technicalSkills} onChange={v => onChange('technicalSkills', v)} rows={4} placeholder="One per line" />
    <TextareaField label="Languages" value={skillsAwards.languages} onChange={v => onChange('languages', v)} rows={4} placeholder="One per line" />
    <TextareaField label="Training & Certifications" value={skillsAwards.trainingCertifications} onChange={v => onChange('trainingCertifications', v)} rows={4} placeholder="One per line" />
    <TextareaField label="Awards" value={skillsAwards.awards} onChange={v => onChange('awards', v)} rows={4} placeholder="One per line" />
  </div>
);

const CustomSectionEditor: React.FC<{ section: CustomSection; onChange: (p: Partial<CustomSection>) => void }> = ({ section, onChange }) =>
  section.type === 'text'
    ? <TextareaField label="Content" value={section.content} onChange={v => onChange({ content: v })} rows={5} />
    : <div>
      <span className={labelCls}>Items (one per line)</span>
      <textarea value={section.items.join('\n')} onChange={e => onChange({ items: e.target.value.split('\n') })} rows={6}
        className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-full bg-white focus:outline-none focus:ring-2 focus:ring-slate-400 resize-y" placeholder="One item per line" />
    </div>;

const EmptyBlock: React.FC<{ text: string }> = ({ text }) => (
  <div className="rounded-lg border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">{text}</div>
);

// ============================================================
// RESUME PREVIEW
// ============================================================
const ResumePreview: React.FC<{
  resume: ResumeBuilderState;
  formatting: FormattingSettings;
  jobTitle?: string | null;
}> = ({ resume, formatting, jobTitle }) => {
  const two = formatting.template === 'two_column';
  const classic = formatting.template === 'classic_ats';
  const basePx = classic ? 11 : 9 + formatting.fontSize.base;
  const headerPx = classic ? 13 : basePx + formatting.fontSize.headers + 1;
  const sectionGap = formatting.compactMode ? 8 : classic ? 12 : 8 + formatting.spacing.section * 4;
  const itemGap = formatting.compactMode ? 3 : classic ? 7 : formatting.spacing.item * 3;
  const lineH = formatting.compactMode ? 1.3 : classic ? 1.35 : 1.3 + formatting.spacing.line * 0.05;
  const fontFamily = formatting.fonts.body === 'serif' ? 'Georgia, Times New Roman, serif' : formatting.fonts.body === 'mono' ? 'monospace' : 'system-ui, sans-serif';
  const headerFontFamily = formatting.fonts.header === 'serif' ? 'Georgia, Times New Roman, serif' : formatting.fonts.header === 'mono' ? 'monospace' : 'system-ui, sans-serif';

  // Pass jobTitle so the catch-all group label is role-specific in the preview.
  const compactSkills = formatCompactSkillsSection(resume.skillsAwards, jobTitle);

  const skills = compactSkills.length > 0 ? (
    <div style={{ marginBottom: sectionGap }}>
      <PrevHead title={classic ? 'Skills & Interests' : 'Technical Skills & Competencies'} headerPx={headerPx} classic={classic} fontFamily={headerFontFamily} />
      <ul style={{ paddingLeft: classic ? 0 : 14, fontSize: basePx, lineHeight: lineH, listStyle: classic ? 'none' : 'disc', marginTop: classic ? 3 : 0 }}>
        {compactSkills.map((skillLine, i) => <li key={i}>{classic ? skillLine.replace(/^([^:]+):/, '$1:') : skillLine}</li>)}
      </ul>
    </div>
  ) : null;

  const educationBlock = resume.sectionVisibility.education && resume.education.length > 0 && <div style={{ marginBottom: sectionGap }}>
    <PrevHead title="Education" headerPx={headerPx} classic={classic} fontFamily={headerFontFamily} />
    {resume.education.map(edu => <div key={edu.id} style={{ marginBottom: itemGap }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: basePx }}>
        <strong>{edu.institution}</strong><span style={{ color: classic ? '#111827' : '#6b7280', textAlign: 'right' }}>{edu.years}</span>
      </div>
      {edu.degree && <div style={{ fontSize: basePx, color: classic ? '#111827' : '#4b5563', fontStyle: classic ? 'italic' : 'normal' }}>{edu.degree}</div>}
      {edu.description && <div style={{ fontSize: basePx, color: classic ? '#374151' : '#6b7280' }}>{edu.description}</div>}
    </div>)}
  </div>;

  const main = <>
    {resume.sectionVisibility.summary && resume.summary.trim() && <div style={{ marginBottom: sectionGap }}>
      <PrevHead title={classic ? 'Profile' : 'Summary'} headerPx={headerPx} classic={classic} fontFamily={headerFontFamily} />
      <p style={{ fontSize: basePx, lineHeight: lineH, color: classic ? '#111827' : '#374151', margin: 0 }}>{resume.summary}</p>
    </div>}
    {classic && educationBlock}
    {resume.sectionVisibility.experience && resume.experience.length > 0 && <div style={{ marginBottom: sectionGap }}>
      <PrevHead title={classic ? 'Work Experience' : 'Experience'} headerPx={headerPx} classic={classic} fontFamily={headerFontFamily} />
      {resume.experience.map(exp => <div key={exp.id} style={{ marginBottom: itemGap + 4 }}>
        {classic ? <>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: basePx }}>
            <strong>{exp.company || exp.jobTitle}</strong><strong style={{ textAlign: 'right' }}>{exp.location}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: basePx, fontStyle: 'italic' }}>
            <span>{exp.company ? exp.jobTitle : ''}</span><span style={{ textAlign: 'right' }}>{exp.years}</span>
          </div>
        </> : <>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: basePx }}>
            <strong>{exp.jobTitle}</strong><span style={{ color: '#6b7280' }}>{exp.years}</span>
          </div>
          {exp.company && <div style={{ fontSize: basePx, color: '#4b5563' }}>{[exp.company, exp.location].filter(Boolean).join(' · ')}</div>}
        </>}
        {exp.bullets.filter(Boolean).length > 0 && <ul style={{ paddingLeft: 14, fontSize: basePx, lineHeight: lineH, marginTop: 2 }}>
          {exp.bullets.filter(Boolean).map((b, i) => <li key={i}>{b}</li>)}
        </ul>}
      </div>)}
    </div>}
    {!classic && educationBlock}
    {!two && resume.sectionVisibility.skillsAwards && skills}
    {resume.sectionVisibility.projects && resume.projects.length > 0 && <div style={{ marginBottom: sectionGap }}>
      <PrevHead title={classic ? 'Project Experience' : 'Projects'} headerPx={headerPx} classic={classic} fontFamily={headerFontFamily} />
      {resume.projects.map(project => <div key={project.id} style={{ marginBottom: itemGap + 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: basePx }}>
          <strong>{project.name}</strong><span style={{ color: classic ? '#111827' : '#6b7280', textAlign: 'right' }}>{project.years}</span>
        </div>
        {[project.role, project.link].filter(Boolean).length > 0 && <div style={{ fontSize: basePx, color: '#4b5563', fontStyle: classic ? 'italic' : 'normal' }}>{[project.role, project.link].filter(Boolean).join(' · ')}</div>}
        {project.bullets.filter(Boolean).length > 0 && <ul style={{ paddingLeft: 14, fontSize: basePx, lineHeight: lineH, marginTop: 2 }}>
          {project.bullets.filter(Boolean).map((b, i) => <li key={i}>{b}</li>)}
        </ul>}
      </div>)}
    </div>}
    {resume.customSections.filter(s => s.visible).map(s => <div key={s.id} style={{ marginBottom: sectionGap }}>
      <PrevHead title={s.title} headerPx={headerPx} classic={classic} fontFamily={headerFontFamily} />
      {s.type === 'text' ? <p style={{ fontSize: basePx, lineHeight: lineH }}>{s.content}</p>
        : <ul style={{ paddingLeft: 14, fontSize: basePx, lineHeight: lineH }}>{s.items.filter(Boolean).map((item, i) => <li key={i}>{item}</li>)}</ul>}
    </div>)}
  </>;

  return (
    <div style={{
      background: 'white',
      padding: `${formatting.margins.top * 3}px ${formatting.margins.right * 3}px ${formatting.margins.bottom * 3}px ${formatting.margins.left * 3}px`,
      width: formatting.pageSize === 'a4' ? 420 : 440,
      minHeight: formatting.pageSize === 'a4' ? 594 : 570,
      fontFamily,
      boxShadow: '0 1px 3px rgba(15,23,42,0.12)',
      border: '1px solid #e5e7eb',
      color: '#111827',
    }}>
      {resume.sectionVisibility.personal && <header style={{ textAlign: classic ? 'center' : 'left', borderBottom: classic ? 'none' : '1px solid #e5e7eb', paddingBottom: 8, marginBottom: sectionGap }}>
        <h1 style={{ fontSize: classic ? headerPx + 7 : headerPx + 3, fontWeight: 700, color: '#111827', textTransform: classic ? 'none' : 'uppercase', letterSpacing: classic ? 0 : '0.03em', margin: 0, fontFamily: headerFontFamily }}>{resume.personal.fullName || 'Your Name'}</h1>
        {resume.personal.jobTitle && !classic && <p style={{ fontSize: basePx, color: '#4b5563', marginTop: 2 }}>{resume.personal.jobTitle}</p>}
        {joinContact(resume.personal) && <p style={{ fontSize: basePx - 1, color: classic ? '#111827' : '#6b7280', marginTop: 3 }}>{joinContact(resume.personal)}</p>}
      </header>}
      {two ? (
        <div style={{ display: 'grid', gridTemplateColumns: '32% 1fr', gap: 16 }}>
          <aside style={{ borderRight: '1px solid #e5e7eb', paddingRight: 12 }}>{resume.sectionVisibility.skillsAwards && skills}</aside>
          <main>{main}</main>
        </div>
      ) : <main>{main}</main>}
    </div>
  );
};

const PrevHead: React.FC<{ title: string; headerPx: number; classic?: boolean; fontFamily?: string }> = ({ title, headerPx, classic, fontFamily }) => (
  <h2 style={{
    fontSize: headerPx,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: classic ? '0.02em' : '0.05em',
    color: '#111827',
    borderBottom: classic ? '1.5px solid #111827' : '1px solid #d1d5db',
    paddingBottom: classic ? 2 : 2,
    marginBottom: classic ? 5 : 6,
    marginTop: classic ? 10 : 10,
    fontFamily,
  }}>
    {title}
  </h2>
);

// ============================================================
// BULLET IMPROVEMENT REVIEW MODAL
// Shows each JD improvement — including summary — before it is applied.
// ============================================================

const BulletImprovementReviewModal: React.FC<{
  items: BulletReviewItem[];
  onToggle: (id: string) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onApply: () => void;
  onClose: () => void;
  summaryChange: TailoringChange | null;
  summaryAccepted: boolean;
  onToggleSummary: () => void;
}> = ({ items, onToggle, onAcceptAll, onRejectAll, onApply, onClose, summaryChange, summaryAccepted, onToggleSummary }) => {
  const acceptedBullets = items.filter((i) => i.accepted).length;
  const totalCount      = items.length + (summaryChange ? 1 : 0);
  const totalAccepted   = acceptedBullets + (summaryChange && summaryAccepted ? 1 : 0);
  const safeCount       = items.filter((i) => i.riskLevel === 'safe').length;
  const mediumCount     = items.filter((i) => i.riskLevel === 'medium').length;

  const riskMeta = (risk?: string) => {
    if (risk === 'safe')            return { label: 'Safe',            dot: 'bg-emerald-500', text: 'text-emerald-700', badge: 'border-emerald-200 bg-emerald-50' };
    if (risk === 'medium')          return { label: 'Medium Risk',      dot: 'bg-amber-400',  text: 'text-amber-700',  badge: 'border-amber-200 bg-amber-50' };
    if (risk === 'not_recommended') return { label: 'Not Recommended',  dot: 'bg-red-500',    text: 'text-red-700',    badge: 'border-red-200 bg-red-50' };
    return                                 { label: 'Review',            dot: 'bg-slate-400',  text: 'text-slate-600',  badge: 'border-slate-200 bg-slate-50' };
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="w-full max-w-5xl max-h-[90vh] rounded-2xl border border-slate-200 bg-white shadow-xl overflow-hidden flex flex-col">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 p-5 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Review JD Improvements</h2>
            <p className="text-sm text-slate-500 mt-1">
              Every change is scored for safety.{' '}
              <span className="font-medium text-emerald-700">Safe</span> = supported by Master CV.{' '}
              <span className="font-medium text-amber-700">Medium Risk</span> = inferred — review carefully.
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Toolbar */}
        <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
            <span><span className="font-semibold text-slate-900">{totalAccepted}</span> of <span className="font-semibold text-slate-900">{totalCount}</span> selected</span>
            {safeCount > 0 && (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 border border-emerald-200 text-emerald-700">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />{safeCount} Safe
              </span>
            )}
            {mediumCount > 0 && (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 border border-amber-200 text-amber-700">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />{mediumCount} Medium Risk
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onAcceptAll} className="px-3 py-2 rounded-lg border border-emerald-200 bg-emerald-50 text-sm font-medium text-emerald-700 hover:bg-emerald-100 transition">Accept all</button>
            <button type="button" onClick={onRejectAll} className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 transition">Reject all</button>
          </div>
        </div>

        {/* Scrollable cards */}
        <div className="overflow-y-auto p-5 space-y-4">

          {/* ── Professional Summary card — always at top ── */}
          {summaryChange && (
            <div className={`rounded-2xl border p-4 transition ${summaryAccepted ? 'border-violet-200 bg-violet-50/40' : 'border-slate-200 bg-slate-50'}`}>
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
                <div>
                  <p className="text-xs uppercase tracking-wide font-semibold text-violet-500 mb-1">Professional Summary</p>
                  <h3 className="text-sm font-semibold text-slate-900">Summary rewritten for this role</h3>
                </div>
                <button
                  type="button"
                  onClick={onToggleSummary}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border transition ${summaryAccepted ? 'border-violet-300 bg-white text-violet-700 hover:bg-violet-50' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}
                >
                  {summaryAccepted ? 'Accepted' : 'Rejected'}
                </button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Original summary</p>
                  <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm leading-6 text-slate-600 italic">
                    {summaryChange.before?.trim()
                      ? summaryChange.before.trim()
                      : <span className="text-slate-400 not-italic">No summary in Master CV</span>
                    }
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">JD-aligned summary</p>
                  <div className="rounded-xl border border-violet-200 bg-white p-3 text-sm leading-6 text-slate-800">
                    {summaryChange.after}
                  </div>
                </div>
              </div>

              <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-3">
                <span className="inline-flex items-center gap-1.5 shrink-0 text-xs font-semibold uppercase tracking-wide text-emerald-700 whitespace-nowrap">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  Safety: Safe
                </span>
                <span className="text-xs leading-relaxed text-emerald-800 sm:border-l sm:border-emerald-300 sm:pl-3">
                  {summaryChange.reason}
                </span>
              </div>
            </div>
          )}

          {/* ── Bullet cards ── */}
          {items.map((item, index) => {
            const meta = riskMeta(item.riskLevel);
            return (
              <div
                key={item.id}
                className={`rounded-2xl border p-4 transition ${item.accepted ? `border-emerald-200 bg-emerald-50/40` : 'border-slate-200 bg-slate-50'}`}
              >
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
                  <div>
                    <p className="text-xs uppercase tracking-wide font-semibold text-slate-400">Bullet {index + 1} of {items.length}</p>
                    <h3 className="text-sm font-semibold text-slate-900 mt-1">
                      {item.roleTitle || 'Experience role'}
                      {item.company && <span className="font-normal text-slate-500"> · {item.company}</span>}
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => onToggle(item.id)}
                    className={`px-3 py-2 rounded-lg text-sm font-medium border transition ${item.accepted ? 'border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-50' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}
                  >
                    {item.accepted ? 'Accepted' : 'Rejected'}
                  </button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Original Master CV bullet</p>
                    <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm leading-6 text-slate-700">{item.before}</div>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">JD-aligned rewrite</p>
                    <div className="rounded-xl border border-emerald-200 bg-white p-3 text-sm leading-6 text-slate-800">{item.after}</div>
                  </div>
                </div>

                <div className={`mt-3 rounded-xl border px-3 py-2.5 flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-3 ${meta.badge}`}>
                  <span className={`inline-flex items-center gap-1.5 shrink-0 text-xs font-semibold uppercase tracking-wide whitespace-nowrap ${meta.text}`}>
                    <span className={`w-2 h-2 rounded-full shrink-0 ${meta.dot}`} />
                    Safety: {meta.label}
                  </span>
                  <span className={`text-xs leading-relaxed sm:border-l sm:border-current sm:border-opacity-20 sm:pl-3 ${meta.text}`}>
                    {item.reason}
                    {item.jdSignalStrength === 'explicit' && <span className="ml-1 opacity-60">· Explicitly matched in JD</span>}
                    {item.jdSignalStrength === 'inferred'  && <span className="ml-1 opacity-60">· Inferred from JD context</span>}
                  </span>
                </div>

                {item.evidenceSource && (
                  <div className="mt-2 px-3 py-1.5 rounded-lg bg-slate-100 border border-slate-200 text-xs text-slate-500">
                    <span className="font-medium text-slate-600">Evidence: </span>{item.evidenceSource}
                  </div>
                )}
              </div>
            );
          })}

        </div>

        {/* Footer */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-5 border-t border-slate-100 bg-white">
          <p className="text-xs text-slate-400">
            Rejected bullet improvements revert to the original Master CV bullet.
          </p>
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 transition">
              Cancel
            </button>
            <button
              type="button"
              onClick={onApply}
              disabled={totalAccepted === 0}
              className="px-5 py-2 rounded-xl bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 transition disabled:opacity-40"
            >
              Apply selected
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
// ============================================================
// CUSTOM SECTION MODAL — matches JTracker modal style
// ============================================================
const CustomSectionModal: React.FC<{ onClose: () => void; onAdd: (s: CustomSection) => void }> = ({ onClose, onAdd }) => {
  const [title, setTitle] = useState('');
  const [type, setType] = useState<CustomSectionType>('text');

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <h2 className="text-lg font-semibold text-slate-900">Add Custom Section</h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <Field label="Section Name" value={title} onChange={setTitle} placeholder="e.g. Publications, Volunteer Work" />
          <div>
            <span className={labelCls}>Section Type</span>
            <div className="space-y-2">
              {([['text', 'Text Block', 'A paragraph of text'], ['items', 'Item List', 'A bulleted list of items'], ['skills', 'Skill List', 'A simple list of skills']] as const).map(([id, label, desc]) => (
                <button key={id} type="button" onClick={() => setType(id)}
                  className={`w-full text-left rounded-lg border p-3 transition ${type === id ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-300'}`}>
                  <div className="font-medium text-sm text-slate-800">{label}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{desc}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-3 p-5 border-t border-slate-100">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 transition">Cancel</button>
          <button type="button" disabled={title.trim().length < 2}
            onClick={() => onAdd({ id: uid(), title: title.trim(), type, content: '', items: [], visible: true, collapsed: false })}
            className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50 transition inline-flex items-center gap-2">
            <Plus size={14} />Add Section
          </button>
        </div>
      </div>
    </div>
  );
};