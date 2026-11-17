import type { Athlete, Camp, HealthReason, WeighIn } from './types';
import { evaluateRecord, groupByAthlete } from './calc';
import { csvSigned } from './weight';

const HEADER = [
  'camp_id',
  'camp_name',
  'date',
  'athlete_id',
  'first_name',
  'last_name',
  'age_division',
  'weight_class_kg',
  'weight_kg',
  'previous_date',
  'days_since_previous',
  'daily_delta_kg',
  'category_delta_kg',
  'status',
  'healthy',
  'health_reason',
  'notes',
  'updated_at',
];

export function csvCell(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // neutralise spreadsheet formula injection
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * CSV of all weigh-ins: comma separated, dot decimal, ISO 8601 dates (YYYY-MM-DD), UTF-8 with BOM,
 * CRLF line endings. Status uses the thresholds active at export time.
 */
export function weighInsToCsv(camp: Camp, athletes: Athlete[], weighIns: WeighIn[], reasons: HealthReason[]): string {
  const ath = new Map(athletes.map((a) => [a.id, a]));
  const rs = new Map(reasons.map((r) => [r.id, r.label]));
  const groups = groupByAthlete(weighIns);
  const rows = [...weighIns].sort((a, b) =>
    a.date === b.date
      ? (ath.get(a.athleteId)?.lastName ?? '').localeCompare(ath.get(b.athleteId)?.lastName ?? '')
      : a.date < b.date
        ? -1
        : 1,
  );
  const lines = [HEADER.join(',')];
  for (const w of rows) {
    const a = ath.get(w.athleteId);
    const e = evaluateRecord(w, groups.get(w.athleteId) ?? [w], camp.thresholds);
    lines.push(
      [
        camp.id,
        camp.name,
        w.date,
        w.athleteId,
        a?.firstName ?? '',
        a?.lastName ?? '',
        w.ageDivisionAtTime,
        csvSigned(w.weightClassKgAtTime),
        csvSigned(w.weightKg),
        e.daily?.previousDate ?? '',
        e.daily?.days ?? '',
        csvSigned(e.daily?.deltaKg),
        csvSigned(e.categoryDeltaKg),
        e.status,
        w.healthy ? 'yes' : 'no',
        w.healthReasonId ? (rs.get(w.healthReasonId) ?? '') : '',
        w.notes ?? '',
        w.updatedAt,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}
