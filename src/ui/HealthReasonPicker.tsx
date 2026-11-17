import { useState } from 'react';
import type { HealthReason } from '../lib/types';
import { reasonKey } from '../db/db';

/** Select / search / add a reusable health reason. Most-used reasons are one tap away. */
export function HealthReasonPicker({
  reasons,
  value,
  onChange,
  onCreate,
}: {
  reasons: HealthReason[];
  value: string | null;
  onChange: (id: string | null) => void;
  onCreate: (label: string) => Promise<void>;
}) {
  const [q, setQ] = useState('');
  const selected = reasons.find((r) => r.id === value) ?? null;
  const sorted = [...reasons].sort((a, b) => b.useCount - a.useCount || a.label.localeCompare(b.label));
  const qk = reasonKey(q);
  const matches = qk ? sorted.filter((r) => r.key.includes(qk)) : sorted.slice(0, 8);
  const exact = qk ? reasons.find((r) => r.key === qk) : null;

  return (
    <div className="reason" data-testid="reason-picker">
      <div className="reason-head">Health reason {selected ? '' : <span className="muted">(optional)</span>}</div>
      {selected ? (
        <div className="reason-selected">
          <span className="chip chip-on" data-testid="reason-selected">
            {selected.label}
          </span>
          <button className="link-btn" onClick={() => onChange(null)}>
            Change
          </button>
        </div>
      ) : (
        <>
          <input
            type="search"
            placeholder="Search or add reason…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === 'Enter' && q.trim()) {
                e.preventDefault();
                if (exact) onChange(exact.id);
                else await onCreate(q);
                setQ('');
              }
            }}
            aria-label="Search or add health reason"
            data-testid="reason-input"
          />
          <div className="chips">
            {matches.map((r) => (
              <button key={r.id} className="chip" onClick={() => (onChange(r.id), setQ(''))}>
                {r.label}
              </button>
            ))}
            {qk && !exact && (
              <button
                className="chip chip-add"
                onClick={async () => {
                  await onCreate(q);
                  setQ('');
                }}
                data-testid="reason-add"
              >
                + Add “{q.trim()}”
              </button>
            )}
            {!reasons.length && !qk && <span className="muted small">No reasons yet — type one to add it.</span>}
          </div>
        </>
      )}
    </div>
  );
}
