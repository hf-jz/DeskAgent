// ── 创建任务: natural-language → LLM window spec, plus template shortcuts ──
import React, { useState } from 'react'
import { t } from '../../lib/i18n'
import { Zap, ChevronRight } from 'lucide-react'
import type { TaskTemplate } from '../templates'
import { TEMPLATES, TEMPLATE_ICONS } from '../templates'
import { G, GLASS, EDGE } from './style'

interface Props {
  creating: boolean
  onCreate: (text: string) => Promise<void>
  onUseTemplate: (t: TaskTemplate) => void
  onGoTemplates: () => void
}

export default function CreateTaskView({ creating, onCreate, onUseTemplate, onGoTemplates }: Props) {
  const [text, setText] = useState('')

  const submit = async () => { if (!text.trim() || creating) return; await onCreate(text.trim()) }

  return (
    <div style={{ maxWidth: 660, margin: '0 auto', paddingTop: 44, paddingBottom: 30 }}>
      <div style={{ background: GLASS, border: `1px solid ${EDGE}`, borderRadius: 20, padding: 26, backdropFilter: 'blur(30px)', WebkitBackdropFilter: 'blur(30px)' }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: '#fff' }}>{t('createtask.title')}</div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 4, marginBottom: 16 }}>
          {t('createtask.desc')}
        </div>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit() }}
          placeholder={t('createtask.placeholder')}
          rows={3}
          style={{
            width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.06)',
            border: `1px solid ${EDGE}`, borderRadius: 12, padding: '10px 12px', color: '#fff',
            fontSize: 13, outline: 'none', fontFamily: G, resize: 'vertical', lineHeight: 1.6,
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
          <button onClick={submit} disabled={creating || !text.trim()}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 999,
              border: '1px solid rgba(52,211,153,0.5)',
              background: creating ? 'rgba(255,255,255,0.06)' : 'rgba(52,211,153,0.18)',
              color: creating ? 'rgba(255,255,255,0.4)' : '#34d399', fontSize: 12, fontWeight: 700,
              cursor: creating ? 'default' : 'pointer', fontFamily: G,
            }}>
            <Zap size={13} /> {creating ? t('createtask.generating') : t('createtask.aiCreate')}
          </button>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>{t('createtask.enterHint')}</span>
        </div>
      </div>

      <div style={{ marginTop: 22 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.6)', marginBottom: 10 }}>
          {t('createtask.orTemplate')}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
          {TEMPLATES().slice(0, 4).map(t => {
            const Icon = TEMPLATE_ICONS[t.icon]
            return (
              <button key={t.id} onClick={() => onUseTemplate(t)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 14,
                  background: GLASS, border: `1px solid ${EDGE}`, color: 'rgba(255,255,255,0.85)',
                  fontSize: 12, cursor: 'pointer', fontFamily: G, textAlign: 'left',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(52,211,153,0.45)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = EDGE }}
              >
                <Icon size={14} style={{ color: '#34d399' }} />
                <span>{t.name}</span>
              </button>
            )
          })}
          <button onClick={onGoTemplates}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
              padding: '10px 12px', borderRadius: 14, background: 'transparent',
              border: `1px dashed rgba(255,255,255,0.2)`, color: 'rgba(255,255,255,0.55)',
              fontSize: 12, cursor: 'pointer', fontFamily: G,
            }}>
            {t('createtask.allTemplates')} <ChevronRight size={13} />
          </button>
        </div>
      </div>
    </div>
  )
}
