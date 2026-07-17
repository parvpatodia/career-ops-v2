#!/usr/bin/env osascript -l JavaScript
/*
 * Mac-local Apple Mail reader (JXA). Reads the newest inbox messages' raw source
 * from the running Mail.app and prints JSON: {count, scanned, messages:[{from,
 * subject, received, source}]}. NO OAuth / Graph / tenant admin-consent — it
 * reads mail already synced to Apple Mail (which the user logged into once,
 * interactively). This is the Mac equivalent of the Windows win32COM approach
 * and is why it works where the Outlook Graph MCP was blocked by Northeastern.
 *
 * A Node wrapper (src/inbox/macMail.ts) QP/UTF-8-decodes `source` and feeds it
 * to parseJobEmails. Requires Mail.app OPEN + a one-time macOS Automation grant.
 *
 * WHY newest-N by index (not `whose`): on a 47k-message unified inbox, Mail's
 * AppleScript `whose` date filter times out (minutes). Indexed access is
 * newest-first and each source fetch is ~0.5s, so a bounded window is fast.
 * Args: argv[0] = MAX messages (default 40), argv[1] = DAYS window (default 4).
 */
function run(argv) {
  argv = argv || [];
  const max = parseInt(argv[0], 10) || 40;
  const days = parseInt(argv[1], 10) || 4;
  const Mail = Application('Mail');
  let msgs;
  try { msgs = Mail.inbox.messages; } catch (e) { return JSON.stringify({ error: 'INBOX_UNAVAILABLE', detail: String(e) }); }
  let total;
  try { total = msgs.length; } catch (e) { return JSON.stringify({ error: 'COUNT_FAILED', detail: String(e) }); }

  const cutoff = Date.now() - days * 86400000;
  const lim = Math.min(total, max);
  const out = [];
  for (let i = 0; i < lim; i++) {
    let m;
    try { m = msgs[i]; } catch (e) { continue; }
    let rt = 0;
    try { rt = m.dateReceived().getTime(); } catch (e) {}
    if (rt && rt < cutoff) continue; // ordering isn't guaranteed strict -> skip, don't break
    let from = '', subject = '', source = '';
    try { from = m.sender(); } catch (e) {}
    try { subject = m.subject(); } catch (e) {}
    try { source = m.source(); } catch (e) {}
    if (source.length > 250000) source = source.slice(0, 250000);
    out.push({ from: from, subject: subject, received: rt ? new Date(rt).toISOString() : '', source: source });
  }
  return JSON.stringify({ count: out.length, scanned: lim, messages: out });
}
