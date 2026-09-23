import React from 'react'
import { t } from '../lib/i18n'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import 'katex/dist/katex.min.css'
import { normalizeMd } from '../../../shared/gen-ui-types'

export interface ReasoningEvent {
  id: string; type: 'thought' | 'tool' | 'browser' | 'observation'
  content: string; name?: string
  links?: { title: string; url: string; favicon?: string }[]
}

// ── URL extraction ──

function extractUrlsFromText(text: string): { title: string; url: string }[] {
  const results: { title: string; url: string }[] = []
  const mdRe = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g
  let m; while ((m = mdRe.exec(text)) !== null) results.push({ title: m[1].trim(), url: m[2] })
  const bareRe = /(?<![(\"\[{])(https?:\/\/[^\s\)\"\]<>]+)/g
  while ((m = bareRe.exec(text)) !== null) {
    const url = m[0].replace(/[.,;:!?)\]\\]+$/, '')
    if (!results.find(r => r.url === url)) {
      try { results.push({ title: new URL(url).hostname, url }) } catch {}
    }
  }
  return results
}

function getFavicon(url: string): string {
  try { return 'https://www.google.com/s2/favicons?domain=' + new URL(url).hostname + '&sz=16' } catch { return '' }
}

const TOOL_KEYWORDS = /(?:let me|i'?ll|i will|going to|should|need to|must|first|now|next|then|finally)\s+(?:use|search|run|execute|try|look|find|check|fetch|query|call|invoke|do|read|write|open|navigate|explore|examine|analyze|get|start|begin)/gi
const OBS_KEYWORDS = /(?:the results?|i found|i got|i received|it returned|the output|according to|key observations?|key findings?|this shows|here'?s what|looking at|based on|let me (?:compose|write|summarize|compile|draft|create|synthesize|now))/gi

function splitIntoSteps(allReasoning: string): string[] {
  if (!allReasoning.trim()) return []
  const paragraphs = allReasoning.split(/\n\s*\n/).filter(p => p.trim())
  if (paragraphs.length > 1) {
    const totalLen = paragraphs.reduce((s, p) => s + p.length, 0)
    if (totalLen > allReasoning.length * 0.5) return paragraphs
  }
  const long = paragraphs[0] || ''
  const boundaries: number[] = [0]
  let m
  while ((m = TOOL_KEYWORDS.exec(long)) !== null) { if (m.index > 5 && !boundaries.includes(m.index)) boundaries.push(m.index) }
  while ((m = OBS_KEYWORDS.exec(long)) !== null) { if (m.index > 5 && !boundaries.includes(m.index)) boundaries.push(m.index) }
  const sorted = [...boundaries].sort((a, b) => a - b)
  const steps: string[] = []
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i], end = i + 1 < sorted.length ? sorted[i + 1] : long.length
    const seg = long.slice(start, end).trim()
    if (seg && seg.length > 10) steps.push(seg)
  }
  if (steps.length > 1) { const retained = steps.reduce((s, p) => s + p.length, 0); if (retained > long.length * 0.5) return steps }
  return [long.trim()]
}

function detectParagraphType(text: string): 'thought' | 'tool' | 'observation' {
  const lower = text.toLowerCase()
  if (TOOL_KEYWORDS.test(lower)) return 'tool'
  if (OBS_KEYWORDS.test(lower)) return 'observation'
  return 'thought'
}

function extractToolName(text: string): string | undefined {
  const lower = text.toLowerCase()
  if (lower.includes('web_search')) return 'web_search'
  if (lower.includes('terminal')) return 'terminal'
  if (lower.includes('browser')) return 'browser'
  const m = text.match(/(?:use|using|run|execute|call|read|write|open|explore|search|navigate|analyze)\s+(?:the\s+)?(\w+)/i)
  return m ? m[1] : undefined
}

export function buildReasoningEvents(
  reasoningChunks: { id: string; content: string }[],
  toolCalls: { id: string; name: string; args: string }[],
  toolResults: { id: string; name: string; content: string }[],
  assistantContent?: string,
  streaming?: boolean,
  /** real thinking-block boundaries from the bridge (see lib/reasoningSegments).
   *  When present the regex splitter below is NOT used. */
  segments?: string[]
): ReasoningEvent[] {
  const events: ReasoningEvent[] = []
  const allReasoning = reasoningChunks.map(r => r.content).join('').trim()
  if (streaming) {
    if (allReasoning) events.push({ id: 'thought-stream', type: 'thought', content: allReasoning })
    return events
  }
  // ponytail: regex fallback only for turns recorded before the bridge emitted
  // boundaries; real segments win whenever the bridge provided them.
  const real = segments && segments.length > 0
  const steps = real ? segments! : splitIntoSteps(allReasoning)
  for (let i = 0; i < steps.length; i++) {
    const type = real ? 'thought' : detectParagraphType(steps[i])
    events.push({ id: (real ? 'thought' : type) + '-' + i, type, content: steps[i], name: type === 'tool' ? extractToolName(steps[i]) : undefined })
  }
  for (let i = 0; i < toolCalls.length; i++) {
    const tc = toolCalls[i]; let argsStr = tc.args || ''
    try {
      const parsed = JSON.parse(argsStr)
      if (parsed.command) argsStr = 'command: ' + parsed.command
      else if (parsed.query) argsStr = 'query: ' + parsed.query
      else if (parsed.url) argsStr = 'url: ' + parsed.url
      else argsStr = JSON.stringify(parsed, null, 2)
    } catch {}
    events.push({ id: 'tc-' + i, type: 'tool', name: tc.name + (argsStr ? ': ' + argsStr.substring(0, 60) : ''), content: argsStr || tc.args || '' })
  }
  for (let i = 0; i < toolResults.length; i++) {
    const tr = toolResults[i]; const urlsInResult = extractUrlsFromText(tr.content)
    if (urlsInResult.length > 0) events.push({ id: 'tr-b-' + i, type: 'browser', name: tr.name, content: tr.name + ': ' + urlsInResult.length + ' results', links: urlsInResult.map(u => ({ ...u, favicon: getFavicon(u.url) })) })
    events.push({ id: 'tr-' + i, type: 'observation', name: tr.name, content: tr.content.substring(0, 500) })
  }
  const urls = extractUrlsFromText(assistantContent || '')
  if (urls.length > 0) events.push({ id: 'browser-0', type: 'browser', content: 'Found ' + urls.length + ' links', links: urls.map(u => ({ ...u, favicon: getFavicon(u.url) })) })
  return events
}

// ── Dark theme markdown + KaTeX ──

const mdCSS = `
/* white-space: normal resets the pre-wrap inherited from the bubble container —
   rehype-raw emits whitespace-only text nodes between block elements, and under
   pre-wrap they render as blank lines (huge gaps before tables/pre/headings). */
.desk-md { font-size: 12px; line-height: 1.7; color: var(--ink-secondary); word-break: break-word; white-space: normal; }
.desk-md h1 { font-size: 18px; font-weight: 700; color: var(--ink); margin: 12px 0 6px; border-bottom: 1px solid var(--solid); padding-bottom: 4px; }
.desk-md h2 { font-size: 15px; font-weight: 700; color: var(--ink); margin: 10px 0 4px; border-bottom: 1px solid var(--line); padding-bottom: 3px; }
.desk-md h3 { font-size: 13px; font-weight: 700; color: var(--ink); margin: 8px 0 4px; }
.desk-md h4 { font-size: 12px; font-weight: 600; color: var(--ink-secondary); margin: 6px 0 2px; }
.desk-md h5, .desk-md h6 { font-size: 11px; font-weight: 600; color: var(--ink-secondary); margin: 4px 0 2px; }
.desk-md p { margin: 4px 0; }
.desk-md a { color: var(--accent-text); text-decoration: underline; }
.desk-md strong { color: var(--ink); font-weight: 600; }
.desk-md em { font-style: italic; color: var(--ink-secondary); }
.desk-md del { text-decoration: line-through; color: var(--ink-faint); }
.desk-md ul, .desk-md ol { margin: 4px 0 4px 16px; }
.desk-md li { margin: 2px 0; }
.desk-md li::marker { color: var(--accent-line); }
.desk-md ul.contains-task-list { list-style: none; margin-left: 4px; }
.desk-md .task-list-item { display: flex; align-items: flex-start; gap: 6px; }
.desk-md .task-list-item input[type="checkbox"] { margin-top: 3px; accent-color: var(--accent); pointer-events: none; }
.desk-md blockquote { margin: 6px 0; padding: 6px 12px; border-left: 3px solid var(--accent); background: rgba(124,58,237,0.06); color: var(--ink-muted); font-style: italic; }
.desk-md hr { border: none; border-top: 1px solid var(--line); margin: 8px 0; }
.desk-md code { background: var(--bg-hover); padding: 1px 5px; border-radius: 3px; font-size: 11px; font-family: 'SF Mono', Monaco, monospace; color: #F472B6; }
.desk-md pre { background: rgba(0,0,0,0.35); padding: 10px 14px; border-radius: 8px; overflow-x: auto; margin: 6px 0; border: 1px solid var(--line); }
.desk-md pre code { background: transparent; padding: 0; color: var(--ink-secondary); font-size: 11px; }
.desk-md table { width: 100%; border-collapse: collapse; margin: 8px 0; border: 1px solid var(--bg-hover); border-radius: 6px; overflow: hidden; }
.desk-md th { background: linear-gradient(135deg, var(--accent-soft), var(--accent-2-soft)); padding: 8px 12px; text-align: left; font-weight: 600; color: var(--ink); font-size: 11px; border-bottom: 2px solid var(--accent-line); }
.desk-md td { padding: 6px 12px; border-bottom: 1px solid var(--bg-card); font-size: 11px; }
.desk-md tr:last-child td { border-bottom: none; }
.desk-md tr:hover td { background: var(--bg-card); }
.desk-md img { max-width: 100%; border-radius: 6px; margin: 6px 0; }
/* KaTeX dark theme overrides */
.desk-md .katex { font-size: 1.05em; color: var(--ink); }
.desk-md .katex-display { margin: 8px 0; overflow-x: auto; overflow-y: hidden; }
.desk-md .katex-display > .katex { display: inline-block; white-space: nowrap; max-width: 100%; }
/* HTML details/summary */
.desk-md details { margin: 4px 0; padding: 6px 10px; background: var(--bg-card); border: 1px solid var(--bg-hover); border-radius: 6px; }
.desk-md summary { cursor: pointer; color: var(--ink-secondary); font-weight: 500; font-size: 12px; padding: 2px 0; }
.desk-md summary:hover { color: var(--ink); }
`

// ── MarkdownContent (react-markdown + GFM + math + raw HTML) ──

export function MarkdownContent({ text }: { text: string }): React.JSX.Element {
  if (!text) return <></>

  return (
    <>
      <style>{mdCSS}</style>
      <div className="desk-md">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[
            rehypeRaw,
            // #13: allow the file: protocol so artifact links survive sanitize
            [rehypeSanitize, { ...defaultSchema, protocols: { ...defaultSchema.protocols, href: [...(defaultSchema.protocols?.href || []), 'file'] } }],
            rehypeKatex,
          ]}
          // react-markdown v10 defaultUrlTransform 会把 file: 协议 URL 清成 "" —
          // 导致 file: 链接渲染成 <a href=""> 点击即"加载异常"。放行 file:，
          // 其余 URL 维持默认安全过滤 (javascript:/data: 等仍被拦截)。
          urlTransform={(url) => (typeof url === 'string' && url.startsWith('file:') ? url : defaultUrlTransform(url))}
          components={{
            a: ({ href, children, ...props }: any) => {
              if (typeof href === 'string' && href.startsWith('file:')) {
                const name = decodeURIComponent(href.slice(5))
                return (
                  <a
                    href={href}
                    onClick={(e) => {
                      e.preventDefault()
                      ;(window as any).deskAppAPI?.openVfsFile?.(name)
                    }}
                    title={t('rt.open', { name })}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 3,
                      padding: '1px 7px', borderRadius: 6, fontSize: '0.85em', cursor: 'pointer',
                      background: 'var(--info-soft)', border: '1px solid rgba(96,165,250,0.35)',
                      color: 'var(--info)',
                    }}
                  >📄 {children}</a>
                )
              }
              return (
                <a href={href} onClick={(e) => { e.preventDefault(); (window as any).deskAppAPI?.openExternal?.(href) }} {...props}>
                  {children}
                </a>
              )
            },
            code: ({ className, children, ...props }: any) => {
              const match = /language-(\w+)/.exec(className || '')
              if (match) {
                return (
                  <pre>
                    <code className={className} {...props}>{children}</code>
                  </pre>
                )
              }
              return <code {...props}>{children}</code>
            },
          }}
        >
          {normalizeMd(text)}
        </ReactMarkdown>
      </div>
    </>
  )
}

export { extractUrlsFromText as extractUrls }
