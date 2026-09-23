import { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, X } from 'lucide-react'
import { t } from '../lib/i18n'

const EMERALD = '#34d399'
const MUTED = 'rgba(255,255,255,0.45)'
const EDGE = 'rgba(255,255,255,0.14)'
const GLASS = 'rgba(255,255,255,0.045)'

export default function ProjectsView({ onOpen }: {
  onOpen: (project: any) => void
}): React.JSX.Element {
  const [projects, setProjects] = useState<any[]>([])
  const [taskCounts, setTaskCounts] = useState<Record<string, { done: number; total: number }>>({})
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState({ name: '', phase: '需求评审', deadline: '', desc: '', milestones: '' })

  const refresh = useCallback(() => {
    window.deskAppAPI.scheduler.listProjects().then(async (ps) => {
      setProjects(ps)
      const counts: Record<string, { done: number; total: number }> = {}
      for (const p of ps) {
        const tasks = await window.deskAppAPI.scheduler.listTasks(p.id).catch(() => [])
        counts[p.id] = { done: tasks.filter((x: any) => x.status === '已完成').length, total: tasks.length }
      }
      setTaskCounts(counts)
    }).catch(() => {})
  }, [])
  useEffect(() => { refresh() }, [refresh])

  const create = async (): Promise<void> => {
    if (!form.name.trim()) return
    // 里程碑: 每行 "名称|日期"，日期可省略
    const milestones = form.milestones.split('\n').map(l => l.trim()).filter(Boolean)
      .map(l => { const [name, date] = l.split('|').map(s => s.trim()); return { name, date: date || '', done: false } })
    await window.deskAppAPI.scheduler.createProject({ ...form, name: form.name.trim(), milestones })
    setModal(false)
    setForm({ name: '', phase: '需求评审', deadline: '', desc: '', milestones: '' })
    refresh()
  }

  const input: React.CSSProperties = { width: '100%', boxSizing: 'border-box', background: 'rgba(0,0,0,0.3)', border: `1px solid ${EDGE}`, borderRadius: 10, color: '#fff', fontSize: 12, padding: '8px 12px', outline: 'none' }
  const label: React.CSSProperties = { display: 'block', fontSize: 10.5, color: MUTED, marginBottom: 3 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>{t('prj.listTitle')}</div>
          <div style={{ fontSize: 11, color: MUTED, marginTop: 1 }}>{t('prj.listSub')}</div>
        </div>
        <button onClick={() => setModal(true)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 16px', borderRadius: 999, background: 'linear-gradient(135deg, #6ee7b7, #34d399)', border: 'none', color: '#052e22', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
          <Plus size={14} /> {t('prj.newProject')}
        </button>
      </div>

      {projects.length === 0 && (
        <div style={{ padding: '60px 0', textAlign: 'center', borderRadius: 16, background: GLASS, border: `1px dashed ${EDGE}`, fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>
          {t('prj.emptyProjects')}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
        {projects.map((p, i) => {
          const c = taskCounts[p.id] || { done: 0, total: 0 }
          const rate = c.total ? Math.round((c.done / c.total) * 100) : 0
          return (
            <motion.div key={p.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05, type: 'spring', stiffness: 300, damping: 28 }}
              onClick={() => onOpen(p)}
              whileHover={{ y: -2 }}
              style={{ padding: 16, borderRadius: 16, background: GLASS, border: `1px solid ${EDGE}`, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 9, padding: '2px 8px', borderRadius: 999, background: 'rgba(52,211,153,0.12)', border: `1px solid ${EMERALD}33`, color: EMERALD }}>{p.phase || t('prj.phase')}</span>
                <span style={{ fontSize: 18, fontWeight: 800, color: EMERALD, fontFamily: 'ui-monospace, monospace' }}>{p.health || 0}</span>
              </div>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: '#fff' }}>{p.name}</div>
              {p.desc && <div style={{ fontSize: 11, color: MUTED, lineHeight: 1.6, minHeight: 32 }}>{p.desc.slice(0, 80)}</div>}
              {p.deadline && <div style={{ fontSize: 10.5, color: MUTED }}>{t('prj.deadline')}: {p.deadline}</div>}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: MUTED, marginBottom: 4 }}>
                  <span>{c.done}/{c.total} {t('prj.kpiDone')}</span>
                  <span style={{ fontFamily: 'ui-monospace, monospace' }}>{rate}%</span>
                </div>
                <div style={{ width: '100%', height: 5, borderRadius: 999, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                  <motion.div initial={{ width: 0 }} animate={{ width: `${rate}%` }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                    style={{ height: '100%', borderRadius: 999, background: 'linear-gradient(90deg, #6ee7b7, #34d399)', boxShadow: `0 0 10px ${EMERALD}66` }} />
                </div>
              </div>
            </motion.div>
          )
        })}
      </div>

      <AnimatePresence>
        {modal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setModal(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
            <motion.div initial={{ scale: 0.94, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 32 }} onClick={e => e.stopPropagation()}
              style={{ width: 460, background: 'rgba(16,22,19,0.96)', border: `1px solid ${EDGE}`, borderRadius: 18, padding: 20, boxShadow: '0 24px 70px rgba(0,0,0,0.6)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{t('prj.newProject')}</div>
                <button onClick={() => setModal(false)} style={{ width: 26, height: 26, borderRadius: 999, background: 'rgba(255,255,255,0.06)', border: `1px solid ${EDGE}`, color: 'rgba(255,255,255,0.7)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={13} /></button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <input style={input} placeholder={t('prj.namePh')} value={form.name} onChange={e => setForm(x => ({ ...x, name: e.target.value }))} autoFocus />
                <div style={{ display: 'flex', gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <label style={label}>{t('prj.phase')}</label>
                    <select style={input} value={form.phase} onChange={e => setForm(x => ({ ...x, phase: e.target.value }))}>
                      {['需求评审', '产品设计', '开发实现', '测试验证'].map(p => <option key={p} value={p} style={{ background: '#101614' }}>{p}</option>)}
                    </select>
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={label}>{t('prj.deadline')}</label>
                    <input type="date" style={input} value={form.deadline} onChange={e => setForm(x => ({ ...x, deadline: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <label style={label}>{t('prj.desc')}</label>
                  <textarea style={{ ...input, minHeight: 56, resize: 'vertical' }} value={form.desc} onChange={e => setForm(x => ({ ...x, desc: e.target.value }))} />
                </div>
                <div>
                  <label style={label}>{t('prj.milestonePh')}</label>
                  <textarea style={{ ...input, minHeight: 48, resize: 'vertical' }} placeholder={t('prj.milestonePhHint')} value={form.milestones} onChange={e => setForm(x => ({ ...x, milestones: e.target.value }))} />
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
                <button onClick={() => setModal(false)} style={{ padding: '8px 18px', borderRadius: 10, background: 'transparent', border: `1px solid ${EDGE}`, color: MUTED, fontSize: 12, cursor: 'pointer' }}>{t('sch.cancel')}</button>
                <button onClick={create} disabled={!form.name.trim()} style={{ padding: '8px 18px', borderRadius: 10, background: 'linear-gradient(135deg, #6ee7b7, #34d399)', border: 'none', color: '#052e22', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: form.name.trim() ? 1 : 0.4 }}>{t('prj.create')}</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
