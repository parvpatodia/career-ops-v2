/**
 * Local control panel: queue review, batch approval, flagged questions,
 * receipts. Views over the event log; the ONLY write is the approval
 * artifact (data/approvals.json) that the apply orchestrator requires
 * before it may submit anything (batch consent, AGENTS.md override (a)).
 *
 * WHY 127.0.0.1 hard-bound: this serves personal data; it must never be
 * reachable from the network.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { EventStore } from '../store/EventStore.js';
import type { Application } from '../types.js';

export interface DashboardOptions {
  eventsPath: string;
  approvalsPath: string;
  receiptsDir: string;
}

export interface ApprovalBatch {
  ids: string[];
  approvedAt: string;
}

const MS_PER_DAY = 86_400_000;

export function createDashboardServer(opts: DashboardOptions): http.Server {
  const store = new EventStore(opts.eventsPath);

  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    try {
      if (req.method === 'GET' && url.pathname === '/') {
        return sendHtml(res, PAGE);
      }
      if (req.method === 'GET' && url.pathname === '/api/queue') {
        return sendJson(res, 200, queueView(store));
      }
      if (req.method === 'GET' && url.pathname === '/api/flags') {
        return sendJson(res, 200, flagsView(store));
      }
      if (req.method === 'GET' && url.pathname === '/api/receipts') {
        return sendJson(res, 200, receiptsView(opts.receiptsDir));
      }
      if (req.method === 'GET' && url.pathname === '/api/approvals') {
        return sendJson(res, 200, readApprovals(opts.approvalsPath));
      }
      if (req.method === 'POST' && url.pathname === '/api/approve') {
        return void readBody(req, (body) => {
          const requested = (JSON.parse(body) as { ids?: unknown }).ids;
          if (!Array.isArray(requested) || !requested.every((i) => typeof i === 'string')) {
            return sendJson(res, 400, { error: 'ids must be a string array' });
          }
          // Only ids that are actually Ready can be approved; everything
          // else is reported back rather than silently dropped.
          const ready = new Set(store.projection().getByStatus('Ready').map((a) => a.id));
          const accepted = requested.filter((id) => ready.has(id));
          const rejected = requested.filter((id) => !ready.has(id));
          if (accepted.length > 0) appendApproval(opts.approvalsPath, accepted);
          return sendJson(res, 200, { approved: accepted, rejected });
        });
      }
      sendJson(res, 404, { error: 'not found' });
    } catch (err) {
      sendJson(res, 500, { error: (err as Error).message });
    }
  });
}

function queueView(store: EventStore) {
  const now = Date.now();
  const byStatus = (s: Application['status']) => store.projection().getByStatus(s);
  const proj = store.projection();
  const row = (a: Application) => ({
    id: a.id,
    company: a.company,
    role: a.role,
    score: a.score,
    status: a.status,
    url: a.url,
    ageDays: Number.isNaN(Date.parse(a.date)) ? null : Math.floor((now - Date.parse(a.date)) / MS_PER_DAY),
  });
  return {
    ready: byStatus('Ready').map(row),
    applied: byStatus('Applied').map(row),
    counts: proj.counts(),
  };
}

function flagsView(store: EventStore) {
  const flags: Array<{ appId: string; ts: string; reasons: unknown }> = [];
  for (const e of store.readAll().events) {
    if (e.type === 'abstained' || e.type === 'answer_flagged') {
      flags.push({ appId: e.appId, ts: e.ts, reasons: e.payload.reasons ?? e.payload });
    }
  }
  return flags.slice(-50).reverse();
}

function receiptsView(dir: string) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse()
    .slice(0, 50)
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as unknown);
}

function readApprovals(approvalsPath: string): { batches: ApprovalBatch[] } {
  if (!fs.existsSync(approvalsPath)) return { batches: [] };
  try {
    return JSON.parse(fs.readFileSync(approvalsPath, 'utf8')) as { batches: ApprovalBatch[] };
  } catch {
    return { batches: [] };
  }
}

function appendApproval(approvalsPath: string, ids: string[]): void {
  const current = readApprovals(approvalsPath);
  current.batches.push({ ids, approvedAt: new Date().toISOString() });
  fs.mkdirSync(path.dirname(approvalsPath), { recursive: true });
  const tmp = `${approvalsPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(current, null, 2) + '\n');
  fs.renameSync(tmp, approvalsPath);
}

function readBody(req: http.IncomingMessage, cb: (body: string) => void): void {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => cb(body));
}

function sendJson(res: http.ServerResponse, code: number, data: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
}

function sendHtml(res: http.ServerResponse, html: string): void {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>career-ops</title>
<style>
  body { font: 14px/1.5 -apple-system, sans-serif; margin: 2rem auto; max-width: 960px; color: #1a1a1a; }
  h1 { font-size: 1.2rem; } h2 { font-size: 1rem; margin-top: 2rem; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: .35rem .6rem; border-bottom: 1px solid #e3e3e3; }
  .age-fresh { color: #0a7d33; } .age-old { color: #b00020; }
  button { padding: .45rem 1rem; margin-top: .6rem; cursor: pointer; }
  .muted { color: #777; } pre { background: #f6f6f6; padding: .5rem; overflow-x: auto; }
</style></head><body>
<h1>career-ops control panel</h1>
<div id="counts" class="muted"></div>

<h2>Ready queue</h2>
<table id="queue"><thead><tr><th></th><th>#</th><th>Company</th><th>Role</th><th>Score</th><th>Age</th></tr></thead><tbody></tbody></table>
<button id="approve">Approve selected for autopilot</button>
<div id="approve-result" class="muted"></div>

<h2>Flagged questions (answer these in config/answers.yml)</h2>
<div id="flags" class="muted">none</div>

<h2>Receipts (latest)</h2>
<div id="receipts" class="muted">none</div>

<script>
async function load() {
  const q = await (await fetch('/api/queue')).json();
  document.getElementById('counts').textContent = Object.entries(q.counts).map(([k,v]) => k+': '+v).join('  |  ');
  const tbody = document.querySelector('#queue tbody');
  tbody.innerHTML = '';
  for (const a of q.ready) {
    const tr = document.createElement('tr');
    const age = a.ageDays === null ? '?' : a.ageDays + 'd';
    const ageCls = (a.ageDays !== null && a.ageDays <= 14) ? 'age-fresh' : 'age-old';
    tr.innerHTML = '<td><input type="checkbox" value="'+a.id+'"></td><td>'+a.id+'</td>'+
      '<td>'+a.company+'</td><td><a href="'+a.url+'" target="_blank" rel="noopener">'+a.role+'</a></td>'+
      '<td>'+a.score+'</td><td class="'+ageCls+'">'+age+'</td>';
    tbody.appendChild(tr);
  }
  const flags = await (await fetch('/api/flags')).json();
  document.getElementById('flags').innerHTML = flags.length
    ? flags.map(f => '<pre>'+f.appId+' @ '+f.ts+'\\n'+JSON.stringify(f.reasons, null, 1)+'</pre>').join('')
    : 'none';
  const receipts = await (await fetch('/api/receipts')).json();
  document.getElementById('receipts').innerHTML = receipts.length
    ? receipts.map(r => '<pre>'+r.correlationId+'  '+r.company+' - '+r.role+'  fields:'+r.fields.length+(r.atsConfirmation ? '  confirmed:'+r.atsConfirmation : '  UNCONFIRMED')+'</pre>').join('')
    : 'none';
}
document.getElementById('approve').onclick = async () => {
  const ids = [...document.querySelectorAll('#queue input:checked')].map(c => c.value);
  const r = await (await fetch('/api/approve', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ ids }) })).json();
  document.getElementById('approve-result').textContent =
    'approved: ['+r.approved.join(', ')+']' + (r.rejected.length ? '  rejected (not Ready): ['+r.rejected.join(', ')+']' : '');
  load();
};
load();
</script>
</body></html>`;
