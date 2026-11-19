# Athlete Weight Monitor

An offline-first Progressive Web App (PWA) for daily weigh-ins during an MMA training camp, built for iPad mini and iPhone. Everything runs on the device: you don't need an account, a server or an internet connection after the first load.

**Daily routine:** select an athlete → type the weight on the big keypad → **Save & Next**. The daily change, the delta against the weight-class limit and the Red/Yellow/Green status are calculated as you type.

---

## 1. Quick start

```bash
npm install          # Node 18+ (tested on Node 22)
npm run dev          # development server (no service worker)
npm test             # 63 unit/integration tests
npm run build        # type-check + production build → dist/
npm run preview      # serve dist/ at http://localhost:4173 (service worker active)
```

End-to-end acceptance test (needs Python 3, `pip install playwright`, and Chrome at `/usr/bin/google-chrome` or set `CHROME=`):

```bash
npm run build && python3 e2e/acceptance.py
```

## 2. Installing on iPad / iPhone

Service workers only run over **HTTPS**, so `dist/` has to be served from an HTTPS static host. Any free static host works. `dist/` only uses relative paths, so it also works from a sub-folder.

- **Netlify Drop:** drag the `dist/` folder onto app.netlify.com/drop.
- **GitHub Pages / Cloudflare Pages:** publish the contents of `dist/`.
- **Self-hosted:** any web server with a TLS certificate. No server-side code is needed.

Then on each device:

1. Open the URL in **Safari**.
2. Tap Share → **Add to Home Screen**.
3. Open the app once from the Home Screen while online. Settings → "Offline ready: yes" confirms it is cached.
4. From then on it works fully offline.

> Data lives on each device separately. Data saved in Safari is **not** shared with the Home Screen app on iOS, so pick one and always use it. The Home Screen app is recommended.

## 3. Using the app

| Screen | Purpose |
|---|---|
| **Weigh-in** | Main screen. Athlete selector (side list on iPad landscape, a sheet on iPhone), large keypad, live deltas and status, Healthy toggle (on by default), health reason, notes, Save & Next. A date picker allows catch-up or back-dated entries; the screen warns when the date is not today. |
| **Team** | Whole roster for a selected date, with Red / Yellow / Green / Missing / Not healthy counts (tap a count to filter), search, division and class filters, and sorting by status, category Δ or name. Tap a row to open the athlete. |
| **Athlete** | Identity, summary, trend chart (true date axis, class-limit reference line, tap a point for details), every weigh-in with Edit and Delete. |
| **Reports** | Configurable reports (§5a): one day or a date range; one athlete, a selection, a division, a weight class or everyone; health / notes / missing / deltas / status / summary on or off; arrange by day or by athlete. Print / PDF, HTML file, CSV. Also reachable via **Report** buttons on Team (that day) and Athlete (whole history). |
| **Roster** | JSON roster import with preview; add, edit, remove or restore athletes; search; sort. |
| **Settings** | Camp name and dates, weight-status thresholds, backup / restore / CSV export, IMMAF reference data editor, storage and privacy information. |

### Rules the app applies

- **One record per athlete per calendar day** (device local time). If a record already exists, selecting the athlete loads it and shows **EDITING**, and saving corrects it rather than creating a duplicate. A new entry shows **NEW**.
- **Save & Next** moves to the next athlete in name order who has no record yet for that date.
- **Weights must be 20–300 kg.** Anything below 20 kg is rejected in the UI and in the database layer. The keypad allows at most one decimal point and 2 decimals (0.01 kg resolution; 0.1 kg is the normal entry).
- **Daily Δ** = current weight − the athlete's most recent earlier recorded weight. With no earlier record it shows "—". If the earlier record is more than one day back, the interval is shown ("over 3 days", "/3d") so a multi-day change is never presented as a one-day change.
- **Category Δ** = weight − weight-class limit. It is shown separately from the daily change.
- **Weight-class snapshot:** each weigh-in stores the athlete's division and class at the time it is saved. Changing an athlete's class later does **not** alter past records or their category deltas. Re-saving (correcting) a record updates its snapshot to the athlete's current class.
- **Missing:** an athlete with no record on the selected date is shown as MISSING (dashed grey), never Green. The last earlier weight may be shown in grey together with its own date. It is never substituted as that day's value.
- All arithmetic uses integer hundredths of a kg, so there are no floating-point artifacts. For example, 72.3 − 70.3 is exactly +2.0, which is YELLOW under the default rules.

### Status thresholds (Settings → Weight-control status)

The status comes from the category delta *d*:

| Configuration | RED | YELLOW | GREEN |
|---|---|---|---|
| 3 zones (default: Red 2.0, Yellow 1.0) | *d* > +2.0 | +1.0 ≤ *d* ≤ +2.0 | *d* < +1.0 |
| 2 zones (Yellow disabled, e.g. Red 0.5) | *d* > +0.5 | — | *d* ≤ +0.5 |

- Both thresholds are editable (negative values are allowed, e.g. "must be under the limit").
- The active rules are shown in plain words before you apply them.
- Changes take effect immediately for every displayed record, including history, using the current rules (no policy versioning, as the spec requires). Recorded weights never change.
- Every colour also carries a text label.

### Health

- **Healthy** is on by default.
- Turning it off reveals the health-reason picker. The most-used reasons are one tap away, you can search them, and typing a new reason offers **+ Add**. Reasons are case- and whitespace-insensitive, so no duplicates are created, and they are reusable for any athlete or day.
- Starter vocabulary: Respiratory infection, Gastrointestinal illness, Injury, Fever, Other.
- Notes are free text and independent of the health reason.
- The app does no diagnosis and makes no recommendations.

## 4. Roster import format (schema v1)

```json
{
  "schemaVersion": 1,
  "camp": { "id": "camp-001", "name": "MMA Training Camp" },
  "athletes": [
    { "id": "athlete-001", "firstName": "Alex", "lastName": "Morgan", "ageDivision": "Senior", "weightClassKg": 70.3 }
  ]
}
```

- `camp` is optional and informational. Athletes are always imported into the **active** camp.
- `id` must be stable and unique. Athletes are matched by `id`, **never by name**: `samples/sample-roster.json` deliberately contains two different "Alex Morgan"s.
- `ageDivision` is free text. Names not in the reference data are imported with a warning.
- `weightClassKg` is a number from 20 to 300.

The preview shows New / Updated (with field diffs) / Restored / Unchanged / Invalid counts before anything is written. Invalid records are listed with reasons and skipped; a malformed file (bad JSON, wrong `schemaVersion`, a backup file) is rejected entirely.

Re-importing the same file creates nothing new. Updates never touch weigh-in history, and athletes missing from the file are left alone. The whole import is written in **one IndexedDB transaction** (all-or-nothing).

**Prompt for the external AI assistant:** "Convert this roster to JSON with exactly this shape: `{schemaVersion:1, camp:{id,name}, athletes:[{id, firstName, lastName, ageDivision, weightClassKg}]}`. ageDivision must be one of Senior, Junior, Youth A, Youth B, Youth C, Youth D. weightClassKg is the class limit in kg as a number. Give every athlete a stable id and keep the same id for the same person in future rosters."

## 5. Backup, restore, CSV

- **Full backup (JSON):** camp (including thresholds), roster (including removed athletes), all weigh-ins with health data and notes, the health-reason dictionary and the category reference data, plus the format id, `schemaVersion`, `exportedAt` and `appVersion`. That is sufficient to rebuild the camp on another device.
- **Restore** is separate from roster import. It validates everything first: format, version, thresholds, ids, references to athletes and reasons, dates, weights, and one record per athlete per day. It then shows *on this device* vs *in backup*, offers "download a backup of current data first", and requires an "I understand this replaces all data" tick. The replacement is a single atomic transaction. A fresh install can restore straight from the setup screen.
- **CSV:** one row per weigh-in. Comma-separated, `.` decimals, ISO `YYYY-MM-DD` dates, UTF-8 with BOM (Excel-friendly), CRLF line endings. Formula-like text is neutralised.
  - Columns: `camp_id, camp_name, date, athlete_id, first_name, last_name, age_division, weight_class_kg, weight_kg, previous_date, days_since_previous, daily_delta_kg, category_delta_kg, status, healthy, health_reason, notes, updated_at`.
- Exports work offline. On iPhone/iPad, **Share / Save to Files…** is also offered (Web Share API), because downloads from Home Screen apps behave inconsistently on some iOS versions.

## 5a. Reports

| Setting | Options |
|---|---|
| Period | One day · date range (presets: Today, Yesterday, Last 7 days, Whole camp); max 366 days |
| Athletes | All · Division · Weight class · Selected (one or many, with search); optionally include athletes removed from the roster |
| Show | Daily change · Category Δ · Status · Health status (with reason) · Notes · Missing weigh-ins · Summary table (ranges) |
| Arrange by | Day (one table per day, newest first) · Athlete (one table per athlete) |

- **Range summary** per athlete: records, missing days, first and last weight (with dates), change over the period, min/max, last category Δ and status, unhealthy days and their reasons.
- **Daily change** on the first day of a range still uses the athlete's previous record from before the range.
- **Status** uses the current thresholds, and the active rules are printed in the report header.
- **Output:**
  - **Print / PDF** opens the system print dialog with a print layout (iOS: Print → "Save to Files" for a PDF).
  - **Share report… / Download HTML** produces a self-contained file that opens in any browser and can be emailed.
  - **CSV** contains exactly the selected columns and rows.
- When Health status or Notes are on, the report is marked confidential. Turn both off before sharing a report outside the medical team.
- Report settings are kept while the app stays open.

### Attendance report

Reports → **Attendance** (or **Attendance** on the Team screen):
- One date, shown prominently, with the heading "List of athletes present at training".
- Athletes are grouped **Youth** (sorted D→C→B→A), **Junior**, **Senior**; any other division gets its own group.
- **Present** means a weigh-in is recorded for that date.
- Options: show the weight class; list absent athletes per group.
- Athletes marked **Exclude from Attendance report** (Roster → Edit) are still weighed, shown on Team, history and weight reports, but never appear in Attendance (neither present nor absent, not counted). Roster re-import keeps this flag.
- **Copy text (WhatsApp)** produces the team's usual format (`*Attendance* 19/11/26`, `1. B / Name / 44 kg ✅`). Print / PDF and an HTML file are also available.

## 6. IMMAF reference data

These are stored locally and editable in Settings. Sources (checked Nov 2026):

- **Senior & Junior:** IMMAF Weight Management Policy (immaf.org, 29 Jun 2024), "new" categories:
  - Women: 47.6 / 52.2 / 56.7 / 61.2 / 65.8 / 70.3 / 74.8 / 79.4.
  - Men: 52.2 … 70.3 / 74.8 / 79.4 / 83.9 / 88.4 / 93.0 / 97.0.
- **Youth A (16–17):** Atom 47.7 (F), Straw 52.2 … Welter 77.1, Middle 83.9 / LHW 93.0 / HW 120.2 (M). Source: IMMAF Youth World Championships FAQ (May 2021).
- **Youth B (14–15):** −40 … −72 kg. **Youth C (12–13):** −31 … −57 kg. Same source.
- **Youth D (10–11):** the division exists (2026 IMMAF Youth Rules Summary), but **no official weight classes could be verified**, so none are pre-filled. Add them in Settings, or give the athlete a custom limit.
- Open-ended "+" classes are omitted because they have no upper limit to compare against.

Verify against the current IMMAF rulebook before using these for competition. Editing the reference list never changes athletes or past records; every athlete stores their own numeric limit.

## 7. Architecture

```
src/
  lib/          pure logic, no I/O (unit-tested)
    weight.ts     integer-centi arithmetic, status evaluation, formatting
    calc.ts       daily/category deltas, team rows, history
    validate.ts   roster + backup parsing/validation, import preview
    report.ts     report selection, summaries, HTML/CSV output
    csv.ts, keypad.ts, dates.ts, reference.ts, download.ts, types.ts
  db/db.ts      IndexedDB persistence (idb); the only module touching storage
  state.tsx     app context (snapshot + mutation runner), tiny hash router
  screens/      WeighIn, Team, Athlete, Reports, Roster, Settings
  ui/           shared components, WeightChart (dependency-free SVG), HealthReasonPicker
build/          Vite plugin that generates dist/sw.js (precache list + content-hash version)
public/         manifest.webmanifest, icons
samples/        sample-roster.json (fictional)
tests/          Vitest unit + IndexedDB integration tests
e2e/            Playwright acceptance scenario + screenshots
```

- **Stack:** React 18 + TypeScript + Vite. The only runtime dependency besides React is `idb` (≈1 KB). There is no chart library and no Workbox.
- **Storage:** IndexedDB `athlete-weight-monitor` v1, with these stores:
  - `meta`: active camp id and reference data.
  - `camps`
  - `athletes`: key `[campId, id]`.
  - `weighIns`: uuid key, unique index `[campId, athleteId, date]`.
  - `healthReasons`: unique normalised key.
- **Writes:** every save is committed immediately in a transaction. The app requests persistent storage (`navigator.storage.persist`). Write failures and quota errors show a persistent error toast.
- **Migrations** are additive only: the `upgrade()` handler never deletes stores.
- **Sync-ready:** every record carries a stable id, `campId`, and `createdAt`/`updatedAt` timestamps, and backups carry a `schemaVersion`. The UI never touches IndexedDB directly, so a sync adapter can sit beside `db.ts` later. The camp model is already keyed for multiple camps, but only one active camp is exposed.
- **Offline:** `sw.js` precaches every built file and serves cache-first. Navigations fall back to the cached app shell, and old caches are removed on activation. The cache version is a hash of the build output plus the SW template, so every new deploy updates on the next launch.

## 8. Privacy

The records contain health information.

- The app makes **no network requests** at runtime: no analytics, no fonts or CDNs, no accounts.
- Data never leaves the device unless a user exports it. Treat backup and CSV files as confidential medical records.
- Protect devices with a passcode. The app itself has no PIN, so anyone holding the unlocked device can open it.

## 9. Assumptions & known limitations

- **Camp-local day** is the device's local calendar date. All devices in a camp should use the same time zone.
- **Browser storage is not guaranteed permanent.** iOS may evict data from sites or Home Screen apps under storage pressure or after long periods of non-use. Removing the Home Screen app deletes its data. **Export a backup daily.**
- **No multi-device sync.** Each device has its own database. To move data, restore a backup on the other device; a restore *replaces* data rather than merging it.
- **Thresholds are applied retroactively** to the displayed history (MVP decision per spec); there is no policy history.
- The **sex** of an athlete is not stored (it is not in the import format). Pick lists label sex-specific classes (M/F) instead.
- The **Youth D** weight classes are unverified (see §6).
- **Testing:** iOS Safari itself was not available. Layouts and offline behaviour were verified in Chrome at iPhone/iPad-mini viewports. See `TEST-RESULTS.md`.
- **App updates:** a new deployment is picked up on the next launch while online. There is no in-app "update available" prompt.
