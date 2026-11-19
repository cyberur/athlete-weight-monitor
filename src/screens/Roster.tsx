import { useMemo, useState } from 'react';
import { go, useApp } from '../state';
import { applyRosterImport, setAthleteActive, upsertAthlete } from '../db/db';
import { parseRoster, previewRoster, type RosterParseResult, type RosterPreviewRow } from '../lib/validate';
import { fullName, sortName } from '../lib/calc';
import { fmtKg } from '../lib/weight';
import { classLabel } from '../lib/reference';
import { Empty, Modal, pickFile } from '../ui/components';
import type { Athlete } from '../lib/types';

type SortKey = 'name' | 'division' | 'class';

export function RosterScreen() {
  const { snap, run, toast } = useApp();
  const camp = snap.camp!;
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('name');
  const [showRemoved, setShowRemoved] = useState(false);
  const [editing, setEditing] = useState<Athlete | 'new' | null>(null);
  const [importState, setImportState] = useState<{ file: string; parsed: RosterParseResult; preview: RosterPreviewRow[] } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const list = useMemo(() => {
    const f = snap.athletes.filter(
      (a) => (showRemoved || a.active) && (!q || fullName(a).toLowerCase().includes(q.toLowerCase()) || a.id.toLowerCase().includes(q.toLowerCase())),
    );
    return f.sort((a, b) => {
      if (sort === 'division') return a.ageDivision.localeCompare(b.ageDivision) || sortName(a).localeCompare(sortName(b));
      if (sort === 'class') return a.weightClassKg - b.weightClassKg || sortName(a).localeCompare(sortName(b));
      return sortName(a).localeCompare(sortName(b));
    });
  }, [snap.athletes, q, sort, showRemoved]);
  const activeCount = snap.athletes.filter((a) => a.active).length;
  const removedCount = snap.athletes.length - activeCount;
  const historyCount = (id: string) => snap.weighIns.filter((w) => w.athleteId === id).length;

  const startImport = async () => {
    const f = await pickFile();
    if (!f) return;
    const parsed = parseRoster(f.text);
    if (!parsed.ok) {
      setImportError(parsed.fatal ?? 'Invalid file');
      return;
    }
    setImportState({ file: f.name, parsed, preview: previewRoster(parsed.valid, snap.athletes) });
  };

  const knownDivisions = new Set(snap.reference.divisions.map((d) => d.name.toLowerCase()));

  return (
    <div className="roster">
      <div className="page-head">
        <div>
          <h1>Roster</h1>
          <div className="muted">
            {activeCount} active{removedCount ? ` · ${removedCount} removed` : ''} · camp “{camp.name}”
          </div>
        </div>
        <div className="row-gap">
          <button className="btn btn-primary" onClick={startImport} data-testid="import-roster">
            Import roster (JSON)
          </button>
          <button className="btn" onClick={() => setEditing('new')} data-testid="add-athlete">
            + Add athlete
          </button>
        </div>
      </div>

      {snap.athletes.length === 0 ? (
        <Empty title="Roster is empty">
          <p>
            Import a standardized roster JSON file (see <code>samples/sample-roster.json</code> and the README) or add athletes one by one.
          </p>
        </Empty>
      ) : (
        <>
          <div className="filters">
            <input type="search" placeholder="Search name or ID" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search roster" />
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort roster">
              <option value="name">Sort: Name</option>
              <option value="division">Sort: Division</option>
              <option value="class">Sort: Weight class</option>
            </select>
            {removedCount > 0 && (
              <label className="check">
                <input type="checkbox" checked={showRemoved} onChange={(e) => setShowRemoved(e.target.checked)} /> Show removed
              </label>
            )}
          </div>
          <table className="roster-table" data-testid="roster-table">
            <thead>
              <tr>
                <th>Athlete</th>
                <th>ID</th>
                <th>Division</th>
                <th>Weight class</th>
                <th className="num">Records</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.id} className={a.active ? '' : 'removed'}>
                  <td className="name">
                    <button className="link-btn" onClick={() => go(`athlete/${encodeURIComponent(a.id)}`)}>
                      {fullName(a)}
                    </button>
                    {!a.active && <span className="tag">removed</span>}
                    {a.excludeFromAttendance && <span className="tag tag-noatt">not in attendance</span>}
                    <small className="short muted">
                      <br />
                      {a.ageDivision} · {fmtKg(a.weightClassKg)} kg
                    </small>
                  </td>
                  <td className="muted small">{a.id}</td>
                  <td>{a.ageDivision}</td>
                  <td>{classLabel(snap.reference, a.ageDivision, a.weightClassKg)}</td>
                  <td className="num">{historyCount(a.id)}</td>
                  <td className="actions">
                    <button className="btn btn-sm" onClick={() => setEditing(a)}>
                      Edit
                    </button>
                    {a.active ? (
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={() => run((d) => setAthleteActive(d, camp.id, a.id, false), `${fullName(a)} removed from active roster (history kept)`)}
                      >
                        Remove
                      </button>
                    ) : (
                      <button className="btn btn-sm btn-ghost" onClick={() => run((d) => setAthleteActive(d, camp.id, a.id, true), `${fullName(a)} restored`)}>
                        Restore
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {editing && (
        <AthleteForm
          athlete={editing === 'new' ? null : editing}
          existingIds={new Set(snap.athletes.map((a) => a.id))}
          onClose={() => setEditing(null)}
          onSave={async (v) => {
            const r = await run((d) => upsertAthlete(d, camp.id, v), editing === 'new' ? 'Athlete added' : 'Athlete updated');
            if (r) setEditing(null);
          }}
        />
      )}

      {importError && (
        <Modal title="Import failed" onClose={() => setImportError(null)} footer={<button className="btn" onClick={() => setImportError(null)}>OK</button>}>
          <p className="error-text" data-testid="import-error">
            {importError}
          </p>
          <p className="muted">Nothing was changed.</p>
        </Modal>
      )}

      {importState && (
        <Modal
          wide
          title="Import preview"
          onClose={() => setImportState(null)}
          footer={
            <>
              <button className="btn" onClick={() => setImportState(null)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={!importState.parsed.valid.length}
                data-testid="confirm-import"
                onClick={async () => {
                  const r = await run((d) => applyRosterImport(d, camp.id, importState.parsed.valid));
                  if (r) {
                    toast('ok', `Roster imported: ${r.created} new, ${r.updated} updated, ${r.reactivated} restored, ${r.unchanged} unchanged`);
                    setImportState(null);
                  }
                }}
              >
                Import {importState.parsed.valid.length} athletes
              </button>
            </>
          }
        >
          <ImportPreview state={importState} campName={camp.name} campId={camp.id} knownDivisions={knownDivisions} />
        </Modal>
      )}
    </div>
  );
}

function ImportPreview({
  state,
  campName,
  campId,
  knownDivisions,
}: {
  state: { file: string; parsed: RosterParseResult; preview: RosterPreviewRow[] };
  campName: string;
  campId: string;
  knownDivisions: Set<string>;
}) {
  const c = { new: 0, updated: 0, unchanged: 0, reactivated: 0 };
  state.preview.forEach((p) => c[p.change]++);
  const unknownDiv = [...new Set(state.parsed.valid.map((v) => v.ageDivision).filter((d) => !knownDivisions.has(d.toLowerCase())))];
  const fileCamp = state.parsed.camp;
  return (
    <div className="import-preview" data-testid="import-preview">
      <p>
        File <strong>{state.file}</strong> → active camp <strong>“{campName}”</strong>.
        {fileCamp && fileCamp.id !== campId && (
          <span className="muted"> (File names camp “{fileCamp.name}” / {fileCamp.id}; athletes are imported into the active camp.)</span>
        )}
      </p>
      <div className="counts">
        <span className="count count-green">
          <span className="count-n">{c.new}</span>
          <span className="count-l">New</span>
        </span>
        <span className="count count-yellow">
          <span className="count-n">{c.updated}</span>
          <span className="count-l">Updated</span>
        </span>
        <span className="count">
          <span className="count-n">{c.reactivated}</span>
          <span className="count-l">Restored</span>
        </span>
        <span className="count count-missing">
          <span className="count-n">{c.unchanged}</span>
          <span className="count-l">Unchanged</span>
        </span>
        <span className="count count-red">
          <span className="count-n">{state.parsed.invalid.length}</span>
          <span className="count-l">Invalid</span>
        </span>
      </div>
      <p className="small muted">
        Athletes are matched by <code>id</code>, never by name. Existing weigh-in history is kept. Athletes missing from the file are left unchanged.
        Invalid records are skipped. The import is applied in a single all-or-nothing transaction.
      </p>
      {unknownDiv.length > 0 && (
        <p className="warn-text">Division not in reference data: {unknownDiv.join(', ')} — will be imported as-is; you can add it in Settings.</p>
      )}
      {state.parsed.invalid.length > 0 && (
        <div className="invalid-list" data-testid="invalid-list">
          <h3>Invalid records (skipped)</h3>
          <ul>
            {state.parsed.invalid.map((i) => (
              <li key={i.index}>
                #{i.index + 1} {i.name ?? ''} {i.id ? `(${i.id})` : ''}: {i.errors.join('; ')}
              </li>
            ))}
          </ul>
        </div>
      )}
      <table className="preview-table">
        <thead>
          <tr>
            <th>Change</th>
            <th>ID</th>
            <th>Name</th>
            <th>Division</th>
            <th className="num">Class</th>
          </tr>
        </thead>
        <tbody>
          {state.preview.map((p) => (
            <tr key={p.input.id}>
              <td>
                <span className={`tag tag-${p.change}`}>{p.change}</span>
              </td>
              <td className="small muted">{p.input.id}</td>
              <td>
                {p.input.firstName} {p.input.lastName}
                {p.diffs.length > 0 && <div className="small muted">{p.diffs.join('; ')}</div>}
              </td>
              <td>{p.input.ageDivision}</td>
              <td className="num">{fmtKg(p.input.weightClassKg)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AthleteForm({
  athlete,
  existingIds,
  onClose,
  onSave,
}: {
  athlete: Athlete | null;
  existingIds: Set<string>;
  onClose: () => void;
  onSave: (v: { id?: string; firstName: string; lastName: string; ageDivision: string; weightClassKg: number; excludeFromAttendance: boolean }) => Promise<void>;
}) {
  const { snap } = useApp();
  const [first, setFirst] = useState(athlete?.firstName ?? '');
  const [last, setLast] = useState(athlete?.lastName ?? '');
  const [id, setId] = useState(athlete?.id ?? '');
  const [noAtt, setNoAtt] = useState(!!athlete?.excludeFromAttendance);
  const [division, setDivision] = useState(athlete?.ageDivision ?? snap.reference.divisions[0]?.name ?? '');
  const divRef = snap.reference.divisions.find((d) => d.name === division);
  const classInRef = (kg: number) => divRef?.classes.some((c) => Math.round(c.kg * 100) === Math.round(kg * 100));
  const [classSel, setClassSel] = useState<string>(athlete ? (classInRef(athlete.weightClassKg) ? String(athlete.weightClassKg) : 'custom') : '');
  const [custom, setCustom] = useState(athlete && !classInRef(athlete.weightClassKg) ? String(athlete.weightClassKg) : '');
  const kg = classSel === 'custom' ? Number(custom.replace(',', '.')) : Number(classSel);
  const idTaken = !athlete && id.trim() !== '' && existingIds.has(id.trim());
  const valid = first.trim() && last.trim() && division && Number.isFinite(kg) && kg >= 20 && kg <= 300 && !idTaken;
  const divisions = snap.reference.divisions.map((d) => d.name);
  if (division && !divisions.includes(division)) divisions.push(division);

  return (
    <Modal
      title={athlete ? 'Edit athlete' : 'Add athlete'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!valid}
            onClick={() => onSave({ id: athlete?.id ?? (id.trim() || undefined), firstName: first, lastName: last, ageDivision: division, weightClassKg: kg, excludeFromAttendance: noAtt })}
            data-testid="athlete-save"
          >
            Save
          </button>
        </>
      }
    >
      <div className="form">
        <label>
          First name
          <input value={first} onChange={(e) => setFirst(e.target.value)} autoComplete="off" data-testid="f-first" />
        </label>
        <label>
          Last name
          <input value={last} onChange={(e) => setLast(e.target.value)} autoComplete="off" data-testid="f-last" />
        </label>
        <label>
          Athlete ID {athlete ? '(fixed)' : '(optional — generated if empty)'}
          <input value={id} disabled={!!athlete} onChange={(e) => setId(e.target.value)} autoComplete="off" />
          {idTaken && <span className="error-text small">This ID already exists</span>}
        </label>
        <label>
          Age division
          <select
            value={division}
            onChange={(e) => {
              setDivision(e.target.value);
              setClassSel('');
            }}
            data-testid="f-division"
          >
            {divisions.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
        <label>
          Weight class
          <select value={classSel} onChange={(e) => setClassSel(e.target.value)} data-testid="f-class">
            <option value="">Select…</option>
            {divRef?.classes.map((c) => (
              <option key={c.kg + c.label} value={c.kg}>
                {c.label.endsWith('kg') ? c.label : `${c.label} — ${fmtKg(c.kg)} kg`}
                {c.sex === 'M' ? ' (M)' : c.sex === 'F' ? ' (F)' : ''}
              </option>
            ))}
            <option value="custom">Custom limit…</option>
          </select>
        </label>
        {divRef?.note && <p className="small warn-text">{divRef.note}</p>}
        {classSel === 'custom' && (
          <label>
            Custom weight limit (kg)
            <input inputMode="decimal" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="e.g. 70.3" data-testid="f-custom" />
          </label>
        )}
        <label className="check att-check">
          <input type="checkbox" checked={noAtt} onChange={(e) => setNoAtt(e.target.checked)} data-testid="f-no-attendance" />
          <span>
            Exclude from Attendance report
            <small className="muted"> — still weighed and monitored (e.g. preparing for another event)</small>
          </span>
        </label>
        {athlete && <p className="small muted">Changing division or class does not alter existing weigh-ins; they keep the class recorded at the time.</p>}
      </div>
    </Modal>
  );
}
