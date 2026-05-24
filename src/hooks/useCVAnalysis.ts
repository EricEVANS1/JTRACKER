// ============================================================
// useCVAnalysis — orchestrates the CV Intelligence Engine
// SSE version for smart-worker streaming response
// ============================================================

import { useCallback, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { AnalyzerState, CVAnalysis } from '../types/cvIntelligence';

interface AnalyzeCVInput {
  cvVersionId: string;
  jobDescription: string;
}

const initialState: AnalyzerState = {
  step: 'idle',
  error: null,
  analysis: null,
  learningContextUsed: false,
};

export const useCVAnalysis = () => {
  const [state, setState] = useState<AnalyzerState>(initialState);
  const [progressMessage, setProgressMessage] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);

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
    });

    setProgressMessage('Starting analysis...');
    setProgressPercent(5);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        setState({
          step: 'error',
          error: 'Not authenticated. Please sign in again.',
          analysis: null,
          learningContextUsed: false,
        });
        return null;
      }

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const functionUrl = `${supabaseUrl}/functions/v1/smart-worker`;

      const response = await fetch(functionUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          cv_version_id: cvVersionId,
          job_description: jobDescription.trim(),
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error('Failed to start CV analysis.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let buffer = '';
      let finalAnalysis: CVAnalysis | null = null;

      while (true) {
        const { value, done } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() || '';

        for (const block of blocks) {
          const lines = block.split('\n');

          const eventLine = lines.find(line => line.startsWith('event:'));
          const dataLine = lines.find(line => line.startsWith('data:'));

          if (!eventLine || !dataLine) continue;

          const eventName = eventLine.replace('event:', '').trim();
          const payload = JSON.parse(dataLine.replace('data:', '').trim());

          if (eventName === 'progress') {
            setProgressMessage(payload.message || 'Working...');
            setProgressPercent(payload.percent || 0);
          }

          if (eventName === 'complete') {
            finalAnalysis = payload.analysis;

            setState({
              step: 'done',
              error: null,
              analysis: payload.analysis,
              learningContextUsed: payload.learning_context_used,
            });

            setProgressMessage('Analysis complete.');
            setProgressPercent(100);
          }

          if (eventName === 'error') {
            throw new Error(payload.message || 'Failed to analyze CV.');
          }
        }
      }

      if (!finalAnalysis) {
        throw new Error('No analysis returned. Please try again.');
      }

      return finalAnalysis;
    } catch (err: any) {
      setState({
        step: 'error',
        error: err?.message || 'Unexpected error. Please try again.',
        analysis: null,
        learningContextUsed: false,
      });

      setProgressMessage('');
      setProgressPercent(0);

      return null;
    }
  }, []);

  const resetAnalysis = useCallback(() => {
    setState(initialState);
    setProgressMessage('');
    setProgressPercent(0);
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
    progressMessage,
    progressPercent,
    isAnalyzing: state.step === 'analyzing' || state.step === 'extracting',
    isDone: state.step === 'done',
    hasError: state.step === 'error',
  };
};