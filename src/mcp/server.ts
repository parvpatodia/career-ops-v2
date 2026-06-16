/**
 * `npm run mcp` — Career-Ops as an MCP server (stdio). Lets any MCP agent
 * (Claude Code, Cursor, Codex, ...) drive the verified pipeline, adopting the
 * competitor's distribution model. The differentiators they lack are built into
 * the tools: verify-or-abstain on every fill, no-fabrication tailoring, and
 * inbox confirmation tracking.
 *
 * Connect (e.g. Claude Code .mcp.json):
 *   { "mcpServers": { "career-ops": { "command": "npm", "args": ["run","mcp"],
 *     "cwd": "/Users/parvpatodia/career-ops-v2" } } }
 *
 * The thin layer: construct real deps + register each CareerOpsTools handler.
 * All logic lives in (tested) tools.ts; this file is wiring only.
 */

import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { CareerOpsTools } from './tools.js';
import type { ToolContext } from './tools.js';
import { ApplicationStore } from '../tracker/ApplicationStore.js';
import { AnswerInbox } from '../applier/AnswerInbox.js';
import { fetchRecentHeaders, accountsFromEnv } from '../inbox/ImapClient.js';
import { Tailor } from '../tailor/Tailor.js';

// ── Build capabilities, guarding the ones that need profile/cv/creds ─────────
function buildContext(): ToolContext {
  const ctx: ToolContext = {
    store: new ApplicationStore(),
    inbox: new AnswerInbox(),
    emailFetch: (acct) => fetchRecentHeaders(acct, 30),
    accounts: accountsFromEnv(),
  };
  // Tailoring needs config/profile.yml + cv/; only offer it if it constructs.
  try {
    const tailor = new Tailor();
    ctx.tailor = { tailorResume: (job, variant) => tailor.tailorResume(job, variant) };
  } catch {
    /* profile/cv absent: tailor_resume returns a clear reason */
  }
  return ctx;
}

function jsonResult(value: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

async function main(): Promise<void> {
  const tools = new CareerOpsTools(buildContext());
  const server = new McpServer({ name: 'career-ops', version: '2.0.0' });

  server.tool(
    'list_applications',
    'List tracked applications, optionally filtered by status (Ready, Applied, Interview, Rejected, ...).',
    { status: z.string().optional() },
    async (args) => jsonResult(tools.listApplications(args))
  );

  server.tool(
    'application_stats',
    'Counts of applications by status (queue overview).',
    {},
    async () => jsonResult(tools.applicationStats())
  );

  server.tool(
    'pending_answers',
    'Unknown application questions awaiting a human answer (the self-improving loop).',
    {},
    async () => jsonResult(tools.pendingAnswers())
  );

  server.tool(
    'resolve_answer',
    'Teach the system a human-approved answer to a previously-unknown question; it is reused forever.',
    { question: z.string(), answer: z.string() },
    async (args) => jsonResult(tools.resolveAnswer(args))
  );

  server.tool(
    'reconcile_inbox',
    'Read Gmail/Outlook (read-only) and reconcile application status from confirmation/rejection/interview emails. The confirmation email is ground-truth proof an application was received.',
    { days: z.number().int().positive().optional() },
    async (args) => jsonResult(await tools.reconcileInbox(args))
  );

  server.tool(
    'tailor_resume',
    'Tailor the resume for a queued application under verify-or-abstain. Returns injected vs SKIPPED keywords (a keyword with no honest home is skipped, never fabricated).',
    { applicationId: z.string() },
    async (args) => jsonResult(tools.tailorResume(args))
  );

  server.tool(
    'fill_and_verify',
    'Fill a queued application and INDEPENDENTLY read every field back to verify it; STOP before submit. Never claims a submission. You review and submit yourself.',
    { applicationId: z.string() },
    async (args) => jsonResult(await tools.fillAndVerify(args))
  );

  await server.connect(new StdioServerTransport());
}

main().catch((err) => { console.error(err); process.exit(1); });
