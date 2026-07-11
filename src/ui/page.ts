/**
 * The single-page UI shell. Static HTML + a little vanilla JS that polls
 * /api/feed and renders the fresh-roles hot-list and the queue. No framework
 * (code hygiene: zero build step, zero deps). The page is a VIEW + launcher:
 * "Apply" opens the real ATS page in a new tab; applying/captcha stays the human
 * step. Kept as a pure function returning a string so the server stays routing-only.
 */
export function renderPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>career-ops · be first to apply</title>
<style>
  :root { --bg:#0f1116; --card:#1a1e27; --edge:#2a303c; --fg:#e6e9ef; --dim:#9aa4b2; --accent:#4f8cff; --good:#3fb950; }
  * { box-sizing:border-box; }
  body { margin:0; font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; background:var(--bg); color:var(--fg); }
  header { padding:20px 24px; border-bottom:1px solid var(--edge); display:flex; align-items:baseline; gap:16px; flex-wrap:wrap; }
  header h1 { font-size:18px; margin:0; }
  header .sub { color:var(--dim); font-size:13px; }
  .stats { margin-left:auto; display:flex; gap:18px; }
  .stat b { font-size:18px; } .stat span { color:var(--dim); font-size:12px; display:block; }
  main { padding:24px; max-width:1000px; margin:0 auto; }
  h2 { font-size:14px; text-transform:uppercase; letter-spacing:.06em; color:var(--dim); margin:28px 0 12px; }
  .card { background:var(--card); border:1px solid var(--edge); border-radius:10px; padding:14px 16px; margin-bottom:10px; display:flex; align-items:center; gap:14px; }
  .card .meta { flex:1; min-width:0; }
  .card .role { font-weight:600; }
  .card .co { color:var(--dim); font-size:13px; }
  .card .when { color:var(--dim); font-size:12px; white-space:nowrap; }
  .pill { font-size:11px; color:var(--dim); border:1px solid var(--edge); border-radius:999px; padding:2px 8px; }
  a.apply { background:var(--accent); color:#fff; text-decoration:none; padding:8px 14px; border-radius:8px; font-size:13px; font-weight:600; white-space:nowrap; }
  a.apply:hover { filter:brightness(1.1); }
  .empty { color:var(--dim); padding:16px 0; }
  .score { font-variant-numeric:tabular-nums; color:var(--good); font-weight:600; }
  footer { color:var(--dim); font-size:12px; padding:16px 24px; border-top:1px solid var(--edge); }
</style>
</head>
<body>
<header>
  <h1>career-ops</h1>
  <span class="sub">be first to apply · fresh roles the watcher caught</span>
  <div class="stats" id="stats"></div>
</header>
<main>
  <h2>Freshly caught — apply now</h2>
  <div id="fresh"><div class="empty">Loading…</div></div>
  <h2>Ready queue (tailored, on-field)</h2>
  <div id="ready"><div class="empty">Loading…</div></div>
</main>
<footer>Auto-refreshes every 30s · applying + captcha stay your step (open the role, then <code>npm run run -- --auto</code>) · runs locally, your data never leaves this machine</footer>
<script>
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const ago = (iso) => { const m = Math.round((Date.now()-new Date(iso).getTime())/60000); if(isNaN(m))return ''; if(m<1)return 'just now'; if(m<60)return m+'m ago'; const h=Math.round(m/60); if(h<24)return h+'h ago'; return Math.round(h/24)+'d ago'; };
  async function refresh() {
    let d; try { d = await (await fetch('/api/feed')).json(); } catch { return; }
    const counts = d.counts || {};
    document.getElementById('stats').innerHTML =
      ['Ready','Applied','Closed'].map(k => '<div class="stat"><b>'+(counts[k]||0)+'</b><span>'+k+'</span></div>').join('');
    const fresh = d.fresh || [];
    document.getElementById('fresh').innerHTML = fresh.length ? fresh.map(j =>
      '<div class="card"><span class="pill">'+esc(j.platform)+'</span>'+
      '<div class="meta"><div class="role">'+esc(j.role)+'</div><div class="co">'+esc(j.company)+'</div></div>'+
      '<div class="when">caught '+ago(j.caughtAt)+'</div>'+
      '<a class="apply" href="'+esc(j.applyUrl)+'" target="_blank" rel="noopener">Apply →</a></div>'
    ).join('') : '<div class="empty">No new roles caught yet. The watcher checks every 2 minutes.</div>';
    const ready = d.ready || [];
    document.getElementById('ready').innerHTML = ready.length ? ready.map(j =>
      '<div class="card"><span class="score">'+esc(j.score)+'</span>'+
      '<div class="meta"><div class="role">'+esc(j.role)+'</div><div class="co">'+esc(j.company)+'</div></div>'+
      '<a class="apply" href="'+esc(j.url)+'" target="_blank" rel="noopener">Open →</a></div>'
    ).join('') : '<div class="empty">Queue is empty. Sourcing runs every 3 hours.</div>';
  }
  refresh(); setInterval(refresh, 30000);
</script>
</body>
</html>`;
}
