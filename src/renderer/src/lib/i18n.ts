/**
 * 渲染进程 i18n —— t() + useLang()。
 * 语言状态由主进程 settings.language 驱动（settings-changed 广播），
 * 见 main.tsx 的同步；本模块只负责分发到组件重渲染。
 */
import { useEffect, useReducer } from 'react'
import { translate, type Lang } from '../../../shared/locales'

let lang: Lang = 'zh'
const listeners = new Set<() => void>()

export function setLang(l: Lang): void {
  if (l !== lang) {
    lang = l
    for (const fn of listeners) fn()
  }
}

export function getLang(): Lang {
  return lang
}

/** 翻译函数：t('feed.eatFile', { name: 'x.md' }) */
export function t(key: string, vars?: Record<string, string | number>): string {
  return translate(lang, key, vars)
}

/** 语言变化时触发组件重渲染 */
export function useLang(): { t: typeof t; lang: Lang } {
  const [, force] = useReducer((x: number) => x + 1, 0)
  useEffect(() => {
    listeners.add(force)
    return () => { listeners.delete(force) }
  }, [])
  return { t, lang }
}
