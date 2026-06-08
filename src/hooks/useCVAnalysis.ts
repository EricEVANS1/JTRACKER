// ============================================================
// useCVAnalysis — consumes the smart-worker SSE stream
//
// The Edge Function returns text/event-stream, NOT JSON.
// supabase.functions.invoke cannot handle SSE — we use fetch directly.
//
// SSE events emitted by smart-worker:
//   event: progress  → { step, message, percent }
//   event: complete  → { analysis, learning_context_used, patterns_updated }
//   event: error     → { message }
// ============================================================

import { useCallback, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { CVAnalysis } from '../types/cvIntelligence';

interface AnalyzeCVInput {
  cvVersionId: string;
  jobDescription: string;
}

export interface AnalysisState {
  step: 'idle' | 'analyzing' | 'done' | 'error';
  error: string | null;
  analysis: CVAnalysis | null;
  learningContextUsed: boolean;
  progressMessage: string;
  progressPercent: number;
}

const initialState: AnalysisState = {
  step: 'idle',
  error: null,
  analysis: null,
  learningContextUsed: false,
  progressMessage: '',
  progressPercent: 0,
};

export const useCVAnalysis = () => {
  const [state, setState] = useState<AnalysisState>(initialState);

  const analyzeCV = useCallback(async ({ cvVersionId, jobDescription }: AnalyzeCVInput) => {
    if (!cvVersionId) {
      setState(prev => ({ ...prev, step: 'error', error: 'CV version is required.' }));
      return null;
    }
    if (!jobDescription.trim()) {
      setState(prev => ({ ...prev, step: 'error', error: 'Job description is required.' }));
      return null;
    }

    setState({
      step: 'analyzing',
      error: null,
      analysis: null,
      learningContextUsed: false,
      progressMessage: 'Starting analysis...',
      progressPercent: 5,
    });

    try {
      // ---- Get session JWT ----
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        setState(prev => ({
          ...prev,
          step: 'error',
          error: 'Not authenticated. Please sign in again.',
        }));
        return null;
      }

      // ---- Get Edge Function URL ----
      // supabase.functions.invoke cannot handle SSE — use fetch directly
      const supabaseUrl = (supabase as any).supabaseUrl as string;
      const functionUrl = `${supabaseUrl}/functions/v1/smart-worker`;

      const response = await fetch(functionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          // Pass the anon key so Supabase edge runtime accepts the request
          'apikey': (supabase as any).supabaseKey as string,
        },
        body: JSON.stringify({
          cv_version_id: cvVersionId,
          job_description: jobDescription.trim(),
        }),
      });

      if (!response.ok) {
        // Non-2xx before stream starts — parse error body
        let message = `Server error: ${response.status}`;
        try {
          const json = await response.json();
          if (json?.error) message = json.error;
        } catch { /* ignore */ }
        setState(prev => ({ ...prev, step: 'error', error: message }));
        return null;
      }

      if (!response.body) {
        setState(prev => ({ ...prev, step: 'error', error: 'No response body received.' }));
        return null;
      }

      // ---- Consume SSE stream ----
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalAnalysis: CVAnalysis | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE messages are separated by double newlines
        const messages = buffer.split('\n\n');
        // Keep the last potentially incomplete message in the buffer
        buffer = messages.pop() ?? '';

        for (const message of messages) {
          if (!message.trim()) continue;

          // Parse SSE format: lines starting with "event:" and "data:"
          const eventMatch = message.match(/^event:\s*(.+)$/m);
          const dataMatch = message.match(/^data:\s*(.+)$/ms);

          if (!eventMatch || !dataMatch) continue;

          const event = eventMatch[1].trim();
          let payload: any;

          try {
            payload = JSON.parse(dataMatch[1].trim());
          } catch {
            console.warn('[SSE] Failed to parse payload:', dataMatch[1]);
            continue;
          }

          if (event === 'progress') {
            setState(prev => ({
              ...prev,
              progressMessage: payload.message || prev.progressMessage,
              progressPercent: payload.percent ?? prev.progressPercent,
            }));
          } else if (event === 'complete') {
            finalAnalysis = payload.analysis as CVAnalysis;
            setState({
              step: 'done',
              error: null,
              analysis: finalAnalysis,
              learningContextUsed: payload.learning_context_used ?? false,
              progressMessage: 'Analysis complete.',
              progressPercent: 100,
            });
          } else if (event === 'error') {
            setState(prev => ({
              ...prev,
              step: 'error',
              error: payload.message || 'Analysis failed. Please try again.',
              progressMessage: '',
              progressPercent: 0,
            }));
            return null;
          }
        }
      }

      // Handle case where stream ended without a complete event
      if (!finalAnalysis) {
        setState(prev => ({
          ...prev,
          step: 'error',
          error: 'Analysis stream ended unexpectedly. Please try again.',
        }));
        return null;
      }

      return finalAnalysis;

    } catch (err: any) {
      console.error('[useCVAnalysis] Error:', err);
      setState(prev => ({
        ...prev,
        step: 'error',
        error: err?.message || 'Unexpected error. Please try again.',
        progressMessage: '',
        progressPercent: 0,
      }));
      return null;
    }
  }, []);

  const resetAnalysis = useCallback(() => {
    setState(initialState);
  }, []);

  const fetchHistory = useCallback(async (cvVersionId: string): Promise<CVAnalysis[]> => {
    const { data, error } = await supabase
      .from('cv_analyses')
      .select('*')
      .eq('cv_version_id', cvVersionId)
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) return [];
    return data ?? [];
  }, []);

  return {
    ...state,
    analyzeCV,
    resetAnalysis,
    fetchHistory,
    isAnalyzing: state.step === 'analyzing',
    isDone: state.step === 'done',
    hasError: state.step === 'error',
  };
};