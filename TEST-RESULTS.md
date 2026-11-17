# Test results

Run on 2026-11-17T15:12Z — Node v22.23.4, Chrome for, Playwright 1.63.

## Unit / integration tests (Vitest + fake-indexeddb) — `npm test`

```
 ✓ tests/db.test.ts > roster import > parses the sample roster
 ✓ tests/db.test.ts > roster import > reports invalid records and fatal schema errors
 ✓ tests/db.test.ts > roster import > same name with different ids are two athletes
 ✓ tests/db.test.ts > roster import > initial import, repeat import without duplicates, update keeps history
 ✓ tests/db.test.ts > roster import > removing an athlete keeps history; re-import reactivates
 ✓ tests/db.test.ts > weigh-ins > creates once per day and corrects instead of duplicating
 ✓ tests/db.test.ts > weigh-ins > rejects weights below 20 kg
 ✓ tests/db.test.ts > weigh-ins > health reasons are de-duplicated and reusable
 ✓ tests/db.test.ts > persistence, backup, restore > data survives closing and reopening the database
 ✓ tests/db.test.ts > persistence, backup, restore > export → restore into a fresh database reproduces the camp
 ✓ tests/db.test.ts > persistence, backup, restore > restore replaces existing local data atomically
 ✓ tests/db.test.ts > persistence, backup, restore > rejects malformed / incompatible backups
 ✓ tests/calc.test.ts > daily delta > negative (loss)
 ✓ tests/calc.test.ts > daily delta > positive (gain)
 ✓ tests/calc.test.ts > daily delta > no float artifacts
 ✓ tests/calc.test.ts > daily delta > absent previous measurement → null
 ✓ tests/calc.test.ts > daily delta > consecutive day
 ✓ tests/calc.test.ts > daily delta > missing days → identifies elapsed interval, uses latest earlier record
 ✓ tests/calc.test.ts > category delta > above limit
 ✓ tests/calc.test.ts > category delta > below limit
 ✓ tests/calc.test.ts > category delta > exact
 ✓ tests/calc.test.ts > status — three zones (default) > delta 2.1 → RED
 ✓ tests/calc.test.ts > status — three zones (default) > delta 2.01 → RED
 ✓ tests/calc.test.ts > status — three zones (default) > delta 2 → YELLOW
 ✓ tests/calc.test.ts > status — three zones (default) > delta 1.5 → YELLOW
 ✓ tests/calc.test.ts > status — three zones (default) > delta 1 → YELLOW
 ✓ tests/calc.test.ts > status — three zones (default) > delta 0.99 → GREEN
 ✓ tests/calc.test.ts > status — three zones (default) > delta 0.9 → GREEN
 ✓ tests/calc.test.ts > status — three zones (default) > delta 0 → GREEN
 ✓ tests/calc.test.ts > status — three zones (default) > delta -3 → GREEN
 ✓ tests/calc.test.ts > status — three zones (default) > boundaries computed from real weights (72.3 vs 70.3 = +2.0 → YELLOW)
 ✓ tests/calc.test.ts > status — two zones > delta 0.6 → RED
 ✓ tests/calc.test.ts > status — two zones > delta 0.51 → RED
 ✓ tests/calc.test.ts > status — two zones > delta 0.5 → GREEN
 ✓ tests/calc.test.ts > status — two zones > delta 0.4 → GREEN
 ✓ tests/calc.test.ts > status — two zones > delta -1 → GREEN
 ✓ tests/calc.test.ts > status — two zones > never yields YELLOW when disabled
 ✓ tests/calc.test.ts > status — two zones > rules text
 ✓ tests/calc.test.ts > thresholds > rejects yellow > red
 ✓ tests/calc.test.ts > thresholds > allows yellow > red when yellow disabled
 ✓ tests/calc.test.ts > thresholds > results change after threshold change; weights untouched
 ✓ tests/calc.test.ts > thresholds > missing record is MISSING, never GREEN, and last earlier record shown separately
 ✓ tests/calc.test.ts > thresholds > history uses snapshot class at time of measurement
 ✓ tests/calc.test.ts > weight validation > rejects < 20 kg
 ✓ tests/calc.test.ts > weight validation > accepts 20 kg and normal weights
 ✓ tests/calc.test.ts > weight validation > rejects absurd values
 ✓ tests/calc.test.ts > keypad > types a weight
 ✓ tests/calc.test.ts > keypad > prevents multiple decimal separators
 ✓ tests/calc.test.ts > keypad > leading dot becomes 0.
 ✓ tests/calc.test.ts > keypad > max 2 decimals
 ✓ tests/calc.test.ts > keypad > max 3 integer digits
 ✓ tests/calc.test.ts > keypad > no leading zeros
 ✓ tests/calc.test.ts > keypad > backspace & clear
 ✓ tests/calc.test.ts > keypad > parse
 ✓ tests/calc.test.ts > dates > validates ISO dates
 ✓ tests/calc.test.ts > dates > days between across month
 ✓ tests/calc.test.ts > csv > has header, ISO dates, dot decimals, negative numbers unescaped, quoting
 ✓ tests/report.test.ts > reports > validates options
 ✓ tests/report.test.ts > reports > single day, all active athletes: counts + missing
 ✓ tests/report.test.ts > reports > range, one athlete: summary with change/min/max/missing/unhealthy
 ✓ tests/report.test.ts > reports > group scopes: division, class, include removed
 ✓ tests/report.test.ts > reports > HTML respects health/notes toggles and escapes user text
 ✓ tests/report.test.ts > reports > CSV columns follow the toggles
      Tests  63 passed (63)
```

## End-to-end acceptance scenario (spec §22) — `python3 e2e/acceptance.py`

Runs the production build in headless Chrome. For every offline step the preview server process is **killed** and the browser context is set offline. Screenshots: `e2e/screenshots/` (including `report-print.pdf`, the printed report).

```
==== SUMMARY ====
PASS  1-2 Launch app (empty state) and create/name the camp
PASS  3-4 Import JSON roster with preview; athletes appear in roster
PASS  Re-import same roster → no duplicates (10 unchanged)
PASS  Invalid roster file is rejected with a clear message
PASS  5 Disconnect: kill server + browser offline
PASS  6-12 Offline sequential weigh-in with keypad, live deltas & status, Save & Next
PASS  Existing record is shown as EDITING and corrected without duplication
PASS  19 Mark unhealthy with a new reusable reason, then reuse it for another athlete
PASS  13-14 Team dashboard: statuses, counts, missing identified
PASS  15-16 Change thresholds to 2-zone (+0.5) → statuses update immediately
PASS  17-18 Athlete history + chart (offline), correction via Edit
PASS  Reports (offline): one day / range, one athlete / group / all, health & notes on/off, CSV/HTML/PDF
PASS  CSV export works offline (dot decimals, ISO dates)
PASS  20-21 Close and reopen the app (offline, server still down) → records intact
PASS  22 Export complete backup (offline)
PASS  Malformed backup is rejected; nothing changes
PASS  Restore over existing data requires explicit confirmation
PASS  23-24 Restore backup into a fresh install (offline) and verify it matches
PASS  Responsive layouts: iPhone & iPad mini, portrait & landscape — no horizontal overflow, large keypad
19 passed, 0 failed
```

## Not tested here (no physical device available)

- Real iPhone / iPad mini Safari and "Add to Home Screen" install. Layouts were tested at iPhone (390×844, 844×390) and iPad mini (744×1133, 1133×744) viewports in Chrome with touch emulation, not in WebKit.
- iOS on-screen keyboard behaviour. Routine weighing uses the in-app keypad, so the system keyboard only appears for search, notes, reason entry and settings; the notes field scrolls itself into view on focus.
- iOS storage eviction behaviour over weeks of use.
- Note: in the e2e run, the backup export after a browser *restart* is captured from the app's own download link rather than Playwright's download event, because Playwright's download artefacts are unreliable in a relaunched persistent Chrome profile (reproduced with a trivial page). The browser-level download path itself is covered by the CSV and fresh-install backup exports.
