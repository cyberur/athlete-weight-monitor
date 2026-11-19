/**
 * Attendance report: athletes present at training on one date, grouped Youth / Junior / Senior.
 * "Present" = the athlete has a weigh-in recorded for that date.
 */
import type { Athlete, Camp, WeighIn } from './types';
import { fullName, sortName } from './calc';
import { fmtDate } from './dates';
import { toCenti } from './weight';

/** 57 → "57", 52.2 → "52.2" (as the team writes classes) */
export const fmtClass = (kg: number) => (toCenti(kg) % 100 === 0 ? String(Math.round(kg)) : String(toCenti(kg) / 100));

export interface AttendanceEntry {
  athlete: Athlete;
  division: string; // division at the time (from the weigh-in) or current
  classKg: number;
}

export interface AttendanceGroup {
  group: string; // Youth | Junior | Senior | other
  present: AttendanceEntry[];
  absent: AttendanceEntry[];
}

export interface Attendance {
  camp: Camp;
  date: string;
  groups: AttendanceGroup[];
  presentCount: number;
  rosterCount: number;
}

export interface AttendanceOptions {
  showAbsent: boolean;
  showClass: boolean;
}

const YOUTH_ORDER = ['youth d', 'youth c', 'youth b', 'youth a'];

export function groupOf(division: string): string {
  const d = division.trim().toLowerCase();
  if (d.startsWith('youth')) return 'Youth';
  if (d.startsWith('junior')) return 'Junior';
  if (d.startsWith('senior')) return 'Senior';
  return division.trim() || 'Other';
}

function groupRank(g: string): number {
  return g === 'Youth' ? 0 : g === 'Junior' ? 1 : g === 'Senior' ? 2 : 3;
}

function divRank(div: string): number {
  const i = YOUTH_ORDER.indexOf(div.trim().toLowerCase());
  return i === -1 ? 99 : i;
}

/** Short division tag used inside the Youth group, e.g. "B" for "Youth B". */
export function divTag(division: string): string {
  const m = division.trim().match(/^youth\s+(.+)$/i);
  return m ? m[1].toUpperCase() : division;
}

export function buildAttendance(camp: Camp, athletes: Athlete[], weighIns: WeighIn[], date: string): Attendance {
  const onDay = new Map(weighIns.filter((w) => w.date === date).map((w) => [w.athleteId, w]));
  const groups = new Map<string, AttendanceGroup>();
  let rosterCount = 0;
  for (const a of athletes) {
    if (a.excludeFromAttendance) continue; // monitored, but not part of this camp's attendance
    const w = onDay.get(a.id);
    if (!w && !a.active) continue; // removed athletes only appear if they were actually present
    if (a.active) rosterCount++;
    const division = w?.ageDivisionAtTime ?? a.ageDivision;
    const g = groupOf(division);
    if (!groups.has(g)) groups.set(g, { group: g, present: [], absent: [] });
    const entry: AttendanceEntry = { athlete: a, division, classKg: w?.weightClassKgAtTime ?? a.weightClassKg };
    groups.get(g)![w ? 'present' : 'absent'].push(entry);
  }
  const sortEntries = (x: AttendanceEntry, y: AttendanceEntry) =>
    divRank(x.division) - divRank(y.division) || x.classKg - y.classKg || sortName(x.athlete).localeCompare(sortName(y.athlete));
  const list = [...groups.values()].sort((a, b) => groupRank(a.group) - groupRank(b.group) || a.group.localeCompare(b.group));
  list.forEach((g) => {
    g.present.sort(sortEntries);
    g.absent.sort(sortEntries);
  });
  const presentCount = list.reduce((n, g) => n + g.present.length, 0);
  return { camp, date, groups: list, presentCount, rosterCount };
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

function entryLabel(e: AttendanceEntry, group: string): string {
  return group === 'Youth' ? divTag(e.division) : e.division;
}

export function attendanceHtml(r: Attendance, o: AttendanceOptions): string {
  const h: string[] = [];
  h.push(`<header class="rh"><div class="att-kicker">ATTENDANCE</div>`);
  h.push(`<h1 class="att-date">${esc(fmtDate(r.date, { weekday: true, year: true }))}</h1>`);
  h.push(`<div class="att-sub">List of athletes present at training</div>`);
  h.push(`<div class="rmeta">${esc(r.camp.name)} · Present: <b>${r.presentCount}</b> of ${r.rosterCount} on roster</div></header>`);
  if (!r.presentCount) h.push('<p class="rmuted">No athletes recorded as present on this date (no weigh-ins).</p>');
  for (const g of r.groups) {
    if (!g.present.length && !(o.showAbsent && g.absent.length)) continue;
    h.push(`<h2>${esc(g.group)} <small class="rmuted">(${g.present.length})</small></h2>`);
    if (g.present.length) {
      h.push('<table class="rt att-t"><thead><tr><th class="n">#</th><th>Athlete</th><th>Division</th>');
      if (o.showClass) h.push('<th class="n">Weight class</th>');
      h.push('</tr></thead><tbody>');
      g.present.forEach((e, i) => {
        h.push(`<tr><td class="n">${i + 1}</td><td class="b">${esc(fullName(e.athlete))}</td><td>${esc(entryLabel(e, g.group))}</td>`);
        if (o.showClass) h.push(`<td class="n">${fmtClass(e.classKg)} kg</td>`);
        h.push('</tr>');
      });
      h.push('</tbody></table>');
    }
    if (o.showAbsent && g.absent.length)
      h.push(
        `<p class="att-absent"><b>Absent:</b> ${g.absent.map((e) => `${esc(fullName(e.athlete))} (${esc(entryLabel(e, g.group))})`).join(', ')}</p>`,
      );
  }
  h.push('<p class="rfoot">Present = weigh-in recorded on this date. Generated by Athlete Weight Monitor.</p>');
  return h.join('');
}

export const ATTENDANCE_CSS = `
.rdoc .att-kicker{font-size:12px;font-weight:800;letter-spacing:.12em;color:#1f6feb}
.rdoc .att-date{font-size:22px;margin:2px 0}
.rdoc .att-sub{font-size:15px;font-weight:600;margin-bottom:4px}
.rdoc .att-t{max-width:640px;table-layout:fixed}.rdoc .att-t th:nth-child(1){width:36px}.rdoc .att-t th:nth-child(2){width:48%}
.rdoc .att-absent{font-size:12px;color:#6b778c;margin:4px 0 0}
`;

/** Plain text in the team's WhatsApp style (bold with *asterisks*). */
export function attendanceText(r: Attendance, o: AttendanceOptions): string {
  const d = r.date.split('-');
  const lines: string[] = [];
  lines.push(`*Attendance* ${d[2]}/${d[1]}/${d[0].slice(2)} (${fmtDate(r.date, { weekday: true })})`);
  lines.push(`Athletes present at training: ${r.presentCount} of ${r.rosterCount}`);
  for (const g of r.groups) {
    if (!g.present.length && !(o.showAbsent && g.absent.length)) continue;
    lines.push('');
    lines.push(`*${g.group}* (${g.present.length})`);
    g.present.forEach((e, i) =>
      lines.push(`${i + 1}. ${entryLabel(e, g.group)} / ${fullName(e.athlete)}${o.showClass ? ` / ${fmtClass(e.classKg)} kg` : ''} ✅`),
    );
    if (o.showAbsent && g.absent.length)
      lines.push(`Absent: ${g.absent.map((e) => `${fullName(e.athlete)} (${entryLabel(e, g.group)})`).join(', ')}`);
  }
  return lines.join('\n');
}

export function attendanceStandaloneHtml(r: Attendance, o: AttendanceOptions, reportCss: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Attendance — ${esc(fmtDate(r.date, { year: true }))} — ${esc(r.camp.name)}</title>
<style>body{margin:16px}${reportCss}${ATTENDANCE_CSS}@media print{body{margin:0}}</style></head>
<body><div class="rdoc">${attendanceHtml(r, o)}</div></body></html>`;
}
