import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Plus, Clock, MapPin, Users, X } from 'lucide-react'
import { t } from '../lib/i18n'
import ProjectsView from './ProjectsView'
import ProjectDetailModal from './ProjectDetailModal'

// ── 视觉令牌（deskapp palette, 对齐 wenxibuddy liquid-glass） ──
const G = 'Plus Jakarta Sans, PingFang SC, -apple-system, BlinkMacSystemFont, sans-serif'
const GLASS = 'rgba(255,255,255,0.045)'
const EDGE = 'rgba(255,255,255,0.14)'
const EMERALD = '#34d399'
const MUTED = 'rgba(255,255,255,0.45)'

type ViewMode = 'month' | 'week' | 'day'
interface SEvent {
  id: string
  title: string
  date: string
  startHour: number
  endHour: number
  room: string
  priority: string
  attendees: string[]
  status: string
  recurrence?: string
}

const PRIORITIES = ['高', '中', '低'] as const
const STATUSES = ['待开始', '进行中', '已结束'] as const
const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']

const ymd = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
/** 小时数 → 'HH:mm' 显示（NaN/越界防御） */
const fmtHour = (h: number): string => {
  if (!Number.isFinite(h)) return '--:--'
  const hh = Math.floor(h)
  const mm = Math.round((h - hh) * 60)
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}
/** 'YYYY-MM-DD' → 'M月D日 周X'（day 视图导航标题） */
const dayLabel = (ds: string): string => {
  const d = new Date(ds + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return ds
  const w = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
  return `${d.getMonth() + 1}月${d.getDate()}日 周${w}`
}
/** 'HH:mm' → 小时数（float），非法回退 defaultH */
const parseHour = (s: string, defaultH = 9): number => {
  const [hh, mm] = s.split(':').map(Number)
  if (!Number.isFinite(hh) || hh < 0 || hh > 24) return defaultH
  return hh + (Number.isFinite(mm) ? Math.min(mm, 59) / 60 : 0)
}
const addDays = (d: Date, n: number): Date => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const todayYmd = (): string => ymd(new Date())

// 优先级颜色（对齐 wenxibuddy: 高=emerald, 中=sky, 低=muted）
const PRIORITY_STYLE: Record<string, { badge: string; bar: string; dot: string }> = {
  '高': { badge: `background:${EMERALD}1f;border:1px solid ${EMERALD}55;color:${EMERALD}`, bar: `background:${EMERALD}`, dot: `${EMERALD}` },
  '中': { badge: 'background:rgba(56,189,248,0.12);border:1px solid rgba(56,189,248,0.35);color:#7dd3fc', bar: 'background:#38bdf8', dot: '#38bdf8' },
  '低': { badge: 'background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.14);color:rgba(255,255,255,0.5)', bar: 'background:rgba(255,255,255,0.3)', dot: 'rgba(255,255,255,0.4)' },
}

const HOURS = Array.from({ length: 12 }, (_, i) => i + 8) // 8:00 - 19:00
const HOUR_H = 52 // 每小时高度 px

export default function SchedulerApp(): React.JSX.Element {
  const [section, setSection] = useState<'schedule' | 'projects'>('schedule')
  const [view, setView] = useState<ViewMode>('month')
  const [openProject, setOpenProject] = useState<any | null>(null)
  const [anchor, setAnchor] = useState<Date>(new Date())   // 当前视图中心日期
  const [selectedDay, setSelectedDay] = useState<string>(todayYmd())
  const [priorityFilter, setPriorityFilter] = useState<'all' | '高' | '中' | '低'>('all')
  const [events, setEvents] = useState<SEvent[]>([])
  const [modal, setModal] = useState<{ ev: SEvent | null; date: string } | null>(null)
  const [toast, setToast] = useState('')
  const [dragEv, setDragEv] = useState<SEvent | null>(null)
  const [showCreateMenu, setShowCreateMenu] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [briefing, setBriefing] = useState(false)

  const refresh = useCallback(() => {
    window.deskAppAPI.scheduler.listEvents().then(setEvents).catch(() => {})
  }, [])
  useEffect(() => { refresh() }, [refresh])
  useEffect(() => { window.deskAppAPI.scheduler.briefingState().then(setBriefing).catch(() => {}) }, [])

  const show = (msg: string): void => {
    setToast(msg)
    window.setTimeout(() => setToast(''), 1800)
  }

  const filtered = useMemo(() =>
    events.filter(e => priorityFilter === 'all' || e.priority === priorityFilter),
    [events, priorityFilter])

  // ── 月视图网格 ──
  const monthCells = useMemo(() => {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
    const start = addDays(first, -((first.getDay() + 6) % 7)) // 周一起始
    return Array.from({ length: 42 }, (_, i) => addDays(start, i))
  }, [anchor])

  const byDate = useMemo(() => {
    const m: Record<string, SEvent[]> = {}
    for (const e of filtered) (m[e.date] ??= []).push(e)
    return m
  }, [filtered])

  const weekDays = useMemo(() => {
    const monday = addDays(selectedDay ? new Date(selectedDay + 'T00:00:00') : new Date(), -((new Date(selectedDay + 'T00:00:00').getDay() + 6) % 7))
    return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
  }, [selectedDay])

  const shift = (dir: number): void => {
    const base = view === 'month'
      ? new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1)
      : addDays(anchor, (view === 'week' ? 7 : 1) * dir)
    setAnchor(base)
    // 周/日视图渲染用 selectedDay —— 翻页必须同步，否则显示不变
    if (view !== 'month') setSelectedDay(ymd(base))
  }

  const monthLabel = `${anchor.getFullYear()}年 ${anchor.getMonth() + 1}月`

  const saveEvent = async (ev: SEvent): Promise<void> => {
    if (!modal) return
    if (modal.ev) await window.deskAppAPI.scheduler.updateEvent(modal.ev.id, ev)
    else {
      const r = await window.deskAppAPI.scheduler.createEvent(ev)
      if (r?.error) { show(String(r.error)); return }
    }
    refresh()
    setSelectedDay(ev.date)
    setModal(null)
    show(t('sch.saved'))
  }

  const delEvent = async (): Promise<void> => {
    if (!modal?.ev) return
    await window.deskAppAPI.scheduler.deleteEvent(modal.ev.id)
    refresh()
    setModal(null)
    show(t('sch.deleted'))
  }

  const quickDoc = async (): Promise<void> => {
    // 快速文档 = 建一个无项目任务（title 带时间戳），落库即完成
    const r2 = await window.deskAppAPI.scheduler.createTask({ title: `快速文档 ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, phase: '产品设计', status: '待处理', priority: '低', desc: t('sch.quickDocDesc') })
    show(r2?.error ? String(r2.error) : t('sch.quickDocDone'))
  }

  const doSync = async (): Promise<void> => {
    setSyncing(true)
    const r = await window.deskAppAPI.scheduler.sync('pull')
    setSyncing(false)
    show(r?.ok ? t('sch.synced') : (r?.message || t('sch.syncUnavailable')))
  }

  // ── 渲染 ──
  return (
    <div style={{ width: '100%', height: '100vh', display: 'flex', flexDirection: 'column', fontFamily: G, background: 'radial-gradient(1200px 600px at 20% -10%, rgba(52,211,153,0.10), transparent), #0a0f0d', color: '#fff' }}>
      {/* 顶栏：窗口窄时整体换行成两行，标题文字不拆行 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, rowGap: 10, flexWrap: 'wrap', padding: '16px 20px 10px' }}>
        <div style={{ width: 40, height: 40, borderRadius: 14, background: 'rgba(52,211,153,0.12)', border: `1px solid ${EMERALD}33`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <CalendarIcon size={20} style={{ color: EMERALD }} />
        </div>
        <div style={{ flexShrink: 0 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0, letterSpacing: -0.3, whiteSpace: 'nowrap' }}>{t('sch.title')}</h1>
          <p style={{ fontSize: 11, color: MUTED, margin: 0, whiteSpace: 'nowrap' }}>{t('sch.subtitle')}</p>
        </div>

        <div style={{ marginLeft: 24, display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <button onClick={() => shift(-1)} style={iconBtn} title={t('sch.prev')}><ChevronLeft size={15} /></button>
          <div style={{ fontSize: 14, fontWeight: 600, minWidth: 110, textAlign: 'center', whiteSpace: 'nowrap' }}>{monthLabel}</div>
          <button onClick={() => shift(1)} style={iconBtn} title={t('sch.next')}><ChevronRight size={15} /></button>
          <button onClick={() => { setAnchor(new Date()); setSelectedDay(todayYmd()) }} style={{ ...pillBtn, marginLeft: 6, whiteSpace: 'nowrap' }}>{t('sch.today')}</button>
        </div>

        {/* 模块切换：日程 / 项目任务 */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <div style={{ display: 'flex', padding: 4, borderRadius: 999, background: 'rgba(255,255,255,0.06)', border: `1px solid ${EDGE}`, position: 'relative' }}>
            {(['schedule', 'projects'] as const).map(s => (
              <button key={s} onClick={() => setSection(s)}
                style={{ position: 'relative', padding: '6px 16px', borderRadius: 999, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: 'none', background: 'transparent', color: section === s ? '#fff' : MUTED, zIndex: 1 }}>
                {section === s && (
                  <motion.span layoutId="sch-section-pill"
                    style={{ position: 'absolute', inset: 0, borderRadius: 999, background: 'rgba(255,255,255,0.12)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.14)' }}
                    transition={{ type: 'spring', stiffness: 380, damping: 30 }} />
                )}
                <span style={{ position: 'relative', zIndex: 1, whiteSpace: 'nowrap' }}>{s === 'schedule' ? t('sch.sectionSchedule') : t('sch.sectionProjects')}</span>
              </button>
            ))}
          </div>

          {/* 视图切换 pill */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', padding: 4, borderRadius: 999, background: 'rgba(255,255,255,0.06)', border: `1px solid ${EDGE}`, position: 'relative' }}>
            {(['month', 'week', 'day'] as ViewMode[]).map(v => (
              <button key={v} onClick={() => setView(v)}
                style={{ position: 'relative', padding: '6px 14px', borderRadius: 999, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: 'none', background: 'transparent', color: view === v ? '#fff' : MUTED, zIndex: 1 }}>
                {view === v && (
                  <motion.span layoutId="sch-view-pill"
                    style={{ position: 'absolute', inset: 0, borderRadius: 999, background: 'rgba(255,255,255,0.12)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.14)' }}
                    transition={{ type: 'spring', stiffness: 380, damping: 30 }} />
                )}
                <span style={{ position: 'relative', zIndex: 1, whiteSpace: 'nowrap' }}>{v === 'month' ? t('sch.monthView') : v === 'week' ? t('sch.dayView') : t('sch.dayView')}</span>
              </button>
            ))}
          </div>
          <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value as any)}
            style={{ ...pillSelect, minWidth: 86 }}>
            <option value="all" style={{ background: '#101614' }}>{t('sch.allPriorities')}</option>
            {PRIORITIES.map(p => <option key={p} value={p} style={{ background: '#101614' }}>{p}</option>)}
          </select>
          <div style={{ position: 'relative' }}>
            <button onClick={() => setShowCreateMenu(m => !m)} style={primaryBtn}>
              <Plus size={14} /> {t('sch.new')}
            </button>
            <AnimatePresence>
              {showCreateMenu && (
                <motion.div initial={{ opacity: 0, y: 6, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4 }}
                  style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', width: 190, padding: 6, background: 'rgba(16,22,19,0.97)', border: `1px solid ${EDGE}`, borderRadius: 14, boxShadow: '0 18px 50px rgba(0,0,0,0.6)', zIndex: 40 }}>
                  <button onClick={() => { setShowCreateMenu(false); setSection('projects') }}
                    style={menuItem}>
                    <span style={{ width: 22, textAlign: 'center' }}>📝</span> {t('sch.newTask')}
                  </button>
                  <button onClick={() => { setShowCreateMenu(false); void quickDoc() }}
                    style={menuItem}>
                    <span style={{ width: 22, textAlign: 'center' }}>📄</span> {t('sch.quickDoc')}
                  </button>
                  <button onClick={() => { setShowCreateMenu(false); setModal({ ev: null, date: selectedDay }) }}
                    style={menuItem}>
                    <span style={{ width: 22, textAlign: 'center' }}>📅</span> {t('sch.bookEvent')}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <button onClick={doSync} disabled={syncing} style={ghostBtn} title={t('sch.syncTitle')}>
            <Clock size={13} /> {syncing ? '…' : t('sch.sync')}
          </button>
          <button onClick={() => window.deskAppAPI.scheduler.setBriefing(!briefing).then(r => { if (r?.ok) { setBriefing(!briefing); show(briefing ? t('sch.briefingOff') : t('sch.briefingOn')) } })}
            style={{ ...ghostBtn, color: briefing ? EMERALD : MUTED, border: briefing ? `1px solid ${EMERALD}55` : `1px solid ${EDGE}` }}
            title={t('sch.briefingTitle')}>
            ☀️ {briefing ? t('sch.briefingOn') : t('sch.briefingOff')}
          </button>
        </div>
        </div>
      </div>

      {/* 内容区 */}
      <div style={{ flex: 1, minHeight: 0, padding: '6px 20px 18px', overflowY: 'auto' }}>
        {section === 'projects' && (
          <ProjectsView onOpen={setOpenProject} />
        )}
        {section === 'schedule' && view === 'month' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
            {WEEKDAY_LABELS.map((w, i) => (
              <div key={w} style={{ textAlign: 'center', fontSize: 11, fontWeight: 600, padding: '6px 0', color: i >= 5 ? 'rgba(248,113,113,0.6)' : MUTED }}>{t('sch.weekday', { d: w })}</div>
            ))}
            {monthCells.map(d => {
              const ds = ymd(d)
              const inMonth = d.getMonth() === anchor.getMonth()
              const dayEvents = byDate[ds] || []
              const isToday = ds === todayYmd()
              const isSelected = ds === selectedDay
              return (
                <div key={ds} onClick={() => setSelectedDay(ds)}
                  onDoubleClick={() => { setSelectedDay(ds); setAnchor(new Date(d.getFullYear(), d.getMonth(), d.getDate())); setView('day') }}
                  style={{
                    minHeight: 92, borderRadius: 12, padding: 6, cursor: 'pointer',
                    background: isSelected ? 'rgba(52,211,153,0.10)' : inMonth ? GLASS : 'rgba(255,255,255,0.02)',
                    border: `1px solid ${isToday ? EMERALD + '66' : isSelected ? EMERALD + '44' : EDGE}`,
                    boxShadow: isToday ? `0 0 12px rgba(52,211,153,0.15)` : 'none',
                    opacity: inMonth ? 1 : 0.45,
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 12, fontWeight: isToday ? 800 : 500, color: isToday ? EMERALD : 'rgba(255,255,255,0.75)' }}>{d.getDate()}</span>
                    {dayEvents.length > 0 && <span style={{ fontSize: 9, color: MUTED }}>{dayEvents.length}</span>}
                  </div>
                  <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {dayEvents.slice(0, 3).map(e => (
                      <div key={e.id} onClick={(ev) => { ev.stopPropagation(); setModal({ ev: e, date: ds }) }}
                        style={{ fontSize: 9.5, padding: '2px 5px', borderRadius: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer',
                          background: 'rgba(255,255,255,0.05)', borderLeft: `2px solid ${PRIORITY_STYLE[e.priority].dot}`, color: 'rgba(255,255,255,0.8)' }}>
                        {fmtHour(e.startHour)} {e.title}
                      </div>
                    ))}
                    {dayEvents.length > 3 && <div style={{ fontSize: 9, color: MUTED }}>+{dayEvents.length - 3}</div>}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {section === 'schedule' && view === 'week' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
            {weekDays.map(d => {
              const ds = ymd(d)
              const dayEvents = byDate[ds] || []
              const isToday = ds === todayYmd()
              return (
                <div key={ds} onClick={() => setSelectedDay(ds)}
                  style={{ minHeight: 420, borderRadius: 12, padding: 8, cursor: 'pointer',
                    background: isToday ? 'rgba(52,211,153,0.08)' : GLASS, border: `1px solid ${isToday ? EMERALD + '66' : EDGE}` }}>
                  <div style={{ textAlign: 'center', fontSize: 12, fontWeight: 600, color: isToday ? EMERALD : 'rgba(255,255,255,0.7)' }}>
                    {d.getMonth() + 1}/{d.getDate()}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 8 }}>
                    {dayEvents.sort((a, b) => a.startHour - b.startHour).map(e => (
                      <div key={e.id} onClick={(ev) => { ev.stopPropagation(); setModal({ ev: e, date: ds }) }}
                        style={{ padding: '7px 9px', borderRadius: 9, cursor: 'pointer',
                          background: 'rgba(255,255,255,0.05)', border: `1px solid ${EDGE}`, borderLeft: `3px solid ${PRIORITY_STYLE[e.priority].dot}` }}>
                        <div style={{ fontSize: 10.5, fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>{e.title}</div>
                        <div style={{ fontSize: 9.5, color: MUTED, marginTop: 2 }}>
                          {fmtHour(e.startHour)} – {fmtHour(e.endHour)}
                          {e.room ? ` · ${e.room}` : ''}
                        </div>
                        {e.attendees.length > 0 && <div style={{ fontSize: 9, color: MUTED, marginTop: 2 }}>{e.attendees.join('、')}</div>}
                      </div>
                    ))}
                    {dayEvents.length === 0 && <div style={{ fontSize: 10, color: MUTED, textAlign: 'center', paddingTop: 24 }}>{t('sch.noEvents')}</div>}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {section === 'schedule' && view === 'day' && (
          <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <button onClick={() => shift(-1)} style={iconBtn} title={t('sch.prevDay')}><ChevronLeft size={14} /></button>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: '#fff' }}>{dayLabel(selectedDay)}</span>
            <button onClick={() => shift(1)} style={iconBtn} title={t('sch.nextDay')}><ChevronRight size={14} /></button>
            <button onClick={() => { setAnchor(new Date()); setSelectedDay(todayYmd()) }} style={{ ...pillBtn, marginLeft: 4 }}>{t('sch.today')}</button>
            {byDate[selectedDay]?.length ? <span style={{ fontSize: 10.5, color: MUTED, marginLeft: 'auto' }}>{byDate[selectedDay].length} {t('sch.eventsCount')}</span> : null}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ width: 56, flexShrink: 0 }}>
              {HOURS.map(h => (
                <div key={h} style={{ height: HOUR_H, fontSize: 10, color: MUTED, textAlign: 'right', paddingRight: 8, borderTop: `1px solid rgba(255,255,255,0.05)` }}>{h}:00</div>
              ))}
            </div>
            <div style={{ flex: 1, position: 'relative', borderLeft: `1px solid ${EDGE}`, borderRadius: 12, background: GLASS }}
              onDragOver={e => e.preventDefault()}
              onDrop={async (e) => {
                e.preventDefault()
                if (!dragEv) return
                const rect = e.currentTarget.getBoundingClientRect()
                const hour = 8 + (e.clientY - rect.top) / HOUR_H
                const dur = Math.max(dragEv.endHour - dragEv.startHour, 0.5)
                const clamped = Math.min(Math.max(Math.round(hour * 2) / 2, 8), 19 - dur)
                await window.deskAppAPI.scheduler.updateEvent(dragEv.id, { startHour: clamped, endHour: clamped + dur })
                setDragEv(null)
                refresh()
                show(t('sch.saved'))
              }}>
              {HOURS.map(h => (
                <div key={h} style={{ height: HOUR_H, borderTop: `1px solid rgba(255,255,255,0.05)` }} />
              ))}
              {byDate[selectedDay]?.sort((a, b) => a.startHour - b.startHour).map(e => {
                const top = (e.startHour - 8) * HOUR_H
                const hgt = Math.max((e.endHour - e.startHour) * HOUR_H - 4, 22)
                const st = PRIORITY_STYLE[e.priority]
                const clash = byDate[selectedDay]?.some(o => o.id !== e.id && o.startHour < e.endHour && o.endHour > e.startHour)
                return (
                  <div key={e.id} onClick={() => setModal({ ev: e, date: selectedDay })}
                    draggable
                    onDragStart={() => setDragEv(e)}
                    title={clash ? t('sch.clash') : undefined}
                    style={{ position: 'absolute', left: 8, right: 8, top: top + 2, height: hgt, borderRadius: 9, cursor: 'grab',
                      background: `linear-gradient(135deg, ${st.dot}22, ${st.dot}0d)`, border: `1px solid ${clash ? 'rgba(248,113,113,0.6)' : st.dot + '44'}`, borderLeft: `3px solid ${clash ? '#f87171' : st.dot}`, padding: '4px 8px', overflow: 'hidden' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#fff' }}>{e.title}</div>
                    <div style={{ fontSize: 9.5, color: MUTED, marginTop: 1 }}>
                      {fmtHour(e.startHour)} – {fmtHour(e.endHour)}
                      {e.room ? ` · ${e.room}` : ''}
                    </div>
                    {e.attendees.length > 0 && hgt > 40 && <div style={{ fontSize: 9, color: MUTED, marginTop: 2 }}>{t('sch.attendees')}: {e.attendees.join('、')}</div>}
                    {e.status === '进行中' && <span style={{ position: 'absolute', top: 4, right: 8, fontSize: 8.5, padding: '1px 6px', borderRadius: 999, background: 'rgba(52,211,153,0.2)', color: EMERALD }}>{t('sch.live')}</span>}
                  </div>
                )
              })}
            </div>
          </div>
          </>
        )}
      </div>

      {/* 新建/编辑 Modal */}
      <AnimatePresence>
        {modal && (
          <EventModal
            ev={modal.ev}
            defaultDate={modal.date}
            onClose={() => setModal(null)}
            onSave={saveEvent}
            onDelete={modal.ev ? delEvent : undefined}
          />
        )}
      </AnimatePresence>

      {/* 项目详情弹窗 */}
      <AnimatePresence>
        {openProject && (
          <ProjectDetailModal
            project={openProject}
            onClose={() => setOpenProject(null)}
            onNewProject={() => { setOpenProject(null); setSection('projects') }}
            onAddEvent={() => { setOpenProject(null); setSection('schedule'); setModal({ ev: null, date: todayYmd() }) }}
          />
        )}
      </AnimatePresence>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: 'rgba(16,22,19,0.92)', border: `1px solid ${EMERALD}44`, borderRadius: 12, padding: '9px 20px', fontSize: 12, color: '#fff', boxShadow: '0 8px 30px rgba(0,0,0,0.5)', zIndex: 100 }}>
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── 样式 ──
const iconBtn: React.CSSProperties = { width: 30, height: 30, borderRadius: 999, background: 'rgba(255,255,255,0.06)', border: `1px solid ${EDGE}`, color: 'rgba(255,255,255,0.7)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }
const pillBtn: React.CSSProperties = { padding: '6px 14px', borderRadius: 999, background: 'rgba(255,255,255,0.06)', border: `1px solid ${EDGE}`, color: 'rgba(255,255,255,0.75)', fontSize: 11, cursor: 'pointer' }
const pillSelect: React.CSSProperties = { padding: '6px 10px', borderRadius: 999, background: 'rgba(255,255,255,0.06)', border: `1px solid ${EDGE}`, color: 'rgba(255,255,255,0.75)', fontSize: 11, cursor: 'pointer', outline: 'none' }
const primaryBtn: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 5, padding: '7px 16px', borderRadius: 999, background: 'linear-gradient(135deg, #6ee7b7, #34d399)', border: 'none', color: '#052e22', fontSize: 12, fontWeight: 700, cursor: 'pointer' }
const ghostBtn: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderRadius: 999, background: 'transparent', border: `1px solid ${EDGE}`, color: MUTED, fontSize: 11, cursor: 'pointer' }
const menuItem: React.CSSProperties = { width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 10, fontSize: 12, color: 'rgba(255,255,255,0.75)', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }

// ── 事件表单 Modal ──
function EventModal({ ev, defaultDate, onClose, onSave, onDelete }: {
  ev: SEvent | null
  defaultDate: string
  onClose: () => void
  onSave: (ev: SEvent) => void
  onDelete?: () => void
}): React.JSX.Element {
  const [f, setF] = useState({
    title: ev?.title ?? '',
    date: ev?.date ?? defaultDate,
    startTime: fmtHour(ev?.startHour ?? 9),
    endTime: fmtHour(ev?.endHour ?? 10),
    room: ev?.room ?? '',
    priority: ev?.priority ?? ('中' as '高' | '中' | '低'),
    attendees: ev?.attendees.join(', ') ?? '',
    status: ev?.status ?? ('待开始' as '待开始' | '进行中' | '已结束'),
    recurrence: ev?.recurrence ?? 'none',
  })
  const patch = (p: Partial<typeof f>): void => setF(x => ({ ...x, ...p }))
  const inputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', background: 'rgba(0,0,0,0.3)', border: `1px solid ${EDGE}`, borderRadius: 10, color: '#fff', fontSize: 12, padding: '8px 12px', outline: 'none' }

  const submit = (): void => {
    if (!f.title.trim()) return
    onSave({
      id: ev?.id ?? '', title: f.title.trim(), date: f.date,
      startHour: parseHour(f.startTime, 9), endHour: parseHour(f.endTime, 10),
      room: f.room, priority: f.priority,
      attendees: f.attendees.split(/[,，]/).map(s => s.trim()).filter(Boolean),
      status: f.status,
      recurrence: f.recurrence,
    })
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <motion.div initial={{ scale: 0.94, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        onClick={e => e.stopPropagation()}
        style={{ width: 440, maxWidth: '92vw', background: 'rgba(16,22,19,0.96)', border: `1px solid ${EDGE}`, borderRadius: 20, padding: 20, boxShadow: '0 24px 70px rgba(0,0,0,0.6)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{ev ? t('sch.editEvent') : t('sch.newEvent')}</h3>
          <button onClick={onClose} style={{ ...iconBtn, width: 26, height: 26 }}><X size={13} /></button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input style={inputStyle} placeholder={t('sch.titlePh')} value={f.title} onChange={e => patch({ title: e.target.value })} autoFocus />
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={label}>{t('sch.date')}</label>
              <input type="date" style={inputStyle} value={f.date} onChange={e => patch({ date: e.target.value })} />
            </div>
            <div style={{ width: 110 }}>
              <label style={label}>{t('sch.recurrence')}</label>
              <select style={inputStyle} value={f.recurrence} onChange={e => patch({ recurrence: e.target.value })} disabled={!!ev}>
                {(['none', 'daily', 'weekly', 'monthly'] as const).map(r2 => <option key={r2} value={r2} style={{ background: '#101614' }}>{t('sch.rec.' + r2)}</option>)}
              </select>
            </div>
            <div style={{ width: 110 }}>
              <label style={label}>{t('sch.priority')}</label>
              <select style={inputStyle} value={f.priority} onChange={e => patch({ priority: e.target.value as any })}>
                {PRIORITIES.map(p => <option key={p} value={p} style={{ background: '#101614' }}>{p}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={label}>{t('sch.start')}</label>
              <input type="time" style={inputStyle} value={f.startTime} onChange={e => patch({ startTime: e.target.value })} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={label}>{t('sch.end')}</label>
              <input type="time" style={inputStyle} value={f.endTime} onChange={e => patch({ endTime: e.target.value })} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={label}><MapPin size={11} style={{ verticalAlign: -1, marginRight: 3 }} />{t('sch.room')}</label>
              <input style={inputStyle} placeholder={t('sch.roomPh')} value={f.room} onChange={e => patch({ room: e.target.value })} />
            </div>
            <div style={{ width: 130 }}>
              <label style={label}>{t('sch.status')}</label>
              <select style={inputStyle} value={f.status} onChange={e => patch({ status: e.target.value as any })}>
                {STATUSES.map(s => <option key={s} value={s} style={{ background: '#101614' }}>{s}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label style={label}><Users size={11} style={{ verticalAlign: -1, marginRight: 3 }} />{t('sch.attendees')}</label>
            <input style={inputStyle} placeholder={t('sch.attendeesPh')} value={f.attendees} onChange={e => patch({ attendees: e.target.value })} />
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 18 }}>
          {onDelete
            ? <button onClick={onDelete} style={{ padding: '8px 14px', borderRadius: 10, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', color: '#f87171', fontSize: 12, cursor: 'pointer' }}>{t('sch.delete')}</button>
            : <span />}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={{ padding: '8px 18px', borderRadius: 10, background: 'transparent', border: `1px solid ${EDGE}`, color: MUTED, fontSize: 12, cursor: 'pointer' }}>{t('sch.cancel')}</button>
            <button onClick={submit} disabled={!f.title.trim()} style={{ padding: '8px 18px', borderRadius: 10, background: 'linear-gradient(135deg, #6ee7b7, #34d399)', border: 'none', color: '#052e22', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: f.title.trim() ? 1 : 0.4 }}>{t('sch.save')}</button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}

const label: React.CSSProperties = { display: 'block', fontSize: 10.5, color: MUTED, marginBottom: 4 }
