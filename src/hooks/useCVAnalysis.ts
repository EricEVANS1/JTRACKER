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

    const abortController = new AbortController();
    const timeoutId = window.setTimeout(() => abortController.abort(), 55_000);

    try {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        setState(prev => ({
          ...prev,
          step: 'error',
          error: 'Not authenticated. Please sign in again.',
        }));
        return null;
      }

      const supabaseUrl = (supabase as any).supabaseUrl as string;
      const functionUrl = `${supabaseUrl}/functions/v1/smart-worker`;

      const response = await fetch(functionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          apikey: (supabase as any).supabaseKey as string,
        },
        body: JSON.stringify({
          cv_version_id: cvVersionId,
          job_description: jobDescription.trim(),
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        let message = `Server error: ${response.status}`;

        try {
          const json = await response.json();
          message = json?.message || json?.error || message;
        } catch {
          try {
            const text = await response.text();
            if (text) message = text;
          } catch {
            // ignore
          }
        }

        setState(prev => ({ ...prev, step: 'error', error: message }));
        return null;
      }

      if (!response.body) {
        setState(prev => ({ ...prev, step: 'error', error: 'No response body received.' }));
        return null;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let buffer = '';
      let finalAnalysis: CVAnalysis | null = null;
      let receivedComplete = false;
      let receivedError = false;
      let lastServerError: string | null = null;

      const handleSseMessage = (message: string) => {
        if (!message.trim()) return;

        const eventMatch = message.match(/^event:\s*(.+)$/m);
        const dataMatch = message.match(/^data:\s*([\s\S]*)$/m);

        if (!eventMatch || !dataMatch) return;

        const event = eventMatch[1].trim();
        let payload: any = {};

        try {
          payload = JSON.parse(dataMatch[1].trim());
        } catch {
          console.warn('[SSE] Failed to parse payload:', dataMatch[1]);
          return;
        }

        if (event === 'progress') {
          setState(prev => ({
            ...prev,
            progressMessage: payload.message || prev.progressMessage,
            progressPercent: payload.percent ?? prev.progressPercent,
          }));
          return;
        }

        if (event === 'complete') {
          receivedComplete = true;
          finalAnalysis = payload.analysis as CVAnalysis;

          setState({
            step: 'done',
            error: null,
            analysis: finalAnalysis,
            learningContextUsed: payload.learning_context_used ?? false,
            progressMessage: 'Analysis complete.',
            progressPercent: 100,
          });
          return;
        }

        if (event === 'error') {
          receivedError = true;
          lastServerError =
            payload.details
              ? `${payload.message || 'Analysis failed.'}: ${payload.details}`
              : payload.message || 'Analysis failed. Please try again.';

          setState(prev => ({
            ...prev,
            step: 'error',
            error: lastServerError,
            progressMessage: '',
            progressPercent: 0,
          }));
        }
      };

      while (true) {
        const { done, value } = await reader.read();

        if (value) {
          buffer += decoder.decode(value, { stream: true });

          const messages = buffer.split(/\n\n+/);
          buffer = messages.pop() ?? '';

          for (const message of messages) {
            handleSseMessage(message);
          }
        }

        if (done) break;
      }

      if (buffer.trim()) {
        handleSseMessage(buffer);
      }

      if (receivedComplete && finalAnalysis) {
        return finalAnalysis;
      }

      if (receivedError) {
        return null;
      }

      setState(prev => ({
        ...prev,
        step: 'error',
        error:
          lastServerError ||
          'Analysis stream ended before completion. Check smart-worker logs or ensure cv_text exists for this CV.',
      }));

      return null;
    } catch (err: any) {
      const isTimeout = err?.name === 'AbortError';

      console.error('[useCVAnalysis] Error:', err);

      setState(prev => ({
        ...prev,
        step: 'error',
        error: isTimeout
          ? 'Analysis timed out. Please make sure the selected CV has extracted text and try again.'
          : err?.message || 'Unexpected error. Please try again.',
        progressMessage: '',
        progressPercent: 0,
      }));

      return null;
    } finally {
      window.clearTimeout(timeoutId);
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