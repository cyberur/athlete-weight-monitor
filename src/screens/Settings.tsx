import { useEffect, useState } from 'react';
import { useApp } from '../state';
import { APP_VERSION, exportBackup, restoreBackup, saveReference, saveThresholds, updateCamp } from '../db/db';
import { describeRules, validateThresholds, fmtSigned, type Thresholds } from '../lib/weight';
import { parseBackup, type BackupFile } from '../lib/validate';
import { weighInsToCsv } from '../lib/csv';
import { canShareFiles, downloadText, safeName, shareText, stamp } from '../lib/download';
import { DEFAULT_REFERENCE } from '../lib/reference';
import { Modal, StatusBadge, Toggle, pickFile } from '../ui/components';
import { fmtDate } from '../lib/dates';
import type { DivisionRef, ReferenceData } from '../lib/types';

export function SettingsScreen() {
  return (
    <div className="settings">
      <h1>Settings</h1>
      <CampSection />
      <ThresholdSection />
      <DataSection />
      <ReferenceSection />
      <AboutSection />
    </div>
  );
}

function CampSection() {
  const { snap, run } = useApp();
  const camp = snap.camp!;
  const [name, setName] = useState(camp.name);
  const [start, setStart] = useState(camp.startDate ?? '');
  const [end, setEnd] = useState(camp.endDate ?? '');
  useEffect(() => {
    setName(camp.name);
    setStart(camp.startDate ?? '');
    setEnd(camp.endDate ?? '');
  }, [camp]);
  const dirty = name !== camp.name || start !== (camp.startDate ?? '') || end !== (camp.endDate ?? '');
  return (
    <section className="card">
      <h2>Training camp</h2>
      <div className="form form-row">
        <label>
          Camp name
          <input value={name} onChange={(e) => setName(e.target.value)} data-testid="camp-name" />
        </label>
        <label>
          Start date
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label>
          End date
          <input type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>
      <div className="row-gap">
        <button
          className="btn btn-primary"
          disabled={!dirty || !name.trim()}
          onClick={() => run((d) => updateCamp(d, camp.id, { name, startDate: start, endDate: end }), 'Camp updated')}
          data-testid="camp-save"
        >
          Save camp
        </button>
        <span className="muted small">Camp ID: {camp.id}</span>
      </div>
    </section>
  );
}

function ThresholdSection() {
  const { snap, run } = useApp();
  const camp = snap.camp!;
  const t = camp.thresholds;
  const [red, setRed] = useState(String(t.redAboveKg));
  const [yellow, setYellow] = useState(String(t.yellowFromKg));
  const [yEnabled, setYEnabled] = useState(t.yellowEnabled);
  useEffect(() => {
    setRed(String(t.redAboveKg));
    setYellow(String(t.yellowFromKg));
    setYEnabled(t.yellowEnabled);
  }, [t.redAboveKg, t.yellowFromKg, t.yellowEnabled]);

  const draft: Thresholds = { redAboveKg: Number(red.replace(',', '.')), yellowFromKg: Number(yellow.replace(',', '.')), yellowEnabled: yEnabled };
  const err = red.trim() === '' || (yEnabled && yellow.trim() === '') ? 'Enter both thresholds' : validateThresholds(draft);
  const dirty = draft.redAboveKg !== t.redAboveKg || draft.yellowFromKg !== t.yellowFromKg || draft.yellowEnabled !== t.yellowEnabled;
  const apply = (x: Thresholds) => run((d) => saveThresholds(d, camp.id, x), 'Thresholds applied — all statuses updated');

  return (
    <section className="card" data-testid="thresholds">
      <h2>Weight-control status</h2>
      <p className="small muted">Status is calculated from the category delta (weight − class limit). Changes apply immediately to every displayed record; recorded weights never change.</p>
      <div className="form form-row">
        <label>
          RED when category Δ is greater than (kg)
          <input inputMode="decimal" value={red} onChange={(e) => setRed(e.target.value)} data-testid="t-red" />
        </label>
        <label className={yEnabled ? '' : 'disabled'}>
          YELLOW from category Δ of (kg)
          <input inputMode="decimal" value={yellow} disabled={!yEnabled} onChange={(e) => setYellow(e.target.value)} data-testid="t-yellow" />
        </label>
        <div className="toggle-wrap">
          <Toggle checked={yEnabled} onChange={setYEnabled} label="Yellow zone enabled" testId="t-yellow-enabled" />
        </div>
      </div>
      {err ? <p className="error-text">{err}</p> : null}
      <div className="rules" data-testid="rules-preview">
        <div className="small muted">{dirty ? 'Preview (not yet applied):' : 'Active rules:'}</div>
        {!err &&
          describeRules(draft).map((r) => (
            <div key={r.status} className="rule">
              <StatusBadge status={r.status} size="sm" /> <span>{r.rule}</span>
            </div>
          ))}
        <div className="rule">
          <StatusBadge status="MISSING" size="sm" /> <span>No weigh-in recorded for the date</span>
        </div>
      </div>
      <div className="row-gap">
        <button className="btn btn-primary" disabled={!!err || !dirty} onClick={() => apply(draft)} data-testid="t-apply">
          Apply thresholds
        </button>
        <button className="btn btn-sm" onClick={() => apply({ redAboveKg: 2, yellowFromKg: 1, yellowEnabled: true })}>
          Preset: 3 zones ({fmtSigned(2)} / {fmtSigned(1)})
        </button>
        <button className="btn btn-sm" onClick={() => apply({ redAboveKg: 0.5, yellowFromKg: 0.5, yellowEnabled: false })}>
          Preset: 2 zones ({fmtSigned(0.5)})
        </button>
      </div>
    </section>
  );
}

function DataSection() {
  const { snap, db, toast, run } = useApp();
  const camp = snap.camp!;
  const [restore, setRestore] = useState<{ file: string; backup: BackupFile } | null>(null);
  const [restoreErr, setRestoreErr] = useState<string[] | null>(null);
  const [ack, setAck] = useState(false);
  const share = canShareFiles();

  const backupText = async () => JSON.stringify(await exportBackup(db), null, 2);
  const backupName = () => `awm-backup_${safeName(camp.name)}_${stamp()}.json`;
  const csvName = () => `awm-weighins_${safeName(camp.name)}_${stamp()}.csv`;
  const csvText = () => weighInsToCsv(camp, snap.athletes, snap.weighIns, snap.reasons);

  const guarded = async (f: () => Promise<unknown>) => {
    try {
      await f();
    } catch (e) {
      toast('error', `Export failed: ${(e as Error).message}`);
    }
  };

  return (
    <section className="card">
      <h2>Backup, restore &amp; export</h2>
      <p className="small muted">
        Data lives only on this device, in the browser's storage for this app. Export a full backup regularly (e.g. daily) and keep it somewhere safe —
        browser storage can be cleared by iOS or by removing the app. Backups contain health information: store and share them accordingly.
      </p>
      <div className="data-grid">
        <div>
          <h3>Full backup (JSON)</h3>
          <p className="small muted">
            Camp, roster, {snap.weighIns.length} weigh-ins, thresholds, health reasons, notes and category reference data.
          </p>
          <div className="row-gap">
            <button className="btn btn-primary" onClick={() => guarded(async () => (downloadText(backupName(), await backupText(), 'application/json'), toast('ok', 'Backup downloaded')))} data-testid="export-backup">
              Download backup
            </button>
            {share && (
              <button className="btn" onClick={() => guarded(async () => void (await shareText(backupName(), await backupText(), 'application/json')))}>
                Share / Save to Files…
              </button>
            )}
          </div>
        </div>
        <div>
          <h3>Weigh-ins (CSV)</h3>
          <p className="small muted">Comma-separated, dot decimals, ISO dates (YYYY-MM-DD), UTF-8. Status uses the current thresholds.</p>
          <div className="row-gap">
            <button className="btn" disabled={!snap.weighIns.length} onClick={() => guarded(async () => (downloadText(csvName(), csvText(), 'text/csv;charset=utf-8'), toast('ok', 'CSV downloaded')))} data-testid="export-csv">
              Download CSV
            </button>
            {share && (
              <button className="btn" disabled={!snap.weighIns.length} onClick={() => guarded(async () => void (await shareText(csvName(), csvText(), 'text/csv')))}>
                Share CSV…
              </button>
            )}
          </div>
        </div>
        <div>
          <h3>Restore from backup</h3>
          <p className="small muted">Replaces ALL data on this device with the backup. Not the same as roster import.</p>
          <button
            className="btn btn-danger-outline"
            data-testid="restore-backup"
            onClick={async () => {
              const f = await pickFile();
              if (!f) return;
              const r = parseBackup(f.text);
              if (!r.ok) setRestoreErr(r.errors);
              else {
                setAck(false);
                setRestore({ file: f.name, backup: r.backup! });
              }
            }}
          >
            Restore backup…
          </button>
        </div>
      </div>

      {restoreErr && (
        <Modal title="Backup rejected" onClose={() => setRestoreErr(null)} footer={<button className="btn" onClick={() => setRestoreErr(null)}>OK</button>}>
          <p>The file cannot be restored. Nothing was changed.</p>
          <ul className="error-text small" data-testid="restore-errors">
            {restoreErr.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </Modal>
      )}

      {restore && (
        <Modal
          title="Replace all local data?"
          onClose={() => setRestore(null)}
          footer={
            <>
              <button className="btn" onClick={() => setRestore(null)}>
                Cancel
              </button>
              <button
                className="btn btn-danger"
                disabled={!ack}
                data-testid="confirm-restore"
                onClick={async () => {
                  const ok = await run(async (d) => (await restoreBackup(d, restore.backup), true), 'Backup restored');
                  if (ok) setRestore(null);
                }}
              >
                Replace and restore
              </button>
            </>
          }
        >
          <table className="compare">
            <thead>
              <tr>
                <th />
                <th>On this device</th>
                <th>In backup</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Camp</td>
                <td>{camp.name}</td>
                <td>{restore.backup.camp.name}</td>
              </tr>
              <tr>
                <td>Athletes</td>
                <td>{snap.athletes.length}</td>
                <td>{restore.backup.athletes.length}</td>
              </tr>
              <tr>
                <td>Weigh-ins</td>
                <td>{snap.weighIns.length}</td>
                <td>{restore.backup.weighIns.length}</td>
              </tr>
              <tr>
                <td>Exported</td>
                <td />
                <td>{new Date(restore.backup.exportedAt).toLocaleString()}</td>
              </tr>
            </tbody>
          </table>
          <p className="small">
            File: {restore.file}. Current data on this device will be permanently replaced.{' '}
            <button className="link-btn" onClick={() => guarded(async () => (downloadText(backupName(), await backupText(), 'application/json'), toast('ok', 'Current data backed up')))}>
              Download a backup of current data first
            </button>
          </p>
          <label className="check">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} data-testid="restore-ack" /> I understand this replaces all data
            on this device
          </label>
        </Modal>
      )}
    </section>
  );
}

function ReferenceSection() {
  const { snap, run } = useApp();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ReferenceData>(snap.reference);
  const [newDiv, setNewDiv] = useState('');
  useEffect(() => setDraft(snap.reference), [snap.reference]);

  const upd = (i: number, f: (d: DivisionRef) => DivisionRef) =>
    setDraft({ ...draft, divisions: draft.divisions.map((d, j) => (j === i ? f(d) : d)) });
  const invalid = draft.divisions.some((d) => !d.name.trim() || d.classes.some((c) => !(c.kg >= 20 && c.kg <= 300)));

  return (
    <section className="card">
      <h2>Age divisions &amp; weight classes</h2>
      <p className="small muted">
        Local reference data used for pick lists. Source: {snap.reference.source} Edit if rules change. Athletes keep their own numeric class limit; editing this list
        never changes athletes or past weigh-ins.
      </p>
      {!open ? (
        <button className="btn" onClick={() => setOpen(true)}>
          View / edit reference data
        </button>
      ) : (
        <div className="ref-edit">
          {draft.divisions.map((d, i) => (
            <div key={i} className="ref-div">
              <div className="ref-div-head">
                <input value={d.name} onChange={(e) => upd(i, (x) => ({ ...x, name: e.target.value }))} aria-label="Division name" />
                <input className="ages" value={d.ages} onChange={(e) => upd(i, (x) => ({ ...x, ages: e.target.value }))} aria-label="Ages" />
                <button className="btn btn-sm btn-ghost danger" onClick={() => setDraft({ ...draft, divisions: draft.divisions.filter((_, j) => j !== i) })}>
                  Remove division
                </button>
              </div>
              {d.note && <p className="small warn-text">{d.note}</p>}
              <div className="ref-classes">
                {d.classes.map((c, k) => (
                  <span key={k} className="ref-class">
                    <input
                      value={c.label}
                      onChange={(e) => upd(i, (x) => ({ ...x, classes: x.classes.map((y, m) => (m === k ? { ...y, label: e.target.value } : y)) }))}
                      aria-label="Class label"
                    />
                    <input
                      className="kg"
                      inputMode="decimal"
                      defaultValue={c.kg}
                      onBlur={(e) =>
                        upd(i, (x) => ({ ...x, classes: x.classes.map((y, m) => (m === k ? { ...y, kg: Number(e.target.value.replace(',', '.')) } : y)) }))
                      }
                      aria-label="Limit kg"
                    />
                    <select
                      value={c.sex ?? 'MF'}
                      onChange={(e) => upd(i, (x) => ({ ...x, classes: x.classes.map((y, m) => (m === k ? { ...y, sex: e.target.value as 'M' } : y)) }))}
                      aria-label="Sex"
                    >
                      <option value="MF">M/F</option>
                      <option value="M">M</option>
                      <option value="F">F</option>
                    </select>
                    <button className="icon-btn" onClick={() => upd(i, (x) => ({ ...x, classes: x.classes.filter((_, m) => m !== k) }))} aria-label="Remove class">
                      ✕
                    </button>
                  </span>
                ))}
                <button className="btn btn-sm" onClick={() => upd(i, (x) => ({ ...x, classes: [...x.classes, { kg: 60, label: 'New class', sex: 'MF' }] }))}>
                  + Class
                </button>
              </div>
            </div>
          ))}
          <div className="row-gap">
            <input placeholder="New division name" value={newDiv} onChange={(e) => setNewDiv(e.target.value)} />
            <button
              className="btn btn-sm"
              disabled={!newDiv.trim()}
              onClick={() => (setDraft({ ...draft, divisions: [...draft.divisions, { name: newDiv.trim(), ages: '', classes: [] }] }), setNewDiv(''))}
            >
              + Division
            </button>
          </div>
          {invalid && <p className="error-text">Each division needs a name and every class a limit between 20 and 300 kg.</p>}
          <div className="row-gap">
            <button
              className="btn btn-primary"
              disabled={invalid}
              onClick={async () => {
                const ref = { ...draft, source: draft === snap.reference ? draft.source : `${DEFAULT_REFERENCE.source.split('.')[0]}. Edited locally.` };
                if ((await run(async (d) => (await saveReference(d, ref), true), 'Reference data saved'))) setOpen(false);
              }}
            >
              Save reference data
            </button>
            <button className="btn" onClick={() => (setDraft(snap.reference), setOpen(false))}>
              Cancel
            </button>
            <button className="btn btn-ghost" onClick={() => setDraft(DEFAULT_REFERENCE)}>
              Reset to defaults
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function AboutSection() {
  const { snap, persisted } = useApp();
  const [usage, setUsage] = useState<string>('');
  const [offline, setOffline] = useState<boolean>(false);
  useEffect(() => {
    navigator.storage
      ?.estimate?.()
      .then((e) => setUsage(`${((e.usage ?? 0) / 1024 / 1024).toFixed(1)} MB used of ~${((e.quota ?? 0) / 1024 / 1024).toFixed(0)} MB available`))
      .catch(() => undefined);
    setOffline(!!navigator.serviceWorker?.controller);
  }, []);
  return (
    <section className="card">
      <h2>Storage, privacy &amp; app</h2>
      <ul className="about">
        <li>Offline ready: {offline ? 'yes — app is cached on this device' : 'not yet (reload once while online)'}</li>
        <li>Persistent storage: {persisted === true ? 'granted' : persisted === false ? 'not granted by browser (install to Home Screen and back up regularly)' : 'unknown'}</li>
        {usage && <li>Storage: {usage}</li>}
        <li>Health reasons in dictionary: {snap.reasons.length}</li>
        <li>
          Privacy: no accounts, no analytics, no network calls — records never leave this device unless you export them. Protect the device with a passcode; anyone
          holding the unlocked device can open the app.
        </li>
        <li>
          Version {APP_VERSION} · camp created {snap.camp ? fmtDate(snap.camp.createdAt.slice(0, 10), { year: true }) : ''}
        </li>
      </ul>
    </section>
  );
}
