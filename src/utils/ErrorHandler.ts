/** Centralized error handling with structured output and non-fatal degradation. */

import { Logger } from './Logger.js';

const log = new Logger('ErrorHandler');

export class PipelineError extends Error {
  constructor(
    message: string,
    public readonly module: string,
    public readonly recoverable: boolean = true,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'PipelineError';
  }
}

export class ErrorHandler {
  /**
   * Wrap an async operation with structured error handling.
   * Recoverable errors are logged and return null. Fatal errors rethrow.
   */
  static async wrap<T>(
    operation: () => Promise<T>,
    context: string,
    recoverable = true
  ): Promise<T | null> {
    try {
      return await operation();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`${context} failed: ${message}`, err);

      if (!recoverable) {
        throw new PipelineError(message, context, false, err);
      }
      return null;
    }
  }

  /** Format an error for display to the user. */
  static format(err: unknown): string {
    if (err instanceof PipelineError) {
      return `[${err.module}] ${err.message}${err.recoverable ? ' (recoverable)' : ' (fatal)'}`;
    }
    if (err instanceof Error) return err.message;
    return String(err);
  }
}
