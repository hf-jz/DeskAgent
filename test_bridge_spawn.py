#!/usr/bin/env python3
"""Phase 6 Step 5: bridge.py spawn smoke test (protocol level, no API key needed).

Spawns the REAL resources/bridge.py with the production venv python and drives
its stdin protocol:
  1. permission_response with unknown id → silently ignored, no crash
  2. abort → stderr 'agent aborted', bridge stays alive
  3. context → accepted (queued or injected)
  4. quit → clean exit 0 within timeout

Warmup may fail without API keys — that path is non-fatal by design and must
not kill the stdin dispatch loop.
"""
import subprocess, json, os, sys, time

REPO = os.path.dirname(os.path.abspath(__file__))
VENV_PY = os.path.expanduser('~/.hermes/hermes-agent/venv/bin/python3')

def main() -> int:
    p = subprocess.Popen(
        [VENV_PY, os.path.join(REPO, 'resources', 'bridge.py')],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, cwd=REPO,
    )
    def send(d):
        p.stdin.write(json.dumps(d) + '\n')
        p.stdin.flush()

    time.sleep(2)  # let the module load + dispatch thread start

    send({'type': 'permission_response', 'id': 'apr-nonexistent', 'outcome': 'once'})
    time.sleep(0.3)
    assert p.poll() is None, 'bridge died on unknown permission_response'

    send({'type': 'abort'})
    time.sleep(0.5)
    assert p.poll() is None, 'bridge died on abort'

    send({'type': 'context', 'user': 'hello', 'assistant': 'world'})
    time.sleep(0.3)
    assert p.poll() is None, 'bridge died on context'

    send({'type': 'quit'})
    try:
        out, err = p.communicate(timeout=30)
    except subprocess.TimeoutExpired:
        p.kill()
        p.communicate()
        print('FAIL: bridge did not exit on quit within 30s')
        return 1

    types = []
    for line in out.strip().split('\n'):
        line = line.strip()
        if not line:
            continue
        try:
            types.append(json.loads(line)['type'])
        except Exception:
            types.append('<non-json>')

    aborted = any('aborted' in l for l in err.split('\n'))
    traceback = any('Traceback' in l for l in err.split('\n'))

    print(f'exit={p.returncode} stdout_events={types}')
    print(f'abort_logged={aborted} traceback={traceback}')

    ok = (p.returncode == 0 and aborted and not traceback)
    print('RESULT:', 'PASS' if ok else 'FAIL')
    return 0 if ok else 1

if __name__ == '__main__':
    sys.exit(main())
