/**
 * Persistence layer (IndexedDB via `idb`). The UI never touches IndexedDB directly.
 *
 * Every record has a stable id, createdAt/updatedAt timestamps and a campId so that
 * the data can later be synchronised with a server and extended to multiple camps.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import {
  BACKUP_FORMAT,
  BACKUP_SCHEMA_VERSION,
  DB_SCHEMA_VERSION,
  type Athlete,
  type Camp,
  type HealthReason,
  type ReferenceData,
  type WeighIn,
} from '../lib/types';
import { DEFAULT_REFERENCE } from '../lib/reference';
import { DEFAULT_THRESHOLDS, isValidWeight, roundKg, type Thresholds, validateThresholds } from '../lib/weight';
import { isIsoDate } from '../lib/dates';
import type { BackupFile, RosterAthleteInput } from '../lib/validate';

export const APP_VERSION = '1.0.0';
export const DEFAULT_DB_NAME = 'athlete-weight-monitor';

interface Schema extends DBSchema {
  meta: { key: string; value: unknown };
  camps: { key: string; value: Camp };
  athletes: { key: [string, string]; value: Athlete; indexes: { byCamp: string } };
  weighIns: {
    key: string;
    value: WeighIn;
    indexes: { byCamp: string; byAthleteDay: [string, string, string] };
  };
  healthReasons: { key: string; value: HealthReason; indexes: { byKey: string } };
}

export type DB = IDBPDatabase<Schema>;

export class StorageError extends Error {}

export function friendlyError(e: unknown): string {
  const err = e as { name?: string; message?: string };
  if (err?.name === 'QuotaExceededError') return 'Device storage is full — free space or export a backup, then try again.';
  if (err instanceof StorageError) return err.message;
  if (err?.name === 'ConstraintError') return 'A conflicting record already exists.';
  return `Could not save: ${err?.message || String(e)}`;
}

export function uuid(): string {
  const c = globalThis.crypto as Crypto;
  if (typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const now = () => new Date().toISOString();

export async function openDatabase(name = DEFAULT_DB_NAME): Promise<DB> {
  return openDB<Schema>(name, DB_SCHEMA_VERSION, {
    // Migrations are additive only; never delete stores holding user data.
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('meta');
        db.createObjectStore('camps', { keyPath: 'id' });
        const a = db.createObjectStore('athletes', { keyPath: ['campId', 'id'] });
        a.createIndex('byCamp', 'campId');
        const w = db.createObjectStore('weighIns', { keyPath: 'id' });
        w.createIndex('byCamp', 'campId');
        w.createIndex('byAthleteDay', ['campId', 'athleteId', 'date'], { unique: true });
        const r = db.createObjectStore('healthReasons', { keyPath: 'id' });
        r.createIndex('byKey', 'key', { unique: true });
        // Starter vocabulary (illustrative, user can add more; never deleted automatically)
        const ts = new Date().toISOString();
        for (const label of ['Respiratory infection', 'Gastrointestinal illness', 'Injury', 'Fever', 'Other'])
          r.put({ id: uuid(), label, key: label.toLowerCase(), createdAt: ts, useCount: 0 });
      }
    },
    blocked() {
      // another tab holds an older version open
    },
  });
}

export interface Snapshot {
  camp: Camp | null;
  athletes: Athlete[];
  weighIns: WeighIn[];
  reasons: HealthReason[];
  reference: ReferenceData;
}

export async function loadSnapshot(db: DB): Promise<Snapshot> {
  const tx = db.transaction(['meta', 'camps', 'athletes', 'weighIns', 'healthReasons']);
  const campId = (await tx.objectStore('meta').get('activeCampId')) as string | undefined;
  const reference = ((await tx.objectStore('meta').get('reference')) as ReferenceData | undefined) ?? DEFAULT_REFERENCE;
  const camp = campId ? ((await tx.objectStore('camps').get(campId)) ?? null) : null;
  const athletes = camp ? await tx.objectStore('athletes').index('byCamp').getAll(camp.id) : [];
  const weighIns = camp ? await tx.objectStore('weighIns').index('byCamp').getAll(camp.id) : [];
  const reasons = await tx.objectStore('healthReasons').getAll();
  await tx.done;
  return { camp, athletes, weighIns, reasons, reference };
}

/* ---------------- camp ---------------- */

export async function createCamp(
  db: DB,
  input: { id?: string; name: string; startDate?: string; endDate?: string },
): Promise<Camp> {
  const name = input.name.trim();
  if (!name) throw new StorageError('Camp name is required');
  const camp: Camp = {
    id: input.id?.trim() || `camp-${uuid().slice(0, 8)}`,
    name,
    startDate: input.startDate || undefined,
    endDate: input.endDate || undefined,
    thresholds: { ...DEFAULT_THRESHOLDS },
    createdAt: now(),
    updatedAt: now(),
  };
  const tx = db.transaction(['camps', 'meta'], 'readwrite');
  await tx.objectStore('camps').put(camp);
  await tx.objectStore('meta').put(camp.id, 'activeCampId');
  await tx.done;
  return camp;
}

export async function updateCamp(
  db: DB,
  campId: string,
  patch: Partial<Pick<Camp, 'name' | 'startDate' | 'endDate'>>,
): Promise<Camp> {
  if (patch.name !== undefined && !patch.name.trim()) throw new StorageError('Camp name is required');
  for (const k of ['startDate', 'endDate'] as const)
    if (patch[k] && !isIsoDate(patch[k])) throw new StorageError(`Invalid ${k}`);
  const tx = db.transaction('camps', 'readwrite');
  const c = await tx.store.get(campId);
  if (!c) throw new StorageError('Camp not found');
  const next: Camp = {
    ...c,
    ...patch,
    name: patch.name !== undefined ? patch.name.trim() : c.name,
    startDate: patch.startDate === undefined ? c.startDate : patch.startDate || undefined,
    endDate: patch.endDate === undefined ? c.endDate : patch.endDate || undefined,
    updatedAt: now(),
  };
  await tx.store.put(next);
  await tx.done;
  return next;
}

export async function saveThresholds(db: DB, campId: string, t: Thresholds): Promise<Camp> {
  const err = validateThresholds(t);
  if (err) throw new StorageError(err);
  const tx = db.transaction('camps', 'readwrite');
  const c = await tx.store.get(campId);
  if (!c) throw new StorageError('Camp not found');
  const next = {
    ...c,
    thresholds: { redAboveKg: roundKg(t.redAboveKg), yellowFromKg: roundKg(t.yellowFromKg), yellowEnabled: t.yellowEnabled },
    updatedAt: now(),
  };
  await tx.store.put(next);
  await tx.done;
  return next;
}

/* ---------------- roster ---------------- */

export interface RosterImportResult {
  created: number;
  updated: number;
  unchanged: number;
  reactivated: number;
}

/**
 * Applies a validated roster to the camp in ONE transaction (all-or-nothing).
 * Existing athletes (matched by id) are updated; weigh-in history is never touched.
 * Athletes not present in the file are left as they are.
 */
export async function applyRosterImport(
  db: DB,
  campId: string,
  rows: RosterAthleteInput[],
): Promise<RosterImportResult> {
  const res: RosterImportResult = { created: 0, updated: 0, unchanged: 0, reactivated: 0 };
  const tx = db.transaction('athletes', 'readwrite');
  const ts = now();
  for (const r of rows) {
    const ex = await tx.store.get([campId, r.id]);
    if (!ex) {
      await tx.store.put({ campId, ...r, active: true, createdAt: ts, updatedAt: ts });
      res.created++;
      continue;
    }
    const same =
      ex.firstName === r.firstName &&
      ex.lastName === r.lastName &&
      ex.ageDivision === r.ageDivision &&
      Math.round(ex.weightClassKg * 100) === Math.round(r.weightClassKg * 100);
    if (same && ex.active) {
      res.unchanged++;
      continue;
    }
    if (!ex.active) res.reactivated++;
    else res.updated++;
    await tx.store.put({ ...ex, ...r, active: true, updatedAt: ts });
  }
  await tx.done;
  return res;
}

export async function upsertAthlete(
  db: DB,
  campId: string,
  input: { id?: string; firstName: string; lastName: string; ageDivision: string; weightClassKg: number; excludeFromAttendance?: boolean },
): Promise<Athlete> {
  if (!input.firstName.trim() || !input.lastName.trim()) throw new StorageError('First and last name are required');
  if (!input.ageDivision.trim()) throw new StorageError('Age division is required');
  if (!isValidWeight(input.weightClassKg)) throw new StorageError('Weight class must be a number between 20 and 300 kg');
  const tx = db.transaction('athletes', 'readwrite');
  const id = input.id?.trim() || `athlete-${uuid().slice(0, 8)}`;
  const ex = await tx.store.get([campId, id]);
  const ts = now();
  const a: Athlete = {
    campId,
    id,
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    ageDivision: input.ageDivision.trim(),
    weightClassKg: roundKg(input.weightClassKg),
    active: ex ? ex.active : true,
    excludeFromAttendance: input.excludeFromAttendance ?? ex?.excludeFromAttendance ?? false,
    createdAt: ex?.createdAt ?? ts,
    updatedAt: ts,
  };
  await tx.store.put(a);
  await tx.done;
  return a;
}

export async function setAthleteActive(db: DB, campId: string, id: string, active: boolean): Promise<void> {
  const tx = db.transaction('athletes', 'readwrite');
  const ex = await tx.store.get([campId, id]);
  if (!ex) throw new StorageError('Athlete not found');
  await tx.store.put({ ...ex, active, updatedAt: now() });
  await tx.done;
}

/* ---------------- health reasons ---------------- */

export function reasonKey(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Returns the existing reason with the same normalised label, or creates it. */
export async function addOrGetReason(db: DB, label: string): Promise<HealthReason> {
  const clean = label.trim().replace(/\s+/g, ' ');
  if (!clean) throw new StorageError('Reason cannot be empty');
  if (clean.length > 80) throw new StorageError('Reason is too long (max 80 characters)');
  const key = reasonKey(clean);
  const tx = db.transaction('healthReasons', 'readwrite');
  const ex = await tx.store.index('byKey').get(key);
  if (ex) {
    await tx.done;
    return ex;
  }
  const r: HealthReason = { id: uuid(), label: clean, key, createdAt: now(), useCount: 0 };
  await tx.store.put(r);
  await tx.done;
  return r;
}

/* ---------------- weigh-ins ---------------- */

export interface WeighInInput {
  campId: string;
  athleteId: string;
  date: string;
  weightKg: number;
  healthy: boolean;
  healthReasonId?: string | null;
  notes?: string;
}

/**
 * Creates or corrects the single record for (camp, athlete, day).
 * Snapshots the athlete's current division/class onto the record.
 */
export async function saveWeighIn(db: DB, input: WeighInInput): Promise<{ record: WeighIn; created: boolean }> {
  if (!isValidWeight(input.weightKg)) throw new StorageError('Weight must be between 20 and 300 kg');
  if (!isIsoDate(input.date)) throw new StorageError('Invalid date');
  const tx = db.transaction(['weighIns', 'athletes', 'healthReasons'], 'readwrite');
  const athlete = await tx.objectStore('athletes').get([input.campId, input.athleteId]);
  if (!athlete) throw new StorageError('Athlete not found');
  const store = tx.objectStore('weighIns');
  const ex = await store.index('byAthleteDay').get([input.campId, input.athleteId, input.date]);
  const ts = now();
  const healthReasonId = input.healthy ? null : (input.healthReasonId ?? null);
  const rec: WeighIn = {
    id: ex?.id ?? uuid(),
    campId: input.campId,
    athleteId: input.athleteId,
    date: input.date,
    weightKg: roundKg(input.weightKg),
    healthy: input.healthy,
    healthReasonId,
    notes: input.notes?.trim() || '',
    ageDivisionAtTime: athlete.ageDivision,
    weightClassKgAtTime: athlete.weightClassKg,
    createdAt: ex?.createdAt ?? ts,
    updatedAt: ts,
  };
  await store.put(rec);
  if (healthReasonId && healthReasonId !== ex?.healthReasonId) {
    const rs = tx.objectStore('healthReasons');
    const r = await rs.get(healthReasonId);
    if (!r) throw new StorageError('Health reason not found');
    await rs.put({ ...r, useCount: r.useCount + 1, lastUsedAt: ts });
  }
  await tx.done;
  return { record: rec, created: !ex };
}

export async function deleteWeighIn(db: DB, id: string): Promise<void> {
  await db.delete('weighIns', id);
}

/* ---------------- reference data ---------------- */

export async function saveReference(db: DB, ref: ReferenceData): Promise<void> {
  await db.put('meta', { ...ref, updatedAt: now() }, 'reference');
}

/* ---------------- backup / restore ---------------- */

export async function exportBackup(db: DB): Promise<BackupFile> {
  const s = await loadSnapshot(db);
  if (!s.camp) throw new StorageError('No active camp to export');
  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: now(),
    appVersion: APP_VERSION,
    camp: s.camp,
    athletes: s.athletes,
    weighIns: s.weighIns,
    healthReasons: s.reasons,
    reference: s.reference,
  };
}

/** Replaces ALL local data with the backup, atomically. Caller must validate + confirm first. */
export async function restoreBackup(db: DB, b: BackupFile): Promise<void> {
  const tx = db.transaction(['meta', 'camps', 'athletes', 'weighIns', 'healthReasons'], 'readwrite');
  await Promise.all([
    tx.objectStore('camps').clear(),
    tx.objectStore('athletes').clear(),
    tx.objectStore('weighIns').clear(),
    tx.objectStore('healthReasons').clear(),
  ]);
  await tx.objectStore('camps').put(b.camp);
  for (const a of b.athletes) await tx.objectStore('athletes').put(a);
  for (const r of b.healthReasons) await tx.objectStore('healthReasons').put(r);
  for (const w of b.weighIns) await tx.objectStore('weighIns').put(w);
  await tx.objectStore('meta').put(b.reference, 'reference');
  await tx.objectStore('meta').put(b.camp.id, 'activeCampId');
  await tx.done;
}

/** Ask the browser to keep our storage from being evicted (best effort). */
export async function requestPersistentStorage(): Promise<boolean | null> {
  try {
    if (navigator.storage?.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch {
    /* ignore */
  }
  return null;
}
