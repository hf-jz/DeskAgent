import { join } from 'path'
import { existsSync } from 'fs'

/**
 * Install 19 built-in OS automation skills on first launch.
 * Runs synchronously (spawnSync) to avoid delaying app startup.
 * Skills are idempotent — only installed if missing from ~/.deskapp/skills/.
 */
export function installBuiltinSkills(): void {
  try {
    // Use require() for modules only available in main process
    const { app } = require('electron')
    const { spawnSync } = require('child_process')

    const script = join(app.isPackaged ? join(process.resourcesPath, 'app.asar.unpacked', 'resources') : join(app.getAppPath(), 'resources'), 'install_builtin_skills.py')
    const python = join(process.env.HOME || '', '.hermes', 'hermes-agent', 'venv', 'bin', 'python3')

    if (existsSync(script)) {
      spawnSync(python, [script], { stdio: 'ignore' })
      console.log('[DeskApp] Built-in skills installed')
    }
  } catch { /* non-critical — app works without built-in skills */ }
}
