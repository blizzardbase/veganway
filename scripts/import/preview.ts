// records.json to preview.html, one self contained page for the group admin to review the import.
// Usage: npx tsx scripts/import/preview.ts
// No external requests: inline styles and script, a strict CSP, the system font. Each listing has a
// checkbox; "Download decisions" saves { exclude: [ids] } for the unticked ones, which
// server/cli/import-history.ts honours. Shows mention counts only, never message text or names.
import { readFileSync, writeFileSync } from 'node:fs';
import type { ImportRecord } from '../../server/cli/import-history.js';
import { VEGAN_STATUS_LABEL } from '../../shared/types/listings.js';
import type { RedactStats } from './redact.js';
import { EXTRACTION_JSON, type Preview, type Spec } from './records.js';
import { PREVIEW_HTML, RECORDS_JSON, STATS_JSON, ensureWorkDir, isMain } from './paths.js';

const KIND_TITLE: Record<ImportRecord['kind'], string> = { place: 'Places', product: 'Products', service: 'Services' };

const DROP_LABEL: Record<string, string> = {
  no_sender: 'No sender',
  joined_left_added: 'Joined, left or added',
  subject_or_settings: 'Group subject or settings',
  security_code: 'Security code changed',
  encryption_notice: 'Encryption notice',
  deleted: 'Deleted messages',
  media_omitted: 'Media omitted',
  null: 'Empty system lines',
  empty: 'Empty messages',
  contact_guard: 'Removed by the contact check',
};

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function month(m: string): string {
  return new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function countBy<T>(xs: T[], key: (x: T) => string): [string, number][] {
  const c = new Map<string, number>();
  for (const x of xs) c.set(key(x), (c.get(key(x)) ?? 0) + 1);
  return [...c].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

const chips = (pairs: [string, number][]) =>
  pairs.map(([k, n]) => `<span class="chip">${esc(k)} <b>${n}</b></span>`).join('');

function item(r: ImportRecord): string {
  const p = r.preview as Preview;
  const where = r.kind === 'product' ? (r.stores.length ? `Sold at ${r.stores.join(', ')}` : 'No store stated') : (r.area ?? 'Area unknown');
  const meta = [r.category || 'No category', VEGAN_STATUS_LABEL[r.vegan_status], where].map(esc).join(' · ');
  const months = p.months.map(month).join(', ');
  return `<li class="item${p.flag ? ' flagged' : ''}">
  <label><input type="checkbox" data-id="${r.id}"${p.flag ? '' : ' checked'}>
  <span class="body"><span class="name">${esc(r.name)}</span>
  <span class="meta">${meta}</span>
  <span class="summary">${esc(r.summary)}</span>
  ${r.tags.length ? `<span class="tags">${r.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</span>` : ''}
  <span class="src">Mentioned in ${p.messages} message${p.messages === 1 ? '' : 's'} · ${esc(months)}</span>
  ${p.flag ? `<span class="flag">${esc(p.flag)}</span>` : ''}</span></label></li>`;
}

export function renderPreview(records: ImportRecord[], stats: RedactStats, dropped: Spec['dropped'], generated: string): string {
  const kinds = (['place', 'product', 'service'] as const).filter((k) => records.some((r) => r.kind === k));
  const sections = kinds.map((k) => {
    const rs = records.filter((r) => r.kind === k);
    const groupKey = (r: ImportRecord) => (k === 'product' ? (r.category || 'No category') : (r.area ?? 'Area unknown'));
    const groups = [...new Set(rs.map(groupKey))].sort((a, b) => (a.endsWith('unknown') ? 1 : b.endsWith('unknown') ? -1 : a.localeCompare(b)));
    return `<section><h2>${KIND_TITLE[k]} <small>${rs.length}</small></h2>
${groups.map((g) => `<h3>${esc(g)}</h3><ul>${rs.filter((r) => groupKey(r) === g).sort((a, b) => a.name.localeCompare(b.name)).map(item).join('\n')}</ul>`).join('\n')}
</section>`;
  }).join('\n');
  const droppedByReason = countBy(dropped, (d) => d.reason);
  const droppedTotal = Object.values(stats.dropped).reduce((a, b) => a + (b ?? 0), 0);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer">
<title>VeganWay import preview</title>
<style>
:root{--bg:#fafaf7;--surface:#fff;--surface2:#f2f4ef;--ink:#15201a;--muted:#5b665f;--line:#e3e7e0;--brand:#0f6b4a;--brand-soft:#e4f2ea;--saffron:#f5a524;--on-saffron:#3b2600;--saffron-soft:#fdeccb}
@media (prefers-color-scheme:dark){:root{--bg:#0e1511;--surface:#151e18;--surface2:#1b261f;--ink:#e8efe9;--muted:#9aa89f;--line:#26332b;--brand:#5fcf98;--brand-soft:#15382a;--saffron:#f7b84b;--on-saffron:#3b2600;--saffron-soft:#38290d}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:860px;margin:0 auto;padding:24px 16px 120px}h1{font-size:28px;margin:0 0 4px}h2{font-size:22px;margin:40px 0 8px}h2 small{color:var(--muted);font-weight:500}
h3{font-size:14px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:24px 0 8px}p.lead{color:var(--muted);margin:0 0 20px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:16px;margin:12px 0}.big{display:flex;gap:24px;flex-wrap:wrap}.big div{min-width:120px}.big b{display:block;font-size:28px;color:var(--brand)}
.chip{display:inline-block;background:var(--surface2);border-radius:999px;padding:2px 10px;margin:3px 4px 3px 0;font-size:14px}
ul{list-style:none;margin:0;padding:0}.item{background:var(--surface);border:1px solid var(--line);border-radius:14px;margin:8px 0}.item label{display:flex;gap:12px;padding:12px 14px;cursor:pointer}
.item input{width:22px;height:22px;accent-color:var(--brand);flex:none;margin-top:2px}.item.flagged{border-color:var(--saffron)}.body{display:flex;flex-direction:column;gap:2px}
.name{font-weight:700;font-size:17px}.meta,.src{color:var(--muted);font-size:14px}.tags{display:flex;gap:6px;flex-wrap:wrap;margin-top:2px}.tag{background:var(--brand-soft);color:var(--brand);border-radius:999px;padding:0 8px;font-size:13px}
.flag{background:var(--saffron-soft);border-radius:8px;padding:2px 8px;font-size:14px;margin-top:4px}.item:has(input:not(:checked)){opacity:.55}
.bar{position:fixed;left:0;right:0;bottom:0;background:var(--surface);border-top:1px solid var(--line);padding:12px 16px;display:flex;gap:12px;align-items:center;justify-content:center}
button{font:inherit;font-weight:700;border:0;border-radius:999px;padding:12px 22px;background:var(--saffron);color:var(--on-saffron);cursor:pointer}#count{color:var(--muted)}
table{border-collapse:collapse;width:100%}td{padding:6px 0;border-bottom:1px solid var(--line);vertical-align:top}td.n{text-align:right;font-weight:700;width:60px}td small{color:var(--muted)}
</style></head><body><main>
<h1>WhatsApp history import</h1>
<p class="lead">Listings only. No message text, recommendations or names are imported, and each listing starts with zero recommendations. Untick anything that should not go in, then download your decisions. Built ${esc(generated)}.</p>
<div class="card big">
<div><b>${stats.parsed}</b>messages parsed</div><div><b>${stats.kept}</b>read after redaction</div><div><b>${droppedTotal}</b>system lines dropped</div><div><b>${records.length}</b>listings found</div><div><b>${dropped.length}</b>candidates dropped</div>
</div>
<div class="card"><strong>Listings by kind</strong><br>${chips(countBy(records, (r) => KIND_TITLE[r.kind]))}
<br><strong>Places and services by area</strong><br>${chips(countBy(records.filter((r) => r.kind !== 'product'), (r) => r.area ?? 'Area unknown'))}
<br><strong>Messages dropped before reading</strong><br>${chips(Object.entries(stats.dropped).map(([k, n]) => [DROP_LABEL[k] ?? k, n ?? 0] as [string, number]).sort((a, b) => b[1] - a[1]))}</div>
${sections}
<section><h2>Dropped <small>${dropped.length}</small></h2>
<div class="card"><table>${droppedByReason.map(([reason, n]) => {
    const names = dropped.filter((d) => d.reason === reason && d.name).map((d) => d.name as string);
    return `<tr><td>${esc(reason)}${names.length ? `<br><small>${esc(names.join(', '))}</small>` : ''}</td><td class="n">${n}</td></tr>`;
  }).join('')}</table></div></section>
</main>
<div class="bar"><span id="count"></span><button id="dl" type="button">Download decisions</button></div>
<script>
const boxes=[...document.querySelectorAll('input[data-id]')];
const count=document.getElementById('count');
function update(){const n=boxes.filter(b=>!b.checked).length;count.textContent=(boxes.length-n)+' ticked, '+n+' unticked';}
boxes.forEach(b=>b.addEventListener('change',update));update();
document.getElementById('dl').addEventListener('click',()=>{
  const exclude=boxes.filter(b=>!b.checked).map(b=>b.dataset.id);
  const blob=new Blob([JSON.stringify({exclude,decidedAt:new Date().toISOString()},null,1)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='veganway-import-decisions.json';
  document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
});
</script></body></html>
`;
}

if (isMain(import.meta.url)) {
  const records = JSON.parse(readFileSync(RECORDS_JSON, 'utf8')) as ImportRecord[];
  const stats = JSON.parse(readFileSync(STATS_JSON, 'utf8')) as RedactStats;
  const spec = JSON.parse(readFileSync(EXTRACTION_JSON, 'utf8')) as Spec;
  const generated = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Dubai', dateStyle: 'medium', timeStyle: 'short' });
  ensureWorkDir();
  writeFileSync(PREVIEW_HTML, renderPreview(records, stats, spec.dropped, generated), { mode: 0o600 });
  console.log(`Wrote ${PREVIEW_HTML}`);
}
