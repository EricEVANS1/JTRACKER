// ============================================================
// _lib/llm.ts
// LLM call, retry, timeout, JSON extraction
// v2.1 — Groq-safe JSON mode fallback
// ============================================================

import { sleep } from './helpers.ts';
import type { LLMConfig } from './types.ts';

type LlmProvider = 'groq' | 'openrouter' | 'openai_compatible';

export async function callLLM(
  userPrompt: string,
  systemPrompt: string,
  config: LLMConfig,
  maxTokens = 2000,
): Promise<Record<string, unknown>> {
  let lastError = '';

  const provider = detectProvider(config.apiUrl);

  const cleanModels = Array.from(
    new Set(
      (config.models || [])
        .map((model) => String(model || '').trim())
        .filter(Boolean),
    ),
  );

  if (!config.apiUrl) {
    throw new Error('LLM API URL is missing.');
  }

  if (!config.apiKey) {
    throw new Error('LLM API key is missing.');
  }

  if (!cleanModels.length) {
    throw new Error('No LLM models configured.');
  }

  for (const model of cleanModels) {
    if (!isModelCompatibleWithProvider(model, provider)) {
      console.warn(
        `[LLM] Skipping incompatible model "${model}" for provider "${provider}".`,
      );
      continue;
    }

    for (let attempt = 0; attempt < Math.max(config.maxRetries, 1); attempt++) {
      if (attempt > 0) {
        await sleep(config.retryDelaysMs[attempt - 1] ?? 500);
      }

      const jsonModeAttempts =
        provider === 'groq'
          ? [true, false]
          : [false];

      for (const useJsonMode of jsonModeAttempts) {
        const abortController = new AbortController();

        const timeoutId = setTimeout(
          () => abortController.abort(),
          config.timeoutMs || 10_000,
        );

        try {
          console.log(
            `[LLM] ${model} attempt ${attempt + 1} jsonMode=${useJsonMode}`,
          );

          const body: Record<string, unknown> = {
            model,
            messages: [
              {
                role: 'system',
                content:
                  `${systemPrompt}\n\nYou must return only valid JSON. Do not include markdown, comments, or explanatory text.`,
              },
              { role: 'user', content: userPrompt },
            ],
            temperature: 0.1,
            max_tokens: maxTokens,
          };

          if (useJsonMode) {
            body.response_format = {
              type: 'json_object',
            };
          }

          const response = await fetch(config.apiUrl, {
            method: 'POST',
            headers: llmHeaders(config.apiKey, provider),
            signal: abortController.signal,
            body: JSON.stringify(body),
          });

          if (!response.ok) {
            const errText = await response.text();

            lastError =
              `${model} attempt ${attempt + 1} jsonMode=${useJsonMode}: ` +
              `HTTP ${response.status} — ${errText.slice(0, 500)}`;

            console.error(lastError);

            if (response.status === 429) {
              throw new Error(
                `LLM rate limit reached for model "${model}". ${errText.slice(0, 300)}`,
              );
            }

            if (response.status === 401 || response.status === 403) {
              throw new Error(
                `LLM authentication failed. Check LLAMA_API_KEY. HTTP ${response.status}: ${errText.slice(0, 300)}`,
              );
            }

            if (response.status === 400 && useJsonMode) {
              console.warn(
                `[LLM] ${model} rejected JSON mode. Retrying without response_format.`,
              );
              continue;
            }

            if (
              response.status === 400 ||
              response.status === 404 ||
              response.status === 422
            ) {
              console.warn(
                `[LLM] Model "${model}" returned HTTP ${response.status}. Skipping to next model.`,
              );
              break;
            }

            continue;
          }

          const data = await response.json();

          const raw =
            data?.choices?.[0]?.message?.content ||
            data?.choices?.[0]?.text ||
            '';

          const finishReason =
            data?.choices?.[0]?.finish_reason || '';

          if (!raw) {
            lastError =
              `${model} attempt ${attempt + 1} jsonMode=${useJsonMode}: Empty response`;
            console.error(lastError);
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
            `${model} attempt ${attempt + 1} jsonMode=${useJsonMode}: Could not extract valid JSON`;

          console.error(lastError);
        } catch (err) {
          const isAbort =
            err instanceof Error &&
            err.name === 'AbortError';

          lastError = isAbort
            ? `${model} timed out after ${config.timeoutMs}ms`
            : `${model}: ${err instanceof Error ? err.message : String(err)}`;

          console.error(lastError);

          if (
            err instanceof Error &&
            (
              err.message.includes('rate limit') ||
              err.message.includes('authentication failed')
            )
          ) {
            throw err;
          }
        } finally {
          clearTimeout(timeoutId);
        }
      }
    }
  }

  console.error(`[LLM] All models failed: ${lastError}`);

  throw new Error(
    lastError ||
    'All LLM models failed. Check LLAMA_API_URL, LLAMA_API_KEY, and LLAMA_MODEL.',
  );
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

function detectProvider(apiUrl: string): LlmProvider {
  const normalized = apiUrl.toLowerCase();

  if (normalized.includes('groq.com')) {
    return 'groq';
  }

  if (normalized.includes('openrouter.ai')) {
    return 'openrouter';
  }

  return 'openai_compatible';
}

function isModelCompatibleWithProvider(
  model: string,
  provider: LlmProvider,
): boolean {
  const normalized = model.toLowerCase();

  if (provider === 'groq') {
    return (
      normalized === 'llama-3.1-8b-instant' ||
      normalized === 'llama-3.3-70b-versatile'
    );
  }

  if (provider === 'openrouter') {
    return (
      normalized.includes('/') ||
      normalized.includes(':free')
    );
  }

  return true;
}

function llmHeaders(
  apiKey: string,
  provider: LlmProvider,
): Record<string, string> {
  const baseHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };

  if (provider === 'openrouter') {
    return {
      ...baseHeaders,
      'HTTP-Referer': 'https://jtracker-umber.vercel.app',
      'X-Title': 'JTracker',
    };
  }

  return baseHeaders;
}