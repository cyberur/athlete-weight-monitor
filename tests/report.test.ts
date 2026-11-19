import { describe, expect, it } from 'vitest';
import { buildReport, defaultReportOptions, reportBodyHtml, reportCsv, validateReportOptions, type ReportOptions } from '../src/lib/report';
import type { Athlete, Camp, HealthReason, WeighIn } from '../src/lib/types';

const camp: Camp = { id: 'c', name: 'Camp <A>', thresholds: { redAboveKg: 2, yellowFromKg: 1, yellowEnabled: true }, createdAt: '', updatedAt: '' };
const ath = (id: string, first: string, last: string, div: string, kg: number, active = true): Athlete => ({
  campId: 'c', id, firstName: first, lastName: last, ageDivision: div, weightClassKg: kg, active, createdAt: '', updatedAt: '',
});
const athletes = [
  ath('s1', 'Khalid', 'Mansoori', 'Senior', 65.8),
  ath('s2', 'Mariam', 'Shamsi', 'Senior', 56.7),
  ath('y1', 'Saif', 'Ketbi', 'Youth A', 70.3),
  ath('r1', 'Old', 'Gone', 'Senior', 70.3, false),
];
const reasons: HealthReason[] = [{ id: 'fev', label: 'Fever', key: 'fever', createdAt: '', useCount: 1 }];
const w = (a: string, date: string, kg: number, cls: number, extra: Partial<WeighIn> = {}): WeighIn => ({
  id: `${a}-${date}`, campId: 'c', athleteId: a, date, weightKg: kg, healthy: true, ageDivisionAtTime: 'Senior', weightClassKgAtTime: cls, createdAt: '', updatedAt: '', ...extra,
});
const records = [
  w('s1', '2026-11-10', 68.5, 65.8),
  w('s1', '2026-11-12', 67.9, 65.8, { healthy: false, healthReasonId: 'fev', notes: 'secret <b>note</b>' }),
  w('s1', '2026-11-13', 67.0, 65.8),
  w('s2', '2026-11-13', 57.2, 56.7),
  w('y1', '2026-11-12', 73.0, 70.3),
  w('r1', '2026-11-12', 71.0, 70.3),
];
const opts = (p: Partial<ReportOptions>): ReportOptions => ({ ...defaultReportOptions('2026-11-13'), ...p });

describe('reports', () => {
  it('validates options', () => {
    expect(validateReportOptions(opts({ from: '2026-11-13', to: '2026-11-12' }))).toMatch(/before/);
    expect(validateReportOptions(opts({ scope: 'selected', selectedIds: [] }))).toMatch(/Select/);
    expect(validateReportOptions(opts({ scope: 'division' }))).toMatch(/division/);
    expect(validateReportOptions(opts({ from: '2025-01-01' }))).toMatch(/limited/);
    expect(validateReportOptions(opts({}))).toBeNull();
  });

  it('single day, all active athletes: counts + missing', () => {
    const r = buildReport(camp, athletes, records, reasons, opts({}));
    expect(r.days).toEqual(['2026-11-13']);
    expect(r.athletes.map((a) => a.id)).toEqual(['s1', 's2', 'y1']); // sorted by first name, removed excluded
    expect(r.dayCounts['2026-11-13']).toEqual({ RED: 0, YELLOW: 1, GREEN: 1, MISSING: 1 });
    const s1 = r.cells.find((c) => c.athlete.id === 's1')!;
    expect(s1.e?.daily).toMatchObject({ deltaKg: -0.9, days: 1 }); // previous before range is used
  });

  it('range, one athlete: summary with change/min/max/missing/unhealthy', () => {
    const r = buildReport(camp, athletes, records, reasons, opts({ from: '2026-11-10', to: '2026-11-13', scope: 'selected', selectedIds: ['s1'] }));
    expect(r.days).toHaveLength(4);
    const s = r.summaries[0];
    expect(s).toMatchObject({ records: 3, missingDays: 1, changeKg: -1.5, minKg: 67, maxKg: 68.5, unhealthyDays: 1, reasons: ['Fever'] });
    expect(s.lastEval?.status).toBe('YELLOW'); // 67.0 - 65.8 = +1.2
  });

  it('group scopes: division, class, include removed', () => {
    expect(buildReport(camp, athletes, records, reasons, opts({ scope: 'division', division: 'Senior' })).athletes.map((a) => a.id)).toEqual(['s1', 's2']);
    expect(buildReport(camp, athletes, records, reasons, opts({ scope: 'division', division: 'Senior', includeRemoved: true })).athletes).toHaveLength(3);
    expect(buildReport(camp, athletes, records, reasons, opts({ scope: 'class', classKg: 70.3 })).athletes.map((a) => a.id)).toEqual(['y1']);
  });

  it('HTML respects health/notes toggles and escapes user text', () => {
    const base = opts({ from: '2026-11-10', to: '2026-11-13', groupBy: 'athlete' });
    const on = reportBodyHtml(buildReport(camp, athletes, records, reasons, base));
    expect(on).toContain('Fever');
    expect(on).toContain('secret &lt;b&gt;note&lt;/b&gt;');
    expect(on).toContain('Camp &lt;A&gt;');
    expect(on).not.toContain('<b>note</b>');
    const off = reportBodyHtml(buildReport(camp, athletes, records, reasons, { ...base, showHealth: false, showNotes: false }));
    expect(off).not.toContain('Fever');
    expect(off).not.toContain('secret');
    expect(off).not.toContain('confidential');
    const noMissing = reportBodyHtml(buildReport(camp, athletes, records, reasons, { ...base, showMissing: false }));
    expect(noMissing).not.toContain('no weigh-in');
    expect(on).toContain('no weigh-in');
  });

  it('CSV columns follow the toggles', () => {
    const r = buildReport(camp, athletes, records, reasons, opts({ from: '2026-11-12', to: '2026-11-13', showNotes: false, showHealth: false, showMissing: false }));
    const lines = reportCsv(r).replace('﻿', '').trim().split('\r\n');
    expect(lines[0]).toBe('date,athlete_id,first_name,last_name,age_division,weight_class_kg,weight_kg,previous_date,days_since_previous,daily_delta_kg,category_delta_kg,status');
    expect(lines).toHaveLength(1 + 4); // s1×2, y1×1, s2×1 — missing rows omitted
    expect(lines.join()).not.toContain('secret');
    expect(lines[1]).toBe('2026-11-12,s1,Khalid,Mansoori,Senior,65.8,67.9,2026-11-10,2,-0.6,2.1,RED');
  });
});
