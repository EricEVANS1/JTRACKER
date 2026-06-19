import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type Recommendation = 'recommended' | 'possible' | 'stretch' | 'not_recommended';

interface ScoreRequest {
  job_ad_id?: string;
  cv_version_id?: string | null;
}

interface JobAd {
  id: string;
  user_id: string;
  title: string | null;
  company: string | null;
  location: string | null;
  work_model: string | null;
  salary_range: string | null;
  job_url: string | null;
  source: string | null;
  source_slug: string | null;
  description: string | null;
  parsed_required_skills?: string[] | null;
}

interface ScoreResult {
  match_score: number;
  fit_label: string;
  recommendation: Recommendation;
  matched_skills: string[];
  missing_skills: string[];
  concerns: string[];
  suggested_cv_angle: string;
  explanation: string;
  score_breakdown: {
    skills: number;
    experience: number;
    role_fit: number;
    keywords: number;
  };
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const jsonResponse = (body: unknown, status = 200) => {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
};

const clamp = (value: number, min = 0, max = 100) => {
  return Math.max(min, Math.min(max, Math.round(value)));
};

const normalise = (value: unknown) => {
  return String(value || '').toLowerCase().trim();
};

const stripHtml = (value: string | null | undefined) => {
  if (!value) return '';

  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s{2,}/g, ' ')
    .trim();
};

const safeArray = (value: unknown): string[] => {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || '').trim())
      .filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(/[,;\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
};

const getRecommendation = (score: number): Recommendation => {
  if (score >= 85) return 'recommended';
  if (score >= 70) return 'possible';
  if (score >= 55) return 'stretch';
  return 'not_recommended';
};

const getFitLabel = (score: number) => {
  if (score >= 85) return 'Strong fit';
  if (score >= 70) return 'Good fit';
  if (score >= 55) return 'Stretch fit';
  return 'Low fit';
};

const extractTextFromCv = (cv: Record<string, unknown>) => {
  const priorityFields = [
    'generated_cv',
    'cv_text',
    'content',
    'resume_text',
    'raw_text',
    'summary',
    'professional_summary',
    'target_role',
    'skills',
    'experience',
    'education',
    'projects',
    'certifications',
    'parsed_data',
    'sections',
  ];

  const chunks: string[] = [];

  for (const field of priorityFields) {
    const value = cv[field];

    if (!value) continue;

    if (typeof value === 'string') {
      chunks.push(value);
    } else {
      try {
        chunks.push(JSON.stringify(value));
      } catch {
        // Ignore values that cannot be stringified.
      }
    }
  }

  if (chunks.length === 0) {
    try {
      chunks.push(JSON.stringify(cv));
    } catch {
      return '';
    }
  }

  return stripHtml(chunks.join('\n\n')).slice(0, 12000);
};

const buildJobText = (job: JobAd) => {
  return stripHtml(
    [
      `Title: ${job.title || ''}`,
      `Company: ${job.company || ''}`,
      `Location: ${job.location || ''}`,
      `Work model: ${job.work_model || ''}`,
      `Salary: ${job.salary_range || ''}`,
      `Source: ${job.source || job.source_slug || ''}`,
      `Description: ${job.description || ''}`,
      `Parsed skills: ${(job.parsed_required_skills || []).join(', ')}`,
    ].join('\n'),
  ).slice(0, 12000);
};

const commonSkillKeywords = [
  'javascript',
  'typescript',
  'react',
  'node',
  'node.js',
  'python',
  'java',
  'c#',
  '.net',
  'sql',
  'mysql',
  'postgresql',
  'supabase',
  'firebase',
  'aws',
  'azure',
  'gcp',
  'docker',
  'kubernetes',
  'linux',
  'windows',
  'active directory',
  'office 365',
  'microsoft 365',
  'jira',
  'servicenow',
  'zendesk',
  'itil',
  'tcp/ip',
  'dns',
  'vpn',
  'api',
  'rest',
  'graphql',
  'postman',
  'html',
  'css',
  'tailwind',
  'bootstrap',
  'git',
  'github',
  'ci/cd',
  'testing',
  'qa',
  'manual testing',
  'automation testing',
  'selenium',
  'playwright',
  'cypress',
  'customer support',
  'technical support',
  'troubleshooting',
  'incident management',
  'monitoring',
  'splunk',
  'logs',
  'networking',
  'security',
  'cybersecurity',
  'machine learning',
  'data analysis',
  'excel',
  'power bi',
];

const fallbackScore = (jobText: string, cvText: string): ScoreResult => {
  const jobLower = normalise(jobText);
  const cvLower = normalise(cvText);

  const jobSkills = commonSkillKeywords.filter((skill) => jobLower.includes(skill));
  const matchedSkills = jobSkills.filter((skill) => cvLower.includes(skill));
  const missingSkills = jobSkills.filter((skill) => !cvLower.includes(skill));

  const matchRatio = jobSkills.length > 0 ? matchedSkills.length / jobSkills.length : 0.35;

  const roleBonusKeywords = [
    'support',
    'technical',
    'engineer',
    'software',
    'customer',
    'jira',
    'troubleshooting',
    'linux',
    'sql',
    'react',
    'typescript',
  ];

  const roleHits = roleBonusKeywords.filter(
    (keyword) => jobLower.includes(keyword) && cvLower.includes(keyword),
  ).length;

  const baseScore = 45 + matchRatio * 40 + Math.min(roleHits * 2, 15);
  const finalScore = clamp(baseScore);

  return {
    match_score: finalScore,
    fit_label: getFitLabel(finalScore),
    recommendation: getRecommendation(finalScore),
    matched_skills: matchedSkills.slice(0, 12),
    missing_skills: missingSkills.slice(0, 12),
    concerns:
      missingSkills.length > 0
        ? [`Missing or unclear evidence for: ${missingSkills.slice(0, 5).join(', ')}`]
        : [],
    suggested_cv_angle:
      matchedSkills.length > 0
        ? `Emphasise your experience with ${matchedSkills.slice(0, 5).join(', ')} and connect it directly to the job requirements.`
        : 'Emphasise transferable support, troubleshooting, communication, and technical problem-solving experience.',
    explanation:
      'Fallback scoring was used because AI scoring was unavailable. The score is based on keyword and skill overlap between the CV and job description.',
    score_breakdown: {
      skills: clamp(matchRatio * 100),
      experience: clamp(50 + roleHits * 5),
      role_fit: finalScore,
      keywords: clamp(matchRatio * 100),
    },
  };
};

const extractJsonObject = (text: string) => {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');

  if (start === -1 || end === -1 || end <= start) {
    throw new Error('AI response did not contain a JSON object.');
  }

  return JSON.parse(text.slice(start, end + 1));
};

const validateAiScore = (value: unknown): ScoreResult => {
  const raw = value as Partial<ScoreResult>;

  const score = clamp(Number(raw.match_score ?? 0));
  const recommendation = (
    ['recommended', 'possible', 'stretch', 'not_recommended'].includes(
      String(raw.recommendation),
    )
      ? raw.recommendation
      : getRecommendation(score)
  ) as Recommendation;

  return {
    match_score: score,
    fit_label: String(raw.fit_label || getFitLabel(score)),
    recommendation,
    matched_skills: safeArray(raw.matched_skills).slice(0, 12),
    missing_skills: safeArray(raw.missing_skills).slice(0, 12),
    concerns: safeArray(raw.concerns).slice(0, 8),
    suggested_cv_angle: String(raw.suggested_cv_angle || ''),
    explanation: String(raw.explanation || ''),
    score_breakdown: {
      skills: clamp(Number(raw.score_breakdown?.skills ?? score)),
      experience: clamp(Number(raw.score_breakdown?.experience ?? score)),
      role_fit: clamp(Number(raw.score_breakdown?.role_fit ?? score)),
      keywords: clamp(Number(raw.score_breakdown?.keywords ?? score)),
    },
  };
};

const scoreWithGroq = async (jobText: string, cvText: string): Promise<ScoreResult | null> => {
  const apiKey = Deno.env.get('GROQ_API_KEY');

  if (!apiKey) return null;

  const model = Deno.env.get('GROQ_MODEL') || 'llama-3.1-8b-instant';

  const prompt = `
You are an ATS and recruiter-style job matching assistant.

Compare the CV against the job description.

Return ONLY valid JSON with this exact structure:
{
  "match_score": 0,
  "fit_label": "Strong fit | Good fit | Stretch fit | Low fit",
  "recommendation": "recommended | possible | stretch | not_recommended",
  "matched_skills": [],
  "missing_skills": [],
  "concerns": [],
  "suggested_cv_angle": "",
  "explanation": "",
  "score_breakdown": {
    "skills": 0,
    "experience": 0,
    "role_fit": 0,
    "keywords": 0
  }
}

Scoring guide:
85-100 = recommended
70-84 = possible
55-69 = stretch
0-54 = not_recommended

Be strict but fair. Focus on evidence in the CV.

JOB DESCRIPTION:
${jobText}

CV:
${cvText}
`;

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            'You score job matches. You only return valid JSON. Do not include markdown.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    console.error('Groq scoring failed:', await response.text());
    return null;
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;

  if (!content) return null;

  return validateAiScore(extractJsonObject(content));
};

const scoreWithLlamaEndpoint = async (
  jobText: string,
  cvText: string,
): Promise<ScoreResult | null> => {
  const apiKey = Deno.env.get('LLAMA_API_KEY');
  const apiUrl = Deno.env.get('LLAMA_API_URL');
  const model = Deno.env.get('LLAMA_MODEL');

  if (!apiKey || !apiUrl) return null;

  const prompt = `
Compare this CV with this job description and return ONLY valid JSON.

JSON format:
{
  "match_score": 0,
  "fit_label": "Strong fit | Good fit | Stretch fit | Low fit",
  "recommendation": "recommended | possible | stretch | not_recommended",
  "matched_skills": [],
  "missing_skills": [],
  "concerns": [],
  "suggested_cv_angle": "",
  "explanation": "",
  "score_breakdown": {
    "skills": 0,
    "experience": 0,
    "role_fit": 0,
    "keywords": 0
  }
}

JOB:
${jobText}

CV:
${cvText}
`;

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    console.error('Llama scoring failed:', await response.text());
    return null;
  }

  const data = await response.json();
  const content =
    data?.choices?.[0]?.message?.content ||
    data?.completion ||
    data?.content ||
    data?.response;

  if (!content) return null;

  return validateAiScore(extractJsonObject(String(content)));
};

const scoreJob = async (jobText: string, cvText: string): Promise<ScoreResult> => {
  try {
    const groqResult = await scoreWithGroq(jobText, cvText);

    if (groqResult) {
      return groqResult;
    }
  } catch (error) {
    console.error('Groq score parse failed:', error);
  }

  try {
    const llamaResult = await scoreWithLlamaEndpoint(jobText, cvText);

    if (llamaResult) {
      return llamaResult;
    }
  } catch (error) {
    console.error('Llama score parse failed:', error);
  }

  return fallbackScore(jobText, cvText);
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders,
    });
  }

  if (request.method !== 'POST') {
    return jsonResponse(
      {
        success: false,
        error: 'Method not allowed.',
      },
      405,
    );
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse(
        {
          success: false,
          error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.',
        },
        500,
      );
    }

    const authHeader = request.headers.get('Authorization') || '';

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return jsonResponse(
        {
          success: false,
          error: 'Unauthorised.',
        },
        401,
      );
    }

    const body = (await request.json()) as ScoreRequest;
    const jobAdId = body.job_ad_id;
    const cvVersionId = body.cv_version_id;

    if (!jobAdId) {
      return jsonResponse(
        {
          success: false,
          error: 'job_ad_id is required.',
        },
        400,
      );
    }

    if (!cvVersionId) {
      return jsonResponse(
        {
          success: false,
          error: 'cv_version_id is required. Select a default CV first.',
        },
        400,
      );
    }

    const { data: job, error: jobError } = await supabase
      .from('job_ads')
      .select('*')
      .eq('id', jobAdId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (jobError) {
      return jsonResponse(
        {
          success: false,
          error: jobError.message,
        },
        500,
      );
    }

    if (!job) {
      return jsonResponse(
        {
          success: false,
          error: 'Job not found.',
        },
        404,
      );
    }

    const { data: cv, error: cvError } = await supabase
      .from('cv_versions')
      .select('*')
      .eq('id', cvVersionId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (cvError) {
      return jsonResponse(
        {
          success: false,
          error: cvError.message,
        },
        500,
      );
    }

    if (!cv) {
      return jsonResponse(
        {
          success: false,
          error: 'CV version not found.',
        },
        404,
      );
    }

    const typedJob = job as JobAd;
    const jobText = buildJobText(typedJob);
    const cvText = extractTextFromCv(cv as Record<string, unknown>);

    if (!jobText) {
      return jsonResponse(
        {
          success: false,
          error: 'Job description is empty or unreadable.',
        },
        400,
      );
    }

    if (!cvText) {
      return jsonResponse(
        {
          success: false,
          error: 'CV content is empty or unreadable.',
        },
        400,
      );
    }

    const score = await scoreJob(jobText, cvText);

    const { data: existingMatch } = await supabase
      .from('job_match_results')
      .select('id')
      .eq('user_id', user.id)
      .eq('job_ad_id', jobAdId)
      .eq('cv_version_id', cvVersionId)
      .maybeSingle();

    let savedMatch;

    const matchPayload = {
      user_id: user.id,
      job_ad_id: jobAdId,
      cv_version_id: cvVersionId,
      match_score: score.match_score,
      fit_label: score.fit_label,
      recommendation: score.recommendation,
      matched_skills: score.matched_skills,
      missing_skills: score.missing_skills,
      concerns: score.concerns,
      suggested_cv_angle: score.suggested_cv_angle,
      explanation: score.explanation,
      score_breakdown: score.score_breakdown,
      raw_result: score,
      ai_used: Boolean(Deno.env.get('GROQ_API_KEY') || Deno.env.get('LLAMA_API_KEY')),
    };

    if (existingMatch?.id) {
      const { data, error } = await supabase
        .from('job_match_results')
        .update(matchPayload)
        .eq('id', existingMatch.id)
        .eq('user_id', user.id)
        .select(
          'id, job_ad_id, cv_version_id, match_score, fit_label, recommendation, matched_skills, missing_skills, concerns, suggested_cv_angle, explanation, created_at',
        )
        .single();

      if (error) {
        return jsonResponse(
          {
            success: false,
            error: error.message,
          },
          500,
        );
      }

      savedMatch = data;
    } else {
      const { data, error } = await supabase
        .from('job_match_results')
        .insert(matchPayload)
        .select(
          'id, job_ad_id, cv_version_id, match_score, fit_label, recommendation, matched_skills, missing_skills, concerns, suggested_cv_angle, explanation, created_at',
        )
        .single();

      if (error) {
        return jsonResponse(
          {
            success: false,
            error: error.message,
          },
          500,
        );
      }

      savedMatch = data;
    }

    const { error: updateJobError } = await supabase
      .from('job_ads')
      .update({
        best_match_score: score.match_score,
        best_fit_label: score.fit_label,
        recommendation: score.recommendation,
        matched_at: new Date().toISOString(),
      })
      .eq('id', jobAdId)
      .eq('user_id', user.id);

    if (updateJobError) {
      return jsonResponse(
        {
          success: false,
          error: updateJobError.message,
        },
        500,
      );
    }

    return jsonResponse(savedMatch);
  } catch (error) {
    console.error('score-job fatal error:', error);

    return jsonResponse(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown score-job error.',
      },
      500,
    );
  }
});