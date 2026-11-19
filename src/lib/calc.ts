import type { Athlete, WeighIn } from './types';
import { categoryDelta, deltaKg, evaluateStatus, type StatusOrMissing, type Thresholds } from './weight';
import { daysBetween } from './dates';

export interface DailyDelta {
  deltaKg: number;
  previousKg: number;
  previousDate: string;
  /** Days between previous measurement and this one (1 = consecutive days). */
  days: number;
}

/** Latest weigh-in strictly before `date`. `list` may be unsorted. */
export function previousBefore(list: WeighIn[], date: string): WeighIn | null {
  let best: WeighIn | null = null;
  for (const w of list) {
    if (w.date < date && (!best || w.date > best.date)) best = w;
  }
  return best;
}

export function dailyDeltaFor(list: WeighIn[], date: string, weightKg: number): DailyDelta | null {
  const prev = previousBefore(list, date);
  if (!prev) return null;
  return {
    deltaKg: deltaKg(weightKg, prev.weightKg),
    previousKg: prev.weightKg,
    previousDate: prev.date,
    days: daysBetween(prev.date, date),
  };
}

export interface EvaluatedRecord {
  record: WeighIn;
  daily: DailyDelta | null;
  categoryDeltaKg: number;
  status: 'RED' | 'YELLOW' | 'GREEN';
}

export function evaluateRecord(record: WeighIn, all: WeighIn[], t: Thresholds): EvaluatedRecord {
  const cd = categoryDelta(record.weightKg, record.weightClassKgAtTime);
  return {
    record,
    daily: dailyDeltaFor(all, record.date, record.weightKg),
    categoryDeltaKg: cd,
    status: evaluateStatus(cd, t),
  };
}

/** Full history for one athlete, newest first. */
export function evaluateHistory(list: WeighIn[], t: Thresholds): EvaluatedRecord[] {
  return [...list].sort((a, b) => (a.date < b.date ? 1 : -1)).map((r) => evaluateRecord(r, list, t));
}

export interface TeamRow {
  athlete: Athlete;
  /** Evaluation of the record ON the selected date (null if missing). */
  onDate: EvaluatedRecord | null;
  status: StatusOrMissing;
  /** Most recent record before the selected date — only shown as context, clearly dated. */
  lastBefore: WeighIn | null;
}

export function buildTeamRows(
  athletes: Athlete[],
  weighIns: WeighIn[],
  date: string,
  t: Thresholds,
): TeamRow[] {
  const byAthlete = groupByAthlete(weighIns);
  return athletes.map((a) => {
    const list = byAthlete.get(a.id) ?? [];
    const rec = list.find((w) => w.date === date) ?? null;
    const onDate = rec ? evaluateRecord(rec, list, t) : null;
    return {
      athlete: a,
      onDate,
      status: onDate ? onDate.status : 'MISSING',
      lastBefore: rec ? null : previousBefore(list, date),
    };
  });
}

export function groupByAthlete(weighIns: WeighIn[]): Map<string, WeighIn[]> {
  const m = new Map<string, WeighIn[]>();
  for (const w of weighIns) {
    const arr = m.get(w.athleteId);
    if (arr) arr.push(w);
    else m.set(w.athleteId, [w]);
  }
  return m;
}

export const STATUS_ORDER: Record<StatusOrMissing, number> = { RED: 0, YELLOW: 1, MISSING: 2, GREEN: 3 };

export function countStatuses(rows: TeamRow[]): Record<StatusOrMissing, number> {
  const c: Record<StatusOrMissing, number> = { RED: 0, YELLOW: 0, GREEN: 0, MISSING: 0 };
  for (const r of rows) c[r.status]++;
  return c;
}

export function fullName(a: Pick<Athlete, 'firstName' | 'lastName'>): string {
  return `${a.firstName} ${a.lastName}`.trim();
}

export function sortName(a: Pick<Athlete, 'firstName' | 'lastName'>): string {
  return `${a.firstName} ${a.lastName}`.toLowerCase(); // first name first, as the team uses names
}

/** Describe the interval for a daily delta so multi-day changes are never shown as one day. */
export function intervalLabel(d: DailyDelta): string {
  if (d.days === 1) return 'vs yesterday';
  return `over ${d.days} days`;
}
