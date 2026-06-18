// ============================================================
// JTracker Job Discovery Engine — Supabase Edge Function
// supabase/functions/job-pipeline/index.ts
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { errorResponse, getCorsHeaders, jsonResponse } from './_lib/cors.ts';
import { fetchJobsForPreferences } from './_lib/fetcher.ts';
import { scoreJobAgainstCV } from './_lib/scorer.ts';
import type {
  CVProfile,
  JobAd,
  LLMConfig,
  RawJob,
  UserJobPreferences,
} from './_lib/types.ts';

const DEFAULT_PREFERENCES: UserJobPreferences = {
  user_id: '',
  default_cv_version_id: null,
  target_titles: [
    'Technical Support Engineer',
    'IT Support Specialist',
    'Application Support Analyst',
    'Cloud Support Engineer',
    'Junior Software Engineer',
  ],
  preferred_locations: ['Warsaw, Poland', 'Poland', 'Remote Poland'],
  work_model: 'any',
  min_match_score: 60,
  excluded_keywords: ['senior', 'lead', 'manager', '7+ years', '10+ years'],
  career_goal:
    'Find a strong technical support, cloud support, QA, or junior software engineering role in Poland.',
  enabled_sources: ['google_jobs', 'indeed'],
  max_job_age_days: 7,
  automation_enabled: false,
};

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

function isFreshEnough(job: RawJob, maxAgeDays: number) {
  if (!job.source_posted_at) return true;

  const posted = new Date(job.source_posted_at).getTime();
  if (Number.isNaN(posted)) return true;

  const ageDays = (Date.now() - posted) / (1000 * 60 * 60 * 24);
  return ageDays <= maxAgeDays;
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

  if (!data) {
    await supabase.rpc('ensure_user_job_preferences', {
      target_user_id: userId,
    });

    const { data: created } = await supabase
      .from('user_job_preferences')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    return {
      ...DEFAULT_PREFERENCES,
      ...(created || {}),
      user_id: userId,
    };
  }

  return {
    ...DEFAULT_PREFERENCES,
    ...data,
    user_id: userId,
    target_titles:
      data.target_titles?.length > 0
        ? data.target_titles
        : DEFAULT_PREFERENCES.target_titles,
    preferred_locations:
      data.preferred_locations?.length > 0
        ? data.preferred_locations
        : DEFAULT_PREFERENCES.preferred_locations,
    enabled_sources:
      data.enabled_sources?.includes('google_jobs') ||
      data.enabled_sources?.includes('indeed')
        ? data.enabled_sources
        : ['google_jobs', 'indeed'],
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

async function insertJobAds(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  rawJobs: RawJob[],
  runId: string,
): Promise<{
  insertedJobs: JobAd[];
  duplicateCount: number;
}> {
  const dedupHashes = rawJobs.map(makeDedupHash);

  const { data: existing } = await supabase
    .from('job_ads')
    .select('dedup_hash')
    .eq('user_id', userId)
    .in('dedup_hash', dedupHashes);

  const existingHashes = new Set((existing || []).map((item) => item.dedup_hash));

  const newJobs = rawJobs.filter((job) => !existingHashes.has(makeDedupHash(job)));

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
    source: job.source === 'google_jobs' ? 'Google Jobs' : 'Indeed',
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

  const { data: inserted, error } = await supabase
    .from('job_ads')
    .insert(rows)
    .select('*');

  if (error) {
    throw new Error(`Failed to insert job ads: ${error.message}`);
  }

  return {
    insertedJobs: (inserted || []) as JobAd[],
    duplicateCount: rawJobs.length - (inserted?.length || 0),
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: getCorsHeaders(),
    });
  }

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  const startedAt = Date.now();

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    return errorResponse('Supabase environment variables are missing.', 500);
  }

  if (!SERPAPI_KEY) {
    return errorResponse(
      'SERPAPI_KEY is missing. Add it in Supabase Edge Function secrets.',
      500,
    );
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return errorResponse('Missing Authorization header.', 401);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const token = authHeader.replace('Bearer ', '');
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);

  if (userError || !user) {
    return errorResponse('Unauthorized.', 401);
  }

  let runId: string | null = null;

  try {
    const preferences = await loadPreferences(supabase, user.id);

    const { data: run, error: runError } = await supabase
      .from('job_search_runs')
      .insert({
        user_id: user.id,
        search_profile_id: preferences.id || null,
        run_type: 'manual',
        source: 'serpapi',
        query: preferences.target_titles.join(', '),
        location: preferences.preferred_locations.join(', '),
        status: 'running',
        metadata: {
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
      user.id,
      preferences.default_cv_version_id,
    );

    const {
      jobs: fetchedJobs,
      queriesRun,
      sourcesUsed,
    } = await fetchJobsForPreferences(preferences, SERPAPI_KEY, 10);

    const freshJobs = fetchedJobs.filter((job) =>
      isFreshEnough(job, preferences.max_job_age_days),
    );

    const { insertedJobs, duplicateCount } = await insertJobAds(
      supabase,
      user.id,
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

        await saveMatchResult(supabase, user.id, job, cvProfile, score);

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
          fetched_count: fetchedJobs.length,
          fresh_count: freshJobs.length,
          inserted_count: insertedJobs.length,
          scored_count: scoredCount,
          processing_time_ms: Date.now() - startedAt,
          no_cv_warning: !cvProfile,
        },
      })
      .eq('id', runId);

    return jsonResponse({
      success: true,
      run_id: runId,
      scanned_count: fetchedJobs.length,
      fresh_count: freshJobs.length,
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
    });
  } catch (error) {
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
            processing_time_ms: Date.now() - startedAt,
          },
        })
        .eq('id', runId);
    }

    return errorResponse(message, 500);
  }
});