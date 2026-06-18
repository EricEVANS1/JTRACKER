import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BarChart3,
  Briefcase,
  CalendarClock,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileText,
  Filter,
  Loader2,
  MapPin,
  Play,
  RefreshCw,
  Save,
  Search,
  Settings,
  Sparkles,
  Target,
  Trash2,
  X,
} from 'lucide-react';

import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

interface JobPreferences {
  id: string;
  user_id: string;
  default_cv_version_id: string | null;
  target_titles: string[] | null;
  preferred_locations: string[] | null;
  work_model: string | null;
  min_match_score: number | null;
  excluded_keywords: string[] | null;
  career_goal: string | null;
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

interface JobSearchRun {
  id: string;
  run_type: string;
  source: string | null;
  scanned_count: number;
  saved_count: number;
  recommended_count: number;
  possible_count: number;
  stretch_count: number;
  not_recommended_count: number;
  duplicate_count: number;
  error_count: number;
  status: string;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
}

interface CVVersion {
  id: string;
  name: string | null;
  target_role: string | null;
  last_score: number | null;
}

type ScoreFilter = 'all' | 'recommended' | 'possible' | 'stretch';
type FreshnessFilter = '24h' | '3d' | '7d' | 'all';
type SortMode = 'newest' | 'score' | 'company';
type WorkModelFilter = 'all' | 'remote' | 'hybrid' | 'onsite';

interface PreferenceForm {
  targetTitles: string;
  preferredLocations: string;
  workModel: string;
  minMatchScore: number;
  maxJobAgeDays: number;
  defaultCvVersionId: string;
  automationEnabled: boolean;
  enabledSources: string[];
  excludedKeywords: string;
  careerGoal: string;
}

const sourceLabels: Record<string, string> = {
  google_jobs: 'Google Jobs',
  indeed: 'Indeed',
  linkedin: 'LinkedIn',
  justjoinit: 'JustJoinIT',
  nofluffjobs: 'NoFluffJobs',
  pracuj: 'Pracuj.pl',
  pracuj_it: 'Pracuj.pl IT',
  bulldogjob: 'Bulldogjob',
  theprotocol: 'TheProtocol.it',
  crossweb: 'Crossweb.pl',
  manual: 'Manual',
};

const quickRoleFilters = [
  'All',
  'Technical Support',
  'Application Support',
  'Junior Software',
  'IT Support',
  'QA',
  'Cloud Support',
  'DevOps',
];

const splitCsv = (value: string) => {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

const joinCsv = (items?: string[] | null) => {
  return (items || []).join(', ');
};

const normalise = (value: unknown) => {
  return String(value || '').toLowerCase().trim();
};

const getScoreBadgeClass = (score?: number | null) => {
  if (score === null || score === undefined) {
    return 'bg-slate-100 text-slate-600 border-slate-200';
  }

  if (score >= 85) {
    return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  }

  if (score >= 70) {
    return 'bg-blue-50 text-blue-700 border-blue-200';
  }

  if (score >= 55) {
    return 'bg-amber-50 text-amber-700 border-amber-200';
  }

  return 'bg-red-50 text-red-700 border-red-200';
};

const getRecommendationLabel = (recommendation?: string | null) => {
  if (!recommendation) return 'Unscored';

  return recommendation
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
};

const formatDateTime = (value?: string | null) => {
  if (!value) return 'Not run yet';

  return new Date(value).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatPostedAgo = (value?: string | null) => {
  if (!value) return 'Date unknown';

  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  const diffHours = Math.max(Math.floor(diffMs / (1000 * 60 * 60)), 0);

  if (diffHours < 1) return 'Posted recently';
  if (diffHours < 24) return `Posted ${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);

  if (diffDays === 1) return 'Posted 1 day ago';

  return `Posted ${diffDays} days ago`;
};

const isFreshEnough = (job: JobAd, freshness: FreshnessFilter) => {
  if (freshness === 'all') return true;

  const sourceDate = job.source_posted_at || job.discovered_at;
  if (!sourceDate) return true;

  const ageMs = Date.now() - new Date(sourceDate).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  if (freshness === '24h') return ageDays <= 1;
  if (freshness === '3d') return ageDays <= 3;
  if (freshness === '7d') return ageDays <= 7;

  return true;
};

const preferenceToForm = (
  preferences: JobPreferences | null,
  sources: JobSource[],
): PreferenceForm => {
  return {
    targetTitles: joinCsv(preferences?.target_titles),
    preferredLocations: joinCsv(preferences?.preferred_locations),
    workModel: preferences?.work_model || 'any',
    minMatchScore: preferences?.min_match_score ?? 60,
    maxJobAgeDays: preferences?.max_job_age_days ?? 7,
    defaultCvVersionId: preferences?.default_cv_version_id || '',
    automationEnabled: Boolean(preferences?.automation_enabled),
    enabledSources:
      preferences?.enabled_sources?.length
        ? preferences.enabled_sources
        : sources.map((source) => source.slug),
    excludedKeywords: joinCsv(preferences?.excluded_keywords),
    careerGoal: preferences?.career_goal || '',
  };
};

export const JobAutomationPage: React.FC = () => {
  const { user } = useAuth();

  const [preferences, setPreferences] = useState<JobPreferences | null>(null);
  const [preferenceForm, setPreferenceForm] = useState<PreferenceForm | null>(null);

  const [jobSources, setJobSources] = useState<JobSource[]>([]);
  const [jobs, setJobs] = useState<JobAd[]>([]);
  const [matchesByJobId, setMatchesByJobId] = useState<Record<string, JobMatchResult>>({});
  const [recentRuns, setRecentRuns] = useState<JobSearchRun[]>([]);
  const [cvVersions, setCvVersions] = useState<CVVersion[]>([]);
  const [defaultCv, setDefaultCv] = useState<CVVersion | null>(null);

  const [editingProfile, setEditingProfile] = useState(false);

  const [keyword, setKeyword] = useState('');
  const [selectedQuickRole, setSelectedQuickRole] = useState('All');
  const [selectedSource, setSelectedSource] = useState('all');
  const [scoreFilter, setScoreFilter] = useState<ScoreFilter>('all');
  const [freshnessFilter, setFreshnessFilter] = useState<FreshnessFilter>('7d');
  const [sortMode, setSortMode] = useState<SortMode>('newest');
  const [workModelFilter, setWorkModelFilter] = useState<WorkModelFilter>('all');
  const [locationFilter, setLocationFilter] = useState('');

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [creatingApplicationId, setCreatingApplicationId] = useState<string | null>(null);
  const [ignoringJobId, setIgnoringJobId] = useState<string | null>(null);

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const fetchData = async (silent = false) => {
    if (!user) return;

    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

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

    if (cvError) {
      setError(cvError.message);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    setCvVersions((cvData || []) as CVVersion[]);

    const { data: preferenceData, error: preferenceError } = await supabase
      .from('user_job_preferences')
      .select(
        'id, user_id, default_cv_version_id, target_titles, preferred_locations, work_model, min_match_score, excluded_keywords, career_goal, enabled_sources, max_job_age_days, automation_enabled',
      )
      .eq('user_id', user.id)
      .maybeSingle();

    if (preferenceError) {
      setError(preferenceError.message);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    let safePreferences = preferenceData as JobPreferences | null;

    if (!safePreferences) {
      const { error: createPreferenceError } = await supabase.rpc(
        'ensure_user_job_preferences',
        {
          target_user_id: user.id,
        },
      );

      if (createPreferenceError) {
        setError(createPreferenceError.message);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      const { data: createdPreferences, error: createdPreferenceError } = await supabase
        .from('user_job_preferences')
        .select(
          'id, user_id, default_cv_version_id, target_titles, preferred_locations, work_model, min_match_score, excluded_keywords, career_goal, enabled_sources, max_job_age_days, automation_enabled',
        )
        .eq('user_id', user.id)
        .maybeSingle();

      if (createdPreferenceError) {
        setError(createdPreferenceError.message);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      safePreferences = createdPreferences as JobPreferences | null;
    }

    setPreferences(safePreferences);
    setPreferenceForm(preferenceToForm(safePreferences, safeSources));

    if (safePreferences?.default_cv_version_id) {
      const selectedCv =
        ((cvData || []) as CVVersion[]).find(
          (cv) => cv.id === safePreferences?.default_cv_version_id,
        ) || null;

      setDefaultCv(selectedCv);
    } else {
      setDefaultCv(null);
    }

    const maxAgeDays = safePreferences?.max_job_age_days || 7;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - Math.max(maxAgeDays, 30));

    const { data: jobData, error: jobError } = await supabase
      .from('job_ads')
      .select(
        'id, title, company, location, work_model, salary_range, job_url, source, source_slug, source_posted_at, discovered_at, description, ignored, best_match_score, best_fit_label, recommendation, parsed_required_skills',
      )
      .eq('user_id', user.id)
      .eq('ignored', false)
      .gte('discovered_at', cutoffDate.toISOString())
      .order('discovered_at', { ascending: false })
      .limit(200);

    if (jobError) {
      setError(jobError.message);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const safeJobs = (jobData || []) as JobAd[];
    setJobs(safeJobs);

    const jobIds = safeJobs.map((job) => job.id);

    if (jobIds.length > 0) {
      const { data: matchData } = await supabase
        .from('job_match_results')
        .select(
          'id, job_ad_id, cv_version_id, match_score, fit_label, recommendation, matched_skills, missing_skills, concerns, suggested_cv_angle, explanation, created_at',
        )
        .eq('user_id', user.id)
        .in('job_ad_id', jobIds)
        .order('created_at', { ascending: false });

      const nextMap: Record<string, JobMatchResult> = {};

      ((matchData || []) as JobMatchResult[]).forEach((match) => {
        if (!nextMap[match.job_ad_id]) {
          nextMap[match.job_ad_id] = match;
        }
      });

      setMatchesByJobId(nextMap);
    } else {
      setMatchesByJobId({});
    }

    const { data: runData } = await supabase
      .from('job_search_runs')
      .select(
        'id, run_type, source, scanned_count, saved_count, recommended_count, possible_count, stretch_count, not_recommended_count, duplicate_count, error_count, status, error_message, started_at, completed_at, created_at',
      )
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(5);

    setRecentRuns((runData || []) as JobSearchRun[]);

    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const updatePreferenceForm = <K extends keyof PreferenceForm>(
    key: K,
    value: PreferenceForm[K],
  ) => {
    setPreferenceForm((current) => {
      if (!current) return current;

      return {
        ...current,
        [key]: value,
      };
    });
  };

  const toggleSource = (slug: string) => {
    setPreferenceForm((current) => {
      if (!current) return current;

      const exists = current.enabledSources.includes(slug);

      return {
        ...current,
        enabledSources: exists
          ? current.enabledSources.filter((source) => source !== slug)
          : [...current.enabledSources, slug],
      };
    });
  };

  const handleSavePreferences = async () => {
    if (!user || !preferenceForm) return;

    setSavingPreferences(true);
    setError('');
    setSuccess('');

    const payload = {
      user_id: user.id,
      default_cv_version_id: preferenceForm.defaultCvVersionId || null,
      target_titles: splitCsv(preferenceForm.targetTitles),
      preferred_locations: splitCsv(preferenceForm.preferredLocations),
      work_model: preferenceForm.workModel || 'any',
      min_match_score: Number(preferenceForm.minMatchScore) || 60,
      excluded_keywords: splitCsv(preferenceForm.excludedKeywords),
      career_goal: preferenceForm.careerGoal || null,
      enabled_sources: preferenceForm.enabledSources,
      max_job_age_days: Number(preferenceForm.maxJobAgeDays) || 7,
      automation_enabled: preferenceForm.automationEnabled,
    };

    const { error: saveError } = await supabase
      .from('user_job_preferences')
      .upsert(payload, {
        onConflict: 'user_id',
      });

    if (saveError) {
      setError(saveError.message);
      setSavingPreferences(false);
      return;
    }

    setSuccess('Job automation preferences saved.');
    setEditingProfile(false);
    setSavingPreferences(false);

    await fetchData(true);
  };

  const sourceCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: jobs.length,
    };

    jobs.forEach((job) => {
      const source = job.source_slug || job.source || 'unknown';
      counts[source] = (counts[source] || 0) + 1;
    });

    return counts;
  }, [jobs]);

  const summaryStats = useMemo(() => {
    const recommended = jobs.filter((job) => {
      const match = matchesByJobId[job.id];
      const recommendation = match?.recommendation || job.recommendation;
      const score = match?.match_score ?? job.best_match_score ?? 0;

      return recommendation === 'recommended' || score >= 85;
    }).length;

    const possible = jobs.filter((job) => {
      const match = matchesByJobId[job.id];
      const recommendation = match?.recommendation || job.recommendation;
      const score = match?.match_score ?? job.best_match_score ?? 0;

      return recommendation === 'possible' || (score >= 70 && score < 85);
    }).length;

    const stretch = jobs.filter((job) => {
      const match = matchesByJobId[job.id];
      const recommendation = match?.recommendation || job.recommendation;
      const score = match?.match_score ?? job.best_match_score ?? 0;

      return recommendation === 'stretch' || (score >= 55 && score < 70);
    }).length;

    return {
      total: jobs.length,
      recommended,
      possible,
      stretch,
    };
  }, [jobs, matchesByJobId]);

  const filteredJobs = useMemo(() => {
    let nextJobs = [...jobs];

    if (selectedSource !== 'all') {
      nextJobs = nextJobs.filter(
        (job) => (job.source_slug || job.source || 'unknown') === selectedSource,
      );
    }

    nextJobs = nextJobs.filter((job) => isFreshEnough(job, freshnessFilter));

    if (keyword.trim()) {
      const value = normalise(keyword);

      nextJobs = nextJobs.filter((job) => {
        const match = matchesByJobId[job.id];

        const haystack = [
          job.title,
          job.company,
          job.location,
          job.description,
          job.work_model,
          job.salary_range,
          match?.matched_skills?.join(' '),
          match?.missing_skills?.join(' '),
          match?.suggested_cv_angle,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        return haystack.includes(value);
      });
    }

    if (selectedQuickRole !== 'All') {
      const value = normalise(selectedQuickRole);

      nextJobs = nextJobs.filter((job) => {
        const haystack = [job.title, job.description, job.parsed_required_skills?.join(' ')]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        return haystack.includes(value);
      });
    }

    if (locationFilter.trim()) {
      const value = normalise(locationFilter);

      nextJobs = nextJobs.filter((job) =>
        normalise(job.location).includes(value),
      );
    }

    if (workModelFilter !== 'all') {
      nextJobs = nextJobs.filter((job) => {
        const workModel = normalise(job.work_model);
        const location = normalise(job.location);
        const description = normalise(job.description);

        if (workModelFilter === 'remote') {
          return (
            workModel.includes('remote') ||
            location.includes('remote') ||
            description.includes('remote')
          );
        }

        if (workModelFilter === 'hybrid') {
          return workModel.includes('hybrid') || description.includes('hybrid');
        }

        if (workModelFilter === 'onsite') {
          return (
            workModel.includes('onsite') ||
            workModel.includes('on-site') ||
            description.includes('on-site') ||
            description.includes('onsite')
          );
        }

        return true;
      });
    }

    if (scoreFilter !== 'all') {
      nextJobs = nextJobs.filter((job) => {
        const match = matchesByJobId[job.id];
        const recommendation = match?.recommendation || job.recommendation;
        const score = match?.match_score ?? job.best_match_score ?? 0;

        if (scoreFilter === 'recommended') {
          return recommendation === 'recommended' || score >= 85;
        }

        if (scoreFilter === 'possible') {
          return recommendation === 'possible' || (score >= 70 && score < 85);
        }

        if (scoreFilter === 'stretch') {
          return recommendation === 'stretch' || (score >= 55 && score < 70);
        }

        return true;
      });
    }

    if (sortMode === 'score') {
      nextJobs.sort((a, b) => {
        const aScore = matchesByJobId[a.id]?.match_score ?? a.best_match_score ?? 0;
        const bScore = matchesByJobId[b.id]?.match_score ?? b.best_match_score ?? 0;

        return bScore - aScore;
      });
    }

    if (sortMode === 'company') {
      nextJobs.sort((a, b) =>
        String(a.company || '').localeCompare(String(b.company || '')),
      );
    }

    if (sortMode === 'newest') {
      nextJobs.sort((a, b) => {
        const aDate = new Date(a.source_posted_at || a.discovered_at).getTime();
        const bDate = new Date(b.source_posted_at || b.discovered_at).getTime();

        return bDate - aDate;
      });
    }

    return nextJobs;
  }, [
    jobs,
    matchesByJobId,
    selectedSource,
    scoreFilter,
    freshnessFilter,
    sortMode,
    keyword,
    selectedQuickRole,
    locationFilter,
    workModelFilter,
  ]);

  const latestRun = recentRuns[0] || null;
  const enabledSources = preferences?.enabled_sources || [];

  const handleRefresh = () => {
    fetchData(true);
  };

const handleRunSearchNow = async () => {
  if (!user) return;

  setSuccess('');
  setError('');
  setRefreshing(true);

  const { data, error: functionError } = await supabase.functions.invoke(
    'job-pipeline',
    {
      method: 'POST',
      body: {},
    },
  );

  if (functionError) {
    setError(functionError.message || 'Job pipeline failed.');
    setRefreshing(false);
    return;
  }

  const result = data as {
    saved_count?: number;
    scored_count?: number;
    scanned_count?: number;
    duplicate_count?: number;
    no_cv_warning?: boolean;
  };

  setSuccess(
    [
      `Job search completed.`,
      `Scanned: ${result.scanned_count ?? 0}.`,
      `Saved: ${result.saved_count ?? 0}.`,
      `Scored: ${result.scored_count ?? 0}.`,
      `Duplicates: ${result.duplicate_count ?? 0}.`,
      result.no_cv_warning
        ? 'No CV was found, so jobs were saved without full CV scoring.'
        : '',
    ]
      .filter(Boolean)
      .join(' '),
  );

  await fetchData(true);
  setRefreshing(false);
};

  const handleIgnoreJob = async (jobId: string) => {
    if (!user) return;

    const confirmed = window.confirm('Ignore this job and hide it from Job Automation?');
    if (!confirmed) return;

    setIgnoringJobId(jobId);
    setError('');
    setSuccess('');

    const { error: ignoreError } = await supabase
      .from('job_ads')
      .update({
        ignored: true,
        ignored_at: new Date().toISOString(),
      })
      .eq('id', jobId)
      .eq('user_id', user.id);

    if (ignoreError) {
      setError(ignoreError.message);
      setIgnoringJobId(null);
      return;
    }

    setJobs((prev) => prev.filter((job) => job.id !== jobId));
    setSuccess('Job ignored.');
    setIgnoringJobId(null);
  };

  const handleCreateApplication = async (job: JobAd) => {
    if (!user) return;

    const match = matchesByJobId[job.id];

    setCreatingApplicationId(job.id);
    setError('');
    setSuccess('');

    const { data: existingApplication, error: existingError } = await supabase
      .from('applications')
      .select('id')
      .eq('user_id', user.id)
      .eq('job_ad_id', job.id)
      .maybeSingle();

    if (existingError) {
      setError(existingError.message);
      setCreatingApplicationId(null);
      return;
    }

    if (existingApplication?.id) {
      setSuccess('This job already exists in Applications.');
      setCreatingApplicationId(null);
      window.location.href = `/applications/${existingApplication.id}`;
      return;
    }

    const { data: insertedApplication, error: applicationError } = await supabase
      .from('applications')
      .insert({
        user_id: user.id,
        role_title: job.title,
        application_link: job.job_url || null,
        source: sourceLabels[job.source_slug || ''] || job.source || 'Job Automation',
        status: 'wishlist',
        date_applied: null,
        location: job.location,
        job_type: job.work_model,
        salary_range: job.salary_range,
        notes: [
          'Created from Job Automation.',
          `Company: ${job.company || 'Unknown company'}`,
          `Source: ${sourceLabels[job.source_slug || ''] || job.source || 'Unknown'}`,
          match ? `Match score: ${match.match_score}/100 (${match.fit_label})` : '',
          match ? `Recommendation: ${match.recommendation}` : '',
          match?.suggested_cv_angle ? `Suggested CV angle: ${match.suggested_cv_angle}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        job_ad_id: job.id,
        job_match_result_id: match?.id || null,
        job_search_source: job.source_slug || job.source || null,
        job_match_recommendation: match?.recommendation || job.recommendation || null,
        cv_version_id: match?.cv_version_id || preferences?.default_cv_version_id || null,
        match_score: match?.match_score || job.best_match_score || null,
        fit_label: match?.fit_label || job.best_fit_label || null,
        job_description: job.description || null,
      })
      .select('id')
      .single();

    if (applicationError) {
      setError(applicationError.message);
      setCreatingApplicationId(null);
      return;
    }

    await supabase.from('application_events').insert({
      user_id: user.id,
      application_id: insertedApplication.id,
      event_type: 'job_automation',
      title: 'Application created from Job Automation',
      description: match
        ? `Created from matched job. Match score: ${match.match_score}/100.`
        : 'Created from matched job.',
      event_date: new Date().toISOString(),
    });

    setSuccess('Application created successfully.');
    setCreatingApplicationId(null);
    window.location.href = `/applications/${insertedApplication.id}`;
  };

  const handleTailorCv = (job: JobAd) => {
    const match = matchesByJobId[job.id];
    const cvVersionId = match?.cv_version_id || preferences?.default_cv_version_id;

    if (!cvVersionId) {
      setError('Set a default CV in Job Automation preferences before tailoring a CV.');
      return;
    }

    const params = new URLSearchParams({
      cvVersionId,
      jobTitle: job.title,
      companyName: job.company || '',
    });

    window.location.href = `/cv-manager?${params.toString()}`;
  };

  const resetFilters = () => {
    setKeyword('');
    setSelectedQuickRole('All');
    setSelectedSource('all');
    setScoreFilter('all');
    setFreshnessFilter('7d');
    setSortMode('newest');
    setWorkModelFilter('all');
    setLocationFilter('');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-3 p-10 text-slate-500">
        <Loader2 size={18} className="animate-spin" />
        Loading Job Automation...
      </div>
    );
  }

  return (
    <div className="w-full max-w-7xl">
      <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 mb-4">
            <Sparkles size={14} />
            Job Search Automation
          </p>

          <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight">
            Job Automation
          </h1>

          <p className="text-slate-600 mt-3 max-w-3xl">
            Control your automated job search, manage filters, and review matched jobs from
            your enabled sources.
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
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-700"
          >
            <Play size={16} />
            Run Search Now
          </button>
        </div>
      </div>

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

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-6">
        <div className="space-y-6">
          <section className="rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="border-b border-slate-200 p-5 flex items-center justify-between gap-4">
              <h2 className="font-semibold text-slate-900 flex items-center gap-2">
                <Settings size={18} />
                Job Search Profile
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
                  onClick={() => {
                    if (editingProfile) {
                      handleSavePreferences();
                    } else {
                      setEditingProfile(true);
                    }
                  }}
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
                    onChange={(value) => updatePreferenceForm('targetTitles', value)}
                    placeholder="Technical Support Engineer, Junior Software Engineer"
                  />

                  <TextInput
                    label="Preferred locations"
                    value={preferenceForm.preferredLocations}
                    onChange={(value) => updatePreferenceForm('preferredLocations', value)}
                    placeholder="Warsaw, Poland, Remote"
                  />

                  <SelectInput
                    label="Work model"
                    value={preferenceForm.workModel}
                    onChange={(value) => updatePreferenceForm('workModel', value)}
                    options={[
                      { value: 'any', label: 'Any' },
                      { value: 'remote', label: 'Remote' },
                      { value: 'hybrid', label: 'Hybrid' },
                      { value: 'onsite', label: 'On-site' },
                    ]}
                  />

                  <SelectInput
                    label="Default CV"
                    value={preferenceForm.defaultCvVersionId}
                    onChange={(value) => updatePreferenceForm('defaultCvVersionId', value)}
                    options={[
                      { value: '', label: 'No default CV selected' },
                      ...cvVersions.map((cv) => ({
                        value: cv.id,
                        label: `${cv.name || 'Untitled CV'}${
                          cv.target_role ? ` — ${cv.target_role}` : ''
                        }`,
                      })),
                    ]}
                  />

                  <NumberInput
                    label="Minimum match score"
                    value={preferenceForm.minMatchScore}
                    min={0}
                    max={100}
                    onChange={(value) => updatePreferenceForm('minMatchScore', value)}
                  />

                  <NumberInput
                    label="Max job age days"
                    value={preferenceForm.maxJobAgeDays}
                    min={1}
                    max={30}
                    onChange={(value) => updatePreferenceForm('maxJobAgeDays', value)}
                  />

                  <TextInput
                    label="Excluded keywords"
                    value={preferenceForm.excludedKeywords}
                    onChange={(value) => updatePreferenceForm('excludedKeywords', value)}
                    placeholder="Senior, Lead, 7+ years"
                  />

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 flex items-center justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-wide font-semibold text-slate-500">
                        Automation
                      </p>
                      <p className="text-sm text-slate-600 mt-1">
                        Allow scheduled search runs once the worker is connected.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        updatePreferenceForm(
                          'automationEnabled',
                          !preferenceForm.automationEnabled,
                        )
                      }
                      className={`rounded-full px-4 py-2 text-sm font-medium ${
                        preferenceForm.automationEnabled
                          ? 'bg-emerald-500 text-white'
                          : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {preferenceForm.automationEnabled ? 'Enabled' : 'Disabled'}
                    </button>
                  </div>
                </div>

                <div>
                  <p className="text-sm font-medium text-slate-700 mb-2">
                    Enabled sources
                  </p>

                  <div className="flex flex-wrap gap-2">
                    {jobSources.map((source) => {
                      const active = preferenceForm.enabledSources.includes(source.slug);

                      return (
                        <button
                          key={source.slug}
                          type="button"
                          onClick={() => toggleSource(source.slug)}
                          className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                            active
                              ? 'bg-slate-900 text-white'
                              : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                          }`}
                        >
                          {source.name}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Career goal
                  </label>

                  <textarea
                    value={preferenceForm.careerGoal}
                    onChange={(event) =>
                      updatePreferenceForm('careerGoal', event.target.value)
                    }
                    rows={3}
                    placeholder="Example: I want to move from technical support into software engineering or cloud support."
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                  />
                </div>
              </div>
            ) : (
              <div className="p-5 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                <SummaryItem
                  label="Target roles"
                  value={
                    preferences?.target_titles?.length
                      ? preferences.target_titles.join(', ')
                      : 'Not set'
                  }
                />

                <SummaryItem
                  label="Locations"
                  value={
                    preferences?.preferred_locations?.length
                      ? preferences.preferred_locations.join(', ')
                      : 'Not set'
                  }
                />

                <SummaryItem
                  label="Work model"
                  value={preferences?.work_model || 'Any'}
                />

                <SummaryItem
                  label="Minimum score"
                  value={`${preferences?.min_match_score ?? 60}/100`}
                />

                <SummaryItem
                  label="Default CV"
                  value={
                    defaultCv
                      ? `${defaultCv.name || 'Untitled CV'}${
                          defaultCv.target_role ? ` — ${defaultCv.target_role}` : ''
                        }`
                      : 'Not selected'
                  }
                />

                <SummaryItem
                  label="Max job age"
                  value={`${preferences?.max_job_age_days ?? 7} days`}
                />

                <SummaryItem
                  label="Automation"
                  value={preferences?.automation_enabled ? 'Enabled' : 'Disabled'}
                />

                <SummaryItem
                  label="Enabled sources"
                  value={
                    enabledSources.length
                      ? enabledSources
                          .map((source) => sourceLabels[source] || source)
                          .join(', ')
                      : 'No sources selected'
                  }
                />
              </div>
            )}
          </section>

          <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <StatCard label="Matched jobs" value={summaryStats.total} icon={Briefcase} />
            <StatCard label="Recommended" value={summaryStats.recommended} icon={Target} />
            <StatCard label="Possible" value={summaryStats.possible} icon={BarChart3} />
            <StatCard label="Stretch" value={summaryStats.stretch} icon={Clock3} />
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="border-b border-slate-200 p-5">
              <h2 className="font-semibold text-slate-900 flex items-center gap-2">
                <Filter size={18} />
                Filters
              </h2>
            </div>

            <div className="p-5 space-y-5">
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_180px_160px] gap-3">
                <div className="relative">
                  <Search
                    size={17}
                    className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
                  />

                  <input
                    value={keyword}
                    onChange={(event) => setKeyword(event.target.value)}
                    placeholder="Search title, company, skill, keyword..."
                    className="w-full rounded-xl border border-slate-300 bg-white pl-11 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                  />
                </div>

                <input
                  value={locationFilter}
                  onChange={(event) => setLocationFilter(event.target.value)}
                  placeholder="Location"
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                />

                <button
                  type="button"
                  onClick={resetFilters}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  <X size={16} />
                  Reset
                </button>
              </div>

              <div>
                <p className="text-sm font-medium text-slate-700 mb-2">Quick roles</p>

                <div className="flex flex-wrap gap-2">
                  {quickRoleFilters.map((role) => (
                    <FilterPill
                      key={role}
                      active={selectedQuickRole === role}
                      label={role}
                      onClick={() => setSelectedQuickRole(role)}
                    />
                  ))}
                </div>
              </div>

              <div>
                <p className="text-sm font-medium text-slate-700 mb-2">Sources</p>

                <div className="flex flex-wrap gap-2">
                  <FilterPill
                    active={selectedSource === 'all'}
                    label={`All (${sourceCounts.all || 0})`}
                    onClick={() => setSelectedSource('all')}
                  />

                  {jobSources.map((source) => {
                    const count = sourceCounts[source.slug] || 0;

                    return (
                      <FilterPill
                        key={source.slug}
                        active={selectedSource === source.slug}
                        label={`${source.name} (${count})`}
                        onClick={() => setSelectedSource(source.slug)}
                      />
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <SelectInput
                  label="Score"
                  value={scoreFilter}
                  onChange={(value) => setScoreFilter(value as ScoreFilter)}
                  options={[
                    { value: 'all', label: 'All scores' },
                    { value: 'recommended', label: 'Recommended' },
                    { value: 'possible', label: 'Possible' },
                    { value: 'stretch', label: 'Stretch' },
                  ]}
                />

                <SelectInput
                  label="Date posted"
                  value={freshnessFilter}
                  onChange={(value) => setFreshnessFilter(value as FreshnessFilter)}
                  options={[
                    { value: '24h', label: 'Last 24 hours' },
                    { value: '3d', label: 'Last 3 days' },
                    { value: '7d', label: 'Last 7 days' },
                    { value: 'all', label: 'All' },
                  ]}
                />

                <SelectInput
                  label="Work model"
                  value={workModelFilter}
                  onChange={(value) => setWorkModelFilter(value as WorkModelFilter)}
                  options={[
                    { value: 'all', label: 'All' },
                    { value: 'remote', label: 'Remote' },
                    { value: 'hybrid', label: 'Hybrid' },
                    { value: 'onsite', label: 'On-site' },
                  ]}
                />

                <SelectInput
                  label="Sort"
                  value={sortMode}
                  onChange={(value) => setSortMode(value as SortMode)}
                  options={[
                    { value: 'newest', label: 'Newest first' },
                    { value: 'score', label: 'Highest score' },
                    { value: 'company', label: 'Company A-Z' },
                  ]}
                />
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="border-b border-slate-200 p-5 flex items-center justify-between gap-4">
              <h2 className="font-semibold text-slate-900 flex items-center gap-2">
                <Briefcase size={18} />
                Matched Jobs
              </h2>

              <span className="text-sm text-slate-500">
                {filteredJobs.length} result{filteredJobs.length === 1 ? '' : 's'}
              </span>
            </div>

            {filteredJobs.length === 0 ? (
              <div className="p-10 text-center">
                <Briefcase size={38} className="mx-auto text-slate-300 mb-3" />

                <h3 className="font-semibold text-slate-800">No matched jobs yet</h3>

                <p className="text-sm text-slate-500 mt-2 max-w-md mx-auto">
                  Once the job fetch worker is connected, matched roles from your enabled job
                  boards will appear here.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-200">
                {filteredJobs.map((job) => {
                  const match = matchesByJobId[job.id];
                  const score = match?.match_score ?? job.best_match_score;
                  const recommendation =
                    match?.recommendation || job.recommendation || 'unscored';
                  const matchedSkills = match?.matched_skills || [];
                  const missingSkills = match?.missing_skills || [];
                  const source = job.source_slug || job.source || 'unknown';

                  return (
                    <article key={job.id} className="p-5">
                      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-5">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 mb-2">
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                              {sourceLabels[source] || source}
                            </span>

                            <span
                              className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${getScoreBadgeClass(
                                score,
                              )}`}
                            >
                              {score ?? 'N/A'}/100 · {getRecommendationLabel(recommendation)}
                            </span>

                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                              {formatPostedAgo(job.source_posted_at || job.discovered_at)}
                            </span>
                          </div>

                          <h3 className="text-lg font-semibold text-slate-900">
                            {job.title}
                          </h3>

                          <div className="mt-2 flex flex-wrap gap-3 text-sm text-slate-500">
                            <span className="inline-flex items-center gap-1">
                              <Briefcase size={14} />
                              {job.company || 'Unknown company'}
                            </span>

                            <span className="inline-flex items-center gap-1">
                              <MapPin size={14} />
                              {job.location || 'Location not specified'}
                            </span>

                            {job.work_model && (
                              <span className="inline-flex items-center gap-1">
                                <CalendarClock size={14} />
                                {job.work_model}
                              </span>
                            )}

                            {job.salary_range && <span>{job.salary_range}</span>}
                          </div>

                          {match?.suggested_cv_angle && (
                            <div className="mt-4 rounded-2xl bg-slate-50 border border-slate-200 p-3">
                              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                                Suggested CV angle
                              </p>
                              <p className="text-sm text-slate-600">
                                {match.suggested_cv_angle}
                              </p>
                            </div>
                          )}

                          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                            <SkillList title="Matched skills" items={matchedSkills} positive />
                            <SkillList title="Missing skills" items={missingSkills} />
                          </div>
                        </div>

                        <div className="flex flex-col gap-2 lg:w-48 shrink-0">
                          <a
                            href={job.job_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                          >
                            <ExternalLink size={16} />
                            View Job
                          </a>

                          <button
                            type="button"
                            onClick={() => handleCreateApplication(job)}
                            disabled={creatingApplicationId === job.id}
                            className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
                          >
                            {creatingApplicationId === job.id ? (
                              <Loader2 size={16} className="animate-spin" />
                            ) : (
                              <Briefcase size={16} />
                            )}
                            Create App
                          </button>

                          <button
                            type="button"
                            onClick={() => handleTailorCv(job)}
                            className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-700"
                          >
                            <Sparkles size={16} />
                            Tailor CV
                          </button>

                          <button
                            type="button"
                            onClick={() => handleIgnoreJob(job.id)}
                            disabled={ignoringJobId === job.id}
                            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-red-50 hover:text-red-700 hover:border-red-200 disabled:opacity-50"
                          >
                            {ignoringJobId === job.id ? (
                              <Loader2 size={16} className="animate-spin" />
                            ) : (
                              <Trash2 size={16} />
                            )}
                            Ignore
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-6">
          <section className="rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="border-b border-slate-200 p-5">
              <h2 className="font-semibold text-slate-900 flex items-center gap-2">
                <Clock3 size={18} />
                Automation Status
              </h2>
            </div>

            <div className="p-5 space-y-4">
              <StatusRow
                label="Current status"
                value={preferences?.automation_enabled ? 'Enabled' : 'Disabled'}
              />

              <StatusRow
                label="Last run"
                value={latestRun ? formatDateTime(latestRun.created_at) : 'No runs yet'}
              />

              <StatusRow label="Last run status" value={latestRun?.status || 'Not started'} />

              <StatusRow
                label="Last saved jobs"
                value={latestRun ? String(latestRun.saved_count) : '0'}
              />

              <StatusRow
                label="Last duplicates"
                value={latestRun ? String(latestRun.duplicate_count) : '0'}
              />
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="border-b border-slate-200 p-5">
              <h2 className="font-semibold text-slate-900 flex items-center gap-2">
                <FileText size={18} />
                Recent Runs
              </h2>
            </div>

            {recentRuns.length === 0 ? (
              <div className="p-5 text-sm text-slate-500">No job search runs yet.</div>
            ) : (
              <div className="divide-y divide-slate-200">
                {recentRuns.map((run) => (
                  <div key={run.id} className="p-5">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-slate-800">
                        {run.source || run.run_type}
                      </p>

                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                        {run.status}
                      </span>
                    </div>

                    <p className="text-xs text-slate-500 mt-1">
                      {formatDateTime(run.created_at)}
                    </p>

                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
                      <span>Scanned: {run.scanned_count}</span>
                      <span>Saved: {run.saved_count}</span>
                      <span>Recommended: {run.recommended_count}</span>
                      <span>Duplicates: {run.duplicate_count}</span>
                    </div>

                    {run.error_message && (
                      <p className="mt-2 text-xs text-red-600">
                        {run.error_message}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
};

interface SummaryItemProps {
  label: string;
  value: string;
}

const SummaryItem: React.FC<SummaryItemProps> = ({ label, value }) => {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs uppercase tracking-wide font-semibold text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-sm font-medium text-slate-900 break-words">
        {value}
      </p>
    </div>
  );
};

interface StatCardProps {
  label: string;
  value: number;
  icon: React.ElementType;
}

const StatCard: React.FC<StatCardProps> = ({ label, value, icon: Icon }) => {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-slate-500">{label}</p>
          <p className="text-3xl font-bold text-slate-900 mt-1">{value}</p>
        </div>

        <div className="rounded-2xl bg-slate-100 p-3 text-slate-600">
          <Icon size={22} />
        </div>
      </div>
    </div>
  );
};

interface FilterPillProps {
  active: boolean;
  label: string;
  onClick: () => void;
}

const FilterPill: React.FC<FilterPillProps> = ({ active, label, onClick }) => {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
        active
          ? 'bg-slate-900 text-white'
          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
      }`}
    >
      {label}
    </button>
  );
};

interface SelectInputProps {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}

const SelectInput: React.FC<SelectInputProps> = ({
  label,
  value,
  options,
  onChange,
}) => {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-2">
        {label}
      </label>

      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
};

interface TextInputProps {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}

const TextInput: React.FC<TextInputProps> = ({
  label,
  value,
  placeholder,
  onChange,
}) => {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-2">
        {label}
      </label>

      <input
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
      />
    </div>
  );
};

interface NumberInputProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}

const NumberInput: React.FC<NumberInputProps> = ({
  label,
  value,
  min,
  max,
  onChange,
}) => {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-2">
        {label}
      </label>

      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
      />
    </div>
  );
};

interface SkillListProps {
  title: string;
  items: string[];
  positive?: boolean;
}

const SkillList: React.FC<SkillListProps> = ({
  title,
  items,
  positive = false,
}) => {
  return (
    <div>
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
        {title}
      </p>

      {items.length === 0 ? (
        <p className="text-sm text-slate-400">No data yet</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {items.slice(0, 8).map((item) => (
            <span
              key={item}
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                positive
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-amber-50 text-amber-700'
              }`}
            >
              {item}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

interface StatusRowProps {
  label: string;
  value: string;
}

const StatusRow: React.FC<StatusRowProps> = ({ label, value }) => {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-3 last:border-b-0 last:pb-0">
      <span className="text-sm text-slate-500">{label}</span>
      <span className="text-sm font-semibold text-slate-900 text-right">
        {value}
      </span>
    </div>
  );
};