import { useMemo, useState } from 'react';
import { go, useApp } from '../state';
import { evaluateHistory, fullName, intervalLabel } from '../lib/calc';
import { fmtKg, fmtSigned } from '../lib/weight';
import { fmtDate } from '../lib/dates';
import { classLabel } from '../lib/reference';
import { deleteWeighIn } from '../db/db';
import { Empty, Modal, StatusBadge } from '../ui/components';
import { WeightChart } from '../ui/WeightChart';
import type { WeighIn } from '../lib/types';

export function AthleteScreen({ id }: { id: string }) {
  const { snap, run } = useApp();
  const camp = snap.camp!;
  const athlete = snap.athletes.find((a) => a.id === id);
  const list = useMemo(() => snap.weighIns.filter((w) => w.athleteId === id), [snap.weighIns, id]);
  const hist = useMemo(() => evaluateHistory(list, camp.thresholds), [list, camp.thresholds]);
  const [toDelete, setToDelete] = useState<WeighIn | null>(null);
  const reason = (rid?: string | null) => (rid ? snap.reasons.find((r) => r.id === rid)?.label : undefined);

  if (!athlete)
    return (
      <Empty title="Athlete not found">
        <button className="btn" onClick={() => go('team')}>
          Back to team
        </button>
      </Empty>
    );

  const latest = hist[0];
  return (
    <div className="history">
      <div className="history-head">
        <button className="icon-btn" onClick={() => history.back()} aria-label="Back">
          ‹
        </button>
        <div className="history-id">
          <h1 data-testid="history-name">{fullName(athlete)}</h1>
          <div className="muted">
            {athlete.ageDivision} · {classLabel(snap.reference, athlete.ageDivision, athlete.weightClassKg)} · ID {athlete.id}
            {!athlete.active && ' · removed from active roster'}
          </div>
        </div>
        <button
          className="btn"
          onClick={() => go(`reports?athlete=${encodeURIComponent(athlete.id)}&from=${hist.length ? hist[hist.length - 1].record.date : ''}&to=${hist.length ? hist[0].record.date : ''}`)}
          data-testid="athlete-report"
        >
          Report
        </button>
        <button className="btn btn-primary" onClick={() => go(`weigh?athlete=${encodeURIComponent(athlete.id)}`)}>
          Weigh in
        </button>
      </div>

      {latest && (
        <div className="history-summary">
          <div>
            <span className="delta-k">Latest ({fmtDate(latest.record.date)})</span>
            <strong>{fmtKg(latest.record.weightKg)} kg</strong>
          </div>
          <div>
            <span className="delta-k">Category Δ</span>
            <strong className={`cat-${latest.status.toLowerCase()}`}>{fmtSigned(latest.categoryDeltaKg)} kg</strong>
          </div>
          <div>
            <span className="delta-k">Status</span>
            <StatusBadge status={latest.status} />
          </div>
          <div>
            <span className="delta-k">Records</span>
            <strong>{hist.length}</strong>
          </div>
        </div>
      )}

      <div className="card chart-card">
        <WeightChart records={list} thresholds={camp.thresholds} currentClassKg={athlete.weightClassKg} />
      </div>

      {hist.length === 0 ? (
        <p className="muted pad">No weigh-ins recorded in this camp yet.</p>
      ) : (
        <div className="table-scroll hist-table-wrap">
        <table className="hist-table" data-testid="history-table">
          <thead>
            <tr>
              <th>Date</th>
              <th className="num">Weight</th>
              <th className="num">Change</th>
              <th className="num">Cat. Δ</th>
              <th>Status</th>
              <th>Health</th>
              <th>Notes</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {hist.map((e) => (
              <tr key={e.record.id}>
                <td className="nowrap">
                  <span className="long">{fmtDate(e.record.date, { weekday: true })}</span>
                  <span className="short">{fmtDate(e.record.date)}</span>
                </td>
                <td className="num strong">{fmtKg(e.record.weightKg)}</td>
                <td className="num">
                  {e.daily ? fmtSigned(e.daily.deltaKg) : '—'}
                  {e.daily && e.daily.days > 1 && (
                    <small className="gap">
                      <span className="long"> {intervalLabel(e.daily)}</span>
                      <span className="short"> /{e.daily.days}d</span>
                    </small>
                  )}
                </td>
                <td className={`num strong cat-${e.status.toLowerCase()}`}>
                  {fmtSigned(e.categoryDeltaKg)}
                  <small className="muted long"> /{fmtKg(e.record.weightClassKgAtTime)}</small>
                </td>
                <td>
                  <StatusBadge status={e.status} size="sm" />
                </td>
                <td>{e.record.healthy ? <span className="ok">✓</span> : <span className="flag">✚ {reason(e.record.healthReasonId) ?? 'Not healthy'}</span>}</td>
                <td className="notes-cell">{e.record.notes}</td>
                <td className="actions">
                  <button
                    className="btn btn-sm"
                    onClick={() => go(`weigh?athlete=${encodeURIComponent(athlete.id)}&date=${e.record.date}&return=history`)}
                    data-testid={`edit-${e.record.date}`}
                  >
                    <span className="long">Edit</span>
                    <span className="short" aria-label="Edit">✎</span>
                  </button>
                  <button className="btn btn-sm btn-ghost danger" onClick={() => setToDelete(e.record)} aria-label="Delete record">
                    🗑
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
      {hist.length > 0 && (
        <div className="hist-cards" data-testid="history-cards">
          {hist.map((e) => (
            <div key={e.record.id} className={`tcard tcard-${e.status.toLowerCase()}`}>
              <div className="tcard-l1">
                <span className="name">{fmtDate(e.record.date, { weekday: true })}</span>
                <span className="strong">{fmtKg(e.record.weightKg)} kg</span>
                <StatusBadge status={e.status} size="sm" />
              </div>
              <div className="tcard-l2">
                <span>Δ {e.daily ? `${fmtSigned(e.daily.deltaKg)}${e.daily.days > 1 ? ` (${intervalLabel(e.daily)})` : ''}` : '—'}</span>
                <span className={`strong cat-${e.status.toLowerCase()}`}>
                  Cat {fmtSigned(e.categoryDeltaKg)} / {fmtKg(e.record.weightClassKgAtTime)}
                </span>
                {e.record.healthy ? <span className="ok">✓ healthy</span> : <span className="flag">✚ {reason(e.record.healthReasonId) ?? 'Not healthy'}</span>}
              </div>
              {e.record.notes && <div className="tcard-l3 muted">✎ {e.record.notes}</div>}
              <div className="tcard-actions">
                <button
                  className="btn btn-sm"
                  onClick={() => go(`weigh?athlete=${encodeURIComponent(athlete.id)}&date=${e.record.date}&return=history`)}
                  data-testid={`edit-card-${e.record.date}`}
                >
                  Edit
                </button>
                <button className="btn btn-sm btn-ghost danger" onClick={() => setToDelete(e.record)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {toDelete && (
        <Modal
          title="Delete weigh-in?"
          onClose={() => setToDelete(null)}
          footer={
            <>
              <button className="btn" onClick={() => setToDelete(null)}>
                Cancel
              </button>
              <button
                className="btn btn-danger"
                onClick={async () => {
                  await run((d) => deleteWeighIn(d, toDelete.id), 'Weigh-in deleted');
                  setToDelete(null);
                }}
              >
                Delete
              </button>
            </>
          }
        >
          <p>
            Delete the {fmtKg(toDelete.weightKg)} kg record of {fmtDate(toDelete.date, { weekday: true, year: true })} for {fullName(athlete)}? This
            cannot be undone (export a backup first if unsure).
          </p>
        </Modal>
      )}
    </div>
  );
}
