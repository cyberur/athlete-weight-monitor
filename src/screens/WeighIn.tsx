import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { go, useApp, useRoute } from '../state';
import { addOrGetReason, saveWeighIn } from '../db/db';
import { dailyDeltaFor, fullName, groupByAthlete, intervalLabel, previousBefore, sortName } from '../lib/calc';
import { kgToKeypad, keypadReduce, parseKeypad, type KeyAction } from '../lib/keypad';
import { categoryDelta, evaluateStatus, fmtKg, fmtSigned, isValidWeight, weightError } from '../lib/weight';
import { fmtDate, isIsoDate } from '../lib/dates';
import { classLabel } from '../lib/reference';
import { Empty, StatusBadge, Toggle } from '../ui/components';
import { HealthReasonPicker } from '../ui/HealthReasonPicker';
import type { Athlete } from '../lib/types';

export function WeighInScreen() {
  const { snap, today, run, toast } = useApp();
  const route = useRoute();
  const camp = snap.camp!;
  const athletes = useMemo(
    () => snap.athletes.filter((a) => a.active).sort((a, b) => sortName(a).localeCompare(sortName(b))),
    [snap.athletes],
  );
  const byAthlete = useMemo(() => groupByAthlete(snap.weighIns), [snap.weighIns]);

  const qAthlete = route.query.get('athlete');
  const qDate = route.query.get('date');
  const returnTo = route.query.get('return');
  const [date, setDate] = useState(qDate && isIsoDate(qDate) ? qDate : today);
  const [selectedId, setSelectedId] = useState<string | null>(qAthlete ?? null);
  const [value, setValue] = useState('');
  const [healthy, setHealthy] = useState(true);
  const [reasonId, setReasonId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [pendingOnly, setPendingOnly] = useState(false);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState<string | null>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);

  // sync with route params (e.g. "Edit" from history)
  useEffect(() => {
    if (qAthlete) setSelectedId(qAthlete);
    if (qDate && isIsoDate(qDate)) setDate(qDate);
  }, [qAthlete, qDate]);

  // default selection: first athlete without a record for the date
  useEffect(() => {
    if (selectedId && snap.athletes.some((a) => a.id === selectedId)) return;
    if (qAthlete && snap.athletes.some((a) => a.id === qAthlete)) return setSelectedId(qAthlete);
    if (!athletes.length) return;
    const first = athletes.find((a) => !(byAthlete.get(a.id) ?? []).some((w) => w.date === date)) ?? athletes[0];
    setSelectedId(first?.id ?? null);
  }, [athletes, byAthlete, date, selectedId, snap.athletes, qAthlete]);

  const athlete = snap.athletes.find((a) => a.id === selectedId) ?? null;
  const history = useMemo(() => (athlete ? (byAthlete.get(athlete.id) ?? []) : []), [athlete, byAthlete]);
  const existing = history.find((w) => w.date === date) ?? null;

  // load the existing record (or reset) when athlete/date changes
  useEffect(() => {
    if (existing) {
      setValue(kgToKeypad(existing.weightKg));
      setHealthy(existing.healthy);
      setReasonId(existing.healthReasonId ?? null);
      setNotes(existing.notes ?? '');
      setShowNotes(!!existing.notes);
    } else {
      setValue('');
      setHealthy(true);
      setReasonId(null);
      setNotes('');
      setShowNotes(false);
    }
    // only when the identity of the record changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [athlete?.id, date, existing?.id]);

  const weight = parseKeypad(value);
  const valid = isValidWeight(weight);
  const err = value ? weightError(weight) : null;
  const prev = previousBefore(history, date);
  const daily = valid ? dailyDeltaFor(history, date, weight) : null;
  // Saving (or re-saving) snapshots the athlete's current class onto the record.
  const classKg = athlete?.weightClassKg;
  const catDelta = valid && classKg !== undefined ? categoryDelta(weight, classKg) : null;
  const status = catDelta !== null ? evaluateStatus(catDelta, camp.thresholds) : null;
  const dirty =
    !existing ||
    value !== kgToKeypad(existing.weightKg) ||
    healthy !== existing.healthy ||
    (reasonId ?? null) !== (existing.healthReasonId ?? null) ||
    notes.trim() !== (existing.notes ?? '');

  const doneIds = useMemo(
    () => new Set(snap.weighIns.filter((w) => w.date === date).map((w) => w.athleteId)),
    [snap.weighIns, date],
  );
  const doneCount = athletes.filter((a) => doneIds.has(a.id)).length;

  const press = useCallback((a: KeyAction) => setValue((v) => keypadReduce(v, a)), []);

  const nextAthlete = useCallback(
    (fromId: string, done: Set<string>): Athlete | null => {
      const i = athletes.findIndex((a) => a.id === fromId);
      for (let k = 1; k <= athletes.length; k++) {
        const a = athletes[(i + k) % athletes.length];
        if (!done.has(a.id)) return a;
      }
      return null;
    },
    [athletes],
  );

  const save = useCallback(async () => {
    if (!athlete || !valid || saving) return;
    setSaving(true);
    const res = await run((d) =>
      saveWeighIn(d, {
        campId: camp.id,
        athleteId: athlete.id,
        date,
        weightKg: weight,
        healthy,
        healthReasonId: healthy ? null : reasonId,
        notes,
      }),
    );
    setSaving(false);
    if (!res) return;
    const msg = `${res.created ? 'Saved' : 'Updated'} ${fullName(athlete)} — ${fmtKg(res.record.weightKg)} kg`;
    toast('ok', msg);
    setJustSaved(msg);
    if (returnTo === 'history') {
      go(`athlete/${encodeURIComponent(athlete.id)}`);
      return;
    }
    const done = new Set(doneIds);
    done.add(athlete.id);
    const nxt = nextAthlete(athlete.id, done);
    if (nxt) setSelectedId(nxt.id);
    else toast('info', 'All active athletes have a weigh-in for this date');
  }, [athlete, valid, saving, run, camp.id, date, weight, healthy, reasonId, notes, toast, returnTo, doneIds, nextAthlete]);

  // physical keyboard support (iPad keyboards, desktop testing)
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (/^[0-9]$/.test(e.key)) press({ type: 'digit', d: e.key });
      else if (e.key === '.' || e.key === ',') press({ type: 'dot' });
      else if (e.key === 'Backspace') press({ type: 'back' });
      else if (e.key === 'Escape') press({ type: 'clear' });
      else if (e.key === 'Enter') save();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [press, save]);

  if (!athletes.length && !athlete)
    return (
      <Empty title="No athletes in the roster">
        <p>Import a roster JSON file or add athletes manually.</p>
        <button className="btn btn-primary" onClick={() => go('roster')}>
          Go to Roster
        </button>
      </Empty>
    );

  const filtered = athletes.filter(
    (a) =>
      (!pendingOnly || !doneIds.has(a.id)) &&
      (!search || fullName(a).toLowerCase().includes(search.toLowerCase()) || a.id.toLowerCase().includes(search.toLowerCase())),
  );
  const idx = athlete ? athletes.findIndex((a) => a.id === athlete.id) : -1;
  const step = (d: number) => {
    if (!athletes.length) return;
    const i = (idx + d + athletes.length) % athletes.length;
    setSelectedId(athletes[i].id);
  };
  const prevRecord = prev;
  const isToday = date === today;

  const list = (
    <div className="ath-list">
      <div className="ath-list-tools">
        <input
          type="search"
          placeholder="Search athlete"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search athlete"
        />
        <button className={`chip ${pendingOnly ? 'chip-on' : ''}`} onClick={() => setPendingOnly(!pendingOnly)}>
          Pending
        </button>
      </div>
      <ul>
        {filtered.map((a) => {
          const rec = (byAthlete.get(a.id) ?? []).find((w) => w.date === date);
          const st = rec ? evaluateStatus(categoryDelta(rec.weightKg, rec.weightClassKgAtTime), camp.thresholds) : null;
          return (
            <li key={a.id}>
              <button
                className={`ath-item ${a.id === athlete?.id ? 'ath-item-on' : ''}`}
                onClick={() => {
                  setSelectedId(a.id);
                  setListOpen(false);
                }}
                data-testid={`pick-${a.id}`}
              >
                <span className="ath-item-name">
                  {a.lastName}, {a.firstName}
                  <small>
                    {a.ageDivision} · {fmtKg(a.weightClassKg)}
                  </small>
                </span>
                {rec ? (
                  <span className="ath-item-val">
                    {fmtKg(rec.weightKg)}
                    <StatusBadge status={st!} size="sm" />
                  </span>
                ) : (
                  <span className="ath-item-pending">pending</span>
                )}
              </button>
            </li>
          );
        })}
        {!filtered.length && <li className="muted pad">No matching athletes</li>}
      </ul>
    </div>
  );

  return (
    <div className="weigh">
      <aside className="weigh-side">{list}</aside>

      <section className="weigh-main">
        <div className="weigh-topline">
          <div className="weigh-date">
            <input
              type="date"
              value={date}
              max={today}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              aria-label="Weigh-in date"
            />
            {!isToday && (
              <button className="chip chip-warn" onClick={() => setDate(today)}>
                Not today · back to today
              </button>
            )}
          </div>
          <span className="progress" data-testid="progress">
            {doneCount}/{athletes.length} weighed
          </span>
        </div>

        <div className="ath-bar">
          <button className="icon-btn big" onClick={() => step(-1)} aria-label="Previous athlete">
            ‹
          </button>
          <button className="ath-bar-name" onClick={() => setListOpen(true)} data-testid="athlete-picker" data-athlete-id={athlete?.id ?? ""}>
            <strong data-testid="current-athlete">{athlete ? fullName(athlete) : 'Select athlete'}</strong>
            {athlete && (
              <span>
                {athlete.ageDivision} · {classLabel(snap.reference, athlete.ageDivision, athlete.weightClassKg)}
                {!athlete.active && ' · removed from roster'}
              </span>
            )}
          </button>
          <button className="icon-btn big" onClick={() => step(1)} aria-label="Next athlete">
            ›
          </button>
        </div>

        {athlete && (
          <>
            <div className={`mode ${existing ? 'mode-edit' : 'mode-new'}`} data-testid="mode">
              {existing
                ? `EDITING saved record · ${fmtDate(date, { weekday: true })} · saved ${new Date(existing.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                : `NEW weigh-in · ${fmtDate(date, { weekday: true })}`}
            </div>

            <div className="weigh-grid">
              <div className="weigh-info">
                <div className={`readout ${err ? 'readout-err' : ''}`}>
                  <span className="readout-val" data-testid="readout">
                    {value || <span className="placeholder">––.–</span>}
                  </span>
                  <span className="readout-unit">kg</span>
                  {status && <StatusBadge status={status} size="lg" />}
                </div>
                {err && (
                  <div className="readout-msg" role="alert">
                    {err}
                  </div>
                )}

                <div className="deltas">
                  <div className="delta">
                    <span className="delta-k">Previous</span>
                    <span className="delta-v">{prevRecord ? `${fmtKg(prevRecord.weightKg)} kg` : '—'}</span>
                    <span className="delta-s">{prevRecord ? fmtDate(prevRecord.date) : 'no earlier record'}</span>
                  </div>
                  <div className="delta">
                    <span className="delta-k">Change</span>
                    <span className="delta-v" data-testid="daily-delta">
                      {daily ? `${fmtSigned(daily.deltaKg)} kg` : '—'}
                    </span>
                    <span className={`delta-s ${daily && daily.days > 1 ? 'delta-gap' : ''}`}>
                      {daily ? intervalLabel(daily) : prevRecord ? 'enter weight' : 'no previous'}
                    </span>
                  </div>
                  <div className={`delta delta-cat ${status ? 'cat-' + status.toLowerCase() : ''}`}>
                    <span className="delta-k">Vs limit</span>
                    <span className="delta-v" data-testid="category-delta">
                      {catDelta !== null ? `${fmtSigned(catDelta)} kg` : '—'}
                    </span>
                    <span className="delta-s">
                      limit {fmtKg(classKg)}
                      {catDelta === null ? '' : catDelta > 0 ? ' · above' : catDelta < 0 ? ' · below' : ' · at limit'}
                    </span>
                  </div>
                </div>

                <div className="health">
                  <Toggle checked={healthy} onChange={setHealthy} label={healthy ? 'Healthy' : 'Not healthy'} testId="healthy" />
                  {prevRecord && !prevRecord.healthy && (
                    <span className="hint">
                      Last record ({fmtDate(prevRecord.date)}): not healthy
                      {prevRecord.healthReasonId
                        ? ` — ${snap.reasons.find((r) => r.id === prevRecord.healthReasonId)?.label ?? ''}`
                        : ''}
                    </span>
                  )}
                  {!healthy && (
                    <HealthReasonPicker
                      reasons={snap.reasons}
                      value={reasonId}
                      onChange={setReasonId}
                      onCreate={async (label) => {
                        const r = await run((d) => addOrGetReason(d, label));
                        if (r) setReasonId(r.id);
                      }}
                    />
                  )}
                  {showNotes ? (
                    <textarea
                      ref={notesRef}
                      className="notes"
                      placeholder="Notes (optional)"
                      value={notes}
                      rows={2}
                      maxLength={500}
                      onChange={(e) => setNotes(e.target.value)}
                      onFocus={() => setTimeout(() => notesRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300)}
                      data-testid="notes"
                    />
                  ) : (
                    <button className="link-btn" onClick={() => setShowNotes(true)}>
                      + Add note
                    </button>
                  )}
                </div>
              </div>

              <div className="weigh-pad">
                <Keypad onKey={press}>
                  <button
                    className="btn btn-primary btn-save"
                    disabled={!valid || saving || (!!existing && !dirty)}
                    onClick={save}
                    data-testid="save"
                  >
                    {returnTo === 'history'
                      ? 'Save correction'
                      : existing
                        ? dirty
                          ? 'Update & Next'
                          : 'Saved ✓'
                        : 'Save & Next'}
                  </button>
                </Keypad>
                {existing && !dirty && returnTo !== 'history' && (
                  <button
                    className="btn btn-ghost"
                    onClick={() => {
                      const n = nextAthlete(athlete.id, new Set([...doneIds]));
                      if (n) setSelectedId(n.id);
                    }}
                  >
                    Skip to next pending
                  </button>
                )}
                {justSaved && <div className="saved-line" data-testid="last-saved">Last: {justSaved}</div>}
              </div>
            </div>
          </>
        )}
      </section>

      {listOpen && (
        <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setListOpen(false)}>
          <div className="sheet" role="dialog" aria-label="Select athlete">
            <div className="sheet-head">
              <strong>Select athlete</strong>
              <button className="icon-btn" onClick={() => setListOpen(false)} aria-label="Close">
                ✕
              </button>
            </div>
            {list}
          </div>
        </div>
      )}
    </div>
  );
}

const KEYS: { k: string; a: KeyAction; cls?: string; label?: string }[] = [
  { k: '7', a: { type: 'digit', d: '7' } },
  { k: '8', a: { type: 'digit', d: '8' } },
  { k: '9', a: { type: 'digit', d: '9' } },
  { k: 'back', a: { type: 'back' }, cls: 'key-fn key-back', label: '⌫' },
  { k: '4', a: { type: 'digit', d: '4' } },
  { k: '5', a: { type: 'digit', d: '5' } },
  { k: '6', a: { type: 'digit', d: '6' } },
  { k: '1', a: { type: 'digit', d: '1' } },
  { k: '2', a: { type: 'digit', d: '2' } },
  { k: '3', a: { type: 'digit', d: '3' } },
  { k: 'clear', a: { type: 'clear' }, cls: 'key-fn key-clear', label: 'Clear' },
  { k: '0', a: { type: 'digit', d: '0' }, cls: 'key-zero' },
  { k: 'dot', a: { type: 'dot' }, label: '.' },
];

export function Keypad({ onKey, children }: { onKey: (a: KeyAction) => void; children?: React.ReactNode }) {
  return (
    <div className="keypad" role="group" aria-label="Weight keypad">
      {KEYS.map((x) => (
        <button
          key={x.k}
          type="button"
          className={`key ${x.cls ?? ''}`}
          style={{ gridArea: `k${x.k}` }}
          onClick={() => onKey(x.a)}
          data-testid={`key-${x.k}`}
          aria-label={x.k === 'back' ? 'Backspace' : x.k === 'dot' ? 'Decimal point' : x.label ?? x.k}
        >
          {x.label ?? x.k}
        </button>
      ))}
      {children}
    </div>
  );
}
