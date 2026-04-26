import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export class PipelineError extends Error {
  constructor(message, metadata = {}) {
    super(message);
    this.name = 'PipelineError';
    this.metadata = metadata;
  }
}

export class PipelineContext {
  constructor({ rootDir, mode, dryRun, input, logger }) {
    this.rootDir = rootDir;
    this.mode = mode;
    this.dryRun = dryRun;
    this.input = input;
    this.logger = logger;
    this.artifacts = [];
  }

  addArtifact(name, value) {
    this.artifacts.push({ name, value });
  }
}

export class Step {
  constructor(name) {
    this.name = name;
  }

  // eslint-disable-next-line no-unused-vars
  async run(_context) {
    throw new Error(`Step ${this.name} must implement run(context)`);
  }
}

export class CommandStep extends Step {
  constructor(name, command, args = [], { allowInDryRun = false } = {}) {
    super(name);
    this.command = command;
    this.args = args;
    this.allowInDryRun = allowInDryRun;
  }

  async run(context) {
    if (context.dryRun && !this.allowInDryRun) {
      context.logger.info(`[dry-run] skipped command: ${this.command} ${this.args.join(' ')}`);
      return;
    }

    context.logger.info(`running: ${this.command} ${this.args.join(' ')}`);
    try {
      const { stdout, stderr } = await execFileAsync(this.command, this.args, {
        cwd: context.rootDir,
        maxBuffer: 5 * 1024 * 1024,
      });
      if (stdout.trim()) context.logger.info(stdout.trim());
      if (stderr.trim()) context.logger.warn(stderr.trim());
    } catch (error) {
      throw new PipelineError(`step "${this.name}" failed`, {
        command: this.command,
        args: this.args,
        code: error.code,
        stderr: error.stderr,
      });
    }
  }
}

export class PipelineOrchestrator {
  constructor(steps, logger) {
    this.steps = steps;
    this.logger = logger;
  }

  async run(context) {
    this.logger.info(`starting mode=${context.mode} dryRun=${String(context.dryRun)}`);

    for (const step of this.steps) {
      this.logger.info(`→ ${step.name}`);
      await step.run(context);
      this.logger.info(`✓ ${step.name}`);
    }

    this.logger.info(`finished. artifacts=${context.artifacts.length}`);
    return context.artifacts;
  }
}

export class ConsoleLogger {
  info(message) {
    console.log(`[INFO] ${message}`);
  }

  warn(message) {
    console.warn(`[WARN] ${message}`);
  }

  error(message) {
    console.error(`[ERROR] ${message}`);
  }
}
