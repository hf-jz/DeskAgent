import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { X, Plus, ChevronDown, Calendar as CalendarIcon, FolderPlus } from 'lucide-react'
import { t } from '../lib/i18n'
import TaskTimeline from './TaskTimeline'

const G = 'Plus Jakarta Sans, PingFang SC, -apple-system, BlinkMacSystemFont, sans-serif'
const EMERALD = '#34d399'
const MUTED = 'rgba(255,255,255,0.45)'
const EDGE = 'rgba(255,255,255,0.14)'

const PHASES = ['需求评审', '产品设计', '开发实现', '测试验证'] as const
const TASK_STATUSES = ['待处理', '进行中', '已完成', '阻塞'] as const
const PRIORITIES = ['高', '中', '低'] as const

const PHASE_STYLE: Record<string, string> = {
  '需求评审': 'rgba(52,211,153,0.9)',
  '产品设计': '#38bdf8',
  '开发实现': '#a78bfa',
  '测试验证': '#f59e0b',
}
const STATUS_STYLE: Record<string, { c: string; bg: string }> = {
  '待处理': { c: 'rgba(255,255,255,0.55)', bg: 'rgba(255,255,255,0.06)' },
  '进行中': { c: EMERALD, bg: 'rgba(52,211,153,0.12)' },
  '已完成': { c: 'rgba(255,255,255,0.35)', bg: 'rgba(255,255,255,0.05)' },
  '阻塞': { c: '#f87171', bg: 'rgba(248,113,113,0.12)' },
}
const PRIORITY_STYLE: Record<string, { c: string; bg: string }> = {
  '高': { c: EMERALD, bg: 'rgba(52,211,153,0.12)' },
  '中': { c: '#7dd3fc', bg: 'rgba(56,189,248,0.10)' },
  '低': { c: 'rgba(255,255,255,0.5)', bg: 'rgba(255,255,255,0.05)' },
}

export default function ProjectDetailModal({ project, onClose, onNewProject, onAddEvent }: {
  project: any
  onClose: () => void
  onNewProject: () => void
  onAddEvent: () => void
}): React.JSX.Element {
  const [tasks, setTasks] = useState<any[]>([])
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [tab, setTab] = useState<'all' | 'mine' | 'joined'>('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState<any | null>(null)   // 正在编辑的任务（null=关闭, {new:true}=新建）
  const [form, setForm] = useState<any>(null)

  const refresh = useCallback(() => {
    window.deskAppAPI.scheduler.listTasks(project.id).then(setTasks).catch(() => {})
  }, [project.id])
  useEffect(() => { refresh() }, [refresh])

  const filtered = useMemo(() => tasks.filter(x => statusFilter === 'all' || x.status === statusFilter), [tasks, statusFilter])
  const selected = tasks.find(x => x.id === selectedId) || null
  // 依赖任务: dependsOn 列表里任一未完成 → 视为被阻塞（仅标记展示，不强制改状态）
  const depsOf = (x: any): any[] => ((x.dependsOn || '') as string).split(',').filter(Boolean).map(id => tasks.find(t => t.id === id)).filter(Boolean)
  const isBlockedByDep = (x: any): boolean => depsOf(x).some((d: any) => d.status !== '已完成')

  const milestones = useMemo(() => project.milestones || [], [project])
  const kpi = useMemo(() => ({
    total: tasks.length,
    done: tasks.filter(x => x.status === '已完成').length,
    running: tasks.filter(x => x.status === '进行中').length,
    blocked: tasks.filter(x => x.status === '阻塞').length,
    milestones: `${milestones.filter((m: any) => m.done).length}/${milestones.length}`,
  }), [tasks, milestones])

  const openNew = (): void => {
    setEditing({ new: true })
    setForm({ title: '', phase: '需求评审', status: '待处理', priority: '中', start: '', end: '', assignee: '', desc: '', dependsOn: '' })
  }
  const openEdit = (x: any): void => {
    setEditing(x)
    setForm({ title: x.title, phase: x.phase, status: x.status, priority: x.priority, start: x.start, end: x.end, assignee: x.assignee, desc: x.desc, dependsOn: x.dependsOn || '' })
  }
  const saveTask = async (): Promise<void> => {
    if (!form?.title?.trim() || !editing) return
    const payload = { projectId: project.id, ...form, title: form.title.trim() }
    if (editing.new) await window.deskAppAPI.scheduler.createTask(payload)
    else await window.deskAppAPI.scheduler.updateTask(editing.id, payload)
    setEditing(null)
    refresh()
  }
  const delTask = async (): Promise<void> => {
    if (!editing || editing.new) return
    await window.deskAppAPI.scheduler.deleteTask(editing.id)
    setEditing(null)
    setSelectedId(null)
    refresh()
  }

  const input: React.CSSProperties = { width: '100%', boxSizing: 'border-box', background: 'rgba(0,0,0,0.3)', border: `1px solid ${EDGE}`, borderRadius: 10, color: '#fff', fontSize: 12, padding: '7px 11px', outline: 'none' }
  const label: React.CSSProperties = { display: 'block', fontSize: 10.5, color: MUTED, marginBottom: 3 }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, fontFamily: G }}>
      <motion.div initial={{ scale: 0.95, y: 14 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.97, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 360, damping: 32 }}
        style={{ width: 980, maxWidth: '94vw', height: '86vh', display: 'flex', flexDirection: 'column', background: 'rgba(13,18,16,0.98)', border: `1px solid ${EDGE}`, borderRadius: 22, boxShadow: '0 30px 90px rgba(0,0,0,0.7)', overflow: 'hidden' }}>

        {/* 头部：项目名 + 健康度 + 操作 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 20px 12px', borderBottom: `1px solid ${EDGE}` }}>
          <div style={{ width: 42, height: 42, borderRadius: 13, background: 'rgba(52,211,153,0.12)', border: `1px solid ${EMERALD}33`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>📊</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{project.name}</div>
            <div style={{ fontSize: 11, color: MUTED, marginTop: 1 }}>
              {project.phase ? `${project.phase} · ` : ''}{project.deadline ? `${t('prj.deadline')}: ${project.deadline}` : ''}{project.desc ? ` · ${project.desc.slice(0, 60)}` : ''}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: EMERALD, fontFamily: 'ui-monospace, monospace' }}>{project.health || 0}</div>
              <div style={{ fontSize: 9.5, color: MUTED }}>{t('prj.health')}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#f59e0b', fontFamily: 'ui-monospace, monospace' }}>{milestones.filter((m: any) => m.done).length}/{milestones.length}</div>
              <div style={{ fontSize: 9.5, color: MUTED }}>{t('prj.kpiMilestone')}</div>
            </div>
            <div style={{ width: 64, height: 64, borderRadius: '50%', border: '4px solid rgba(52,211,153,0.8)', borderTopColor: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>{project.health || 0}</div>
          </div>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 999, background: 'rgba(255,255,255,0.06)', border: `1px solid ${EDGE}`, color: 'rgba(255,255,255,0.7)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={14} /></button>
        </div>

        {/* KPI 行 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, padding: '12px 20px' }}>
          {[
            { label: t('prj.kpiTotal'), value: kpi.total, c: '#fff' },
            { label: t('prj.kpiDone'), value: kpi.done, c: 'rgba(255,255,255,0.5)' },
            { label: t('prj.kpiRunning'), value: kpi.running, c: EMERALD },
            { label: t('prj.kpiBlocked'), value: kpi.blocked, c: kpi.blocked ? '#f87171' : 'rgba(255,255,255,0.5)' },
            { label: t('prj.kpiMilestone'), value: kpi.milestones, c: '#f59e0b' },
          ].map(k => (
            <div key={k.label} style={{ padding: '10px 14px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: `1px solid ${EDGE}`, textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: k.c }}>{k.value}</div>
              <div style={{ fontSize: 10, color: MUTED, marginTop: 1 }}>{k.label}</div>
            </div>
          ))}
        </div>

        {/* 主体：看板（左） + 详情（右） */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 12, padding: '0 20px' }}>
          {/* 左：任务看板 */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', padding: 3, borderRadius: 999, background: 'rgba(255,255,255,0.05)', border: `1px solid ${EDGE}` }}>
                {(['all', 'mine', 'joined'] as const).map(tb => (
                  <button key={tb} onClick={() => setTab(tb)}
                    style={{ padding: '4px 12px', borderRadius: 999, fontSize: 10.5, cursor: 'pointer', border: 'none', background: tab === tb ? 'rgba(255,255,255,0.14)' : 'transparent', color: tab === tb ? '#fff' : MUTED, fontWeight: tab === tb ? 600 : 400 }}>
                    {tb === 'all' ? t('prj.tabAll') : tb === 'mine' ? t('prj.tabMine') : t('prj.tabJoined')}
                  </button>
                ))}
              </div>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ padding: '4px 9px', borderRadius: 999, background: 'rgba(255,255,255,0.05)', border: `1px solid ${EDGE}`, color: 'rgba(255,255,255,0.7)', fontSize: 10.5, cursor: 'pointer', outline: 'none' }}>
                <option value="all" style={{ background: '#0d1210' }}>{t('prj.filterStatus')}</option>
                {TASK_STATUSES.map(s => <option key={s} value={s} style={{ background: '#0d1210' }}>{s}</option>)}
              </select>
              <button onClick={openNew} style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, padding: '5px 12px', borderRadius: 999, background: 'linear-gradient(135deg, #6ee7b7, #34d399)', border: 'none', color: '#052e22', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                <Plus size={12} /> {t('prj.newTask')}
              </button>
            </div>

            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {PHASES.map(ph => {
                const group = filtered.filter(x => x.phase === ph)
                const isCollapsed = collapsed[ph]
                return (
                  <div key={ph} style={{ borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: `1px solid ${EDGE}`, overflow: 'hidden' }}>
                    <button onClick={() => setCollapsed(p => ({ ...p, [ph]: !p[ph] }))}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer', color: '#fff' }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: PHASE_STYLE[ph], boxShadow: `0 0 8px ${PHASE_STYLE[ph]}` }} />
                      <span style={{ fontSize: 12.5, fontWeight: 700 }}>{ph}</span>
                      <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 6, fontFamily: 'ui-monospace, monospace', color: PHASE_STYLE[ph], background: `${PHASE_STYLE[ph]}1a`, border: `1px solid ${PHASE_STYLE[ph]}33` }}>{group.length}</span>
                      <motion.span animate={{ rotate: isCollapsed ? -90 : 0 }} style={{ marginLeft: 'auto', color: 'rgba(255,255,255,0.35)' }}><ChevronDown size={13} /></motion.span>
                    </button>
                    {!isCollapsed && (
                      <div style={{ borderTop: `1px solid ${EDGE}`, padding: 4 }}>
                        {group.length === 0 && <div style={{ padding: '10px 0', textAlign: 'center', fontSize: 10.5, color: 'rgba(255,255,255,0.25)' }}>{t('prj.noTasksInPhase')}</div>}
                        {group.map(x => {
                          const sel = selectedId === x.id
                          const st = STATUS_STYLE[x.status] || STATUS_STYLE['待处理']
                          const pr = PRIORITY_STYLE[x.priority] || PRIORITY_STYLE['中']
                          const depBlocked = isBlockedByDep(x) && x.status !== '已完成'
                          return (
                            <div key={x.id} onClick={() => setSelectedId(x.id)} onDoubleClick={() => openEdit(x)}
                              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 9, cursor: 'pointer', background: sel ? 'rgba(52,211,153,0.08)' : 'transparent', borderLeft: sel ? `2px solid ${EMERALD}` : '2px solid transparent' }}>
                              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', fontFamily: 'ui-monospace, monospace', flexShrink: 0 }}>{x.id.slice(4, 10)}</span>
                              <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: sel ? '#fff' : 'rgba(255,255,255,0.8)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {x.title}
                                {depBlocked && <span title={t('prj.depBlocked')} style={{ marginLeft: 5, fontSize: 9, color: '#f87171' }}>⛓</span>}
                              </span>
                              {x.start && <span style={{ fontSize: 9.5, color: MUTED, fontFamily: 'ui-monospace, monospace', flexShrink: 0 }}>{x.start.slice(5)}</span>}
                              <span style={{ fontSize: 9.5, padding: '1px 7px', borderRadius: 999, color: pr.c, background: pr.bg, flexShrink: 0 }}>{x.priority}</span>
                              <span style={{ fontSize: 9.5, padding: '1px 7px', borderRadius: 999, color: st.c, background: st.bg, flexShrink: 0 }}>{x.status}</span>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
              {filtered.length === 0 && tasks.length === 0 && (
                <div style={{ padding: '40px 0', textAlign: 'center', fontSize: 11.5, color: 'rgba(255,255,255,0.3)' }}>
                  {t('prj.emptyTasks')}
                </div>
              )}
            </div>
          </div>

          {/* 右：任务详情 */}
          <div style={{ width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0, overflowY: 'auto' }}>
            {selected ? (
              <>
                <div style={{ padding: 14, borderRadius: 14, background: 'rgba(255,255,255,0.04)', border: `1px solid ${EDGE}` }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{selected.title}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
                    <span style={chip(STATUS_STYLE[selected.status] || STATUS_STYLE['待处理'])}>{selected.status}</span>
                    <span style={chip(PRIORITY_STYLE[selected.priority] || PRIORITY_STYLE['中'])}>{selected.priority}</span>
                    <span style={chip({ c: PHASE_STYLE[selected.phase] || '#fff', bg: 'rgba(255,255,255,0.05)' })}>{selected.phase}</span>
                  </div>
                  {selected.start && <div style={{ fontSize: 11, color: MUTED, marginBottom: 4 }}>{t('prj.range', { s: selected.start, e: selected.end || '—' })}</div>}
                  {selected.assignee && <div style={{ fontSize: 11, color: MUTED }}>{t('prj.assignee')}: {selected.assignee}</div>}
                  {(() => { const ds = depsOf(selected); return ds.length > 0 && (
                    <div style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>{t('prj.dependsOn')}: {ds.map((d: any) => `${d.title}${d.status !== '已完成' ? '（未完成）' : ''}`).join('、')}</div>
                  ) })()}
                  {selected.desc && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 8, lineHeight: 1.6 }}>{selected.desc}</div>}
                  <button onClick={() => openEdit(selected)} style={{ width: '100%', marginTop: 12, padding: '7px 0', borderRadius: 10, background: 'rgba(52,211,153,0.12)', border: `1px solid ${EMERALD}44`, color: EMERALD, fontSize: 11.5, cursor: 'pointer' }}>{t('prj.editTask')}</button>
                </div>
                <div style={{ padding: 12, borderRadius: 14, background: 'rgba(255,255,255,0.02)', border: `1px solid ${EDGE}` }}>
                  <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: 'rgba(255,255,255,0.7)' }}>{t('prj.aiHint')}</div>
                  <div style={{ fontSize: 10.5, color: MUTED, lineHeight: 1.7 }}>
                    {t('prj.aiHintBody')}
                  </div>
                </div>
              </>
            ) : (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11.5, color: 'rgba(255,255,255,0.25)' }}>
                {t('prj.selectHint')}
              </div>
            )}
          </div>
        </div>

        {/* 底部：时间线 */}
        <div style={{ padding: '12px 20px 16px', borderTop: `1px solid ${EDGE}` }}>
          <TaskTimeline tasks={tasks} onSelect={setSelectedId} />
        </div>

        {/* 底部操作条 */}
        <div style={{ display: 'flex', gap: 8, padding: '0 20px 16px', alignItems: 'center' }}>
          <button onClick={onNewProject} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 14px', borderRadius: 10, background: 'transparent', border: `1px solid ${EDGE}`, color: MUTED, fontSize: 11.5, cursor: 'pointer' }}>
            <FolderPlus size={13} /> {t('prj.newProject')}
          </button>
          <button onClick={onAddEvent} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 14px', borderRadius: 10, background: 'transparent', border: `1px solid ${EDGE}`, color: MUTED, fontSize: 11.5, cursor: 'pointer' }}>
            <CalendarIcon size={13} /> {t('prj.addEvent')}
          </button>
          <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.3)' }}>{t('prj.bottomHint')}</span>
        </div>
      </motion.div>

      {/* 任务编辑 modal */}
      {editing && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          onClick={() => setEditing(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 70 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ width: 460, background: 'rgba(16,22,19,0.98)', border: `1px solid ${EDGE}`, borderRadius: 18, padding: 20, boxShadow: '0 24px 70px rgba(0,0,0,0.6)' }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>{editing.new ? t('prj.newTask') : t('prj.editTask')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input style={input} placeholder={t('prj.taskTitlePh')} value={form?.title ?? ''} onChange={e => setForm(x => ({ ...x, title: e.target.value }))} autoFocus />
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={label}>{t('prj.phase')}</label>
                  <select style={input} value={form?.phase ?? ''} onChange={e => setForm(x => ({ ...x, phase: e.target.value }))}>
                    {PHASES.map(p => <option key={p} value={p} style={{ background: '#101614' }}>{p}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={label}>{t('prj.status')}</label>
                  <select style={input} value={form?.status ?? ''} onChange={e => setForm(x => ({ ...x, status: e.target.value }))}>
                    {TASK_STATUSES.map(s => <option key={s} value={s} style={{ background: '#101614' }}>{s}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={label}>{t('prj.priority')}</label>
                  <select style={input} value={form?.priority ?? ''} onChange={e => setForm(x => ({ ...x, priority: e.target.value }))}>
                    {PRIORITIES.map(p => <option key={p} value={p} style={{ background: '#101614' }}>{p}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={label}>{t('prj.start')}</label>
                  <input type="date" style={input} value={form?.start ?? ''} onChange={e => setForm(x => ({ ...x, start: e.target.value }))} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={label}>{t('prj.end')}</label>
                  <input type="date" style={input} value={form?.end ?? ''} onChange={e => setForm(x => ({ ...x, end: e.target.value }))} />
                </div>
              </div>
              <div>
                <label style={label}>{t('prj.assignee')}</label>
                <input style={input} value={form?.assignee ?? ''} onChange={e => setForm(x => ({ ...x, assignee: e.target.value }))} />
              </div>
              <div>
                <label style={label}>{t('prj.dependsOn')}</label>
                <select multiple size={3} style={{ ...input, height: 'auto' }}
                  value={((form?.dependsOn || '') as string).split(',').filter(Boolean)}
                  onChange={e => setForm(x => ({ ...x, dependsOn: Array.from(e.target.selectedOptions).map(o => o.value).join(',') }))}>
                  {tasks.filter(x => x.id !== (editing?.id ?? '')).map(x => (
                    <option key={x.id} value={x.id} style={{ background: '#101614' }}>{x.title}</option>
                  ))}
                </select>
                <div style={{ fontSize: 9.5, color: MUTED, marginTop: 3 }}>{t('prj.depHint')}</div>
              </div>
              <div>
                <label style={label}>{t('prj.desc')}</label>
                <textarea style={{ ...input, minHeight: 56, resize: 'vertical' }} value={form?.desc ?? ''} onChange={e => setForm(x => ({ ...x, desc: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
              {!editing.new
                ? <button onClick={delTask} style={{ padding: '8px 14px', borderRadius: 10, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', color: '#f87171', fontSize: 12, cursor: 'pointer' }}>{t('prj.deleteTask')}</button>
                : <span />}
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setEditing(null)} style={{ padding: '8px 18px', borderRadius: 10, background: 'transparent', border: `1px solid ${EDGE}`, color: MUTED, fontSize: 12, cursor: 'pointer' }}>{t('sch.cancel')}</button>
                <button onClick={saveTask} disabled={!form?.title?.trim()} style={{ padding: '8px 18px', borderRadius: 10, background: 'linear-gradient(135deg, #6ee7b7, #34d399)', border: 'none', color: '#052e22', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: form?.title?.trim() ? 1 : 0.4 }}>{t('sch.save')}</button>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </motion.div>
  )
}

const chip = (s: { c: string; bg: string }): React.CSSProperties => ({ fontSize: 9.5, padding: '2px 8px', borderRadius: 999, color: s.c, background: s.bg, border: '1px solid rgba(255,255,255,0.08)' })
