// ============================================================
// _lib/suggestions.ts
// Pass 3: generate CV suggestions in editor mode
//
// AI receives locked facts and returns ONLY:
//   - rewritten summary
//   - improved bullets per role
//   - skills emphasis
//   - keyword suggestions
//
// AI never produces the final CV. The assembler does that.
// ============================================================

import { callLLM } from './llm.ts';
import { SUGGESTIONS_SYSTEM } from './prompts.ts';
import { hashString, makeRoleKey } from './helpers.ts';
import type {
  CVSuggestions,
  LLMConfig,
  StructuredCV,
  StructuredJD,
} from './types.ts';

export async function generateSuggestions(
  cv: StructuredCV,
  jd: StructuredJD,
  missingKeywords: string[],
  config: LLMConfig,
): Promise<CVSuggestions | null> {
  const l = cv.locked;

  const prompt = `You are editing an existing CV to better match a job description.

You MUST NOT change any employer names, job titles, or dates.
You are only improving wording and surfacing relevant keyword opportunities.

=== LOCKED FACTS (do not modify these) ===
${l.experience.map((e) =>
  `ROLE: ${e.title} at ${e.company} (${e.start_date} – ${e.end_date})
ROLE KEY: "${makeRoleKey(e.company, e.title)}"
ORIGINAL BULLETS:
${e.raw_bullets.map((b) => `  - ${b}`).join('\n') || '  (none listed)'}`
).join('\n\n') || 'No experience listed'}

LOCKED SKILLS:
  Technical: ${cv.locked_skills.technical.join(', ') || 'none'}
  Tools: ${cv.locked_skills.tools.join(', ') || 'none'}
  Soft: ${cv.locked_skills.soft.join(', ') || 'none'}
  Languages: ${cv.locked_skills.languages.join(', ') || 'none'}

=== TARGET JOB ===
Role: ${jd.job_title}
Category: ${jd.role_category} | Domain: ${jd.domain}
Required skills: ${jd.required_skills.slice(0, 10).join(', ') || 'none'}
Key responsibilities: ${jd.key_responsibilities.slice(0, 5).join(' | ') || 'none'}
Must-have keywords: ${jd.must_have_keywords.slice(0, 10).join(', ') || 'none'}

=== KEYWORDS IDENTIFIED AS MISSING ===
${missingKeywords.slice(0, 15).join(', ') || 'none identified'}

=== YOUR TASK ===

1. SUMMARY:
Write a strong 3–4 sentence professional summary tailored to the target role.
Use first-person voice. ATS-friendly. Based only on the candidate's real experience.

2. EXPERIENCE BULLETS:
For EACH role, provide improved bullet points.
- Use the exact role key shown above for experience_bullets.
- Same number of bullets or fewer.
- Do not add new responsibilities.
- Do not invent metrics.
- Reframe responsibilities to match JD language where truthful.

3. SKILLS EMPHASIS:
List the candidate's existing skills in order of relevance to this role.
Do not add skills they do not have.

4. KEYWORD SUGGESTIONS:
For each missing keyword, provide:
- priority: "critical" | "important" | "nice-to-have"
- reason: specific explanation of why this keyword matters
- jd_context: exact phrase from the JD where possible
- transferable_from: if candidate experience covers it under another name, otherwise null
- confidence: "confirmed_missing" | "possibly_covered" | "nice_to_add"
- section: "skills" | "summary" | "experience"
- accepted: false
- rejected: false

Return ONLY this JSON. No markdown. No explanation:
{
  "summary": "rewritten professional summary here",
  "experience_bullets": {
    ${l.experience.map((e) =>
      `"${makeRoleKey(e.company, e.title)}": ["improved bullet 1", "improved bullet 2"]`
    ).join(',\n    ') || '"example__role": []'}
  },
  "skills_emphasis": [],
  "keyword_suggestions": [
    {
      "keyword": "",
      "priority": "critical",
      "reason": "",
      "jd_context": "",
      "transferable_from": null,
      "confidence": "confirmed_missing",
      "section": "skills",
      "accepted": false,
      "rejected": false
    }
  ]
}`;

  const result = await callLLM(
    prompt,
    SUGGESTIONS_SYSTEM,
    config,
    3500,
  ) as Partial<CVSuggestions>;

  if (!result || Object.keys(result).length === 0) {
    return null;
  }

  return {
    summary: typeof result.summary === 'string' ? result.summary : '',

    experience_bullets: isRecordOfStringArrays(result.experience_bullets)
      ? result.experience_bullets
      : {},

    skills_emphasis: Array.isArray(result.skills_emphasis)
      ? result.skills_emphasis.filter((item): item is string => typeof item === 'string')
      : [],

    keyword_suggestions: Array.isArray(result.keyword_suggestions)
      ? result.keyword_suggestions.map(normalizeKeywordSuggestion)
      : [],

    generated_for_job_title: jd.job_title,
    generated_for_jd_hash: hashString(
      `${jd.job_title}|${jd.company_name ?? ''}|${jd.required_skills.join('|')}`,
    ),
    generated_at: new Date().toISOString(),
  };
}

function normalizeKeywordSuggestion(item: unknown): CVSuggestions['keyword_suggestions'][number] {
  const k = isRecord(item) ? item : {};

  return {
    keyword: typeof k.keyword === 'string' ? k.keyword : '',
    priority: isPriority(k.priority) ? k.priority : 'nice-to-have',
    reason: typeof k.reason === 'string' ? k.reason : '',
    jd_context: typeof k.jd_context === 'string' ? k.jd_context : '',
    transferable_from:
      typeof k.transferable_from === 'string'
        ? k.transferable_from
        : null,
    confidence: isConfidence(k.confidence)
      ? k.confidence
      : 'confirmed_missing',
    section: isSuggestionSection(k.section)
      ? k.section
      : 'skills',
    accepted: false,
    rejected: false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isRecordOfStringArrays(
  value: unknown,
): value is Record<string, string[]> {
  if (!isRecord(value)) return false;

  return Object.values(value).every(
    (entry) =>
      Array.isArray(entry) &&
      entry.every((item) => typeof item === 'string'),
  );
}

function isPriority(
  value: unknown,
): value is 'critical' | 'important' | 'nice-to-have' {
  return value === 'critical' ||
    value === 'important' ||
    value === 'nice-to-have';
}

function isConfidence(
  value: unknown,
): value is 'confirmed_missing' | 'possibly_covered' | 'nice_to_add' {
  return value === 'confirmed_missing' ||
    value === 'possibly_covered' ||
    value === 'nice_to_add';
}

function isSuggestionSection(
  value: unknown,
): value is 'skills' | 'summary' | 'experience' {
  return value === 'skills' ||
    value === 'summary' ||
    value === 'experience';
}