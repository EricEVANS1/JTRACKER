// ============================================================
// JTracker CV Intelligence Engine — Edge Function: smart-worker
// Supabase Edge Function version
// Adds:
//   1. SSE streaming progress updates
//   2. Strong synonym / alias mapping
//   3. Fixed dynamic CORS for localhost + production
//   4. Auto-extract missing cv_text from file_url before analysis
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const LLAMA_API_URL = Deno.env.get('LLAMA_API_URL');
const PRIMARY_MODEL =
  Deno.env.get('LLAMA_MODEL') || 'meta-llama/llama-3.1-8b-instruct';

const ALL_MODELS = [
  PRIMARY_MODEL,
  'meta-llama/llama-3.1-8b-instruct',
  'mistralai/mistral-7b-instruct',
  'google/gemma-2-9b-it',
].filter((model, index, arr) => model && arr.indexOf(model) === index);

const MODEL_TIMEOUT_MS = 20_000;
const MAX_RETRIES = 2;
const RETRY_DELAYS_MS = [1_000, 2_000];

const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'https://jtracker-umber.vercel.app',
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') || '';

  return {
    'Access-Control-Allow-Origin': allowedOrigins.includes(origin)
      ? origin
      : 'https://jtracker-umber.vercel.app',
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function sseHeaders(req: Request) {
  return {
    ...getCorsHeaders(req),
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  };
}

function sendSse(
  controller: ReadableStreamDefaultController<Uint8Array>,
  event: string,
  data: unknown,
) {
  controller.enqueue(
    new TextEncoder().encode(
      `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
    ),
  );
}

const ANALYSIS_SYSTEM_PROMPT = `You are JTracker CV Intelligence — an advanced ATS analyst and career decision engine.

Your job is to deeply evaluate a candidate's CV against a job description and return a structured JSON analysis.

--------------------------------------------------
ANALYSIS FRAMEWORK
--------------------------------------------------

Score five dimensions, each 0–100:

1. overall_job_fit_score — holistic fit across all factors
2. transferability_score — how well existing skills map even without direct title/domain match
3. ats_match_score — keyword coverage, structure, terminology alignment with ATS systems
4. seniority_match_score — does candidate match the seniority level expected
5. skill_gap_score — 100 = no gaps, 0 = candidate is missing almost everything critical

--------------------------------------------------
RUBRIC — USE THESE ANCHORS EVERY TIME
--------------------------------------------------

OVERALL JOB FIT:
  90–100  Exceptional fit. Meets every requirement, strong track record, likely to be shortlisted immediately.
  80–89   Strong fit. Meets core requirements, minor gaps that are easily bridged.
  70–79   Good fit. Meets most requirements. 1–2 non-critical gaps. Would likely pass CV screen.
  60–69   Moderate fit. Meets roughly half the requirements. Some critical gaps but transferable strengths compensate.
  50–59   Borderline. Missing several requirements. Would need a strong cover letter to progress.
  40–49   Weak fit. Missing most requirements. Unlikely to pass ATS screen without significant tailoring.
  0–39    Poor fit. Fundamental mismatch in experience, domain, or seniority level.

TRANSFERABILITY:
  90–100  Skills map directly even if job titles differ.
  70–89   Clear adjacent experience.
  50–69   Some transferability but candidate must make the case explicitly.
  0–49    Minimal overlap.

ATS MATCH:
  90–100  High keyword overlap, industry-standard terminology, well-structured for ATS parsing.
  70–89   Good keyword coverage, minor terminology gaps.
  50–69   Moderate overlap.
  0–49    Poor keyword coverage.

SENIORITY MATCH:
  90–100  Perfect level match.
  70–89   Close match.
  50–69   Noticeable mismatch.
  0–49    Significant mismatch.

SKILL GAP:
  90–100  No critical gaps.
  70–89   One critical gap or 2–3 minor gaps.
  50–69   Two critical gaps or several important gaps.
  0–49    Three or more critical gaps.

--------------------------------------------------
SYNONYM AND ALIAS MATCHING
--------------------------------------------------

Treat equivalent technologies and wording as matches. Do not mark a skill as missing only because the wording differs.

Frontend:
- React = ReactJS = React.js
- JavaScript = JS = ECMAScript
- TypeScript = TS
- HTML5 = HTML
- CSS3 = CSS
- Tailwind = Tailwind CSS

Backend:
- Node = Node.js = NodeJS
- Express = Express.js
- REST = REST API = RESTful API
- API development = backend API development
- Authentication = auth = user login/session management

Databases:
- Postgres = PostgreSQL
- SQL = relational databases
- Supabase = Postgres + Auth + Storage + Edge Functions, where relevant
- MySQL = relational database experience, when SQL fundamentals are relevant

DevOps:
- CI/CD = continuous integration = continuous deployment
- Docker = containerisation
- Kubernetes = K8s

Support / operations:
- Troubleshooting = debugging
- Incident management = issue resolution = production support
- Escalation handling = stakeholder communication
- System monitoring = observability = platform reliability
- Customer technical support = support engineering, when the role involves technical investigation

Scoring rule:
If the CV contains an alias or strongly equivalent experience, count it as a partial or full match depending on depth of evidence.

--------------------------------------------------
SKILL GAP CLASSIFICATION
--------------------------------------------------

critical_missing_skills  — required to be shortlisted
learnable_missing_skills — can reasonably be picked up in 1–4 weeks
nice_to_have_missing_skills — helpful but optional

--------------------------------------------------
FINAL DECISION
--------------------------------------------------

recommended_to_apply:
  "YES"
  "YES — Tailor CV First"
  "MAYBE"
  "NO"

qualification_verdict:
  "Qualified"
  "Borderline Qualified"
  "Not Qualified"

--------------------------------------------------
RULES
--------------------------------------------------

- Return ONLY valid JSON.
- No markdown.
- No explanation outside the JSON.
- Do not default to 75 across the board.
- Scores must reflect real differences between dimensions.
- Be specific in strengths, gaps, and recommendations.`;

const CV_SYSTEM_PROMPT = `You are JTracker CV Intelligence — a professional CV writer and ATS optimisation specialist.

Your task is to rewrite and optimise the candidate's CV for a specific job description.

Rules:
- Keep all experience truthful
- Do NOT invent jobs or skills
- Reframe existing experience more powerfully where relevant
- Emphasise transferable strengths
- Surface missing but relevant keywords naturally where appropriate
- Improve ATS compatibility and recruiter appeal
- Strengthen bullet points with measurable impact where possible
- Prioritise experience most relevant to the target role
- Write in plain text
- No markdown
- Return ONLY the CV text`;

// ============================================================
// MAIN HANDLER
// ============================================================

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

          const authHeader = req.headers.get('Authorization');

          if (!authHeader) {
            sendSse(controller, 'error', {
              message: 'Missing Authorization header',
            });
            controller.close();
            return;
          }

          if (!LLAMA_API_URL) {
            sendSse(controller, 'error', {
              message: 'LLAMA_API_URL is not configured',
            });
            controller.close();
            return;
          }

          const supabaseUrl = Deno.env.get('SUPABASE_URL');
          const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
          const llamaApiKey = Deno.env.get('LLAMA_API_KEY') || '';

          if (!supabaseUrl || !supabaseServiceKey) {
            sendSse(controller, 'error', {
              message: 'Supabase environment variables are not configured',
            });
            controller.close();
            return;
          }

          if (!llamaApiKey) {
            sendSse(controller, 'error', {
              message: 'LLAMA_API_KEY is not configured',
            });
            controller.close();
            return;
          }

          const supabase = createClient(supabaseUrl, supabaseServiceKey);
          const userToken = authHeader.replace('Bearer ', '');

          sendSse(controller, 'progress', {
            step: 'auth',
            message: 'Checking your session...',
            percent: 10,
          });

          const {
            data: { user },
            error: authError,
          } = await supabase.auth.getUser(userToken);

          if (authError || !user) {
            sendSse(controller, 'error', {
              message: 'Unauthorized',
            });
            controller.close();
            return;
          }

          const body = await req.json();
          const cv_version_id = body.cv_version_id;
          const job_description = body.job_description;

          if (!cv_version_id || !job_description?.trim()) {
            sendSse(controller, 'error', {
              message: 'cv_version_id and job_description are required',
            });
            controller.close();
            return;
          }

          if (job_description.length > 20_000) {
            sendSse(controller, 'error', {
              message: 'Job description is too long. Please shorten it and try again.',
            });
            controller.close();
            return;
          }

          sendSse(controller, 'progress', {
            step: 'loading_cv',
            message: 'Loading your saved CV...',
            percent: 18,
          });

          const { data: cvVersion, error: cvError } = await supabase
            .from('cv_versions')
            .select('id, name, target_role, cv_text, file_url')
            .eq('id', cv_version_id)
            .eq('user_id', user.id)
            .single();

          if (cvError || !cvVersion) {
            sendSse(controller, 'error', {
              message: 'CV version not found',
            });
            controller.close();
            return;
          }

          let cvText = cvVersion.cv_text?.trim() || '';

          if (!cvText && cvVersion.file_url) {
            sendSse(controller, 'progress', {
              step: 'extracting_cv',
              message: 'Extracting readable text from your CV...',
              percent: 22,
            });

            cvText = await extractTextFromFile(cvVersion.file_url);

            if (cvText.trim()) {
              await supabase
                .from('cv_versions')
                .update({
                  cv_text: cvText,
                })
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

          sendSse(controller, 'progress', {
            step: 'learning_context',
            message: 'Checking previous scoring patterns...',
            percent: 28,
          });

          const learningContext = await buildLearningContext(user.id, supabase);

          sendSse(controller, 'progress', {
            step: 'analysis',
            message: 'Analysing transferable skills, ATS match, and job fit...',
            percent: 45,
          });

          const analysisResult = await callAnalysis(
            cvText,
            job_description,
            learningContext,
            llamaApiKey,
          );

          sendSse(controller, 'progress', {
            step: 'cv_generation',
            message: 'Generating optimised CV...',
            percent: 70,
          });

          let generatedCv = '';

          if (!analysisResult.is_truncated) {
            try {
              generatedCv = await callCvGeneration(
                cvText,
                job_description,
                llamaApiKey,
              );
            } catch (cvErr) {
              console.error('CV generation failed:', cvErr);
              generatedCv = '';
            }
          }

          analysisResult.generated_cv = generatedCv;

          const primaryScore =
            analysisResult.overall_job_fit_score ?? analysisResult.score ?? 0;

          sendSse(controller, 'progress', {
            step: 'saving',
            message: 'Saving analysis results...',
            percent: 88,
          });

          const { data: savedAnalysis, error: saveError } = await supabase
            .from('cv_analyses')
            .insert({
              user_id: user.id,
              cv_version_id,
              job_description,
              job_title: analysisResult.job_title ?? null,
              company_name: analysisResult.company_name ?? null,
              score: primaryScore,
              score_breakdown: analysisResult.score_breakdown ?? {},
              matched_keywords: analysisResult.matched_keywords ?? [],
              missing_keywords: analysisResult.missing_keywords ?? [],
              partial_keywords: analysisResult.partial_keywords ?? [],
              strengths: analysisResult.strengths ?? [],
              gaps: analysisResult.gaps ?? [],
              suggestions: [
                ...(analysisResult.ai_recommendations ?? []),
                ...(analysisResult.cv_improvement_actions ?? []),
              ],
              generated_cv: generatedCv,
              role_category: analysisResult.role_category ?? null,
              extended_data: {
                recommended_to_apply: analysisResult.recommended_to_apply,
                qualification_verdict: analysisResult.qualification_verdict,
                transferability_score: analysisResult.transferability_score,
                ats_match_score: analysisResult.ats_match_score,
                seniority_match_score: analysisResult.seniority_match_score,
                skill_gap_score: analysisResult.skill_gap_score,
                strongest_transferable_skills:
                  analysisResult.strongest_transferable_skills ?? [],
                critical_missing_skills:
                  analysisResult.critical_missing_skills ?? [],
                learnable_missing_skills:
                  analysisResult.learnable_missing_skills ?? [],
                nice_to_have_missing_skills:
                  analysisResult.nice_to_have_missing_skills ?? [],
                ai_recommendations: analysisResult.ai_recommendations ?? [],
                cv_improvement_actions:
                  analysisResult.cv_improvement_actions ?? [],
                is_truncated: analysisResult.is_truncated ?? false,
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

          if (primaryScore >= 65 && savedAnalysis && !analysisResult.is_truncated) {
            patternsUpdated = await distilPattern(
              user.id,
              savedAnalysis.id,
              analysisResult,
              primaryScore,
              supabase,
            );
          }

          const fullAnalysis = {
            ...(savedAnalysis ?? {}),
            recommended_to_apply: analysisResult.recommended_to_apply,
            qualification_verdict: analysisResult.qualification_verdict,
            overall_job_fit_score: primaryScore,
            transferability_score: analysisResult.transferability_score,
            ats_match_score: analysisResult.ats_match_score,
            seniority_match_score: analysisResult.seniority_match_score,
            skill_gap_score: analysisResult.skill_gap_score,
            strongest_transferable_skills:
              analysisResult.strongest_transferable_skills ?? [],
            critical_missing_skills: analysisResult.critical_missing_skills ?? [],
            learnable_missing_skills: analysisResult.learnable_missing_skills ?? [],
            nice_to_have_missing_skills:
              analysisResult.nice_to_have_missing_skills ?? [],
            ai_recommendations: analysisResult.ai_recommendations ?? [],
            cv_improvement_actions:
              analysisResult.cv_improvement_actions ?? [],
            matched_keywords: analysisResult.matched_keywords ?? [],
            missing_keywords: analysisResult.missing_keywords ?? [],
            partial_keywords: analysisResult.partial_keywords ?? [],
            strengths: analysisResult.strengths ?? [],
            gaps: analysisResult.gaps ?? [],
            generated_cv: generatedCv,
            score_breakdown: analysisResult.score_breakdown ?? {},
            job_title: analysisResult.job_title ?? null,
            company_name: analysisResult.company_name ?? null,
            score: primaryScore,
            is_truncated: analysisResult.is_truncated ?? false,
            id: savedAnalysis?.id ?? 'unsaved',
            user_id: user.id,
            cv_version_id,
            created_at: savedAnalysis?.created_at ?? new Date().toISOString(),
            save_warning: saveError
              ? 'Analysis completed but could not be saved.'
              : null,
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
        } catch (err: unknown) {
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

// ============================================================
// CALL 1 — Analysis JSON only
// ============================================================

async function callAnalysis(
  cvText: string,
  jobDescription: string,
  learningContext: { hasPastData: boolean; contextBlock: string },
  apiKey: string,
): Promise<any> {
  const userPrompt = buildAnalysisPrompt(
    cvText,
    jobDescription,
    learningContext.contextBlock,
  );

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'HTTP-Referer': 'https://jtracker-umber.vercel.app',
    'X-Title': 'JTracker',
  };

  let lastError = '';

  for (const model of ALL_MODELS) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = RETRY_DELAYS_MS[attempt - 1] ?? 2_000;
        await sleep(delay);
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, MODEL_TIMEOUT_MS);

      try {
        const response = await fetch(LLAMA_API_URL!, {
          method: 'POST',
          headers,
          signal: controller.signal,
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: ANALYSIS_SYSTEM_PROMPT },
              { role: 'user', content: userPrompt },
            ],
            temperature: 0.15,
            max_tokens: 6000,
          }),
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errText = await response.text();
          lastError = `${model} attempt ${attempt + 1}: HTTP ${response.status} — ${errText}`;

          if (response.status === 401 || response.status === 403) {
            break;
          }

          continue;
        }

        const data = await response.json();
        const raw: string = data.choices?.[0]?.message?.content || '';
        const finishReason: string = data.choices?.[0]?.finish_reason || '';

        if (!raw) {
          lastError = `${model} attempt ${attempt + 1}: Empty response`;
          continue;
        }

        const parsed = extractJson(raw);

        if (parsed) {
          parsed.is_truncated =
            finishReason === 'length' || parsed._truncated === true;
          return parsed;
        }

        lastError = `${model} attempt ${attempt + 1}: Could not extract valid JSON`;
      } catch (err: unknown) {
        clearTimeout(timeoutId);

        const isAbort = err instanceof Error && err.name === 'AbortError';

        lastError = isAbort
          ? `${model} attempt ${attempt + 1}: Timed out after ${MODEL_TIMEOUT_MS}ms`
          : `${model} attempt ${attempt + 1}: ${
              err instanceof Error ? err.message : String(err)
            }`;

        if (isAbort) break;
      }
    }
  }

  throw new Error(`All models failed for analysis. Last error: ${lastError}`);
}

// ============================================================
// CALL 2 — CV Generation
// ============================================================

async function callCvGeneration(
  cvText: string,
  jobDescription: string,
  apiKey: string,
): Promise<string> {
  const userPrompt = `Rewrite and optimise the following CV for the job description provided.

CV:
${cvText.slice(0, 4500)}

JOB DESCRIPTION:
${jobDescription.slice(0, 2000)}

Return only the optimised CV in plain text. No markdown. No explanation. Start directly with the candidate's name.`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'HTTP-Referer': 'https://jtracker-umber.vercel.app',
    'X-Title': 'JTracker',
  };

  for (const model of ALL_MODELS) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = RETRY_DELAYS_MS[attempt - 1] ?? 2_000;
        await sleep(delay);
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, MODEL_TIMEOUT_MS);

      try {
        const response = await fetch(LLAMA_API_URL!, {
          method: 'POST',
          headers,
          signal: controller.signal,
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: CV_SYSTEM_PROMPT },
              { role: 'user', content: userPrompt },
            ],
            temperature: 0.3,
            max_tokens: 3000,
          }),
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          if (response.status === 401 || response.status === 403) break;
          continue;
        }

        const data = await response.json();
        const raw: string = data.choices?.[0]?.message?.content || '';

        if (raw.trim().length > 200) {
          return raw.trim();
        }
      } catch (err: unknown) {
        clearTimeout(timeoutId);

        const isAbort = err instanceof Error && err.name === 'AbortError';
        if (isAbort) break;
      }
    }
  }

  return '';
}

// ============================================================
// ANALYSIS PROMPT
// ============================================================

function buildAnalysisPrompt(
  cvText: string,
  jobDescription: string,
  contextBlock: string,
): string {
  return `${contextBlock}

Analyse this CV against the job description. Return ONLY the JSON object below. No explanation. No markdown. No text outside the JSON.

CV:
${cvText.slice(0, 4500)}

JOB DESCRIPTION:
${jobDescription.slice(0, 2000)}

Return this exact JSON structure with all fields populated:
{
  "job_title": "",
  "company_name": "",
  "recommended_to_apply": "",
  "qualification_verdict": "",
  "overall_job_fit_score": 0,
  "transferability_score": 0,
  "ats_match_score": 0,
  "seniority_match_score": 0,
  "skill_gap_score": 0,
  "score_breakdown": {
    "skills": 0,
    "experience": 0,
    "keywords": 0,
    "achievements": 0,
    "ats": 0
  },
  "strongest_transferable_skills": [
    { "skill": "", "reason": "" }
  ],
  "critical_missing_skills": [],
  "learnable_missing_skills": [],
  "nice_to_have_missing_skills": [],
  "matched_keywords": [],
  "missing_keywords": [],
  "partial_keywords": [],
  "strengths": [
    { "title": "", "detail": "" }
  ],
  "gaps": [
    { "title": "", "detail": "" }
  ],
  "ai_recommendations": [],
  "cv_improvement_actions": [],
  "role_category": ""
}`;
}

// ============================================================
// JSON EXTRACTOR
// ============================================================

function extractJson(raw: string): any | null {
  const attempts = [
    () => JSON.parse(raw.trim()),

    () =>
      JSON.parse(
        raw
          .replace(/```json\n?/gi, '')
          .replace(/```\n?/g, '')
          .trim(),
      ),

    () => {
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      if (start === -1 || end <= start) throw new Error('No braces');
      return JSON.parse(raw.slice(start, end + 1));
    },

    () => {
      const start = raw.indexOf('{');
      if (start === -1) throw new Error('No start brace');

      const partial = raw.slice(start);

      const fitScore = partial.match(
        /"overall_job_fit_score"\s*:\s*(\d+)/,
      );
      const scoreMatch = partial.match(/"score"\s*:\s*(\d+)/);
      const titleMatch = partial.match(/"job_title"\s*:\s*"([^"]+)"/);
      const recommendMatch = partial.match(
        /"recommended_to_apply"\s*:\s*"([^"]+)"/,
      );
      const verdictMatch = partial.match(
        /"qualification_verdict"\s*:\s*"([^"]+)"/,
      );

      const score = fitScore
        ? parseInt(fitScore[1])
        : scoreMatch
          ? parseInt(scoreMatch[1])
          : 0;

      if (!score) throw new Error('No score found');

      return {
        job_title: titleMatch?.[1] ?? null,
        company_name: null,
        recommended_to_apply: recommendMatch?.[1] ?? 'MAYBE',
        qualification_verdict:
          verdictMatch?.[1] ?? 'Borderline Qualified',
        overall_job_fit_score: score,
        transferability_score: 0,
        ats_match_score: 0,
        seniority_match_score: 0,
        skill_gap_score: 0,
        score_breakdown: {
          skills: 0,
          experience: 0,
          keywords: 0,
          achievements: 0,
          ats: 0,
        },
        strongest_transferable_skills: [],
        critical_missing_skills: [],
        learnable_missing_skills: [],
        nice_to_have_missing_skills: [],
        matched_keywords: [],
        missing_keywords: [],
        partial_keywords: [],
        strengths: [],
        gaps: [],
        ai_recommendations: [
          'Analysis was partially returned due to model output limits.',
          'Retry for full skill breakdown and CV generation.',
        ],
        cv_improvement_actions: [],
        role_category: 'General',
        _truncated: true,
      };
    },
  ];

  for (const attempt of attempts) {
    try {
      return attempt();
    } catch {
      continue;
    }
  }

  return null;
}

// ============================================================
// LEARNING CONTEXT
// ============================================================

async function buildLearningContext(userId: string, supabase: any) {
  const { data: pastAnalyses } = await supabase
    .from('cv_analyses')
    .select('score, job_title, matched_keywords, score_breakdown')
    .eq('user_id', userId)
    .gte('score', 65)
    .order('score', { ascending: false })
    .limit(8);

  const { data: patterns } = await supabase
    .from('cv_scoring_patterns')
    .select(
      'role_category, score_band, pattern_summary, keyword_signals, sample_count',
    )
    .eq('user_id', userId)
    .order('sample_count', { ascending: false })
    .limit(5);

  const hasPastData = Boolean(pastAnalyses?.length || patterns?.length);

  if (!hasPastData) {
    return {
      hasPastData: false,
      contextBlock: '',
    };
  }

  let contextBlock = '\n\n--- LEARNING CONTEXT FROM PAST ANALYSES ---\n';

  if (patterns?.length > 0) {
    contextBlock += '\nEstablished scoring patterns for this user:\n';

    patterns.forEach((p: any) => {
      contextBlock += `• [${p.role_category} | ${p.score_band} | ${p.sample_count} sample(s)]: ${p.pattern_summary}\n`;

      if (p.keyword_signals?.length > 0) {
        contextBlock += `  High-signal keywords: ${p.keyword_signals.join(', ')}\n`;
      }
    });
  }

  if (pastAnalyses?.length > 0) {
    contextBlock += '\nRecent high-scoring analyses:\n';

    pastAnalyses.slice(0, 4).forEach((a: any) => {
      contextBlock += `• ${a.job_title || 'Unknown role'} — Score: ${a.score}/100\n`;

      if (a.matched_keywords?.length > 0) {
        contextBlock += `  Matched: ${a.matched_keywords
          .slice(0, 6)
          .join(', ')}\n`;
      }
    });

    contextBlock +=
      "\nApply consistent scoring based on this user's CV profile.\n";
  }

  contextBlock += '--- END LEARNING CONTEXT ---\n';

  return {
    hasPastData,
    contextBlock,
  };
}

// ============================================================
// PATTERN DISTILLATION
// ============================================================

async function distilPattern(
  userId: string,
  analysisId: string,
  analysis: any,
  primaryScore: number,
  supabase: any,
): Promise<boolean> {
  try {
    const roleCategory =
      analysis.role_category || analysis.job_title || 'General';
    const scoreBand = getScoreBand(primaryScore);

    const { data: existing } = await supabase
      .from('cv_scoring_patterns')
      .select('id, sample_count, keyword_signals')
      .eq('user_id', userId)
      .eq('role_category', roleCategory)
      .eq('score_band', scoreBand)
      .maybeSingle();

    if (existing) {
      const merged = Array.from(
        new Set([
          ...(existing.keyword_signals || []),
          ...(analysis.matched_keywords || []).slice(0, 10),
        ]),
      ).slice(0, 20);

      await supabase
        .from('cv_scoring_patterns')
        .update({
          sample_count: existing.sample_count + 1,
          keyword_signals: merged,
          source_analysis_id: analysisId,
        })
        .eq('id', existing.id);
    } else {
      const topDim = Object.entries(analysis.score_breakdown || {}).sort(
        ([, a]: any, [, b]: any) => b - a,
      )[0];

      const summary = [
        `Fit score ${primaryScore}/100.`,
        analysis.qualification_verdict
          ? `Verdict: ${analysis.qualification_verdict}.`
          : '',
        topDim ? `Strongest: ${topDim[0]} (${topDim[1]}/100).` : '',
        analysis.matched_keywords?.length
          ? `Top keywords: ${analysis.matched_keywords
              .slice(0, 5)
              .join(', ')}.`
          : '',
      ]
        .filter(Boolean)
        .join(' ');

      await supabase.from('cv_scoring_patterns').insert({
        user_id: userId,
        role_category: roleCategory,
        score_band: scoreBand,
        pattern_summary: summary,
        keyword_signals: (analysis.matched_keywords || []).slice(0, 15),
        sample_count: 1,
        source_analysis_id: analysisId,
      });
    }

    return true;
  } catch (err) {
    console.error('Pattern distillation error:', err);
    return false;
  }
}

function getScoreBand(score: number): string {
  if (score >= 90) return '90-100';
  if (score >= 80) return '80-89';
  if (score >= 70) return '70-79';
  if (score >= 60) return '60-69';
  if (score >= 50) return '50-59';
  return '0-49';
}

// ============================================================
// UTILITIES
// ============================================================

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ============================================================
// CV TEXT EXTRACTION
// ============================================================

async function extractTextFromFile(fileUrl: string): Promise<string> {
  try {
    const response = await fetch(fileUrl);

    if (!response.ok) {
      throw new Error(`Failed to download CV file: ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || '';
    const lowerUrl = fileUrl.toLowerCase();

    if (contentType.includes('pdf') || lowerUrl.includes('.pdf')) {
      const buffer = await response.arrayBuffer();
      const raw = new TextDecoder('latin1').decode(buffer);

      const extracted = raw
        .replace(/\\r/g, '\n')
        .replace(/\\n/g, '\n')
        .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      return extracted.length > 80 ? extracted.slice(0, 12000) : '';
    }

    if (
      contentType.includes(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ) ||
      lowerUrl.includes('.docx')
    ) {
      const buffer = await response.arrayBuffer();
      const raw = new TextDecoder('latin1').decode(buffer);

      const extracted = raw
        .replace(/<[^>]+>/g, ' ')
        .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      return extracted.length > 80 ? extracted.slice(0, 12000) : '';
    }

    const text = await response.text();
    return text.trim().slice(0, 12000);
  } catch (err) {
    console.error('extractTextFromFile error:', err);
    return '';
  }
}

function errorResponse(req: Request, message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    headers: {
      ...getCorsHeaders(req),
      'Content-Type': 'application/json',
    },
    status,
  });
}