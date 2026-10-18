import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  applyJobFilters,
  DATE_POSTED_OPTIONS,
  datePostedFromMaxAge,
  datePostedLabel,
  EXPERIENCE_LEVEL_OPTIONS,
  experienceLevelLabel,
  maxAgeFromDatePosted,
  WORK_MODEL_OPTIONS,
  type DatePosted,
  type FilterReason,
} from '../../supabase/functions/job-pipeline/_lib/jobFilters.ts';
import {
  describeSearchReports,
  describeSourceSummaries,
  type SearchReport,
  type SourceSummary,
} from '../../supabase/functions/job-pipeline/_lib/searchReport.ts';
import { linkedInSearchUrl } from '../../supabase/functions/job-pipeline/_lib/linkedin.ts';
import { cleanTerms, orderCombinations } from '../../supabase/functions/job-pipeline/_lib/queryPlan.ts';
import {
  AlertCircle,
  Briefcase,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Loader2,
  MapPin,
  Play,
  RefreshCw,
  Save,
  Search,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
  X,
  Zap,
} from 'lucide-react';

import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

// ─── interfaces ──────────────────────────────────────────────────────────────

interface JobPreferences {
  id: string;
  user_id: string;
  default_cv_version_id: string | null;
  target_titles: string[] | null;
  preferred_locations: string[] | null;
  work_model: string | null;
  min_match_score: number | null;
  enabled_sources: string[] | null;
  max_job_age_days: number | null;
  automation_enabled: boolean | null;
  // Missing until supabase/sql/2026-10-17_job_preferences_excluded_keywords.sql has run.
  excluded_keywords?: string[] | null;
  // Missing until supabase/sql/2026-10-18_job_search_filters.sql has run.
  experience_levels?: string[] | null;
}

interface JobSource {
  name: string;
  slug: string;
  fetch_method: string | null;
  is_active: boolean;
}

interface JobAd {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  work_model: string | null;
  salary_range: string | null;
  job_url: string;
  source: string | null;
  source_slug: string | null;
  source_posted_at: string | null;
  discovered_at: string;
  description: string | null;
  ignored: boolean | null;
  best_match_score: number | null;
  best_fit_label: string | null;
  recommendation: string | null;
  parsed_required_skills: string[] | null;
}

interface JobMatchResult {
  id: string;
  job_ad_id: string;
  cv_version_id: string | null;
  match_score: number;
  fit_label: string;
  recommendation: string;
  matched_skills: string[] | null;
  missing_skills: string[] | null;
  concerns: string[] | null;
  suggested_cv_angle: string | null;
  explanation: string | null;
  created_at: string;
}

interface CVVersion {
  id: string;
  name: string | null;
  target_role: string | null;
  last_score: number | null;
}

interface PreferenceForm {
  targetTitles: string;
  preferredLocations: string;
  workModel: string;
  minMatchScore: number;
  datePosted: DatePosted;
  defaultCvVersionId: string;
  automationEnabled: boolean;
  enabledSources: string[];
  excludedKeywords: string;
  experienceLevels: string[];
}

type ScoreView = 'all' | 'recommended' | 'possible' | 'stretch' | 'scored' | 'unscored';

// ─── constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

const sourceLabels: Record<string, string> = {
  google_jobs:  'Google Jobs',
  indeed:       'Indeed',
  linkedin:     'LinkedIn',
  justjoinit:   'JustJoinIT',
  nofluffjobs:  'NoFluffJobs',
  pracuj:       'Pracuj.pl',
  pracuj_it:    'Pracuj.pl IT',
  bulldogjob:   'Bulldogjob',
  theprotocol:  'TheProtocol.it',
  crossweb:     'Crossweb.pl',
  adzuna:       'Adzuna',
  manual:       'Manual',
};

// ─── pure helpers ─────────────────────────────────────────────────────────────

const splitCsv = (value: string) =>
  value.split(',').map((s) => s.trim()).filter(Boolean);

const joinCsv = (items?: string[] | null) => (items || []).join(', ');

const normalise = (value: unknown) => String(value || '').toLowerCase().trim();

/** Reject rows that are clearly malformed / organic-scraping junk. */
const isValidJob = (job: JobAd): boolean => {
  const title = (job.title || '').trim();
  if (!title || title.length < 3) return false;
  if (/<[a-z][\s\S]*>/i.test(title)) return false;
  if (title.startsWith('{') || title.startsWith('[')) return false;
  if (!job.job_url || !job.job_url.startsWith('http')) return false;

  // Reject search-result / career-page noise titles that scrapers sometimes pick up
  const lowerTitle = title.toLowerCase();
  const badTitlePatterns = [
    'oferty pracy',
    'jobs in',
    'job search',
    'search results',
    'career page',
    'careers page',
    'praca - oferty',
    'wyniki wyszukiwania',
    'zobacz wszystkie oferty',
    'view all jobs',
    'latest jobs',
    'job openings',
  ];
  if (badTitlePatterns.some((pattern) => lowerTitle.includes(pattern))) return false;

  return true;
};

/**
 * ① Improved company extraction.
 *
 * Handles patterns like:
 *   "Acme Corp – Jobs", "Acme Corp (Sp. z o.o.)", "Acme Corp | LinkedIn",
 *   "Acme Corp · 4.2 ★", "Acme Corp - Pracuj.pl", digits-only noise, etc.
 */
const cleanCompanyName = (raw: string | null | undefined): string => {
  if (!raw) return 'Unknown company';

  let s = raw.trim();

  // Strip source-site suffixes: "… - Indeed", "… | LinkedIn", "… · Pracuj.pl"
  s = s.replace(/\s*[|·•–—-]\s*(indeed|linkedin|pracuj|nofluffjobs|bulldogjob|glassdoor|theprotocol|crossweb|justjoinit|google jobs|jobs?|careers?|recruitment|hiring|praca)\s*$/i, '');

  // Strip legal-entity suffixes in parens/brackets
  s = s.replace(/\s*[([](sp\.?\s*z\.?\s*o\.?\s*o\.?|s\.?\s*a\.?|inc\.?|ltd\.?|llc\.?|gmbh|corp\.?|company|firma)[)\]]\s*$/i, '');

  // Strip star ratings: "4.2 ★" or "(4.2)"
  s = s.replace(/\s*[\(]?\d+\.?\d*\s*[★*][\)]?\s*$/, '');

  // Strip trailing punctuation
  s = s.replace(/[,;|·•\-–—]+$/, '').trim();

  return s || 'Unknown company';
};

/**
 * Infer company name from a comma-structured title like:
 *   "Software Engineer III, Governance, Box Poland sp. z o.o."
 * Returns the last comma-separated segment when there are ≥3 parts,
 * since that pattern is common on TheProtocol and similar boards.
 */
const inferCompanyFromTitle = (title: string): string | null => {
  const parts = title.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 3) return parts[parts.length - 1];
  return null;
};

/** Resolve the best available company string for a job ad. */
const resolveCompany = (job: JobAd): string =>
  cleanCompanyName(job.company || inferCompanyFromTitle(job.title));

/**
 * ① Improved title extraction.
 *
 * Handles:
 *   "Senior Dev at Acme", "Senior Dev @ Acme", "Senior Dev – Warsaw",
 *   "Senior Dev (Remote)", "Senior Dev | Full-time", salary ranges in title, etc.
 */
const cleanJobTitle = (raw: string | null | undefined): string => {
  if (!raw) return 'Untitled position';

  let s = raw.trim();

  // Remove trailing salary fragments like "120 000 – 160 000 PLN"
  s = s.replace(/\s+\d[\d\s]*[–—-]\s*\d[\d\s]*(pln|usd|eur|gbp|zł)?\s*$/i, '');

  // Remove " at Company" / " @ Company"
  s = s.replace(/\s+(@|at)\s+[^|·•(]+$/i, '');

  // Remove pipe/bullet suffixes: " | Full-time | Warsaw"
  s = s.replace(/\s*[|·•–—]\s*.+$/, '');

  // Remove trailing location in parens: "(Warsaw)", "(Remote)"
  s = s.replace(/\s*\([^)]{2,40}\)\s*$/, '');

  // Strip trailing punctuation
  s = s.replace(/[,;]+$/, '').trim();

  return s || 'Untitled position';
};

/** Strip HTML tags and collapse whitespace for plain-text description preview. */
const stripHtml = (html: string | null | undefined): string => {
  if (!html) return '';
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\s{2,}/g, ' ')
    .trim();
};

const preferenceToForm = (
  preferences: JobPreferences | null,
  sources: JobSource[],
): PreferenceForm => ({
  targetTitles:       joinCsv(preferences?.target_titles),
  preferredLocations: joinCsv(preferences?.preferred_locations),
  workModel:          preferences?.work_model || 'any',
  minMatchScore:      preferences?.min_match_score ?? 60,
  datePosted:         datePostedFromMaxAge(preferences?.max_job_age_days),
  defaultCvVersionId: preferences?.default_cv_version_id || '',
  automationEnabled:  Boolean(preferences?.automation_enabled),
  enabledSources:     preferences?.enabled_sources?.length
    ? preferences.enabled_sources
    : sources.map((s) => s.slug),
  excludedKeywords:   joinCsv(preferences?.excluded_keywords),
  experienceLevels:   preferences?.experience_levels || [],
});

const supportsExperienceLevels = (preferences: JobPreferences | null) =>
  Boolean(preferences && 'experience_levels' in preferences);

const WORK_MODEL_LABELS: Record<string, string> = Object.fromEntries(WORK_MODEL_OPTIONS.map((o) => [o.value, o.label]));

// "3 older than Past 24 hours or undated, 1 no longer accepting applications"
const describeFilteredOut = (removed: Partial<Record<FilterReason, number>> | null | undefined, maxAgeDays: number | null | undefined) => {
  const labels: Record<FilterReason, string> = {
    date: `older than ${datePostedLabel(maxAgeDays).toLowerCase()} or undated`,
    closed: 'no longer accepting applications',
    work_model: 'other work model',
    experience_level: 'other experience level',
  };
  return (Object.keys(labels) as FilterReason[])
    .filter((reason) => (removed?.[reason] ?? 0) > 0)
    .map((reason) => `${removed?.[reason]} ${labels[reason]}`)
    .join(', ');
};

// The excluded_keywords column is added by a SQL migration; until it exists
// the field can't be saved.
const supportsExcludedKeywords = (preferences: JobPreferences | null) =>
  Boolean(preferences && 'excluded_keywords' in preferences);

const getScoreBadgeClass = (score?: number | null) => {
  if (score == null) return 'bg-slate-100 text-slate-500 border-slate-200';
  if (score >= 85)   return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (score >= 70)   return 'bg-blue-50 text-blue-700 border-blue-200';
  if (score >= 55)   return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-red-50 text-red-700 border-red-200';
};

const getRecommendationLabel = (recommendation?: string | null) => {
  if (!recommendation) return '';
  return recommendation.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
};

const formatPostedAgo = (value?: string | null) => {
  if (!value) return 'Date unknown';
  const diffMs    = Date.now() - new Date(value).getTime();
  const diffHours = Math.max(Math.floor(diffMs / (1000 * 60 * 60)), 0);
  if (diffHours < 1)  return 'Posted recently';
  if (diffHours < 24) return `Posted ${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return diffDays === 1 ? 'Posted 1 day ago' : `Posted ${diffDays} days ago`;
};

// Posted in the last 24 hours: shown in green, as LinkedIn does.
const isPostedToday = (value?: string | null) =>
  Boolean(value) && Date.now() - new Date(value as string).getTime() < 24 * 60 * 60 * 1000;

// ─── component ────────────────────────────────────────────────────────────────

export const JobAutomationPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [preferences,    setPreferences]    = useState<JobPreferences | null>(null);
  const [preferenceForm, setPreferenceForm] = useState<PreferenceForm | null>(null);

  const [jobSources,     setJobSources]     = useState<JobSource[]>([]);
  const [jobs,           setJobs]           = useState<JobAd[]>([]);
  // Saved jobs the date / work model / experience filters hide from the list.
  const [hiddenByFilters, setHiddenByFilters] = useState(0);
  // When the scheduler last searched for this user (null: never).
  const [lastScheduledRunAt, setLastScheduledRunAt] = useState<string | null>(null);
  const [matchesByJobId, setMatchesByJobId] = useState<Record<string, JobMatchResult>>({});
  const [cvVersions,     setCvVersions]     = useState<CVVersion[]>([]);
  const [defaultCv,      setDefaultCv]      = useState<CVVersion | null>(null);

  const [editingProfile, setEditingProfile] = useState(false);

  // ⑤ filter state
  const [keyword,       setKeyword]       = useState('');
  const [scoreView,     setScoreView]     = useState<ScoreView>('all');
  const [sourceFilter,  setSourceFilter]  = useState('all');   // slug or 'all'

  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // expanded description per job id
  const [expandedDescriptions, setExpandedDescriptions] = useState<Record<string, boolean>>({});

  const [loading,               setLoading]               = useState(true);
  const [refreshing,            setRefreshing]             = useState(false);
  const [savingPreferences,     setSavingPreferences]      = useState(false);
  const [creatingApplicationId, setCreatingApplicationId]  = useState<string | null>(null);
  const [ignoringJobId,         setIgnoringJobId]          = useState<string | null>(null);
  const [scoringJobId,          setScoringJobId]           = useState<string | null>(null);

  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');

  // ── data fetching ────────────────────────────────────────────────────────────

  const fetchData = async (silent = false) => {
    if (!user) return;

    silent ? setRefreshing(true) : setLoading(true);
    setError('');

    const { data: sourcesData } = await supabase
      .from('job_sources')
      .select('name, slug, fetch_method, is_active')
      .eq('is_active', true)
      .order('name', { ascending: true });

    const safeSources = (sourcesData || []) as JobSource[];
    setJobSources(safeSources);

    const { data: cvData, error: cvError } = await supabase
      .from('cv_versions')
      .select('id, name, target_role, last_score')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (cvError) { setError(cvError.message); setLoading(false); setRefreshing(false); return; }

    const safeCvData = (cvData || []) as CVVersion[];
    setCvVersions(safeCvData);

    const { data: preferenceData, error: preferenceError } = await supabase
      .from('user_job_preferences')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (preferenceError) { setError(preferenceError.message); setLoading(false); setRefreshing(false); return; }

    let safePreferences = preferenceData as JobPreferences | null;

    if (!safePreferences) {
      const { error: createErr } = await supabase.rpc('ensure_user_job_preferences', { target_user_id: user.id });
      if (createErr) { setError(createErr.message); setLoading(false); setRefreshing(false); return; }

      const { data: created, error: createdErr } = await supabase
        .from('user_job_preferences')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (createdErr) { setError(createdErr.message); setLoading(false); setRefreshing(false); return; }
      safePreferences = created as JobPreferences | null;
    }

    setPreferences(safePreferences);
    setPreferenceForm(preferenceToForm(safePreferences, safeSources));

    // Last automatic search, to show whether the schedule is running.
    const { data: lastScheduled } = await supabase
      .from('job_search_runs')
      .select('created_at')
      .eq('user_id', user.id)
      .eq('metadata->>trigger', 'scheduled')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    setLastScheduledRunAt((lastScheduled as { created_at: string } | null)?.created_at ?? null);

    setDefaultCv(
      safePreferences?.default_cv_version_id
        ? safeCvData.find((cv) => cv.id === safePreferences?.default_cv_version_id) || null
        : null,
    );

    // List only jobs with a posting date inside "Date posted", then apply the
    // same filters as the search (closed, work model, experience level).
    const maxAgeDays = safePreferences?.max_job_age_days ?? 7;
    let jobQuery = supabase
      .from('job_ads')
      .select('id, title, company, location, work_model, salary_range, job_url, source, source_slug, source_posted_at, discovered_at, description, ignored, best_match_score, best_fit_label, recommendation, parsed_required_skills')
      .eq('user_id', user.id)
      .eq('ignored', false)
      .not('source_posted_at', 'is', null);

    if (maxAgeDays > 0) {
      const cutoffDate = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000 - 60 * 60 * 1000);
      jobQuery = jobQuery.gte('source_posted_at', cutoffDate.toISOString());
    }

    const { data: jobData, error: jobError } = await jobQuery
      .order('source_posted_at', { ascending: false })
      .limit(200);

    if (jobError) { setError(jobError.message); setLoading(false); setRefreshing(false); return; }

    const { kept: safeJobs, removed } = applyJobFilters(
      ((jobData || []) as JobAd[]).filter(isValidJob),
      safePreferences || {},
    );
    setJobs(safeJobs);
    setHiddenByFilters(Object.values(removed).reduce((total, count) => total + count, 0));

    const jobIds = safeJobs.map((j) => j.id);

    if (jobIds.length > 0) {
      const { data: matchData } = await supabase
        .from('job_match_results')
        .select('id, job_ad_id, cv_version_id, match_score, fit_label, recommendation, matched_skills, missing_skills, concerns, suggested_cv_angle, explanation, created_at')
        .eq('user_id', user.id)
        .in('job_ad_id', jobIds)
        .order('created_at', { ascending: false });

      const nextMap: Record<string, JobMatchResult> = {};
      ((matchData || []) as JobMatchResult[]).forEach((m) => {
        if (!nextMap[m.job_ad_id]) nextMap[m.job_ad_id] = m;
      });
      setMatchesByJobId(nextMap);
    } else {
      setMatchesByJobId({});
    }

    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Reset pagination when any filter changes
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [keyword, scoreView, sourceFilter]);

  // ── form helpers ─────────────────────────────────────────────────────────────

  const updatePreferenceForm = <K extends keyof PreferenceForm>(key: K, value: PreferenceForm[K]) => {
    setPreferenceForm((cur) => cur ? { ...cur, [key]: value } : cur);
  };

  const toggleSource = (slug: string) => {
    setPreferenceForm((cur) => {
      if (!cur) return cur;
      const exists = cur.enabledSources.includes(slug);
      return {
        ...cur,
        enabledSources: exists
          ? cur.enabledSources.filter((s) => s !== slug)
          : [...cur.enabledSources, slug],
      };
    });
  };

  // ── actions ──────────────────────────────────────────────────────────────────

  const handleSavePreferences = async (form = preferenceForm, savedMessage = 'Search profile saved.') => {
    if (!user || !form) return false;
    setSavingPreferences(true);
    setError('');
    setSuccess('');

    const payload = {
      user_id:               user.id,
      default_cv_version_id: form.defaultCvVersionId || null,
      target_titles:         splitCsv(form.targetTitles),
      preferred_locations:   splitCsv(form.preferredLocations),
      work_model:            form.workModel || 'any',
      min_match_score:       Number(form.minMatchScore) || 60,
      enabled_sources:       form.enabledSources,
      max_job_age_days:      maxAgeFromDatePosted(form.datePosted),
      automation_enabled:    form.automationEnabled,
      ...(supportsExcludedKeywords(preferences)
        ? { excluded_keywords: splitCsv(form.excludedKeywords) }
        : {}),
      ...(supportsExperienceLevels(preferences)
        ? { experience_levels: form.experienceLevels }
        : {}),
    };

    const { error: saveError } = await supabase
      .from('user_job_preferences')
      .upsert(payload, { onConflict: 'user_id' });

    if (saveError) { setError(saveError.message); setSavingPreferences(false); return false; }

    setSuccess(savedMessage);
    setEditingProfile(false);
    setSavingPreferences(false);
    await fetchData(true);
    return true;
  };

  // Date posted and Work model change in place from the search bar, like
  // LinkedIn's filter pills, and are saved straight away.
  const handleQuickFilter = (patch: Partial<PreferenceForm>) => {
    if (!preferenceForm) return;
    const previous = preferenceForm;
    const next = { ...preferenceForm, ...patch };
    setPreferenceForm(next);
    void handleSavePreferences(next, 'Filters updated.').then((saved) => {
      if (!saved) setPreferenceForm(previous);
    });
  };

  const handleRefresh = () => fetchData(true);

  const handleRunSearchNow = async () => {
    if (!user) return;
    setSuccess('');
    setError('');

    // Searches use only the saved titles and locations; nothing is assumed.
    if (!preferences?.target_titles?.length || !preferences?.preferred_locations?.length) {
      setError('Add at least one target job title and one preferred location in your preferences and save them, then run the search again.');
      return;
    }
    setRefreshing(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const supabaseUrl = (supabase as unknown as { supabaseUrl: string }).supabaseUrl
        ?? import.meta.env.VITE_SUPABASE_URL;

      const response = await fetch(`${supabaseUrl}/functions/v1/job-pipeline`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({}),
      });

      // Try to parse JSON regardless of status so we can surface the real error message
      let payload: Record<string, unknown> = {};
      try {
        payload = await response.json();
      } catch {
        // body wasn't JSON — ignore, we'll fall through to the status check below
      }

      if (!response.ok) {
        const msg =
          (typeof payload.error === 'string' && payload.error) ||
          (typeof payload.message === 'string' && payload.message) ||
          `Job pipeline failed (HTTP ${response.status}).`;
        setError(msg);
        setRefreshing(false);
        return;
      }

      // Each title/location pair is searched on every source; a run has a cap.
      const searched = Array.isArray(payload.combinations_searched) ? payload.combinations_searched.length : null;
      const skipped = Array.isArray(payload.combinations_skipped) ? payload.combinations_skipped.length : 0;

      setSuccess(
        [
          'Job search completed.',
          searched != null
            ? `Searched ${searched} of ${searched + skipped} title and location combinations${skipped ? ' (the rest did not fit in this run\'s search limit)' : ''}.`
            : '',
          `Scanned: ${payload.scanned_count ?? 0}.`,
          `Saved: ${payload.saved_count ?? 0}.`,
          `Scored: ${payload.scored_count ?? 0}.`,
          `Duplicates: ${payload.duplicate_count ?? 0}.`,
          describeFilteredOut(payload.filtered_out as Partial<Record<FilterReason, number>> | undefined, preferences?.max_job_age_days)
            ? `Filtered out: ${describeFilteredOut(payload.filtered_out as Partial<Record<FilterReason, number>> | undefined, preferences?.max_job_age_days)}.`
            : '',
          describeSourceSummaries(payload.source_summaries as SourceSummary[] | undefined, datePostedLabel(preferences?.max_job_age_days)),
          payload.no_cv_warning ? 'No CV was found, so jobs were saved without full CV scoring.' : '',
          // Why a search found nothing (no LinkedIn listings, or a search service error).
          ...describeSearchReports(payload.search_reports as SearchReport[] | undefined),
        ].filter(Boolean).join(' '),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error running job pipeline.');
    }

    await fetchData(true);
    setRefreshing(false);
  };

  const handleIgnoreJob = async (jobId: string) => {
    if (!user) return;
    setIgnoringJobId(jobId);
    setError('');

    const { error: ignoreError } = await supabase
      .from('job_ads')
      .update({ ignored: true, ignored_at: new Date().toISOString() })
      .eq('id', jobId)
      .eq('user_id', user.id);

    if (ignoreError) { setError(ignoreError.message); setIgnoringJobId(null); return; }

    setJobs((prev) => prev.filter((j) => j.id !== jobId));
    setIgnoringJobId(null);
  };

  const handleScoreJob = async (job: JobAd) => {
    if (!user) return;
    setScoringJobId(job.id);
    setError('');
    setSuccess('');

    const cvVersionId = preferences?.default_cv_version_id;

    const { data, error: fnError } = await supabase.functions.invoke('score-job', {
      method: 'POST',
      body: { job_ad_id: job.id, cv_version_id: cvVersionId || null },
    });

    if (fnError) {
      setError(fnError.message || 'Scoring failed. Make sure the score-job function is deployed.');
      setScoringJobId(null);
      return;
    }

    const result = data as JobMatchResult | null;

    if (result) {
      setMatchesByJobId((prev) => ({ ...prev, [job.id]: result }));
      setJobs((prev) =>
        prev.map((j) =>
          j.id === job.id
            ? { ...j, best_match_score: result.match_score, best_fit_label: result.fit_label, recommendation: result.recommendation }
            : j,
        ),
      );
      setSuccess(`Scored: ${result.match_score}/100 — ${getRecommendationLabel(result.recommendation)}`);
    }

    setScoringJobId(null);
  };

  const handleCreateApplication = async (job: JobAd) => {
    if (!user) return;
    const match = matchesByJobId[job.id];
    setCreatingApplicationId(job.id);
    setError('');
    setSuccess('');

    const { data: existing, error: existingError } = await supabase
      .from('applications')
      .select('id')
      .eq('user_id', user.id)
      .eq('job_ad_id', job.id)
      .maybeSingle();

    if (existingError) { setError(existingError.message); setCreatingApplicationId(null); return; }

    if (existing?.id) {
      setCreatingApplicationId(null);
      window.location.href = `/applications/${existing.id}`;
      return;
    }

    const { data: inserted, error: appError } = await supabase
      .from('applications')
      .insert({
        user_id:                  user.id,
        role_title:               cleanJobTitle(job.title),
        application_link:         job.job_url || null,
        source:                   sourceLabels[job.source_slug || ''] || job.source || 'Job Automation',
        status:                   'wishlist',
        date_applied:             null,
        location:                 job.location,
        job_type:                 job.work_model,
        salary_range:             job.salary_range,
        notes: [
          'Created from Job Automation.',
          `Company: ${resolveCompany(job)}`,
          `Source: ${sourceLabels[job.source_slug || ''] || job.source || 'Unknown'}`,
          match ? `Match score: ${match.match_score}/100 (${match.fit_label})` : '',
          match ? `Recommendation: ${match.recommendation}` : '',
          match?.suggested_cv_angle ? `Suggested CV angle: ${match.suggested_cv_angle}` : '',
        ].filter(Boolean).join('\n'),
        job_ad_id:                job.id,
        job_match_result_id:      match?.id || null,
        job_search_source:        job.source_slug || job.source || null,
        job_match_recommendation: match?.recommendation || job.recommendation || null,
        cv_version_id:            match?.cv_version_id || preferences?.default_cv_version_id || null,
        match_score:              match?.match_score || job.best_match_score || null,
        fit_label:                match?.fit_label || job.best_fit_label || null,
        job_description:          job.description || null,
      })
      .select('id')
      .single();

    if (appError) { setError(appError.message); setCreatingApplicationId(null); return; }

    await supabase.from('application_events').insert({
      user_id:        user.id,
      application_id: inserted.id,
      event_type:     'job_automation',
      title:          'Application created from Job Automation',
      description:    match
        ? `Created from matched job. Match score: ${match.match_score}/100.`
        : 'Created from matched job.',
      event_date: new Date().toISOString(),
    });

    setCreatingApplicationId(null);
    window.location.href = `/applications/${inserted.id}`;
  };

  // Opens the CV tailoring flow with this job's description filled in and the
  // CV it was scored against (or the default CV) selected; a CV can also be
  // picked there.
  const handleTailorCv = (job: JobAd) => {
    const match = matchesByJobId[job.id];
    const cvVersionId = match?.cv_version_id || preferences?.default_cv_version_id;

    const params = new URLSearchParams({ jobAdId: job.id });
    if (cvVersionId) params.set('cvVersionId', cvVersionId);

    navigate(`/resume-builder/flow?${params.toString()}`);
  };

  const toggleDescription = (jobId: string) => {
    setExpandedDescriptions((prev) => ({ ...prev, [jobId]: !prev[jobId] }));
  };

  // ── derived state ─────────────────────────────────────────────────────────────

  /** Unique sources that actually appear in the current job list. */
  const presentSources = useMemo(() => {
    const slugs = new Set(jobs.map((j) => j.source_slug || j.source || 'unknown'));
    return Array.from(slugs).sort();
  }, [jobs]);

  const filteredJobs = useMemo(() => {
    let next = [...jobs];

    // keyword
    if (keyword.trim()) {
      const value = normalise(keyword);
      next = next.filter((job) => {
        const match = matchesByJobId[job.id];
        const haystack = [
          job.title, job.company, job.location, job.description,
          job.work_model, job.salary_range,
          match?.matched_skills?.join(' '),
          match?.missing_skills?.join(' '),
          match?.suggested_cv_angle,
        ].filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(value);
      });
    }

    // ⑤ source filter
    if (sourceFilter !== 'all') {
      next = next.filter((job) => (job.source_slug || job.source || 'unknown') === sourceFilter);
    }

    // ⑥ score / recommendation view — now includes scored / unscored chips
    if (scoreView !== 'all') {
      next = next.filter((job) => {
        const match = matchesByJobId[job.id];
        const rec   = match?.recommendation || job.recommendation;
        const score = match?.match_score ?? job.best_match_score;

        if (scoreView === 'unscored') return score == null;
        if (scoreView === 'scored')   return score != null;

        const numScore = score ?? 0;
        if (scoreView === 'recommended') return rec === 'recommended' || numScore >= 85;
        if (scoreView === 'possible')    return rec === 'possible'    || (numScore >= 70 && numScore < 85);
        if (scoreView === 'stretch')     return rec === 'stretch'     || (numScore >= 55 && numScore < 70);
        return true;
      });
    }

    next.sort((a, b) => {
      const aScore = matchesByJobId[a.id]?.match_score ?? a.best_match_score ?? -1;
      const bScore = matchesByJobId[b.id]?.match_score ?? b.best_match_score ?? -1;
      if (bScore !== aScore) return bScore - aScore;
      const aDate = new Date(a.source_posted_at || a.discovered_at).getTime();
      const bDate = new Date(b.source_posted_at || b.discovered_at).getTime();
      return bDate - aDate;
    });

    return next;
  }, [jobs, keyword, scoreView, sourceFilter, matchesByJobId]);

  const visibleJobs = filteredJobs.slice(0, visibleCount);

  // One LinkedIn search link per saved title and location (free, so not capped
  // like paid searches; at most 12 shown).
  const linkedInSearches = orderCombinations(
    cleanTerms(preferences?.target_titles),
    cleanTerms(preferences?.preferred_locations),
  )
    .slice(0, 12)
    .map(({ title, location }) => ({
      title,
      location,
      url: linkedInSearchUrl({
        title,
        location,
        maxAgeDays: preferences?.max_job_age_days,
        workModel: preferences?.work_model,
        experienceLevels: preferences?.experience_levels,
      }),
    }));
  const hasMore     = visibleCount < filteredJobs.length;

  const clearSearch = () => {
    setKeyword('');
    setScoreView('all');
    setSourceFilter('all');
  };

  const hasActiveFilter = keyword || scoreView !== 'all' || sourceFilter !== 'all';

  // ⑦ Warn when no default CV is set
  const missingDefaultCv = !preferences?.default_cv_version_id;

  // ── counts for chips ──────────────────────────────────────────────────────────
  const scoredCount   = jobs.filter((j) => (matchesByJobId[j.id]?.match_score ?? j.best_match_score) != null).length;
  const unscoredCount = jobs.length - scoredCount;

  // ── render ────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-3 p-10 text-slate-500">
        <Loader2 size={18} className="animate-spin" />
        Loading Job Automation…
      </div>
    );
  }

  return (
    <div className="w-full max-w-4xl mx-auto">

      {/* ── Page header ───────────────────────────────────────────────────────── */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Job Automation</h1>
          <p className="text-sm text-slate-500 mt-0.5">Fresh jobs from your saved search, scored against your CV.</p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            aria-label="Refresh"
            title="Refresh"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            {refreshing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          </button>
          <button
            type="button"
            onClick={handleRunSearchNow}
            disabled={refreshing}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-full bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {refreshing ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
            Run search
          </button>
        </div>
      </div>

      {/* ── Alerts ────────────────────────────────────────────────────────────── */}
      {error && (
        <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 flex gap-2">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setError('')} className="shrink-0 text-red-400 hover:text-red-700">
            <X size={16} />
          </button>
        </div>
      )}

      {success && (
        <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800 flex gap-2">
          <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
          <span className="flex-1">{success}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setSuccess('')} className="shrink-0 text-emerald-500 hover:text-emerald-800">
            <X size={16} />
          </button>
        </div>
      )}

      {/* Without a default CV, scoring and tailoring can't work. */}
      {missingDefaultCv && !editingProfile && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 flex items-start gap-2">
          <TriangleAlert size={16} className="shrink-0 mt-0.5 text-amber-500" />
          <span>
            <strong>No default CV selected.</strong> Scoring and CV tailoring won't work until you pick one.{' '}
            <button type="button" className="underline font-medium hover:text-amber-900" onClick={() => setEditingProfile(true)}>
              Choose a CV
            </button>
          </span>
        </div>
      )}

      {/* ── Search: what, where and filters ───────────────────────────────────── */}
      <section className="mb-4 rounded-2xl border border-slate-200 bg-white">
        {!preferenceForm ? (
          <div className="p-4 text-sm text-slate-500">No preferences found.</div>
        ) : editingProfile ? (
          <div className="p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3 mb-4">
              <h2 className="font-semibold text-slate-900">Edit search</h2>
              <button
                type="button"
                aria-label="Close"
                onClick={() => {
                  setPreferenceForm(preferenceToForm(preferences, jobSources));
                  setEditingProfile(false);
                }}
                className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-5">
              <FormSection title="What and where">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <TextInput
                    label="Job titles"
                    value={preferenceForm.targetTitles}
                    onChange={(v) => updatePreferenceForm('targetTitles', v)}
                    placeholder="Support Specialist, Junior Software Engineer"
                  />
                  <TextInput
                    label="Locations"
                    value={preferenceForm.preferredLocations}
                    onChange={(v) => updatePreferenceForm('preferredLocations', v)}
                    placeholder="Warsaw, Remote"
                  />
                  <div className="sm:col-span-2">
                    <label htmlFor="excluded-keywords" className="block text-xs font-medium text-slate-600 mb-1">
                      Exclude jobs mentioning
                    </label>
                    <input
                      id="excluded-keywords"
                      value={preferenceForm.excludedKeywords}
                      disabled={!supportsExcludedKeywords(preferences)}
                      placeholder="Senior, Manager, 10+ years"
                      onChange={(e) => updatePreferenceForm('excludedKeywords', e.target.value)}
                      className={`${INPUT_CLASS} disabled:bg-slate-100 disabled:text-slate-400`}
                    />
                    <p className="mt-1 text-xs text-slate-500">
                      {supportsExcludedKeywords(preferences)
                        ? 'Jobs that mention any of these get a lower match score and are flagged. Separate with commas.'
                        : 'Not available yet: the database needs the excluded_keywords column (supabase/sql/2026-10-17_job_preferences_excluded_keywords.sql).'}
                    </p>
                  </div>
                </div>
              </FormSection>

              <FormSection title="Filters">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <SelectInput
                    label="Date posted"
                    value={preferenceForm.datePosted}
                    onChange={(v) => updatePreferenceForm('datePosted', v as DatePosted)}
                    options={DATE_POSTED_OPTIONS}
                  />
                  <SelectInput
                    label="Work model"
                    value={preferenceForm.workModel}
                    onChange={(v) => updatePreferenceForm('workModel', v)}
                    options={WORK_MODEL_OPTIONS}
                  />
                </div>
                <p className="text-xs font-medium text-slate-600 mt-3 mb-1.5">Experience level</p>
                <div className="flex flex-wrap gap-1.5">
                  {EXPERIENCE_LEVEL_OPTIONS.map((level) => {
                    const active = preferenceForm.experienceLevels.includes(level.value);
                    return (
                      <ToggleChip
                        key={level.value}
                        active={active}
                        disabled={!supportsExperienceLevels(preferences)}
                        onClick={() =>
                          updatePreferenceForm(
                            'experienceLevels',
                            active
                              ? preferenceForm.experienceLevels.filter((value) => value !== level.value)
                              : [...preferenceForm.experienceLevels, level.value],
                          )
                        }
                      >
                        {level.label}
                      </ToggleChip>
                    );
                  })}
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {supportsExperienceLevels(preferences)
                    ? 'None selected means any level. Estimated from the title and description; roles that give no sign of their level count as Associate.'
                    : 'Not available yet: the database needs the experience_levels column (supabase/sql/2026-10-18_job_search_filters.sql).'}
                </p>
              </FormSection>

              <FormSection title="Sources">
                <div className="flex flex-wrap gap-1.5">
                  {jobSources.map((source) => (
                    <ToggleChip
                      key={source.slug}
                      active={preferenceForm.enabledSources.includes(source.slug)}
                      onClick={() => toggleSource(source.slug)}
                    >
                      {source.name}
                    </ToggleChip>
                  ))}
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  LinkedIn, Google Jobs and Adzuna give each job's posting date. The other boards are found through
                  Google's page index, which often has no date, so with a Date posted filter most of their results are
                  dropped. Each run lists what every source found and kept.
                </p>
              </FormSection>

              <FormSection title="Scoring and alerts">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <SelectInput
                    label="Default CV"
                    value={preferenceForm.defaultCvVersionId}
                    onChange={(v) => updatePreferenceForm('defaultCvVersionId', v)}
                    options={[
                      { value: '', label: 'No default CV selected' },
                      ...cvVersions.map((cv) => ({
                        value: cv.id,
                        label: `${cv.name || 'Untitled CV'}${cv.target_role ? ` — ${cv.target_role}` : ''}`,
                      })),
                    ]}
                  />
                  <NumberInput
                    label="Minimum match score"
                    value={preferenceForm.minMatchScore}
                    min={0}
                    max={100}
                    onChange={(v) => updatePreferenceForm('minMatchScore', v)}
                  />
                </div>
                <div className="mt-3 flex items-center justify-between gap-4 rounded-xl bg-slate-50 px-3 py-2.5">
                  <p className="text-sm text-slate-600">
                    <span className="font-medium text-slate-800">Automatic searches.</span> Searches automatically a
                    few times a day with this profile and sends you a notification when it finds new jobs scoring at or
                    above your minimum score.
                  </p>
                  <Switch
                    label="Automatic searches"
                    checked={preferenceForm.automationEnabled}
                    onChange={(checked) => updatePreferenceForm('automationEnabled', checked)}
                  />
                </div>
              </FormSection>
            </div>

            <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={() => {
                  setPreferenceForm(preferenceToForm(preferences, jobSources));
                  setEditingProfile(false);
                }}
                className="h-9 rounded-full border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleSavePreferences()}
                disabled={savingPreferences}
                className="inline-flex h-9 items-center gap-2 rounded-full bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {savingPreferences ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save search
              </button>
            </div>
          </div>
        ) : (
          <div className="p-4 space-y-3">
            {/* What and where, like LinkedIn's search box */}
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900">
                  <Search size={15} className="text-slate-400" />
                  {preferences?.target_titles?.length ? preferences.target_titles.join(', ') : 'No job titles yet'}
                </span>
                <span className="inline-flex items-center gap-1.5 text-slate-700">
                  <MapPin size={15} className="text-slate-400" />
                  {preferences?.preferred_locations?.length ? preferences.preferred_locations.join(', ') : 'No locations yet'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setEditingProfile(true)}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-slate-300 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <SlidersHorizontal size={14} />
                Edit search
              </button>
            </div>

            {/* Filters: Date posted and Work model change in place; the rest open Edit search. */}
            <div className="-mx-4 flex items-center gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
              <PillSelect
                label="Date posted"
                value={preferenceForm.datePosted}
                active={preferenceForm.datePosted !== 'any_time'}
                disabled={savingPreferences}
                options={DATE_POSTED_OPTIONS}
                onChange={(v) => handleQuickFilter({ datePosted: v as DatePosted })}
              />
              <PillSelect
                label="Work model"
                value={preferenceForm.workModel || 'any'}
                active={(preferenceForm.workModel || 'any') !== 'any'}
                disabled={savingPreferences}
                options={WORK_MODEL_OPTIONS.map((o) => (o.value === 'any' ? { ...o, label: 'Any work model' } : o))}
                onChange={(v) => handleQuickFilter({ workModel: v })}
              />
              {supportsExperienceLevels(preferences) && (
                <Pill
                  active={Boolean(preferences?.experience_levels?.length)}
                  onClick={() => setEditingProfile(true)}
                >
                  {preferences?.experience_levels?.length
                    ? preferences.experience_levels.map(experienceLevelLabel).join(', ')
                    : 'Any experience level'}
                </Pill>
              )}
              {supportsExcludedKeywords(preferences) && Boolean(preferences?.excluded_keywords?.length) && (
                <Pill active onClick={() => setEditingProfile(true)} title={preferences?.excluded_keywords?.join(', ')}>
                  Excluding: {shortList(preferences?.excluded_keywords || [], 3)}
                </Pill>
              )}
              <Pill
                onClick={() => setEditingProfile(true)}
                title={(preferences?.enabled_sources || []).map((s) => sourceLabels[s] || s).join(', ')}
              >
                {preferences?.enabled_sources?.length
                  ? shortList(preferences.enabled_sources.map((s) => sourceLabels[s] || s), 2, 'sources')
                  : 'No sources selected'}
              </Pill>
              <Pill warning={missingDefaultCv} onClick={() => setEditingProfile(true)}>
                {defaultCv ? `CV: ${defaultCv.name || 'Untitled CV'}` : 'No CV selected'}
              </Pill>
              <Pill onClick={() => setEditingProfile(true)}>Min score {preferences?.min_match_score ?? 60}</Pill>
              <Pill active={Boolean(preferences?.automation_enabled)} onClick={() => setEditingProfile(true)}>
                <span
                  className={`h-1.5 w-1.5 rounded-full ${preferences?.automation_enabled ? 'bg-emerald-500' : 'bg-slate-300'}`}
                />
                Automation:{' '}
                {!preferences?.automation_enabled
                  ? 'Off'
                  : lastScheduledRunAt
                    ? `On · last automatic search ${formatPostedAgo(lastScheduledRunAt).replace(/^Posted /, '').toLowerCase()}`
                    : 'On · no automatic search has run yet'}
              </Pill>
            </div>

            {/* LinkedIn's own search, for filters only it has */}
            {linkedInSearches.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-slate-100 pt-3 text-xs text-slate-500">
                <span
                  title={`Opens LinkedIn with your Date posted (${datePostedLabel(preferences?.max_job_age_days).toLowerCase()}), work model and experience level, newest first.`}
                >
                  Search LinkedIn directly, then add &ldquo;Under 10 applicants&rdquo;:
                </span>
                {linkedInSearches.map((search) => (
                  <a
                    key={search.url}
                    href={search.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-blue-700 hover:underline"
                  >
                    {search.title} · {search.location}
                    <ExternalLink size={12} />
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── Jobs ──────────────────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden">

        {/* Toolbar */}
        <div className="border-b border-slate-200 px-4 py-3 space-y-2.5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <h2 className="font-semibold text-slate-900">Jobs for you</h2>
              <p className="text-xs text-slate-500">
                {filteredJobs.length} result{filteredJobs.length === 1 ? '' : 's'}
                {jobs.length !== filteredJobs.length ? ` of ${jobs.length}` : ''}
                {` · posted ${datePostedLabel(preferences?.max_job_age_days).toLowerCase()}`}
                {hiddenByFilters > 0 ? ` · ${hiddenByFilters} hidden by your filters` : ''}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative flex-1 sm:flex-none">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="Search jobs…"
                  aria-label="Search jobs"
                  className="h-8 w-full sm:w-48 rounded-full border border-slate-300 bg-white pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                />
              </div>

              {hasActiveFilter && (
                <button
                  type="button"
                  onClick={clearSearch}
                  className="inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
                >
                  <X size={13} />
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="-mx-4 flex items-center gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
            <FilterChip active={scoreView === 'all'} onClick={() => setScoreView('all')}>All</FilterChip>
            <FilterChip active={scoreView === 'recommended'} onClick={() => setScoreView('recommended')}>Recommended</FilterChip>
            <FilterChip active={scoreView === 'possible'} onClick={() => setScoreView('possible')}>Possible</FilterChip>
            <FilterChip active={scoreView === 'stretch'} onClick={() => setScoreView('stretch')}>Stretch</FilterChip>

            <span className="mx-0.5 h-4 w-px shrink-0 bg-slate-200" />

            <FilterChip
              active={scoreView === 'scored'}
              onClick={() => setScoreView(scoreView === 'scored' ? 'all' : 'scored')}
              count={scoredCount}
            >
              Scored
            </FilterChip>
            <FilterChip
              active={scoreView === 'unscored'}
              onClick={() => setScoreView(scoreView === 'unscored' ? 'all' : 'unscored')}
              count={unscoredCount}
              countVariant="warning"
            >
              Unscored
            </FilterChip>

            {/* Sources that appear in the current list */}
            {presentSources.length > 1 && (
              <>
                <span className="mx-0.5 h-4 w-px shrink-0 bg-slate-200" />
                {presentSources.map((slug) => (
                  <FilterChip
                    key={slug}
                    active={sourceFilter === slug}
                    onClick={() => setSourceFilter(sourceFilter === slug ? 'all' : slug)}
                  >
                    {sourceLabels[slug] || slug}
                  </FilterChip>
                ))}
              </>
            )}
          </div>
        </div>

        {filteredJobs.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <Briefcase size={32} className="mx-auto text-slate-300 mb-2" />
            <h3 className="font-semibold text-slate-800">No matched jobs yet</h3>
            <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
              Nothing posted {datePostedLabel(preferences?.max_job_age_days).toLowerCase()} matches your search profile. Run search, or widen Date posted, work model or experience level.
            </p>
          </div>
        ) : (
          <>
            <ul className="divide-y divide-slate-100">
              {visibleJobs.map((job) => {
                const match         = matchesByJobId[job.id];
                const score         = match?.match_score ?? job.best_match_score;
                const rec           = match?.recommendation || job.recommendation || 'unscored';
                const matchedSkills = (match?.matched_skills || []).filter(Boolean);
                const missingSkills = (match?.missing_skills || []).filter(Boolean);
                const source        = job.source_slug || job.source || 'unknown';
                const isUnscored    = score == null;
                const company       = resolveCompany(job);
                const scoreLabel    = isUnscored ? 'Not scored yet' : `${score} · ${getRecommendationLabel(rec)}`;
                const workModel     = job.work_model && job.work_model !== 'any' ? WORK_MODEL_LABELS[job.work_model] || job.work_model : '';
                const description   = stripHtml(job.description);
                const hasDetails    = Boolean(description || match?.suggested_cv_angle || matchedSkills.length || missingSkills.length);
                const showDetails   = expandedDescriptions[job.id] ?? false;

                return (
                  <li key={job.id}>
                    <article className="flex gap-3 px-4 py-3.5 hover:bg-slate-50/70">
                      <CompanyMark name={company} />

                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <h3 className="text-[15px] font-semibold leading-snug">
                              <a
                                href={job.job_url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-blue-700 hover:underline"
                              >
                                {cleanJobTitle(job.title)}
                              </a>
                            </h3>
                            <p className="text-sm text-slate-800">{company}</p>
                            <p className="text-sm text-slate-500">
                              {job.location || 'Location not specified'}
                              {workModel ? ` (${workModel})` : ''}
                            </p>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <ScoreBadge score={score} label={scoreLabel} className="hidden sm:inline-flex" />
                            <button
                              type="button"
                              onClick={() => handleIgnoreJob(job.id)}
                              disabled={ignoringJobId === job.id}
                              aria-label="Ignore"
                              title="Ignore this job"
                              className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
                            >
                              {ignoringJobId === job.id ? <Loader2 size={16} className="animate-spin" /> : <X size={16} />}
                            </button>
                          </div>
                        </div>

                        <ScoreBadge score={score} label={scoreLabel} className="mt-1.5 inline-flex sm:hidden" />
                        <p className="mt-1 text-xs text-slate-500">
                          <span className={isPostedToday(job.source_posted_at) ? 'font-medium text-emerald-700' : ''}>
                            {formatPostedAgo(job.source_posted_at)}
                          </span>
                          {` · ${sourceLabels[source] || source}`}
                          {job.salary_range ? ` · ${job.salary_range}` : ''}
                          {!isUnscored && (matchedSkills.length > 0 || missingSkills.length > 0)
                            ? ` · ${matchedSkills.length} skills matched, ${missingSkills.length} missing`
                            : ''}
                        </p>

                        {showDetails && (
                          <div className="mt-2 space-y-2">
                            {description && <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-line">{description}</p>}
                            {match?.suggested_cv_angle && (
                              <div className="rounded-lg bg-slate-50 px-3 py-2">
                                <p className="text-xs font-semibold text-slate-500 mb-0.5">Suggested CV angle</p>
                                <p className="text-xs text-slate-600">{match.suggested_cv_angle}</p>
                              </div>
                            )}
                            {(matchedSkills.length > 0 || missingSkills.length > 0) && (
                              <div className="flex flex-wrap gap-3">
                                {matchedSkills.length > 0 && <SkillList title="Matched" items={matchedSkills} positive />}
                                {missingSkills.length > 0 && <SkillList title="Missing" items={missingSkills} />}
                              </div>
                            )}
                          </div>
                        )}

                        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                          {isUnscored ? (
                            <ActionButton
                              primary
                              busy={scoringJobId === job.id}
                              icon={<Zap size={13} />}
                              onClick={() => handleScoreJob(job)}
                            >
                              Score Job
                            </ActionButton>
                          ) : (
                            <ActionButton
                              primary
                              busy={creatingApplicationId === job.id}
                              icon={<Briefcase size={13} />}
                              onClick={() => handleCreateApplication(job)}
                            >
                              Create App
                            </ActionButton>
                          )}

                          {!isUnscored && (
                            <ActionButton icon={<Sparkles size={13} />} onClick={() => handleTailorCv(job)}>
                              Tailor CV
                            </ActionButton>
                          )}

                          {isUnscored && (
                            <ActionButton
                              busy={creatingApplicationId === job.id}
                              icon={<Briefcase size={13} />}
                              onClick={() => handleCreateApplication(job)}
                            >
                              Create App
                            </ActionButton>
                          )}

                          <a
                            href={job.job_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex h-7 items-center gap-1.5 rounded-full border border-slate-300 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          >
                            <ExternalLink size={13} />
                            View Job
                          </a>

                          {!isUnscored && (
                            <button
                              type="button"
                              onClick={() => handleScoreJob(job)}
                              disabled={scoringJobId === job.id}
                              className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50"
                            >
                              {scoringJobId === job.id ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
                              Re-score
                            </button>
                          )}

                          {hasDetails && (
                            <button
                              type="button"
                              onClick={() => toggleDescription(job.id)}
                              aria-expanded={showDetails}
                              className="ml-auto inline-flex h-7 items-center gap-1 rounded-full px-2 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                            >
                              {showDetails ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                              {showDetails ? 'Hide details' : 'Details'}
                            </button>
                          )}
                        </div>
                      </div>
                    </article>
                  </li>
                );
              })}
            </ul>

            {/* Load More */}
            {hasMore && (
              <div className="border-t border-slate-100 p-3 flex flex-col items-center gap-1">
                <button
                  type="button"
                  onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  <ChevronDown size={15} />
                  Show {Math.min(PAGE_SIZE, filteredJobs.length - visibleCount)} more
                </button>
                <p className="text-xs text-slate-400">
                  Showing {visibleCount} of {filteredJobs.length} jobs
                </p>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
};

// ─── sub-components ───────────────────────────────────────────────────────────

const INPUT_CLASS =
  'w-full h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400';

// "a, b +3" or "10 sources": a short label for a list.
const shortList = (items: string[], max: number, noun?: string) => {
  if (items.length <= max) return items.join(', ');
  return noun ? `${items.length} ${noun}` : `${items.slice(0, max).join(', ')} +${items.length - max}`;
};

interface FilterChipProps {
  active: boolean;
  onClick: () => void;
  count?: number;
  countVariant?: 'default' | 'warning';
  children: React.ReactNode;
}
const FilterChip: React.FC<FilterChipProps> = ({
  active,
  onClick,
  count,
  countVariant = 'default',
  children,
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-medium transition-colors ${
      active
        ? 'bg-slate-900 text-white'
        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
    }`}
  >
    {children}
    {count !== undefined && (
      <span
        className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none ${
          active
            ? 'bg-white/20 text-white'
            : countVariant === 'warning'
            ? 'bg-amber-100 text-amber-700'
            : 'bg-slate-200 text-slate-600'
        }`}
      >
        {count}
      </span>
    )}
  </button>
);

// A search filter pill, green when it narrows the search (as on LinkedIn).
const pillClass = (active?: boolean, warning?: boolean) =>
  `inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs font-medium transition-colors ${
    warning
      ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
      : active
      ? 'border-emerald-600 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
  }`;

interface PillProps {
  active?: boolean;
  warning?: boolean;
  title?: string;
  onClick: () => void;
  children: React.ReactNode;
}
const Pill: React.FC<PillProps> = ({ active, warning, title, onClick, children }) => (
  <button type="button" title={title} onClick={onClick} className={pillClass(active, warning)}>
    {children}
  </button>
);

interface PillSelectProps {
  label: string;
  value: string;
  active: boolean;
  disabled?: boolean;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}
// A filter that changes in place, like LinkedIn's Date posted dropdown.
const PillSelect: React.FC<PillSelectProps> = ({ label, value, active, disabled, options, onChange }) => (
  <span className="relative inline-flex shrink-0">
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={`${pillClass(active)} appearance-none pr-7 cursor-pointer focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:opacity-60`}
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
    <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-current opacity-70" />
  </span>
);

interface ToggleChipProps {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}
const ToggleChip: React.FC<ToggleChipProps> = ({ active, disabled, onClick, children }) => (
  <button
    type="button"
    aria-pressed={active}
    disabled={disabled}
    onClick={onClick}
    className={`inline-flex h-7 items-center gap-1 rounded-full border px-3 text-xs font-medium transition-colors disabled:opacity-50 ${
      active
        ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
        : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
    }`}
  >
    {active && <Check size={12} />}
    {children}
  </button>
);

interface SwitchProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}
const Switch: React.FC<SwitchProps> = ({ label, checked, onChange }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    onClick={() => onChange(!checked)}
    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
      checked ? 'bg-emerald-600' : 'bg-slate-300'
    }`}
  >
    <span
      className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
        checked ? 'translate-x-5' : 'translate-x-0.5'
      }`}
    />
  </button>
);

interface ActionButtonProps {
  primary?: boolean;
  busy?: boolean;
  icon: React.ReactNode;
  onClick: () => void;
  children: React.ReactNode;
}
const ActionButton: React.FC<ActionButtonProps> = ({ primary, busy, icon, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={busy}
    className={`inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium disabled:opacity-50 ${
      primary
        ? 'bg-slate-900 text-white hover:bg-slate-700'
        : 'border border-slate-300 text-slate-700 hover:bg-slate-50'
    }`}
  >
    {busy ? <Loader2 size={13} className="animate-spin" /> : icon}
    {children}
  </button>
);

const ScoreBadge: React.FC<{ score?: number | null; label: string; className?: string }> = ({ score, label, className = '' }) => (
  <span className={`items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${getScoreBadgeClass(score)} ${className}`}>
    {label}
  </span>
);

// The company's initial in a square, where LinkedIn shows the logo.
const CompanyMark: React.FC<{ name: string }> = ({ name }) => (
  <div
    aria-hidden="true"
    className="hidden sm:flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-base font-semibold text-slate-500"
  >
    {(name.trim()[0] || '?').toUpperCase()}
  </div>
);

const FormSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div>
    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">{title}</h3>
    {children}
  </div>
);

interface SelectInputProps {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}
const SelectInput: React.FC<SelectInputProps> = ({ label, value, options, onChange }) => (
  <label className="block">
    <span className="block text-xs font-medium text-slate-600 mb-1">{label}</span>
    <select value={value} onChange={(e) => onChange(e.target.value)} className={INPUT_CLASS}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </label>
);

interface TextInputProps {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}
const TextInput: React.FC<TextInputProps> = ({ label, value, placeholder, onChange }) => (
  <label className="block">
    <span className="block text-xs font-medium text-slate-600 mb-1">{label}</span>
    <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={INPUT_CLASS} />
  </label>
);

interface NumberInputProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}
const NumberInput: React.FC<NumberInputProps> = ({ label, value, min, max, onChange }) => (
  <label className="block">
    <span className="block text-xs font-medium text-slate-600 mb-1">{label}</span>
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={(e) => onChange(Number(e.target.value))}
      className={INPUT_CLASS}
    />
  </label>
);

interface SkillListProps {
  title: string;
  items: string[];
  positive?: boolean;
}
const SkillList: React.FC<SkillListProps> = ({ title, items, positive = false }) => (
  <div>
    <p className="text-xs font-semibold text-slate-500 mb-1">{title}</p>
    <div className="flex flex-wrap gap-1.5">
      {items.slice(0, 6).map((item) => (
        <span
          key={item}
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            positive ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
          }`}
        >
          {item}
        </span>
      ))}
    </div>
  </div>
);
