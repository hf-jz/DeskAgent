// ── WorkspaceApp: wenxibuddy-style sidebar (创建任务/查看任务/任务进度/任务模版)
//    + per-view content. Shared spec/status/job state, toast, template instantiation.
import React, { useCallback, useEffect, useState } from 'react'
import { t } from '../lib/i18n'
import { motion, AnimatePresence } from 'framer-motion'
import { PlusCircle, ListChecks, CalendarRange, LayoutTemplate, ChevronRight, CheckCircle } from 'lucide-react'
import type { WindowSpec, SpecStatus } from '../../../shared/gen-ui-types'
import type { TaskTemplate } from './templates'
import { specFromTemplate } from './templates'
import CreateTaskView from './views/CreateTaskView'
import TasksView from './views/TasksView'
import ProgressView from './views/ProgressView'
import TemplatesView from './views/TemplatesView'
import { G } from './views/style'

type View = 'create' | 'tasks' | 'progress' | 'templates'

const NAV = (): { id: View; label: string; icon: React.FC<{ size?: number | string }> }[] => [
  { id: 'create', label: t('ws.tab.create'), icon: PlusCircle },
  { id: 'tasks', label: t('ws.tab.tasks'), icon: ListChecks },
  { id: 'progress', label: t('ws.tab.progress'), icon: CalendarRange },
  { id: 'templates', label: t('ws.tab.templates'), icon: LayoutTemplate },
]

function TITLES(): Record<View, { title: string; sub: string }> {
  return {
    create: { title: t('ws.tab.create'), sub: t('ws.create.sub') },
    tasks: { title: t('ws.tab.tasks'), sub: t('ws.tasks.sub') },
    progress: { title: t('ws.tab.progress'), sub: t('ws.progress.sub') },
    templates: { title: t('ws.tab.templates'), sub: t('ws.templates.sub') },
  }
}

const spring = { type: 'spring' as const, stiffness: 380, damping: 32 }

export default function WorkspaceApp() {
  const [view, setView] = useState<View>('create')
  const [specs, setSpecs] = useState<WindowSpec[]>([])
  const [statusMap, setStatusMap] = useState<Record<string, SpecStatus>>({})
  const [jobs, setJobs] = useState<any[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const notify = (msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 2400)
  }

  const load = useCallback(async () => {
    const [s, st, j] = await Promise.all([
      window.deskAppAPI?.genui?.listSpecs() ?? Promise.resolve([]),
      window.deskAppAPI?.genui?.listStatuses() ?? Promise.resolve([]),
      window.deskAppAPI?.listCronJobs?.() ?? Promise.resolve([]),
    ])
    setSpecs(s)
    setStatusMap(Object.fromEntries(st.map(x => [x.specId, x])))
    setJobs(j)
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const u1 = window.deskAppAPI?.onSpecChanged?.((s) => {
      setSpecs(prev => { const i = prev.findIndex(x => x.id === s.id); return i >= 0 ? prev.map(x => x.id === s.id ? s : x) : [...prev, s] })
    })
    const u2 = window.deskAppAPI?.onSpecRemoved?.((id) => {
      setSpecs(prev => prev.filter(x => x.id !== id))
      setSelectedId(cur => cur === id ? null : cur)
    })
    const u3 = window.deskAppAPI?.onStatusChanged?.((st) => {
      setStatusMap(prev => ({ ...prev, [st.specId]: st }))
      load() // a run creates a cron job — refresh next_run/last_run
    })
    return () => { u1?.(); u2?.(); u3?.() }
  }, [load])

  // ── Actions ──
  const handleCreate = async (text: string) => {
    setCreating(true)
    try {
      const result = await window.deskAppAPI?.genui?.modifySpec?.('', text)
      if (result?.spec?.id) {
        setSelectedId(result.spec.id)
        setView('tasks')
        notify(t('ws.notify.created'))
      } else {
        notify(result?.error ? t('ws.notify.createFail', { err: result.error }) : t('ws.notify.createFailRetry'))
      }
    } catch { notify(t('ws.notify.createFail2')) }
    finally { setCreating(false) }
  }

  const handleUseTemplate = async (t: TaskTemplate) => {
    const spec = specFromTemplate(t)
    const res = await window.deskAppAPI?.genui?.saveSpec?.(spec)
    if (res && res.ok === false) { notify(t('ws.notify.createFail', { err: res.error })); return }
    setSelectedId(spec.id)
    setView('tasks')
    notify(t('ws.notify.taskCreated', { name: t.name }))
  }

  const handleRun = async (id: string) => {
    const res = await window.deskAppAPI?.genui?.runSpec(id)
    if (res && res.ok === false) notify(res.error || t('ws.notify.runFail'))
    else { notify(t('ws.notify.running')); load() }
  }

  const handleStop = async (id: string) => {
    await window.deskAppAPI?.genui?.stopSpec(id)
    notify(t('ws.notify.stopped'))
    load()
  }

  const handleDelete = async (id: string) => {
    await window.deskAppAPI?.genui?.removeSpec(id)
    notify(t('ws.notify.deleted'))
    load()
  }

  const runningCount = specs.filter(s => statusMap[s.id]?.status === 'running').length
  const scheduledCount = specs.filter(s => s.cron).length

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#05070c', position: 'relative', color: 'rgba(255,255,255,0.92)', fontFamily: G, overflow: 'hidden' }}>
      {/* Emerald glow blobs */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', left: '12%', top: '28%', width: '55%', height: '65%', background: 'rgba(34,197,94,0.10)', filter: 'blur(90px)', borderRadius: '50%' }} />
        <div style={{ position: 'absolute', right: '4%', top: '8%', width: 200, height: 200, background: 'rgba(56,189,248,0.08)', filter: 'blur(70px)', borderRadius: '50%' }} />
      </div>

      {/* ── Sidebar (wenxibuddy liquid-glass nav) ── */}
      <aside style={{
        width: 196, flexShrink: 0, zIndex: 1,
        background: 'rgba(255,255,255,0.03)', backdropFilter: 'blur(30px)', WebkitBackdropFilter: 'blur(30px)',
        borderRight: '1px solid rgba(255,255,255,0.07)',
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        padding: '14px 10px 12px', userSelect: 'none',
      }}>
        <div>
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '2px 6px 16px' }}>
            <div style={{
              width: 32, height: 32, borderRadius: 11, flexShrink: 0,
              background: 'linear-gradient(135deg, #6ee7b7, #34d399 45%, #14b8a6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 800, fontSize: 12, color: '#04120c',
              boxShadow: '0 0 20px rgba(16,185,129,0.45)', border: '1px solid rgba(255,255,255,0.4)',
            }}>DA</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: '#fff', letterSpacing: '0.2px', whiteSpace: 'nowrap' }}>DeskApp 任务台</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>Task Workspace</div>
            </div>
          </div>

          {/* Nav */}
          <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {NAV().map(item => {
              const Icon = item.icon
              const active = view === item.id
              return (
                <button key={item.id} onClick={() => setView(item.id)}
                  style={{
                    position: 'relative', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '9px 11px', borderRadius: 12, background: 'transparent', border: 'none',
                    fontSize: 12.5, fontWeight: 500, cursor: 'pointer', fontFamily: G, textAlign: 'left',
                    color: active ? '#fff' : 'rgba(255,255,255,0.45)',
                  }}>
                  {active && (
                    <motion.div layoutId="ws-nav-pill"
                      style={{ position: 'absolute', inset: 0, borderRadius: 12, background: 'rgba(52,211,153,0.13)', border: '1px solid rgba(52,211,153,0.35)', boxShadow: '0 0 16px rgba(16,185,129,0.12)' }}
                      transition={spring} />
                  )}
                  {!active && <span style={{ position: 'absolute', inset: 0, borderRadius: 12, opacity: 0, background: 'rgba(255,255,255,0.04)', transition: 'opacity 0.2s' }} className="ws-nav-hover" />}
                  <span style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 9 }}>
                    <Icon size={14} strokeWidth={1.75} style={{ color: active ? '#34d399' : 'rgba(255,255,255,0.4)' }} />
                    <span>{item.label}</span>
                  </span>
                  {active && <ChevronRight size={13} style={{ position: 'relative', zIndex: 1, color: 'rgba(52,211,153,0.8)' }} />}
                </button>
              )
            })}
          </nav>
        </div>

        {/* Bottom stats */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{
            padding: '10px 12px', borderRadius: 14,
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
          }}>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginBottom: 8 }}>{t('ws.overview')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                <span style={{ color: 'rgba(255,255,255,0.5)' }}>{t('ws.taskWindows')}</span>
                <span style={{ color: '#fff', fontWeight: 600 }}>{specs.length}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                <span style={{ color: 'rgba(255,255,255,0.5)' }}>{t('ws.schedules')}</span>
                <span style={{ color: '#fff', fontWeight: 600 }}>{scheduledCount}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                <span style={{ color: 'rgba(255,255,255,0.5)' }}>{t('ws.running')}</span>
                <span style={{ color: '#34d399', fontWeight: 700 }}>{runningCount}</span>
              </div>
            </div>
          </div>
          <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.25)', padding: '0 4px', lineHeight: 1.5 }}>
            {t('ws.hint')}
          </div>
        </div>
      </aside>

      {/* ── Content ── */}
      <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', zIndex: 1, overflow: 'hidden' }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px 8px' }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: '#fff' }}>{TITLES()[view].title}</div>
            <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>{TITLES()[view].sub}</div>
          </div>
          <AnimatePresence>
            {toast && (
              <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 999, background: 'rgba(52,211,153,0.16)', border: '1px solid rgba(52,211,153,0.4)', color: '#34d399', fontSize: 11.5, fontWeight: 600 }}>
                <CheckCircle size={13} /> {toast}
              </motion.div>
            )}
          </AnimatePresence>
        </header>

        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 20px 20px' }}>
          <AnimatePresence mode="wait">
            <motion.div key={view} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
              {view === 'create' && (
                <CreateTaskView
                  creating={creating}
                  onCreate={handleCreate}
                  onUseTemplate={handleUseTemplate}
                  onGoTemplates={() => setView('templates')}
                />
              )}
              {view === 'tasks' && (
                <TasksView
                  specs={specs} statusMap={statusMap} jobs={jobs}
                  selectedId={selectedId} onSelect={setSelectedId}
                  onRun={handleRun} onStop={handleStop} onDelete={handleDelete}
                  onNewTask={() => setView('create')}
                />
              )}
              {view === 'progress' && <ProgressView specs={specs} statusMap={statusMap} />}
              {view === 'templates' && <TemplatesView onUse={handleUseTemplate} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  )
}
