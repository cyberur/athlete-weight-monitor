import { useEffect, useMemo, useRef, useState } from 'react';
import type { WeighIn } from '../lib/types';
import { categoryDelta, evaluateStatus, fmtKg, fmtSigned, type Thresholds } from '../lib/weight';
import { addDays, daysBetween, fmtShort } from '../lib/dates';

const STATUS_COLOR = { RED: 'var(--red)', YELLOW: 'var(--yellow)', GREEN: 'var(--green)' } as const;

/**
 * Dependency-free SVG line chart. X is a true calendar axis, so missing days appear as gaps
 * (segments spanning missing days are drawn dashed). The class limit is a dashed step line.
 */
export function WeightChart({
  records,
  thresholds,
  currentClassKg,
}: {
  records: WeighIn[];
  thresholds: Thresholds;
  currentClassKg: number;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [sel, setSel] = useState<string | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(280, el.clientWidth)));
    ro.observe(el);
    setWidth(Math.max(280, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  const pts = useMemo(() => [...records].sort((a, b) => (a.date < b.date ? -1 : 1)), [records]);

  if (!pts.length)
    return (
      <div ref={wrap} className="chart-empty" data-testid="chart">
        No data to chart yet.
      </div>
    );

  const height = width < 500 ? 220 : 280;
  const m = { l: 44, r: 16, t: 16, b: 34 };
  const first = pts[0].date;
  const last = pts[pts.length - 1].date;
  const spanDays = Math.max(1, daysBetween(first, last));
  const x0 = first;
  const values = [...pts.map((p) => p.weightKg), ...pts.map((p) => p.weightClassKgAtTime), currentClassKg];
  let lo = Math.floor(Math.min(...values) - 0.5);
  let hi = Math.ceil(Math.max(...values) + 0.5);
  if (hi - lo < 3) {
    const mid = (hi + lo) / 2;
    lo = Math.floor(mid - 1.5);
    hi = Math.ceil(mid + 1.5);
  }
  const iw = width - m.l - m.r;
  const ih = height - m.t - m.b;
  const pad = pts.length === 1 ? 0.5 : 0;
  const X = (d: string) => m.l + ((daysBetween(x0, d) + pad) / (spanDays + 2 * pad || 1)) * iw;
  const Y = (v: number) => m.t + (1 - (v - lo) / (hi - lo)) * ih;

  // y ticks
  const step = hi - lo > 12 ? 2 : hi - lo > 6 ? 1 : 0.5;
  const yt: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) yt.push(Math.round(v * 10) / 10);
  // x ticks: up to ~6 labels
  const maxLabels = Math.max(2, Math.floor(iw / 70));
  const every = Math.max(1, Math.ceil((spanDays + 1) / maxLabels));
  const xt: string[] = [];
  for (let i = 0; i <= spanDays; i += every) xt.push(addDays(first, i));

  // limit step line
  const limitPath: string[] = [];
  pts.forEach((p, i) => {
    const xs = i === 0 ? m.l : X(p.date);
    const xe = i === pts.length - 1 ? m.l + iw : X(pts[i + 1].date);
    limitPath.push(`${i === 0 ? 'M' : 'L'}${xs},${Y(p.weightClassKgAtTime)} L${xe},${Y(p.weightClassKgAtTime)}`);
  });

  const selected = pts.find((p) => p.id === sel);

  return (
    <div ref={wrap} className="chart" data-testid="chart">
      <svg width={width} height={height} role="img" aria-label="Body weight trend chart">
        {yt.map((v) => (
          <g key={v}>
            <line x1={m.l} x2={m.l + iw} y1={Y(v)} y2={Y(v)} className="grid" />
            <text x={m.l - 6} y={Y(v) + 4} className="axis" textAnchor="end">
              {v.toFixed(step < 1 ? 1 : 0)}
            </text>
          </g>
        ))}
        {xt.map((d) => (
          <text key={d} x={X(d)} y={height - 10} className="axis" textAnchor="middle">
            {fmtShort(d)}
          </text>
        ))}
        <text x={12} y={m.t + ih / 2} className="axis" transform={`rotate(-90 12 ${m.t + ih / 2})`} textAnchor="middle">
          kg
        </text>
        <path d={limitPath.join(' ')} className="limit" data-testid="limit-line" />
        <text x={m.l + iw - 4} y={Y(pts[pts.length - 1].weightClassKgAtTime) - 5} className="limit-label" textAnchor="end">
          Limit {fmtKg(pts[pts.length - 1].weightClassKgAtTime)}
        </text>
        {pts.slice(1).map((p, i) => {
          const a = pts[i];
          const gap = daysBetween(a.date, p.date) > 1;
          return <line key={p.id} x1={X(a.date)} y1={Y(a.weightKg)} x2={X(p.date)} y2={Y(p.weightKg)} className={gap ? 'series gap' : 'series'} />;
        })}
        {pts.map((p) => {
          const st = evaluateStatus(categoryDelta(p.weightKg, p.weightClassKgAtTime), thresholds);
          return (
            <g key={p.id} onClick={() => setSel(sel === p.id ? null : p.id)} className="pt" data-testid="chart-point">
              <circle cx={X(p.date)} cy={Y(p.weightKg)} r={14} fill="transparent" />
              <circle cx={X(p.date)} cy={Y(p.weightKg)} r={sel === p.id ? 7 : 5} fill={STATUS_COLOR[st]} stroke="#fff" strokeWidth={2}>
                <title>
                  {fmtShort(p.date)}: {fmtKg(p.weightKg)} kg ({fmtSigned(categoryDelta(p.weightKg, p.weightClassKgAtTime))} vs limit)
                </title>
              </circle>
            </g>
          );
        })}
      </svg>
      {selected && (
        <div
          className="tooltip"
          style={{ left: Math.min(Math.max(X(selected.date) - 70, 4), width - 150), top: Math.max(Y(selected.weightKg) - 64, 0) }}
          data-testid="chart-tooltip"
        >
          <strong>{fmtShort(selected.date)}</strong> · {fmtKg(selected.weightKg)} kg
          <br />
          {fmtSigned(categoryDelta(selected.weightKg, selected.weightClassKgAtTime))} kg vs {fmtKg(selected.weightClassKgAtTime)}
        </div>
      )}
      <div className="chart-legend small muted">
        ● measurement (colour = status) &nbsp; ┅ dashed segment = days without a weigh-in &nbsp; <span className="limit-key">┄</span> class limit
      </div>
    </div>
  );
}
