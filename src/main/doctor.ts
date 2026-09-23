// ── Environment self-check ("doctor") ──
//
// DeskApp's failure mode is the environment, not the code: which python, is the
// bundle there, does the engine have a key, is disk full, is a bridge wedged.
// Today that is diagnosed by trial-and-error through the setup wizard.
// Shape borrowed from google/ax's deleted `cmd/ax/doctor.go` (Stats + Sampler +
// Render) — see docs/ax/README.md P0 #5 and docs/ax/02-deleted-era.md §6.1.

import { existsSync, statSync, statfsSync, readFileSync, accessSync, constants } from 'fs'
import { join } from 'path'
import { execFileSync } from 'child_process'
import { app } from 'electron'
import { bridgeManager, desktopAgentExecutor, BRIDGE_MB_ESTIMATE } from './agents/desktop-agent'
import { hermesGatewayExecutor } from './agents/detect-hermes'
import { CLI_AGENTS, CliAgentExecutor } from './agents/cli-executor'
import { getWorkspaceDir, readWorkspaceProfile, workspaceRepoStatus } from './vfs'
import { lastSample, measureRssMB } from './mem-guard'
import type { DoctorCheck, DoctorReport } from '../shared/ipc-channels'

export type { DoctorCheck, DoctorReport }

const MB = (bytes: number): string => `${Math.round(bytes / 1024 / 1024)}MB`

function check(name: string, fn: () => { ok: boolean; detail: string; hint?: string }): DoctorCheck {
  try {
    return { name, ...fn() }
  } catch (e) {
    return { name, ok: false, detail: `check threw: ${(e as Error).message}` }
  }
}

/** Watch out: `ps -o rss=` is KB on macOS/Linux; %cpu is a lifetime average. */
function processRow(pid: number): { cpu: string; rss: string; uptime: string } | null {
  try {
    const out = execFileSync('ps', ['-p', String(pid), '-o', '%cpu=,rss=,etime='], { timeout: 2000 })
      .toString().trim().split(/\s+/)
    if (out.length < 3) return null
    const rssMB = Number(out[1]) / 1024
    return { cpu: out[0], rss: `${Math.round(rssMB)}MB`, uptime: out[2] }
  } catch { return null }
}

export function runDoctor(): DoctorReport {
  const resources = app.isPackaged
    ? join(process.resourcesPath, 'app.asar.unpacked', 'resources')
    : join(app.getAppPath(), 'resources')
  const userData = app.getPath('userData')
  const venvPython = join(userData, 'deskapp-agent-venv', 'bin', 'python3')

  const checks: DoctorCheck[] = []

  checks.push(check('engine bundle', () => {
    const bridge = join(resources, 'bridge.py')
    const agent = join(resources, 'hermes-agent', 'run_agent.py')
    const uv = join(resources, 'uv', 'uv')
    const missing = [bridge, agent, uv].filter((p) => !existsSync(p))
    return missing.length
      ? { ok: false, detail: `missing: ${missing.map((p) => p.replace(resources + '/', '')).join(', ')}`, hint: 'reinstall DeskApp (the agent bundle ships with the app)' }
      : { ok: true, detail: `bridge.py + hermes-agent + uv present` }
  }))

  checks.push(check('python for engine', () => {
    const live = bridgeManager.pythonPaths()
    // candidates: the app's own venv (built from the bundled agent) and the
    // user's hermes install — the engine picks whichever findPython() resolves.
    const candidates = [
      join(userData, 'deskapp-agent-venv', 'bin', 'python3'),
      join(process.env.HOME || '', '.hermes', 'hermes-agent', 'venv', 'bin', 'python3'),
    ]
    const python = live[0]?.python ?? candidates.find((p) => existsSync(p))
    if (!python) {
      return { ok: false, detail: 'no interpreter found (no live bridge, no hermes venv)', hint: 'restart the app — it builds a venv from the bundled agent on first run' }
    }
    let version = 'unknown'
    try {
      version = execFileSync(python, ['--version'], { timeout: 3000 }).toString().trim()
    } catch {
      return { ok: false, detail: `${python} exists but is not runnable`, hint: `delete ${join(userData, 'deskapp-agent-venv')} and restart (the app rebuilds it)` }
    }
    return { ok: true, detail: `${version} @ ${python}${live.length ? ' (live bridge)' : ' (idle — not spawned yet)'}` }
  }))

  checks.push(check('bridge processes', () => {
    const procs = bridgeManager.processStats()
    if (!procs.length) return { ok: true, detail: 'no live bridge (idle app, spare not warmed)' }
    let totalMB = 0
    const rows = procs.map((p) => {
      const s = p.pid ? processRow(p.pid) : null
      // Sum the measured RSS (same probe mem-guard charges against its soft
      // limit) and fall back to the constant only when a pid could not be read.
      const measured = p.pid ? measureRssMB(p.pid) : null
      totalMB += measured ?? BRIDGE_MB_ESTIMATE
      return `${p.key}: ${s ? `${s.rss} rss, ${s.cpu}% cpu, up ${s.uptime}` : 'pid unknown'}${p.busy ? ' [busy]' : ''}`
    })
    return { ok: true, detail: `${procs.length} live (~${Math.round(totalMB)}MB measured) — ${rows.join(' | ')}` }
  }))

  checks.push(check('workspace', () => {
    const dir = getWorkspaceDir()
    if (!dir || !existsSync(dir)) return { ok: false, detail: 'workspace dir missing', hint: 'restart the app to recreate it' }
    accessSync(dir, constants.W_OK)
    const st = statfsSync(dir)
    const freeMB = Math.round((st.bavail * st.bsize) / 1024 / 1024)
    // workspace profile (vfs.ts) — what this environment declares it is for
    const profile = readWorkspaceProfile()
    let note = ''
    if (profile) {
      const repos = workspaceRepoStatus(profile)
      const missing = repos.filter((r) => !r.present)
      note = `, profile=${profile.name ?? '(unnamed)'}${profile.goal ? ` "${profile.goal}"` : ''}` +
        (repos.length ? `, repos ${repos.length - missing.length}/${repos.length} present${missing.length ? ` (missing: ${missing.map((m) => m.dir).join(', ')})` : ''}` : '')
    } else {
      note = ', no profile (drop .deskapp/workspace.json to declare goal/repos)'
    }
    return freeMB < 512
      ? { ok: false, detail: `only ${freeMB}MB free at ${dir}`, hint: 'free disk space — a full disk wedges the agent mid-task' }
      : { ok: true, detail: `${dir} (${freeMB}MB free)${note}` }
  }))

  checks.push(check('model config', () => {
    // hermes owns the real model config: ~/.hermes/config.yaml (settings) +
    // ~/.hermes/.env (keys). A missing key surfaces mid-turn as [no_credentials].
    const cfgPath = join(process.env.HOME || '', '.hermes', 'config.yaml')
    if (!existsSync(cfgPath)) {
      return { ok: false, detail: 'no ~/.hermes/config.yaml', hint: 'run Settings → LLM setup (the engine reads the hermes config)' }
    }
    const cfg = readFileSync(cfgPath, 'utf-8')
    const provider = /^\s*provider:\s*(\S+)/m.exec(cfg)?.[1]
    const model = /^\s*default:\s*(\S+)/m.exec(cfg)?.[1]
    const envPath = join(process.env.HOME || '', '.hermes', '.env')
    const keyLine = existsSync(envPath)
      ? readFileSync(envPath, 'utf-8').split('\n').find((l) => /(_API_KEY|_TOKEN)=.{8,}/.test(l))
      : undefined
    const hasKey = !!keyLine
    const which = keyLine ? keyLine.split('=')[0] : undefined
    return {
      ok: !!provider && !!model && hasKey,
      detail: `${provider || '?'} / ${model || '?'} — api key ${hasKey ? `present (${which})` : 'NOT set'}`,
      hint: hasKey ? undefined : 'add the provider key in ~/.hermes/.env (engine turns fail with [no_credentials] otherwise)',
    }
  }))

  checks.push(check('agent runners', () => {
    // The runner contract in code (docs/runner-contract.md): what the app will
    // start, how it knows the runner is ready, which protocol it speaks.
    const runners: string[] = []
    const specs = [desktopAgentExecutor, hermesGatewayExecutor].map((e) => e.spec?.()).filter(Boolean)
    for (const s of specs) {
      runners.push(`${s!.id}: ${s!.launch.command} [ready=${s!.ready}${s!.protocol ? `, jsonl v${s!.protocol.version}` : ''}, ws=${s!.workspace}]`)
    }
    for (const id of Object.keys(CLI_AGENTS)) {
      const spec = new CliAgentExecutor(id).spec()
      let onPath = true
      try { execFileSync('which', [spec.launch.command], { timeout: 2000, stdio: 'ignore' }) } catch { onPath = false }
      runners.push(`${id}: ${spec.launch.command} [${onPath ? 'installed' : 'not on PATH'}]`)
    }
    const missing = runners.filter((r) => r.includes('not on PATH')).length
    return {
      ok: true,
      detail: `${runners.length} runners — ${runners.join(' | ')}`,
      hint: missing ? `${missing} CLI runner(s) not installed — install them or ignore` : undefined,
    }
  }))

  checks.push(check('memory guard', () => {
    const s = lastSample()
    if (!s) return { ok: true, detail: 'no sample yet (first tick within 60s)' }
    return {
      ok: s.totalMB < 1200,
      detail: `total ${s.totalMB}MB (electron ${s.electronMB}MB, bridges ${s.bridges}×~135MB)`,
      hint: s.totalMB < 1200 ? undefined : 'memory pressure: the guard reaps idle bridges automatically; close unused bubbles',
    }
  }))

  return { ts: Date.now(), ok: checks.every((c) => c.ok), checks }
}
