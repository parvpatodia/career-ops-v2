/**
 * Minimal, fault-tolerant Gemini wrapper. generate() returns null on ANY
 * failure (no key, network error, rate limit, safety block, empty response) so
 * a caller can fall back instead of throwing. The autopilot must never crash on
 * an LLM hiccup; an essay just falls back to the deterministic writer or abstains.
 *
 * Model + key come from the environment (.env, gitignored): GEMINI_API_KEY and
 * optionally GEMINI_MODEL (default gemini-2.5-flash, the model the key exposes).
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { Logger } from '../utils/Logger.js';

export interface LlmClient {
  /** Returns the model's text, or null on any failure. Never throws. */
  generate(prompt: string): Promise<string | null>;
  readonly enabled: boolean;
}

export class GeminiClient implements LlmClient {
  private log = new Logger('gemini');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly model: any | null;
  readonly enabled: boolean;

  constructor(
    apiKey: string = process.env.GEMINI_API_KEY ?? '',
    modelName: string = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash'
  ) {
    this.enabled = apiKey.trim().length > 0;
    this.model = this.enabled
      ? new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: modelName })
      : null;
  }

  async generate(prompt: string): Promise<string | null> {
    if (!this.model) return null;
    try {
      const res = await this.model.generateContent(prompt);
      const text = String(res?.response?.text?.() ?? '').trim();
      return text.length > 0 ? text : null;
    } catch (err) {
      this.log.warn(`Gemini call failed, falling back: ${(err as Error).message.split('\n')[0].slice(0, 160)}`);
      return null;
    }
  }
}

/** A disabled client (no key): always returns null, so callers use their fallback. */
export const NO_LLM: LlmClient = { enabled: false, generate: async () => null };
