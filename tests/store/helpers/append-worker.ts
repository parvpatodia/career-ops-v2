/**
 * Helper for the concurrency test: a separate OS process appending events.
 * Usage: tsx append-worker.ts <eventsFile> <appIdPrefix> <count>
 */

import { EventStore } from '../../../src/store/EventStore.js';

const [file, prefix, countStr] = process.argv.slice(2);
const store = new EventStore(file!);
for (let i = 0; i < Number(countStr); i++) {
  // appIds are 12 hex chars; pad the prefix to a valid-looking id.
  const appId = (prefix! + String(i).padStart(4, '0') + '000000000000').slice(0, 12);
  store.append({ type: 'discovered', appId, payload: { worker: prefix, i } });
}
