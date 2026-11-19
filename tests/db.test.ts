import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  addOrGetReason,
  applyRosterImport,
  createCamp,
  exportBackup,
  loadSnapshot,
  openDatabase,
  restoreBackup,
  saveThresholds,
  saveWeighIn,
  setAthleteActive,
  upsertAthlete,
} from '../src/db/db';
import { parseBackup, parseRoster, previewRoster } from '../src/lib/validate';
import { buildTeamRows } from '../src/lib/calc';
import { readFileSync } from 'node:fs';

let n = 0;
const fresh = () => openDatabase(`test-${++n}-${Math.random()}`);
const sample = readFileSync(new URL('../samples/sample-roster.json', import.meta.url), 'utf8');

describe('roster import', () => {
  it('parses the sample roster', () => {
    const r = parseRoster(sample);
    expect(r.ok).toBe(true);
    expect(r.valid.length).toBeGreaterThanOrEqual(8);
    expect(r.invalid).toEqual([]);
  });

  it('reports invalid records and fatal schema errors', () => {
    expect(parseRoster('{nope').fatal).toMatch(/JSON/);
    expect(parseRoster('{"schemaVersion":2,"athletes":[]}').fatal).toMatch(/schemaVersion/);
    expect(parseRoster('{"schemaVersion":1}').fatal).toMatch(/athletes/);
    const r = parseRoster(
      JSON.stringify({
        schemaVersion: 1,
        athletes: [
          { id: 'x1', firstName: 'A', lastName: 'B', ageDivision: 'Senior', weightClassKg: 70.3 },
          { id: 'x2', firstName: 'A', lastName: 'B', ageDivision: 'Senior', weightClassKg: '70.3' },
          { id: '', firstName: 'C', lastName: 'D', ageDivision: 'Senior', weightClassKg: 70.3 },
          { id: 'x3', firstName: 'E', lastName: 'F', ageDivision: 'Senior', weightClassKg: 10 },
          { id: 'x4', firstName: 'G', lastName: 'H', ageDivision: 'Senior', weightClassKg: 65.8 },
          { id: 'x4', firstName: 'G2', lastName: 'H2', ageDivision: 'Senior', weightClassKg: 65.8 },
        ],
      }),
    );
    expect(r.valid.map((v) => v.id)).toEqual(['x1']);
    expect(r.invalid).toHaveLength(5);
  });

  it('same name with different ids are two athletes', () => {
    const r = parseRoster(
      JSON.stringify({
        schemaVersion: 1,
        athletes: [
          { id: 'p1', firstName: 'Ali', lastName: 'Hassan', ageDivision: 'Senior', weightClassKg: 70.3 },
          { id: 'p2', firstName: 'Ali', lastName: 'Hassan', ageDivision: 'Junior', weightClassKg: 65.8 },
        ],
      }),
    );
    expect(r.valid).toHaveLength(2);
  });

  it('initial import, repeat import without duplicates, update keeps history', async () => {
    const db = await fresh();
    const camp = await createCamp(db, { name: 'Test camp' });
    const r = parseRoster(sample);
    const first = await applyRosterImport(db, camp.id, r.valid);
    expect(first.created).toBe(r.valid.length);

    let s = await loadSnapshot(db);
    expect(s.athletes).toHaveLength(r.valid.length);
    const a0 = r.valid[0];
    await saveWeighIn(db, { campId: camp.id, athleteId: a0.id, date: '2026-11-16', weightKg: 72.0, healthy: true });

    const again = await applyRosterImport(db, camp.id, r.valid);
    expect(again).toEqual({ created: 0, updated: 0, unchanged: r.valid.length, reactivated: 0 });
    s = await loadSnapshot(db);
    expect(s.athletes).toHaveLength(r.valid.length);

    const changed = r.valid.map((v, i) => (i === 0 ? { ...v, weightClassKg: 77.1, lastName: v.lastName + '-Updated' } : v));
    const prev = previewRoster(changed, s.athletes);
    expect(prev[0].change).toBe('updated');
    expect(prev[1].change).toBe('unchanged');
    const upd = await applyRosterImport(db, camp.id, changed);
    expect(upd.updated).toBe(1);
    s = await loadSnapshot(db);
    expect(s.athletes.find((a) => a.id === a0.id)?.weightClassKg).toBe(77.1);
    expect(s.weighIns).toHaveLength(1);
    expect(s.weighIns[0].weightKg).toBe(72.0);
    expect(s.weighIns[0].weightClassKgAtTime).toBe(a0.weightClassKg); // historical snapshot untouched
  });

  it('exclude-from-attendance flag is saved and survives roster re-import', async () => {
    const db = await fresh();
    const camp = await createCamp(db, { name: 'C' });
    const row = { id: 'z1', firstName: 'Zamzam', lastName: 'Test', ageDivision: 'Senior', weightClassKg: 56.7 };
    await applyRosterImport(db, camp.id, [row]);
    await upsertAthlete(db, camp.id, { ...row, excludeFromAttendance: true });
    await applyRosterImport(db, camp.id, [{ ...row, weightClassKg: 61.2 }]);
    const a = (await loadSnapshot(db)).athletes[0];
    expect(a.excludeFromAttendance).toBe(true);
    expect(a.weightClassKg).toBe(61.2);
    const b = await exportBackup(db);
    expect(parseBackup(JSON.stringify(b)).ok).toBe(true);
    await upsertAthlete(db, camp.id, { ...row, excludeFromAttendance: false });
    expect((await loadSnapshot(db)).athletes[0].excludeFromAttendance).toBe(false);
  });

  it('removing an athlete keeps history; re-import reactivates', async () => {
    const db = await fresh();
    const camp = await createCamp(db, { name: 'C' });
    const a = await upsertAthlete(db, camp.id, { firstName: 'A', lastName: 'B', ageDivision: 'Senior', weightClassKg: 70.3 });
    await saveWeighIn(db, { campId: camp.id, athleteId: a.id, date: '2026-11-16', weightKg: 71, healthy: true });
    await setAthleteActive(db, camp.id, a.id, false);
    let s = await loadSnapshot(db);
    expect(s.athletes[0].active).toBe(false);
    expect(s.weighIns).toHaveLength(1);
    const res = await applyRosterImport(db, camp.id, [{ id: a.id, firstName: 'A', lastName: 'B', ageDivision: 'Senior', weightClassKg: 70.3 }]);
    expect(res.reactivated).toBe(1);
    s = await loadSnapshot(db);
    expect(s.athletes[0].active).toBe(true);
  });
});

describe('weigh-ins', () => {
  it('creates once per day and corrects instead of duplicating', async () => {
    const db = await fresh();
    const camp = await createCamp(db, { name: 'C' });
    const a = await upsertAthlete(db, camp.id, { id: 'a1', firstName: 'A', lastName: 'B', ageDivision: 'Senior', weightClassKg: 70.3 });
    const r1 = await saveWeighIn(db, { campId: camp.id, athleteId: a.id, date: '2026-11-17', weightKg: 73.0, healthy: true });
    expect(r1.created).toBe(true);
    const r2 = await saveWeighIn(db, { campId: camp.id, athleteId: a.id, date: '2026-11-17', weightKg: 72.4, healthy: true });
    expect(r2.created).toBe(false);
    expect(r2.record.id).toBe(r1.record.id);
    const s = await loadSnapshot(db);
    expect(s.weighIns).toHaveLength(1);
    expect(s.weighIns[0].weightKg).toBe(72.4);
    expect(buildTeamRows(s.athletes, s.weighIns, '2026-11-17', s.camp!.thresholds)[0].status).toBe('RED');
  });

  it('rejects weights below 20 kg', async () => {
    const db = await fresh();
    const camp = await createCamp(db, { name: 'C' });
    const a = await upsertAthlete(db, camp.id, { firstName: 'A', lastName: 'B', ageDivision: 'Senior', weightClassKg: 70.3 });
    await expect(saveWeighIn(db, { campId: camp.id, athleteId: a.id, date: '2026-11-17', weightKg: 19.9, healthy: true })).rejects.toThrow(/20/);
    expect((await loadSnapshot(db)).weighIns).toHaveLength(0);
  });

  it('health reasons are de-duplicated and reusable', async () => {
    const db = await fresh();
    const camp = await createCamp(db, { name: 'C' });
    const r1 = await addOrGetReason(db, 'Respiratory infection');
    const r2 = await addOrGetReason(db, '  respiratory   INFECTION ');
    expect(r2.id).toBe(r1.id);
    const a = await upsertAthlete(db, camp.id, { firstName: 'A', lastName: 'B', ageDivision: 'Senior', weightClassKg: 70.3 });
    const b = await upsertAthlete(db, camp.id, { firstName: 'C', lastName: 'D', ageDivision: 'Senior', weightClassKg: 70.3 });
    await saveWeighIn(db, { campId: camp.id, athleteId: a.id, date: '2026-11-17', weightKg: 70, healthy: false, healthReasonId: r1.id, notes: 'cough' });
    await saveWeighIn(db, { campId: camp.id, athleteId: b.id, date: '2026-11-17', weightKg: 70, healthy: false, healthReasonId: r1.id });
    const s = await loadSnapshot(db);
    expect(s.reasons).toHaveLength(5); // starter vocabulary, no duplicate created
    expect(s.reasons.filter((r) => r.key === 'respiratory infection')).toHaveLength(1);
    expect(s.reasons.find((r) => r.id === r1.id)?.useCount).toBe(2);
    const added = await addOrGetReason(db, 'Dehydration');
    expect((await addOrGetReason(db, 'dehydration')).id).toBe(added.id);
    expect((await loadSnapshot(db)).reasons).toHaveLength(6);
    expect(s.weighIns.every((w) => w.healthReasonId === r1.id)).toBe(true);
  });
});

describe('persistence, backup, restore', () => {
  it('data survives closing and reopening the database', async () => {
    const name = `persist-${Math.random()}`;
    let db = await openDatabase(name);
    const camp = await createCamp(db, { name: 'Persist' });
    const a = await upsertAthlete(db, camp.id, { firstName: 'A', lastName: 'B', ageDivision: 'Senior', weightClassKg: 70.3 });
    await saveWeighIn(db, { campId: camp.id, athleteId: a.id, date: '2026-11-17', weightKg: 71.1, healthy: true });
    await saveThresholds(db, camp.id, { redAboveKg: 0.5, yellowFromKg: 0.5, yellowEnabled: false });
    db.close();
    db = await openDatabase(name);
    const s = await loadSnapshot(db);
    expect(s.camp?.name).toBe('Persist');
    expect(s.camp?.thresholds.yellowEnabled).toBe(false);
    expect(s.weighIns[0].weightKg).toBe(71.1);
  });

  it('export → restore into a fresh database reproduces the camp', async () => {
    const db = await fresh();
    const camp = await createCamp(db, { name: 'Round trip', startDate: '2026-11-01' });
    await applyRosterImport(db, camp.id, parseRoster(sample).valid);
    const s0 = await loadSnapshot(db);
    const reason = await addOrGetReason(db, 'Fever');
    await saveWeighIn(db, { campId: camp.id, athleteId: s0.athletes[0].id, date: '2026-11-16', weightKg: 72.2, healthy: true, notes: 'AM' });
    await saveWeighIn(db, { campId: camp.id, athleteId: s0.athletes[0].id, date: '2026-11-17', weightKg: 71.6, healthy: false, healthReasonId: reason.id });
    await saveThresholds(db, camp.id, { redAboveKg: 1.5, yellowFromKg: 0.8, yellowEnabled: true });
    const backup = await exportBackup(db);
    const text = JSON.stringify(backup);

    const parsed = parseBackup(text);
    expect(parsed.ok).toBe(true);
    const db2 = await fresh();
    await restoreBackup(db2, parsed.backup!);
    const a = await loadSnapshot(db);
    const b = await loadSnapshot(db2);
    const sortBy = <T extends { id: string }>(x: T[]) => [...x].sort((p, q) => p.id.localeCompare(q.id));
    expect(b.camp).toEqual(a.camp);
    expect(sortBy(b.athletes)).toEqual(sortBy(a.athletes));
    expect(sortBy(b.weighIns)).toEqual(sortBy(a.weighIns));
    expect(b.reasons).toEqual(a.reasons);
    expect(b.reference).toEqual(a.reference);
  });

  it('restore replaces existing local data atomically', async () => {
    const src = await fresh();
    await createCamp(src, { name: 'Source' });
    const backup = await exportBackup(src);
    const dst = await fresh();
    const c = await createCamp(dst, { name: 'Old' });
    await upsertAthlete(dst, c.id, { firstName: 'Old', lastName: 'Guy', ageDivision: 'Senior', weightClassKg: 70.3 });
    await restoreBackup(dst, backup);
    const s = await loadSnapshot(dst);
    expect(s.camp?.name).toBe('Source');
    expect(s.athletes).toHaveLength(0);
  });

  it('rejects malformed / incompatible backups', async () => {
    const db = await fresh();
    const camp = await createCamp(db, { name: 'X' });
    const a = await upsertAthlete(db, camp.id, { firstName: 'A', lastName: 'B', ageDivision: 'Senior', weightClassKg: 70.3 });
    await saveWeighIn(db, { campId: camp.id, athleteId: a.id, date: '2026-11-17', weightKg: 71, healthy: true });
    const good = await exportBackup(db);

    expect(parseBackup('not json').ok).toBe(false);
    expect(parseBackup('{}').ok).toBe(false);
    expect(parseBackup(sample).errors[0]).toMatch(/roster file/);
    expect(parseBackup(JSON.stringify({ ...good, schemaVersion: 99 })).errors[0]).toMatch(/Incompatible/);
    expect(parseBackup(JSON.stringify({ ...good, weighIns: 'x' })).ok).toBe(false);
    const orphan = { ...good, weighIns: [{ ...good.weighIns[0], athleteId: 'ghost' }] };
    expect(parseBackup(JSON.stringify(orphan)).errors.join()).toMatch(/unknown athlete/);
    const badW = { ...good, weighIns: [{ ...good.weighIns[0], weightKg: 5 }] };
    expect(parseBackup(JSON.stringify(badW)).ok).toBe(false);
    const dup = { ...good, weighIns: [good.weighIns[0], { ...good.weighIns[0], id: 'other' }] };
    expect(parseBackup(JSON.stringify(dup)).errors.join()).toMatch(/same athlete and day/);
    const badT = { ...good, camp: { ...good.camp, thresholds: { redAboveKg: 1, yellowFromKg: 3, yellowEnabled: true } } };
    expect(parseBackup(JSON.stringify(badT)).ok).toBe(false);
    expect(parseRoster(JSON.stringify(good)).fatal).toMatch(/backup/);
  });
});
