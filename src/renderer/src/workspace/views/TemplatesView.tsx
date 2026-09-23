// ── 任务模版: gallery of preset scheduled tasks, one click to instantiate ──
import React from 'react'
import { t } from '../../lib/i18n'
import { PlusCircle } from 'lucide-react'
import type { TaskTemplate } from '../templates'
import { TEMPLATES, TEMPLATE_ICONS } from '../templates'
import { G, GLASS, EDGE } from './style'

interface Props {
  onUse: (t: TaskTemplate) => void
}

export default function TemplatesView({ onUse }: Props) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 12 }}>
      {TEMPLATES().map(tmpl => {
        const Icon = TEMPLATE_ICONS[tmpl.icon]
        return (
          <div key={tmpl.id}
            onClick={() => onUse(tmpl)}
            style={{
              background: GLASS, border: `1px solid ${EDGE}`, borderRadius: 16, padding: 16,
              display: 'flex', flexDirection: 'column', gap: 10, cursor: 'pointer', fontFamily: G,
              backdropFilter: 'blur(30px)', WebkitBackdropFilter: 'blur(30px)',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(52,211,153,0.45)'; (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = EDGE; (e.currentTarget as HTMLElement).style.background = GLASS }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div style={{ width: 36, height: 36, borderRadius: 12, background: 'linear-gradient(135deg, rgba(52,211,153,0.9), rgba(45,212,191,0.85))', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 18px rgba(16,185,129,0.35)' }}>
                <Icon size={17} style={{ color: '#04120c' }} strokeWidth={2.2} />
              </div>
              <span style={{ fontSize: 9, padding: '2px 8px', borderRadius: 999, background: 'rgba(52,211,153,0.14)', color: '#34d399' }}>{tmpl.kind}</span>
            </div>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: '#fff' }}>{tmpl.name}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 3, lineHeight: 1.55, minHeight: 34 }}>{tmpl.desc}</div>
            </div>
            <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', fontFamily: 'ui-monospace, monospace', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', padding: '3px 8px', borderRadius: 999 }}>{tmpl.scheduleLabel}</span>
              <button
                onClick={e => { e.stopPropagation(); onUse(tmpl) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4, padding: '5px 12px', borderRadius: 999,
                  background: 'rgba(52,211,153,0.15)', border: '1px solid rgba(52,211,153,0.4)',
                  color: '#34d399', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: G,
                }}>
                <PlusCircle size={11} /> {t('ws.tab.create')}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
