#!/usr/bin/env python3
"""
DeskApp Engine — embedded AI agent runtime (powered by hermes-agent core).

Protocol: JSON Lines over stdin/stdout
  - Ready on startup: {"type":"ready","providers":[...]}
  - Task input:     {"type":"task","message":"...", "session_id":"..."}
  - Abort:          {"type":"abort"}   → kills agent + resets state
  - Quit:           {"type":"quit"}    → clean exit

Output events:
  - text, reasoning — streaming deltas
  - reasoning_end — reasoning block closed (sent before the first text delta)
  - tool_start, tool_result — tool lifecycle
  - iteration_start — new API call iteration
  - token_usage — final token counts
  - done — turn complete (includes api_calls, elapsed_ms, session_id)
  - error — fatal error (carries `code`: invalid_config|no_credentials|provider_error|timeout|internal)

Every frame carries `v` (protocol version). Keep in sync with
src/main/agents/bridge-protocol.ts:PROTOCOL_VERSION.
"""

import sys, json, os, traceback, time, threading, queue
from pathlib import Path

# ── Protocol version ──
PROTOCOL_VERSION = 1

AGENT_SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'hermes-agent')
os.environ['PYTHONUNBUFFERED'] = '1'

# ── Module-level preload ──
sys.path.insert(0, AGENT_SRC)

def emit(d):
    """Write a JSON event line to stdout, flush immediately.

    Every frame carries the protocol version so a stale main process rejects
    (instead of half-reading) frames it does not understand — see
    src/main/agents/bridge-protocol.ts.
    """
    d.setdefault('v', PROTOCOL_VERSION)
    sys.stdout.write(json.dumps(d, ensure_ascii=False) + '\n')
    sys.stdout.flush()


def error_frame(message, code='internal'):
    """error frames carry a machine-readable code so the app can route:
    invalid_config -> deadletter, no_credentials -> setup, provider_error -> retry."""
    emit({'type': 'error', 'message': message, 'code': code})


def _close_reasoning():
    """Emit reasoning_end once, when the thinking block is over."""
    if _reasoning_state['open']:
        _reasoning_state['open'] = False
        emit({'type': 'reasoning_end'})


def _classify_error(exc):
    # ponytail: substring heuristic over provider SDK messages; upgrade to
    # typed exceptions if the agent ever exposes error classes.
    msg = str(exc).lower()
    if any(k in msg for k in ('api key', 'apikey', 'credential', 'unauthorized', '401', 'not configured')):
        return 'no_credentials'
    if any(k in msg for k in ('timeout', 'timed out', 'deadline')):
        return 'timeout'
    if any(k in msg for k in ('400', 'invalid', 'bad request', 'parse')):
        return 'invalid_config'
    if any(k in msg for k in ('connection', '503', '502', '500', 'rate limit', '429')):
        return 'provider_error'
    return 'internal'

# ── Config loading ──

def _find_config_path():
    hermes_home = os.environ.get('HERMES_HOME',
                                  os.path.join(os.path.expanduser('~'), '.hermes'))
    return os.path.join(hermes_home, 'config.yaml')

def load_config():
    """Load the full hermes config.yaml."""
    import yaml
    path = _find_config_path()
    if os.path.exists(path):
        with open(path, 'r') as f:
            return yaml.safe_load(f)
    return {}

def _get_model_config(cfg):
    """Extract model configuration from config.yaml.
    
    Supports both simple and providers-based config:
      model:
        default: deepseek-chat
        provider: deepseek
        api_key: sk-...
        base_url: https://api.deepseek.com
        
      providers:
        deepseek:
          api_key: sk-...
          base_url: https://api.deepseek.com
    """
    model_cfg = cfg.get('model', {})
    model = model_cfg.get('default', '')
    api_key = model_cfg.get('api_key', '')
    base_url = model_cfg.get('base_url', '')
    provider = model_cfg.get('provider', '')

    # If api_key not in model section, try providers.{provider}
    if not api_key and provider:
        providers_cfg = cfg.get('providers', {})
        pcfg = providers_cfg.get(provider, {})
        api_key = pcfg.get('api_key', api_key)
        base_url = pcfg.get('base_url', base_url)

    # Fallback: check env vars for common providers
    if not api_key:
        env_map = {
            'deepseek': 'DEEPSEEK_API_KEY',
            'openai': 'OPENAI_API_KEY',
            'anthropic': 'ANTHROPIC_API_KEY',
            'google': 'GOOGLE_API_KEY',
        }
        env_var = env_map.get(provider, '')
        if env_var:
            api_key = os.environ.get(env_var, '')

    if not model:
        raise RuntimeError('No model configured in config.yaml (model.default)')

    return {'model': model, 'api_key': api_key, 'base_url': base_url, 'provider': provider}

def _resolve_override_model_config(cfg, model, provider):
    """Resolve model config for a per-task override (worker tier routing).

    Resolution order mirrors _get_model_config: providers.{provider} in
    config.yaml, then env vars. Anything left empty is resolved by AIAgent
    itself (hermes provider presets + ~/.hermes/.env), so passing just the
    model name is usually enough.
    """
    mc = {'model': model, 'api_key': '', 'base_url': '', 'provider': provider}
    pcfg = cfg.get('providers', {}).get(provider, {})
    mc['api_key'] = pcfg.get('api_key', '')
    mc['base_url'] = pcfg.get('base_url', '')
    if not mc['api_key']:
        env_map = {
            'deepseek': 'DEEPSEEK_API_KEY',
            'openai': 'OPENAI_API_KEY',
            'anthropic': 'ANTHROPIC_API_KEY',
            'google': 'GOOGLE_API_KEY',
            'kimi': 'KIMI_API_KEY',
            'kimi-coding-cn': 'KIMI_CN_API_KEY',
            'moonshot': 'MOONSHOT_API_KEY',
        }
        env_var = env_map.get(provider, '')
        if env_var:
            mc['api_key'] = os.environ.get(env_var, '')
    if not mc['base_url'] and provider == 'deepseek':
        mc['base_url'] = os.environ.get('DEEPSEEK_BASE_URL', 'https://api.deepseek.com')
    return mc

def discover_providers(cfg):
    """Extract all configured providers for status display."""
    providers = []
    providers_cfg = cfg.get('providers', {})
    model_cfg = cfg.get('model', {})
    active_provider = model_cfg.get('provider', '')
    active_model = model_cfg.get('default', '')

    for name, pcfg in providers_cfg.items():
        has_key = bool(pcfg.get('api_key', ''))
        providers.append({
            'name': name,
            'has_key': has_key,
            'base_url': pcfg.get('base_url', ''),
        })

    return {
        'active_provider': active_provider,
        'active_model': active_model,
        'providers': providers,
    }

# ── Agent lifecycle ──

_agent = None
_conversation_history = None
_agent_instances = {}   # (model, base_url, provider) → AIAgent, cached across tier switches
_last_mc = {}           # model config used for the current/most recent turn

# Concurrency: background warmup thread vs stdin task loop
_agent_lock = threading.RLock()
_skip_warmup = threading.Event()  # set when a real task arrives → warmup API call is skipped
_warmup_active = threading.Event()  # suppresses event emission during the warmup API call
# reasoning-block boundary: on_reasoning opens it, the first text delta closes it
# (so the renderer never has to guess where thinking ends — see
# docs/ax/02-deleted-era.md §3.3). Reset per turn.
_reasoning_state = {'open': False}

# ── Turn state + first-output watchdog ──
#
# The main process used to believe a "bridge-side first-output cap (180s)" watched
# for hung providers — it did not exist. `run_conversation` has no timeout by
# design (CLI semantics: a turn may take as long as it needs), so a provider that
# accepted the request and then went quiet left the bubble on "thinking…" until
# the main-side 24h heartbeat. Two signals fix that, both emitted from here:
#
#   health  — a frame every HEALTH_MS while a turn is in flight, whether or not
#             the agent is producing output. This is what lets the main process
#             tell "long tool run, still alive" from "wedged".
#   error[timeout] — when a turn produced NOTHING (no text, no reasoning, no tool
#             frame) within FIRST_OUTPUT_TIMEOUT_S the failure is declared so the
#             UI unblocks; the turn keeps running in the background and its later
#             frames are ignored by a main process that already ended the turn.
#
# Both knobs are env-overridable so the paths can be exercised without waiting
# minutes (DESKAPP_FIRST_OUTPUT_WARN_S / DESKAPP_FIRST_OUTPUT_TIMEOUT_S).
def _env_float(name, default):
    try:
        v = float(os.environ.get(name, ''))
        return v if v > 0 else default
    except (TypeError, ValueError):
        return default

HEALTH_MS = 15_000
# Tick granularity — env-overridable so the watchdog can be exercised in seconds
# instead of waiting whole turns (DESKAPP_HEALTH_TICK_MS).
HEALTH_TICK_MS = _env_float('DESKAPP_HEALTH_TICK_MS', 5_000)
FIRST_OUTPUT_WARN_S = _env_float('DESKAPP_FIRST_OUTPUT_WARN_S', 120)
FIRST_OUTPUT_TIMEOUT_S = _env_float('DESKAPP_FIRST_OUTPUT_TIMEOUT_S', 300)

_turn = {'active': False, 'started_at': 0.0, 'output_seen': False,
         'tool_calls': 0, 'last_health': 0.0, 'warned': False, 'timed_out': False}
_turn_lock = threading.Lock()
_health_thread = None

def _turn_begin():
    with _turn_lock:
        _turn.update(active=True, started_at=time.time(), output_seen=False,
                     tool_calls=0, last_health=0.0, warned=False, timed_out=False)
    _start_health_watchdog()

def _turn_end():
    with _turn_lock:
        _turn['active'] = False

def _note_output(kind):
    """Any real agent output counts as 'the provider is alive'."""
    with _turn_lock:
        _turn['output_seen'] = True
        if kind == 'tool':
            _turn['tool_calls'] += 1

def _turn_watch_tick(now=None):
    """One watchdog iteration. Pure-ish (reads/writes _turn, returns the frame it
    wants emitted, or None) so the paths are testable without threads or waits.

    While a turn waits for its first output the frames say `waiting_first_token`
    and keep coming every HEALTH_MS — main treats "no frames at all" as the
    process being wedged, and the bridge's own timeout as the provider verdict,
    so those two failures stay distinguishable.
    """
    now = now if now is not None else time.time()
    with _turn_lock:
        if not _turn['active']:
            return None
        elapsed = now - _turn['started_at']
        waiting = not _turn['output_seen']
        if waiting and not _turn['timed_out'] and elapsed >= FIRST_OUTPUT_TIMEOUT_S:
            _turn['timed_out'] = True
            _turn['active'] = False
            return {'type': 'error', 'code': 'timeout',
                    'message': f'no output from the provider in {int(elapsed)}s'}
        if waiting and elapsed < FIRST_OUTPUT_WARN_S:
            return None
        if now - _turn['last_health'] >= HEALTH_MS / 1000:
            _turn['last_health'] = now
            frame = {'type': 'health',
                     'phase': 'waiting_first_token' if waiting else 'running',
                     'elapsed_ms': int(elapsed * 1000),
                     'tool_calls': _turn['tool_calls']}
            if waiting:
                frame['silent_s'] = int(elapsed)
                _turn['warned'] = True
            return frame
        return None

def _start_health_watchdog():
    """Daemon thread: ticks while the process lives (cheap, and a blocked agent
    thread cannot starve it — provider I/O releases the GIL)."""
    global _health_thread
    if _health_thread is not None:
        return
    def loop():
        while True:
            time.sleep(HEALTH_TICK_MS / 1000)
            try:
                frame = _turn_watch_tick()
                if frame:
                    emit(frame)
            except Exception as e:  # never let the watchdog die silently
                sys.stderr.write(f'[DeskApp Engine] health watchdog error: {e}\n')
    _health_thread = threading.Thread(target=loop, daemon=True, name='deskapp-health')
    _health_thread.start()
    sys.stderr.write(
        f'[DeskApp Engine] watchdog: tick {HEALTH_TICK_MS / 1000:.1f}s, health every {HEALTH_MS / 1000:.0f}s, '
        f'first-output warn {FIRST_OUTPUT_WARN_S:.0f}s, timeout {FIRST_OUTPUT_TIMEOUT_S:.0f}s\n')
    sys.stderr.flush()


def _get_or_create_agent(model_override=None):
    """Thread-safe wrapper — see _get_or_create_agent_impl."""
    with _agent_lock:
        return _get_or_create_agent_impl(model_override)

def _get_or_create_agent_impl(model_override=None):
    """Create or reuse an AIAgent for the effective model config.

    Agents are cached per (model, base_url, provider) so tier routing
    (simple → worker model, complex → planner model) can switch models
    per turn without re-import overhead. The conversation_history lives
    OUTSIDE the agent and is preserved across model switches — messages
    are plain OpenAI format, portable between models.
    """
    global _last_mc, _conversation_history

    cfg = load_config()
    if model_override and model_override.get('model'):
        mc = _resolve_override_model_config(
            cfg, model_override['model'], model_override.get('provider', ''))
    else:
        mc = _get_model_config(cfg)
    _last_mc = mc

    key = (mc['model'], mc.get('base_url', ''), mc.get('provider', ''))
    if key in _agent_instances:
        return _agent_instances[key]

    from run_agent import AIAgent

    kwargs = {'model': mc['model']}
    if mc['api_key']:
        kwargs['api_key'] = mc['api_key']
    if mc['base_url']:
        kwargs['base_url'] = mc['base_url']

    # Register tool lifecycle callbacks (signatures match hermes-agent tool_executor)
    def on_tool_start(tc_id, name, args):
        if _warmup_active.is_set(): return
        _note_output('tool')
        # a tool call interrupts thinking: close the block first, so the frontend
        # sees real thinking-block boundaries instead of guessing them.
        _close_reasoning()
        emit({'type': 'tool_start', 'name': str(name), 'args': str(args)[:500]})

    def on_tool_complete(tc_id, name, args, result):
        if _warmup_active.is_set(): return
        content = str(result) if result else ''
        emit({'type': 'tool_result', 'name': str(name),
              'content': content[:2000]})

    def on_reasoning(delta):
        if _warmup_active.is_set(): return
        _note_output('reasoning')
        _reasoning_state['open'] = True
        emit({'type': 'reasoning', 'content': delta})

    instance = AIAgent(
        tool_start_callback=on_tool_start,
        tool_complete_callback=on_tool_complete,
        reasoning_callback=on_reasoning,
        clarify_callback=_deskapp_clarify_callback,
        **kwargs,
    )
    _agent_instances[key] = instance

    sys.stderr.write(f'[DeskApp Engine] agent created: model={mc["model"]}, '
                     f'provider={mc.get("provider","")}\n')
    sys.stderr.flush()

    return instance

def _abort():
    """Kill all cached agent instances so next task gets a fresh one."""
    global _agent_instances, _conversation_history
    _deny_all_pending_approvals()  # release any tool threads blocked on approval
    _agent_instances = {}
    _conversation_history = []
    sys.stderr.write('[DeskApp Engine] agent aborted\n')
    sys.stderr.flush()

# ── Phase 6: execution-gate approvals (hermes set_approval_callback) ──
#
# hermes's tools/approval.py calls the registered callback BEFORE running a
# dangerous command, on the tool's worker thread. We emit a permission_required
# event to deskapp main and block on a per-approval queue until the user's
# decision arrives via stdin (permission_response), times out (120s → deny),
# or is denied by abort. _approval_lock serializes concurrent asks so only
# one approval card is ever in flight.

_pending_approvals = {}          # approval id -> queue.Queue(maxsize=1)
_approval_lock = threading.Lock()
_approval_seq = [0]
# cron automation runs (auto_approve=1): trust the scheduled task's tools —
# auto-allow instead of raising a card nobody watches.
_AUTO_APPROVE = [False]
# Dangerous commands REQUIRE user confirmation — wait indefinitely, never
# auto-reject. The approval card stays up until the user decides.
APPROVAL_TIMEOUT_S = 120  # ponytail: cron runs have nobody watching the bubble — auto-deny after 120s so the agent continues without the tool instead of hanging forever

def _register_approval_callback():
    """Thread-local registration — must run on every thread that may spawn
    hermes tool threads (task worker, warmup). thread_context propagates the
    callback from there into hermes's own worker threads."""
    _register_selfwake_tool()  # idempotent (override=True); keeps the wake tool available
    _register_genui_tool()     # idempotent (override=True); generative UI windows
    _register_scheduler_tool() # idempotent (override=True); schedule/meeting/project/task CRUD
    _register_screen_tool()    # idempotent (override=True); control other desktop apps (L1 bridge)
    try:
        from tools.terminal_tool import set_approval_callback
        set_approval_callback(_deskapp_approval_callback)
    except Exception as e:
        sys.stderr.write(f'[DeskApp Engine] approval callback registration failed: {e}\n')
        sys.stderr.flush()

def _deskapp_approval_callback(command, description, *, allow_permanent=True, smart_denied=False):
    """Blocks a hermes tool thread until deskapp decides. command/description
    arrive pre-redacted by hermes (agent.redact.redact_sensitive_text)."""
    if _AUTO_APPROVE[0]:
        # cron / automation runs trust the scheduled task's tools — but the call
        # still has to be RECORDED: with nobody watching the bubble there is no
        # card and the timeout path never fires, so without this frame an
        # unattended tool call would leave no trace anywhere. The main process
        # maps it to the audit log (desktop-agent parseLines 'auto_approved').
        emit({'type': 'auto_approved',
              'command': str(command)[:500],
              'description': str(description)[:300]})
        return 'once'
    with _approval_lock:
        _approval_seq[0] += 1
        aid = f'apr-{_approval_seq[0]}-{int(time.time() * 1000)}'
        q = queue.Queue(maxsize=1)
        _pending_approvals[aid] = q
        try:
            emit({'type': 'permission_required', 'id': aid,
                  'command': str(command)[:1000],
                  'description': str(description)[:500],
                  'allow_permanent': bool(allow_permanent),
                  'smart_denied': bool(smart_denied)})
            try:
                outcome = q.get(timeout=APPROVAL_TIMEOUT_S)
            except queue.Empty:
                emit({'type': 'permission_timeout', 'id': aid})
                return 'deny'
            return outcome if outcome in ('once', 'session', 'always', 'deny') else 'deny'
        finally:
            _pending_approvals.pop(aid, None)

def _deny_all_pending_approvals():
    for q in list(_pending_approvals.values()):
        try:
            q.put_nowait('deny')
        except Exception:
            pass

# ── P2-C2 #33: ask_user — hermes clarify tool wired to a deskapp question card ──
# Symmetric with approvals: emit question_required, block the tool thread on a
# per-question queue until question_response arrives via stdin (600s timeout).
_pending_questions = {}          # question id -> queue.Queue(maxsize=1)
_question_lock = threading.Lock()
_question_seq = [0]
QUESTION_TIMEOUT_S = 600

def _deskapp_clarify_callback(question, choices=None):
    with _question_lock:
        _question_seq[0] += 1
        qid = f'q-{_question_seq[0]}-{int(time.time() * 1000)}'
        q = queue.Queue(maxsize=1)
        _pending_questions[qid] = q
        try:
            emit({'type': 'question_required', 'id': qid,
                  'question': str(question)[:1000],
                  'choices': [str(c)[:200] for c in (choices or [])][:4]})
            try:
                answer = q.get(timeout=QUESTION_TIMEOUT_S)
            except queue.Empty:
                emit({'type': 'question_timeout', 'id': qid})
                return 'User did not answer in time; proceed with the most reasonable default and note the assumption.'
            return str(answer)[:2000]
        finally:
            _pending_questions.pop(qid, None)

# ── P1-B4 #21: selfwake — deskapp_wake tool registered into hermes's registry ──
def _register_selfwake_tool():
    try:
        from tools.registry import registry
        def _wake_handler(args, **kw):
            task = str(args.get('task', ''))[:2000]
            reason = str(args.get('reason', ''))[:500]
            if not task:
                return 'error: task is required'
            try:
                delay = float(args.get('delay_seconds'))
            except Exception:
                return 'error: delay_seconds (number) is required'
            wake_at = int(time.time() * 1000 + delay * 1000)
            emit({'type': 'selfwake_request', 'wake_at': wake_at, 'task': task, 'reason': reason})
            return json.dumps({'scheduled': True, 'wake_at': wake_at})
        registry.register(
            name='deskapp_wake',
            toolset='deskapp',
            schema={
                'name': 'deskapp_wake',
                'description': ('Schedule a one-shot self-wake: deskapp runs `task` as a background '
                                'agent task after `delay_seconds` and delivers the result to the user '
                                'inbox. Use for follow-ups, reminders, or deferred work.'),
                'parameters': {
                    'type': 'object',
                    'properties': {
                        'delay_seconds': {'type': 'number', 'description': 'Seconds from now until the wake fires'},
                        'task': {'type': 'string', 'description': 'The task for the future agent run'},
                        'reason': {'type': 'string', 'description': 'Why this wake is being scheduled'},
                    },
                    'required': ['delay_seconds', 'task'],
                },
            },
            handler=_wake_handler,
            check_fn=lambda: True,
            emoji='⏰',
            override=True,
        )
    except Exception as e:
        sys.stderr.write(f'[DeskApp Engine] selfwake tool registration failed: {e}\n')
        sys.stderr.flush()

# ── Generative UI: deskapp_genui tool → main creates/updates/runs spec windows ──
GENUI_KINDS = ('dashboard, feed, monitor, checklist, counter, clock, chart, alerts, text, links, image, iframe, '
               'presentation, brochure, manual, video, homepage')

def _register_genui_tool():
    try:
        from tools.registry import registry
        def _genui_handler(args, **kw):
            action = str(args.get('action', '')).strip()
            if action not in ('create', 'update', 'patch', 'run', 'stop', 'remove'):
                return "error: action must be one of create|update|patch|run|stop|remove"
            spec_id = str(args.get('spec_id', ''))[:100]
            spec = args.get('spec')
            ops = args.get('ops')
            if action in ('create', 'update'):
                if not isinstance(spec, dict):
                    return 'error: spec (object) is required for create/update'
                sid = str(spec.get('id', ''))[:100]
                if not sid:
                    return 'error: spec.id required'
                spec_id = sid
                # truncate oversized string fields
                spec['props'] = {k: (str(v)[:2000] if isinstance(v, str) else v)
                                 for k, v in (spec.get('props') or {}).items()}
            elif action == 'patch':
                if not spec_id:
                    return 'error: spec_id required for patch'
                if not isinstance(ops, list) or not ops:
                    return 'error: ops (non-empty array of {op,path,value}) required for patch'
            elif not spec_id:
                return 'error: spec_id required for run/stop/remove'
            emit({'type': 'genui_request', 'action': action, 'spec_id': spec_id,
                  'spec': spec if action in ('create', 'update') else None,
                  'ops': ops if action == 'patch' else None})
            return json.dumps({'queued': True, 'action': action, 'spec_id': spec_id})
        registry.register(
            name='deskapp_genui',
            toolset='deskapp',
            schema={
                'name': 'deskapp_genui',
                'description': (
                    'Materialize a live desktop window from a user instruction. '
                    'Use when the user asks to set up something ongoing (scheduled search, monitoring, '
                    'recurring checks, dashboards): create the config window immediately instead of just chatting. '
                    'spec format: {"id":"slug","title":"短标题","kind":"KIND","cron":{"schedule":"cron expr",'
                    '"prompt":"agent task template, {{propName}} placeholders filled from props"},'
                    '"props":{...}}. KIND one of: ' + GENUI_KINDS + '. '
                    'For scheduled web search use kind "feed" with props.topic/detail and optional '
                    'props.webhook (https WeCom/Feishu bot URL for remote push). '
                    'CONTENT-CREATION KINDS (办公创作 — user says 制作PPT/画册/宣传册/产品手册/宣传动画/展示页 from a folder): '
                    'use kind "presentation" (16:9 HTML 演示文稿), "brochure" (产品画册/宣传册), "manual" (产品手册 Word 文档), '
                    '"video" (宣传动画 MP4), "homepage" (展示主页/作品集). '
                    'props for these: source (素材文件夹路径), title (主题), style (风格预设, e.g. Cinematic Scroll Personal Brand / Business Personal Brand), '
                    'extra (结构要求, optional), output (成品保存路径, optional; default ~/Desktop/成品). '
                    'cron.prompt must be a template that fills {{source}}/{{title}}/{{style}}/{{extra}}/{{output}} '
                    'and instructs the agent to load the matching skill (personal-homepage-skill / docx / hyperframes) '
                    'and generate the artifact. The design window pops up automatically. '
                    'patch takes spec_id + ops (RFC 6902: [{"op":"replace","path":"/cron/schedule","value":"30 9 * * *"}]) '
                    'for small live edits to an open window; update sends the full replacement spec; '
                    'run/stop/remove take spec_id only. '
                    'When the user phrases a config edit (e.g. "周期改成每30分钟", "主题改为AI", "推送换到飞书"), map it to a '
                    'patch with ops: 周期→/cron/schedule, 主题→/props/topic, 推送→/props/webhook, 详情→/props/detail. '
                    'Prefer patch over create whenever the target window exists (spec_id given, or inferable from the '
                    'edit-target context / user says "改成/改为/把这个窗口").'),
                'parameters': {
                    'type': 'object',
                    'properties': {
                        'action': {'type': 'string', 'enum': ['create', 'update', 'patch', 'run', 'stop', 'remove']},
                        'spec': {'type': 'object', 'description': 'Full window spec (create/update)'},
                        'spec_id': {'type': 'string', 'description': 'Target spec id (patch/run/stop/remove)'},
                        'ops': {'type': 'array', 'description': 'RFC 6902 patch ops (patch)',
                                'items': {'type': 'object'}},
                    },
                    'required': ['action'],
                },
            },
            handler=_genui_handler,
            check_fn=lambda: True,
            emoji='🪟',
            override=True,
        )
    except Exception as e:
        sys.stderr.write(f'[DeskApp Engine] genui tool registration failed: {e}\n')
        sys.stderr.flush()

# ── Scheduler: deskapp_scheduler tool → main CRUDs events/tasks/projects + today briefing ──
def _register_scheduler_tool():
    try:
        from tools.registry import registry
        def _sched_handler(args, **kw):
            action = str(args.get('action', '')).strip()
            valid = ('create_event', 'update_event', 'delete_event', 'list_events',
                     'create_task', 'update_task', 'delete_task', 'create_project',
                     'today')
            if action not in valid:
                return "error: action must be one of " + '|'.join(valid)
            ev = args.get('event')
            task = args.get('task')
            proj = args.get('project')
            sid = str(args.get('id', ''))[:100]
            date = str(args.get('date', ''))[:10]
            if action.startswith('create_event') and not isinstance(ev, dict):
                return 'error: event (object with title/date/startHour/endHour) required'
            if action.startswith('create_task') and not isinstance(task, dict):
                return 'error: task (object with title) required'
            if action == 'create_project' and not isinstance(proj, dict):
                return 'error: project (object with name) required'
            if action in ('update_event', 'delete_event', 'update_task', 'delete_task') and not sid:
                return 'error: id required'
            emit({'type': 'scheduler_request', 'action': action, 'id': sid,
                  'event': ev, 'task': task, 'project': proj, 'date': date})
            return json.dumps({'queued': True, 'action': action, 'id': sid})
        registry.register(
            name='deskapp_scheduler',
            toolset='deskapp',
            schema={
                'name': 'deskapp_scheduler',
                'description': (
                    'Manage the user\'s schedule/meetings, project tasks, and projects '
                    '(DeskApp Scheduler window). Use when the user says 添加日程/会议/提醒, '
                    '记录任务/安排, 新建项目, or asks 今天有什么安排/日程/任务状态. '
                    'BOUNDARY: 用户说「打开日历/打开日程」时指 macOS 系统日历应用 —— 用 deskapp_screen 的 '
                    'open 动作（app="Calendar"），不要调用本工具；本工具的 today 动作会打开 DeskApp 的 '
                    'Scheduler 窗口，只在用户问「今天有什么安排」需要汇总问答时用. '
                    'Actions: '
                    'create_event {event:{title,date:"YYYY-MM-DD",startHour:9,endHour:10,room,priority:"高|中|低",attendees:[],status:"待开始|进行中|已结束"}}; '
                    'update_event/delete_event {id}; list_events {date}; '
                    'create_task {task:{projectId,title,phase:"需求评审|产品设计|开发实现|测试验证",status,priority,start:"YYYY-MM-DD",end,assignee,desc}}; '
                    'update_task/delete_task {id}; '
                    'create_project {project:{name,phase,deadline,desc}}; '
                    'today → 今日日程+进行中项目/任务+今日定时任务的汇总（早晨问答用它，然后把 Scheduler 窗口打开给用户看）.'),
                'parameters': {
                    'type': 'object',
                    'properties': {
                        'action': {'type': 'string', 'enum': ['create_event', 'update_event', 'delete_event', 'list_events', 'create_task', 'update_task', 'delete_task', 'create_project', 'today']},
                        'event': {'type': 'object'},
                        'task': {'type': 'object'},
                        'project': {'type': 'object'},
                        'id': {'type': 'string'},
                        'date': {'type': 'string'},
                    },
                    'required': ['action'],
                },
            },
            handler=_sched_handler,
            check_fn=lambda: True,
            emoji='📅',
            override=True,
        )
    except Exception as e:
        sys.stderr.write(f'[DeskApp Engine] scheduler tool registration failed: {e}\n')
        sys.stderr.flush()

# ── Screen Control (L1): deskapp_screen tool → 操控其他桌面应用（list/open/activate/quit/perm）──
# L2 屏幕驱动（capture/click/type/key/scroll/drag）由 hermes 内置 computer_use 工具承担。
def _register_screen_tool():
    try:
        from tools.registry import registry
        def _screen_handler(args, **kw):
            action = str(args.get('action', '')).strip()
            name = str(args.get('app', ''))[:120]
            if action not in ('list', 'open', 'activate', 'quit', 'perm'):
                return "error: action must be one of list|open|activate|quit|perm"
            if action in ('open', 'activate', 'quit') and not name:
                return 'error: app (name or path) required'
            emit({'type': 'screen_request', 'action': action, 'app': name})
            return json.dumps({'queued': True, 'action': action, 'app': name})
        registry.register(
            name='deskapp_screen',
            toolset='deskapp',
            schema={
                'name': 'deskapp_screen',
                'description': (
                    'Control other desktop apps (macOS, L1 bridge — no accessibility permission needed). '
                    'Use when the user asks to open/switch to/quit an app, or to check screen permissions. '
                    '「打开日历/备忘录/浏览器/微信」等系统应用请求用 open 动作（日历=Calendar），'
                    '不要路由到 DeskApp 自己的窗口（Scheduler/设置等是 DeskApp 功能，用 open 打不开系统应用时再考虑）. '
                    'For in-app UI interaction (click/type/scroll inside an app), use the built-in computer_use tool instead. '
                    'Actions: '
                    'list → running apps; '
                    'open {app:"Safari"} → launch an app (name or /path); '
                    'activate {app:"Safari"} → bring to front; '
                    'quit {app:"Safari"} → quit; '
                    'perm → check accessibility/screen-recording permission status.'),
                'parameters': {
                    'type': 'object',
                    'properties': {
                        'action': {'type': 'string', 'enum': ['list', 'open', 'activate', 'quit', 'perm']},
                        'app': {'type': 'string', 'description': 'App name (e.g. Safari, Notes) or absolute path'},
                    },
                    'required': ['action'],
                },
            },
            handler=_screen_handler,
            check_fn=lambda: True,
            emoji='🖥️',
            override=True,
        )
    except Exception as e:
        sys.stderr.write(f'[DeskApp Engine] screen tool registration failed: {e}\n')
        sys.stderr.flush()

# ── Task runner ──

def _est_tokens(text):
    """Rough token estimate: CJK chars ~1 token each, others ~4 chars/token."""
    cjk = sum(1 for c in text if ord(c) > 0x2E7F)
    return cjk + (len(text) - cjk) // 4

def _estimate_context_tokens(history):
    try:
        total = 0
        for m in (history or []):
            c = m.get('content')
            if isinstance(c, str):
                total += _est_tokens(c)
            elif isinstance(c, list):
                total += sum(_est_tokens(str(p.get('text', ''))) for p in c if isinstance(p, dict))
        return total
    except Exception:
        return 0

# ponytail: fixed token budget for the per-turn history re-send — the provider
# re-processes the WHOLE history each turn, so TTFT grows unboundedly with it
# (42s → 140s → >180s observed). hermes-side compression would be smarter;
# this cap keeps the first token ~20-30s.
MAX_HISTORY_TOKENS = 30000

def _trim_history(history):
    if not history:
        return None
    if _estimate_context_tokens(history) <= MAX_HISTORY_TOKENS:
        return history
    kept, used = [], 0
    for m in reversed(history):
        c = m.get('content') if isinstance(m, dict) else str(m)
        t = _est_tokens(str(c))
        if used + t > MAX_HISTORY_TOKENS and kept:
            break
        kept.insert(0, m)
        used += t
    return kept

def run_task(message, session_id, model_override=None):
    # Real task arrived: cancel any pending warmup API call, then serialize
    # against the background warmup thread (waits if warmup is mid-flight).
    _skip_warmup.set()
    with _agent_lock:
        return _run_task_impl(message, session_id, model_override)

def _run_task_impl(message, session_id, model_override=None):
    try:
        agent = _get_or_create_agent(model_override)
        global _conversation_history
        streamed = [False]
        chunk_count = [0]
        turn_start = time.time()
        _turn_begin()
        _reasoning_state['open'] = False

        def on_text(delta):
            streamed[0] = True
            _note_output('text')
            _close_reasoning()   # thinking is over once real text starts
            chunk_count[0] += 1
            if chunk_count[0] == 1:
                sys.stderr.write(f'[DeskApp Engine] first token at {int((time.time() - turn_start) * 1000)}ms after turn start\n')
                sys.stderr.flush()
            emit({'type': 'text', 'content': delta})

        # Run with accumulated conversation history. No wall-clock kill —
        # CLI semantics: wait as long as the turn needs; the user aborts with ■.
        result = agent.run_conversation(
            message,
            conversation_history=_trim_history(_conversation_history),
            stream_callback=on_text,
        )

        elapsed_ms = int((time.time() - turn_start) * 1000)

        # Update conversation history for next turn
        _conversation_history = result.get('messages', _conversation_history or [])

        # Fallback: if streaming callback didn't fire, use final_response
        if not streamed[0] and result:
            final = result.get('final_response', '')
            if final:
                _close_reasoning()
                emit({'type': 'text', 'content': final})
        _close_reasoning()  # reasoning without any text (e.g. tool-only turn)

        # NOTE: reasoning/tool events already emitted in real-time via
        # reasoning_callback / tool_start_callback / tool_complete_callback.
        # Do NOT re-emit from messages here (causes duplicates).
        api_calls = result.get('api_calls', 0) if result else 0

        # Token usage: cumulative session counters live on the AGENT object
        # (result dict has no 'usage' key — result.get('usage') was always {}).
        _r_usage = (result or {}).get('usage') or {}
        usage = {
            'prompt_tokens': getattr(agent, 'session_prompt_tokens', 0) or _r_usage.get('prompt_tokens', 0),
            'completion_tokens': getattr(agent, 'session_completion_tokens', 0) or _r_usage.get('completion_tokens', 0),
            'total_tokens': getattr(agent, 'session_total_tokens', 0) or _r_usage.get('total_tokens', 0),
            'cache_read_input_tokens': getattr(agent, 'session_cache_read_tokens', 0),
            'cache_creation_input_tokens': getattr(agent, 'session_cache_write_tokens', 0),
            'reasoning_tokens': getattr(agent, 'session_reasoning_tokens', 0),
        }
        token_event = {
            'type': 'token_usage',
            'prompt_tokens': usage.get('prompt_tokens', 0),
            'completion_tokens': usage.get('completion_tokens', 0),
            'total_tokens': usage.get('total_tokens', 0),
            'cache_read_tokens': usage.get('cache_read_input_tokens', 0),
            'cache_write_tokens': usage.get('cache_creation_input_tokens', 0),
            'reasoning_tokens': usage.get('reasoning_tokens', 0),
            # Estimated CURRENT context occupancy (CJK-aware rough count over
            # the conversation the next API call will re-send).
            'context_tokens': _estimate_context_tokens(_conversation_history),
        }

        # Emit the token_usage event (documented protocol) — it previously
        # only rode inside done.usage, so renderers never saw it.
        emit(token_event)

        emit({
            'type': 'done',
            'session_id': session_id,
            'elapsed_ms': elapsed_ms,
            'chunks': chunk_count[0],
            'api_calls': api_calls,
            'usage': token_event,
            'model': _last_mc.get('model', ''),
            'provider': _last_mc.get('provider', ''),
            'completed': result.get('completed', True),
            'error': result.get('error', ''),
        })

        sys.stderr.write(
            f'[DeskApp Engine] done: model={_last_mc.get("model","")}, '
            f'streamed={streamed[0]}, '
            f'chunks={chunk_count[0]}, api_calls={api_calls}, '
            f'elapsed={elapsed_ms}ms\n')
        sys.stderr.flush()

    except Exception as e:
        sys.stderr.write(f'[DeskApp Engine] ERROR: {traceback.format_exc()}\n')
        sys.stderr.flush()
        _close_reasoning()
        error_frame(str(e), _classify_error(e))
    finally:
        # Watchdog stops with the turn; a timed-out turn already cleared `active`.
        _turn_end()

# ── Main loop ──

# Emit ready with provider info
cfg = load_config()
providers_info = discover_providers(cfg)
emit({'type': 'ready', **providers_info})

# Eager warmup in a BACKGROUND thread so the stdin loop starts immediately:
#  1. agent pre-creation (module imports + system prompt + tools + memory, ~8s)
#  2. a minimal API call to prime the provider's prefix cache (~2-3s) so the
#     user's first real question gets a fast TTFT (~1s instead of 3-4s)
# A real task arriving mid-warmup sets _skip_warmup: step 2 is skipped and
# run_task() waits on _agent_lock only for the remainder of step 1.
# ponytail: one-shot at spawn ONLY — a keep-alive loop that holds _agent_lock
# during a provider call can deadlock the whole queue when the provider hangs
# (no timeout) → every later task stuck "queued" forever.
def _background_warmup():
    try:
        _register_approval_callback()  # warmup runs run_conversation on this thread
        with _agent_lock:
            agent = _get_or_create_agent_impl()
            sys.stderr.write('[DeskApp Engine] agent pre-created, ready for tasks\n')
            sys.stderr.flush()
            # ponytail: the warmup CALL is dropped — it held the lock for the
            # cold first call (30-40s) and blocked the first real task; with
            # deepseek-v4-flash the TTFT is ~2-3s even cold, so the prime call
            # buys nothing. Agent pre-creation alone pre-warms imports/config.
    except Exception as e:
        sys.stderr.write(f'[DeskApp Engine] warmup failed (non-fatal, will retry on task): {e}\n')
        sys.stderr.flush()

threading.Thread(target=_background_warmup, daemon=True).start()

# ── Phase 6: stdin dispatch architecture ──
#
# The reader loop below used to run tasks inline, which meant any stdin
# message (abort, permission_response) arriving mid-task was not read until
# the task finished. Now a dedicated task queue + worker thread keeps task
# execution serial (unchanged behavior), while the reader thread dispatches
# time-sensitive control messages immediately.

_task_queue = queue.Queue()

def _handle_context_inject(req):
    # Context injection: append a (user, assistant) pair to the live
    # conversation WITHOUT running the model. Used to sync tasks that
    # were executed OUTSIDE the bridge (task-tree orchestration) into
    # the bridge's history, so follow-up turns ("开始实施") see them.
    global _conversation_history
    _u = req.get('user', '')
    _a = req.get('assistant', '')
    if _u and _a:
        if _conversation_history is None:
            _conversation_history = []
        _conversation_history.append({'role': 'user', 'content': _u})
        _conversation_history.append({'role': 'assistant', 'content': _a})
        sys.stderr.write(f'[DeskApp Engine] context injected: {len(_conversation_history)} messages\n')
        sys.stderr.flush()

def _task_worker():
    _register_approval_callback()  # run_conversation runs on THIS thread
    while True:
        item = _task_queue.get()
        if item is None:
            return
        req_type, req = item
        try:
            if req_type == 'task':
                _AUTO_APPROVE[0] = req.get('auto_approve') == '1'
                override = None
                if req.get('model'):
                    override = {'model': req['model'], 'provider': req.get('provider', '')}
                run_task(
                    req.get('message', ''),
                    req.get('session_id', ''),
                    override,
                )
            elif req_type == 'context':
                _handle_context_inject(req)
        except Exception:
            traceback.print_exc()

threading.Thread(target=_task_worker, daemon=True).start()

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        req = json.loads(line)
    except json.JSONDecodeError:
        continue

    req_type = req.get('type', '')
    if req_type == 'task':
        # D2 #49: stdin hardening — cap prompt at 200K chars (aligned with
        # coworker server limit); truncate loudly, never crash the loop.
        prompt = req.get('prompt', '')
        if isinstance(prompt, str) and len(prompt) > 200_000:
            req['prompt'] = prompt[:200_000]
            sys.stderr.write('[DeskApp Engine] warning: task prompt truncated to 200K chars\n')
            sys.stderr.flush()
        _task_queue.put(('task', req))
    elif req_type == 'abort':
        _deny_all_pending_approvals()  # unblock approval-waiting tool threads
        _abort()
    elif req_type == 'context':
        _task_queue.put(('context', req))
    elif req_type == 'permission_response':
        # Phase 6: user's decision for a pending approval card
        # D2 #49: validate id shape before touching pending queues — a forged
        # response must not be able to perturb the wait map.
        aid = str(req.get('id', ''))[:64]
        if not aid.startswith('apr-'):
            continue
        q = _pending_approvals.get(aid)
        if q:
            try:
                q.put_nowait(req.get('outcome', 'deny'))
            except Exception:
                pass
    elif req_type == 'question_response':
        # #33: user's answer for a pending question card
        qid = str(req.get('id', ''))[:64]
        if not qid.startswith('q-'):
            continue
        q = _pending_questions.get(qid)
        if q:
            try:
                q.put_nowait(req.get('answer', ''))
            except Exception:
                pass
    elif req_type == 'quit':
        break
