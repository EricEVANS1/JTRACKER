// ============================================================
// JTracker Job Discovery Engine — Supabase Edge Function
// supabase/functions/job-pipeline/index.ts
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { errorResponse, getCorsHeaders, jsonResponse } from './_lib/cors.ts';
import { fetchJobsForPreferences } from './_lib/fetcher.ts';
import { cleanTerms, parseMaxCalls } from './_lib/queryPlan.ts';
import { chunk, filterNewJobs, insertSkippingDuplicates } from './_lib/saveJobs.ts';
import { applyJobFilters, filterReason } from './_lib/jobFilters.ts';
import { readAdzunaConfig } from './_lib/adzuna.ts';
import {
  buildMatchAlert,
  DEFAULT_SCHEDULED_MAX_CALLS,
  isScheduleSecretValid,
  SCHEDULED_RUN_BUDGET_MS,
  usersDueForSearch,
} from './_lib/schedule.ts';
import { summariseSources } from './_lib/searchReport.ts';
import { scoreJobAgainstCV } from './_lib/scorer.ts';
import type {
  CVProfile,
  JobAd,
  LLMConfig,
  RawJob,
  UserJobPreferences,
} from './_lib/types.ts';

// Settings used only where the user has none. Titles, locations, keywords and
// goals are never assumed: a search runs on what the user set.
const DEFAULT_PREFERENCES: UserJobPreferences = {
  user_id: '',
  default_cv_version_id: null,
  target_titles: [],
  preferred_locations: [],
  work_model: 'any',
  min_match_score: 60,
  excluded_keywords: [],
  career_goal: null,
  // Empty means every supported job board (see getSearchSources).
  enabled_sources: [],
  max_job_age_days: 7,
  automation_enabled: false,
};

const MISSING_SEARCH_TERMS_MESSAGE =
  'Add at least one target job title and one preferred location in your Job Automation preferences, then run the search again.';

const LLM_CONFIG: LLMConfig = {
  apiKey: Deno.env.get('LLAMA_API_KEY') || Deno.env.get('GROQ_API_KEY') || '',
  apiUrl: Deno.env.get('LLAMA_API_URL') || '',
  model:
    Deno.env.get('LLAMA_MODEL') ||
    Deno.env.get('GROQ_MODEL') ||
    'meta-llama/llama-3.1-8b-instruct',
  timeoutMs: 25_000,
};

const SERPAPI_KEY =
  Deno.env.get('SERPAPI_KEY') || Deno.env.get('SERP_API_KEY') || '';

// Adzuna (optional): ADZUNA_APP_ID, ADZUNA_APP_KEY and ADZUNA_COUNTRY secrets.
const ADZUNA = readAdzunaConfig((name) => Deno.env.get(name));

// Paid SerpAPI searches allowed per run (each title/location pair costs one per
// source). Defaults to 18; set JOB_SEARCH_MAX_CALLS to change it.
const MAX_SEARCH_CALLS = parseMaxCalls(Deno.env.get('JOB_SEARCH_MAX_CALLS'));

// Scheduled runs repeat through the day, so they get a smaller cap by default
// (JOB_SEARCH_SCHEDULED_MAX_CALLS to change it).
const SCHEDULED_MAX_SEARCH_CALLS = Number.isInteger(Number(Deno.env.get('JOB_SEARCH_SCHEDULED_MAX_CALLS'))) &&
    Number(Deno.env.get('JOB_SEARCH_SCHEDULED_MAX_CALLS')) > 0
  ? Number(Deno.env.get('JOB_SEARCH_SCHEDULED_MAX_CALLS'))
  : DEFAULT_SCHEDULED_MAX_CALLS;

function makeDedupHash(job: RawJob) {
  return `${job.source}:${job.external_id || job.job_url}`
    .toLowerCase()
    .replace(/\s+/g, '-')
    .slice(0, 500);
}

function getRecommendedBucket(score: number) {
  if (score >= 85) return 'recommended';
  if (score >= 70) return 'possible';
  if (score >= 55) return 'stretch';
  return 'not_recommended';
}

async function loadPreferences(
  supabase: ReturnType<typeof createClient>,
  userId: string,
): Promise<UserJobPreferences> {
  const { data } = await supabase
    .from('user_job_preferences')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  let row = data as Partial<UserJobPreferences> | null;

  if (!row) {
    await supabase.rpc('ensure_user_job_preferences', {
      target_user_id: userId,
    });

    const { data: created } = await supabase
      .from('user_job_preferences')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    row = created as Partial<UserJobPreferences> | null;
  }

  // The user's own settings as saved, cleaned up; nothing is filled in for them.
  return {
    ...DEFAULT_PREFERENCES,
    ...(row || {}),
    user_id: userId,
    target_titles: cleanTerms(row?.target_titles),
    preferred_locations: cleanTerms(row?.preferred_locations),
    enabled_sources: cleanTerms(row?.enabled_sources),
    excluded_keywords: cleanTerms(row?.excluded_keywords),
    // Missing until supabase/sql/2026-10-18_job_search_filters.sql has run; empty means any level.
    experience_levels: cleanTerms(row?.experience_levels),
    min_match_score: row?.min_match_score ?? DEFAULT_PREFERENCES.min_match_score,
    max_job_age_days: row?.max_job_age_days ?? DEFAULT_PREFERENCES.max_job_age_days,
  };
}

async function loadCVProfile(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  defaultCvVersionId: string | null,
): Promise<CVProfile | null> {
  if (defaultCvVersionId) {
    const { data } = await supabase
      .from('cv_versions')
      .select('*')
      .eq('id', defaultCvVersionId)
      .eq('user_id', userId)
      .maybeSingle();

    if (data) {
      return {
        cv_version_id: data.id,
        cv_text:
          data.cv_text ||
          data.original_text ||
          data.extracted_text ||
          data.raw_text ||
          null,
        structured_cv: data.structured_cv || data.generated_cv || null,
      };
    }
  }

  const { data: latestCV } = await supabase
    .from('cv_versions')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!latestCV) return null;

  return {
    cv_version_id: latestCV.id,
    cv_text:
      latestCV.cv_text ||
      latestCV.original_text ||
      latestCV.extracted_text ||
      latestCV.raw_text ||
      null,
    structured_cv: latestCV.structured_cv || latestCV.generated_cv || null,
  };
}

function getSourceLabel(source: string) {
  const labels: Record<string, string> = {
    google_jobs: 'Google Jobs',
    indeed: 'Indeed',
    linkedin: 'LinkedIn',
    justjoinit: 'JustJoinIT',
    nofluffjobs: 'NoFluffJobs',
    pracuj: 'Pracuj.pl',
    pracuj_it: 'Pracuj.pl IT',
    theprotocol: 'TheProtocol.it',
    bulldogjob: 'Bulldogjob',
    crossweb: 'Crossweb',
    adzuna: 'Adzuna',
  };

  return labels[source] || source;
}

async function insertJobAds(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  rawJobs: RawJob[],
  runId: string,
): Promise<{
  insertedJobs: JobAd[];
  duplicateCount: number;
}> {
  // Skip jobs this user already has, matched by dedup hash or by exact URL:
  // the same posting often comes back under another source or listing id.
  // Lookups are chunked to keep the request URL short.
  const existingHashes: string[] = [];
  const existingUrls: string[] = [];

  for (const hashes of chunk([...new Set(rawJobs.map(makeDedupHash))], 25)) {
    const { data } = await supabase.from('job_ads').select('dedup_hash').eq('user_id', userId).in('dedup_hash', hashes);
    existingHashes.push(...((data || []) as Array<{ dedup_hash: string }>).map((row) => row.dedup_hash));
  }

  for (const urls of chunk([...new Set(rawJobs.map((job) => job.job_url).filter(Boolean))], 25)) {
    const { data } = await supabase.from('job_ads').select('job_url').eq('user_id', userId).in('job_url', urls);
    existingUrls.push(...((data || []) as Array<{ job_url: string }>).map((row) => row.job_url));
  }

  const newJobs = filterNewJobs(rawJobs, makeDedupHash, existingHashes, existingUrls);

  if (newJobs.length === 0) {
    return {
      insertedJobs: [],
      duplicateCount: rawJobs.length,
    };
  }

  const rows = newJobs.map((job) => ({
    user_id: userId,
    title: job.title,
    company: job.company,
    location: job.location,
    work_model: job.work_model,
    salary_range: job.salary_range,
    job_url: job.job_url,
    source: getSourceLabel(job.source),
    source_slug: job.source,
    source_id: job.external_id,
    source_posted_at: job.source_posted_at,
    dedup_hash: makeDedupHash(job),
    description: job.description,
    employment_type: job.employment_type,
    remote_allowed: job.work_model === 'remote',
    raw_data: {
      ...job.raw_data,
      pipeline_run_id: runId,
    },
    discovered_at: new Date().toISOString(),
    ignored: false,
    status: 'new',
  }));

  // A duplicate that slips past the check above (e.g. saved by another user
  // while job_url is unique across all users) is skipped, not fatal.
  const { saved } = await insertSkippingDuplicates(rows, async (batch) => {
    const { data, error } = await supabase.from('job_ads').insert(batch).select('*');
    return { data: data as JobAd[] | null, error };
  });

  return {
    insertedJobs: saved,
    duplicateCount: rawJobs.length - saved.length,
  };
}

async function saveMatchResult(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  job: JobAd,
  cvProfile: CVProfile | null,
  score: Awaited<ReturnType<typeof scoreJobAgainstCV>>,
) {
  const { data: matchRow, error: matchError } = await supabase
    .from('job_match_results')
    .upsert(
      {
        user_id: userId,
        job_ad_id: job.id,
        cv_version_id: cvProfile?.cv_version_id || null,
        match_score: score.match_score,
        fit_label: score.fit_label,
        recommendation: score.recommendation,
        skill_score: score.skill_score,
        title_score: score.title_score,
        location_score: score.location_score,
        seniority_score: score.seniority_score,
        salary_score: score.salary_score,
        matched_skills: score.matched_skills,
        missing_skills: score.missing_skills,
        concerns: score.concerns,
        suggested_cv_angle: score.suggested_cv_angle,
        explanation: score.explanation,
        score_breakdown: {
          skill_score: score.skill_score,
          title_score: score.title_score,
          location_score: score.location_score,
          seniority_score: score.seniority_score,
          salary_score: score.salary_score,
        },
        raw_result: score.raw_result,
        ai_used: score.ai_used,
        embedding_used: false,
      },
      {
        onConflict: 'user_id,job_ad_id,cv_version_id',
      },
    )
    .select('id')
    .single();

  if (matchError) {
    throw new Error(`Failed to save match result: ${matchError.message}`);
  }

  await supabase
    .from('job_ads')
    .update({
      matched_at: new Date().toISOString(),
      best_match_score: score.match_score,
      best_fit_label: score.fit_label,
      recommendation: score.recommendation,
    })
    .eq('id', job.id)
    .eq('user_id', userId);

  return matchRow?.id || null;
}

// The service-role client, typed as createClient(url, key) returns it.
const createServiceClient = (url: string, key: string) => createClient(url, key);
type ServiceClient = ReturnType<typeof createServiceClient>;

// A problem with the request or setup, reported with its own status before a
// run is recorded.
class SearchRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

// One job search for one user: fetch, filter, save, score and record the run.
// Manual runs come from "Run Search Now"; scheduled runs from the scheduler.
async function runJobSearch(
  supabase: ServiceClient,
  userId: string,
  { trigger, maxSearchCalls }: { trigger: 'manual' | 'scheduled'; maxSearchCalls: number },
): Promise<Record<string, unknown>> {
  const startedAt = Date.now();
  let runId: string | null = null;

  try {
    const preferences = await loadPreferences(supabase, userId);

    // Without titles and locations there is nothing to search; stop before
    // recording a run or spending any SerpAPI calls.
    if (!preferences.target_titles.length || !preferences.preferred_locations.length) {
      throw new SearchRequestError(MISSING_SEARCH_TERMS_MESSAGE, 400);
    }

    // Every source except Adzuna searches through SerpAPI.
    const needsSerpApi =
      preferences.enabled_sources.length === 0 ||
      preferences.enabled_sources.some((source) => source !== 'adzuna');

    if (needsSerpApi && !SERPAPI_KEY) {
      throw new SearchRequestError('SERPAPI_KEY is missing. Add it in Supabase Edge Function secrets.', 500);
    }

    const { data: run, error: runError } = await supabase
      .from('job_search_runs')
      .insert({
        user_id: userId,
        search_profile_id: preferences.id || null,
        run_type: 'manual',
        source: 'serpapi',
        query: preferences.target_titles.join(', '),
        location: preferences.preferred_locations.join(', '),
        status: 'running',
        metadata: {
          trigger,
          target_titles: preferences.target_titles,
          preferred_locations: preferences.preferred_locations,
          enabled_sources: preferences.enabled_sources,
        },
      })
      .select('id')
      .single();

    if (runError || !run) {
      throw new Error(`Failed to create run: ${runError?.message}`);
    }

    runId = run.id;

    const cvProfile = await loadCVProfile(
      supabase,
      userId,
      preferences.default_cv_version_id,
    );

    const {
      jobs: fetchedJobs,
      queriesRun,
      sourcesUsed,
      combinationsSearched,
      combinationsSkipped,
      searchReports,
    } = await fetchJobsForPreferences(preferences, SERPAPI_KEY, 10, maxSearchCalls, { adzuna: ADZUNA });

    // LinkedIn-style filters: date posted (undated jobs are dropped), closed
    // postings, work model and experience level. Same rules as the job list.
    const workFromHome = (job: RawJob) =>
      (job.raw_data?.detected_extensions as Record<string, unknown> | undefined)?.work_from_home === true;
    const { kept: freshJobs, removed: filteredOut } = applyJobFilters(fetchedJobs, preferences, { workFromHome });

    // What each source found and kept, so sources that only return undated
    // or old pages are easy to spot.
    const sourceSummaries = summariseSources(sourcesUsed, fetchedJobs, (job) =>
      filterReason(job, preferences, { workFromHome: workFromHome(job) }),
    );

    const { insertedJobs, duplicateCount } = await insertJobAds(
      supabase,
      userId,
      freshJobs,
      runId,
    );

    let scoredCount = 0;
    let errorCount = 0;
    let recommendedCount = 0;
    let possibleCount = 0;
    let stretchCount = 0;
    let notRecommendedCount = 0;

    const topJobs: Array<{
      id: string;
      title: string;
      company: string | null;
      score: number;
      recommendation: string;
      job_url: string;
    }> = [];

    for (const job of insertedJobs.slice(0, 20)) {
      try {
        const score = await scoreJobAgainstCV(
          job,
          cvProfile,
          preferences,
          LLM_CONFIG,
        );

        await saveMatchResult(supabase, userId, job, cvProfile, score);

        scoredCount++;

        const bucket = getRecommendedBucket(score.match_score);

        if (bucket === 'recommended') recommendedCount++;
        if (bucket === 'possible') possibleCount++;
        if (bucket === 'stretch') stretchCount++;
        if (bucket === 'not_recommended') notRecommendedCount++;

        if (score.match_score >= preferences.min_match_score) {
          topJobs.push({
            id: job.id,
            title: job.title,
            company: job.company,
            score: score.match_score,
            recommendation: score.recommendation,
            job_url: job.job_url,
          });
        }
      } catch (error) {
        console.error('[job-pipeline] scoring error:', error);
        errorCount++;
      }
    }

    topJobs.sort((a, b) => b.score - a.score);

    await supabase
      .from('job_search_runs')
      .update({
        status: errorCount > 0 && scoredCount === 0 ? 'partial' : 'completed',
        scanned_count: fetchedJobs.length,
        saved_count: insertedJobs.length,
        recommended_count: recommendedCount,
        possible_count: possibleCount,
        stretch_count: stretchCount,
        not_recommended_count: notRecommendedCount,
        duplicate_count: duplicateCount,
        error_count: errorCount,
        completed_at: new Date().toISOString(),
        metadata: {
          sources_used: sourcesUsed,
          queries_run: queriesRun,
          combinations_searched: combinationsSearched,
          combinations_skipped: combinationsSkipped,
          trigger,
          max_search_calls: maxSearchCalls,
          search_reports: searchReports,
          source_summaries: sourceSummaries,
          fetched_count: fetchedJobs.length,
          fresh_count: freshJobs.length,
          filtered_out: filteredOut,
          inserted_count: insertedJobs.length,
          scored_count: scoredCount,
          processing_time_ms: Date.now() - startedAt,
          no_cv_warning: !cvProfile,
        },
      })
      .eq('id', runId);

    // A scheduled run tells the user about new matches (one notification).
    if (trigger === 'scheduled') {
      const alert = buildMatchAlert(topJobs);
      if (alert) {
        const { error: alertError } = await supabase
          .from('notifications')
          .insert({ user_id: userId, actor_user_id: null, ...alert, read: false });
        if (alertError) console.error('[job-pipeline] match alert failed:', alertError.message);
      }
    }

    return {
      success: true,
      run_id: runId,
      scanned_count: fetchedJobs.length,
      fresh_count: freshJobs.length,
      filtered_out: filteredOut,
      saved_count: insertedJobs.length,
      duplicate_count: duplicateCount,
      scored_count: scoredCount,
      error_count: errorCount,
      recommended_count: recommendedCount,
      possible_count: possibleCount,
      stretch_count: stretchCount,
      not_recommended_count: notRecommendedCount,
      processing_time_ms: Date.now() - startedAt,
      top_jobs: topJobs.slice(0, 10),
      no_cv_warning: !cvProfile,
      combinations_searched: combinationsSearched,
      combinations_skipped: combinationsSkipped,
      search_reports: searchReports,
      source_summaries: sourceSummaries,
    };
  } catch (error) {
    if (error instanceof SearchRequestError) throw error;

    const message = error instanceof Error ? error.message : String(error);

    console.error('[job-pipeline] fatal:', message);

    if (runId) {
      await supabase
        .from('job_search_runs')
        .update({
          status: 'failed',
          error_message: message,
          error_count: 1,
          completed_at: new Date().toISOString(),
          metadata: {
            trigger,
            processing_time_ms: Date.now() - startedAt,
          },
        })
        .eq('id', runId);
    }

    throw error;
  }
}

// Scheduled runs (from Supabase's scheduler, see
// supabase/sql/2026-10-18_scheduled_job_search.sql): every user with
// automation on who hasn't been searched in the last 50 minutes, longest
// waiting first, until the time budget is used.
async function runScheduledSearches(supabase: ServiceClient) {
  const startedAt = Date.now();

  const { data: optedIn, error } = await supabase
    .from('user_job_preferences')
    .select('user_id')
    .eq('automation_enabled', true);

  if (error) throw new Error(`Failed to load scheduled users: ${error.message}`);

  const userIds = ((optedIn || []) as Array<{ user_id: string }>).map((row) => row.user_id);
  const lastRunAt: Record<string, string> = {};

  if (userIds.length) {
    const { data: runs } = await supabase
      .from('job_search_runs')
      .select('user_id, created_at')
      .in('user_id', userIds)
      .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false });

    for (const run of (runs || []) as Array<{ user_id: string; created_at: string }>) {
      lastRunAt[run.user_id] ??= run.created_at;
    }
  }

  const due = usersDueForSearch(userIds, lastRunAt);
  const summary = { opted_in: userIds.length, due: due.length, searched: 0, skipped: 0, failed: 0, deferred: 0 };

  for (const userId of due) {
    if (Date.now() - startedAt > SCHEDULED_RUN_BUDGET_MS) {
      summary.deferred++;
      continue;
    }

    try {
      await runJobSearch(supabase, userId, { trigger: 'scheduled', maxSearchCalls: SCHEDULED_MAX_SEARCH_CALLS });
      summary.searched++;
    } catch (runError) {
      if (runError instanceof SearchRequestError) {
        summary.skipped++;
      } else {
        summary.failed++;
        console.error('[job-pipeline] scheduled run failed:', runError instanceof Error ? runError.message : runError);
      }
    }
  }

  console.log('[job-pipeline] scheduled searches:', summary);
  return { success: true, mode: 'scheduled', ...summary };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: getCorsHeaders(),
    });
  }

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    return errorResponse('Supabase environment variables are missing.', 500);
  }

  const supabase = createServiceClient(supabaseUrl, serviceRoleKey);

  // The scheduler identifies itself with the shared secret, not a user.
  const scheduleSecret = req.headers.get('x-cron-secret');
  if (scheduleSecret !== null) {
    if (!isScheduleSecretValid(scheduleSecret, Deno.env.get('JOB_SEARCH_CRON_SECRET'))) {
      return errorResponse('Unauthorized.', 401);
    }

    try {
      return jsonResponse(await runScheduledSearches(supabase));
    } catch (error) {
      return errorResponse(error instanceof Error ? error.message : String(error), 500);
    }
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return errorResponse('Missing Authorization header.', 401);
  }

  const token = authHeader.replace('Bearer ', '');
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);

  if (userError || !user) {
    return errorResponse('Unauthorized.', 401);
  }

  try {
    return jsonResponse(await runJobSearch(supabase, user.id, { trigger: 'manual', maxSearchCalls: MAX_SEARCH_CALLS }));
  } catch (error) {
    if (error instanceof SearchRequestError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : String(error), 500);
  }
});
