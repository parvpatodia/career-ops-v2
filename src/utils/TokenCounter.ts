/** Tracks estimated token usage per operation for budget monitoring. */

import fs from 'fs';
import path from 'path';

interface OperationUsage {
  operation: string;
  estimatedTokens: number;
  ts: string;
}

// WHY: Rough estimates per character count. Real token count needs the tokenizer,
// but this gives us a budget signal without adding a heavy dependency.
const CHARS_PER_TOKEN = 4;

export class TokenCounter {
  private sessionUsage: OperationUsage[] = [];
  private static readonly logFile = 'data/daily_log/token-usage.jsonl';

  /** Estimate tokens from a string. */
  estimate(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  }

  /** Record token usage for an operation and check against budget. */
  record(operation: string, text: string | number): void {
    const tokens = typeof text === 'string' ? this.estimate(text) : text;
    const entry: OperationUsage = {
      operation,
      estimatedTokens: tokens,
      ts: new Date().toISOString(),
    };
    this.sessionUsage.push(entry);
    this.appendToLog(entry);
  }

  sessionTotal(): number {
    return this.sessionUsage.reduce((sum, e) => sum + e.estimatedTokens, 0);
  }

  /** Warn if session is approaching the 50K token limit. */
  checkBudget(): void {
    const total = this.sessionTotal();
    if (total > 40_000) {
      console.warn(`[TokenCounter] Session at ~${total.toLocaleString()} tokens. Approaching 50K limit.`);
    }
  }

  summary(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const entry of this.sessionUsage) {
      result[entry.operation] = (result[entry.operation] ?? 0) + entry.estimatedTokens;
    }
    return result;
  }

  private appendToLog(entry: OperationUsage): void {
    try {
      fs.mkdirSync(path.dirname(TokenCounter.logFile), { recursive: true });
      fs.appendFileSync(TokenCounter.logFile, JSON.stringify(entry) + '\n');
    } catch {
      // Non-fatal.
    }
  }
}
