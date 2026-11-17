/**
 * Weight arithmetic and status evaluation.
 *
 * All arithmetic is done on integer hundredths of a kilogram ("centi-kg")
 * so that values such as 72.3 - 70.3 give exactly 2.0 and threshold
 * comparisons are exact at the boundaries. Values are stored as plain
 * kilogram numbers (max 2 decimals) and converted on use.
 */

export const MIN_VALID_WEIGHT_KG = 20;
export const MAX_VALID_WEIGHT_KG = 300;

export type Status = 'RED' | 'YELLOW' | 'GREEN';
export type StatusOrMissing = Status | 'MISSING';

export interface Thresholds {
  /** Category delta strictly greater than this is RED (kg). */
  redAboveKg: number;
  /** When yellow is enabled: category delta >= this (and not RED) is YELLOW (kg). */
  yellowFromKg: number;
  yellowEnabled: boolean;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  redAboveKg: 2.0,
  yellowFromKg: 1.0,
  yellowEnabled: true,
};

export function toCenti(kg: number): number {
  return Math.round(kg * 100);
}

export function fromCenti(c: number): number {
  return c / 100;
}

/** Normalise a kg value to at most 2 decimals, removing float noise. */
export function roundKg(kg: number): number {
  return fromCenti(toCenti(kg));
}

export function isValidWeight(kg: number | null | undefined): kg is number {
  return (
    typeof kg === 'number' &&
    Number.isFinite(kg) &&
    kg >= MIN_VALID_WEIGHT_KG &&
    kg <= MAX_VALID_WEIGHT_KG
  );
}

export function weightError(kg: number | null): string | null {
  if (kg === null || !Number.isFinite(kg)) return 'Enter a weight';
  if (kg < MIN_VALID_WEIGHT_KG) return `Below ${MIN_VALID_WEIGHT_KG} kg — not a valid weight`;
  if (kg > MAX_VALID_WEIGHT_KG) return `Above ${MAX_VALID_WEIGHT_KG} kg — not a valid weight`;
  return null;
}

/** a - b, exact to 0.01 kg */
export function deltaKg(a: number, b: number): number {
  return fromCenti(toCenti(a) - toCenti(b));
}

export function categoryDelta(weightKg: number, classLimitKg: number): number {
  return deltaKg(weightKg, classLimitKg);
}

export function evaluateStatus(catDeltaKg: number, t: Thresholds): Status {
  const d = toCenti(catDeltaKg);
  if (d > toCenti(t.redAboveKg)) return 'RED';
  if (t.yellowEnabled && d >= toCenti(t.yellowFromKg)) return 'YELLOW';
  return 'GREEN';
}

export function validateThresholds(t: Thresholds): string | null {
  if (!Number.isFinite(t.redAboveKg) || !Number.isFinite(t.yellowFromKg)) return 'Thresholds must be numbers';
  if (Math.abs(t.redAboveKg) > 50 || Math.abs(t.yellowFromKg) > 50) return 'Thresholds must be within ±50 kg';
  if (t.yellowEnabled && toCenti(t.yellowFromKg) > toCenti(t.redAboveKg))
    return 'Yellow threshold must not be greater than the Red threshold';
  return null;
}

/** Human-readable description of the active rules. */
export function describeRules(t: Thresholds): { status: Status; rule: string }[] {
  const r = fmtSigned(t.redAboveKg);
  if (!t.yellowEnabled) {
    return [
      { status: 'RED', rule: `Category delta greater than ${r} kg` },
      { status: 'GREEN', rule: `Category delta ${r} kg or less` },
    ];
  }
  const y = fmtSigned(t.yellowFromKg);
  const same = toCenti(t.yellowFromKg) === toCenti(t.redAboveKg);
  return [
    { status: 'RED', rule: `Category delta greater than ${r} kg` },
    {
      status: 'YELLOW',
      rule: same ? `Category delta exactly ${y} kg` : `Category delta from ${y} kg up to and including ${r} kg`,
    },
    { status: 'GREEN', rule: `Category delta less than ${y} kg` },
  ];
}

/** Format kg with 1 decimal (2 if needed). */
export function fmtKg(kg: number | null | undefined): string {
  if (kg === null || kg === undefined || !Number.isFinite(kg)) return '—';
  const c = toCenti(kg);
  const s = c % 10 === 0 ? (c / 100).toFixed(1) : (c / 100).toFixed(2);
  return s === '-0.0' ? '0.0' : s;
}

/** Signed format, e.g. +2.5 / −0.5 / ±0.0 (uses a real minus sign). */
export function fmtSigned(kg: number | null | undefined): string {
  if (kg === null || kg === undefined || !Number.isFinite(kg)) return '—';
  const c = toCenti(kg);
  if (c === 0) return '±0.0';
  const body = fmtKg(Math.abs(c) / 100);
  return (c > 0 ? '+' : '−') + body;
}

/** Plain signed format for CSV (ASCII minus, no plus sign issues for Excel). */
export function csvSigned(kg: number | null | undefined): string {
  if (kg === null || kg === undefined || !Number.isFinite(kg)) return '';
  const c = toCenti(kg);
  return (c / 100).toFixed(c % 10 === 0 ? 1 : 2);
}
