import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Briefcase,
  CalendarClock,
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
  Settings,
  Sparkles,
  Trash2,
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
  maxJobAgeDays: number;
  defaultCvVersionId: string;
  automationEnabled: boolean;
  enabledSources: string[];
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
  maxJobAgeDays:      preferences?.max_job_age_days ?? 7,
  defaultCvVersionId: preferences?.default_cv_version_id || '',
  automationEnabled:  Boolean(preferences?.automation_enabled),
  enabledSources:     preferences?.enabled_sources?.length
    ? preferences.enabled_sources
    : sources.map((s) => s.slug),
});

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

// ─── component ────────────────────────────────────────────────────────────────

export const JobAutomationPage: React.FC = () => {
  const { user } = useAuth();

  const [preferences,    setPreferences]    = useState<JobPreferences | null>(null);
  const [preferenceForm, setPreferenceForm] = useState<PreferenceForm | null>(null);

  const [jobSources,     setJobSources]     = useState<JobSource[]>([]);
  const [jobs,           setJobs]           = useState<JobAd[]>([]);
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
      .select('id, user_id, default_cv_version_id, target_titles, preferred_locations, work_model, min_match_score, enabled_sources, max_job_age_days, automation_enabled')
      .eq('user_id', user.id)
      .maybeSingle();

    if (preferenceError) { setError(preferenceError.message); setLoading(false); setRefreshing(false); return; }

    let safePreferences = preferenceData as JobPreferences | null;

    if (!safePreferences) {
      const { error: createErr } = await supabase.rpc('ensure_user_job_preferences', { target_user_id: user.id });
      if (createErr) { setError(createErr.message); setLoading(false); setRefreshing(false); return; }

      const { data: created, error: createdErr } = await supabase
        .from('user_job_preferences')
        .select('id, user_id, default_cv_version_id, target_titles, preferred_locations, work_model, min_match_score, enabled_sources, max_job_age_days, automation_enabled')
        .eq('user_id', user.id)
        .maybeSingle();

      if (createdErr) { setError(createdErr.message); setLoading(false); setRefreshing(false); return; }
      safePreferences = created as JobPreferences | null;
    }

    setPreferences(safePreferences);
    setPreferenceForm(preferenceToForm(safePreferences, safeSources));

    setDefaultCv(
      safePreferences?.default_cv_version_id
        ? safeCvData.find((cv) => cv.id === safePreferences?.default_cv_version_id) || null
        : null,
    );

    const maxAgeDays = safePreferences?.max_job_age_days || 7;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - Math.max(maxAgeDays, 30));

    const { data: jobData, error: jobError } = await supabase
      .from('job_ads')
      .select('id, title, company, location, work_model, salary_range, job_url, source, source_slug, source_posted_at, discovered_at, description, ignored, best_match_score, best_fit_label, recommendation, parsed_required_skills')
      .eq('user_id', user.id)
      .eq('ignored', false)
      .gte('discovered_at', cutoffDate.toISOString())
      .order('discovered_at', { ascending: false })
      .limit(200);

    if (jobError) { setError(jobError.message); setLoading(false); setRefreshing(false); return; }

    const safeJobs = ((jobData || []) as JobAd[]).filter(isValidJob);
    setJobs(safeJobs);

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

  const handleSavePreferences = async () => {
    if (!user || !preferenceForm) return;
    setSavingPreferences(true);
    setError('');
    setSuccess('');

    const payload = {
      user_id:               user.id,
      default_cv_version_id: preferenceForm.defaultCvVersionId || null,
      target_titles:         splitCsv(preferenceForm.targetTitles),
      preferred_locations:   splitCsv(preferenceForm.preferredLocations),
      work_model:            preferenceForm.workModel || 'any',
      min_match_score:       Number(preferenceForm.minMatchScore) || 60,
      enabled_sources:       preferenceForm.enabledSources,
      max_job_age_days:      Number(preferenceForm.maxJobAgeDays) || 7,
      automation_enabled:    preferenceForm.automationEnabled,
    };

    const { error: saveError } = await supabase
      .from('user_job_preferences')
      .upsert(payload, { onConflict: 'user_id' });

    if (saveError) { setError(saveError.message); setSavingPreferences(false); return; }

    setSuccess('Search profile saved.');
    setEditingProfile(false);
    setSavingPreferences(false);
    await fetchData(true);
  };

  const handleRefresh = () => fetchData(true);

  const handleRunSearchNow = async () => {
    if (!user) return;
    setSuccess('');
    setError('');
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

      setSuccess(
        [
          'Job search completed.',
          `Scanned: ${payload.scanned_count ?? 0}.`,
          `Saved: ${payload.saved_count ?? 0}.`,
          `Scored: ${payload.scored_count ?? 0}.`,
          `Duplicates: ${payload.duplicate_count ?? 0}.`,
          payload.no_cv_warning ? 'No CV was found, so jobs were saved without full CV scoring.' : '',
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

  const handleTailorCv = (job: JobAd) => {
    const match = matchesByJobId[job.id];
    const cvVersionId = match?.cv_version_id || preferences?.default_cv_version_id;

    if (!cvVersionId) {
      setError('Set a default CV in the search profile before tailoring a CV.');
      return;
    }

    const params = new URLSearchParams({
      cvVersionId,
      jobTitle:    job.title,
      companyName: job.company || '',
    });

    window.location.href = `/cv-manager?${params.toString()}`;
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
    <div className="w-full max-w-5xl mx-auto">

      {/* ── Page header ───────────────────────────────────────────────────────── */}
      <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 mb-4">
            <Sparkles size={14} />
            Job Search Automation
          </p>
          <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight">
            Job Automation
          </h1>
          <p className="text-slate-600 mt-3 max-w-2xl">
            Set your search profile, fetch fresh jobs, and create tracked applications from the best matches.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {refreshing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            Refresh
          </button>
          <button
            type="button"
            onClick={handleRunSearchNow}
            disabled={refreshing}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {refreshing ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
            Run Search Now
          </button>
        </div>
      </div>

      {/* ── Alerts ────────────────────────────────────────────────────────────── */}
      {error && (
        <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 flex gap-2">
          <AlertCircle size={18} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700 flex gap-2">
          <CheckCircle2 size={18} className="shrink-0 mt-0.5" />
          <span>{success}</span>
        </div>
      )}

      {/* ⑦ Default CV warning — shown outside the profile panel so it's always visible */}
      {missingDefaultCv && !editingProfile && (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 flex items-start gap-2">
          <TriangleAlert size={18} className="shrink-0 mt-0.5 text-amber-500" />
          <span>
            <strong>No default CV selected.</strong> Scoring and CV tailoring won't work until you pick a CV in your Search Profile.{' '}
            <button
              type="button"
              className="underline font-medium hover:text-amber-900"
              onClick={() => setEditingProfile(true)}
            >
              Edit Profile
            </button>
          </span>
        </div>
      )}

      {/* ── Search Profile ────────────────────────────────────────────────────── */}
      <section className="rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden mb-6">
        <div className="border-b border-slate-200 p-5 flex items-center justify-between gap-4">
          <h2 className="font-semibold text-slate-900 flex items-center gap-2">
            <Settings size={18} />
            Search Profile
          </h2>

          <div className="flex items-center gap-2">
            {editingProfile && (
              <button
                type="button"
                onClick={() => {
                  setPreferenceForm(preferenceToForm(preferences, jobSources));
                  setEditingProfile(false);
                }}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            )}

            <button
              type="button"
              onClick={() => editingProfile ? handleSavePreferences() : setEditingProfile(true)}
              disabled={savingPreferences}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {savingPreferences ? (
                <Loader2 size={14} className="animate-spin" />
              ) : editingProfile ? (
                <Save size={14} />
              ) : (
                <Settings size={14} />
              )}
              {editingProfile ? 'Save Profile' : 'Edit Profile'}
            </button>
          </div>
        </div>

        {!preferenceForm ? (
          <div className="p-5 text-sm text-slate-500">No preferences found.</div>
        ) : editingProfile ? (
          <div className="p-5 space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <TextInput
                label="Target roles"
                value={preferenceForm.targetTitles}
                onChange={(v) => updatePreferenceForm('targetTitles', v)}
                placeholder="Technical Support Engineer, Junior Software Engineer"
              />
              <TextInput
                label="Preferred locations"
                value={preferenceForm.preferredLocations}
                onChange={(v) => updatePreferenceForm('preferredLocations', v)}
                placeholder="Warsaw, Poland, Remote"
              />
              <SelectInput
                label="Work model"
                value={preferenceForm.workModel}
                onChange={(v) => updatePreferenceForm('workModel', v)}
                options={[
                  { value: 'any',    label: 'Any' },
                  { value: 'remote', label: 'Remote' },
                  { value: 'hybrid', label: 'Hybrid' },
                  { value: 'onsite', label: 'On-site' },
                ]}
              />
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
              <NumberInput
                label="Max job age days"
                value={preferenceForm.maxJobAgeDays}
                min={1}
                max={30}
                onChange={(v) => updatePreferenceForm('maxJobAgeDays', v)}
              />
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-wide font-semibold text-slate-500">Automation</p>
                <p className="text-sm text-slate-600 mt-1">Enable this profile for scheduled job searches later.</p>
              </div>
              <button
                type="button"
                onClick={() => updatePreferenceForm('automationEnabled', !preferenceForm.automationEnabled)}
                className={`rounded-full px-4 py-2 text-sm font-medium ${
                  preferenceForm.automationEnabled ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-700'
                }`}
              >
                {preferenceForm.automationEnabled ? 'Enabled' : 'Disabled'}
              </button>
            </div>

            <div>
              <p className="text-sm font-medium text-slate-700 mb-2">Enabled sources</p>
              <div className="flex flex-wrap gap-2">
                {jobSources.map((source) => {
                  const active = preferenceForm.enabledSources.includes(source.slug);
                  return (
                    <button
                      key={source.slug}
                      type="button"
                      onClick={() => toggleSource(source.slug)}
                      className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                        active ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                      }`}
                    >
                      {source.name}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            <SummaryItem label="Target roles"   value={preferences?.target_titles?.length ? preferences.target_titles.join(', ') : 'Not set'} />
            <SummaryItem label="Locations"      value={preferences?.preferred_locations?.length ? preferences.preferred_locations.join(', ') : 'Not set'} />
            <SummaryItem label="Work model"     value={preferences?.work_model || 'Any'} />
            <SummaryItem
              label="Default CV"
              value={defaultCv ? `${defaultCv.name || 'Untitled CV'}${defaultCv.target_role ? ` — ${defaultCv.target_role}` : ''}` : 'Not selected'}
              highlight={missingDefaultCv}
            />
            <SummaryItem label="Minimum score"  value={`${preferences?.min_match_score ?? 60}/100`} />
            <SummaryItem label="Max job age"    value={`${preferences?.max_job_age_days ?? 7} days`} />
            <SummaryItem label="Automation"     value={preferences?.automation_enabled ? 'Enabled' : 'Disabled'} />
            <SummaryItem
              label="Enabled sources"
              value={preferences?.enabled_sources?.length ? preferences.enabled_sources.map((s) => sourceLabels[s] || s).join(', ') : 'No sources selected'}
            />
          </div>
        )}
      </section>

      {/* ── Matched Jobs ──────────────────────────────────────────────────────── */}
      <section className="rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden">

        {/* Toolbar */}
        <div className="border-b border-slate-200 p-4">
          <div className="flex flex-col gap-3">

            {/* Row 1: title + keyword search */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 className="font-semibold text-slate-900 flex items-center gap-2">
                  <Briefcase size={18} />
                  Matched Jobs
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {filteredJobs.length} result{filteredJobs.length === 1 ? '' : 's'}
                  {jobs.length !== filteredJobs.length ? ` of ${jobs.length}` : ''}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    placeholder="Search jobs…"
                    className="w-full sm:w-52 rounded-xl border border-slate-300 bg-white pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                  />
                </div>

                {hasActiveFilter && (
                  <button
                    type="button"
                    onClick={clearSearch}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <X size={14} />
                    Clear
                  </button>
                )}
              </div>
            </div>

            {/* Row 2: filter chips */}
            <div className="flex flex-wrap gap-2">

              {/* ⑥ Scored / Unscored chips */}
              <FilterChip active={scoreView === 'all'} onClick={() => setScoreView('all')}>
                All
              </FilterChip>
              <FilterChip active={scoreView === 'recommended'} onClick={() => setScoreView('recommended')}>
                Recommended
              </FilterChip>
              <FilterChip active={scoreView === 'possible'} onClick={() => setScoreView('possible')}>
                Possible
              </FilterChip>
              <FilterChip active={scoreView === 'stretch'} onClick={() => setScoreView('stretch')}>
                Stretch
              </FilterChip>

              <span className="w-px self-stretch bg-slate-200 mx-1" />

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

              {/* ⑤ Source filter chips — only show slugs that appear in current job list */}
              {presentSources.length > 1 && (
                <>
                  <span className="w-px self-stretch bg-slate-200 mx-1" />
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
        </div>

        {filteredJobs.length === 0 ? (
          <div className="p-10 text-center">
            <Briefcase size={38} className="mx-auto text-slate-300 mb-3" />
            <h3 className="font-semibold text-slate-800">No matched jobs yet</h3>
            <p className="text-sm text-slate-500 mt-2 max-w-md mx-auto">
              Set your search profile, make sure Google Jobs or Indeed is enabled, then click Run Search Now.
            </p>
          </div>
        ) : (
          <>
            <div className="divide-y divide-slate-200">
              {visibleJobs.map((job) => {
                const match         = matchesByJobId[job.id];
                const score         = match?.match_score ?? job.best_match_score;
                const rec           = match?.recommendation || job.recommendation || 'unscored';
                const matchedSkills = (match?.matched_skills || []).filter(Boolean);
                const missingSkills = (match?.missing_skills || []).filter(Boolean);
                const source        = job.source_slug || job.source || 'unknown';
                const isUnscored    = score == null;
                const descriptionPlain = stripHtml(job.description);
                const isDescExpanded = expandedDescriptions[job.id] ?? false;
                const DESC_LIMIT = 180;

                return (
                  <article key={job.id} className="p-4">
                    <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">

                      {/* ── Left column ─────────────────────────────────────── */}
                      <div className="min-w-0 flex-1">

                        {/* Meta chips row */}
                        <div className="flex flex-wrap items-center gap-1.5 mb-2">
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                            {sourceLabels[source] || source}
                          </span>

                          <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${getScoreBadgeClass(score)}`}>
                            {isUnscored
                              ? 'Not scored yet'
                              : `${score}/100 · ${getRecommendationLabel(rec)}`}
                          </span>

                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                            {formatPostedAgo(job.source_posted_at || job.discovered_at)}
                          </span>
                        </div>

                        {/* ① Cleaned title + meta line — more compact */}
                        <h3 className="text-base font-semibold text-slate-900 leading-snug">
                          {cleanJobTitle(job.title)}
                        </h3>

                        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500">
                          <span className="inline-flex items-center gap-1">
                            <Briefcase size={12} />
                            {resolveCompany(job)}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <MapPin size={12} />
                            {job.location || 'Location not specified'}
                          </span>
                          {job.work_model && (
                            <span className="inline-flex items-center gap-1">
                              <CalendarClock size={12} />
                              {job.work_model}
                            </span>
                          )}
                          {job.salary_range && <span>{job.salary_range}</span>}
                        </div>

                        {/* ② Description preview */}
                        {descriptionPlain && (
                          <div className="mt-2">
                            <p className="text-xs text-slate-600 leading-relaxed">
                              {isDescExpanded || descriptionPlain.length <= DESC_LIMIT
                                ? descriptionPlain
                                : `${descriptionPlain.slice(0, DESC_LIMIT)}…`}
                            </p>
                            {descriptionPlain.length > DESC_LIMIT && (
                              <button
                                type="button"
                                onClick={() => toggleDescription(job.id)}
                                className="mt-0.5 inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600"
                              >
                                {isDescExpanded
                                  ? <><ChevronUp size={12} /> Show less</>
                                  : <><ChevronDown size={12} /> Show more</>}
                              </button>
                            )}
                          </div>
                        )}

                        {/* CV angle */}
                        {match?.suggested_cv_angle && (
                          <div className="mt-2 rounded-xl bg-slate-50 border border-slate-200 px-3 py-2">
                            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-0.5">
                              Suggested CV angle
                            </p>
                            <p className="text-xs text-slate-600">{match.suggested_cv_angle}</p>
                          </div>
                        )}

                        {/* Skills — only when non-empty */}
                        {(matchedSkills.length > 0 || missingSkills.length > 0) && (
                          <div className="mt-2 flex flex-wrap gap-3">
                            {matchedSkills.length > 0 && (
                              <SkillList title="Matched" items={matchedSkills} positive />
                            )}
                            {missingSkills.length > 0 && (
                              <SkillList title="Missing" items={missingSkills} />
                            )}
                          </div>
                        )}
                      </div>

                      {/* ── Right column — action buttons ─────────────────── */}
                      {/* ③ Reduced padding, tighter gap, smaller text */}
                      <div className="flex flex-row flex-wrap lg:flex-col gap-2 lg:w-40 shrink-0">

                        {/* ④ Score Job is PRIMARY for unscored, secondary (Re-score) for scored */}
                        {isUnscored ? (
                          <button
                            type="button"
                            onClick={() => handleScoreJob(job)}
                            disabled={scoringJobId === job.id}
                            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                          >
                            {scoringJobId === job.id
                              ? <Loader2 size={14} className="animate-spin" />
                              : <Zap size={14} />}
                            Score Job
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleCreateApplication(job)}
                            disabled={creatingApplicationId === job.id}
                            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
                          >
                            {creatingApplicationId === job.id
                              ? <Loader2 size={14} className="animate-spin" />
                              : <Briefcase size={14} />}
                            Create App
                          </button>
                        )}

                        <a
                          href={job.job_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <ExternalLink size={14} />
                          View Job
                        </a>

                        {!isUnscored && (
                          <button
                            type="button"
                            onClick={() => handleTailorCv(job)}
                            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-700"
                          >
                            <Sparkles size={14} />
                            Tailor CV
                          </button>
                        )}

                        {/* Re-score — secondary for already-scored jobs */}
                        {!isUnscored && (
                          <button
                            type="button"
                            onClick={() => handleScoreJob(job)}
                            disabled={scoringJobId === job.id}
                            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200 disabled:opacity-50"
                          >
                            {scoringJobId === job.id
                              ? <Loader2 size={14} className="animate-spin" />
                              : <Zap size={14} />}
                            Re-score
                          </button>
                        )}

                        {/* For unscored jobs: also show Create App so user can still add without scoring */}
                        {isUnscored && (
                          <button
                            type="button"
                            onClick={() => handleCreateApplication(job)}
                            disabled={creatingApplicationId === job.id}
                            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                          >
                            {creatingApplicationId === job.id
                              ? <Loader2 size={14} className="animate-spin" />
                              : <Briefcase size={14} />}
                            Create App
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => handleIgnoreJob(job.id)}
                          disabled={ignoringJobId === job.id}
                          className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-red-50 hover:text-red-700 hover:border-red-200 disabled:opacity-50"
                        >
                          {ignoringJobId === job.id
                            ? <Loader2 size={14} className="animate-spin" />
                            : <Trash2 size={14} />}
                          Ignore
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            {/* Load More */}
            {hasMore && (
              <div className="border-t border-slate-200 p-4 flex flex-col items-center gap-1.5">
                <p className="text-xs text-slate-400">
                  Showing {visibleCount} of {filteredJobs.length} jobs
                </p>
                <button
                  type="button"
                  onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  <ChevronDown size={15} />
                  Load {Math.min(PAGE_SIZE, filteredJobs.length - visibleCount)} more
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
};

// ─── sub-components ───────────────────────────────────────────────────────────

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
    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
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

interface SummaryItemProps {
  label: string;
  value: string;
  highlight?: boolean;
}
const SummaryItem: React.FC<SummaryItemProps> = ({ label, value, highlight }) => (
  <div className={`rounded-2xl border p-4 ${highlight ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
    <p className={`text-xs uppercase tracking-wide font-semibold ${highlight ? 'text-amber-600' : 'text-slate-500'}`}>
      {label}
    </p>
    <p className={`mt-1 text-sm font-medium break-words ${highlight ? 'text-amber-800' : 'text-slate-900'}`}>
      {value}
    </p>
  </div>
);

interface SelectInputProps {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}
const SelectInput: React.FC<SelectInputProps> = ({ label, value, options, onChange }) => (
  <div>
    {label && <label className="block text-sm font-medium text-slate-700 mb-2">{label}</label>}
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </div>
);

interface TextInputProps {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}
const TextInput: React.FC<TextInputProps> = ({ label, value, placeholder, onChange }) => (
  <div>
    <label className="block text-sm font-medium text-slate-700 mb-2">{label}</label>
    <input
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
    />
  </div>
);

interface NumberInputProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}
const NumberInput: React.FC<NumberInputProps> = ({ label, value, min, max, onChange }) => (
  <div>
    <label className="block text-sm font-medium text-slate-700 mb-2">{label}</label>
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
    />
  </div>
);

interface SkillListProps {
  title: string;
  items: string[];
  positive?: boolean;
}
const SkillList: React.FC<SkillListProps> = ({ title, items, positive = false }) => (
  <div>
    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{title}</p>
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