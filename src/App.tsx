import { useEffect, useState } from 'react';
import { go, useApp, useRoute } from './state';
import { createCamp, restoreBackup } from './db/db';
import { parseBackup } from './lib/validate';
import { fmtDate } from './lib/dates';
import { Modal, Toasts, pickFile } from './ui/components';
import { WeighInScreen } from './screens/WeighIn';
import { TeamScreen } from './screens/Team';
import { AthleteScreen } from './screens/Athlete';
import { RosterScreen } from './screens/Roster';
import { SettingsScreen } from './screens/Settings';
import { ReportsScreen } from './screens/Reports';

const TABS = [
  { id: 'weigh', label: 'Weigh-in', icon: '⚖' },
  { id: 'team', label: 'Team', icon: '▦' },
  { id: 'reports', label: 'Reports', icon: '▤' },
  { id: 'roster', label: 'Roster', icon: '☰' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
];

export function App() {
  const { snap, today } = useApp();
  const route = useRoute();
  const online = useOnline();

  if (!snap.camp)
    return (
      <>
        <Setup />
        <Toasts />
      </>
    );

  const top = route.path[0] || 'weigh';
  let screen;
  if (top === 'team') screen = <TeamScreen />;
  else if (top === 'athlete' && route.path[1]) screen = <AthleteScreen id={route.path[1]} />;
  else if (top === 'roster') screen = <RosterScreen />;
  else if (top === 'reports') screen = <ReportsScreen />;
  else if (top === 'settings') screen = <SettingsScreen />;
  else screen = <WeighInScreen />;
  const activeTab = top === 'athlete' ? 'team' : TABS.some((t) => t.id === top) ? top : 'weigh';

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="camp-name" data-testid="camp-title">
            {snap.camp.name}
          </span>
          <span className="today">{fmtDate(today, { weekday: true, year: true })}</span>
        </div>
        <nav className="tabs tabs-top">
          {TABS.map((t) => (
            <a key={t.id} href={`#/${t.id}`} className={activeTab === t.id ? 'on' : ''} data-testid={`tab-${t.id}`}>
              {t.label}
            </a>
          ))}
        </nav>
        <span className={`net ${online ? 'net-on' : 'net-off'}`} title="All data is stored on this device">
          {online ? 'Online' : 'Offline'} · local
        </span>
      </header>
      <main className={`main main-${top}`}>{screen}</main>
      <nav className="tabs tabs-bottom">
        {TABS.map((t) => (
          <a key={t.id} href={`#/${t.id}`} className={activeTab === t.id ? 'on' : ''}>
            <span className="tab-ico" aria-hidden>
              {t.icon}
            </span>
            {t.label}
          </a>
        ))}
      </nav>
      <Toasts />
    </div>
  );
}

function useOnline() {
  const [on, setOn] = useState(navigator.onLine);
  useEffect(() => {
    const a = () => setOn(true);
    const b = () => setOn(false);
    window.addEventListener('online', a);
    window.addEventListener('offline', b);
    return () => {
      window.removeEventListener('online', a);
      window.removeEventListener('offline', b);
    };
  }, []);
  return on;
}

function Setup() {
  const { run } = useApp();
  const [name, setName] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [err, setErr] = useState<string[] | null>(null);
  return (
    <div className="setup">
      <div className="setup-card card">
        <h1>Athlete Weight Monitor</h1>
        <p className="muted">Offline weigh-in tool for training camps. All data is stored on this device only.</p>
        <h2>Create the training camp</h2>
        <div className="form">
          <label>
            Camp name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. National Team Camp — Dec" data-testid="setup-name" />
          </label>
          <div className="form-row">
            <label>
              Start date (optional)
              <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </label>
            <label>
              End date (optional)
              <input type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} />
            </label>
          </div>
          <button
            className="btn btn-primary btn-lg"
            disabled={!name.trim()}
            onClick={async () => {
              const c = await run((d) => createCamp(d, { name, startDate: start, endDate: end }), 'Camp created — now import the roster');
              if (c) go('roster');
            }}
            data-testid="setup-create"
          >
            Create camp
          </button>
        </div>
        <div className="setup-alt">
          <span className="muted">Moving from another device?</span>
          <button
            className="btn"
            onClick={async () => {
              const f = await pickFile();
              if (!f) return;
              const r = parseBackup(f.text);
              if (!r.ok) return setErr(r.errors);
              if (await run(async (d) => (await restoreBackup(d, r.backup!), true), `Restored camp “${r.backup!.camp.name}”`)) go('team');
            }}
            data-testid="setup-restore"
          >
            Restore from backup file
          </button>
        </div>
      </div>
      {err && (
        <Modal title="Backup rejected" onClose={() => setErr(null)}>
          <ul className="error-text small" data-testid="restore-errors">
            {err.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </Modal>
      )}
    </div>
  );
}
