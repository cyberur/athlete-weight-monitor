import { useEffect, useMemo, useState } from 'react';
import { useApp, useRoute } from '../state';
import {
  buildReport,
  defaultReportOptions,
  periodLabel,
  reportBodyHtml,
  reportCsv,
  reportStandaloneHtml,
  REPORT_CSS,
  validateReportOptions,
  type AthleteScope,
  type ReportOptions,
} from '../lib/report';
import { addDays, isIsoDate } from '../lib/dates';
import { fullName, sortName } from '../lib/calc';
import { fmtKg } from '../lib/weight';
import { canShareFiles, downloadText, safeName, shareText, stamp } from '../lib/download';
import { ATTENDANCE_CSS, attendanceHtml, attendanceStandaloneHtml, attendanceText, buildAttendance, type AttendanceOptions } from '../lib/attendance';

// keep the last settings while the app is open
let lastOptions: ReportOptions | null = null;
let lastType: 'weight' | 'attendance' = 'weight';
let lastAtt: AttendanceOptions = { showAbsent: false, showClass: true };

export function ReportsScreen() {
  const route = useRoute();
  const qType = route.query.get('type');
  const [type, setType] = useState<'weight' | 'attendance'>(qType === 'attendance' ? 'attendance' : lastType);
  useEffect(() => {
    if (qType === 'attendance' || qType === 'weight') setType(qType);
  }, [qType]);
  useEffect(() => {
    lastType = type;
  }, [type]);
  return (
    <div className="reports">
      <style>{REPORT_CSS + ATTENDANCE_CSS}</style>
      <div className="seg report-type" role="radiogroup" data-testid="rtype">
        <button role="radio" aria-checked={type === 'weight'} className={type === 'weight' ? 'on' : ''} onClick={() => setType('weight')} data-testid="rtype-weight">
          Weight report
        </button>
        <button role="radio" aria-checked={type === 'attendance'} className={type === 'attendance' ? 'on' : ''} onClick={() => setType('attendance')} data-testid="rtype-attendance">
          Attendance
        </button>
      </div>
      {type === 'weight' ? <WeightReport /> : <AttendanceReport />}
    </div>
  );
}

function AttendanceReport() {
  const { snap, today, toast } = useApp();
  const route = useRoute();
  const camp = snap.camp!;
  const qd = route.query.get('date');
  const [date, setDate] = useState(qd && isIsoDate(qd) ? qd : today);
  const [o, setO] = useState<AttendanceOptions>(lastAtt);
  useEffect(() => {
    lastAtt = o;
  }, [o]);
  const r = useMemo(() => buildAttendance(camp, snap.athletes, snap.weighIns, date), [camp, snap.athletes, snap.weighIns, date]);
  const html = useMemo(() => attendanceHtml(r, o), [r, o]);
  const text = () => attendanceText(r, o);
  const fileName = `attendance_${safeName(camp.name)}_${date}.html`;
  const share = canShareFiles();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text());
      toast('ok', 'Attendance copied — paste into WhatsApp');
    } catch {
      toast('error', 'Copy not allowed here — use Share text');
    }
  };
  const shareTextOnly = async () => {
    try {
      await navigator.share({ text: text() });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast('error', `Share failed: ${(e as Error).message}`);
    }
  };

  return (
    <>
      <section className="card report-settings">
        <h1>Attendance</h1>
        <div className="rs-row">
          <div className="rs-label">Date</div>
          <div className="rs-body">
            <div className="rs-dates">
              <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Attendance date" data-testid="att-date" />
              <button className="chip" onClick={() => setDate(today)}>Today</button>
              <button className="chip" onClick={() => setDate(addDays(today, -1))}>Yesterday</button>
            </div>
            <p className="small muted">Present = athletes with a weigh-in recorded on this date.</p>
          </div>
        </div>
        <div className="rs-row">
          <div className="rs-label">Show</div>
          <div className="rs-body">
            <div className="chips">
              <button className={`chip ${o.showClass ? 'chip-on' : ''}`} aria-pressed={o.showClass} onClick={() => setO({ ...o, showClass: !o.showClass })} data-testid="att-class">
                {o.showClass ? '✓ ' : ''}Weight class
              </button>
              <button className={`chip ${o.showAbsent ? 'chip-on' : ''}`} aria-pressed={o.showAbsent} onClick={() => setO({ ...o, showAbsent: !o.showAbsent })} data-testid="att-absent">
                {o.showAbsent ? '✓ ' : ''}Absent athletes
              </button>
            </div>
          </div>
        </div>
        <div className="row-gap report-actions">
          <button className="btn btn-primary" onClick={copy} data-testid="att-copy">
            Copy text (WhatsApp)
          </button>
          {typeof navigator.share === 'function' && (
            <button className="btn" onClick={shareTextOnly}>
              Share text…
            </button>
          )}
          <button className="btn" onClick={() => window.print()}>
            Print / PDF
          </button>
          {share && (
            <button className="btn" onClick={() => shareText(fileName, attendanceStandaloneHtml(r, o, REPORT_CSS), 'text/html').catch((e) => toast('error', String(e)))}>
              Share file…
            </button>
          )}
          <button
            className="btn"
            onClick={() => (downloadText(fileName, attendanceStandaloneHtml(r, o, REPORT_CSS), 'text/html'), toast('ok', 'Attendance downloaded'))}
            data-testid="att-html"
          >
            Download HTML
          </button>
        </div>
        <p className="small muted">
          {r.presentCount} present of {r.rosterCount} on roster
        </p>
      </section>
      <div className="card rdoc report-doc" data-testid="att-doc" dangerouslySetInnerHTML={{ __html: html }} />
    </>
  );
}

function WeightReport() {
  const { snap, today, toast } = useApp();
  const route = useRoute();
  const camp = snap.camp!;
  const [o, setO] = useState<ReportOptions>(() => lastOptions ?? defaultReportOptions(today));
  const [q, setQ] = useState('');
  const set = (p: Partial<ReportOptions>) => setO((x) => ({ ...x, ...p }));

  // deep links: #/reports?athlete=ID&from=…&to=…
  const qa = route.query.get('athlete');
  const qf = route.query.get('from');
  const qt = route.query.get('to');
  useEffect(() => {
    const p: Partial<ReportOptions> = {};
    if (qa) Object.assign(p, { scope: 'selected', selectedIds: [qa], groupBy: 'athlete' });
    if (qf && isIsoDate(qf)) p.from = qf;
    if (qt && isIsoDate(qt)) p.to = qt;
    if (Object.keys(p).length) set(p);
  }, [qa, qf, qt]);
  useEffect(() => {
    lastOptions = o;
  }, [o]);

  const err = validateReportOptions(o);
  const report = useMemo(
    () => (err ? null : buildReport(camp, snap.athletes, snap.weighIns, snap.reasons, o)),
    [err, camp, snap.athletes, snap.weighIns, snap.reasons, o],
  );
  const html = useMemo(() => (report ? reportBodyHtml(report) : ''), [report]);

  const single = o.from === o.to;
  const firstRecord = snap.weighIns.reduce<string | null>((m, w) => (!m || w.date < m ? w.date : m), null);
  const campStart = camp.startDate && camp.startDate <= today ? camp.startDate : (firstRecord ?? today);
  const divisions = [...new Set(snap.athletes.map((a) => a.ageDivision))].sort();
  const classes = [...new Set(snap.athletes.map((a) => a.weightClassKg))].sort((a, b) => a - b);
  const pickable = snap.athletes
    .filter((a) => (a.active || o.includeRemoved || o.selectedIds.includes(a.id)) && (!q || fullName(a).toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => sortName(a).localeCompare(sortName(b)));

  const baseName = () => `awm-report_${safeName(camp.name)}_${o.from}${single ? '' : '_' + o.to}_${stamp().slice(11)}`;
  const share = canShareFiles();
  const exportFile = async (kind: 'html' | 'csv', how: 'download' | 'share') => {
    if (!report) return;
    const text = kind === 'html' ? reportStandaloneHtml(report) : reportCsv(report);
    const mime = kind === 'html' ? 'text/html' : 'text/csv;charset=utf-8';
    const name = `${baseName()}.${kind}`;
    try {
      if (how === 'share') await shareText(name, text, mime.split(';')[0]);
      else {
        downloadText(name, text, mime);
        toast('ok', `Report ${kind.toUpperCase()} downloaded`);
      }
    } catch (e) {
      toast('error', `Export failed: ${(e as Error).message}`);
    }
  };

  const Seg = <T extends string>({ value, options, onChange, testId }: { value: T; options: [T, string][]; onChange: (v: T) => void; testId: string }) => (
    <div className="seg" role="radiogroup" data-testid={testId}>
      {options.map(([v, l]) => (
        <button key={v} role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)} data-testid={`${testId}-${v}`}>
          {l}
        </button>
      ))}
    </div>
  );
  const Chk = ({ k, label }: { k: keyof ReportOptions; label: string }) => (
    <button className={`chip ${o[k] ? 'chip-on' : ''}`} aria-pressed={!!o[k]} onClick={() => set({ [k]: !o[k] } as Partial<ReportOptions>)} data-testid={`opt-${k}`}>
      {o[k] ? '✓ ' : ''}
      {label}
    </button>
  );

  return (
    <>
      <section className="card report-settings">
        <h1>Weight report</h1>

        <div className="rs-row">
          <div className="rs-label">Period</div>
          <div className="rs-body">
            <Seg
              testId="period"
              value={single ? 'day' : 'range'}
              options={[
                ['day', 'One day'],
                ['range', 'Date range'],
              ]}
              onChange={(v) => (v === 'day' ? set({ from: o.to, to: o.to }) : set({ from: addDays(o.to, -6) }))}
            />
            <div className="rs-dates">
              {single ? (
                <input type="date" value={o.to} onChange={(e) => e.target.value && set({ from: e.target.value, to: e.target.value })} aria-label="Report date" data-testid="r-date" />
              ) : (
                <>
                  <input type="date" value={o.from} max={o.to} onChange={(e) => e.target.value && set({ from: e.target.value })} aria-label="From" data-testid="r-from" />
                  <span>→</span>
                  <input type="date" value={o.to} min={o.from} onChange={(e) => e.target.value && set({ to: e.target.value })} aria-label="To" data-testid="r-to" />
                </>
              )}
            </div>
            <div className="chips">
              <button className="chip" onClick={() => set({ from: today, to: today })}>Today</button>
              <button className="chip" onClick={() => set({ from: addDays(today, -1), to: addDays(today, -1) })}>Yesterday</button>
              <button className="chip" onClick={() => set({ from: addDays(today, -6), to: today })} data-testid="preset-7">Last 7 days</button>
              <button className="chip" onClick={() => set({ from: campStart > today ? today : campStart, to: today })} data-testid="preset-camp">Whole camp</button>
            </div>
          </div>
        </div>

        <div className="rs-row">
          <div className="rs-label">Athletes</div>
          <div className="rs-body">
            <Seg<AthleteScope>
              testId="scope"
              value={o.scope}
              options={[
                ['all', 'All'],
                ['division', 'Division'],
                ['class', 'Weight class'],
                ['selected', 'Selected'],
              ]}
              onChange={(v) =>
                set({
                  scope: v,
                  division: v === 'division' ? (o.division ?? divisions[0]) : o.division,
                  classKg: v === 'class' ? (o.classKg ?? classes[0]) : o.classKg,
                })
              }
            />
            {o.scope === 'division' && (
              <select value={o.division ?? ''} onChange={(e) => set({ division: e.target.value })} aria-label="Division" data-testid="r-division">
                {divisions.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            )}
            {o.scope === 'class' && (
              <select value={o.classKg ?? ''} onChange={(e) => set({ classKg: Number(e.target.value) })} aria-label="Weight class" data-testid="r-class">
                {classes.map((c) => (
                  <option key={c} value={c}>
                    {fmtKg(c)} kg
                  </option>
                ))}
              </select>
            )}
            {o.scope === 'selected' && (
              <div className="pick-list">
                <div className="row-gap">
                  <input type="search" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search athletes" />
                  <button className="btn btn-sm" onClick={() => set({ selectedIds: [...new Set([...o.selectedIds, ...pickable.map((a) => a.id)])] })}>All</button>
                  <button className="btn btn-sm" onClick={() => set({ selectedIds: [] })}>None</button>
                </div>
                <div className="pick-grid">
                  {pickable.map((a) => {
                    const on = o.selectedIds.includes(a.id);
                    return (
                      <label key={a.id} className={`pick ${on ? 'pick-on' : ''}`}>
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => set({ selectedIds: on ? o.selectedIds.filter((x) => x !== a.id) : [...o.selectedIds, a.id] })}
                          data-testid={`sel-${a.id}`}
                        />
                        <span>
                          {a.lastName}, {a.firstName}
                          <small>
                            {a.ageDivision} · {fmtKg(a.weightClassKg)}
                            {!a.active && ' · removed'}
                          </small>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
            {snap.athletes.some((a) => !a.active) && (
              <label className="check">
                <input type="checkbox" checked={o.includeRemoved} onChange={(e) => set({ includeRemoved: e.target.checked })} /> Include athletes removed from roster
              </label>
            )}
          </div>
        </div>

        <div className="rs-row">
          <div className="rs-label">Show</div>
          <div className="rs-body">
            <div className="chips">
              <Chk k="showDaily" label="Daily change" />
              <Chk k="showCategory" label="Category Δ" />
              <Chk k="showStatus" label="Status" />
              <Chk k="showHealth" label="Health status" />
              <Chk k="showNotes" label="Notes" />
              <Chk k="showMissing" label="Missing weigh-ins" />
              {!single && <Chk k="showSummary" label="Summary table" />}
            </div>
            {!single && (
              <div className="rs-inline">
                <span className="muted small">Arrange by</span>
                <Seg
                  testId="group"
                  value={o.groupBy}
                  options={[
                    ['date', 'Day'],
                    ['athlete', 'Athlete'],
                  ]}
                  onChange={(v) => set({ groupBy: v })}
                />
              </div>
            )}
          </div>
        </div>

        {err && <p className="error-text" data-testid="report-error">{err}</p>}
        <div className="row-gap report-actions">
          <button className="btn btn-primary" disabled={!report} onClick={() => window.print()} data-testid="r-print">
            Print / PDF
          </button>
          {share ? (
            <>
              <button className="btn" disabled={!report} onClick={() => exportFile('html', 'share')}>Share report…</button>
              <button className="btn" disabled={!report} onClick={() => exportFile('csv', 'share')}>Share CSV…</button>
            </>
          ) : null}
          <button className="btn" disabled={!report} onClick={() => exportFile('html', 'download')} data-testid="r-html">
            Download HTML
          </button>
          <button className="btn" disabled={!report} onClick={() => exportFile('csv', 'download')} data-testid="r-csv">
            Download CSV
          </button>
        </div>
        {report && (
          <p className="small muted">
            {periodLabel(o)} · {report.athletes.length} athlete{report.athletes.length === 1 ? '' : 's'}
            {(o.showHealth || o.showNotes) && ' · contains health information'}
          </p>
        )}
      </section>

      {report && <div className="card rdoc report-doc" data-testid="report-doc" dangerouslySetInnerHTML={{ __html: html }} />}
    </>
  );
}
