/**
 * The single-page command-center UI. Static HTML + vanilla JS that polls
 * /api/feed and renders: freshly-caught roles grouped by DAY then CATEGORY, the
 * Ready queue, and an Applied section. No framework (zero build step, zero deps).
 * The page is a VIEW + launcher: "Apply" opens the real ATS page in a new tab;
 * applying/captcha stays the human step. Pure function returning a string so the
 * server stays routing-only.
 */
export function renderPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>career-ops · be first to apply</title>
<style>
  :root { --bg:#0f1116; --card:#1a1e27; --edge:#2a303c; --fg:#e6e9ef; --dim:#9aa4b2; --accent:#4f8cff; --good:#3fb950; --warn:#d29922; }
  * { box-sizing:border-box; }
  body { margin:0; font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; background:var(--bg); color:var(--fg); }
  header { padding:18px 24px; border-bottom:1px solid var(--edge); display:flex; align-items:baseline; gap:16px; flex-wrap:wrap; position:sticky; top:0; background:var(--bg); z-index:5; }
  header h1 { font-size:18px; margin:0; }
  header .sub { color:var(--dim); font-size:13px; }
  .stats { margin-left:auto; display:flex; gap:18px; }
  .stat b { font-size:18px; } .stat span { color:var(--dim); font-size:12px; display:block; }
  .live { font-size:12px; color:var(--good); } .live.stale { color:var(--warn); }
  main { padding:20px 24px 60px; max-width:1040px; margin:0 auto; }
  h2 { font-size:14px; text-transform:uppercase; letter-spacing:.06em; color:var(--dim); margin:30px 0 6px; }
  .day { font-size:13px; font-weight:600; color:var(--fg); margin:18px 0 8px; padding-bottom:4px; border-bottom:1px solid var(--edge); }
  .cat { font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--dim); margin:12px 0 6px; }
  .card { background:var(--card); border:1px solid var(--edge); border-radius:10px; padding:12px 14px; margin-bottom:8px; display:flex; align-items:center; gap:12px; }
  .card .meta { flex:1; min-width:0; }
  .card .role { font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .card .co { color:var(--dim); font-size:13px; }
  .card .when { color:var(--dim); font-size:12px; white-space:nowrap; }
  .pill { font-size:11px; color:var(--dim); border:1px solid var(--edge); border-radius:999px; padding:2px 8px; white-space:nowrap; }
  .pill.catAIML { color:#c9a2ff; border-color:#4b2f6b; } .pill.catRobotics\\/AV { color:#7fd4ff; border-color:#26506b; }
  .pill.catData { color:#ffcf7f; border-color:#6b5326; } .pill.catSoftware { color:#8fe3a3; border-color:#2c5b38; }
  a.apply { background:var(--accent); color:#fff; text-decoration:none; padding:8px 14px; border-radius:8px; font-size:13px; font-weight:600; white-space:nowrap; }
  a.apply:hover { filter:brightness(1.12); }
  a.open { color:var(--accent); text-decoration:none; font-size:13px; white-space:nowrap; }
  .empty { color:var(--dim); padding:12px 0; }
  .score { font-variant-numeric:tabular-nums; color:var(--good); font-weight:600; min-width:26px; text-align:center; }
  .applied .card { opacity:.72; }
  details summary { cursor:pointer; color:var(--dim); font-size:13px; }
  footer { color:var(--dim); font-size:12px; padding:16px 24px; border-top:1px solid var(--edge); }
</style>
</head>
<body>
<header>
  <h1>career-ops</h1>
  <span class="sub">be first to apply · newest Fall-2026 roles, caught within a minute</span>
  <div class="stats" id="stats"></div>
</header>
<main>
  <h2>Freshly caught — apply now <span class="live" id="live"></span></h2>
  <div id="fresh"><div class="empty">Loading…</div></div>
  <h2>Ready queue (tailored, on-field)</h2>
  <div id="ready"><div class="empty">Loading…</div></div>
  <h2>Applied</h2>
  <div id="applied" class="applied"><div class="empty">Loading…</div></div>
</main>
<footer>Auto-refreshes every 15s · watcher scans 100+ boards every 60s · applying + captcha stay your step · runs locally, your data never leaves this machine</footer>
<script>
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  // Only http(s) URLs become clickable hrefs; anything else (javascript:, data:,
  // a malformed link from a parsed email) collapses to a non-navigating '#'.
  const safeUrl = (u) => { const s = String(u ?? ''); return /^https?:\\/\\//i.test(s) ? esc(s) : '#'; };
  const ago = (iso) => { const m = Math.round((Date.now()-new Date(iso).getTime())/60000); if(isNaN(m))return ''; if(m<1)return 'just now'; if(m<60)return m+'m ago'; const h=Math.round(m/60); if(h<24)return h+'h ago'; return Math.round(h/24)+'d ago'; };
  const dayKey = (iso) => { const d=new Date(iso); return isNaN(d)? 'unknown' : d.toISOString().slice(0,10); };
  const dayLabel = (key) => { if(key==='unknown')return 'Earlier'; const today=new Date().toISOString().slice(0,10); const y=new Date(Date.now()-864e5).toISOString().slice(0,10); if(key===today)return 'Today'; if(key===y)return 'Yesterday'; return new Date(key+'T12:00:00').toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'}); };
  const catClass = (c) => 'cat'+String(c||'Other').replace(/[^A-Za-z\\/]/g,'');
  const CAT_ORDER = ['Robotics/AV','AI/ML','Data','Software','Other'];

  const card = (j) => '<div class="card">'+
    '<span class="pill '+catClass(j.category)+'">'+esc(j.category||j.platform)+'</span>'+
    '<div class="meta"><div class="role">'+esc(j.role)+'</div>'+
      '<div class="co">'+esc(j.company)+(j.location?' · '+esc(j.location):'')+' · '+esc(j.platform)+'</div></div>'+
    '<div class="when">caught '+ago(j.caughtAt)+'</div>'+
    '<a class="apply" href="'+safeUrl(j.applyUrl)+'" target="_blank" rel="noopener">Apply →</a></div>';

  function renderFresh(fresh) {
    if(!fresh.length) return '<div class="empty">No new roles caught yet. The watcher checks every 60 seconds.</div>';
    // group by day (newest first), then by category within the day
    const days = {};
    for(const j of fresh){ const k=dayKey(j.caughtAt); (days[k]=days[k]||[]).push(j); }
    const keys = Object.keys(days).sort((a,b)=> a==='unknown'?1 : b==='unknown'?-1 : b.localeCompare(a));
    let html='';
    for(const k of keys){
      html += '<div class="day">'+esc(dayLabel(k))+' <span style="color:var(--dim);font-weight:400">('+days[k].length+')</span></div>';
      const byCat={};
      for(const j of days[k]){ const c=j.category||'Other'; (byCat[c]=byCat[c]||[]).push(j); }
      const cats = Object.keys(byCat).sort((a,b)=> CAT_ORDER.indexOf(a)-CAT_ORDER.indexOf(b));
      for(const c of cats){
        html += '<div class="cat">'+esc(c)+' · '+byCat[c].length+'</div>';
        html += byCat[c].map(card).join('');
      }
    }
    return html;
  }

  async function refresh() {
    let d; try { d = await (await fetch('/api/feed')).json(); } catch { const l=document.getElementById('live'); if(l){l.textContent='· offline';l.className='live stale';} return; }
    const counts = d.counts || {};
    const fresh = d.fresh || [];
    document.getElementById('stats').innerHTML =
      [['fresh',fresh.length],['Ready',counts.Ready||0],['Applied',counts.Applied||0]]
      .map(([k,v]) => '<div class="stat"><b>'+v+'</b><span>'+k+'</span></div>').join('');
    const live=document.getElementById('live');
    const newest = fresh[0] && fresh[0].caughtAt;
    live.textContent = newest ? '· newest '+ago(newest) : '';
    live.className = 'live';
    document.getElementById('fresh').innerHTML = renderFresh(fresh);
    const ready = d.ready || [];
    document.getElementById('ready').innerHTML = ready.length ? ready.map(j =>
      '<div class="card"><span class="score">'+esc(j.score)+'</span>'+
      '<div class="meta"><div class="role">'+esc(j.role)+'</div><div class="co">'+esc(j.company)+'</div></div>'+
      '<a class="apply" href="'+safeUrl(j.url)+'" target="_blank" rel="noopener">Open →</a></div>'
    ).join('') : '<div class="empty">Queue is empty. Sourcing runs every 3 hours.</div>';
    const applied = d.applied || [];
    const show = applied.slice(0,8), rest = applied.slice(8);
    const row = (j) => '<div class="card"><span class="pill">✓</span>'+
      '<div class="meta"><div class="role">'+esc(j.role)+'</div><div class="co">'+esc(j.company)+(j.appliedAt?' · applied '+ago(j.appliedAt):'')+'</div></div>'+
      '<a class="open" href="'+safeUrl(j.url)+'" target="_blank" rel="noopener">Open ↗</a></div>';
    document.getElementById('applied').innerHTML = applied.length
      ? show.map(row).join('') + (rest.length ? '<details><summary>'+rest.length+' more applied…</summary>'+rest.map(row).join('')+'</details>' : '')
      : '<div class="empty">Nothing applied yet.</div>';
  }
  refresh(); setInterval(refresh, 15000);
</script>
</body>
</html>`;
}
