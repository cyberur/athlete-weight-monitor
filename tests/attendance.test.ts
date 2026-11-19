import { describe, expect, it } from 'vitest';
import { attendanceHtml, attendanceText, buildAttendance, groupOf } from '../src/lib/attendance';
import type { Athlete, Camp, WeighIn } from '../src/lib/types';

const camp: Camp = { id: 'c', name: 'UAE Camp', thresholds: { redAboveKg: 2, yellowFromKg: 1, yellowEnabled: true }, createdAt: '', updatedAt: '' };
const a = (id: string, f: string, l: string, div: string, kg: number, active = true): Athlete => ({
  campId: 'c', id, firstName: f, lastName: l, ageDivision: div, weightClassKg: kg, active, createdAt: '', updatedAt: '',
});
const athletes = [
  a('m', 'Mustafa', 'Almaqboul', 'Youth B', 44),
  a('h', 'Hamed', 'Alharbi', 'Youth D', 57),
  a('s', 'Saif', 'Hammad', 'Youth D', 57),
  a('g', 'Ghalia', 'Alhammadi', 'Youth A', 52.2),
  a('y', 'Yousef', 'Almohsen', 'Senior', 65.8),
  a('j', 'Sultan', 'Alghusain', 'Junior', 70.3),
  a('x', 'Gone', 'Removed', 'Senior', 70.3, false),
];
const w = (id: string, date: string): WeighIn => ({
  id: id + date, campId: 'c', athleteId: id, date, weightKg: 50, healthy: true, ageDivisionAtTime: athletes.find((x) => x.id === id)!.ageDivision,
  weightClassKgAtTime: athletes.find((x) => x.id === id)!.weightClassKg, createdAt: '', updatedAt: '',
});
const recs = [w('m', '2026-11-19'), w('h', '2026-11-19'), w('y', '2026-11-19'), w('j', '2026-11-19'), w('g', '2026-11-18')];

describe('attendance', () => {
  it('groups', () => {
    expect(groupOf('Youth C')).toBe('Youth');
    expect(groupOf('Junior')).toBe('Junior');
    expect(groupOf('Masters')).toBe('Masters');
  });

  it('present = weighed in that day; groups Youth→Junior→Senior; youth sorted D→A', () => {
    const r = buildAttendance(camp, athletes, recs, '2026-11-19');
    expect(r.presentCount).toBe(4);
    expect(r.rosterCount).toBe(6);
    expect(r.groups.map((g) => g.group)).toEqual(['Youth', 'Junior', 'Senior']);
    expect(r.groups[0].present.map((e) => e.athlete.id)).toEqual(['h', 'm']); // Youth D before Youth B
    expect(r.groups[0].absent.map((e) => e.athlete.id)).toEqual(['s', 'g']);
    expect(r.groups[2].absent.map((e) => e.athlete.id)).toEqual([]); // removed athlete not listed as absent
  });

  it('html names the date and purpose; absent only when asked', () => {
    const r = buildAttendance(camp, athletes, recs, '2026-11-19');
    const h = attendanceHtml(r, { showAbsent: false, showClass: true });
    expect(h).toContain('ATTENDANCE');
    expect(h).toContain('Thu 19 Nov 2026');
    expect(h).toContain('List of athletes present at training');
    expect(h).toContain('Present: <b>4</b> of 6');
    expect(h).not.toContain('Saif Hammad');
    expect(attendanceHtml(r, { showAbsent: true, showClass: true })).toContain('Saif Hammad');
  });

  it('WhatsApp text', () => {
    const t = attendanceText(buildAttendance(camp, athletes, recs, '2026-11-19'), { showAbsent: false, showClass: true });
    expect(t.split('\n')).toEqual([
      '*Attendance* 19/11/26 (Thu 19 Nov)',
      'Athletes present at training: 4 of 6',
      '',
      '*Youth* (2)',
      '1. D / Hamed Alharbi / 57 kg ✅',
      '2. B / Mustafa Almaqboul / 44 kg ✅',
      '',
      '*Junior* (1)',
      '1. Junior / Sultan Alghusain / 70.3 kg ✅',
      '',
      '*Senior* (1)',
      '1. Senior / Yousef Almohsen / 65.8 kg ✅',
    ]);
  });
});
