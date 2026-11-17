/**
 * Configurable reports: period (one day or a range), athlete scope (one, a selection, a group, all)
 * and which fields to include. Pure functions → used for the on-screen preview, print/PDF, HTML and CSV.
 */
import type { Athlete, Camp, HealthReason, WeighIn } from './types';
import { evaluateRecord, fullName, groupByAthlete, sortName, type EvaluatedRecord } from './calc';
import { addDays, daysBetween, fmtDate, isIsoDate } from './dates';
import { csvSigned, deltaKg, fmtKg, fmtSigned, describeRules, type StatusOrMissing } from './weight';
import { csvCell } from './csv';

export const MAX_REPORT_DAYS = 366;

export type AthleteScope = 'all' | 'division' | 'class' | 'selected';
export type GroupBy = 'athlete' | 'date';

export interface ReportOptions {
  from: string;
  to: string;
  scope: AthleteScope;
  division?: string;
  classKg?: number;
  selectedIds: string[];
  includeRemoved: boolean;
  groupBy: GroupBy;
  showDaily: boolean;
  showCategory: boolean;
  showStatus: boolean;
  showHealth: boolean;
  showNotes: boolean;
  showMissing: boolean;
  showSummary: boolean;
}

export const defaultReportOptions = (today: string): ReportOptions => ({
  from: today,
  to: today,
  scope: 'all',
  selectedIds: [],
  includeRemoved: false,
  groupBy: 'date',
  showDaily: true,
  showCategory: true,
  showStatus: true,
  showHealth: true,
  showNotes: true,
  showMissing: true,
  showSummary: true,
});

export interface ReportCell {
  athlete: Athlete;
  date: string;
  e: EvaluatedRecord | null; // null = missing
}

export interface AthleteSummary {
  athlete: Athlete;
  records: number;
  missingDays: number;
  first?: WeighIn;
  last?: WeighIn;
  changeKg: number | null; // last - first within period
  minKg: number | null;
  maxKg: number | null;
  lastEval: EvaluatedRecord | null;
  unhealthyDays: number;
  reasons: string[];
}

export interface Report {
  options: ReportOptions;
  camp: Camp;
  days: string[];
  athletes: Athlete[];
  cells: ReportCell[]; // every athlete × day (missing included)
  summaries: AthleteSummary[];
  dayCounts: Record<string, Record<StatusOrMissing, number>>;
  reasonLabel: (id?: string | null) => string;
  generatedAt: string;
}

export function validateReportOptions(o: ReportOptions): string | null {
  if (!isIsoDate(o.from) || !isIsoDate(o.to)) return 'Choose a valid period';
  if (o.to < o.from) return '"To" date is before "From" date';
  if (daysBetween(o.from, o.to) + 1 > MAX_REPORT_DAYS) return `Period is limited to ${MAX_REPORT_DAYS} days`;
  if (o.scope === 'selected' && !o.selectedIds.length) return 'Select at least one athlete';
  if (o.scope === 'division' && !o.division) return 'Choose a division';
  if (o.scope === 'class' && o.classKg === undefined) return 'Choose a weight class';
  return null;
}

export function selectAthletes(all: Athlete[], o: ReportOptions): Athlete[] {
  return all
    .filter((a) => {
      if (o.scope === 'selected') return o.selectedIds.includes(a.id);
      if (!o.includeRemoved && !a.active) return false;
      if (o.scope === 'division') return a.ageDivision === o.division;
      if (o.scope === 'class') return Math.round(a.weightClassKg * 100) === Math.round((o.classKg ?? -1) * 100);
      return true;
    })
    .sort((a, b) => sortName(a).localeCompare(sortName(b)));
}

export function buildReport(
  camp: Camp,
  allAthletes: Athlete[],
  weighIns: WeighIn[],
  reasons: HealthReason[],
  o: ReportOptions,
  now = new Date(),
): Report {
  const days: string[] = [];
  for (let d = o.from; d <= o.to; d = addDays(d, 1)) days.push(d);
  const athletes = selectAthletes(allAthletes, o);
  const byAthlete = groupByAthlete(weighIns);
  const rmap = new Map(reasons.map((r) => [r.id, r.label]));
  const reasonLabel = (id?: string | null) => (id ? (rmap.get(id) ?? '') : '');

  const cells: ReportCell[] = [];
  const summaries: AthleteSummary[] = [];
  const dayCounts: Report['dayCounts'] = {};
  for (const d of days) dayCounts[d] = { RED: 0, YELLOW: 0, GREEN: 0, MISSING: 0 };

  for (const a of athletes) {
    const list = byAthlete.get(a.id) ?? [];
    const byDate = new Map(list.map((w) => [w.date, w]));
    const inRange: WeighIn[] = [];
    let lastEval: EvaluatedRecord | null = null;
    let unhealthy = 0;
    const rs = new Set<string>();
    for (const d of days) {
      const w = byDate.get(d);
      const e = w ? evaluateRecord(w, list, camp.thresholds) : null;
      cells.push({ athlete: a, date: d, e });
      dayCounts[d][e ? e.status : 'MISSING']++;
      if (w && e) {
        inRange.push(w);
        lastEval = e;
        if (!w.healthy) {
          unhealthy++;
          const l = reasonLabel(w.healthReasonId);
          if (l) rs.add(l);
        }
      }
    }
    const weights = inRange.map((w) => w.weightKg);
    const first = inRange[0];
    const last = inRange[inRange.length - 1];
    summaries.push({
      athlete: a,
      records: inRange.length,
      missingDays: days.length - inRange.length,
      first,
      last,
      changeKg: first && last && first !== last ? deltaKg(last.weightKg, first.weightKg) : null,
      minKg: weights.length ? Math.min(...weights) : null,
      maxKg: weights.length ? Math.max(...weights) : null,
      lastEval,
      unhealthyDays: unhealthy,
      reasons: [...rs],
    });
  }
  return { options: o, camp, days, athletes, cells, summaries, dayCounts, reasonLabel, generatedAt: now.toISOString() };
}

/* ------------------------------------------------------------------ */
/* Text helpers                                                        */
/* ------------------------------------------------------------------ */

export function periodLabel(o: ReportOptions): string {
  return o.from === o.to
    ? fmtDate(o.from, { weekday: true, year: true })
    : `${fmtDate(o.from, { year: true })} – ${fmtDate(o.to, { year: true })} (${daysBetween(o.from, o.to) + 1} days)`;
}

export function scopeLabel(r: Report): string {
  const o = r.options;
  if (o.scope === 'selected')
    return r.athletes.length === 1 ? fullName(r.athletes[0]) : `${r.athletes.length} selected athletes`;
  const removed = o.includeRemoved ? ' (incl. removed)' : '';
  if (o.scope === 'division') return `Division: ${o.division}${removed}`;
  if (o.scope === 'class') return `Weight class: ${fmtKg(o.classKg)} kg${removed}`;
  return `All athletes${removed}`;
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/* ------------------------------------------------------------------ */
/* HTML (preview, print/PDF, shareable file)                           */
/* ------------------------------------------------------------------ */

const STATUS_STYLE: Record<StatusOrMissing, string> = {
  RED: 'background:#d42b2b;color:#fff',
  YELLOW: 'background:#f2a900;color:#2b1d00',
  GREEN: 'background:#12863f;color:#fff',
  MISSING: 'border:1.5px dashed #7a8599;color:#7a8599',
};
const badge = (s: StatusOrMissing) => `<span class="rb" style="${STATUS_STYLE[s]}">${s}</span>`;
const catColor = (s: StatusOrMissing) => (s === 'RED' ? '#d42b2b' : s === 'YELLOW' ? '#9a6700' : s === 'GREEN' ? '#12863f' : '#7a8599');

/** Report body as HTML (no <html> wrapper). All user text is escaped. */
export function reportBodyHtml(r: Report): string {
  const o = r.options;
  const single = r.days.length === 1;
  const h: string[] = [];
  h.push(`<header class="rh"><h1>${esc(r.camp.name)} — Weight report</h1>`);
  h.push(
    `<div class="rmeta"><b>Period:</b> ${esc(periodLabel(o))} &nbsp;·&nbsp; <b>Athletes:</b> ${esc(scopeLabel(r))} (${r.athletes.length})` +
      ` &nbsp;·&nbsp; <b>Generated:</b> ${esc(new Date(r.generatedAt).toLocaleString())}</div>`,
  );
  if (o.showStatus)
    h.push(
      `<div class="rmeta">Status rules (current): ${describeRules(r.camp.thresholds)
        .map((x) => `${x.status}: ${esc(x.rule.replace('Category delta ', ''))}`)
        .join(' · ')}</div>`,
    );
  h.push('</header>');

  if (!r.athletes.length) {
    h.push('<p>No athletes match the selection.</p>');
    return h.join('');
  }

  // counts
  if (o.showStatus) {
    const tot: Record<StatusOrMissing, number> = { RED: 0, YELLOW: 0, GREEN: 0, MISSING: 0 };
    for (const d of r.days) for (const k of Object.keys(tot) as StatusOrMissing[]) tot[k] += r.dayCounts[d][k];
    h.push(
      `<div class="rcounts">${(['RED', 'YELLOW', 'GREEN', 'MISSING'] as StatusOrMissing[])
        .filter((k) => k !== 'MISSING' || o.showMissing)
        .map((k) => `${badge(k)} <b>${tot[k]}</b>`)
        .join(' &nbsp; ')}${single ? '' : ' <span class="rmuted">(athlete-days in period)</span>'}</div>`,
    );
  }

  const head = (first: string) => {
    const c = [`<th>${first}</th>`, '<th class="n">Weight</th>'];
    if (o.showDaily) c.push('<th class="n">Daily Δ</th>');
    if (o.showCategory) c.push('<th class="n">Class</th><th class="n">Cat. Δ</th>');
    if (o.showStatus) c.push('<th>Status</th>');
    if (o.showHealth) c.push('<th>Health</th>');
    if (o.showNotes) c.push('<th>Notes</th>');
    return `<thead><tr>${c.join('')}</tr></thead>`;
  };
  const row = (first: string, cell: ReportCell) => {
    const e = cell.e;
    if (!e) {
      const span = 1 + (o.showDaily ? 1 : 0) + (o.showCategory ? 2 : 0);
      const tail = (o.showStatus ? `<td>${badge('MISSING')}</td>` : '') + (o.showHealth ? '<td></td>' : '') + (o.showNotes ? '<td></td>' : '');
      return `<tr class="rmiss"><td>${first}</td><td colspan="${span}" class="rmuted">no weigh-in</td>${tail}</tr>`;
    }
    const w = e.record;
    const c = [`<td>${first}</td>`, `<td class="n b">${fmtKg(w.weightKg)}</td>`];
    if (o.showDaily)
      c.push(
        `<td class="n">${e.daily ? fmtSigned(e.daily.deltaKg) + (e.daily.days > 1 ? ` <small class="rgap">/${e.daily.days}d</small>` : '') : '—'}</td>`,
      );
    if (o.showCategory)
      c.push(`<td class="n">${fmtKg(w.weightClassKgAtTime)}</td><td class="n b" style="color:${catColor(e.status)}">${fmtSigned(e.categoryDeltaKg)}</td>`);
    if (o.showStatus) c.push(`<td>${badge(e.status)}</td>`);
    if (o.showHealth)
      c.push(`<td>${w.healthy ? '<span style="color:#12863f">✓ Healthy</span>' : `<b style="color:#7b3fbf">✚ ${esc(r.reasonLabel(w.healthReasonId) || 'Not healthy')}</b>`}</td>`);
    if (o.showNotes) c.push(`<td class="rnotes">${esc(w.notes ?? '')}</td>`);
    return `<tr>${c.join('')}</tr>`;
  };
  const keep = (c: ReportCell) => !!c.e || o.showMissing;

  if (o.showSummary && !single) {
    h.push('<h2>Summary</h2><table class="rt"><thead><tr><th>Athlete</th><th>Div.</th><th class="n">Class</th><th class="n">Records</th>');
    if (o.showMissing) h.push('<th class="n">Missing</th>');
    h.push('<th class="n">First</th><th class="n">Last</th><th class="n">Change</th><th class="n">Min</th><th class="n">Max</th>');
    if (o.showCategory) h.push('<th class="n">Last cat. Δ</th>');
    if (o.showStatus) h.push('<th>Last status</th>');
    if (o.showHealth) h.push('<th>Unhealthy days</th>');
    h.push('</tr></thead><tbody>');
    for (const s of r.summaries) {
      const a = s.athlete;
      h.push(`<tr><td class="b">${esc(fullName(a))}</td><td>${esc(a.ageDivision)}</td><td class="n">${fmtKg(a.weightClassKg)}</td><td class="n">${s.records}</td>`);
      if (o.showMissing) h.push(`<td class="n">${s.missingDays}</td>`);
      h.push(
        `<td class="n">${s.first ? `${fmtKg(s.first.weightKg)} <small class="rmuted">${fmtDate(s.first.date)}</small>` : '—'}</td>` +
          `<td class="n">${s.last ? `${fmtKg(s.last.weightKg)} <small class="rmuted">${fmtDate(s.last.date)}</small>` : '—'}</td>` +
          `<td class="n b">${s.changeKg !== null ? fmtSigned(s.changeKg) : '—'}</td><td class="n">${fmtKg(s.minKg)}</td><td class="n">${fmtKg(s.maxKg)}</td>`,
      );
      if (o.showCategory)
        h.push(`<td class="n b" style="color:${catColor(s.lastEval?.status ?? 'MISSING')}">${s.lastEval ? fmtSigned(s.lastEval.categoryDeltaKg) : '—'}</td>`);
      if (o.showStatus) h.push(`<td>${s.lastEval ? badge(s.lastEval.status) : badge('MISSING')}</td>`);
      if (o.showHealth) h.push(`<td>${s.unhealthyDays}${s.reasons.length ? ` <small>(${esc(s.reasons.join(', '))})</small>` : ''}</td>`);
      h.push('</tr>');
    }
    h.push('</tbody></table>');
  }

  if (o.groupBy === 'date' || single) {
    for (const d of [...r.days].reverse()) {
      const cells = r.cells.filter((c) => c.date === d && keep(c));
      if (!cells.length) continue;
      const k = r.dayCounts[d];
      h.push(
        `<h2>${esc(fmtDate(d, { weekday: true, year: true }))}${
          o.showStatus ? ` <small class="rmuted">R ${k.RED} · Y ${k.YELLOW} · G ${k.GREEN}${o.showMissing ? ` · Missing ${k.MISSING}` : ''}</small>` : ''
        }</h2>`,
      );
      h.push(`<table class="rt">${head('Athlete')}<tbody>`);
      for (const c of cells)
        h.push(row(`<b>${esc(fullName(c.athlete))}</b> <small class="rmuted">${esc(c.athlete.ageDivision)}</small>`, c));
      h.push('</tbody></table>');
    }
  } else {
    for (const a of r.athletes) {
      const cells = r.cells.filter((c) => c.athlete.id === a.id && keep(c)).reverse();
      h.push(`<h2>${esc(fullName(a))} <small class="rmuted">${esc(a.ageDivision)} · ${fmtKg(a.weightClassKg)} kg · ID ${esc(a.id)}</small></h2>`);
      if (!cells.length) {
        h.push('<p class="rmuted">No weigh-ins in this period.</p>');
        continue;
      }
      h.push(`<table class="rt">${head('Date')}<tbody>`);
      for (const c of cells) h.push(row(esc(fmtDate(c.date, { weekday: true })), c));
      h.push('</tbody></table>');
    }
  }
  if (o.showHealth || o.showNotes)
    h.push('<p class="rfoot">Contains health information — confidential. Generated by Athlete Weight Monitor.</p>');
  return h.join('');
}

export const REPORT_CSS = `
.rdoc{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f1b2d;font-size:13px}
.rdoc h1{font-size:18px;margin:0 0 4px}.rdoc h2{font-size:14px;margin:16px 0 6px}
.rdoc .rmeta{font-size:12px;color:#44526a;margin:2px 0}.rdoc .rcounts{margin:8px 0;font-size:13px}
.rdoc .rmuted{color:#6b778c;font-weight:400}.rdoc .rgap{color:#9a6700;font-weight:700}
.rdoc .rt{border-collapse:collapse;width:100%;margin-bottom:6px}
.rdoc .rt th,.rdoc .rt td{border-bottom:1px solid #d9dee7;padding:4px 6px;text-align:left;vertical-align:top}
.rdoc .rt th{font-size:10px;text-transform:uppercase;letter-spacing:.03em;color:#6b778c;background:#f6f8fa}
.rdoc .n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.rdoc .b{font-weight:700}
.rdoc .rb{display:inline-block;font-size:10px;font-weight:800;padding:2px 6px;border-radius:4px;letter-spacing:.03em}
.rdoc .rmiss td{color:#7a8599}.rdoc .rnotes{max-width:260px}
.rdoc .rfoot{margin-top:14px;font-size:11px;color:#6b778c}
.rdoc *{-webkit-print-color-adjust:exact;print-color-adjust:exact}.rdoc tr{break-inside:avoid}.rdoc h2{break-after:avoid}
`;

export function reportStandaloneHtml(r: Report): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(r.camp.name)} — Weight report — ${esc(periodLabel(r.options))}</title>
<style>body{margin:16px}${REPORT_CSS}@media print{body{margin:0}}</style></head>
<body><div class="rdoc">${reportBodyHtml(r)}</div></body></html>`;
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

export function reportCsv(r: Report): string {
  const o = r.options;
  const head = ['date', 'athlete_id', 'first_name', 'last_name', 'age_division', 'weight_class_kg', 'weight_kg'];
  if (o.showDaily) head.push('previous_date', 'days_since_previous', 'daily_delta_kg');
  if (o.showCategory) head.push('category_delta_kg');
  if (o.showStatus) head.push('status');
  if (o.showHealth) head.push('healthy', 'health_reason');
  if (o.showNotes) head.push('notes');
  const lines = [head.join(',')];
  const cells = o.groupBy === 'athlete' ? r.cells : [...r.cells].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const c of cells) {
    if (!c.e && !o.showMissing) continue;
    const a = c.athlete;
    const w = c.e?.record;
    const v: (string | number)[] = [c.date, a.id, a.firstName, a.lastName, w?.ageDivisionAtTime ?? a.ageDivision, csvSigned(w?.weightClassKgAtTime ?? a.weightClassKg), w ? csvSigned(w.weightKg) : ''];
    if (o.showDaily) v.push(c.e?.daily?.previousDate ?? '', c.e?.daily?.days ?? '', csvSigned(c.e?.daily?.deltaKg));
    if (o.showCategory) v.push(c.e ? csvSigned(c.e.categoryDeltaKg) : '');
    if (o.showStatus) v.push(c.e ? c.e.status : 'MISSING');
    if (o.showHealth) v.push(w ? (w.healthy ? 'yes' : 'no') : '', w ? r.reasonLabel(w.healthReasonId) : '');
    if (o.showNotes) v.push(w?.notes ?? '');
    lines.push(v.map(csvCell).join(','));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}
