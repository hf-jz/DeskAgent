import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { t } from '../lib/i18n'

// ── 项目时间线（scheduler tasks 驱动；机制抄 workspace ProgressView: toSerial/barLayout/tone） ──
type Scale = '周' | '双周' | '月'

const toSerial = (dateStr: string): number =>
  dateStr ? Math.floor(new Date(dateStr + 'T00:00:00').getTime() / 86_400_000) : 0

const serialToLabel = (s: number): string => {
  const d = new Date(s * 86_400_000)
  return `${d.getMonth() + 1}.${d.getDate()}`
}

const TONES = {
  neon: { background: 'linear-gradient(90deg, #34d399, #2dd4bf)', border: '1px solid rgba(110,231,183,0.5)', color: '#04120c', fontWeight: 700 as const, boxShadow: '0 0 18px rgba(16,185,129,0.4)' },
  soft: { background: 'rgba(52,211,153,0.15)', border: '1px solid rgba(52,211,153,0.35)', color: '#d1fae5' },
  muted: { background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.8)' },
  ghost: { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.45)' },
  err: { background: 'rgba(248,113,113,0.14)', border: '1px solid rgba(248,113,113,0.35)', color: '#fecaca' },
} as const

function barLayout(start: number, end: number, a0: number, axisCount: number) {
  const visibleStart = Math.max(start, a0)
  const visibleEnd = Math.min(end, a0 + axisCount - 1)
  if (visibleEnd < a0 || visibleStart > a0 + axisCount - 1) return null
  const left = ((visibleStart - a0) / axisCount) * 100
  const width = ((visibleEnd - visibleStart + 1) / axisCount) * 100
  return { left: `${Math.max(0, left)}%`, width: `${Math.max(width, 100 / axisCount)}%` }
}

export default function TaskTimeline({ tasks, onSelect }: {
  tasks: { id: string; title: string; start: string; end: string; status: string; phase: string }[]
  onSelect: (id: string) => void
}): React.JSX.Element {
  const [scale, setScale] = useState<Scale>('周')
  const [offset, setOffset] = useState(0)

  const todaySerial = Math.floor(Date.now() / 86_400_000)
  const axisCount = scale === '周' ? 14 : scale === '双周' ? 21 : 31

  const rows = useMemo(() => {
    const withSerial = tasks
      .filter(x => x.start && x.end)
      .map(x => ({ ...x, startS: toSerial(x.start), endS: toSerial(x.end) }))
    const min = withSerial.length ? Math.min(...withSerial.map(x => x.startS)) : todaySerial - 6
    const a0 = min - (scale === '月' ? 5 : 2) + offset
    const axis = Array.from({ length: axisCount }, (_, i) => a0 + i)
    const todayIdx = axis.indexOf(todaySerial)
    const phaseOrder = ['需求评审', '产品设计', '开发实现', '测试验证']
    const sorted = [...withSerial].sort((a, b) => phaseOrder.indexOf(a.phase) - phaseOrder.indexOf(b.phase))
    return { a0, axis, todayIdx, sorted }
  }, [tasks, scale, offset, axisCount, todaySerial])

  const toneFor = (status: string, phase: string): keyof typeof TONES => {
    if (status === '已完成') return 'ghost'
    if (status === '进行中') return 'neon'
    if (status === '阻塞') return 'err'
    return 'muted'
  }

  const label = `${serialToLabel(rows.a0)} – ${serialToLabel(rows.a0 + axisCount - 1)}`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.85)' }}>{t('prj.timeline')}</span>
        <div style={{ display: 'flex', padding: 3, borderRadius: 999, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)' }}>
          {(['周', '双周', '月'] as Scale[]).map(s => (
            <button key={s} onClick={() => { setScale(s); setOffset(0) }}
              style={{ padding: '3px 10px', borderRadius: 999, fontSize: 10, cursor: 'pointer', border: 'none', background: scale === s ? 'rgba(255,255,255,0.14)' : 'transparent', color: scale === s ? '#fff' : 'rgba(255,255,255,0.45)', fontWeight: scale === s ? 600 : 400 }}>
              {s === '周' ? t('prog.weekView') : s === '双周' ? t('prog.biweekView') : t('prog.monthView')}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
          <button onClick={() => setOffset(o => o - (scale === '月' ? 31 : scale === '双周' ? 21 : 14))} style={navBtn}><ChevronLeft size={12} /></button>
          <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.5)', fontFamily: 'ui-monospace, monospace', minWidth: 96, textAlign: 'center' }}>{label}</span>
          <button onClick={() => setOffset(o => o + (scale === '月' ? 31 : scale === '双周' ? 21 : 14))} style={navBtn}><ChevronRight size={12} /></button>
          <button onClick={() => setOffset(0)} style={{ padding: '3px 10px', borderRadius: 999, fontSize: 10, cursor: 'pointer', border: '1px solid rgba(255,255,255,0.12)', background: 'transparent', color: 'rgba(255,255,255,0.55)', marginLeft: 6 }}>{t('prog.today')}</button>
        </div>
      </div>

      <div style={{ position: 'relative', height: Math.max(rows.sorted.length * 26 + 6, 40), background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', overflow: 'hidden' }}>
        {/* 今天竖线 */}
        {rows.todayIdx >= 0 && (
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${(rows.todayIdx / axisCount) * 100}%`, width: 1, background: 'rgba(52,211,153,0.7)', zIndex: 1, boxShadow: '0 0 8px rgba(52,211,153,0.5)' }} />
        )}
        {rows.sorted.map((task, i) => {
          const lay = barLayout(task.startS, task.endS, rows.a0, axisCount)
          if (!lay) return null
          const tone = TONES[toneFor(task.status, task.phase)]
          return (
            <div key={task.id} onClick={() => onSelect(task.id)}
              style={{ position: 'absolute', top: 4 + i * 26, left: lay.left, width: lay.width, height: 20, borderRadius: 5, padding: '0 8px', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', overflow: 'hidden', ...tone, fontSize: 10, whiteSpace: 'nowrap' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{task.title}</span>
              <span style={{ fontFamily: 'ui-monospace, monospace', opacity: 0.8, flexShrink: 0 }}>{serialToLabel(task.startS)} - {serialToLabel(task.endS)}</span>
            </div>
          )
        })}
        {rows.sorted.length === 0 && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>{t('prj.noTasks')}</div>}
      </div>
    </div>
  )
}

const navBtn: React.CSSProperties = { width: 24, height: 24, borderRadius: 999, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }
