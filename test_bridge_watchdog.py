#!/usr/bin/env python3
"""bridge.py first-output watchdog self-test — no API key, no waiting.

Covers the safety net that did NOT exist before: a provider that accepts the
request and then goes quiet used to leave the bubble on "thinking…" until the
main-side 24h heartbeat. Now:

1. a turn with no output past FIRST_OUTPUT_WARN_S emits a `health` frame once
2. past FIRST_OUTPUT_TIMEOUT_S it emits `error{code:'timeout'}` and stops watching
3. a turn that produced output only gets steady `health` frames (never a timeout)
4. `_note_output` (text / reasoning / tool) cancels the first-output path
"""
import sys, os, io, json, time

REPO = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(REPO, 'resources', 'hermes-agent'))

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
sys.stdin = io.StringIO('')
sys.stdout = FakeStdout()
g: dict = {'__name__': '__bridge_test__', '__file__': os.path.join(REPO, 'resources', 'bridge.py')}
try:
    exec(compile(src, 'bridge.py', 'exec'), g)
finally:
    sys.stdin = real_stdin

def out(s):
    real_stdout.write(s + '\n')
    real_stdout.flush()

fails = []
def check(name, cond):
    out(('PASS' if cond else 'FAIL') + ' ' + name)
    if not cond: fails.append(name)

# deterministic clock: drive _turn_watch_tick(now=...) directly, no threads
# HEALTH_MS stays at its real unit (milliseconds) — the throttle is HEALTH_MS/1000 s
g['FIRST_OUTPUT_WARN_S'], g['FIRST_OUTPUT_TIMEOUT_S'], g['HEALTH_MS'] = 10, 30, 15_000
tick = g['_turn_watch_tick']
t0 = 1_000_000.0

def fresh(started_at, output_seen=False):
    g['_turn'].update(active=True, started_at=started_at, output_seen=output_seen,
                      tool_calls=0, last_health=0.0, warned=False, timed_out=False)

# ── 1. waiting for the first token: warn, then keep reporting, then time out ──
fresh(t0)
check('1a nothing before the warn threshold', tick(t0 + 5) is None)
warn = tick(t0 + 11)
check('1b health frame at the warn threshold', warn and warn['type'] == 'health' and warn['phase'] == 'waiting_first_token')
check('1c silent_s carried', warn and warn['silent_s'] == 11)
check('1d throttled by HEALTH_MS (no frame 1s later)', tick(t0 + 12) is None)
again = tick(t0 + 27)
check('1e still reporting while it waits', again and again['phase'] == 'waiting_first_token' and again['silent_s'] == 27)

# ── 2. timeout declares the failure and stops the turn ──
to = tick(t0 + 31)
check('2a error[timeout] emitted', to and to['type'] == 'error' and to['code'] == 'timeout')
check('2b message names the silence', to and 'no output from the provider' in to['message'])
check('2c turn deactivated', g['_turn']['active'] is False)
check('2d no further frames after the timeout', tick(t0 + 60) is None)

# ── 3. a productive turn gets heartbeats, never a timeout ──
fresh(t0, output_seen=True)
h1 = tick(t0 + 20)
check('3a health while running', h1 and h1['type'] == 'health' and h1['phase'] == 'running')
check('3b throttled by HEALTH_MS', tick(t0 + 21) is None)
check('3c next heartbeat after the interval', (tick(t0 + 36) or {}).get('type') == 'health')
check('3d long productive turn never times out',
      all((tick(t0 + 36 + 15 * i) or {}).get('type') == 'health' for i in range(1, 6))
      and g['_turn']['timed_out'] is False)

# ── 4. activity cancels the first-output path ──
fresh(t0)
g['_note_output']('reasoning')
check('4a reasoning counts as output', g['_turn']['output_seen'] is True)
check('4b no timeout after activity', (tick(t0 + 999) or {}).get('type') == 'health')

fresh(t0)
g['_note_output']('tool')
check('4c tool frames counted', g['_turn']['tool_calls'] == 1)
check('4d tool activity also clears the first-output path',
      (tick(t0 + 999) or {}).get('phase') == 'running')

# ── 5. idle process emits nothing ──
g['_turn']['active'] = False
check('5a inactive turn stays quiet', tick(t0 + 5000) is None)
check('5b watchdog thread is a daemon (never blocks exit)',
      g['_health_thread'] is None or g['_health_thread'].daemon is True)

out('')
out('RESULT: ' + ('ALL PASS' if not fails else f'{len(fails)} FAILED: {fails}'))
sys.exit(0 if not fails else 1)
