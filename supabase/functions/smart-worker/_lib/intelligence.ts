// ============================================================
// _lib/intelligence.ts
// Deterministic CV intelligence layer
//
// Purpose:
// - Match JD requirements against locked CV facts with evidence.
// - Reduce hallucinated matches/misses from the LLM.
// - Produce stable scores that can be blended with AI analysis.
// ============================================================

import type { StructuredCV, StructuredJD } from './types.ts';
import { deduplicateStringsCaseInsensitive } from './helpers.ts';

export type KeywordMatchStatus = 'matched' | 'partial' | 'missing';
export type RequirementPriority = 'must_have' | 'required' | 'nice_to_have';

export interface KeywordEvidence {
  keyword: string;
  normalized_keyword: string;
  priority: RequirementPriority;
  status: KeywordMatchStatus;
  confidence: number;
  matched_as: string | null;
  evidence: Array<{
    source: string;
    text: string;
  }>;
}

export interface DeterministicIntelligence {
  matched_keywords: string[];
  partial_keywords: string[];
  missing_keywords: string[];
  keyword_evidence: KeywordEvidence[];
  deterministic_scores: {
    keyword_score: number;
    must_have_score: number;
    required_skill_score: number;
    nice_to_have_score: number;
    ats_structure_score: number;
    evidence_strength_score: number;
    quantified_achievement_score: number;
  };
  risk_flags: string[];
  suggested_focus_areas: string[];
  context_block: string;
}

const SYNONYMS: Record<string, string[]> = {
  'microsoft sql server': ['sql server', 'mssql', 't-sql', 'sql'],
  'sql server': ['microsoft sql server', 'mssql', 't-sql', 'sql'],
  'sql': ['database', 'databases', 'querying', 'queries', 'postgresql', 'mysql', 'sqlite', 'mssql', 'sql server'],
  'postgresql': ['postgres', 'sql', 'database'],
  'mysql': ['sql', 'database'],
  'windows server': ['windows environments', 'active directory', 'server administration'],
  'vmware': ['virtualization', 'virtualisation', 'virtual machines', 'vms', 'hyper-v'],
  'hyper-v': ['virtualization', 'virtualisation', 'virtual machines', 'vms', 'vmware'],
  'azure': ['cloud', 'microsoft azure', 'entra id', 'azure ad'],
  'aws': ['cloud', 'amazon web services'],
  'gcp': ['cloud', 'google cloud'],
  'itil': ['incident management', 'problem management', 'change management', 'service management'],
  'incident management': ['incident resolution', 'escalations', 'sla', 'itil'],
  'application support': ['technical support', 'production support', 'support engineer', 'troubleshooting'],
  'technical support': ['application support', 'troubleshooting', 'customer support', 'support specialist'],
  'troubleshooting': ['debugging', 'issue resolution', 'problem solving', 'root cause'],
  'monitoring': ['logs', 'system logs', 'observability', 'alerts'],
  'jira': ['atlassian', 'ticketing', 'tickets'],
  'agile': ['scrum', 'kanban'],
  'rest': ['api', 'apis', 'rest api', 'restful'],
  'react.js': ['react', 'frontend'],
  'node.js': ['node', 'backend', 'javascript runtime'],
  'typescript': ['javascript', 'ts'],
  'javascript': ['typescript', 'js'],
  'supabase': ['postgresql', 'auth', 'database'],
  'docker': ['containers', 'containerization', 'containerisation'],
};

const WEAK_TERMS = new Set([
  'good', 'strong', 'basic', 'excellent', 'communication', 'team', 'teamwork',
  'problem solving', 'analytical', 'willingness to learn', 'english', 'degree',
]);

export function computeDeterministicIntelligence(
  cv: StructuredCV,
  jd: StructuredJD,
): DeterministicIntelligence {
  const requirements = buildRequirements(jd);
  const cvEvidence = buildCvEvidence(cv);
  const keywordEvidence = requirements.map((req) =>
    evaluateRequirement(req.keyword, req.priority, cvEvidence),
  );

  const matched = keywordEvidence
    .filter((item) => item.status === 'matched')
    .map((item) => item.keyword);

  const partial = keywordEvidence
    .filter((item) => item.status === 'partial')
    .map((item) => item.keyword);

  const missing = keywordEvidence
    .filter((item) => item.status === 'missing')
    .map((item) => item.keyword);

  const scores = computeScores(keywordEvidence, cv);
  const riskFlags = buildRiskFlags(keywordEvidence, cv, jd);
  const focusAreas = buildFocusAreas(keywordEvidence);

  return {
    matched_keywords: deduplicateStringsCaseInsensitive(matched),
    partial_keywords: deduplicateStringsCaseInsensitive(partial),
    missing_keywords: deduplicateStringsCaseInsensitive(missing),
    keyword_evidence: keywordEvidence,
    deterministic_scores: scores,
    risk_flags: riskFlags,
    suggested_focus_areas: focusAreas,
    context_block: buildContextBlock(keywordEvidence, scores, riskFlags, focusAreas),
  };
}

function buildRequirements(jd: StructuredJD): Array<{ keyword: string; priority: RequirementPriority }> {
  const rows: Array<{ keyword: string; priority: RequirementPriority }> = [];

  for (const keyword of jd.must_have_keywords ?? []) rows.push({ keyword, priority: 'must_have' });
  for (const keyword of jd.required_skills ?? []) rows.push({ keyword, priority: 'required' });
  for (const keyword of jd.nice_to_have_skills ?? []) rows.push({ keyword, priority: 'nice_to_have' });

  const seen = new Set<string>();
  return rows
    .map((row) => ({ ...row, keyword: row.keyword.trim() }))
    .filter((row) => {
      if (!row.keyword) return false;
      const key = normalize(row.keyword);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 45);
}

function buildCvEvidence(cv: StructuredCV): Array<{ source: string; text: string; normalized: string }> {
  const rows: Array<{ source: string; text: string }> = [];

  const contact = cv.locked.contact;
  if (contact.location) rows.push({ source: 'contact.location', text: contact.location });

  for (const skill of cv.locked_skills.technical ?? []) rows.push({ source: 'skills.technical', text: skill });
  for (const skill of cv.locked_skills.tools ?? []) rows.push({ source: 'skills.tools', text: skill });
  for (const skill of cv.locked_skills.soft ?? []) rows.push({ source: 'skills.soft', text: skill });
  for (const skill of cv.locked_skills.languages ?? []) rows.push({ source: 'skills.languages', text: skill });

  for (const role of cv.locked.experience ?? []) {
    rows.push({ source: `experience.${role.company}.title`, text: role.title });
    for (const tech of role.technologies ?? []) rows.push({ source: `experience.${role.company}.tech`, text: tech });
    for (const bullet of role.raw_bullets ?? []) rows.push({ source: `experience.${role.company}.bullet`, text: bullet });
  }

  for (const edu of cv.locked.education ?? []) {
    rows.push({ source: 'education.degree', text: edu.degree });
    if (edu.institution) rows.push({ source: 'education.institution', text: edu.institution });
  }

  for (const cert of cv.locked.certifications ?? []) {
    rows.push({ source: 'certification.name', text: cert.name });
    if (cert.issuer) rows.push({ source: 'certification.issuer', text: cert.issuer });
  }

  return rows
    .filter((row) => row.text?.trim())
    .map((row) => ({ ...row, normalized: normalize(row.text) }));
}

function evaluateRequirement(
  keyword: string,
  priority: RequirementPriority,
  cvEvidence: Array<{ source: string; text: string; normalized: string }>,
): KeywordEvidence {
  const normalizedKeyword = normalize(keyword);
  const aliases = buildAliases(normalizedKeyword);
  const exactEvidence = findEvidence(aliases, cvEvidence, 'exact');

  if (exactEvidence.length > 0) {
    return {
      keyword,
      normalized_keyword: normalizedKeyword,
      priority,
      status: 'matched',
      confidence: 0.95,
      matched_as: exactEvidence[0].matchedAs,
      evidence: exactEvidence.slice(0, 3).map(({ source, text }) => ({ source, text })),
    };
  }

  const partialEvidence = findEvidence(aliases, cvEvidence, 'partial');

  if (partialEvidence.length > 0) {
    return {
      keyword,
      normalized_keyword: normalizedKeyword,
      priority,
      status: 'partial',
      confidence: 0.62,
      matched_as: partialEvidence[0].matchedAs,
      evidence: partialEvidence.slice(0, 3).map(({ source, text }) => ({ source, text })),
    };
  }

  return {
    keyword,
    normalized_keyword: normalizedKeyword,
    priority,
    status: 'missing',
    confidence: 0.88,
    matched_as: null,
    evidence: [],
  };
}

function findEvidence(
  aliases: string[],
  cvEvidence: Array<{ source: string; text: string; normalized: string }>,
  mode: 'exact' | 'partial',
): Array<{ source: string; text: string; matchedAs: string }> {
  const results: Array<{ source: string; text: string; matchedAs: string }> = [];

  for (const alias of aliases) {
    if (!alias || WEAK_TERMS.has(alias)) continue;

    for (const row of cvEvidence) {
      const hit = mode === 'exact'
        ? containsPhrase(row.normalized, alias)
        : sharesMeaningfulTokens(row.normalized, alias);

      if (hit) {
        results.push({ source: row.source, text: row.text, matchedAs: alias });
      }
    }
  }

  return results;
}

function computeScores(
  evidence: KeywordEvidence[],
  cv: StructuredCV,
): DeterministicIntelligence['deterministic_scores'] {
  const must = evidence.filter((item) => item.priority === 'must_have');
  const required = evidence.filter((item) => item.priority === 'required');
  const nice = evidence.filter((item) => item.priority === 'nice_to_have');

  const mustHaveScore = scoreGroup(must);
  const requiredSkillScore = scoreGroup(required);
  const niceToHaveScore = nice.length ? scoreGroup(nice) : 70;

  const keywordScore = Math.round(
    mustHaveScore * 0.55 + requiredSkillScore * 0.35 + niceToHaveScore * 0.10,
  );

  const sections = cv.locked.has_sections;
  const atsStructureScore = Math.min(100,
    (sections.summary ? 15 : 0) +
    (sections.experience ? 30 : 0) +
    (sections.education ? 20 : 0) +
    (sections.skills ? 20 : 0) +
    (sections.projects ? 10 : 0) +
    (sections.certifications ? 5 : 0),
  );

  const bullets = cv.locked.experience.flatMap((role) => role.raw_bullets ?? []);
  const quantified = bullets.filter((bullet) => /\b\d+[%+]?\b|\b\d+x\b/i.test(bullet)).length;
  const quantifiedAchievementScore = bullets.length
    ? Math.min(100, Math.round((quantified / Math.max(3, bullets.length)) * 100))
    : 0;

  const evidenceStrengthScore = evidence.length
    ? Math.round(evidence.reduce((sum, item) => sum + item.confidence * statusWeight(item.status), 0) / evidence.length * 100)
    : 50;

  return {
    keyword_score: keywordScore,
    must_have_score: mustHaveScore,
    required_skill_score: requiredSkillScore,
    nice_to_have_score: niceToHaveScore,
    ats_structure_score: atsStructureScore,
    evidence_strength_score: evidenceStrengthScore,
    quantified_achievement_score: quantifiedAchievementScore,
  };
}

function scoreGroup(items: KeywordEvidence[]): number {
  if (!items.length) return 65;
  const value = items.reduce((sum, item) => sum + statusWeight(item.status), 0) / items.length;
  return Math.round(value * 100);
}

function statusWeight(status: KeywordMatchStatus): number {
  if (status === 'matched') return 1;
  if (status === 'partial') return 0.55;
  return 0;
}

function buildRiskFlags(
  evidence: KeywordEvidence[],
  cv: StructuredCV,
  jd: StructuredJD,
): string[] {
  const flags: string[] = [];
  const missingMust = evidence.filter((item) => item.priority === 'must_have' && item.status === 'missing');
  const partialMust = evidence.filter((item) => item.priority === 'must_have' && item.status === 'partial');

  if (missingMust.length) flags.push(`Missing ${missingMust.length} must-have requirement(s).`);
  if (partialMust.length) flags.push(`${partialMust.length} must-have requirement(s) are only partially evidenced.`);

  if (jd.required_experience_years && cv.locked.total_years_experience !== null) {
    if (cv.locked.total_years_experience + 0.5 < jd.required_experience_years) {
      flags.push(`Experience appears below the JD requirement of ${jd.required_experience_years}+ years.`);
    }
  }

  const s = cv.locked.has_sections;
  if (!s.skills) flags.push('CV skills section was not detected.');
  if (!s.experience) flags.push('CV experience section was not detected.');
  if (!s.summary) flags.push('CV summary section was not detected.');

  return flags;
}

function buildFocusAreas(evidence: KeywordEvidence[]): string[] {
  return evidence
    .filter((item) => item.status !== 'matched')
    .sort((a, b) => priorityWeight(b.priority) - priorityWeight(a.priority))
    .slice(0, 8)
    .map((item) => `${item.keyword} (${item.priority.replaceAll('_', ' ')})`);
}

function buildContextBlock(
  evidence: KeywordEvidence[],
  scores: DeterministicIntelligence['deterministic_scores'],
  riskFlags: string[],
  focusAreas: string[],
): string {
  const matched = evidence.filter((item) => item.status === 'matched').slice(0, 15);
  const partial = evidence.filter((item) => item.status === 'partial').slice(0, 10);
  const missing = evidence.filter((item) => item.status === 'missing').slice(0, 15);

  return `

--- DETERMINISTIC EVIDENCE LAYER ---
Confirmed matches:
${matched.map((item) => `• ${item.keyword} — evidence: ${item.evidence[0]?.text ?? item.matched_as}`).join('\n') || 'None'}

Partial matches:
${partial.map((item) => `• ${item.keyword} — possible evidence: ${item.evidence[0]?.text ?? item.matched_as}`).join('\n') || 'None'}

Missing requirements:
${missing.map((item) => `• ${item.keyword} (${item.priority})`).join('\n') || 'None'}

Deterministic scores:
- Keyword score: ${scores.keyword_score}/100
- Must-have score: ${scores.must_have_score}/100
- Required skills score: ${scores.required_skill_score}/100
- ATS structure score: ${scores.ats_structure_score}/100
- Quantified achievement score: ${scores.quantified_achievement_score}/100

Risk flags:
${riskFlags.map((flag) => `• ${flag}`).join('\n') || 'None'}

Suggested focus areas:
${focusAreas.map((area) => `• ${area}`).join('\n') || 'None'}
--- END DETERMINISTIC EVIDENCE LAYER ---
`;
}

function priorityWeight(priority: RequirementPriority): number {
  if (priority === 'must_have') return 3;
  if (priority === 'required') return 2;
  return 1;
}

function buildAliases(normalizedKeyword: string): string[] {
  const aliases = new Set<string>([normalizedKeyword]);

  for (const item of SYNONYMS[normalizedKeyword] ?? []) aliases.add(normalize(item));

  for (const [key, values] of Object.entries(SYNONYMS)) {
    if (values.map(normalize).includes(normalizedKeyword)) aliases.add(normalize(key));
  }

  return Array.from(aliases);
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/\breact\.js\b/g, 'react')
    .replace(/\bnode\.js\b/g, 'node')
    .replace(/c\s*\/\s*c\+\+/g, 'c c++')
    .replace(/[^a-z0-9+#.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsPhrase(text: string, phrase: string): boolean {
  if (!phrase) return false;
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\s)${escaped}(\\s|$)`, 'i').test(text);
}

function sharesMeaningfulTokens(text: string, phrase: string): boolean {
  const tokens = phrase.split(' ').filter((token) => token.length >= 3 && !WEAK_TERMS.has(token));
  if (!tokens.length) return false;

  const hits = tokens.filter((token) => containsPhrase(text, token)).length;
  return tokens.length === 1 ? hits === 1 : hits / tokens.length >= 0.6;
}
