/**
 * CLI: npm run dashboard -> http://127.0.0.1:4040
 * Localhost only; serves personal data.
 */

import { createDashboardServer } from '../src/dashboard/server.js';

const PORT = Number(process.env.DASHBOARD_PORT ?? 4040);

const server = createDashboardServer({
  eventsPath: 'data/events.jsonl',
  approvalsPath: 'data/approvals.json',
  receiptsDir: 'data/receipts',
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`career-ops control panel: http://127.0.0.1:${PORT}`);
});
