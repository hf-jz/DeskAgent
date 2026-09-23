/**
 * HabitPanel — 习惯工程主面板
 *
 * 四个 Tab：
 *   时间线 — 当日活动时间线
 *   习惯卡 — 所有 habit 卡（按状态分组，含一键执行）
 *   简报   — 晨间简报预览
 *   隐私   — 暂停/AI摘要/导出/删除/手动跑管道（B11 隐私控制中枢）
 *
 * B11：未获知情同意时整面板显示同意页，采集器不会启动。
 */
import React, { useState, useEffect, useCallback } from 'react'
import { t } from '../lib/i18n'

// ── Styles ──

const S = {
  wrapper: {
    width: '100%', height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' as const,
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
    color: 'var(--ink)', background: 'var(--bg-elev)',
  },
  tabs: {
    display: 'flex', borderBottom: '1px solid var(--bg-hover)',
    padding: '0 12px', flexShrink: 0, alignItems: 'center',
  },
  tab: (active: boolean) => ({
    padding: '8px 14px', fontSize: '12px', fontWeight: active ? 600 : 400,
    color: active ? 'var(--accent-text)' : 'var(--ink-muted)',
    cursor: 'pointer', borderBottom: active ? '2px solid var(--accent-text)' : '2px solid transparent',
    marginBottom: -1, transition: 'all 0.15s',
  }),
  score: {
    marginLeft: 'auto', fontSize: '10px', color: 'var(--ink-faint)',
    display: 'flex', alignItems: 'center', gap: '4px',
  },
  content: { flex: 1, overflowY: 'auto' as const, padding: '12px' },
  card: {
    background: 'var(--bg-card)', borderRadius: '10px',
    border: '1px solid var(--line)', padding: '12px', marginBottom: '8px',
  },
  badge: (status: string) => {
    const colors: Record<string, string> = {
      candidate: 'var(--warn)', confirmed: 'var(--accent-2)', active: 'var(--ok)',
      stale: 'var(--ink-muted)', archived: '#374151',
    }
    return {
      fontSize: '9px', padding: '1px 6px', borderRadius: '4px',
      background: (colors[status] || 'var(--ink-muted)') + '30',
      color: colors[status] || 'var(--ink-muted)', fontWeight: 600,
    }
  },
  btn: (primary?: boolean, danger?: boolean) => ({
    padding: '4px 10px', fontSize: '10px', borderRadius: '6px', border: 'none',
    cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
    background: danger
      ? 'var(--danger-soft)'
      : primary ? 'linear-gradient(135deg, var(--accent), var(--accent-2))' : 'var(--bg-hover)',
    color: danger ? 'var(--danger)' : 'var(--ink)', marginRight: '6px',
  }),
  timelineItem: {
    display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '6px 0',
    borderBottom: '1px solid var(--bg-card)', fontSize: '11px',
  },
  row: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '10px 0', borderBottom: '1px solid var(--bg-card)', fontSize: '12px',
  },
  toggle: (on: boolean) => ({
    width: '36px', height: '20px', borderRadius: '10px', border: 'none', cursor: 'pointer',
    background: on ? 'var(--ok)' : 'var(--line-strong)', position: 'relative' as const,
    transition: 'background 0.15s',
  }),
  toggleDot: (on: boolean) => ({
    position: 'absolute' as const, top: '2px', left: on ? '18px' : '2px',
    width: '16px', height: '16px', borderRadius: '50%', background: 'var(--ink)',
    transition: 'left 0.15s',
  }),
  desc: { fontSize: '10px', color: 'var(--ink-faint)', lineHeight: 1.5, marginTop: '2px' },
}

// ── Types ──

interface HabitCardUI {
  id: number
  name: string
  kind: string
  triggerJson: string
  patternJson: string
  confidence: number
  evidenceCount: number
  firstSeen: string
  lastSeen: string
  status: string
  userNote: string
}

interface SegmentUI {
  id: number
  startTs: number
  endTs: number
  app: string
  title: string
  url?: string
  durationMs: number
}

interface BriefingUI {
  greeting: string
  yesterdaySummary: string
  todayRoutines: { name: string; trigger: string; confidence: number }[]
  pendingSuggestions: string[]
  tip: string
}

interface StateUI {
  collector: string
  eventCount: number
  segmentCount: number
  lastSampleAt: number | null
  privacyPaused: boolean
  habitEnabled: boolean
  aiSummaryEnabled: boolean
  collectorErrors: number
  lastCollectorError: string
}

// ── Helpers ──

/** 本地时区日期串（C14：渲染层同样不能用 toISOString 的 UTC 日期） */
function localToday(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  if (isNaN(d.getTime())) return '--:--'
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function formatDuration(ms: number): string {
  const mins = Math.round(ms / 60000)
  if (mins < 1) return '<1m'
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${h}h${m > 0 ? m + 'm' : ''}`
}

function kindLabel(kind: string): string {
  const map: Record<string, string> = {
    time_routine: t('habit.kind.routine'),
    sequence: t('habit.kind.sequence'),
    context: t('habit.kind.context'),
    preference: t('habit.kind.preference'),
    workflow: t('habit.kind.workflow'),
  }
  return map[kind] || kind
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    candidate: t('habit.state.candidate'), confirmed: t('habit.state.confirmed'), active: t('habit.state.active'),
    stale: t('habit.state.stale'), archived: t('habit.state.archived'),
  }
  return map[status] || status
}

// ── Component ──

export default function HabitPanel(): React.JSX.Element {
  const [tab, setTab] = useState<'timeline' | 'habits' | 'briefing' | 'privacy'>('timeline')
  const [habits, setHabits] = useState<HabitCardUI[]>([])
  const [segments, setSegments] = useState<SegmentUI[]>([])
  const [briefing, setBriefing] = useState<BriefingUI | null>(null)
  const [svcState, setSvcState] = useState<StateUI | null>(null)
  const [insight, setInsight] = useState<{ score: number; insight: string; source: string }>({ score: 0, insight: '', source: 'local' })
  const [weekly, setWeekly] = useState<{ text: string; date: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const today = localToday()

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const api = window.deskAppAPI
      const [h, s, b, st, sc, wr] = await Promise.all([
        api.habitGetHabits?.() || Promise.resolve([]),
        api.habitGetSegments?.(today) || Promise.resolve([]),
        api.habitGetBriefing?.() || Promise.resolve(null),
        api.habitGetState?.() || Promise.resolve(null),
        api.habitGetScoreInsight?.() || Promise.resolve({ score: 0, insight: '', source: 'local' }),
        api.habitGetWeeklyReport?.() || Promise.resolve(null),
      ])
      setHabits(h)
      setSegments(s)
      setBriefing(b)
      setSvcState(st)
      setInsight(sc)
      setWeekly(wr)
    } catch { /* ignore */ }
    setLoading(false)
  }, [today])

  useEffect(() => { refresh() }, [refresh])

  const handleConfirm = async (id: number) => {
    await window.deskAppAPI.habitConfirm?.(id)
    refresh()
  }
  const handleDismiss = async (id: number) => {
    await window.deskAppAPI.habitDismiss?.(id)
    refresh()
  }
  const handleActivate = async (id: number) => {
    await window.deskAppAPI.habitActivate?.(id)
    refresh()
  }
  const handleExtract = async () => {
    setBusy(t('habit.busy.extract'))
    await window.deskAppAPI.habitExtract?.()
    setBusy('')
    refresh()
  }
  const handleExecute = async (id: number) => {
    const r = await window.deskAppAPI.habitExecute?.(id)
    if (r && !r.ok) alert(t('habit.execFail') + ': ' + (r.error || t('habit.unknown')))
  }
  const handleConsent = async () => {
    await window.deskAppAPI.habitSetEnabled?.(true)
    refresh()
  }
  const handleTogglePause = async () => {
    if (!svcState) return
    if (svcState.privacyPaused) await window.deskAppAPI.habitResume?.()
    else await window.deskAppAPI.habitPause?.()
    refresh()
  }
  const handleToggleAI = async () => {
    if (!svcState) return
    await window.deskAppAPI.habitSetAISummary?.(!svcState.aiSummaryEnabled)
    refresh()
  }
  const handleDisable = async () => {
    await window.deskAppAPI.habitSetEnabled?.(false)
    refresh()
  }
  const handleRunPipeline = async () => {
    setBusy(t('habit.busy.summary'))
    await window.deskAppAPI.habitRunPipeline?.()
    setBusy('')
    refresh()
  }
  const handleRunWeekly = async () => {
    setBusy(t('habit.busy.weekly'))
    await window.deskAppAPI.habitRunWeekly?.()
    setBusy('')
    refresh()
  }
  const handleExport = async () => {
    const json = await window.deskAppAPI.habitExport?.()
    if (json) {
      const blob = new Blob([json], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `habit-export-${today}.json`
      a.click()
      URL.revokeObjectURL(a.href)
    }
  }
  const handleDeleteAll = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return }
    await window.deskAppAPI.habitDeleteAll?.()
    setConfirmDelete(false)
    refresh()
  }

  // ── B11: 知情同意门 ──
  if (svcState && !svcState.habitEnabled) {
    return (
      <div style={{ ...S.wrapper, justifyContent: 'center', alignItems: 'center', padding: '32px' }}>
        <div style={{ maxWidth: '380px', textAlign: 'center' }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>🔭</div>
          <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '12px' }}>{t('habit.title')}</div>
          <div style={{ fontSize: '12px', color: 'var(--ink-muted)', lineHeight: 1.8, textAlign: 'left', marginBottom: '16px' }}>
            {t('habit.intro')}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--ink-muted)', lineHeight: 1.8, textAlign: 'left', marginBottom: '20px' }}>
            {t('habit.collect')}<br />
            {t('habit.store')}<br />
            {t('habit.never')}<br />
            {t('habit.control')}<br />
            {t('habit.aiWarn')}
          </div>
          <button onClick={handleConsent} style={{ ...S.btn(true), padding: '8px 24px', fontSize: '13px' }}>
            {t('habit.consent')}
          </button>
          <div style={{ fontSize: '9px', color: 'var(--ink-faint)', marginTop: '12px' }}>
            {t('habit.axPerm')}
          </div>
        </div>
      </div>
    )
  }

  // ── Render ──

  const statusOrder = ['active', 'confirmed', 'candidate', 'stale', 'archived']
  const grouped = statusOrder.map(st => ({
    status: st,
    items: habits.filter(h => h.status === st),
  })).filter(g => g.items.length > 0)

  return (
    <div style={S.wrapper}>
      <div style={S.tabs}>
        <div style={S.tab(tab === 'timeline')} onClick={() => setTab('timeline')}>📊 {t('habit.tab.timeline')}</div>
        <div style={S.tab(tab === 'habits')} onClick={() => setTab('habits')}>🎯 {t('habit.tab.habits')}</div>
        <div style={S.tab(tab === 'briefing')} onClick={() => setTab('briefing')}>☀️ {t('habit.tab.briefing')}</div>
        <div style={S.tab(tab === 'privacy')} onClick={() => setTab('privacy')}>🔒 {t('habit.tab.privacy')}</div>
        <div
          style={S.score}
          title={`${insight.insight ? insight.insight + '\n\n' : ''}${t('habit.scoreDesc')}${insight.source === 'llm' ? t('habit.scoreAi') : ''}`}
        >
          💜 {t('habit.scoreTitle', { score: insight.score })}
        </div>
      </div>

      <div style={S.content}>
        {loading && <div style={{ fontSize: '11px', color: 'var(--ink-faint)' }}>{t('habit.loading')}</div>}
        {busy && <div style={{ fontSize: '11px', color: 'var(--accent-text)', marginBottom: '8px' }}>{busy}</div>}

        {/* ── 时间线 ── */}
        {tab === 'timeline' && !loading && (
          <div>
            <div style={{ fontSize: '11px', color: 'var(--ink-faint)', marginBottom: '8px' }}>
              {t('habit.segments', { date: today, n: segments.length })}
              {svcState?.privacyPaused && <span style={{ color: 'var(--warn)', marginLeft: '8px' }}>⏸ 已暂停观察</span>}
            </div>
            {segments.length === 0 && (
              <div style={{ fontSize: '11px', color: 'var(--ink-faint)', textAlign: 'center', padding: '20px' }}>
                {t('habit.noData')}
              </div>
            )}
            {segments.map((seg) => (
              <div key={seg.id} style={S.timelineItem}>
                <span style={{ color: 'var(--ink-faint)', minWidth: '40px', fontFamily: 'SF Mono, monospace' }}>
                  {formatTime(seg.startTs)}
                </span>
                <span style={{ color: 'var(--accent-text)', fontWeight: 600, minWidth: '100px' }}>{seg.app}</span>
                <span style={{ color: 'var(--ink-muted)', flex: 1 }}>
                  {seg.title?.slice(0, 50) || ''}
                </span>
                <span style={{ color: 'var(--ink-faint)', minWidth: '40px', textAlign: 'right', fontFamily: 'SF Mono, monospace' }}>
                  {formatDuration(seg.durationMs)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* ── 习惯卡 ── */}
        {tab === 'habits' && !loading && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '11px', color: 'var(--ink-faint)' }}>
                {t('habit.cards', { n: habits.length })}
              </span>
              <button onClick={handleExtract} style={S.btn()}>
                {t('habit.reextract')}
              </button>
            </div>

            {habits.length === 0 && (
              <div style={{ fontSize: '11px', color: 'var(--ink-faint)', textAlign: 'center', padding: '20px' }}>
                {t('habit.noHabits')}
              </div>
            )}

            {grouped.map(g => (
              <div key={g.status} style={{ marginBottom: '12px' }}>
                <div style={{
                  fontSize: '10px', color: 'var(--ink-faint)', fontWeight: 600,
                  marginBottom: '4px', textTransform: 'uppercase',
                }}>
                  {statusLabel(g.status)} · {g.items.length}
                </div>
                {g.items.map(h => (
                  <div key={h.id} style={S.card}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                      <span style={{ fontSize: '12px', fontWeight: 600 }}>
                        {kindLabel(h.kind)} {h.name}
                      </span>
                      <span style={S.badge(h.status)}>{statusLabel(h.status)}</span>
                    </div>
                    <div style={{ fontSize: '9px', color: 'var(--ink-faint)', marginBottom: '4px' }}>
                      {t('habit.confidence', { p: Math.round(h.confidence * 100), n: h.evidenceCount, d: h.firstSeen ? h.firstSeen.slice(0, 10) : '' })}
                    </div>
                    <div style={{ fontSize: '10px', color: 'var(--ink-muted)', marginBottom: '6px' }}>
                      {(() => {
                        try {
                          const p = JSON.parse(h.patternJson)
                          const parts: string[] = []
                          if (p.apps) parts.push(...p.apps)
                          if (p.sequence) parts.push(p.sequence.join(' → '))
                          return parts.join(' · ')
                        } catch { return '' }
                      })()}
                    </div>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      {h.status === 'candidate' && (
                        <>
                          <button onClick={() => handleConfirm(h.id)} style={S.btn(true)}>✓ {t('habit.confirm')}</button>
                          <button onClick={() => handleDismiss(h.id)} style={S.btn()}>✕ {t('habit.ignore')}</button>
                        </>
                      )}
                      {h.status === 'confirmed' && (
                        <button onClick={() => handleActivate(h.id)} style={S.btn(true)}>▶ {t('habit.activate')}</button>
                      )}
                      {h.status === 'active' && (
                        <>
                          <button onClick={() => handleExecute(h.id)} style={S.btn(true)}>⚡ {t('habit.execute')}</button>
                          <button onClick={() => handleDismiss(h.id)} style={S.btn()}>{t('habit.pause')}</button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* ── 简报 ── */}
        {tab === 'briefing' && !loading && (
          <div>
            {briefing ? (
              <>
                <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>
                  {briefing.greeting}
                </div>
                <div style={S.card}>
                  <div style={{ fontSize: '10px', color: 'var(--ink-faint)', marginBottom: '4px' }}>昨日摘要</div>
                  <div style={{ fontSize: '11px', color: 'var(--ink-secondary)', lineHeight: 1.5 }}>
                    {briefing.yesterdaySummary || t('habit.noYesterday')}
                  </div>
                </div>
                {insight.insight && (
                  <div style={S.card}>
                    <div style={{ fontSize: '10px', color: 'var(--ink-faint)', marginBottom: '4px' }}>
                      {t('habit.scoreLine', { score: insight.score, src: insight.source === 'llm' ? t('habit.srcAi') : t('habit.srcLocal') })}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--ink-secondary)', lineHeight: 1.5 }}>
                      💜 {insight.insight}
                    </div>
                  </div>
                )}
                {briefing.todayRoutines.length > 0 && (
                  <div style={S.card}>
                    <div style={{ fontSize: '10px', color: 'var(--ink-faint)', marginBottom: '4px' }}>今日预期例程</div>
                    {briefing.todayRoutines.map((r, i) => (
                      <div key={i} style={{ fontSize: '11px', color: 'var(--ink-secondary)', marginBottom: '2px' }}>
                        🕐 {r.trigger} · {r.name}（{Math.round(r.confidence * 100)}%）
                      </div>
                    ))}
                  </div>
                )}
                {briefing.pendingSuggestions.length > 0 && (
                  <div style={S.card}>
                    <div style={{ fontSize: '10px', color: 'var(--ink-faint)', marginBottom: '4px' }}>待处理建议</div>
                    {briefing.pendingSuggestions.map((s, i) => (
                      <div key={i} style={{ fontSize: '11px', color: 'var(--warn)', marginBottom: '2px' }}>
                        💡 {s}
                      </div>
                    ))}
                  </div>
                )}
                {weekly && (
                  <div style={S.card}>
                    <div style={{ fontSize: '10px', color: 'var(--ink-faint)', marginBottom: '4px' }}>
                      {t('habit.weekly', { date: weekly.date })}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--ink-secondary)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                      {weekly.text}
                    </div>
                  </div>
                )}
                <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                  <button onClick={handleRunPipeline} style={S.btn()}>
                    {t('habit.dailyExtract')}
                  </button>
                  <button onClick={handleRunWeekly} style={S.btn()}>
                    {t('habit.genWeekly')}
                  </button>
                </div>
                <div style={{ fontSize: '10px', color: 'var(--ink-faint)', marginTop: '8px', textAlign: 'center' }}>
                  💬 {briefing.tip}
                </div>
              </>
            ) : (
              <div style={{ fontSize: '11px', color: 'var(--ink-faint)', textAlign: 'center', padding: '20px' }}>
                {t('habit.briefingSoon')}
              </div>
            )}
          </div>
        )}

        {/* ── 隐私 ── */}
        {tab === 'privacy' && !loading && svcState && (
          <div>
            <div style={S.row}>
              <div>
                <div>{t('habit.obsStatus')}</div>
                <div style={S.desc}>
                  {svcState.collector === 'running' ? t('habit.obsRunning')
                            : svcState.privacyPaused ? t('habit.obsPaused')
                            : t('habit.obsIdle')}
                </div>
              </div>
              <button onClick={handleTogglePause} style={S.btn(svcState.privacyPaused)}>
                {svcState.privacyPaused ? t('habit.resumeObs') : t('habit.pauseObs')}
              </button>
            </div>

            <div style={S.row}>
              <div>
                <div>{t('habit.aiSummary')}</div>
                <div style={S.desc}>
                  {t('habit.aiSummaryDesc')}
                </div>
              </div>
              <button style={S.toggle(svcState.aiSummaryEnabled)} onClick={handleToggleAI}>
                <div style={S.toggleDot(svcState.aiSummaryEnabled)} />
              </button>
            </div>

            <div style={S.row}>
              <div>
                <div>{t('habit.stats')}</div>
                <div style={S.desc}>
                  {t('habit.statsLine', { n: svcState.eventCount, s: svcState.segmentCount })}{svcState.collectorErrors > 0 ? ` · ${svcState.collectorErrors} 次采样错误` : ''}
                </div>
              </div>
            </div>

            {svcState.lastCollectorError && (
              <div style={{ ...S.card, borderColor: 'rgba(234,179,8,0.3)' }}>
                <div style={{ fontSize: '10px', color: 'var(--warn)', marginBottom: '4px' }}>
                  {t('habit.sampleErr')}
                </div>
                <div style={{ fontSize: '10px', color: 'var(--ink-muted)' }}>
                  {svcState.lastCollectorError}
                </div>
              </div>
            )}

            <div style={S.row}>
              <div>
                <div>{t('habit.export')}</div>
                <div style={S.desc}>{t('habit.exportDesc')}</div>
              </div>
              <button onClick={handleExport} style={S.btn()}>{t('habit.exportBtn')}</button>
            </div>

            <div style={S.row}>
              <div>
                <div>{t('habit.disable')}</div>
                <div style={S.desc}>{t('habit.disableDesc')}</div>
              </div>
              <button onClick={handleDisable} style={S.btn()}>{t('habit.disableBtn')}</button>
            </div>

            <div style={{ ...S.row, borderBottom: 'none' }}>
              <div>
                <div style={{ color: 'var(--danger)' }}>{t('habit.wipe')}</div>
                <div style={S.desc}>{t('habit.wipeDesc')}</div>
              </div>
              <button onClick={handleDeleteAll} style={S.btn(false, true)}>
                {confirmDelete ? t('habit.confirmDelete') : t('habit.delete')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
