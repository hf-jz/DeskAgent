/** P1-B2 #39: feature flags — localStorage-backed, off-by-default. */

import { t } from './lib/i18n'

const KEY = 'deskapp.flags'

export type FlagName = 'selfwake' | 'rightRail' | 'habit' | 'skillHub'

export function FLAG_LABELS(): Record<FlagName, string> {
  return {
    selfwake: t('flags.selfwake'),
    rightRail: t('flags.rightRail'),
    habit: t('flags.habit'),
    skillHub: t('flags.skillHub'),
  }
}

export function flag(name: FlagName): boolean {
  try { return !!JSON.parse(localStorage.getItem(KEY) || '{}')[name] } catch { return false }
}

export function setFlag(name: FlagName, on: boolean): void {
  let cur: Record<string, boolean> = {}
  try { cur = JSON.parse(localStorage.getItem(KEY) || '{}') } catch { /* ignore */ }
  cur[name] = on
  localStorage.setItem(KEY, JSON.stringify(cur))
}
