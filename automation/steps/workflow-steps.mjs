import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { CommandStep, PipelineError, Step } from '../core/pipeline.mjs';

export class EnvironmentGuardStep extends Step {
  constructor() {
    super('environment-guard');
  }

  async run(context) {
    const requiredPaths = ['templates/states.yml'];

    for (const relPath of requiredPaths) {
      const fullPath = join(context.rootDir, relPath);
      if (!existsSync(fullPath)) {
        throw new PipelineError(`missing required file: ${relPath}`);
      }
    }

    const hasProfile = existsSync(join(context.rootDir, 'config/profile.yml'))
      || existsSync(join(context.rootDir, 'config/profile.example.yml'));

    if (!hasProfile) {
      throw new PipelineError('missing config/profile.yml (or profile.example.yml as fallback)');
    }

    if (context.mode === 'apply') {
      context.logger.warn(
        'auto-submit is intentionally not implemented: workflow stops at recommendation + prefill only.',
      );
    }
  }
}

export class IntakeStep extends Step {
  constructor() {
    super('intake');
  }

  async run(context) {
    const input = context.input?.trim();
    if (!input) {
      throw new PipelineError('input is required (job URL or JD text path).');
    }

    const looksLikeUrl = /^https?:\/\//i.test(input);
    const existsAsFile = existsSync(join(context.rootDir, input));

    if (!looksLikeUrl && !existsAsFile) {
      throw new PipelineError(
        'input must be an HTTP(S) URL or a local file path that exists in this repository.',
      );
    }

    context.addArtifact('input', { type: looksLikeUrl ? 'url' : 'file', value: input });

    if (existsAsFile) {
      const preview = readFileSync(join(context.rootDir, input), 'utf-8').slice(0, 240);
      context.logger.info(`loaded input file preview: ${preview.replace(/\s+/g, ' ').trim()}...`);
    }
  }
}

export class CapabilityDisclosureStep extends Step {
  constructor() {
    super('capability-disclosure');
  }

  async run(context) {
    const disclaimer = {
      does: [
        'normalize + deduplicate tracker data',
        'generate ATS PDF through existing template engine',
        'verify pipeline integrity before/after merge',
      ],
      doesNot: [
        'bypass CAPTCHA or anti-bot systems',
        'submit final applications without human confirmation',
        'guarantee successful extraction from every jobs portal',
      ],
    };

    context.addArtifact('capabilities', disclaimer);
    context.logger.info('capability boundaries registered');
  }
}

export function buildWorkflowSteps(mode) {
  const common = [
    new EnvironmentGuardStep(),
    new IntakeStep(),
    new CapabilityDisclosureStep(),
    new CommandStep('verify-before', 'node', ['verify-pipeline.mjs'], { allowInDryRun: true }),
    new CommandStep('normalize-statuses', 'node', ['normalize-statuses.mjs']),
    new CommandStep('deduplicate-tracker', 'node', ['dedup-tracker.mjs']),
    new CommandStep('merge-tracker', 'node', ['merge-tracker.mjs']),
  ];

  const reportAndPdf = [
    new CommandStep('cv-sync-check', 'node', ['cv-sync-check.mjs']),
    new CommandStep('generate-pdf', 'node', ['generate-pdf.mjs']),
  ];

  const verifyAfter = [new CommandStep('verify-after', 'node', ['verify-pipeline.mjs'], { allowInDryRun: true })];

  if (mode === 'audit') {
    return [
      new EnvironmentGuardStep(),
      new CapabilityDisclosureStep(),
      new CommandStep('verify-only', 'node', ['verify-pipeline.mjs'], { allowInDryRun: true }),
    ];
  }

  return [...common, ...reportAndPdf, ...verifyAfter];
}
