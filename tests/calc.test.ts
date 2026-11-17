import { describe, expect, it } from 'vitest';
import {
  categoryDelta,
  deltaKg,
  describeRules,
  evaluateStatus,
  fmtSigned,
  isValidWeight,
  validateThresholds,
  weightError,
  type Thresholds,
} from '../src/lib/weight';
import { buildTeamRows, countStatuses, dailyDeltaFor, evaluateHistory, intervalLabel } from '../src/lib/calc';
import { keypadReduce, parseKeypad, type KeyAction } from '../src/lib/keypad';
import { addDays, daysBetween, isIsoDate } from '../src/lib/dates';
import { weighInsToCsv } from '../src/lib/csv';
import type { Athlete, Camp, WeighIn } from '../src/lib/types';

const three: Thresholds = { redAboveKg: 2.0, yellowFromKg: 1.0, yellowEnabled: true };
const two: Thresholds = { redAboveKg: 0.5, yellowFromKg: 0.5, yellowEnabled: false };

const w = (athleteId: string, date: string, kg: number, cls = 70.3): WeighIn => ({
  id: `${athleteId}-${date}`,
  campId: 'c',
  athleteId,
  date,
  weightKg: kg,
  healthy: true,
  ageDivisionAtTime: 'Senior',
  weightClassKgAtTime: cls,
  createdAt: '',
  updatedAt: '',
});

describe('daily delta', () => {
  it('negative (loss)', () => expect(deltaKg(71.5, 72.0)).toBe(-0.5));
  it('positive (gain)', () => expect(deltaKg(72.3, 71.8)).toBe(0.5));
  it('no float artifacts', () => {
    expect(deltaKg(72.3, 70.3)).toBe(2);
    expect(deltaKg(0.3, 0.1)).toBe(0.2);
    expect(fmtSigned(deltaKg(70.1, 70.3))).toBe('−0.2');
  });
  it('absent previous measurement → null', () => {
    expect(dailyDeltaFor([], '2026-11-17', 71)).toBeNull();
    expect(dailyDeltaFor([w('a', '2026-11-18', 70)], '2026-11-17', 71)).toBeNull();
  });
  it('consecutive day', () => {
    const d = dailyDeltaFor([w('a', '2026-11-16', 72.0)], '2026-11-17', 71.5)!;
    expect(d).toMatchObject({ deltaKg: -0.5, previousDate: '2026-11-16', days: 1 });
    expect(intervalLabel(d)).toBe('vs yesterday');
  });
  it('missing days → identifies elapsed interval, uses latest earlier record', () => {
    const list = [w('a', '2026-11-10', 74), w('a', '2026-11-14', 73.0), w('a', '2026-11-18', 70)];
    const d = dailyDeltaFor(list, '2026-11-17', 72.2)!;
    expect(d).toMatchObject({ deltaKg: -0.8, previousDate: '2026-11-14', days: 3 });
    expect(intervalLabel(d)).toBe('over 3 days');
  });
});

describe('category delta', () => {
  it('above limit', () => expect(categoryDelta(72.8, 70.3)).toBe(2.5));
  it('below limit', () => expect(categoryDelta(69.8, 70.3)).toBe(-0.5));
  it('exact', () => expect(categoryDelta(70.3, 70.3)).toBe(0));
});

describe('status — three zones (default)', () => {
  const cases: [number, string][] = [
    [2.1, 'RED'],
    [2.01, 'RED'],
    [2.0, 'YELLOW'],
    [1.5, 'YELLOW'],
    [1.0, 'YELLOW'],
    [0.99, 'GREEN'],
    [0.9, 'GREEN'],
    [0, 'GREEN'],
    [-3, 'GREEN'],
  ];
  it.each(cases)('delta %s → %s', (d, s) => expect(evaluateStatus(d, three)).toBe(s));
  it('boundaries computed from real weights (72.3 vs 70.3 = +2.0 → YELLOW)', () => {
    expect(evaluateStatus(categoryDelta(72.3, 70.3), three)).toBe('YELLOW');
    expect(evaluateStatus(categoryDelta(72.4, 70.3), three)).toBe('RED');
    expect(evaluateStatus(categoryDelta(71.3, 70.3), three)).toBe('YELLOW');
    expect(evaluateStatus(categoryDelta(71.2, 70.3), three)).toBe('GREEN');
  });
});

describe('status — two zones', () => {
  it.each([
    [0.6, 'RED'],
    [0.51, 'RED'],
    [0.5, 'GREEN'],
    [0.4, 'GREEN'],
    [-1, 'GREEN'],
  ])('delta %s → %s', (d, s) => expect(evaluateStatus(d as number, two)).toBe(s));
  it('never yields YELLOW when disabled', () => {
    for (let c = -500; c <= 500; c += 7) expect(evaluateStatus(c / 100, two)).not.toBe('YELLOW');
  });
  it('rules text', () => {
    expect(describeRules(two).map((r) => r.status)).toEqual(['RED', 'GREEN']);
    expect(describeRules(three).map((r) => r.status)).toEqual(['RED', 'YELLOW', 'GREEN']);
  });
});

describe('thresholds', () => {
  it('rejects yellow > red', () => expect(validateThresholds({ redAboveKg: 1, yellowFromKg: 2, yellowEnabled: true })).toBeTruthy());
  it('allows yellow > red when yellow disabled', () =>
    expect(validateThresholds({ redAboveKg: 1, yellowFromKg: 2, yellowEnabled: false })).toBeNull());
  it('results change after threshold change; weights untouched', () => {
    const athletes: Athlete[] = [
      { campId: 'c', id: 'a', firstName: 'A', lastName: 'A', ageDivision: 'Senior', weightClassKg: 70.3, active: true, createdAt: '', updatedAt: '' },
      { campId: 'c', id: 'b', firstName: 'B', lastName: 'B', ageDivision: 'Senior', weightClassKg: 70.3, active: true, createdAt: '', updatedAt: '' },
      { campId: 'c', id: 'm', firstName: 'M', lastName: 'M', ageDivision: 'Senior', weightClassKg: 70.3, active: true, createdAt: '', updatedAt: '' },
    ];
    const recs = [w('a', '2026-11-17', 71.8), w('b', '2026-11-17', 70.6)];
    const before = buildTeamRows(athletes, recs, '2026-11-17', three);
    expect(before.map((r) => r.status)).toEqual(['YELLOW', 'GREEN', 'MISSING']);
    const after = buildTeamRows(athletes, recs, '2026-11-17', two);
    expect(after.map((r) => r.status)).toEqual(['RED', 'GREEN', 'MISSING']);
    expect(recs.map((r) => r.weightKg)).toEqual([71.8, 70.6]);
    expect(countStatuses(after)).toEqual({ RED: 1, YELLOW: 0, GREEN: 1, MISSING: 1 });
  });
  it('missing record is MISSING, never GREEN, and last earlier record shown separately', () => {
    const a: Athlete = { campId: 'c', id: 'a', firstName: 'A', lastName: 'A', ageDivision: 'Senior', weightClassKg: 70.3, active: true, createdAt: '', updatedAt: '' };
    const rows = buildTeamRows([a], [w('a', '2026-11-15', 70)], '2026-11-17', three);
    expect(rows[0].status).toBe('MISSING');
    expect(rows[0].onDate).toBeNull();
    expect(rows[0].lastBefore?.date).toBe('2026-11-15');
  });
  it('history uses snapshot class at time of measurement', () => {
    const h = evaluateHistory([w('a', '2026-11-15', 72, 70.3), w('a', '2026-11-16', 72, 77.1)], three);
    expect(h[0].categoryDeltaKg).toBe(-5.1);
    expect(h[1].categoryDeltaKg).toBe(1.7);
    expect(h[1].daily).toBeNull();
    expect(h[0].daily?.deltaKg).toBe(0);
  });
});

describe('weight validation', () => {
  it('rejects < 20 kg', () => {
    expect(isValidWeight(19.9)).toBe(false);
    expect(isValidWeight(0)).toBe(false);
    expect(weightError(5)).toMatch(/Below 20/);
  });
  it('accepts 20 kg and normal weights', () => {
    expect(isValidWeight(20)).toBe(true);
    expect(isValidWeight(72.4)).toBe(true);
  });
  it('rejects absurd values', () => expect(isValidWeight(301)).toBe(false));
});

describe('keypad', () => {
  const type = (seq: string) =>
    [...seq].reduce((v, ch) => {
      const a: KeyAction = ch === '.' ? { type: 'dot' } : ch === '<' ? { type: 'back' } : ch === 'C' ? { type: 'clear' } : { type: 'digit', d: ch };
      return keypadReduce(v, a);
    }, '');
  it('types a weight', () => expect(type('72.4')).toBe('72.4'));
  it('prevents multiple decimal separators', () => expect(type('72..4.')).toBe('72.4'));
  it('leading dot becomes 0.', () => expect(type('.5')).toBe('0.5'));
  it('max 2 decimals', () => expect(type('72.456')).toBe('72.45'));
  it('max 3 integer digits', () => expect(type('12345')).toBe('123'));
  it('no leading zeros', () => expect(type('072')).toBe('72'));
  it('backspace & clear', () => {
    expect(type('72.4<')).toBe('72.');
    expect(type('72.4C')).toBe('');
  });
  it('parse', () => {
    expect(parseKeypad('')).toBeNull();
    expect(parseKeypad('72.')).toBe(72);
    expect(parseKeypad('72.45')).toBe(72.45);
  });
});

describe('dates', () => {
  it('validates ISO dates', () => {
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2028-02-29')).toBe(true);
    expect(isIsoDate('2026-1-01')).toBe(false);
  });
  it('days between across month', () => {
    expect(daysBetween('2026-10-30', '2026-11-02')).toBe(3);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('csv', () => {
  it('has header, ISO dates, dot decimals, negative numbers unescaped, quoting', () => {
    const camp: Camp = { id: 'c', name: 'Camp, "A"', thresholds: three, createdAt: '', updatedAt: '' };
    const athletes: Athlete[] = [
      { campId: 'c', id: 'a', firstName: 'Al', lastName: 'Bo', ageDivision: 'Senior', weightClassKg: 70.3, active: true, createdAt: '', updatedAt: '' },
    ];
    const recs = [w('a', '2026-11-16', 72.0), { ...w('a', '2026-11-17', 71.5), notes: '=cmd, "x"' }];
    const csv = weighInsToCsv(camp, athletes, recs, []);
    const lines = csv.replace('﻿', '').trim().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0].startsWith('camp_id,camp_name,date')).toBe(true);
    expect(lines[2]).toContain('"Camp, ""A"""');
    expect(lines[2]).toContain(',2026-11-17,a,Al,Bo,Senior,70.3,71.5,2026-11-16,1,-0.5,1.2,YELLOW,yes,,');
    expect(lines[2]).toContain(`"'=cmd, ""x"""`);
  });
});
