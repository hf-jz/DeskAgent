// ── 任务进度: gantt timeline of scheduled windows, modeled on wenxibuddy ProjectTimeline ──
// Each row = one window spec with a cron schedule; the bar spans its scheduled
// run days inside the visible window. Real-date axis (not month-serial hacks).
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { t } from '../../lib/i18n'
import { motion, AnimatePresence } from 'framer-motion'
import { CalendarRange, ChevronRight } from 'lucide-react'
import type { WindowSpec, SpecStatus } from '../../../../shared/gen-ui-types'
import { cronDaysInRange, fmtDay } from '../../../../shared/cron-days'
import { G, GLASS, EDGE, EMERALD } from './style'

type Scale = '周' | '双周' | '月'

const AXIS_COUNT: Record<Scale, number> = { 周: 14, 双周: 28, 月: 31 }
const SHIFT: Record<Scale, number> = { 周: 7, 双周: 14, 月: 30 }

function PHASE(): Record<string, string> {
  return {
    feed: t('prog.feed'), monitor: t('prog.monitor'), alerts: t('prog.alerts'), dashboard: t('prog.dashboard'), chart: t('prog.chart'),
    counter: t('prog.counter'), checklist: t('prog.checklist'), clock: t('prog.clock'), text: t('prog.text'), links: t('prog.links'),
    image: t('prog.image'), iframe: t('prog.iframe'),
  }
}

interface Props {
  specs: WindowSpec[]
  statusMap: Record<string, SpecStatus>
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

const toneStyle = {
  neon: { background: 'linear-gradient(90deg, #34d399, #2dd4bf)', border: '1px solid rgba(110,231,183,0.5)', color: '#04120c', fontWeight: 700, boxShadow: '0 0 18px rgba(16,185,129,0.4)' },
  soft: { background: 'rgba(52,211,153,0.15)', border: '1px solid rgba(52,211,153,0.35)', color: '#d1fae5' },
  muted: { background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.8)' },
  ghost: { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.45)' },
  err: { background: 'rgba(248,113,113,0.14)', border: '1px solid rgba(248,113,113,0.35)', color: '#fecaca' },
} as const

export default function ProgressView({ specs, statusMap }: Props) {
  const [scale, setScale] = useState<Scale>('周')
  const [windowStart, setWindowStart] = useState(() => addDays(startOfDay(new Date()), -6))
  const [flashToday, setFlashToday] = useState(false)
  const [selectedDay, setSelectedDay] = useState<Date | null>(null)
  const [activeBar, setActiveBar] = useState<string | null>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)

  const count = AXIS_COUNT[scale]
  const axis = useMemo(() => Array.from({ length: count }, (_, i) => addDays(windowStart, i)), [windowStart, count])
  const today = startOfDay(new Date())
  const todayIndex = axis.findIndex(d => sameDay(d, today))

  useEffect(() => {
    // 切换尺度时回到以今天为锚的窗口
    setWindowStart(addDays(today, scale === '周' ? -6 : scale === '双周' ? -10 : -15))
  }, [scale]) // eslint-disable-line react-hooks/exhaustive-deps

  const monthLabel = useMemo(() => {
    const a = axis[0], b = axis[axis.length - 1]
    const same = a.getMonth() === b.getMonth()
    return t('prog.year', { y: a.getFullYear(), m: a.getMonth() + 1 }) + (same ? '' : t('prog.monthRange', { m: b.getMonth() + 1 }))
  }, [axis])

  const rows = useMemo(() => specs
    .filter(s => s.cron)
    .map(s => {
      const runs = cronDaysInRange(s.cron!.schedule, axis[0], axis[axis.length - 1])
      const idx = runs.map(r => axis.findIndex(d => sameDay(d, r))).filter(i => i >= 0)
      const st = statusMap[s.id]
      const running = st?.status === 'running'
      const tone = running ? 'neon' : st?.status === 'error' ? 'err' : st?.status === 'ok' ? 'soft' : (st?.lastRun ? 'muted' : 'ghost')
      return { spec: s, idx, tone, range: runs.length ? `${fmtDay(runs[0])} - ${fmtDay(runs[runs.length - 1])}` : '' }
    }), [specs, statusMap, axis])

  const jumpToday = () => {
    setFlashToday(true)
    setWindowStart(addDays(startOfDay(new Date()), scale === '周' ? -6 : scale === '双周' ? -10 : -15))
    setSelectedDay(today)
    scrollerRef.current?.scrollTo({ left: 0, behavior: 'smooth' })
    window.setTimeout(() => setFlashToday(false), 900)
  }

  const shift = (dir: -1 | 1) => setWindowStart(s => addDays(s, dir * SHIFT[scale]))

  return (
    <div style={{ background: GLASS, border: `1px solid ${EDGE}`, borderRadius: 16, padding: '14px 16px', overflow: 'hidden', fontFamily: G, backdropFilter: 'blur(30px)', WebkitBackdropFilter: 'blur(30px)' }}>
      {/* 顶栏 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingBottom: 10, marginBottom: 6, borderBottom: `1px solid ${EDGE}`, flexWrap: 'nowrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: EMERALD, boxShadow: `0 0 8px ${EMERALD}` }} />
          <h3 style={{ fontSize: 13, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap' }}>{t('prog.title')}</h3>
          <div style={{ padding: '3px 10px', borderRadius: 999, background: 'rgba(255,255,255,0.05)', border: `1px solid ${EDGE}`, fontSize: 11, color: 'rgba(255,255,255,0.55)', display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
            <CalendarRange size={11} style={{ color: '#34d399' }} /> {monthLabel}
          </div>
          <div style={{ display: 'flex', gap: 2 }}>
            <button onClick={() => shift(-1)} style={arrowBtn} title={t('prog.prev')}><ChevronRight size={13} style={{ transform: 'rotate(180deg)' }} /></button>
            <button onClick={() => shift(1)} style={arrowBtn} title={t('prog.next')}><ChevronRight size={13} /></button>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 2, padding: 2, borderRadius: 999, background: 'rgba(255,255,255,0.05)', border: `1px solid ${EDGE}` }}>
            {(['周', '双周', '月'] as Scale[]).map(s => (
              <button key={s} onClick={() => setScale(s)}
                style={{
                  padding: '3px 10px', borderRadius: 999, fontSize: 11, cursor: 'pointer', fontFamily: G,
                  background: scale === s ? 'rgba(52,211,153,0.18)' : 'transparent',
                  border: scale === s ? '1px solid rgba(52,211,153,0.4)' : '1px solid transparent',
                  color: scale === s ? '#34d399' : 'rgba(255,255,255,0.5)',
                }}>{s === '周' ? t('prog.weekView') : s === '双周' ? t('prog.biweekView') : t('prog.monthView')}</button>
            ))}
          </div>
          <button onClick={jumpToday}
            style={{
              padding: '4px 12px', borderRadius: 999, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: G,
              background: flashToday ? EMERALD : 'rgba(52,211,153,0.15)',
              border: flashToday ? '1px solid rgba(167,243,208,0.6)' : '1px solid rgba(52,211,153,0.3)',
              color: flashToday ? '#04120c' : '#34d399', boxShadow: flashToday ? `0 0 14px ${EMERALD}88` : 'none',
            }}>{t('prog.today')}</button>
        </div>
      </div>

      <div style={{ overflowX: 'auto', scrollbarWidth: 'none' }} ref={scrollerRef}>
        <div style={{ minWidth: 760 }}>
          {/* 表头 */}
          <div style={{ display: 'grid', gridTemplateColumns: `88px repeat(${count}, minmax(0, 1fr))`, alignItems: 'center', fontSize: 11, paddingBottom: 8 }}>
            <div style={{ color: 'rgba(255,255,255,0.3)', paddingLeft: 4 }}>{t('prog.phase')}</div>
            {axis.map((d, i) => {
              const isToday = sameDay(d, today)
              const isSel = selectedDay && sameDay(d, selectedDay)
              return (
                <button key={i} onClick={() => setSelectedDay(d)} style={{ display: 'flex', justifyContent: 'center', padding: '2px 0', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: G }}>
                  {isToday ? (
                    <motion.span animate={{ scale: flashToday ? 1.12 : 1 }}
                      style={{ width: 22, height: 22, borderRadius: '50%', background: EMERALD, color: '#04120c', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, boxShadow: `0 0 12px ${EMERALD}` }}>{d.getDate()}</motion.span>
                  ) : (
                    <span style={{ fontSize: 10, fontFamily: 'ui-monospace, monospace', color: isSel ? EMERALD : 'rgba(255,255,255,0.35)' }}>{d.getDate()}</span>
                  )}
                </button>
              )
            })}
          </div>

          {/* 行 */}
          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {todayIndex >= 0 && (
              <div style={{ position: 'absolute', top: 0, bottom: 0, zIndex: 20, pointerEvents: 'none', left: `calc(88px + (100% - 88px) * ${(todayIndex + 0.5) / count})`, width: 1, background: 'linear-gradient(to bottom, rgba(52,211,153,0.95), rgba(52,211,153,0.2), transparent)', boxShadow: `0 0 10px ${EMERALD}` }} />
            )}
            {rows.length === 0 && (
              <div style={{ padding: '46px 0', textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 12.5 }}>
                {t('prog.empty')}
              </div>
            )}
            <AnimatePresence mode="popLayout">
              {rows.map(({ spec, idx, tone, range }) => {
                const first = idx[0]
                const last = idx[idx.length - 1]
                const has = first !== undefined
                const left = has ? (first / count) * 100 : 0
                const width = has ? Math.max(((last - first + 1) / count) * 100, 100 / count) : 0
                return (
                  <motion.div key={spec.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                    style={{ display: 'grid', gridTemplateColumns: `88px repeat(${count}, minmax(0, 1fr))`, alignItems: 'center', fontSize: 11 }}>
                    <button
                      onClick={() => setActiveBar(spec.id)}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 4, paddingRight: 8, color: 'rgba(255,255,255,0.5)', fontWeight: 500, background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: G, textAlign: 'left' }}>
                      <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'rgba(255,255,255,0.35)', flexShrink: 0 }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{PHASE()[spec.kind] || spec.kind}</span>
                    </button>
                    <div style={{ gridColumn: `2 / span ${count}`, position: 'relative', height: 28, borderRadius: 999, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.05)' }}>
                      {has ? (
                        <motion.button
                          initial={false}
                          animate={{ left: `${left}%`, width: `${width}%`, opacity: 1 }}
                          transition={{ type: 'spring', stiffness: 320, damping: 28 }}
                          whileHover={{ scale: 1.015 }}
                          onClick={() => setActiveBar(spec.id)}
                          title={`${spec.title} · ${range} · ${spec.cron!.schedule}`}
                          style={{
                            position: 'absolute', top: 4, bottom: 4, borderRadius: 999, padding: '0 10px',
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                            fontSize: 10, cursor: 'pointer', overflow: 'hidden', fontFamily: G,
                            ...toneStyle[tone as keyof typeof toneStyle],
                            ...(activeBar === spec.id ? { boxShadow: `0 0 0 1px rgba(52,211,153,0.4), 0 0 14px rgba(52,211,153,0.25)` } : {}),
                          }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{spec.title}</span>
                          <span style={{ fontFamily: 'ui-monospace, monospace', opacity: 0.8, flexShrink: 0 }}>{range}</span>
                        </motion.button>
                      ) : (
                        <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: 'rgba(255,255,255,0.2)' }}>不在当前视野</span>
                      )}
                    </div>
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  )
}

const arrowBtn: React.CSSProperties = {
  padding: 4, borderRadius: 8, background: 'transparent', border: 'none',
  color: 'rgba(255,255,255,0.4)', cursor: 'pointer', display: 'flex', alignItems: 'center',
}
