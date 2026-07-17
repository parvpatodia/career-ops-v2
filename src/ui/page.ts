/**
 * The single-page command-center UI. Static HTML + vanilla JS that polls
 * /api/feed and renders three tabs (Fresh / Ready / Applied) with a filter bar
 * (search, category chips, source, sort) and a client-side dismiss so the Fresh
 * tab reads like a shrinking to-do list. No framework, no build step, no deps.
 *
 * VIEW + launcher only: "Apply" opens the real ATS page in a new tab; applying +
 * captcha stay the human step, and the UI NEVER writes application state (dismiss
 * is a local-only "I've handled this", stored in localStorage — it does not mark
 * anything Applied in the event log). Pure function returning a string so the
 * server stays routing-only.
 *
 * ESCAPING NOTE: this whole document is a JS template literal. Inside the inline
 * <script>, never use `${...}` (build strings with `+`) and DOUBLE-escape any
 * regex slash (`\\/`), or the served script silently breaks. tests/ui/page.test.ts
 * guards this by parsing the emitted <script>.
 */
export function renderPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>career-ops · command center</title>
<style>
  :root {
    --bg:#0c0e13; --panel:#12151d; --card:#161a23; --card-hi:#1c212c; --edge:#262c38;
    --fg:#eef1f6; --dim:#9aa4b2; --dim2:#6b7280; --accent:#4f8cff; --accent-hi:#6ba1ff;
    --good:#3fb950; --warn:#d29922;
    --c-ai:#c9a2ff; --c-robo:#66d4ff; --c-data:#ffcf7f; --c-swe:#7ee6a0; --c-other:#9aa4b2;
  }
  * { box-sizing:border-box; }
  html,body { margin:0; }
  body { font:14.5px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; background:var(--bg); color:var(--fg); }
  a { color:inherit; }

  header { position:sticky; top:0; z-index:20; background:linear-gradient(180deg,var(--bg),rgba(12,14,19,.92)); backdrop-filter:blur(6px); border-bottom:1px solid var(--edge); padding:14px 22px 0; }
  .top { display:flex; align-items:center; gap:14px; flex-wrap:wrap; }
  .brand { font-size:17px; font-weight:700; letter-spacing:-.01em; }
  .brand .sub { color:var(--dim); font-weight:400; font-size:12.5px; margin-left:8px; }
  .live { margin-left:auto; font-size:12.5px; color:var(--good); display:flex; align-items:center; gap:6px; }
  .live .dot { width:7px; height:7px; border-radius:50%; background:var(--good); box-shadow:0 0 0 0 rgba(63,185,80,.6); animation:pulse 2s infinite; }
  .live.stale { color:var(--warn); } .live.stale .dot { background:var(--warn); animation:none; }
  @keyframes pulse { 0%{box-shadow:0 0 0 0 rgba(63,185,80,.5)} 70%{box-shadow:0 0 0 6px rgba(63,185,80,0)} 100%{box-shadow:0 0 0 0 rgba(63,185,80,0)} }

  .tabs { display:flex; gap:4px; margin-top:12px; }
  .tab { appearance:none; background:transparent; border:0; border-bottom:2px solid transparent; color:var(--dim); cursor:pointer; padding:9px 14px 12px; display:flex; align-items:baseline; gap:7px; font:inherit; border-radius:6px 6px 0 0; }
  .tab:hover { color:var(--fg); background:var(--panel); }
  .tab.active { color:var(--fg); border-bottom-color:var(--accent); }
  .tab b { font-size:17px; font-variant-numeric:tabular-nums; }
  .tab span { font-size:12.5px; text-transform:uppercase; letter-spacing:.05em; }

  .controls { position:sticky; top:96px; z-index:15; background:var(--bg); border-bottom:1px solid var(--edge); padding:12px 22px; display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
  .controls.hide { display:none; }
  #search { flex:1 1 240px; min-width:180px; background:var(--panel); border:1px solid var(--edge); color:var(--fg); border-radius:9px; padding:9px 12px; font:inherit; }
  #search::placeholder { color:var(--dim2); }
  #search:focus { outline:none; border-color:var(--accent); }
  .chips { display:flex; gap:6px; flex-wrap:wrap; }
  .chip { appearance:none; cursor:pointer; font:inherit; font-size:12.5px; background:var(--panel); border:1px solid var(--edge); color:var(--dim); border-radius:999px; padding:6px 11px; display:inline-flex; align-items:center; gap:6px; }
  .chip:hover { color:var(--fg); }
  .chip.active { color:#fff; background:var(--accent); border-color:var(--accent); }
  .chip .n { font-variant-numeric:tabular-nums; opacity:.7; font-size:11.5px; }
  #sort { background:var(--panel); border:1px solid var(--edge); color:var(--fg); border-radius:9px; padding:8px 10px; font:inherit; font-size:13px; }
  .showhidden { font-size:12.5px; color:var(--dim); display:inline-flex; align-items:center; gap:6px; cursor:pointer; }

  main { padding:18px 22px 70px; max-width:1080px; margin:0 auto; }
  .day { font-size:13px; font-weight:700; color:var(--fg); margin:20px 0 4px; }
  .day .n { color:var(--dim); font-weight:400; }
  .cat { font-size:11px; text-transform:uppercase; letter-spacing:.07em; color:var(--dim); margin:14px 0 7px; display:flex; align-items:center; gap:7px; }
  .cat .swatch { width:9px; height:9px; border-radius:3px; }

  .card { position:relative; background:var(--card); border:1px solid var(--edge); border-left-width:3px; border-radius:11px; padding:13px 15px; margin-bottom:9px; display:flex; align-items:center; gap:14px; transition:background .12s,transform .12s; }
  .card:hover { background:var(--card-hi); }
  .card .meta { flex:1; min-width:0; }
  .card .role { font-weight:600; font-size:15px; display:flex; align-items:center; gap:9px; }
  .card .role .txt { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .badge-new { flex:none; font-size:10px; font-weight:700; letter-spacing:.06em; color:#0c0e13; background:var(--good); border-radius:5px; padding:2px 6px; }
  .card .co { color:var(--dim); font-size:13px; margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .card .co .src { color:var(--dim2); }
  .when { color:var(--dim); font-size:12px; white-space:nowrap; text-align:right; }
  .score { font-variant-numeric:tabular-nums; color:var(--good); font-weight:700; font-size:15px; min-width:30px; text-align:center; }
  .actions { display:flex; align-items:center; gap:8px; flex:none; }
  a.apply { background:var(--accent); color:#fff; text-decoration:none; padding:8px 15px; border-radius:8px; font-size:13px; font-weight:600; white-space:nowrap; }
  a.apply:hover { background:var(--accent-hi); }
  a.open { color:var(--accent); text-decoration:none; font-size:13px; white-space:nowrap; padding:8px 6px; }
  a.open:hover { text-decoration:underline; }
  .dismiss { appearance:none; cursor:pointer; background:transparent; border:1px solid var(--edge); color:var(--dim2); width:30px; height:30px; border-radius:8px; font-size:15px; line-height:1; }
  .dismiss:hover { color:var(--fg); border-color:var(--dim); }
  .applied-row { opacity:.72; }
  .empty { color:var(--dim); background:var(--panel); border:1px dashed var(--edge); border-radius:11px; padding:26px; text-align:center; }
  .empty .big { font-size:15px; color:var(--fg); margin-bottom:4px; }
  .hint { color:var(--dim2); font-size:12.5px; margin:6px 0 0; }
  footer { position:fixed; bottom:0; left:0; right:0; color:var(--dim2); font-size:11.5px; padding:8px 22px; background:rgba(12,14,19,.92); backdrop-filter:blur(6px); border-top:1px solid var(--edge); text-align:center; }
</style>
</head>
<body>
<header>
  <div class="top">
    <div class="brand">career-ops<span class="sub">be first to apply · Fall 2026</span></div>
    <div class="live" id="live"></div>
  </div>
  <nav class="tabs" id="tabs">
    <button class="tab active" data-tab="fresh"><b id="c-fresh">0</b><span>Fresh</span></button>
    <button class="tab" data-tab="ready"><b id="c-ready">0</b><span>Ready</span></button>
    <button class="tab" data-tab="applied"><b id="c-applied">0</b><span>Applied</span></button>
  </nav>
</header>

<div class="controls" id="controls">
  <input id="search" type="search" placeholder="Search role or company…  ( / )" autocomplete="off"/>
  <div class="chips" id="catchips"></div>
  <div class="chips" id="srcchips">
    <button class="chip active" data-src="all">All</button>
    <button class="chip" data-src="board">Boards</button>
    <button class="chip" data-src="email">Email</button>
  </div>
  <select id="sort" title="Sort">
    <option value="new">Newest first</option>
    <option value="company">Company A–Z</option>
  </select>
  <label class="showhidden"><input type="checkbox" id="showhidden"/> show dismissed</label>
</div>

<main id="content"><div class="empty"><div class="big">Loading…</div></div></main>
<footer>Boards scanned every 60s · this page refreshes every 15s · Apply opens the real posting (captcha + submit stay yours) · runs locally, your data never leaves this machine</footer>

<script>
  var CATS = { 'Robotics/AV':'var(--c-robo)', 'AI/ML':'var(--c-ai)', 'Data':'var(--c-data)', 'Software':'var(--c-swe)', 'Other':'var(--c-other)' };
  var CAT_ORDER = ['Robotics/AV','AI/ML','Data','Software','Other'];
  var HIDDEN_KEY = 'careerops-hidden-v1';

  var esc = function(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); };
  var safeUrl = function(u){ var s = String(u == null ? '' : u); return /^https?:\\/\\//i.test(s) ? esc(s) : '#'; };
  var minsAgo = function(iso){ var m = Math.round((Date.now() - new Date(iso).getTime())/60000); return isNaN(m) ? null : m; };
  var ago = function(iso){ var m = minsAgo(iso); if(m == null) return ''; if(m < 1) return 'just now'; if(m < 60) return m+'m ago'; var h = Math.round(m/60); if(h < 24) return h+'h ago'; return Math.round(h/24)+'d ago'; };
  var dayKey = function(iso){ var d = new Date(iso); return isNaN(d) ? 'unknown' : d.toISOString().slice(0,10); };
  var dayLabel = function(k){ if(k === 'unknown') return 'Earlier'; var today = new Date().toISOString().slice(0,10); var y = new Date(Date.now()-864e5).toISOString().slice(0,10); if(k === today) return 'Today'; if(k === y) return 'Yesterday'; return new Date(k+'T12:00:00').toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'}); };
  var srcOf = function(p){ return String(p || '').indexOf('email:') === 0 ? 'email' : 'board'; };

  var state = { tab:'fresh', cat:'all', src:'all', sort:'new', q:'' };
  var data = { fresh:[], ready:[], applied:[], counts:{} };
  var hidden, showHidden = false;
  try { hidden = new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]')); } catch(e){ hidden = new Set(); }
  var saveHidden = function(){ try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(Array.from(hidden))); } catch(e){} };

  var el = function(id){ return document.getElementById(id); };

  function visibleFresh(){
    var q = state.q.trim().toLowerCase();
    var arr = data.fresh.filter(function(j){
      if(!showHidden && hidden.has(j.id)) return false;
      if(state.cat !== 'all' && (j.category || 'Other') !== state.cat) return false;
      if(state.src !== 'all' && srcOf(j.platform) !== state.src) return false;
      if(q && (String(j.role||'')+' '+String(j.company||'')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    if(state.sort === 'company') arr = arr.slice().sort(function(a,b){ return String(a.company||'').localeCompare(String(b.company||'')); });
    else arr = arr.slice().sort(function(a,b){ return String(b.caughtAt||'').localeCompare(String(a.caughtAt||'')); });
    return arr;
  }

  function catPill(cat){ var c = CATS[cat] || 'var(--c-other)'; return '<span class="cat" style="margin:0"><span class="swatch" style="background:'+c+'"></span></span>'; }

  function freshCard(j){
    var color = CATS[j.category] || 'var(--c-other)';
    var m = minsAgo(j.caughtAt);
    var isNew = m != null && m < 15;
    var loc = j.location ? ' · '+esc(j.location) : '';
    return '<div class="card" style="border-left-color:'+color+'">'+
      '<div class="meta">'+
        '<div class="role">'+(isNew ? '<span class="badge-new">NEW</span>' : '')+'<span class="txt">'+esc(j.role)+'</span></div>'+
        '<div class="co">'+esc(j.company)+loc+' <span class="src">· '+esc(j.platform)+'</span></div>'+
      '</div>'+
      '<div class="when">'+esc(ago(j.caughtAt))+'</div>'+
      '<div class="actions">'+
        '<a class="apply" data-id="'+esc(j.id)+'" href="'+safeUrl(j.applyUrl)+'" target="_blank" rel="noopener">Apply →</a>'+
        '<button class="dismiss" data-id="'+esc(j.id)+'" title="Dismiss (I have handled this)">✕</button>'+
      '</div>'+
    '</div>';
  }

  function renderFresh(){
    var list = visibleFresh();
    if(!list.length){
      var hiddenN = data.fresh.filter(function(j){ return hidden.has(j.id); }).length;
      return '<div class="empty"><div class="big">Nothing to act on right now</div>'+
        (state.q || state.cat!=='all' || state.src!=='all' ? 'No roles match your filters.' : 'The watcher scans 100+ boards every 60s. New Fall-2026 roles land here the minute they post.')+
        (hiddenN && !showHidden ? '<div class="hint">'+hiddenN+' dismissed — tick "show dismissed" to review.</div>' : '')+'</div>';
    }
    var byDay = {}; list.forEach(function(j){ var k = dayKey(j.caughtAt); (byDay[k] = byDay[k] || []).push(j); });
    var days = Object.keys(byDay).sort(function(a,b){ return a==='unknown'?1 : b==='unknown'?-1 : b.localeCompare(a); });
    var html = '';
    days.forEach(function(k){
      html += '<div class="day">'+esc(dayLabel(k))+' <span class="n">('+byDay[k].length+')</span></div>';
      var byCat = {}; byDay[k].forEach(function(j){ var c = j.category || 'Other'; (byCat[c] = byCat[c] || []).push(j); });
      Object.keys(byCat).sort(function(a,b){ return CAT_ORDER.indexOf(a)-CAT_ORDER.indexOf(b); }).forEach(function(c){
        var color = CATS[c] || 'var(--c-other)';
        html += '<div class="cat"><span class="swatch" style="background:'+color+'"></span>'+esc(c)+' · '+byCat[c].length+'</div>';
        html += byCat[c].map(freshCard).join('');
      });
    });
    return html;
  }

  function renderReady(){
    var r = data.ready || [];
    if(!r.length) return '<div class="empty"><div class="big">Queue is empty</div>Sourcing tailors + queues on-field roles every few hours. Tailored roles ready to submit show here.</div>';
    return r.map(function(j){
      return '<div class="card" style="border-left-color:var(--accent)">'+
        '<div class="score" title="fit score">'+esc(j.score)+'</div>'+
        '<div class="meta"><div class="role"><span class="txt">'+esc(j.role)+'</span></div><div class="co">'+esc(j.company)+'</div></div>'+
        '<div class="actions"><a class="apply" href="'+safeUrl(j.url)+'" target="_blank" rel="noopener">Open →</a></div>'+
      '</div>';
    }).join('');
  }

  function renderApplied(){
    var a = data.applied || [];
    if(!a.length) return '<div class="empty"><div class="big">Nothing applied yet</div>Roles you submit will be tracked here.</div>';
    return a.map(function(j){
      return '<div class="card applied-row" style="border-left-color:var(--good)">'+
        '<div class="meta"><div class="role"><span class="txt">✓ '+esc(j.role)+'</span></div><div class="co">'+esc(j.company)+(j.appliedAt ? ' · applied '+esc(ago(j.appliedAt)) : '')+'</div></div>'+
        '<div class="actions"><a class="open" href="'+safeUrl(j.url)+'" target="_blank" rel="noopener">Open ↗</a></div>'+
      '</div>';
    }).join('');
  }

  function renderCatChips(){
    var counts = {}; var total = 0;
    data.fresh.forEach(function(j){ if(!showHidden && hidden.has(j.id)) return; var c = j.category || 'Other'; counts[c] = (counts[c]||0)+1; total++; });
    var chips = '<button class="chip'+(state.cat==='all'?' active':'')+'" data-cat="all">All <span class="n">'+total+'</span></button>';
    CAT_ORDER.forEach(function(c){ if(!counts[c]) return; chips += '<button class="chip'+(state.cat===c?' active':'')+'" data-cat="'+esc(c)+'"><span class="swatch" style="width:8px;height:8px;border-radius:2px;background:'+(CATS[c]||'var(--c-other)')+'"></span>'+esc(c)+' <span class="n">'+counts[c]+'</span></button>'; });
    el('catchips').innerHTML = chips;
  }

  function render(){
    el('c-fresh').textContent = data.fresh.filter(function(j){ return !hidden.has(j.id); }).length;
    el('c-ready').textContent = (data.ready||[]).length;
    el('c-applied').textContent = (data.counts && data.counts.Applied) || (data.applied||[]).length;
    // tab active states
    var tabEls = document.querySelectorAll('#tabs .tab');
    for(var i=0;i<tabEls.length;i++){ tabEls[i].classList.toggle('active', tabEls[i].getAttribute('data-tab')===state.tab); }
    el('controls').classList.toggle('hide', state.tab !== 'fresh');
    if(state.tab === 'fresh') renderCatChips();
    var srcEls = document.querySelectorAll('#srcchips .chip');
    for(var s=0;s<srcEls.length;s++){ srcEls[s].classList.toggle('active', srcEls[s].getAttribute('data-src')===state.src); }
    el('content').innerHTML = state.tab === 'fresh' ? renderFresh() : state.tab === 'ready' ? renderReady() : renderApplied();
  }

  function renderLive(){
    var newest = data.fresh[0] && data.fresh[0].caughtAt;
    var m = newest != null ? minsAgo(newest) : null;
    var live = el('live');
    if(m == null){ live.innerHTML = ''; return; }
    live.className = m > 180 ? 'live stale' : 'live';
    live.innerHTML = '<span class="dot"></span>newest role ' + esc(ago(newest));
  }

  function load(){
    fetch('/api/feed').then(function(r){ return r.json(); }).then(function(d){
      data = { fresh:d.fresh||[], ready:d.ready||[], applied:d.applied||[], counts:d.counts||{} };
      renderLive(); render();
    }).catch(function(){ var live = el('live'); live.className = 'live stale'; live.innerHTML = '<span class="dot"></span>offline — retrying'; });
  }

  // events
  el('tabs').addEventListener('click', function(e){ var t = e.target.closest('.tab'); if(!t) return; state.tab = t.getAttribute('data-tab'); render(); });
  el('catchips').addEventListener('click', function(e){ var c = e.target.closest('.chip'); if(!c) return; state.cat = c.getAttribute('data-cat'); render(); });
  el('srcchips').addEventListener('click', function(e){ var c = e.target.closest('.chip'); if(!c) return; state.src = c.getAttribute('data-src'); render(); });
  el('sort').addEventListener('change', function(e){ state.sort = e.target.value; render(); });
  el('search').addEventListener('input', function(e){ state.q = e.target.value; render(); });
  el('showhidden').addEventListener('change', function(e){ showHidden = e.target.checked; render(); });
  el('content').addEventListener('click', function(e){
    var applyEl = e.target.closest('a.apply');
    if(applyEl && applyEl.getAttribute('data-id')){ hidden.add(applyEl.getAttribute('data-id')); saveHidden(); setTimeout(render, 50); return; }
    var dz = e.target.closest('button.dismiss');
    if(dz){ e.preventDefault(); hidden.add(dz.getAttribute('data-id')); saveHidden(); render(); }
  });
  document.addEventListener('keydown', function(e){ if(e.key === '/' && document.activeElement !== el('search')){ e.preventDefault(); el('search').focus(); } });

  load(); setInterval(load, 15000);
</script>
</body>
</html>`;
}
