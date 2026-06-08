// ============================================================
// _lib/llm.ts
// LLM call, retry, timeout, JSON extraction
// ============================================================

import { sleep } from './helpers.ts';
import type { LLMConfig } from './types.ts';

export async function callLLM(
  userPrompt: string,
  systemPrompt: string,
  config: LLMConfig,
  maxTokens = 2000,
): Promise<Record<string, unknown>> {
  let lastError = '';

  for (const model of config.models) {
    for (let attempt = 0; attempt < config.maxRetries; attempt++) {
      if (attempt > 0) {
        await sleep(config.retryDelaysMs[attempt - 1] ?? 2000);
      }

      const abortController = new AbortController();
      const timeoutId = setTimeout(
        () => abortController.abort(),
        config.timeoutMs,
      );

      try {
        console.log(`[LLM] ${model} attempt ${attempt + 1}`);

        const response = await fetch(config.apiUrl, {
          method: 'POST',
          headers: llmHeaders(config.apiKey),
          signal: abortController.signal,
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            temperature: 0.1,
            max_tokens: maxTokens,
          }),
        });

        if (!response.ok) {
          const errText = await response.text();

          lastError =
            `${model} attempt ${attempt + 1}: ` +
            `HTTP ${response.status} — ${errText.slice(0, 200)}`;

          console.error(lastError);

          if (response.status === 401 || response.status === 403) {
            break;
          }

          continue;
        }

        const data = await response.json();

        const raw =
          data?.choices?.[0]?.message?.content || '';

        const finishReason =
          data?.choices?.[0]?.finish_reason || '';

        if (!raw) {
          lastError = `${model} attempt ${attempt + 1}: Empty response`;
          continue;
        }

        const parsed = extractJson(raw);

        if (parsed) {
          parsed.is_truncated =
            finishReason === 'length' ||
            parsed._truncated === true;

          return parsed;
        }

        lastError =
          `${model} attempt ${attempt + 1}: Could not extract valid JSON`;

      } catch (err) {
        const isAbort =
          err instanceof Error &&
          err.name === 'AbortError';

        lastError = isAbort
          ? `${model} timed out after ${config.timeoutMs}ms`
          : `${model}: ${err instanceof Error ? err.message : String(err)}`;

        console.error(lastError);

      } finally {
        clearTimeout(timeoutId);
      }
    }
  }

  console.error(`[LLM] All models failed: ${lastError}`);

  return {};
}

export function extractJson(
  raw: string,
): Record<string, unknown> | null {
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
      if (start === -1 || end <= start) throw new Error();
      return JSON.parse(raw.slice(start, end + 1));
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

function llmHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'HTTP-Referer': 'https://jtracker-umber.vercel.app',
    'X-Title': 'JTracker',
  };
}