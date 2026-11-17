import type { Thresholds } from './weight';

export const DB_SCHEMA_VERSION = 1;
export const BACKUP_FORMAT = 'athlete-weight-monitor-backup';
export const BACKUP_SCHEMA_VERSION = 1;
export const ROSTER_SCHEMA_VERSION = 1;

export interface Camp {
  id: string;
  name: string;
  startDate?: string; // YYYY-MM-DD
  endDate?: string;
  thresholds: Thresholds;
  createdAt: string; // ISO timestamp
  updatedAt: string;
}

export interface Athlete {
  campId: string;
  id: string; // stable athlete identifier (from roster file or generated)
  firstName: string;
  lastName: string;
  ageDivision: string;
  weightClassKg: number;
  active: boolean; // false = removed from active roster, history kept
  createdAt: string;
  updatedAt: string;
}

export interface WeighIn {
  id: string; // uuid
  campId: string;
  athleteId: string;
  date: string; // camp-local calendar day YYYY-MM-DD
  weightKg: number;
  healthy: boolean;
  healthReasonId?: string | null;
  notes?: string;
  /** Snapshot of the athlete's category when the record was (last) saved. */
  ageDivisionAtTime: string;
  weightClassKgAtTime: number;
  createdAt: string;
  updatedAt: string;
}

export interface HealthReason {
  id: string;
  label: string;
  key: string; // normalised label for de-duplication
  createdAt: string;
  lastUsedAt?: string;
  useCount: number;
}

export interface WeightClassRef {
  kg: number;
  label: string; // e.g. "Lightweight" or "-57 kg"
  sex?: 'M' | 'F' | 'MF';
}

export interface DivisionRef {
  name: string; // "Senior"
  ages: string; // "18+"
  classes: WeightClassRef[];
  note?: string;
}

export interface ReferenceData {
  version: number;
  source: string;
  divisions: DivisionRef[];
  updatedAt: string;
}
