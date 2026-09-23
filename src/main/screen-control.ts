/**
 * Screen Control — L1 原生桥（无 accessibility 权限也能用）+ 权限检测。
 * L2 屏幕驱动（capture/click/type/key/scroll/drag）由 hermes-agent 内置的
 * computer_use 工具（cua-driver）承担，agent 可直接调用，此处不重复实现。
 */
import { systemPreferences, shell } from 'electron'
import { execFile } from 'child_process'

export type PermStatus = { accessibility: boolean; screen: string }

export function permStatus(): PermStatus {
  return {
    accessibility: systemPreferences.isTrustedAccessibilityClient(false),
    screen: systemPreferences.getMediaAccessStatus('screen'), // granted|denied|restricted|not-determined
  }
}

export function openSystemPrefs(kind: 'accessibility' | 'screen'): void {
  const url = kind === 'accessibility'
    ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
    : 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
  void shell.openExternal(url)
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 8000 }, (err, stdout) => {
      resolve(err ? '' : String(stdout).trim())
    })
  })
}

export async function listApps(): Promise<Array<{ name: string; pid: number }>> {
  // System Events 需要辅助功能权限；未授权时返回空列表
  const out = await run('osascript', [
    '-e',
    'tell application "System Events" to get {name, unix id} of every application process whose background only is false',
  ])
  if (!out) return []
  // osascript 返回: "Safari, 1234, Finder, 5678"（交替 name,pid）
  const parts = out.split(', ').map(s => s.trim())
  const apps: Array<{ name: string; pid: number }> = []
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const pid = Number(parts[i + 1])
    if (Number.isFinite(pid)) apps.push({ name: parts[i], pid })
  }
  return apps
}

export async function openApp(nameOrPath: string): Promise<{ ok: boolean; message?: string }> {
  if (!nameOrPath.trim()) return { ok: false, message: 'app name required' }
  const err = await run('open', ['-a', nameOrPath])
  if (err) return { ok: false, message: `open failed: ${err}` }
  return { ok: true }
}

export async function activateApp(name: string): Promise<{ ok: boolean; message?: string }> {
  if (!name.trim()) return { ok: false, message: 'app name required' }
  const err = await run('osascript', ['-e', `tell application ${JSON.stringify(name)} to activate`])
  if (err) return { ok: false, message: `activate failed: ${err}` }
  return { ok: true }
}

export async function quitApp(name: string): Promise<{ ok: boolean; message?: string }> {
  if (!name.trim()) return { ok: false, message: 'app name required' }
  const err = await run('osascript', ['-e', `tell application ${JSON.stringify(name)} to quit`])
  if (err) return { ok: false, message: `quit failed: ${err}` }
  return { ok: true }
}
