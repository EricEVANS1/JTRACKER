// src/pages/ResumeBuilderPage.tsx
// Resume Builder — integrated into JTracker design system.
// Matches AppLayout's bg-slate-50, sidebar nav, slate-900 accents.
// Note: requires jsPDF, docx, file-saver — install with:
//   npm install jspdf docx file-saver @types/file-saver

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
  Trash2,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { optimizeResumeForJob } from '../lib/resumeTailoring';
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



// ---- PDF / DOCX — lazy-loaded to avoid bundle issues if not installed ----
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
  const urls = all.match(/(?:https?:\/\/)?(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s|,]*)?/gi) || [];
  const linkedin = urls.find(u => u.toLowerCase().includes('linkedin')) || '';
  const github = urls.find(u => u.toLowerCase().includes('github')) || '';
  const website = urls.find(u => !u.toLowerCase().includes('linkedin') && !u.toLowerCase().includes('github') && !u.includes('@')) || '';
  const firstLine = lines[0] || '';
  const fullName = firstLine && !firstLine.includes('@') && !/\d/.test(firstLine) ? firstLine.replace(/[|,].*$/, '').trim() : '';
  return { fullName, jobTitle: fallbackTitle || '', email, phone, location: '', website, linkedin, github };
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
    jobTitle: fallbackTitle || fallback.jobTitle,
    email: contact?.email || fallback.email,
    phone: contact?.phone || fallback.phone,
    location: contact?.location || fallback.location,
    website: contact?.website || contact?.portfolio || fallback.website,
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

  return {
    ...fallback,
    personal: mergePersonalFromMaster(fallback.personal, cvVersion, fallbackTitle),
    summary: fallback.summary,
    experience: masterExperience.length ? masterExperience : fallback.experience,
    education: masterEducation.length ? masterEducation : fallback.education,
    skillsAwards: mergeSkills(
      fallback.skillsAwards,
      skillsFromMasterCv(cvVersion),
      skillsFromAnalysis(analysis),
    ),
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
const normalizeSkillValue = (value: string) =>
  value
    .replace(/^[-•]\s*/, '')
    .replace(/^languages?:\s*/i, '')
    .replace(/^technical skills?:\s*/i, '')
    .replace(/^soft skills?:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();

const skillItems = (value: string): string[] =>
  value
    .split(/\n|,|;|\|/)
    .map(normalizeSkillValue)
    .filter(Boolean);

const compactUnique = (values: string[]) => {
  const seen = new Set<string>();
  const out: string[] = [];

  values.forEach((value) => {
    const clean = normalizeSkillValue(value);
    const key = clean.toLowerCase();

    if (clean && !seen.has(key)) {
      seen.add(key);
      out.push(clean);
    }
  });

  return out;
};

const pickSkillGroup = (items: string[], patterns: RegExp[]) =>
  items.filter((item) => patterns.some((pattern) => pattern.test(item)));

const removePicked = (items: string[], picked: string[]) => {
  const pickedKeys = new Set(picked.map((item) => item.toLowerCase()));
  return items.filter((item) => !pickedKeys.has(item.toLowerCase()));
};

const joinCompact = (items: string[], limit = 10) =>
  compactUnique(items).slice(0, limit).join(', ');

/**
 * Derives a context-aware label for the catch-all competency group from the
 * target job title.  Falls back to "Support Competencies" when the title gives
 * no usable signal.
 *
 * Examples:
 *   "IT Support Specialist"   → "IT Support Competencies"
 *   "Service Desk Analyst"    → "Service Desk Competencies"
 *   "Software Engineer"       → "Engineering Competencies"
 *   "Data Analyst"            → "Data & Analytics Competencies"
 *   "Customer Success Manager"→ "Customer Success Competencies"
 *   null / ""                 → "Support Competencies"
 */
const deriveCatchAllLabel = (jobTitle: string | null | undefined): string => {
  const title = (jobTitle ?? '').trim().toLowerCase();

  if (!title) return 'Support Competencies';

  // Ordered from most-specific to most-generic so the first match wins.
  const rules: Array<[RegExp, string]> = [
    [/service\s+desk/i,           'Service Desk Competencies'],
    [/help\s+desk/i,              'Help Desk Competencies'],
    [/it\s+support/i,             'IT Support Competencies'],
    [/technical\s+support/i,      'Technical Support Competencies'],
    [/desktop\s+support/i,        'Desktop Support Competencies'],
    [/network\s*(engineer|admin)/i,'Network Engineering Competencies'],
    [/software\s+engineer/i,      'Engineering Competencies'],
    [/data\s+analy/i,             'Data & Analytics Competencies'],
    [/business\s+analy/i,         'Business Analysis Competencies'],
    [/project\s+manag/i,          'Project Management Competencies'],
    [/product\s+manag/i,          'Product Management Competencies'],
    [/customer\s+success/i,       'Customer Success Competencies'],
    [/customer\s+service/i,       'Customer Service Competencies'],
    [/sales/i,                    'Sales Competencies'],
    [/market/i,                   'Marketing Competencies'],
    [/devops/i,                   'DevOps Competencies'],
    [/secur/i,                    'Security Competencies'],
    [/finance|accounting/i,       'Finance Competencies'],
    [/hr|human\s+resource/i,      'HR Competencies'],
  ];

  for (const [pattern, label] of rules) {
    if (pattern.test(title)) return label;
  }

  return 'Support Competencies';
};

/**
 * Formats the skills & awards state into compact, CV-ready grouped lines.
 *
 * @param skillsAwards  The editor's skills state.
 * @param jobTitle      Optional target job title — used to derive the catch-all
 *                      group label so it reads as role-specific rather than generic.
 */
const formatCompactSkillsSection = (
  skillsAwards: SkillsAwards,
  jobTitle?: string | null,
): string[] => {
  const rawTechnical = skillItems(skillsAwards.technicalSkills);
  const rawLanguages = skillItems(skillsAwards.languages);
  const rawCerts = skillItems(skillsAwards.trainingCertifications);
  const rawAwards = skillItems(skillsAwards.awards);

  const languageFromTechnical = pickSkillGroup(rawTechnical, [
    /\b(english|german|polish|shona|french|spanish|portuguese|italian|dutch|arabic|mandarin|chinese|japanese|korean)\b/i,
  ]);

  const languages = compactUnique([...rawLanguages, ...languageFromTechnical]);

  let remaining = removePicked(compactUnique(rawTechnical), languageFromTechnical);

  const tools = pickSkillGroup(remaining, [
    /\b(zendesk|jira|confluence|servicenow|salesforce|hubspot|active directory|microsoft office|office 365|microsoft 365|excel|citrix|exchange|vpn|outlook|teams|postman|sap|crm)\b/i,
  ]);
  remaining = removePicked(remaining, tools);

  const systemsNetworking = pickSkillGroup(remaining, [
    /\b(linux|windows|tcp\/ip|tcp|ip|ports?|protocols?|computer networks?|networking|dns|dhcp|vpn|configurations?|hardware|software|operating systems?)\b/i,
  ]);
  remaining = removePicked(remaining, systemsNetworking);

  const supportCompetencies = pickSkillGroup(remaining, [
    /\b(incident|incident management|sla|service level|service level agreements?|root cause|troubleshooting|ticketing|support|escalation|monitoring|operational dashboards?|prioritization|ownership|clear written communication|collaboration|problem solving|analytical thinking|decision making)\b/i,
  ]);
  remaining = removePicked(remaining, supportCompetencies);

  // Derive a role-aware label for the catch-all group.
  const catchAllLabel = deriveCatchAllLabel(jobTitle);

  const lines: string[] = [];

  if (languages.length) {
    lines.push(`Languages: ${joinCompact(languages, 6)}`);
  }

  if (tools.length) {
    lines.push(`Tools & Platforms: ${joinCompact(tools, 12)}`);
  }

  if (systemsNetworking.length) {
    lines.push(`Systems & Networking: ${joinCompact(systemsNetworking, 10)}`);
  }

  if (supportCompetencies.length || remaining.length) {
    lines.push(`${catchAllLabel}: ${joinCompact([...supportCompetencies, ...remaining], 12)}`);
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
  if (!PDF) {
    alert('PDF export requires jsPDF. Run: npm install jspdf');
    return;
  }

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
  if (!docx || !fs) { alert('DOCX export requires: npm install docx file-saver @types/file-saver'); return; }
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
  const { analysisId } = useParams();
  const navigate = useNavigate();
  const [analysis, setAnalysis] = useState<AnalysisRecord | null>(null);
  const [resume, setResume] = useState<ResumeBuilderState>(emptyResume);
  const [originalResume, setOriginalResume] = useState<ResumeBuilderState>(emptyResume);
  const [formatting, setFormatting] = useState<FormattingSettings>(defaultFormatting);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [error, setError] = useState('');
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'editor' | 'preview'>('editor');
  const [collapsed, setCollapsed] = useState({ formatting: true, personal: false, summary: false, experience: false, education: false, projects: true, skillsAwards: false });

  // Resolved job title — kept separately so it's available for skills formatting
  // even before the analysis record is stored in state.
  const jobTitle = analysis?.job_title ?? resume.personal.jobTitle ?? null;

  const plainText = useMemo(
    () => buildPlainTextResume(resume, jobTitle),
    [resume, jobTitle],
  );
  const fileBase = makeSafeFileName(analysis?.job_title ? `${analysis.job_title} cv` : resume.personal.fullName || 'optimized-cv');

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true); setError('');
        if (!analysisId) { setResume(emptyResume); setOriginalResume(emptyResume); return; }
        const { data: { user }, error: ue } = await supabase.auth.getUser();
        if (ue || !user) throw new Error('You must be logged in.');
        const { data, error: ae } = await supabase.from('cv_analyses')
          .select(`
            id,
            user_id,
            cv_version_id,
            job_title,
            company_name,
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

        const tailored = optimizeResumeForJob({
          resume: parsed,
          analysis: record,
        });

        setAnalysis(record);
        setResume(tailored.resume);
        setOriginalResume(tailored.resume);
      } catch (err) { setError(err instanceof Error ? err.message : 'Failed to load Resume Builder.'); }
      finally { setLoading(false); }
    };
    load();
  }, [analysisId]);

  const flash = (msg: string) => { setSavedMsg(msg); setTimeout(() => setSavedMsg(''), 3000); };

  const handleSave = async () => {
    try {
      setSaving(true); setError('');
      if (!plainText.trim()) throw new Error('Resume is empty.');
      const { data: { user }, error: ue } = await supabase.auth.getUser();
      if (ue || !user) throw new Error('Not logged in.');
      const { error: ie } = await supabase.from('cv_versions').insert({
        user_id: user.id,
        name: `${analysis?.job_title || resume.personal.jobTitle || 'Optimized CV'} — Builder`,
        target_role: analysis?.job_title || resume.personal.jobTitle || null,
        cv_text: plainText,
        last_score: analysis?.score || null,
        last_analyzed_at: new Date().toISOString(),
        cv_suggestions: { builder_state: resume, formatting, source_analysis_id: analysis?.id ?? null },
      });
      if (ie) throw ie;
      flash('Saved as a new CV version in CV Manager.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to save.'); }
    finally { setSaving(false); }
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

  if (error && !analysis && analysisId) return (
    <div className="max-w-lg">
      <button onClick={() => navigate(-1)} className="mb-6 inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900">
        <ArrowLeft size={16} />Back
      </button>
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6">
        <h2 className="font-semibold text-red-700 mb-2">Resume Builder Error</h2>
        <p className="text-sm text-red-600">{error}</p>
      </div>
    </div>
  );

  return (
    <div>
      {/* Page header — matches JTracker page pattern */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <button onClick={() => navigate('/cv-manager')} className="mb-2 inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900 transition">
            <ArrowLeft size={15} />Back to CV Manager
          </button>
          <h1 className="text-2xl font-bold text-slate-900">Resume Builder</h1>
          {analysis && (
            <p className="text-sm text-slate-500 mt-1">
              Based on analysis for <span className="font-medium text-slate-700">{analysis.job_title || 'role'}</span>
              {analysis.score != null && <span className="ml-2 text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">Score: {analysis.score}/100</span>}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => { setResume(originalResume); setFormatting(defaultFormatting); flash('Reset to original.'); }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 transition">
            <RefreshCcw size={15} />Reset
          </button>
          <button onClick={() => exportAsPDF(resume, formatting, jobTitle, `${fileBase}.pdf`)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 transition">
            <Download size={15} />PDF
          </button>
          <button onClick={() => exportAsDOCX(resume, jobTitle, `${fileBase}.docx`)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 transition">
            <Download size={15} />DOCX
          </button>
          <button onClick={handleSave} disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 transition disabled:opacity-50">
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            {saving ? 'Saving...' : 'Save to CV Manager'}
          </button>
        </div>
      </div>

      {savedMsg && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
          ✓ {savedMsg}
        </div>
      )}
      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
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
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_560px] gap-6 items-start">

        {/* EDITOR PANEL */}
        <div className={`space-y-4 xl:max-h-[calc(100vh-180px)] xl:overflow-y-auto xl:pr-2 xl:pb-8 ${activeTab === 'preview' ? 'hidden xl:block' : ''}`}>

          <EditorCard title="Template & Formatting" collapsed={collapsed.formatting} onToggle={() => setCollapsed(p => ({ ...p, formatting: !p.formatting }))}>
            <FormattingPanel formatting={formatting} onChange={setFormatting} />
          </EditorCard>

          <EditorCard title="Personal Information" collapsed={collapsed.personal} onToggle={() => setCollapsed(p => ({ ...p, personal: !p.personal }))} visible={resume.sectionVisibility.personal} onToggleVisible={() => toggleVis('personal')}>
            <PersonalEditor personal={resume.personal} onChange={upPersonal} />
          </EditorCard>

          <EditorCard title="Professional Summary" collapsed={collapsed.summary} onToggle={() => setCollapsed(p => ({ ...p, summary: !p.summary }))} visible={resume.sectionVisibility.summary} onToggleVisible={() => toggleVis('summary')}>
            <TextareaField label="Summary" value={resume.summary} onChange={val => setResume(p => ({ ...p, summary: val }))} rows={5} />
          </EditorCard>

          <EditorCard title="Experience" collapsed={collapsed.experience} onToggle={() => setCollapsed(p => ({ ...p, experience: !p.experience }))} visible={resume.sectionVisibility.experience} onToggleVisible={() => toggleVis('experience')}
            action={<AddBtn onClick={addExp} label="Add Role" />}>
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
    <Field label="Website" value={personal.website} onChange={v => onChange('website', v)} />
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