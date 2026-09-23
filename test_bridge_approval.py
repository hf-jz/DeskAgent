#!/usr/bin/env python3
"""Phase 6 Step 1 bridge.py self-test — no API key needed.

Verifies:
1. Approval callback emits permission_required and round-trips an outcome.
2. Timeout path (shortened) returns 'deny' and emits permission_timeout.
3. _deny_all_pending_approvals unblocks a waiting callback with 'deny'.
4. Serial dispatch: abort/permission_response handled while a task is queued.
5. Unattended (cron) mode: auto-allow still emits an 'auto_approved' frame —
   otherwise an auto-approved tool call leaves no trace anywhere (no card, and
   the timeout path never fires).
"""
import sys, os, io, json, threading, time

REPO = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(REPO, 'resources', 'hermes-agent'))

# Load bridge.py with stdin at EOF so the module-level dispatch loop exits
# immediately after definition; capture its stdout emissions.
src = open(os.path.join(REPO, 'resources', 'bridge.py')).read()
emitted = []

class FakeStdout:
    def write(self, s):
        s = s.strip()
        if s:
            try:
                emitted.append(json.loads(s))
            except json.JSONDecodeError:
                pass
    def flush(self): pass

real_stdin, real_stdout = sys.stdin, sys.stdout
fake_out = FakeStdout()
sys.stdin = io.StringIO('')
sys.stdout = fake_out
g: dict = {'__name__': '__bridge_test__', '__file__': os.path.join(REPO, 'resources', 'bridge.py')}
try:
    exec(compile(src, 'bridge.py', 'exec'), g)
finally:
    sys.stdin = real_stdin
    # NOTE: sys.stdout stays fake — callback threads emit AFTER module load.
    # Test output goes through real_stdout directly.

def out(s):
    real_stdout.write(s + '\n')
    real_stdout.flush()

fails = []
def check(name, cond):
    out(('PASS' if cond else 'FAIL') + ' ' + name)
    if not cond: fails.append(name)

# ── 1. round-trip ──
emitted.clear()
result_box = {}
def run_cb():
    result_box['r'] = g['_deskapp_approval_callback']('rm -rf /tmp/x', 'delete dir')
t = threading.Thread(target=run_cb)
t.start()
time.sleep(0.5)
req = [e for e in emitted if e.get('type') == 'permission_required']
check('1a permission_required emitted', len(req) == 1)
if req:
    check('1b command/description carried', req[0]['command'] == 'rm -rf /tmp/x' and req[0]['description'] == 'delete dir')
    check('1c allow_permanent default true', req[0].get('allow_permanent') is True)
    aid = req[0]['id']
    g['_pending_approvals'][aid].put('once')
    t.join(timeout=5)
    check('1d callback returns once', result_box.get('r') == 'once')
    check('1e pending cleaned up', aid not in g['_pending_approvals'])

# ── 2. timeout → deny + permission_timeout ──
g['APPROVAL_TIMEOUT_S'] = 1  # shorten for test
emitted.clear()
result_box.clear()
t = threading.Thread(target=lambda: result_box.update(r=g['_deskapp_approval_callback']('mkfs /dev/x', 'format')))
t.start()
t.join(timeout=10)
check('2a timeout returns deny', result_box.get('r') == 'deny')
check('2b permission_timeout emitted', any(e.get('type') == 'permission_timeout' for e in emitted))

# ── 3. deny-all releases blocked callback ──
emitted.clear()
result_box.clear()
g['APPROVAL_TIMEOUT_S'] = 30  # long; deny-all must preempt it
t = threading.Thread(target=lambda: result_box.update(r=g['_deskapp_approval_callback']('dd if=/dev/zero', 'wipe')))
t.start()
time.sleep(0.5)
g['_deny_all_pending_approvals']()
t.join(timeout=5)
check('3a deny-all returns deny promptly', result_box.get('r') == 'deny' and not t.is_alive())

# ── 4. invalid outcome coerced to deny ──
g['APPROVAL_TIMEOUT_S'] = 5
emitted.clear()
result_box.clear()
t = threading.Thread(target=lambda: result_box.update(r=g['_deskapp_approval_callback']('x', 'y')))
t.start()
time.sleep(0.3)
aid = [e for e in emitted if e.get('type') == 'permission_required'][0]['id']
g['_pending_approvals'][aid].put('garbage')
t.join(timeout=5)
check('4a invalid outcome → deny', result_box.get('r') == 'deny')

# ── 5. unattended (cron) mode: auto-allow, but recorded ──
emitted.clear()
result_box.clear()
g['_AUTO_APPROVE'][0] = True
result_box['r'] = g['_deskapp_approval_callback']('curl https://example.com/x', 'fetch a page')
g['_AUTO_APPROVE'][0] = False
check('5a auto-approve returns once', result_box.get('r') == 'once')
auto = [e for e in emitted if e.get('type') == 'auto_approved']
check('5b auto_approved emitted for the audit trail', len(auto) == 1)
if auto:
    check('5c command/description carried', auto[0]['command'] == 'curl https://example.com/x' and auto[0]['description'] == 'fetch a page')
check('5d no approval card was raised', not any(e.get('type') == 'permission_required' for e in emitted))

print()
out('RESULT: ' + ('ALL PASS' if not fails else f'{len(fails)} FAILED: {fails}'))
sys.exit(0 if not fails else 1)
