"""
End-to-end acceptance test (spec §22) against the PRODUCTION build, in real Chrome via Playwright.

"Offline" is enforced two ways at once: the preview server process is killed AND the browser
context is switched offline. Run:  python3 e2e/acceptance.py   (after `npm run build`)
Screenshots go to e2e/screenshots/.
"""
import json, os, re, shutil, signal, subprocess, sys, tempfile, time
from datetime import date, timedelta
from playwright.sync_api import sync_playwright, expect

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, 'e2e', 'screenshots')
OUT = os.path.join(ROOT, 'e2e', 'out')
URL = 'http://localhost:4173/'
CHROME = os.environ.get('CHROME', '/usr/bin/google-chrome')
os.makedirs(SHOTS, exist_ok=True); os.makedirs(OUT, exist_ok=True)

TODAY = date.today()
YDAY = (TODAY - timedelta(days=1)).isoformat()
D3 = (TODAY - timedelta(days=3)).isoformat()
results = []

def step(name):
    def deco(fn):
        def run(*a, **k):
            try:
                r = fn(*a, **k)
                results.append(('PASS', name)); print('PASS', name, flush=True)
                return r
            except Exception as e:
                results.append(('FAIL', name)); print('FAIL', name, '->', repr(e)[:400], flush=True)
                raise
        return run
    return deco

server = None
def start_server():
    global server
    server = subprocess.Popen(['npx', 'vite', 'preview', '--port', '4173', '--strictPort'], cwd=ROOT,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, preexec_fn=os.setsid)
    for _ in range(60):
        try:
            import urllib.request; urllib.request.urlopen(URL, timeout=1); return
        except Exception: time.sleep(0.25)
    raise RuntimeError('server did not start')

def stop_server():
    global server
    if server:
        os.killpg(os.getpgid(server.pid), signal.SIGTERM); server.wait(); server = None
    time.sleep(0.3)
    import urllib.request
    try:
        urllib.request.urlopen(URL, timeout=1); raise RuntimeError('server still reachable')
    except RuntimeError: raise
    except Exception: pass  # good: unreachable

def launch(pw, profile, viewport=(1133, 744), offline=False):
    return pw.chromium.launch_persistent_context(
        profile, executable_path=CHROME, headless=True, viewport={'width': viewport[0], 'height': viewport[1]},
        device_scale_factor=2, has_touch=True, offline=offline, accept_downloads=True,
        args=['--no-first-run'])

def wait_sw(page):
    page.wait_for_function("navigator.serviceWorker && navigator.serviceWorker.ready.then(() => true)")
    page.reload()
    page.wait_for_function("!!navigator.serviceWorker.controller", timeout=15000)

def type_weight(page, s):
    page.get_by_test_id('key-clear').click()
    for ch in s:
        page.get_by_test_id('key-dot' if ch == '.' else f'key-{ch}').click()

def set_weigh_date(page, d):
    page.get_by_label('Weigh-in date').fill(d)

def pick(page, athlete_id):
    side = page.locator('.weigh-side')
    if side.is_visible():
        side.get_by_test_id(f'pick-{athlete_id}').click()
    else:
        page.get_by_test_id('athlete-picker').click()
        page.locator('.sheet').get_by_test_id(f'pick-{athlete_id}').click()

def counts(page):
    return {k: int(page.get_by_test_id(f'count-{k}').locator('.count-n').inner_text())
            for k in ['RED', 'YELLOW', 'GREEN', 'MISSING', 'UNHEALTHY']}

def capture_download(page, testid):
    """Capture the file the app hands to the browser (a[download] + Blob) without relying on Playwright's
    download artefacts, which are unreliable in a relaunched persistent Chrome profile."""
    page.evaluate("""() => {
      window.__dl = null;
      const orig = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        if (this.download && this.href.startsWith('blob:')) {
          const name = this.download;
          fetch(this.href).then(r => r.text()).then(t => { window.__dl = { name, text: t }; });
          return;
        }
        return orig.call(this);
      };
    }""")
    page.get_by_test_id(testid).click()
    page.wait_for_function('window.__dl !== null')
    return page.evaluate('window.__dl')

def no_hscroll(page, label):
    w = page.evaluate("[document.documentElement.scrollWidth, window.innerWidth]")
    assert w[0] <= w[1] + 1, f'{label}: horizontal overflow {w}'

def main():
    prof_a = tempfile.mkdtemp(prefix='awm-a-'); prof_b = tempfile.mkdtemp(prefix='awm-b-')
    backup_path = os.path.join(OUT, 'backup.json')
    with sync_playwright() as pw:
        start_server()
        ctx = launch(pw, prof_a)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))

        @step('1-2 Launch app (empty state) and create/name the camp')
        def s1():
            page.goto(URL); wait_sw(page)
            expect(page.get_by_text('Create the training camp')).to_be_visible()
            page.get_by_test_id('setup-name').fill('UAE National Team Camp')
            page.get_by_test_id('setup-create').click()
            expect(page.get_by_test_id('camp-title')).to_have_text('UAE National Team Camp')
        s1()

        @step('3-4 Import JSON roster with preview; athletes appear in roster')
        def s3():
            page.goto(URL + '#/roster')
            with page.expect_file_chooser() as fc:
                page.get_by_test_id('import-roster').click()
            fc.value.set_files(os.path.join(ROOT, 'samples', 'sample-roster.json'))
            expect(page.get_by_test_id('import-preview')).to_be_visible()
            expect(page.get_by_test_id('confirm-import')).to_have_text('Import 10 athletes')
            page.screenshot(path=f'{SHOTS}/ipad-landscape-import-preview.png')
            page.get_by_test_id('confirm-import').click()
            expect(page.get_by_test_id('roster-table').locator('tbody tr')).to_have_count(10)
        s3()

        @step('Re-import same roster → no duplicates (10 unchanged)')
        def s3b():
            with page.expect_file_chooser() as fc:
                page.get_by_test_id('import-roster').click()
            fc.value.set_files(os.path.join(ROOT, 'samples', 'sample-roster.json'))
            expect(page.locator('.import-preview .count-missing .count-n')).to_have_text('10')
            page.get_by_test_id('confirm-import').click()
            expect(page.get_by_test_id('roster-table').locator('tbody tr')).to_have_count(10)
        s3b()

        @step('Invalid roster file is rejected with a clear message')
        def s3c():
            bad = os.path.join(OUT, 'bad-roster.json'); open(bad, 'w').write('{"schemaVersion": 1, "athletes": "nope"}')
            with page.expect_file_chooser() as fc:
                page.get_by_test_id('import-roster').click()
            fc.value.set_files(bad)
            expect(page.get_by_test_id('import-error')).to_contain_text('athletes')
            page.get_by_role('button', name='OK').click()
        s3c()

        @step('5 Disconnect: kill server + browser offline')
        def s5():
            stop_server(); ctx.set_offline(True)
            page.goto(URL + '#/weigh'); page.reload()
            expect(page.get_by_test_id('camp-title')).to_have_text('UAE National Team Camp')
            expect(page.locator('.net-off')).to_be_visible()
        s5()

        @step('6-12 Offline sequential weigh-in with keypad, live deltas & status, Save & Next')
        def s6():
            # earlier days, so deltas exist
            set_weigh_date(page, YDAY)
            pick(page, 'athlete-001'); type_weight(page, '72.0'); page.get_by_test_id('save').click()
            expect(page.get_by_test_id('last-saved')).to_contain_text('Alex Morgan — 72.0 kg')
            pick(page, 'athlete-003'); type_weight(page, '68'); page.get_by_test_id('save').click()
            set_weigh_date(page, D3)
            pick(page, 'athlete-008'); type_weight(page, '80'); page.get_by_test_id('save').click()
            set_weigh_date(page, TODAY.isoformat())

            pick(page, 'athlete-001')
            expect(page.get_by_test_id('mode')).to_contain_text('NEW')
            # keypad: multiple separators ignored, backspace works
            page.get_by_test_id('key-clear').click()
            for k in ['7', '1', 'dot', 'dot', '5', '9', 'back']:
                page.get_by_test_id(f'key-{k}').click()
            expect(page.get_by_test_id('readout')).to_have_text('71.5')
            expect(page.get_by_test_id('daily-delta')).to_have_text('−0.5 kg')
            expect(page.locator('.delta-s', has_text='vs yesterday')).to_be_visible()
            expect(page.get_by_test_id('category-delta')).to_have_text('+1.2 kg')
            expect(page.locator('.readout [data-status]')).to_have_text('YELLOW')
            page.screenshot(path=f'{SHOTS}/ipad-landscape-weighin.png')
            page.get_by_test_id('save').click()
            # Save & Next moved to another athlete
            # (next pending in name order is athlete-009 — the OTHER "Alex Morgan": names are not identifiers)
            expect(page.get_by_test_id('athlete-picker')).to_have_attribute('data-athlete-id', 'athlete-009')

            pick(page, 'athlete-003'); type_weight(page, '68.3')
            expect(page.get_by_test_id('category-delta')).to_have_text('+2.5 kg')
            expect(page.locator('.readout [data-status]')).to_have_text('RED')
            expect(page.get_by_test_id('daily-delta')).to_have_text('+0.3 kg')
            page.get_by_test_id('save').click()

            pick(page, 'athlete-008'); type_weight(page, '77.5')
            expect(page.get_by_test_id('daily-delta')).to_have_text('−2.5 kg')
            expect(page.locator('.delta-s', has_text='over 3 days')).to_be_visible()
            expect(page.locator('.readout [data-status]')).to_have_text('GREEN')
            page.get_by_test_id('save').click()

            pick(page, 'athlete-004'); type_weight(page, '19.5')
            expect(page.get_by_text('Below 20 kg')).to_be_visible()
            expect(page.get_by_test_id('save')).to_be_disabled()
            type_weight(page, '57.9')
            expect(page.get_by_test_id('daily-delta')).to_have_text('—')  # no previous record
            expect(page.locator('.readout [data-status]')).to_have_text('YELLOW')
            page.get_by_test_id('save').click()
            expect(page.get_by_test_id('progress')).to_have_text('4/10 weighed')
        s6()

        @step('Existing record is shown as EDITING and corrected without duplication')
        def s6b():
            pick(page, 'athlete-001')
            expect(page.get_by_test_id('mode')).to_contain_text('EDITING')
            expect(page.get_by_test_id('readout')).to_have_text('71.5')
            type_weight(page, '71.4'); page.get_by_test_id('save').click()
            expect(page.get_by_test_id('progress')).to_have_text('4/10 weighed')
            pick(page, 'athlete-001'); type_weight(page, '71.5'); page.get_by_test_id('save').click()
        s6b()

        @step('19 Mark unhealthy with a new reusable reason, then reuse it for another athlete')
        def s19():
            pick(page, 'athlete-002'); type_weight(page, '66')
            page.locator('.toggle', has_text='Healthy').click()
            page.get_by_test_id('reason-input').fill('Dehydration')
            page.get_by_test_id('reason-add').click()
            expect(page.get_by_test_id('reason-selected')).to_have_text('Dehydration')
            page.get_by_test_id('notes') if page.get_by_test_id('notes').count() else page.get_by_text('+ Add note').click()
            page.get_by_test_id('notes').fill('Felt dizzy in AM')
            page.screenshot(path=f'{SHOTS}/ipad-landscape-unhealthy.png')
            page.get_by_test_id('save').click()
            pick(page, 'athlete-005'); type_weight(page, '84.1')
            page.locator('.toggle', has_text='Healthy').click()
            page.get_by_test_id('reason-input').fill('dehyd')
            page.locator('.reason .chip', has_text='Dehydration').click()
            expect(page.get_by_test_id('reason-selected')).to_have_text('Dehydration')
            expect(page.get_by_test_id('reason-add')).to_have_count(0)
            page.get_by_test_id('save').click()
            expect(page.get_by_test_id('progress')).to_have_text('6/10 weighed')
        s19()

        @step('13-14 Team dashboard: statuses, counts, missing identified')
        def s13():
            page.get_by_test_id('tab-team').click()
            c = counts(page)
            # 001 +1.2 Y, 003 +2.5 R, 008 +0.4 G, 004 +1.2 Y, 002 +0.2 G, 005 +0.2 G ; 4 missing
            assert c == {'RED': 1, 'YELLOW': 2, 'GREEN': 3, 'MISSING': 4, 'UNHEALTHY': 2}, c
            expect(page.get_by_test_id('row-athlete-003').locator('[data-status]')).to_have_text('RED')
            expect(page.get_by_test_id('row-athlete-006').locator('[data-status]')).to_have_text('MISSING')
            expect(page.get_by_test_id('row-athlete-002')).to_contain_text('Dehydration')
            # status sort: RED first
            expect(page.get_by_test_id('team-table').locator('tbody tr').first).to_have_attribute('data-testid', 'row-athlete-003')
            page.get_by_test_id('count-MISSING').click()
            expect(page.get_by_test_id('team-table').locator('tbody tr')).to_have_count(4)
            page.get_by_test_id('count-MISSING').click()
            # selected-date view must not substitute other days
            page.get_by_test_id('team-date').fill(YDAY)
            c2 = counts(page)
            assert c2['MISSING'] == 8 and c2['RED'] + c2['YELLOW'] + c2['GREEN'] == 2, c2
            page.get_by_test_id('team-date').fill(TODAY.isoformat())
            page.screenshot(path=f'{SHOTS}/ipad-landscape-team.png', full_page=True)
        s13()

        @step('15-16 Change thresholds to 2-zone (+0.5) → statuses update immediately')
        def s15():
            page.get_by_test_id('tab-settings').click()
            page.get_by_test_id('t-red').fill('0.5')
            page.locator('.toggle', has_text='Yellow zone enabled').click()
            expect(page.get_by_test_id('rules-preview')).to_contain_text('Category delta greater than +0.5 kg')
            expect(page.get_by_test_id('rules-preview')).not_to_contain_text('YELLOW')
            page.get_by_test_id('t-apply').click()
            page.get_by_test_id('tab-team').click()
            c = counts(page)
            assert c == {'RED': 3, 'YELLOW': 0, 'GREEN': 3, 'MISSING': 4, 'UNHEALTHY': 2}, c
            expect(page.get_by_test_id('row-athlete-001').locator('[data-status]')).to_have_text('RED')
            expect(page.get_by_test_id('row-athlete-001')).to_contain_text('71.5')  # weight unchanged
        s15()

        @step('17-18 Athlete history + chart (offline), correction via Edit')
        def s17():
            page.get_by_test_id('row-athlete-001').click()
            expect(page.get_by_test_id('history-name')).to_have_text('Alex Morgan')
            expect(page.get_by_test_id('chart').locator('svg')).to_be_visible()
            expect(page.get_by_test_id('chart-point')).to_have_count(2)
            expect(page.get_by_test_id('limit-line')).to_have_count(1)
            page.get_by_test_id('chart-point').last.click()
            expect(page.get_by_test_id('chart-tooltip')).to_contain_text('71.5 kg')
            expect(page.get_by_test_id('history-table').locator('tbody tr')).to_have_count(2)
            page.screenshot(path=f'{SHOTS}/ipad-landscape-history.png', full_page=True)
            page.get_by_test_id(f'edit-{TODAY.isoformat()}').click()
            expect(page.get_by_test_id('mode')).to_contain_text('EDITING')
            type_weight(page, '71.2'); page.get_by_test_id('save').click()
            expect(page.get_by_test_id('history-name')).to_have_text('Alex Morgan')
            expect(page.get_by_test_id('history-table').locator('tbody tr').first).to_contain_text('71.2')
            expect(page.get_by_test_id('history-table').locator('tbody tr')).to_have_count(2)
        s17()

        @step('Reports (offline): one day / range, one athlete / group / all, health & notes on/off, CSV/HTML/PDF')
        def srep():
            page.get_by_test_id('tab-reports').click()
            page.get_by_test_id('rtype-weight').click()
            doc = page.get_by_test_id('report-doc')
            # one day, all athletes, everything shown
            expect(doc).to_contain_text('All athletes (10)')
            expect(doc).to_contain_text('Dehydration'); expect(doc).to_contain_text('Felt dizzy in AM')
            expect(doc).to_contain_text('no weigh-in')
            # hide health + notes + missing
            page.get_by_test_id('opt-showHealth').click(); page.get_by_test_id('opt-showNotes').click(); page.get_by_test_id('opt-showMissing').click()
            expect(doc).not_to_contain_text('Dehydration'); expect(doc).not_to_contain_text('Felt dizzy')
            expect(doc).not_to_contain_text('no weigh-in'); expect(doc).not_to_contain_text('confidential')
            for k in ['showHealth', 'showNotes', 'showMissing']: page.get_by_test_id(f'opt-{k}').click()
            # group: division
            page.get_by_test_id('scope-division').click(); page.get_by_test_id('r-division').select_option('Youth A')
            expect(doc).to_contain_text('Division: Youth A (1)')
            # range + single athlete, arranged by athlete, summary
            page.get_by_test_id('preset-7').click()
            page.get_by_test_id('scope-selected').click()
            page.get_by_test_id('sel-athlete-001').check()
            page.get_by_test_id('group-athlete').click()
            expect(doc).to_contain_text('Alex Morgan (1)')
            expect(doc).to_contain_text('Summary')
            expect(doc.locator('h2', has_text='Alex Morgan')).to_have_count(1)
            expect(doc).to_contain_text('7 days')
            page.screenshot(path=f'{SHOTS}/ipad-landscape-report.png', full_page=True)
            # several athletes
            page.get_by_test_id('sel-athlete-003').check()
            expect(doc).to_contain_text('2 selected athletes (2)')
            with page.expect_download() as dl:
                page.get_by_test_id('r-csv').click()
            p = os.path.join(OUT, 'report.csv'); dl.value.save_as(p)
            rows = open(p, encoding='utf-8-sig', newline='').read().strip().split('\r\n')
            assert rows[0].endswith('status,healthy,health_reason,notes'), rows[0]
            assert len(rows) == 1 + 14, len(rows)  # 2 athletes x 7 days incl. missing
            with page.expect_download() as dl:
                page.get_by_test_id('r-html').click()
            p = os.path.join(OUT, 'report.html'); dl.value.save_as(p)
            assert 'Alex Morgan' in open(p).read()
            page.emulate_media(media='print')
            page.pdf(path=os.path.join(SHOTS, 'report-print.pdf'), format='A4')
            page.emulate_media(media='screen')
            # deep link from athlete history
            page.goto(URL + '#/athlete/athlete-002'); page.get_by_test_id('athlete-report').click()
            expect(doc).to_contain_text('Daniel Smith')
            expect(doc).to_contain_text('Dehydration')
        srep()

        @step('Attendance report: date, title, Youth/Junior/Senior groups, absent toggle, WhatsApp text')
        def satt():
            page.get_by_test_id('tab-team').click()
            page.get_by_test_id('team-attendance').click()
            doc = page.get_by_test_id('att-doc')
            expect(doc).to_contain_text('ATTENDANCE')
            expect(doc).to_contain_text('List of athletes present at training')
            expect(doc).to_contain_text(TODAY.strftime('%-d %b %Y'))
            expect(doc).to_contain_text('Present: 6 of 10')
            expect(doc.locator('h2')).to_have_text(['Youth (1)', 'Junior (1)', 'Senior (4)'])
            expect(doc).not_to_contain_text('Lina Novak')
            page.get_by_test_id('att-absent').click()
            expect(doc).to_contain_text('Absent:'); expect(doc).to_contain_text('Lina Novak')
            page.get_by_test_id('att-absent').click()
            page.screenshot(path=f'{SHOTS}/ipad-landscape-attendance.png', full_page=True)
            ctx.grant_permissions(['clipboard-read', 'clipboard-write'], origin=URL.rstrip('/'))
            page.get_by_test_id('att-copy').click()
            txt = page.evaluate('navigator.clipboard.readText()')
            lines = txt.split('\n')
            assert lines[0].startswith('*Attendance* ' + TODAY.strftime('%d/%m/%y')), lines[0]
            assert '*Youth* (1)' in lines and '*Senior* (4)' in lines, txt
            assert '1. A / Daniel Smith / 65.8 kg ✅' in lines, txt
            # previous day: only 2 weighed (001, 003)
            page.get_by_test_id('att-date').fill(YDAY)
            expect(doc).to_contain_text('Present: 2 of 10')
            page.get_by_test_id('tab-reports').click()
            page.get_by_test_id('rtype-weight').click()
        satt()

        @step('CSV export works offline (dot decimals, ISO dates)')
        def scsv():
            page.get_by_test_id('tab-settings').click()
            with page.expect_download() as dl:
                page.get_by_test_id('export-csv').click()
            p = os.path.join(OUT, 'weighins.csv'); dl.value.save_as(p)
            txt = open(p, encoding='utf-8-sig', newline='').read().strip().split('\r\n')
            assert txt[0].startswith('camp_id,camp_name,date,athlete_id'), txt[0]
            assert len(txt) == 1 + 9, len(txt)
            row = [l for l in txt if f',{TODAY.isoformat()},athlete-001,' in l][0]
            assert f',{TODAY.isoformat()},athlete-001,Alex,Morgan,Senior,70.3,71.2,{YDAY},1,-0.8,0.9,RED,yes' in row, row
        scsv()

        @step('20-21 Close and reopen the app (offline, server still down) → records intact')
        def s20():
            nonlocal ctx, page
            ctx.close()
            ctx = launch(pw, prof_a, offline=True)
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            page.goto(URL + '#/team')
            expect(page.get_by_test_id('camp-title')).to_have_text('UAE National Team Camp')
            c = counts(page)
            assert c == {'RED': 3, 'YELLOW': 0, 'GREEN': 3, 'MISSING': 4, 'UNHEALTHY': 2}, c
            expect(page.get_by_test_id('row-athlete-001')).to_contain_text('71.2')
        s20()

        @step('22 Export complete backup (offline)')
        def s22():
            page.goto(URL + '#/settings')
            f = capture_download(page, 'export-backup')
            assert f['name'].startswith('awm-backup_') and f['name'].endswith('.json'), f['name']
            open(backup_path, 'w').write(f['text'])
            b = json.load(open(backup_path))
            assert b['format'] == 'athlete-weight-monitor-backup' and b['schemaVersion'] == 1
            assert len(b['athletes']) == 10 and len(b['weighIns']) == 9, (len(b['athletes']), len(b['weighIns']))
            assert b['camp']['thresholds'] == {'redAboveKg': 0.5, 'yellowFromKg': 1, 'yellowEnabled': False}, b['camp']['thresholds']
            assert any(r['label'] == 'Dehydration' and r['useCount'] == 2 for r in b['healthReasons'])
            assert any(w['notes'] == 'Felt dizzy in AM' for w in b['weighIns'])
        s22()

        @step('Malformed backup is rejected; nothing changes')
        def sbad():
            bad = json.load(open(backup_path)); bad['weighIns'][0]['athleteId'] = 'ghost'
            p = os.path.join(OUT, 'bad-backup.json'); json.dump(bad, open(p, 'w'))
            with page.expect_file_chooser() as fc:
                page.get_by_test_id('restore-backup').click()
            fc.value.set_files(p)
            expect(page.get_by_test_id('restore-errors')).to_contain_text('unknown athlete')
            page.get_by_role('button', name='OK').click()
            with page.expect_file_chooser() as fc:
                page.get_by_test_id('restore-backup').click()
            fc.value.set_files(os.path.join(ROOT, 'samples', 'sample-roster.json'))
            expect(page.get_by_test_id('restore-errors')).to_contain_text('roster file')
            page.get_by_role('button', name='OK').click()
        sbad()

        @step('Restore over existing data requires explicit confirmation')
        def sconf():
            with page.expect_file_chooser() as fc:
                page.get_by_test_id('restore-backup').click()
            fc.value.set_files(backup_path)
            expect(page.get_by_test_id('confirm-restore')).to_be_disabled()
            page.get_by_test_id('restore-ack').check()
            page.get_by_test_id('confirm-restore').click()
            expect(page.get_by_text('Backup restored')).to_be_visible()
        sconf()
        ctx.close()

        @step('23-24 Restore backup into a fresh install (offline) and verify it matches')
        def s23():
            start_server()
            ctx2 = launch(pw, prof_b)
            p2 = ctx2.pages[0] if ctx2.pages else ctx2.new_page()
            p2.goto(URL); wait_sw(p2)
            stop_server(); ctx2.set_offline(True); p2.reload()
            expect(p2.get_by_text('Create the training camp')).to_be_visible()
            with p2.expect_file_chooser() as fc:
                p2.get_by_test_id('setup-restore').click()
            fc.value.set_files(backup_path)
            expect(p2.get_by_test_id('camp-title')).to_have_text('UAE National Team Camp')
            p2.goto(URL + '#/team')
            c = counts(p2)
            assert c == {'RED': 3, 'YELLOW': 0, 'GREEN': 3, 'MISSING': 4, 'UNHEALTHY': 2}, c
            p2.goto(URL + '#/settings')
            with p2.expect_download() as dl:
                p2.get_by_test_id('export-backup').click()
            p = os.path.join(OUT, 'backup-restored.json'); dl.value.save_as(p)
            a = json.load(open(backup_path)); b = json.load(open(p))
            for k in ['exportedAt']: a.pop(k); b.pop(k)
            norm = lambda x: json.dumps({k: (sorted(v, key=lambda r: r.get('id', '')) if isinstance(v, list) else v) for k, v in x.items()}, sort_keys=True)
            assert norm(a) == norm(b), 'restored data differs from original'
            ctx2.close()
        s23()

        @step('Responsive layouts: iPhone & iPad mini, portrait & landscape — no horizontal overflow, large keypad')
        def sresp():
            ctx3 = launch(pw, prof_a, offline=True)
            p3 = ctx3.pages[0] if ctx3.pages else ctx3.new_page()
            for name, vp in [('iphone-portrait', (390, 844)), ('iphone-landscape', (844, 390)),
                             ('ipadmini-portrait', (744, 1133)), ('ipadmini-landscape', (1133, 744))]:
                p3.set_viewport_size({'width': vp[0], 'height': vp[1]})
                for route in ['weigh?athlete=athlete-006', 'team', 'athlete/athlete-001', 'reports', 'roster', 'settings']:
                    p3.goto(URL + '#/' + route); p3.wait_for_timeout(250)
                    no_hscroll(p3, f'{name} {route}')
                    if route.startswith('weigh'):
                        h = p3.get_by_test_id('key-5').bounding_box()
                        assert h['height'] >= 46 and h['width'] >= 60, (name, h)
                        sb = p3.get_by_test_id('save').bounding_box()
                        assert sb['height'] >= 60, (name, sb)
                        if name == 'iphone-portrait':
                            assert sb['y'] + sb['height'] <= vp[1], f'Save button below the fold on {name}: {sb}'
                    p3.screenshot(path=f"{SHOTS}/{name}-{route.split('?')[0].replace('/', '-')}.png")
                    if name == 'iphone-portrait' and route == 'weigh?athlete=athlete-006':
                        p3.get_by_test_id('athlete-picker').click()
                        p3.screenshot(path=f'{SHOTS}/{name}-athlete-sheet.png')
                        p3.locator('.sheet').get_by_test_id('pick-athlete-007').click()
                        expect(p3.get_by_test_id('current-athlete')).to_have_text('Yusuf Rahman')
            ctx3.close()
        sresp()

        assert not errors, f'page errors: {errors}'
    shutil.rmtree(prof_a, ignore_errors=True); shutil.rmtree(prof_b, ignore_errors=True)

if __name__ == '__main__':
    try:
        main()
    finally:
        if server: os.killpg(os.getpgid(server.pid), signal.SIGTERM)
        print('\n==== SUMMARY ====')
        for s, n in results: print(f'{s}  {n}')
        failed = [r for r in results if r[0] == 'FAIL']
        print(f"{len(results) - len(failed)} passed, {len(failed)} failed")
        sys.exit(1 if failed else 0)
