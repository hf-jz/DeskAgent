// ── 查看任务: all window specs with status + cron job info, row → detail ──
import React, { useMemo, useState } from 'react'
import { Play, Square, Trash, Search, PlusCircle } from 'lucide-react'
import { t } from '../../lib/i18n'
import type { WindowSpec, SpecStatus } from '../../../../shared/gen-ui-types'
import SpecCard from '../SpecCard'
import { G, GLASS, EDGE, EMERALD } from './style'

interface Props {
  specs: WindowSpec[]
  statusMap: Record<string, SpecStatus>
  jobs: any[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onRun: (id: string) => void
  onStop: (id: string) => void
  onDelete: (id: string) => void
  onNewTask: () => void
}

export default function TasksView({ specs, statusMap, jobs, selectedId, onSelect, onRun, onStop, onDelete, onNewTask }: Props) {
  const [q, setQ] = useState('')

  const filtered = useMemo(
    () => specs.filter(s => !q || s.title.toLowerCase().includes(q.toLowerCase())),
    [specs, q]
  )

  const jobOf = (spec: WindowSpec) => {
    const jid = statusMap[spec.id]?.jobId
    if (jid) return jobs.find(j => j.id === jid)
    return jobs.find(j => j.name === spec.title)
  }

  const sel = specs.find(s => s.id === selectedId)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, maxWidth: 300, background: GLASS, border: `1px solid ${EDGE}`, borderRadius: 10, padding: '6px 10px' }}>
          <Search size={13} style={{ color: 'rgba(255,255,255,0.35)' }} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={t('tasks.searchPlaceholder')}
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: '#fff', fontSize: 12, fontFamily: G }} />
        </div>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>{t('tasks.count', { n: specs.length })}</span>
        <button onClick={onNewTask}
          style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, padding: '7px 13px', borderRadius: 999, border: '1px solid rgba(52,211,153,0.5)', background: 'rgba(52,211,153,0.15)', color: '#34d399', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: G }}>
          <PlusCircle size={13} /> {t('tasks.newTask')}
        </button>
      </div>

      {/* List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {filtered.map(s => {
          const st = statusMap[s.id]
          const job = jobOf(s)
          const running = st?.status === 'running'
          const statusColor = running ? EMERALD : st?.status === 'ok' ? '#22c55e' : st?.status === 'error' ? '#f87171' : 'rgba(255,255,255,0.25)'
          const disabled = job ? job.enabled === 0 : false
          return (
            <div key={s.id}
              onClick={() => onSelect(selectedId === s.id ? null : s.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 12,
                background: GLASS, border: selectedId === s.id ? '1px solid rgba(52,211,153,0.4)' : `1px solid ${EDGE}`,
                cursor: 'pointer', fontFamily: G,
              }}
              onMouseEnter={e => { if (selectedId !== s.id) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
              onMouseLeave={e => { if (selectedId !== s.id) (e.currentTarget as HTMLElement).style.background = GLASS }}
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor, flexShrink: 0, boxShadow: running ? `0 0 8px ${statusColor}` : 'none' }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.title}</span>
                  <span style={{ fontSize: 9, padding: '1px 7px', borderRadius: 999, background: 'rgba(52,211,153,0.14)', color: '#34d399', flexShrink: 0 }}>{s.kind}</span>
                  {disabled && <span style={{ fontSize: 9, padding: '1px 7px', borderRadius: 999, background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.35)' }}>{t('tasks.disabled')}</span>}
                </div>
                <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
                  {s.cron
                    ? <span style={{ fontFamily: 'ui-monospace, monospace' }}>{s.cron.schedule}</span>
                    : t('tasks.noSchedule')}
                  {job?.next_run ? <span style={{ marginLeft: 10 }}>{t('tasks.nextRun', { t: fmtTime(job.next_run) })}</span> : null}
                  {job?.last_run ? <span style={{ marginLeft: 10 }}>{t('tasks.lastRun', { t: fmtTime(job.last_run) })}</span> : null}
                  {st?.error ? <span style={{ marginLeft: 10, color: '#f87171' }}>{t('tasks.runFail')}</span> : null}
                </div>
              </div>
              {s.cron && (
                running
                  ? <button onClick={e => { e.stopPropagation(); onStop(s.id) }} title={t('tasks.stop')}
                      style={btn} onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(251,146,60,0.7)'; (e.currentTarget as HTMLElement).style.color = '#fb923c' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = EDGE; (e.currentTarget as HTMLElement).style.color = 'rgba(251,146,60,0.9)' }}><Square size={11} /></button>
                  : <button onClick={e => { e.stopPropagation(); onRun(s.id) }} title={t('tasks.run')}
                      style={btn} onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(52,211,153,0.7)'; (e.currentTarget as HTMLElement).style.color = EMERALD }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = EDGE; (e.currentTarget as HTMLElement).style.color = 'rgba(52,211,153,0.9)' }}><Play size={11} /></button>
              )}
              <button onClick={e => { e.stopPropagation(); onDelete(s.id) }} title={t('tasks.delete')}
                style={btn} onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(248,113,113,0.7)'; (e.currentTarget as HTMLElement).style.color = '#f87171' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = EDGE; (e.currentTarget as HTMLElement).style.color = 'rgba(248,113,113,0.9)' }}><Trash size={11} /></button>
            </div>
          )
        })}
        {!filtered.length && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'rgba(255,255,255,0.4)', fontSize: 12.5 }}>
            {specs.length ? t('tasks.noMatch') : t('tasks.noTasks')}
          </div>
        )}
      </div>

      {/* Detail */}
      {sel && (
        <div style={{ marginTop: 4 }}>
          <SpecCard spec={sel} status={statusMap[sel.id]} />
        </div>
      )}
    </div>
  )
}

const btn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26,
  background: 'transparent', border: `1px solid ${EDGE}`, borderRadius: 8,
  color: 'rgba(255,255,255,0.6)', cursor: 'pointer', flexShrink: 0,
}

function fmtTime(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}.${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`
}
