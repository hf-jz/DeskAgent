import { useState } from 'react'
import { t } from '../lib/i18n'

export interface QuestionReq {
  id: string
  question: string
  choices: string[]
}

/** P2-C2 #33: ask_user card — choices as pickable rows + free-text fallback.
 *  The hermes clarify thread blocks until the answer arrives (600s timeout). */
export default function QuestionCard({ req, onAnswer }: { req: QuestionReq; onAnswer: (id: string, answer: string) => void }) {
  const [text, setText] = useState('')
  const [answered, setAnswered] = useState(false)

  const answer = (a: string): void => {
    if (answered || !a.trim()) return
    setAnswered(true)
    onAnswer(req.id, a.trim())
  }

  const row: React.CSSProperties = {
    display: 'block', width: '100%', textAlign: 'left', marginBottom: 6,
    padding: '7px 10px', fontSize: 12, borderRadius: 8, cursor: answered ? 'default' : 'pointer',
    background: 'var(--info-soft)', border: '1px solid rgba(96,165,250,0.3)',
    color: 'var(--ink)', opacity: answered ? 0.4 : 1,
  }

  return (
    <div style={{
      margin: '8px 0', padding: '12px 14px', borderRadius: 12,
      background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.3)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 14 }}>❓</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--info)', flex: 1 }}>{t('question.waiting')}</span>
        {answered && <span style={{ fontSize: 10, color: 'var(--ink-muted)' }}>{t('question.answered')}</span>}
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink)', marginBottom: 10, lineHeight: 1.5 }}>
        {req.question}
      </div>
      {req.choices.map(c => (
        <button key={c} style={row} disabled={answered} onClick={() => answer(c)}>{c}</button>
      ))}
      {!answered && (
        <div style={{ display: 'flex', gap: 6, marginTop: req.choices.length ? 2 : 0 }}>
          <input
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') answer(text) }}
            placeholder={req.choices.length ? t('question.other') : t('question.input')}
            style={{
              flex: 1, background: 'rgba(0,0,0,0.3)', border: '1px solid var(--solid)',
              borderRadius: 8, color: 'var(--ink)', fontSize: 12, padding: '6px 10px', outline: 'none',
            }} />
          <button onClick={() => answer(text)} style={{
            padding: '6px 12px', fontSize: 12, borderRadius: 8, cursor: 'pointer',
            background: 'var(--info-soft)', border: '1px solid var(--info)', color: 'var(--info)',
          }}>{t('question.answer')}</button>
        </div>
      )}
    </div>
  )
}
