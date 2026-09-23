/**
 * i18n 纯函数核心 —— main 与 renderer 共用。
 * 字典：src/shared/locales/{zh,en}.ts（纯数据，无 Electron 依赖）。
 */
import { zh } from './zh'
import { en } from './en'

export type Lang = 'zh' | 'en'

const DICTS: Record<Lang, Record<string, string>> = { zh, en }

/** 翻译：未命中返回 key 本身（增量迁移安全）；{var} 插值 */
export function translate(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  let s = DICTS[lang][key] ?? key
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v))
  }
  return s
}

export function isLang(v: unknown): v is Lang {
  return v === 'zh' || v === 'en'
}
