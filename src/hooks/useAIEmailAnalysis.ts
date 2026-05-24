import { useCallback, useState } from 'react';
import { supabase } from '../lib/supabase';

export interface AIEmailInsight {
  summary: string;
  urgency: 'high' | 'medium' | 'low';
  suggestedAction: string;
  tone: string;
  keyDetails: string[];
  followUpDate?: string | null;
  redFlags?: string[];
  confidence: number;
}

export interface AIBatchInsight {
  totalAnalyzed: number;
  patternSummary: string;
  topOpportunities: string[];
  concerningTrends: string[];
  recommendedFocus: string;
}

interface EmailForBatchAnalysis {
  subject: string | null;
  sender: string | null;
  detected_status: string | null;
  received_at: string | null;
}

const AI_ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-email`;

const normalizeUrgency = (value: unknown): 'high' | 'medium' | 'low' => {
  if (value === 'high' || value === 'medium' || value === 'low') return value;
  return 'low';
};

const normalizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
};

const normalizeInsight = (data: unknown): AIEmailInsight => {
  const raw = data as Partial<AIEmailInsight>;

  return {
    summary: typeof raw.summary === 'string' ? raw.summary : 'No summary available.',
    urgency: normalizeUrgency(raw.urgency),
    suggestedAction:
      typeof raw.suggestedAction === 'string'
        ? raw.suggestedAction
        : 'Review this email manually.',
    tone: typeof raw.tone === 'string' ? raw.tone : 'Unknown',
    keyDetails: normalizeStringArray(raw.keyDetails),
    followUpDate:
      typeof raw.followUpDate === 'string' && raw.followUpDate.trim()
        ? raw.followUpDate
        : null,
    redFlags: normalizeStringArray(raw.redFlags),
    confidence:
      typeof raw.confidence === 'number'
        ? Math.max(0, Math.min(100, raw.confidence))
        : 50,
  };
};

const normalizeBatchInsight = (data: unknown): AIBatchInsight => {
  const raw = data as Partial<AIBatchInsight>;

  return {
    totalAnalyzed: typeof raw.totalAnalyzed === 'number' ? raw.totalAnalyzed : 0,
    patternSummary:
      typeof raw.patternSummary === 'string'
        ? raw.patternSummary
        : 'No pipeline summary available.',
    topOpportunities: normalizeStringArray(raw.topOpportunities),
    concerningTrends: normalizeStringArray(raw.concerningTrends),
    recommendedFocus:
      typeof raw.recommendedFocus === 'string'
        ? raw.recommendedFocus
        : 'Review your latest recruitment emails and prioritize urgent replies.',
  };
};

async function callAI(payload: Record<string, unknown>) {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError) {
    throw new Error(sessionError.message);
  }

  if (!session?.access_token) {
    throw new Error('You must be signed in to use AI email analysis.');
  }

  const response = await fetch(AI_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(text || `AI request failed with status ${response.status}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error('AI returned invalid JSON.');
  }
}

export function useAIEmailAnalysis() {
  const [analyzing, setAnalyzing] = useState<Record<string, boolean>>({});
  const [insights, setInsights] = useState<Record<string, AIEmailInsight>>({});
  const [batchInsight, setBatchInsight] = useState<AIBatchInsight | null>(null);
  const [batchAnalyzing, setBatchAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyzeEmail = useCallback(
    async (
      emailId: string,
      subject: string,
      sender: string,
      snippet: string,
      detectedStatus: string
    ) => {
      if (insights[emailId] || analyzing[emailId]) return;

      setAnalyzing((prev) => ({ ...prev, [emailId]: true }));
      setError(null);

      try {
        const data = await callAI({
          mode: 'single',
          subject,
          sender,
          snippet,
          detectedStatus,
        });

        const insight = normalizeInsight(data);

        setInsights((prev) => ({
          ...prev,
          [emailId]: insight,
        }));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to analyze email.');
      } finally {
        setAnalyzing((prev) => ({ ...prev, [emailId]: false }));
      }
    },
    [insights, analyzing]
  );

  const analyzeBatch = useCallback(
    async (emails: EmailForBatchAnalysis[]) => {
      if (batchAnalyzing || emails.length === 0) return;

      setBatchAnalyzing(true);
      setError(null);

      try {
        const limitedEmails = emails.slice(0, 20);

        const data = await callAI({
          mode: 'batch',
          emails: limitedEmails,
        });

        const insight = normalizeBatchInsight(data);

        setBatchInsight({
          ...insight,
          totalAnalyzed: insight.totalAnalyzed || limitedEmails.length,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Batch analysis failed.');
      } finally {
        setBatchAnalyzing(false);
      }
    },
    [batchAnalyzing]
  );

  return {
    analyzeEmail,
    analyzeBatch,
    insights,
    analyzing,
    batchInsight,
    batchAnalyzing,
    error,
  };
}