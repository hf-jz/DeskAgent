import { useState, useEffect } from 'react'
import { t } from '../lib/i18n'

/** P1-B4 #20: cron jobs — list + enable toggle + create form + delete.
 *  B: 条目可展开看最近执行状态；按 job.name 匹配窗口 spec 提供「打开窗口」跳转。 */
export default function CronTab(): React.JSX.Element {
  const [jobs, setJobs] = useState<any[]>([])
  const [specs, setSpecs] = useState<any[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [schedule, setSchedule] = useState('0 9 * * *')
  const [task, setTask] = useState('')
  const [catchUp, setCatchUp] = useState(false)
  const [error, setError] = useState('')

  const refresh = (): void => { window.deskAppAPI.listCronJobs().then(setJobs).catch(() => {}) }
  useEffect(() => {
    refresh()
    window.deskAppAPI.genui?.listSpecs?.().then(setSpecs).catch(() => {})
  }, [])

  const create = (): void => {
    setError('')
    window.deskAppAPI.createCronJob({ name: name.trim(), schedule: schedule.trim(), task: task.trim(), catch_up: catchUp })
      .then(r => {
        if (r?.error) { setError(r.error); return }
        setName(''); setTask(''); refresh()
      }).catch(e => setError(String(e)))
  }

  const fmtTime = (ts: number): string => {
    if (!ts) return t('cron.detail.noRun')
    const d = new Date(ts)
    return `${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  }
  const fmtNext = fmtTime
  const specOf = (jobName: string): any | undefined => specs.find(s => s.title === jobName)

  const input: React.CSSProperties = {
    background: 'rgba(0,0,0,0.3)', border: '1px solid var(--solid)', borderRadius: 6,
    color: 'var(--ink)', fontSize: 12, padding: '6px 8px', outline: 'none', width: '100%',
  }

  return (
    <div>
      <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '6px' }}>{t('cron.title')}</h2>
      <p style={{ fontSize: '12px', color: 'var(--ink-muted)', marginBottom: '16px' }}>
        {t('cron.desc')}
      </p>

      {jobs.map(j => {
        const open = expanded === j.id
        const spec = specOf(j.name)
        return (
          <div key={j.id} style={{ marginBottom: 6 }}>
            <div onClick={() => setExpanded(open ? null : j.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
                borderRadius: 8, background: 'var(--bg-card)', border: '1px solid var(--line)',
                cursor: 'pointer',
              }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: 'var(--ink)' }}>
                  {j.name}
                  <span style={{ fontSize: 9, color: spec ? 'var(--info)' : 'var(--ink-faint)', marginLeft: 6, padding: '1px 6px', borderRadius: 999, background: spec ? 'var(--info-soft)' : 'var(--bg-hover)' }}>
                    {spec ? t('cron.detail.fromWindow') : t('cron.detail.manual')}
                  </span>
                  {j.status !== 'ok' && <span style={{ color: 'var(--danger)', fontSize: 10 }}>（{j.status === 'auto-paused' ? t('cron.autoPaused') : t('cron.failed')}）</span>}
                </div>
                <div style={{ fontSize: 10, color: 'var(--ink-faint)', marginTop: 2 }}>
                  <code>{j.schedule}</code> · {t('cron.nextRun', { t: fmtNext(j.next_run) })}
                </div>
              </div>
              <button onClick={(e) => { e.stopPropagation(); window.deskAppAPI.updateCronJob(j.id, { enabled: j.enabled ? 0 : 1 }).then(refresh) }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: j.enabled ? 'var(--ok)' : 'var(--ink-faint)' }}>
                {j.enabled ? t('cron.enabled') : t('cron.disabled')}
              </button>
              <button onClick={(e) => { e.stopPropagation(); window.deskAppAPI.deleteCronJob(j.id).then(refresh) }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--ink-faint)' }}>🗑</button>
            </div>
            {open && (
              <div style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--bg-elev)', border: '1px solid var(--bg-hover)', marginTop: 2, fontSize: 11, color: 'var(--ink-muted)' }}>
                <div>{t('cron.detail.lastRun')}: {fmtTime(j.last_run)} · {t('cron.detail.nextRun')}: {fmtNext(j.next_run)}</div>
                {(j.consecutive_errors || 0) > 0 && <div style={{ color: 'var(--danger)' }}>{t('cron.detail.failCount', { n: j.consecutive_errors || 0 })}</div>}
                {j.task && <div style={{ marginTop: 4, wordBreak: 'break-all' }}>{t('cron.detail.task')}: {j.task.length > 120 ? j.task.slice(0, 120) + '…' : j.task}</div>}
                {spec && (
                  <button onClick={() => window.deskAppAPI.genui?.focusSpec?.(spec.id)}
                    style={{ marginTop: 6, background: 'var(--info-soft)', border: '1px solid var(--info)', borderRadius: 6, color: 'var(--info)', fontSize: 11, padding: '3px 10px', cursor: 'pointer' }}>
                    {t('cron.detail.openWindow')}
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}
      {jobs.length === 0 && <div style={{ fontSize: 11, color: 'var(--ink-faint)', padding: '12px 0' }}>{t('cron.empty2')}</div>}

      <div style={{ marginTop: 16, padding: 12, borderRadius: 8, background: 'var(--bg-card)', border: '1px solid var(--line)' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-secondary)', marginBottom: 8 }}>{t('cron.newSection')}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input style={input} placeholder={t('cron.namePh')} value={name} onChange={e => setName(e.target.value)} />
          <input style={input} placeholder={t('cron.schedPh')} value={schedule} onChange={e => setSchedule(e.target.value)} />
          <textarea style={{ ...input, minHeight: 48, resize: 'vertical' }} placeholder={t('cron.taskPh')} value={task} onChange={e => setTask(e.target.value)} />
          <label style={{ fontSize: 11, color: 'var(--ink-muted)', display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={catchUp} onChange={e => setCatchUp(e.target.checked)} />
            {t('cron.catchup')}
          </label>
          {error && <div style={{ fontSize: 11, color: 'var(--danger)' }}>{error}</div>}
          <button onClick={create} disabled={!name.trim() || !task.trim()} style={{
            background: 'var(--accent-line)', border: '1px solid var(--accent-line)', borderRadius: 6,
            color: 'var(--ink)', fontSize: 12, padding: '6px 0', cursor: 'pointer',
            opacity: (!name.trim() || !task.trim()) ? 0.4 : 1,
          }}>{t('cron.create')}</button>
        </div>
      </div>
    </div>
  )
}
