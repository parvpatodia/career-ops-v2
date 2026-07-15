/**
 * scripts/hunt-fresh.mjs — live "keep applying" hunt used by the background
 * auto-apply watch. Scans the configured Greenhouse/Lever/Ashby boards LIVE and
 * prints candidate roles that are ALL of: on-field (ML/AI/SWE/robotics/AV/CV),
 * junior (intern/co-op/new-grad), fresh (posting date <= 14 days, invariant 9),
 * US-based (non-US locations filtered out), and NOT already in
 * data/applications.json. Read-only: it never fills or submits — the caller
 * verifies F-1 eligibility from the JD (skip clearance/ITAR) and applies.
 */
import fs from 'fs';
const GH=['anthropic','scaleai','twitch','astranis','snorkelai','smartsheet','speechify','workato','alarmcom','pingidentity','underdogfantasy','vestwell','wayve','togetherai','flyzipline','databricks','waymo','nuro','figure','samsara','verkada','stripe','coinbase','reddit','discord','figma','instacart','robinhood','gitlab','brex'];
const LEVER=['plaid','mistral','zoox','palantir'];
const ASHBY=['gendigital','skydio','cohere','perplexity','sierra','harvey','baseten','modal','replit','notion','ramp','benchling'];
const ONFIELD=/(machine learning|\bml\b|\bai\b|artificial intelligence|software engineer|\bswe\b|robotics|perception|computer vision|autonom|data scien|deep learning|research (scientist|engineer))/i;
const OFF=/(mechanical|aerospace|radiation|pcb|electrical|chemical|civil|accountant|recruit|\bsales\b|marketing|hardware|manufacturing|supply chain|facilities|bi" |clinical)/i;
const JR=/(intern|co-?op|new ?grad|new graduate|university grad|early career|entry[- ]level|graduate (engineer|software))/i;
const now=Date.now(), DAY=86400000, FRESH=14;
const d=JSON.parse(fs.readFileSync('data/applications.json','utf8'));
const apps=Array.isArray(d)?d:(d.applications||Object.values(d));
const seen=new Set(apps.map(a=>`${a.company}|${a.role}`.toLowerCase()));
const out=[];
const NONUS=/(india|bengaluru|bangalore|hyderabad|pune|gurgaon|noida|\blondon\b|\buk\b|united kingdom|canada|toronto|vancouver|singapore|dublin|ireland|berlin|germany|paris|france|amsterdam|netherlands|tokyo|japan|sydney|australia|tel aviv|israel|s.o paulo|brazil|mexico|poland|spain|portugal)/i;
const usLoc=(loc)=>!NONUS.test(loc||"");
const ok=(co,title)=>ONFIELD.test(title)&&!OFF.test(title)&&JR.test(title)&&!seen.has(`${co}|${title}`.toLowerCase());
async function gh(tok){try{const r=await fetch(`https://boards-api.greenhouse.io/v1/boards/${tok}/jobs`,{signal:AbortSignal.timeout(12000)});if(!r.ok)return;const {jobs=[]}=await r.json();for(const j of jobs){if(!ok(tok,j.title))continue;try{const r2=await fetch(`https://boards-api.greenhouse.io/v1/boards/${tok}/jobs/${j.id}`,{signal:AbortSignal.timeout(10000)});const jj=await r2.json();const age=Math.round((now-Date.parse(jj.first_published||jj.updated_at))/DAY);if(age<=FRESH&&usLoc(j.location?.name))out.push({ats:'gh',co:tok,title:j.title,age,url:j.absolute_url,loc:j.location?.name||'?',id:j.id});}catch{}}}catch{}}
async function lever(tok){try{const r=await fetch(`https://api.lever.co/v0/postings/${tok}?mode=json`,{signal:AbortSignal.timeout(12000)});if(!r.ok)return;const arr=await r.json();for(const j of arr){if(!ok(tok,j.text))continue;const age=Math.round((now-(j.createdAt||0))/DAY);if(age<=FRESH&&usLoc(j.categories?.location))out.push({ats:'lever',co:tok,title:j.text,age,url:j.hostedUrl,loc:j.categories?.location||'?',id:j.id});}}catch{}}
async function ashby(tok){try{const r=await fetch(`https://api.ashbyhq.com/posting-api/job-board/${tok}`,{signal:AbortSignal.timeout(12000)});if(!r.ok)return;const {jobs=[]}=await r.json();for(const j of jobs){if(!ok(tok,j.title))continue;const age=j.publishedDate?Math.round((now-Date.parse(j.publishedDate))/DAY):999;if(age<=FRESH&&usLoc(j.location))out.push({ats:'ashby',co:tok,title:j.title,age,url:j.applyUrl||j.jobUrl,loc:j.location||'?',id:j.id});}}catch{}}
await Promise.all([...GH.map(gh),...LEVER.map(lever),...ASHBY.map(ashby)]);
out.sort((a,b)=>a.age-b.age);
console.log(`fresh on-field junior candidates (<=${FRESH}d, not applied): ${out.length}`);
for(const c of out.slice(0,15))console.log(`  [${c.ats}] ${c.co} | ${c.title.slice(0,44)} | ${c.age}d | ${c.loc.slice(0,22)} | ${c.url}`);
