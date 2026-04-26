#!/usr/bin/env node
import { resolve } from 'path';
import {
  ConsoleLogger,
  PipelineContext,
  PipelineError,
  PipelineOrchestrator,
} from './automation/core/pipeline.mjs';
import { buildWorkflowSteps } from './automation/steps/workflow-steps.mjs';

function parseArgs(argv) {
  const args = { mode: 'full', dryRun: false, input: '' };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--dry-run') args.dryRun = true;
    else if (token.startsWith('--mode=')) args.mode = token.split('=')[1];
    else if (token === '--mode') args.mode = argv[i + 1];
    else if (token.startsWith('--input=')) args.input = token.slice('--input='.length);
    else if (token === '--input') args.input = argv[i + 1];
  }

  return args;
}

async function main() {
  const logger = new ConsoleLogger();
  const { mode, dryRun, input } = parseArgs(process.argv.slice(2));

  if (!['full', 'audit', 'apply'].includes(mode)) {
    throw new PipelineError('invalid mode. use one of: full, audit, apply');
  }

  if (mode !== 'audit' && !input) {
    throw new PipelineError('missing --input (job URL or file path).');
  }

  const context = new PipelineContext({
    rootDir: resolve(new URL('.', import.meta.url).pathname),
    mode,
    dryRun,
    input,
    logger,
  });

  const orchestrator = new PipelineOrchestrator(buildWorkflowSteps(mode), logger);
  await orchestrator.run(context);
}

main().catch((error) => {
  if (error instanceof PipelineError) {
    console.error(`\n❌ PipelineError: ${error.message}`);
    if (error.metadata && Object.keys(error.metadata).length) {
      console.error(JSON.stringify(error.metadata, null, 2));
    }
    process.exit(2);
  }

  console.error('\n❌ Unexpected error');
  console.error(error);
  process.exit(1);
});
