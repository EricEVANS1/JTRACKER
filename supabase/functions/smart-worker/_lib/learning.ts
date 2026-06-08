// ============================================================
// _lib/learning.ts
// Learning context + pattern distillation
// ============================================================

import { getScoreBand } from './helpers.ts';
import type {
  AnalysisResult,
  LearningContext,
  StructuredJD,
} from './types.ts';

type SupabaseClientLike = any;

export async function buildLearningContext(
  userId: string,
  roleCategory: string,
  supabase: SupabaseClientLike,
): Promise<LearningContext> {
  const { data: rolePatterns } = await supabase
    .from('cv_scoring_patterns')
    .select(
      'role_category, score_band, pattern_summary, keyword_signals, sample_count',
    )
    .eq('user_id', userId)
    .eq('role_category', roleCategory)
    .order('sample_count', { ascending: false })
    .limit(3);

  const { data: allPatterns } = await supabase
    .from('cv_scoring_patterns')
    .select(
      'role_category, score_band, pattern_summary, keyword_signals, sample_count',
    )
    .eq('user_id', userId)
    .order('sample_count', { ascending: false })
    .limit(5);

  const { data: pastAnalyses } = await supabase
    .from('cv_analyses')
    .select(
      'score, job_title, matched_keywords, score_breakdown, role_category',
    )
    .eq('user_id', userId)
    .eq('role_category', roleCategory)
    .gte('score', 65)
    .order('score', { ascending: false })
    .limit(5);

  const hasPastData = Boolean(
    rolePatterns?.length ||
    allPatterns?.length ||
    pastAnalyses?.length,
  );

  if (!hasPastData) {
    return {
      hasPastData: false,
      contextBlock: '',
    };
  }

  let contextBlock = '\n\n--- LEARNING CONTEXT FROM PAST ANALYSES ---\n';

  if (rolePatterns?.length) {
    contextBlock += `\nPatterns specific to "${roleCategory}" roles:\n`;

    for (const p of rolePatterns) {
      contextBlock +=
        `• [Score band ${p.score_band} | ${p.sample_count} sample(s)]: ${p.pattern_summary}\n`;

      if (p.keyword_signals?.length) {
        contextBlock +=
          `  High-signal keywords: ${p.keyword_signals.join(', ')}\n`;
      }
    }
  } else if (allPatterns?.length) {
    contextBlock += '\nGeneral scoring patterns for this user:\n';

    for (const p of allPatterns.slice(0, 3)) {
      contextBlock +=
        `• [${p.role_category} | ${p.score_band}]: ${p.pattern_summary}\n`;
    }
  }

  if (pastAnalyses?.length) {
    contextBlock += `\nPast high-scoring "${roleCategory}" analyses:\n`;

    for (const a of pastAnalyses) {
      contextBlock +=
        `• ${a.job_title || 'Unknown role'} — Score: ${a.score}/100\n`;

      if (a.matched_keywords?.length) {
        contextBlock +=
          `  Matched: ${a.matched_keywords.slice(0, 8).join(', ')}\n`;
      }
    }

    contextBlock +=
      "\nApply consistent scoring based on this user's CV profile.\n";
  }

  contextBlock += '--- END LEARNING CONTEXT ---\n';

  return {
    hasPastData: true,
    contextBlock,
  };
}

export async function distilPattern(
  userId: string,
  analysisId: string,
  analysis: AnalysisResult,
  jd: StructuredJD,
  primaryScore: number,
  supabase: SupabaseClientLike,
): Promise<boolean> {
  try {
    const roleCategory =
      jd.role_category ||
      analysis.role_category ||
      'General';

    const scoreBand = getScoreBand(primaryScore);

    const signalKeywords = Array.from(
      new Set([
        ...(analysis.matched_keywords ?? []).slice(0, 8),
        ...(jd.must_have_keywords ?? []).slice(0, 5),
      ]),
    ).slice(0, 20);

    const { data: existing } = await supabase
      .from('cv_scoring_patterns')
      .select('id, sample_count, keyword_signals')
      .eq('user_id', userId)
      .eq('role_category', roleCategory)
      .eq('score_band', scoreBand)
      .maybeSingle();

    if (existing) {
      const mergedKeywords = Array.from(
        new Set([
          ...(existing.keyword_signals ?? []),
          ...signalKeywords,
        ]),
      ).slice(0, 25);

      await supabase
        .from('cv_scoring_patterns')
        .update({
          sample_count: existing.sample_count + 1,
          keyword_signals: mergedKeywords,
          source_analysis_id: analysisId,
        })
        .eq('id', existing.id);

      return true;
    }

    const topDimension =
      Object.entries(analysis.score_breakdown ?? {})
        .sort(([, a], [, b]) => Number(b) - Number(a))[0];

    const summary = [
      `Fit score ${primaryScore}/100.`,
      analysis.qualification_verdict
        ? `Verdict: ${analysis.qualification_verdict}.`
        : '',
      `Seniority: ${jd.seniority_required}.`,
      topDimension
        ? `Strongest: ${topDimension[0]} (${topDimension[1]}/100).`
        : '',
      signalKeywords.length
        ? `Key signals: ${signalKeywords.slice(0, 5).join(', ')}.`
        : '',
    ]
      .filter(Boolean)
      .join(' ');

    await supabase.from('cv_scoring_patterns').insert({
      user_id: userId,
      role_category: roleCategory,
      score_band: scoreBand,
      pattern_summary: summary,
      keyword_signals: signalKeywords,
      sample_count: 1,
      source_analysis_id: analysisId,
    });

    return true;
  } catch (err) {
    console.error('[learning] distilPattern error:', err);
    return false;
  }
}