// ── 任务模版: presets that instantiate a complete window spec instantly ──
// (no LLM round-trip needed; free-form creation still goes through the agent)
import type { WindowSpec } from '../../../shared/gen-ui-types'
import { t } from '../lib/i18n'
import { Search, FileText, Gauge, Shield, BellRing, BarChart, Eye, Newspaper, Presentation, BookOpen, FileSpreadsheet, Clapperboard, Home } from 'lucide-react'

export const TEMPLATE_ICONS = {
  search: Search, file: FileText, gauge: Gauge, shield: Shield,
  bell: BellRing, chart: BarChart, eye: Eye, news: Newspaper,
  presentation: Presentation, brochure: BookOpen, manual: FileSpreadsheet, video: Clapperboard, homepage: Home,
} as const

export interface TaskTemplate {
  id: string
  name: string
  desc: string
  icon: 'search' | 'file' | 'gauge' | 'shield' | 'bell' | 'chart' | 'eye' | 'news'
  kind: string
  schedule: string
  scheduleLabel: string
  prompt: string
  props: Record<string, string>
}

export const TEMPLATES = (): TaskTemplate[] => [
  {
    id: 'tmpl-search', name: t('tmpl.search'), icon: 'search', kind: 'feed',
    schedule: '0 9,17 * * *', scheduleLabel: t('tmpl.searchSched'),
    desc: t('tmpl.searchDesc'),
    prompt: '搜索主题「{{topic}}」的最新动态，整理成要点列表，输出 JSON：{"items":[{"title":"…","summary":"…","source":"…"}]}',
    props: { topic: t('tmpl.topic.ai'), webhook: '' },
  },
  {
    id: 'tmpl-digest', name: t('tmpl.digest'), icon: 'file', kind: 'feed',
    schedule: '0 18 * * *', scheduleLabel: t('tmpl.digestSched'),
    desc: t('tmpl.digestDesc'),
    prompt: '汇总「{{detail}}」的今日进展，按重要度排序输出 JSON：{"items":[{"title":"…","summary":"…"}]}',
    props: { detail: t('tmpl.topic.daily') },
  },
  {
    id: 'tmpl-watch', name: t('tmpl.watch'), icon: 'gauge', kind: 'monitor',
    schedule: '*/30 9,10,11,13,14,15 * * 1-5', scheduleLabel: t('tmpl.watchSched'),
    desc: t('tmpl.watchDesc'),
    prompt: '盯盘「{{topic}}」，输出关键指标 JSON：{"metrics":[{"name":"…","value":"…","trend":"up|down|flat"}],"alerts":["…"]}，异常项单独列在 alerts',
    props: { topic: t('tmpl.topic.index') },
  },
  {
    id: 'tmpl-inspect', name: t('tmpl.inspect'), icon: 'shield', kind: 'monitor',
    schedule: '0 * * * *', scheduleLabel: t('tmpl.inspectSched'),
    desc: t('tmpl.inspectDesc'),
    prompt: '巡检「{{topic}}」当前状态，输出 JSON：{"metrics":[{"name":"状态","value":"…"}],"alerts":["风险项…"]}',
    props: { topic: t('tmpl.topic.svc') },
  },
  {
    id: 'tmpl-alert', name: t('tmpl.alert'), icon: 'bell', kind: 'alerts',
    schedule: '*/5 * * * *', scheduleLabel: t('tmpl.alertSched'),
    desc: t('tmpl.alertDesc'),
    prompt: '监控「{{topic}}」，发现异常输出 JSON：{"alerts":[{"level":"warn|error","text":"…"}],"items":[]}',
    props: { topic: t('tmpl.topic.kpi'), webhook: '' },
  },
  {
    id: 'tmpl-dashboard', name: t('tmpl.dashboard'), icon: 'chart', kind: 'dashboard',
    schedule: '0 */6 * * *', scheduleLabel: t('tmpl.dashboardSched'),
    desc: t('tmpl.dashboardDesc'),
    prompt: '更新「{{topic}}」数据看板，输出 JSON：{"kpis":[{"label":"…","value":"…","delta":"…"}],"items":[]}',
    props: { topic: t('tmpl.topic.project') },
  },
  {
    id: 'tmpl-iframe', name: t('tmpl.iframe'), icon: 'eye', kind: 'iframe',
    schedule: '*/10 * * * *', scheduleLabel: t('tmpl.iframeSched'),
    desc: t('tmpl.iframeDesc'),
    prompt: '记录「{{topic}}」页面快照要点，输出 JSON：{"items":[{"title":"页面状态","summary":"…"}]}',
    props: { src: 'https://example.com', topic: t('tmpl.topic.page') },
  },
  {
    id: 'tmpl-morning', name: t('tmpl.morning'), icon: 'news', kind: 'feed',
    schedule: '0 8 * * 1-5', scheduleLabel: t('tmpl.morningSched'),
    desc: t('tmpl.morningDesc'),
    prompt: '生成「{{detail}}」晨间简报，输出 JSON：{"items":[{"title":"…","summary":"…"}]}',
    props: { detail: t('tmpl.topic.morning') },
  },
]

export function specFromTemplate(t: TaskTemplate): WindowSpec {
  return {
    id: `tmpl-${t.id}-${Date.now().toString(36)}`,
    title: t.name,
    kind: t.kind,
    cron: { schedule: t.schedule, prompt: t.prompt, standingGrants: [] },
    props: { ...t.props },
  }
}
