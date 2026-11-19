import { useMemo, useState } from 'react';
import { go, useApp } from '../state';
import { buildTeamRows, countStatuses, fullName, intervalLabel, sortName, STATUS_ORDER, type TeamRow } from '../lib/calc';
import { fmtKg, fmtSigned, toCenti, type StatusOrMissing } from '../lib/weight';
import { addDays, fmtDate } from '../lib/dates';
import { Empty, StatusBadge } from '../ui/components';

type SortKey = 'status' | 'catDelta' | 'name';

export function TeamScreen() {
  const { snap, today } = useApp();
  const camp = snap.camp!;
  const [date, setDate] = useState(today);
  const [q, setQ] = useState('');
  const [division, setDivision] = useState('');
  const [cls, setCls] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusOrMissing | 'UNHEALTHY' | ''>('');
  const [sort, setSort] = useState<SortKey>('status');

  const active = useMemo(() => snap.athletes.filter((a) => a.active), [snap.athletes]);
  const rows = useMemo(() => buildTeamRows(active, snap.weighIns, date, camp.thresholds), [active, snap.weighIns, date, camp.thresholds]);
  const counts = countStatuses(rows);
  const unhealthy = rows.filter((r) => r.onDate && !r.onDate.record.healthy).length;
  const divisions = [...new Set(active.map((a) => a.ageDivision))].sort();
  const classes = [...new Set(active.filter((a) => !division || a.ageDivision === division).map((a) => a.weightClassKg))].sort((a, b) => a - b);
  const reasonLabel = (id?: string | null) => (id ? snap.reasons.find((r) => r.id === id)?.label : undefined);

  const shown = rows
    .filter((r) => {
      const a = r.athlete;
      if (q && !fullName(a).toLowerCase().includes(q.toLowerCase())) return false;
      if (division && a.ageDivision !== division) return false;
      if (cls && toCenti(a.weightClassKg) !== toCenti(Number(cls))) return false;
      if (statusFilter === 'UNHEALTHY') return !!r.onDate && !r.onDate.record.healthy;
      if (statusFilter && r.status !== statusFilter) return false;
      return true;
    })
    .sort((x, y) => {
      if (sort === 'name') return sortName(x.athlete).localeCompare(sortName(y.athlete));
      if (sort === 'catDelta') {
        const dx = x.onDate?.categoryDeltaKg ?? -Infinity;
        const dy = y.onDate?.categoryDeltaKg ?? -Infinity;
        return dy - dx || sortName(x.athlete).localeCompare(sortName(y.athlete));
      }
      return (
        STATUS_ORDER[x.status] - STATUS_ORDER[y.status] ||
        (y.onDate?.categoryDeltaKg ?? 0) - (x.onDate?.categoryDeltaKg ?? 0) ||
        sortName(x.athlete).localeCompare(sortName(y.athlete))
      );
    });

  if (!active.length)
    return (
      <Empty title="No athletes yet">
        <button className="btn btn-primary" onClick={() => go('roster')}>
          Import roster
        </button>
      </Empty>
    );

  const countBtn = (s: StatusOrMissing | 'UNHEALTHY', n: number, label: string) => (
    <button
      className={`count count-${s.toLowerCase()} ${statusFilter === s ? 'count-on' : ''}`}
      onClick={() => setStatusFilter(statusFilter === s ? '' : s)}
      data-testid={`count-${s}`}
      aria-pressed={statusFilter === s}
    >
      <span className="count-n">{n}</span>
      <span className="count-l">{label}</span>
    </button>
  );

  return (
    <div className="team">
      <div className="team-head">
        <div className="date-nav">
          <button className="icon-btn" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">
            ‹
          </button>
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Date" data-testid="team-date" />
          <button className="icon-btn" onClick={() => setDate(addDays(date, 1))} aria-label="Next day">
            ›
          </button>
          {date !== today && (
            <button className="chip" onClick={() => setDate(today)}>
              Today
            </button>
          )}
          <span className="team-date-label">{fmtDate(date, { weekday: true, year: true })}</span>
          <button className="btn btn-sm team-report" onClick={() => go(`reports?type=weight&from=${date}&to=${date}`)} data-testid="team-report">
            Report
          </button>
          <button className="btn btn-sm" onClick={() => go(`reports?type=attendance&date=${date}`)} data-testid="team-attendance">
            Attendance
          </button>
        </div>
        <div className="counts">
          {countBtn('RED', counts.RED, 'Red')}
          {countBtn('YELLOW', counts.YELLOW, camp.thresholds.yellowEnabled ? 'Yellow' : 'Yellow (off)')}
          {countBtn('GREEN', counts.GREEN, 'Green')}
          {countBtn('MISSING', counts.MISSING, 'Missing')}
          {countBtn('UNHEALTHY', unhealthy, 'Not healthy')}
        </div>
        <div className="filters">
          <input type="search" placeholder="Search name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search name" />
          <select value={division} onChange={(e) => (setDivision(e.target.value), setCls(''))} aria-label="Division filter">
            <option value="">All divisions</option>
            {divisions.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
          <select value={cls} onChange={(e) => setCls(e.target.value)} aria-label="Weight class filter">
            <option value="">All classes</option>
            {classes.map((c) => (
              <option key={c} value={c}>
                {fmtKg(c)} kg
              </option>
            ))}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort" data-testid="team-sort">
            <option value="status">Sort: Status</option>
            <option value="catDelta">Sort: Category Δ</option>
            <option value="name">Sort: Name</option>
          </select>
        </div>
      </div>

      <table className="team-table" data-testid="team-table">
        <thead>
          <tr>
            <th>Athlete</th>
            <th>Div.</th>
            <th className="num">Class</th>
            <th className="num">Weight</th>
            <th className="num">Daily Δ</th>
            <th className="num">Cat. Δ</th>
            <th>Status</th>
            <th title="Health">Health</th>
            <th title="Notes">Note</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <Row key={r.athlete.id} r={r} reasonLabel={reasonLabel} />
          ))}
        </tbody>
      </table>

      <div className="team-cards" data-testid="team-cards">
        {shown.map((r) => (
          <Card key={r.athlete.id} r={r} reasonLabel={reasonLabel} />
        ))}
      </div>
      {!shown.length && <p className="muted pad">No athletes match the filters.</p>}
      <p className="legend muted small">
        Daily Δ = change since the athlete's previous recorded weigh-in (interval shown when more than one day). Cat. Δ = weight − class limit.
        Missing = no weigh-in on this date; the last earlier weight is shown in grey with its own date.
      </p>
    </div>
  );
}

function open(id: string) {
  go(`athlete/${encodeURIComponent(id)}`);
}

function Row({ r, reasonLabel }: { r: TeamRow; reasonLabel: (id?: string | null) => string | undefined }) {
  const a = r.athlete;
  const e = r.onDate;
  return (
    <tr className={`row-${r.status.toLowerCase()}`} onClick={() => open(a.id)} data-testid={`row-${a.id}`}>
      <td className="name">
        {a.lastName}, {a.firstName}
      </td>
      <td>{a.ageDivision}</td>
      <td className="num">{fmtKg(e ? e.record.weightClassKgAtTime : a.weightClassKg)}</td>
      <td className="num strong">
        {e ? (
          fmtKg(e.record.weightKg)
        ) : r.lastBefore ? (
          <span className="stale" title="Last earlier weigh-in, not this date">
            {fmtKg(r.lastBefore.weightKg)} <small>({fmtDate(r.lastBefore.date)})</small>
          </span>
        ) : (
          '—'
        )}
      </td>
      <td className="num">
        {e?.daily ? (
          <>
            {fmtSigned(e.daily.deltaKg)}
            {e.daily.days > 1 && <small className="gap"> /{e.daily.days}d</small>}
          </>
        ) : (
          '—'
        )}
      </td>
      <td className={`num strong cat-${r.status.toLowerCase()}`}>{e ? fmtSigned(e.categoryDeltaKg) : '—'}</td>
      <td>
        <StatusBadge status={r.status} size="sm" />
      </td>
      <td>
        {e ? (
          e.record.healthy ? (
            <span className="ok" aria-label="Healthy" title="Healthy">
              ✓
            </span>
          ) : (
            <span className="flag" title={reasonLabel(e.record.healthReasonId) ?? 'Not healthy'}>
              ✚ {reasonLabel(e.record.healthReasonId) ?? 'Flag'}
            </span>
          )
        ) : (
          ''
        )}
      </td>
      <td>{e?.record.notes ? <span title={e.record.notes} aria-label="Has notes">✎</span> : ''}</td>
    </tr>
  );
}

function Card({ r, reasonLabel }: { r: TeamRow; reasonLabel: (id?: string | null) => string | undefined }) {
  const a = r.athlete;
  const e = r.onDate;
  return (
    <button className={`tcard tcard-${r.status.toLowerCase()}`} onClick={() => open(a.id)} data-testid={`card-${a.id}`}>
      <div className="tcard-l1">
        <span className="name">{fullName(a)}</span>
        <StatusBadge status={r.status} size="sm" />
      </div>
      <div className="tcard-l2">
        <span>
          {a.ageDivision} · {fmtKg(e ? e.record.weightClassKgAtTime : a.weightClassKg)}
        </span>
        {e ? (
          <>
            <span className="strong">{fmtKg(e.record.weightKg)} kg</span>
            <span>
              Δ {e.daily ? `${fmtSigned(e.daily.deltaKg)}${e.daily.days > 1 ? ` (${intervalLabel(e.daily)})` : ''}` : '—'}
            </span>
            <span className={`strong cat-${r.status.toLowerCase()}`}>Cat {fmtSigned(e.categoryDeltaKg)}</span>
          </>
        ) : (
          <span className="stale">{r.lastBefore ? `last ${fmtKg(r.lastBefore.weightKg)} kg on ${fmtDate(r.lastBefore.date)}` : 'no weigh-ins'}</span>
        )}
      </div>
      {e && (!e.record.healthy || e.record.notes) && (
        <div className="tcard-l3">
          {!e.record.healthy && <span className="flag">✚ {reasonLabel(e.record.healthReasonId) ?? 'Not healthy'}</span>}
          {e.record.notes && <span className="muted">✎ {e.record.notes}</span>}
        </div>
      )}
    </button>
  );
}
