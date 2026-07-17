/**
 * scripts/verify-boards.mjs — ONE-TIME discovery tool for board expansion (F1).
 * Curls a big candidate pool of company tokens against the Greenhouse / Lever /
 * Ashby public board APIs and prints only the LIVE ones (HTTP 200 + jobs), with
 * total + intern/junior job counts, so config/*-boards.yml gets only real tokens.
 * Read-only. Concurrency-capped + timed-out so it is polite to the APIs.
 *
 * Usage: node scripts/verify-boards.mjs [gh|lever|ashby|all]
 */

// Candidate tokens. A token that is wrong/dead for an ATS is silently dropped by
// the live check, so over-inclusion is fine — this is a discovery net.
const CANDIDATES = {
  gh: [
    // AI / ML / LLM
    'anthropic','openai','scaleai','snorkelai','huggingface','cohere','adept','character','runwayml','stabilityai',
    'elevenlabs','deepgram','assemblyai','pinecone','weaviate','wandb','weightsandbiases','cerebras','groq','sambanova',
    'togetherai','fireworks','anyscale','octoml','contextualai','glean','imbue','magic','poolside','anysphere',
    'codeium','tabnine','speechify','writer','jasper','typeface','tome','harvey','hippocraticai','abridge',
    'cresta','moveworks','tektonlabs','datologyai','perplexityai','mistralai','xai',
    // Robotics / AV / drones / defense-adjacent (non-clearance)
    'waymo','cruise','nuro','aurora','motional','wayve','figure','1x','agilityrobotics','skydio',
    'appliedintuition','saronic','physicalintelligence','bostondynamics','covariant','dexterity','ambirobotics','standardbots','pathrobotics','bearrobotics',
    'chefrobotics','machinalabs','geckorobotics','collaborativerobotics','zipline','flyzipline','astranis','verkada','samsara','tesla',
    // Product / infra / fintech SWE
    'databricks','stripe','coinbase','reddit','discord','figma','instacart','robinhood','gitlab','brex',
    'airbnb','doordash','lyft','pinterest','snap','dropbox','box','twilio','datadog','elastic',
    'mongodb','confluent','hashicorp','gusto','affirm','chime','sofi','nerdwallet','creditkarma','betterment',
    'wealthfront','carta','mercury','deel','rippling','airtable','asana','monday','miro','canva',
    'grammarly','duolingo','roblox','unity','niantic','snowflake','fivetran','airbyte','starburst','dremio',
    'materialize','clickhouse','cockroachlabs','planetscale','supabase','neon','temporaltechnologies','crowdstrike','sentinelone','wiz',
    'snyk','okta','cloudflare','fastly','tailscale','tempus','recursion','benchling','smartsheet','workato',
    'alarmdotcom','pingidentity','underdogfantasy','vestwell','twitch','plaid','ramp','notion','vercel','netlify',
    'retool','postman','sourcegraph','render','fly','replicate','modal','baseten','lambdalabs','coreweave',
    // widen 2026-07-17 (live-verified)
    'gemini','zscaler','amplitude','launchdarkly','singlestore','yugabyte','nextdoor','squarespace','ripple',
  ],
  lever: [
    'plaid','mistral','zoox','palantir','ramp','brex','anduril','nuro','cruise','aurora',
    'wealthsimple','attentive','nubank','hightouch','census','angellist','wellfound','netlify','spotify','showpad',
    'voleon','hudsonrivertrading','jane-street','flexport','faire','gopuff','opendoor','matchgroup','tinder','fetchrewards',
    'lucidmotors','rivian','joby','archer','shield-ai','saronic','applied-intuition','physical-intelligence','1x','skild',
    'huggingface','cohere','perplexity-ai','character-ai','together','fireworks-ai','writer','glean','sierra','harvey',
  ],
  ashby: [
    'gen-digital','skydio','cohere','perplexity','sierra','harvey','baseten','modal','replit','notion',
    'ramp','benchling','openai','anthropic','runway','runwayml','elevenlabs','mistral','deepgram','assemblyai',
    'hebbia','decagon','sierraai','clay','ramp-2','linear','vanta','ashby','watershed','mercor',
    'physical-intelligence','skild-ai','bright-machines','collaborative-robotics','cobot','chef-robotics','dexterity','1x','figure-ai','world-labs',
    'sesame','cartesia','suno','pika','luma-ai','lumalabs','browserbase','langchain','llamaindex','crewai',
    'lovable','cursor','windsurf','codeium','magic-dev','poolside','reflection-ai','thinking-machines','safe-superintelligence','ssi',
    // widen 2026-07-17 (live-verified)
    'abridge','factory','openevidence','distyl','unify','e2b','merge','attio','warp','zed',
  ],
};

const ONFIELD = /(machine learning|\bml\b|\bai\b|artificial intelligence|software engineer|\bswe\b|robotics|perception|computer vision|autonom|data scien|deep learning|research (scientist|engineer)|forward deployed|applied scien)/i;
const JR = /(intern|co-?op|new ?grad|new graduate|university grad|early career|entry[- ]level|graduate (engineer|software))/i;
const onfieldJr = (t) => ONFIELD.test(t || '') && JR.test(t || '');

const TIMEOUT = 9000;
async function get(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT), headers: { 'User-Agent': 'career-ops-verify' } });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

async function checkGh(tok) {
  const d = await get(`https://boards-api.greenhouse.io/v1/boards/${tok}/jobs`);
  const jobs = d?.jobs;
  if (!Array.isArray(jobs) || jobs.length === 0) return null;
  return { ats: 'gh', tok, total: jobs.length, jr: jobs.filter((j) => onfieldJr(j.title)).length };
}
async function checkLever(tok) {
  const d = await get(`https://api.lever.co/v0/postings/${tok}?mode=json`);
  if (!Array.isArray(d) || d.length === 0) return null;
  return { ats: 'lever', tok, total: d.length, jr: d.filter((j) => onfieldJr(j.text)).length };
}
async function checkAshby(tok) {
  const d = await get(`https://api.ashbyhq.com/posting-api/job-board/${tok}`);
  const jobs = d?.jobs;
  if (!Array.isArray(jobs) || jobs.length === 0) return null;
  return { ats: 'ashby', tok, total: jobs.length, jr: jobs.filter((j) => onfieldJr(j.title)).length };
}

/** Run tasks with a concurrency cap. */
async function pool(items, fn, cap = 12) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: cap }, async () => {
    while (i < items.length) {
      const idx = i++;
      const r = await fn(items[idx]);
      if (r) out.push(r);
    }
  }));
  return out;
}

const which = (process.argv[2] || 'all').toLowerCase();
const jobs = [];
if (which === 'gh' || which === 'all') jobs.push(['gh', CANDIDATES.gh, checkGh]);
if (which === 'lever' || which === 'all') jobs.push(['lever', CANDIDATES.lever, checkLever]);
if (which === 'ashby' || which === 'all') jobs.push(['ashby', CANDIDATES.ashby, checkAshby]);

for (const [name, cands, fn] of jobs) {
  const live = await pool([...new Set(cands)], fn);
  live.sort((a, b) => b.jr - a.jr || b.total - a.total);
  console.log(`\n### ${name}: ${live.length}/${new Set(cands).size} live tokens (sorted by on-field junior count)`);
  for (const l of live) console.log(`  ${l.tok.padEnd(26)} total=${String(l.total).padStart(4)}  onfield-jr=${l.jr}`);
  console.log(`  YAML: ${live.map((l) => l.tok).join(' ')}`);
}
