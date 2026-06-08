// ============================================================
// smart-worker/index.ts — orchestration only
// v6.3 — modular _lib architecture + deterministic ATS evidence fallback
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import {
  getCorsHeaders,
  sseHeaders,
  sendSse,
  errorResponse,
} from './_lib/cors.ts';

import { extractTextFromFile } from './_lib/extractor.ts';
import { parseCV, isCacheValid } from './_lib/parse-cv.ts';
import { parseJD } from './_lib/parse-jd.ts';
import { scoreStructured } from './_lib/score.ts';
import { generateSuggestions } from './_lib/suggestions.ts';
import { assembleCv, assembleCvFromFactsOnly } from './_lib/assembler.ts';
import {
  computeWeightedScore,
  computeScoreComponents,
} from './_lib/weighted.ts';
import {
  buildLearningContext,
  distilPattern,
} from './_lib/learning.ts';
import { deduplicateKeywords } from './_lib/helpers.ts';
import {
  buildDeterministicAtsReport,
  mergeAtsEvidenceIntoAnalysis,
} from './_lib/ats-matcher.ts';

import type {
  CVSuggestions,
  LLMConfig,
  StructuredCV,
} from './_lib/types.ts';

type AtsEvidenceStatus = 'matched' | 'partial' | 'missing';
type AtsEvidencePriority = 'critical' | 'required' | 'nice_to_have' | 'inferred';

type AtsEvidenceItem = {
  keyword: string;
  canonical: string;
  status: AtsEvidenceStatus;
  priority: AtsEvidencePriority;
  matched_as?: string | null;
  evidence: string[];
  reason?: string | null;
};

const LLM_CONFIG: LLMConfig = {
  apiKey: Deno.env.get('LLAMA_API_KEY') || '',
  apiUrl: Deno.env.get('LLAMA_API_URL') || '',
  models: [
    Deno.env.get('LLAMA_MODEL') || 'meta-llama/llama-3.1-8b-instruct',
    'meta-llama/llama-3.1-8b-instruct',
    'mistralai/mistral-7b-instruct',
    'google/gemma-2-9b-it',
  ].filter((model, index, arr) => Boolean(model) && arr.indexOf(model) === index),
  timeoutMs: 20_000,
  maxRetries: 2,
  retryDelaysMs: [1_000, 2_000],
};

const normalizeEvidenceKeyword = (keyword: unknown): string =>
  String(keyword ?? '')
    .trim();

const canonicalFallback = (keyword: unknown): string =>
  String(keyword ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const buildFallbackAtsEvidenceItems = (analysisResult: any): AtsEvidenceItem[] => {
  const fallbackMatched = deduplicateKeywords(
    Array.isArray(analysisResult?.matched_keywords)
      ? analysisResult.matched_keywords
      : [],
  );

  const fallbackPartial = deduplicateKeywords(
    Array.isArray(analysisResult?.partial_keywords)
      ? analysisResult.partial_keywords
      : [],
  );

  const fallbackMissing = deduplicateKeywords(
    Array.isArray(analysisResult?.missing_keywords)
      ? analysisResult.missing_keywords
      : [],
  );

  const matchedItems: AtsEvidenceItem[] = fallbackMatched
    .map(normalizeEvidenceKeyword)
    .filter(Boolean)
    .map((keyword) => ({
      keyword,
      canonical: canonicalFallback(keyword),
      status: 'matched',
      priority: 'required',
      matched_as: keyword,
      evidence: [keyword],
      reason:
        'Recovered from merged keyword analysis because deterministic ATS evidence was empty.',
    }));

  const partialItems: AtsEvidenceItem[] = fallbackPartial
    .map(normalizeEvidenceKeyword)
    .filter(Boolean)
    .map((keyword) => ({
      keyword,
      canonical: canonicalFallback(keyword),
      status: 'partial',
      priority: 'required',
      matched_as: keyword,
      evidence: [keyword],
      reason: 'Recovered as partial keyword evidence from merged analysis.',
    }));

  const missingItems: AtsEvidenceItem[] = fallbackMissing
    .map(normalizeEvidenceKeyword)
    .filter(Boolean)
    .map((keyword) => ({
      keyword,
      canonical: canonicalFallback(keyword),
      status: 'missing',
      priority: 'required',
      matched_as: null,
      evidence: [],
      reason: 'Recovered as missing keyword evidence from merged analysis.',
    }));

  return [...matchedItems, ...partialItems, ...missingItems];
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: getCorsHeaders(req),
    });
  }

  if (req.method !== 'POST') {
    return errorResponse(req, 'Method not allowed', 405);
  }

  return new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          sendSse(controller, 'progress', {
            step: 'starting',
            message: 'Starting CV intelligence analysis...',
            percent: 5,
          });

          if (!LLM_CONFIG.apiUrl) {
            sendSse(controller, 'error', {
              message: 'LLAMA_API_URL is not configured',
            });
            controller.close();
            return;
          }

          if (!LLM_CONFIG.apiKey) {
            sendSse(controller, 'error', {
              message: 'LLAMA_API_KEY is not configured',
            });
            controller.close();
            return;
          }

          const supabaseUrl = Deno.env.get('SUPABASE_URL');
          const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

          if (!supabaseUrl || !supabaseServiceKey) {
            sendSse(controller, 'error', {
              message: 'Supabase environment variables are not configured',
            });
            controller.close();
            return;
          }

          const authHeader = req.headers.get('Authorization');

          if (!authHeader) {
            sendSse(controller, 'error', {
              message: 'Missing Authorization header',
            });
            controller.close();
            return;
          }

          sendSse(controller, 'progress', {
            step: 'auth',
            message: 'Checking your session...',
            percent: 10,
          });

          const supabase = createClient(supabaseUrl, supabaseServiceKey);

          const {
            data: { user },
            error: authError,
          } = await supabase.auth.getUser(
            authHeader.replace('Bearer ', ''),
          );

          if (authError || !user) {
            sendSse(controller, 'error', {
              message: 'Unauthorized',
            });
            controller.close();
            return;
          }

          const body = await req.json();
          const cv_version_id = body?.cv_version_id;
          const job_description = body?.job_description;

          if (!cv_version_id || !job_description?.trim()) {
            sendSse(controller, 'error', {
              message: 'cv_version_id and job_description are required',
            });
            controller.close();
            return;
          }

          if (job_description.length > 20_000) {
            sendSse(controller, 'error', {
              message: 'Job description is too long. Please shorten it.',
            });
            controller.close();
            return;
          }

          sendSse(controller, 'progress', {
            step: 'loading_cv',
            message: 'Loading your CV...',
            percent: 18,
          });

          console.log('SMART WORKER DEBUG:', {
            cv_version_id,
            auth_user_id: user.id,
          });

          const { data: cvVersion, error: cvError } = await supabase
            .from('cv_versions')
            .select('*')
            .eq('id', cv_version_id)
            .maybeSingle();

          if (cvError || !cvVersion) {
            console.error('CV VERSION NOT FOUND:', {
              cv_version_id,
              auth_user_id: user.id,
              cvError,
            });

            sendSse(controller, 'error', {
              message: `CV version not found. ID received: ${cv_version_id}`,
            });

            controller.close();
            return;
          }

          if (cvVersion.user_id && cvVersion.user_id !== user.id) {
            console.error('CV VERSION USER MISMATCH:', {
              cv_version_id,
              auth_user_id: user.id,
              cv_owner_id: cvVersion.user_id,
            });

            sendSse(controller, 'error', {
              message:
                'This CV belongs to a different user session. Please refresh and sign in again.',
            });

            controller.close();
            return;
          }

          let cvText = cvVersion.cv_text?.trim() || '';

          if (!cvText && cvVersion.file_url) {
            sendSse(controller, 'progress', {
              step: 'extracting_cv',
              message: 'Extracting text from your CV file...',
              percent: 22,
            });

            cvText = await extractTextFromFile(cvVersion.file_url);

            if (
              !cvText ||
              cvText.length < 500 ||
              cvText.startsWith('%PDF') ||
              !cvText.toLowerCase().includes('experience')
            ) {
              sendSse(controller, 'error', {
                message:
                  'CV extraction failed. The parser did not return enough readable CV content.',
              });

              controller.close();
              return;
            }

            if (cvText.trim().startsWith('%PDF')) {
              cvText = '';
            }

            if (cvText.trim()) {
              await supabase
                .from('cv_versions')
                .update({ cv_text: cvText })
                .eq('id', cvVersion.id)
                .eq('user_id', user.id);
            }
          }

          if (!cvText.trim()) {
            sendSse(controller, 'error', {
              message:
                'Could not extract readable text from this CV. Please upload a text-based PDF or DOCX.',
            });
            controller.close();
            return;
          }

          let structuredCV: StructuredCV;

          const cvCacheHit = await isCacheValid(cvVersion.structured_cv, cvText);

          if (cvCacheHit) {
            console.log('[Pass 1A] Using cached structured CV');
            structuredCV = cvVersion.structured_cv as StructuredCV;
          } else {
            sendSse(controller, 'progress', {
              step: 'parsing_cv',
              message: 'Parsing your CV into verified facts...',
              percent: 28,
            });

            structuredCV = await parseCV(cvText, LLM_CONFIG);

            await supabase
              .from('cv_versions')
              .update({ structured_cv: structuredCV })
              .eq('id', cv_version_id)
              .eq('user_id', user.id);
          }

          sendSse(controller, 'progress', {
            step: 'parsing_jd',
            message: 'Extracting job requirements...',
            percent: 36,
          });

          const structuredJD = await parseJD(
            job_description,
            LLM_CONFIG,
          );

          sendSse(controller, 'progress', {
            step: 'learning_context',
            message: 'Checking previous scoring patterns...',
            percent: 43,
          });

          const learningContext = await buildLearningContext(
            user.id,
            structuredJD.role_category,
            supabase,
          );

          sendSse(controller, 'progress', {
            step: 'analysis',
            message:
              'Analysing job fit, transferable skills, and ATS match...',
            percent: 55,
          });

          const llmAnalysisResult = await scoreStructured(
            structuredCV,
            structuredJD,
            learningContext.contextBlock,
            LLM_CONFIG,
          );

          const atsEvidenceReport = buildDeterministicAtsReport(
            structuredCV,
            structuredJD,
            cvText,
            job_description,
          );

          console.log('[ATS DEBUG] raw report:', {
            reportKeys: Object.keys(atsEvidenceReport || {}),
            evidenceLength: Array.isArray((atsEvidenceReport as any).evidence)
              ? (atsEvidenceReport as any).evidence.length
              : 'not array',
            matched: atsEvidenceReport.matched_keywords?.length ?? 0,
            partial: atsEvidenceReport.partial_keywords?.length ?? 0,
            missing: atsEvidenceReport.missing_keywords?.length ?? 0,
            atsScore: atsEvidenceReport.ats_match_score,
            sampleEvidence: Array.isArray((atsEvidenceReport as any).evidence)
              ? (atsEvidenceReport as any).evidence.slice(0, 5)
              : [],
          });

          let atsEvidenceItems: AtsEvidenceItem[] =
            Array.isArray((atsEvidenceReport as any).evidence)
              ? (atsEvidenceReport as any).evidence
              : Array.isArray((atsEvidenceReport as any).keyword_evidence)
                ? (atsEvidenceReport as any).keyword_evidence
                : Array.isArray((atsEvidenceReport as any).ats_keyword_evidence)
                  ? (atsEvidenceReport as any).ats_keyword_evidence
                  : Array.isArray((atsEvidenceReport as any).requirements)
                    ? (atsEvidenceReport as any).requirements
                    : [];

          console.log('[ATS DEBUG] resolved evidence items before merge:', {
            keys: Object.keys(atsEvidenceReport || {}),
            count: Array.isArray(atsEvidenceItems) ? atsEvidenceItems.length : 0,
            sample: Array.isArray(atsEvidenceItems) ? atsEvidenceItems.slice(0, 5) : [],
          });

          const analysisResult = mergeAtsEvidenceIntoAnalysis(
            llmAnalysisResult,
            atsEvidenceReport,
          );

          if (!atsEvidenceItems.length) {
            atsEvidenceItems = buildFallbackAtsEvidenceItems(analysisResult);

            console.warn(
              '[ATS FALLBACK] Deterministic evidence was empty. Recovered from analysisResult keywords.',
              {
                matched: Array.isArray(analysisResult.matched_keywords)
                  ? analysisResult.matched_keywords.length
                  : 0,
                partial: Array.isArray(analysisResult.partial_keywords)
                  ? analysisResult.partial_keywords.length
                  : 0,
                missing: Array.isArray(analysisResult.missing_keywords)
                  ? analysisResult.missing_keywords.length
                  : 0,
                recoveredEvidenceCount: atsEvidenceItems.length,
              },
            );
          }

          const atsMatchedCount = atsEvidenceItems.filter(
            (item) => item.status === 'matched',
          ).length;

          const atsPartialCount = atsEvidenceItems.filter(
            (item) => item.status === 'partial',
          ).length;

          const atsMissingCount = atsEvidenceItems.filter(
            (item) => item.status === 'missing',
          ).length;

          const atsCriticalMissingCount = atsEvidenceItems.filter(
            (item) =>
              item.status === 'missing' &&
              (item.priority === 'critical' || item.priority === 'required'),
          ).length;

          const atsEvidenceSummary = {
            total_requirements: atsEvidenceItems.length,
            matched_count: atsMatchedCount,
            partial_count: atsPartialCount,
            missing_count: atsMissingCount,
            deterministic_score:
              (atsEvidenceReport as any).ats_match_score ??
              (atsEvidenceReport as any).deterministic_score ??
              (atsEvidenceReport as any).keyword_coverage_score ??
              0,
            coverage_ratio: atsEvidenceItems.length
              ? (atsMatchedCount + atsPartialCount * 0.5) /
                atsEvidenceItems.length
              : 0,
            critical_missing_count: atsCriticalMissingCount,
          };

          console.log('[ATS DEBUG] final evidence summary:', atsEvidenceSummary);

          const primaryScore = computeWeightedScore(
            analysisResult,
            structuredCV,
            structuredJD,
          );

          sendSse(controller, 'progress', {
            step: 'cv_generation',
            message: 'Generating CV improvement suggestions...',
            percent: 68,
          });

          let cvSuggestions: CVSuggestions | null = null;

          if (!analysisResult.is_truncated) {
            cvSuggestions = await generateSuggestions(
              structuredCV,
              structuredJD,
              Array.isArray(analysisResult.missing_keywords)
                ? analysisResult.missing_keywords
                : [],
              LLM_CONFIG,
            );

            if (cvSuggestions) {
              await supabase
                .from('cv_versions')
                .update({ cv_suggestions: cvSuggestions })
                .eq('id', cv_version_id)
                .eq('user_id', user.id);
            }
          }

          sendSse(controller, 'progress', {
            step: 'assembling',
            message: 'Assembling your tailored CV...',
            percent: 80,
          });

          const generatedCv = cvSuggestions
            ? assembleCv(structuredCV, cvSuggestions)
            : assembleCvFromFactsOnly(structuredCV);

          sendSse(controller, 'progress', {
            step: 'saving',
            message: 'Saving analysis results...',
            percent: 90,
          });

          const matchedKeywords = deduplicateKeywords(
            analysisResult.matched_keywords ?? [],
          );

          const missingKeywords = deduplicateKeywords(
            analysisResult.missing_keywords ?? [],
          );

          const partialKeywords = deduplicateKeywords(
            analysisResult.partial_keywords ?? [],
          );

          const weightedScoreComponents = computeScoreComponents(
            analysisResult,
            structuredCV,
            structuredJD,
          );

          const atsStrengths = atsEvidenceReport.strengths ?? [];
          const atsRisks =
            Array.isArray((atsEvidenceReport as any).risks)
              ? (atsEvidenceReport as any).risks
              : atsEvidenceReport.gaps ?? [];

          const { data: savedAnalysis, error: saveError } = await supabase
            .from('cv_analyses')
            .insert({
              user_id: user.id,
              cv_version_id,
              job_description,
              job_title: structuredJD.job_title ?? null,
              company_name: structuredJD.company_name ?? null,

              score: primaryScore,
              score_breakdown: analysisResult.score_breakdown ?? {},

              matched_keywords: matchedKeywords,
              missing_keywords: missingKeywords,
              partial_keywords: partialKeywords,

              ats_evidence: atsEvidenceSummary,
              ats_keyword_evidence: atsEvidenceItems,
              ats_strengths: atsStrengths,
              ats_risks: atsRisks,

              strengths: analysisResult.strengths ?? [],
              gaps: analysisResult.gaps ?? [],

              suggestions: [
                ...(analysisResult.ai_recommendations ?? []),
                ...(analysisResult.cv_improvement_actions ?? []),
              ],

              generated_cv: generatedCv,
              role_category: structuredJD.role_category ?? null,

              extended_data: {
                recommended_to_apply:
                  analysisResult.recommended_to_apply,
                qualification_verdict:
                  analysisResult.qualification_verdict,

                transferability_score:
                  analysisResult.transferability_score,
                ats_match_score: analysisResult.ats_match_score,
                seniority_match_score:
                  analysisResult.seniority_match_score,
                skill_gap_score: analysisResult.skill_gap_score,

                strongest_transferable_skills:
                  analysisResult.strongest_transferable_skills ?? [],

                critical_missing_skills:
                  analysisResult.critical_missing_skills ?? [],
                learnable_missing_skills:
                  analysisResult.learnable_missing_skills ?? [],
                nice_to_have_missing_skills:
                  analysisResult.nice_to_have_missing_skills ?? [],

                ai_recommendations:
                  analysisResult.ai_recommendations ?? [],
                cv_improvement_actions:
                  analysisResult.cv_improvement_actions ?? [],

                is_truncated: analysisResult.is_truncated ?? false,
                structured_jd: structuredJD,
                weighted_score_components: weightedScoreComponents,

                ats_evidence_summary: atsEvidenceSummary,
                ats_keyword_evidence: atsEvidenceItems,
                ats_strengths: atsStrengths,
                ats_risks: atsRisks,
                deterministic_ats_score:
                  atsEvidenceReport.ats_match_score,
                deterministic_keyword_coverage_score:
                  atsEvidenceReport.keyword_coverage_score,

                fact_lock: true,
                cv_cache_hit: cvCacheHit,
              },
            })
            .select()
            .single();

          if (saveError) {
            console.error('Failed to save analysis:', saveError);
          }

          await supabase
            .from('cv_versions')
            .update({
              last_score: primaryScore,
              last_analyzed_at: new Date().toISOString(),
            })
            .eq('id', cv_version_id)
            .eq('user_id', user.id);

          let patternsUpdated = false;

          if (
            primaryScore >= 65 &&
            savedAnalysis &&
            !analysisResult.is_truncated
          ) {
            patternsUpdated = await distilPattern(
              user.id,
              savedAnalysis.id,
              analysisResult,
              structuredJD,
              primaryScore,
              supabase,
            );
          }

          const fullAnalysis = {
            ...(savedAnalysis ?? {}),

            recommended_to_apply:
              analysisResult.recommended_to_apply,
            qualification_verdict:
              analysisResult.qualification_verdict,

            overall_job_fit_score: primaryScore,
            score: primaryScore,

            transferability_score:
              analysisResult.transferability_score,
            ats_match_score: analysisResult.ats_match_score,
            seniority_match_score:
              analysisResult.seniority_match_score,
            skill_gap_score: analysisResult.skill_gap_score,

            strongest_transferable_skills:
              analysisResult.strongest_transferable_skills ?? [],

            critical_missing_skills:
              analysisResult.critical_missing_skills ?? [],
            learnable_missing_skills:
              analysisResult.learnable_missing_skills ?? [],
            nice_to_have_missing_skills:
              analysisResult.nice_to_have_missing_skills ?? [],

            ai_recommendations:
              analysisResult.ai_recommendations ?? [],
            cv_improvement_actions:
              analysisResult.cv_improvement_actions ?? [],

            matched_keywords: matchedKeywords,
            missing_keywords: missingKeywords,
            partial_keywords: partialKeywords,

            ats_evidence: atsEvidenceSummary,
            ats_keyword_evidence: atsEvidenceItems,
            ats_strengths: atsStrengths,
            ats_risks: atsRisks,

            strengths: analysisResult.strengths ?? [],
            gaps: analysisResult.gaps ?? [],

            generated_cv: generatedCv,
            score_breakdown: analysisResult.score_breakdown ?? {},

            job_title: structuredJD.job_title ?? null,
            company_name: structuredJD.company_name ?? null,

            is_truncated: analysisResult.is_truncated ?? false,
            structured_cv: structuredCV,
            cv_suggestions: cvSuggestions,

            id: savedAnalysis?.id ?? 'unsaved',
            user_id: user.id,
            cv_version_id,
            created_at:
              savedAnalysis?.created_at ?? new Date().toISOString(),

            save_warning: saveError
              ? 'Analysis completed but could not be saved.'
              : null,

            role_category: structuredJD.role_category ?? null,
          };

          sendSse(controller, 'progress', {
            step: 'complete',
            message: 'Analysis complete.',
            percent: 100,
          });

          sendSse(controller, 'complete', {
            analysis: fullAnalysis,
            learning_context_used: learningContext.hasPastData,
            patterns_updated: patternsUpdated,
          });

          controller.close();
        } catch (err) {
          console.error('Unhandled error:', err);

          sendSse(controller, 'error', {
            message:
              err instanceof Error
                ? err.message
                : 'An unknown internal error occurred',
          });

          controller.close();
        }
      },
    }),
    {
      headers: sseHeaders(req),
      status: 200,
    },
  );
});
