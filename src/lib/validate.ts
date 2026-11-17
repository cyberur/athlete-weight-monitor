import { isIsoDate } from './dates';
import {
  BACKUP_FORMAT,
  BACKUP_SCHEMA_VERSION,
  ROSTER_SCHEMA_VERSION,
  type Athlete,
  type Camp,
  type HealthReason,
  type ReferenceData,
  type WeighIn,
} from './types';
import { MAX_VALID_WEIGHT_KG, MIN_VALID_WEIGHT_KG, roundKg, validateThresholds } from './weight';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/* ------------------------------------------------------------------ */
/* Roster import                                                       */
/* ------------------------------------------------------------------ */

export interface RosterAthleteInput {
  id: string;
  firstName: string;
  lastName: string;
  ageDivision: string;
  weightClassKg: number;
}

export interface RosterParseResult {
  ok: boolean;
  fatal?: string;
  camp?: { id: string; name: string; startDate?: string; endDate?: string };
  valid: RosterAthleteInput[];
  invalid: { index: number; id?: string; name?: string; errors: string[] }[];
}

export function parseRoster(text: string): RosterParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { ok: false, fatal: `Not valid JSON: ${(e as Error).message}`, valid: [], invalid: [] };
  }
  if (isObj(data) && data.format === BACKUP_FORMAT)
    return {
      ok: false,
      fatal: 'This is a full backup file, not a roster. Use Settings → Restore backup instead.',
      valid: [],
      invalid: [],
    };
  if (!isObj(data)) return { ok: false, fatal: 'Top level must be a JSON object', valid: [], invalid: [] };
  if (data.schemaVersion !== ROSTER_SCHEMA_VERSION)
    return {
      ok: false,
      fatal: `Unsupported schemaVersion: ${JSON.stringify(data.schemaVersion)} (expected ${ROSTER_SCHEMA_VERSION})`,
      valid: [],
      invalid: [],
    };
  if (!Array.isArray(data.athletes))
    return { ok: false, fatal: '"athletes" must be an array', valid: [], invalid: [] };

  let camp: RosterParseResult['camp'];
  if (data.camp !== undefined) {
    if (!isObj(data.camp) || !nonEmpty(data.camp.id) || !nonEmpty(data.camp.name))
      return { ok: false, fatal: '"camp" must have non-empty string "id" and "name"', valid: [], invalid: [] };
    for (const k of ['startDate', 'endDate'] as const) {
      if (data.camp[k] !== undefined && data.camp[k] !== null && !isIsoDate(data.camp[k]))
        return { ok: false, fatal: `camp.${k} must be a YYYY-MM-DD date`, valid: [], invalid: [] };
    }
    camp = {
      id: data.camp.id.trim(),
      name: data.camp.name.trim(),
      startDate: (data.camp.startDate as string) || undefined,
      endDate: (data.camp.endDate as string) || undefined,
    };
  }

  const valid: RosterAthleteInput[] = [];
  const invalid: RosterParseResult['invalid'] = [];
  const seen = new Map<string, number>();

  data.athletes.forEach((raw, index) => {
    const errors: string[] = [];
    if (!isObj(raw)) {
      invalid.push({ index, errors: ['Record is not an object'] });
      return;
    }
    if (!nonEmpty(raw.id)) errors.push('Missing "id"');
    if (!nonEmpty(raw.firstName)) errors.push('Missing "firstName"');
    if (!nonEmpty(raw.lastName)) errors.push('Missing "lastName"');
    if (!nonEmpty(raw.ageDivision)) errors.push('Missing "ageDivision"');
    if (!isNum(raw.weightClassKg)) errors.push('"weightClassKg" must be a number');
    else if (raw.weightClassKg < MIN_VALID_WEIGHT_KG || raw.weightClassKg > MAX_VALID_WEIGHT_KG)
      errors.push(`"weightClassKg" must be ${MIN_VALID_WEIGHT_KG}–${MAX_VALID_WEIGHT_KG}`);
    const id = nonEmpty(raw.id) ? raw.id.trim() : undefined;
    if (id) {
      if (seen.has(id)) errors.push(`Duplicate id "${id}" (also record #${(seen.get(id) as number) + 1})`);
      else seen.set(id, index);
    }
    const name = [raw.firstName, raw.lastName].filter((x) => typeof x === 'string').join(' ') || undefined;
    if (errors.length) {
      invalid.push({ index, id, name, errors });
      return;
    }
    valid.push({
      id: id as string,
      firstName: (raw.firstName as string).trim(),
      lastName: (raw.lastName as string).trim(),
      ageDivision: (raw.ageDivision as string).trim(),
      weightClassKg: roundKg(raw.weightClassKg as number),
    });
  });

  // a duplicated id invalidates every occurrence after the first; also drop the first to stay safe
  const dupIds = new Set(invalid.filter((i) => i.errors.some((e) => e.startsWith('Duplicate'))).map((i) => i.id));
  const finalValid = valid.filter((v) => {
    if (dupIds.has(v.id)) {
      invalid.push({ index: seen.get(v.id) as number, id: v.id, name: `${v.firstName} ${v.lastName}`, errors: ['Id appears more than once in the file'] });
      return false;
    }
    return true;
  });
  invalid.sort((a, b) => a.index - b.index);

  return { ok: true, camp, valid: finalValid, invalid };
}

export type RosterChange = 'new' | 'updated' | 'unchanged' | 'reactivated';

export interface RosterPreviewRow {
  input: RosterAthleteInput;
  change: RosterChange;
  existing?: Athlete;
  diffs: string[];
}

export function previewRoster(valid: RosterAthleteInput[], existing: Athlete[]): RosterPreviewRow[] {
  const byId = new Map(existing.map((a) => [a.id, a]));
  return valid.map((input) => {
    const ex = byId.get(input.id);
    if (!ex) return { input, change: 'new', diffs: [] };
    const diffs: string[] = [];
    if (ex.firstName !== input.firstName || ex.lastName !== input.lastName)
      diffs.push(`name: ${ex.firstName} ${ex.lastName} → ${input.firstName} ${input.lastName}`);
    if (ex.ageDivision !== input.ageDivision) diffs.push(`division: ${ex.ageDivision} → ${input.ageDivision}`);
    if (Math.round(ex.weightClassKg * 100) !== Math.round(input.weightClassKg * 100))
      diffs.push(`class: ${ex.weightClassKg} → ${input.weightClassKg} kg`);
    const change: RosterChange = !ex.active ? 'reactivated' : diffs.length ? 'updated' : 'unchanged';
    return { input, change, existing: ex, diffs };
  });
}

/* ------------------------------------------------------------------ */
/* Backup                                                              */
/* ------------------------------------------------------------------ */

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  exportedAt: string;
  appVersion: string;
  camp: Camp;
  athletes: Athlete[];
  weighIns: WeighIn[];
  healthReasons: HealthReason[];
  reference: ReferenceData;
}

export interface BackupParseResult {
  ok: boolean;
  errors: string[];
  backup?: BackupFile;
}

export function parseBackup(text: string): BackupParseResult {
  let d: unknown;
  try {
    d = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`Not valid JSON: ${(e as Error).message}`] };
  }
  const errors: string[] = [];
  const fail = (m: string) => {
    if (errors.length < 25) errors.push(m);
  };
  if (!isObj(d)) return { ok: false, errors: ['Top level must be a JSON object'] };
  if (d.format !== BACKUP_FORMAT) {
    if ('athletes' in d && 'schemaVersion' in d && !('weighIns' in d))
      return { ok: false, errors: ['This looks like a roster file, not a backup. Use Roster → Import roster instead.'] };
    return { ok: false, errors: [`Not a backup file (format must be "${BACKUP_FORMAT}")`] };
  }
  if (d.schemaVersion !== BACKUP_SCHEMA_VERSION)
    return { ok: false, errors: [`Incompatible backup schemaVersion ${JSON.stringify(d.schemaVersion)} (this app reads ${BACKUP_SCHEMA_VERSION})`] };

  const camp = d.camp;
  if (!isObj(camp) || !nonEmpty(camp.id) || typeof camp.name !== 'string') fail('camp: missing id or name');
  else {
    const t = camp.thresholds;
    if (!isObj(t) || !isNum(t.redAboveKg) || !isNum(t.yellowFromKg) || typeof t.yellowEnabled !== 'boolean')
      fail('camp.thresholds invalid');
    else {
      const te = validateThresholds(t as never);
      if (te) fail(`camp.thresholds: ${te}`);
    }
    for (const k of ['startDate', 'endDate']) if (camp[k] != null && camp[k] !== '' && !isIsoDate(camp[k])) fail(`camp.${k} invalid date`);
  }
  const campId = isObj(camp) ? camp.id : undefined;

  for (const k of ['athletes', 'weighIns', 'healthReasons'] as const) if (!Array.isArray(d[k])) fail(`"${k}" must be an array`);
  if (!isObj(d.reference) || !Array.isArray((d.reference as Record<string, unknown>).divisions)) fail('"reference" invalid');
  if (errors.length) return { ok: false, errors };

  const athletes = d.athletes as unknown[];
  const athleteIds = new Set<string>();
  athletes.forEach((a, i) => {
    if (!isObj(a)) return fail(`athletes[${i}] not an object`);
    if (!nonEmpty(a.id)) return fail(`athletes[${i}] missing id`);
    if (athleteIds.has(a.id)) fail(`athletes[${i}] duplicate id ${a.id}`);
    athleteIds.add(a.id);
    if (a.campId !== campId) fail(`athletes[${i}] campId does not match camp`);
    if (typeof a.firstName !== 'string' || typeof a.lastName !== 'string') fail(`athletes[${i}] names invalid`);
    if (!nonEmpty(a.ageDivision)) fail(`athletes[${i}] ageDivision invalid`);
    if (!isNum(a.weightClassKg)) fail(`athletes[${i}] weightClassKg invalid`);
    if (typeof a.active !== 'boolean') fail(`athletes[${i}] active must be boolean`);
  });

  const reasons = d.healthReasons as unknown[];
  const reasonIds = new Set<string>();
  reasons.forEach((r, i) => {
    if (!isObj(r) || !nonEmpty(r.id) || !nonEmpty(r.label) || typeof r.key !== 'string') return fail(`healthReasons[${i}] invalid`);
    if (reasonIds.has(r.id)) fail(`healthReasons[${i}] duplicate id`);
    reasonIds.add(r.id);
  });

  const weighIns = d.weighIns as unknown[];
  const wIds = new Set<string>();
  const dayKeys = new Set<string>();
  weighIns.forEach((w, i) => {
    if (!isObj(w)) return fail(`weighIns[${i}] not an object`);
    if (!nonEmpty(w.id)) return fail(`weighIns[${i}] missing id`);
    if (wIds.has(w.id)) fail(`weighIns[${i}] duplicate id`);
    wIds.add(w.id);
    if (w.campId !== campId) fail(`weighIns[${i}] campId does not match camp`);
    if (!nonEmpty(w.athleteId) || !athleteIds.has(w.athleteId)) fail(`weighIns[${i}] references unknown athlete ${String(w.athleteId)}`);
    if (!isIsoDate(w.date)) fail(`weighIns[${i}] invalid date`);
    if (!isNum(w.weightKg) || w.weightKg < MIN_VALID_WEIGHT_KG || w.weightKg > MAX_VALID_WEIGHT_KG) fail(`weighIns[${i}] invalid weight`);
    if (typeof w.healthy !== 'boolean') fail(`weighIns[${i}] healthy must be boolean`);
    if (w.healthReasonId != null && !reasonIds.has(w.healthReasonId as string)) fail(`weighIns[${i}] references unknown health reason`);
    if (!isNum(w.weightClassKgAtTime)) fail(`weighIns[${i}] weightClassKgAtTime invalid`);
    const key = `${String(w.athleteId)}|${String(w.date)}`;
    if (dayKeys.has(key)) fail(`weighIns[${i}] second record for same athlete and day`);
    dayKeys.add(key);
  });

  if (errors.length) return { ok: false, errors };
  return { ok: true, errors: [], backup: d as unknown as BackupFile };
}
