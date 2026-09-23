/**
 * 隐私脱敏 — 采集层数据清洗
 *
 * 策略：在数据落库前完成脱敏，确保敏感信息永不进入本地存储或 LLM。
 *
 * 三个处理层：
 *   1. URL 净化：去 query string、去 fragment、去敏感路径段
 *   2. 标题脱敏：邮箱/手机号/身份证/密钥 → ***
 *   3. 应用名泛化（可选）：用于发给 LLM 时降低精度
 */

// ── URL 净化 ──

/** URL 中需保留的路径段（第 1 段白名单） */
const PATH_WHITELIST_FIRST_SEGMENT = new Set([
  'mail', 'inbox', 'calendar', 'docs', 'sheets', 'slides',
  'drive', 'github', 'repos', 'issues', 'pull', 'wiki',
  'notebooks', 'dashboard', 'settings', 'profile',
  'chat', 'channels', 'messages', 'groups',
  'search', 'maps', 'news',
  'localhost',
])

/** 看起来像 ID/hash 的路径段（纯数字、hex、UUID） */
const ID_SEGMENT_RE = /^(?:\d+|[0-9a-f]{8,}|[0-9a-f-]{36}|[A-Za-z0-9_-]{20,})$/i

/**
 * URL 脱敏：只保留 scheme + host + 白名单路径的前两段。
 * 去掉 query string、fragment、敏感路径段。
 *
 * 例：
 *   https://mail.google.com/mail/u/0/#inbox → https://mail.google.com/mail
 *   https://github.com/org/repo/pull/123/files → https://github.com/org/repo/pull
 *   https://example.com/?token=abc123 → https://example.com
 */
export function sanitizeURL(raw: string): string {
  if (!raw) return ''
  try {
    const u = new URL(raw)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '' // 不收集非 Web URL

    const parts = u.pathname.split('/').filter(Boolean)

    // 保留前 N 段：白名单匹配的段保留，ID 段截断
    const safe: string[] = []
    for (let i = 0; i < Math.min(parts.length, 3); i++) {
      const seg = parts[i]
      if (i === 0 && PATH_WHITELIST_FIRST_SEGMENT.has(seg.toLowerCase())) {
        safe.push(seg)
      } else if (i > 0 && !ID_SEGMENT_RE.test(seg)) {
        // 第二段以后，非 ID 的非数字段保留
        if (!/^\d+$/.test(seg) && seg.length < 40) safe.push(seg)
      }
      if (ID_SEGMENT_RE.test(seg)) break // 遇到 ID 就停
    }

    const path = safe.length > 0 ? '/' + safe.join('/') : ''
    return `${u.protocol}//${u.hostname}${path}`
  } catch {
    return ''
  }
}

// ── 标题脱敏 ──

/** 需要从窗口标题中清洗的敏感模式 */
const TITLE_REDACT_PATTERNS: [RegExp, string][] = [
  // 邮箱
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[email]'],
  // 中国大陆手机号
  [/\b1[3-9]\d{9}\b/g, '[phone]'],
  // 身份证号（18位）
  [/\b\d{6}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/g, '[id]'],
  // API Key / Token 模式（常见前缀 + 长随机串）
  [/\b(sk-[A-Za-z0-9]{20,}|[A-Za-z0-9_-]{32,})\b/g, '[key]'],
  // Bearer token
  [/\bBearer\s+[A-Za-z0-9._-]{20,}\b/gi, 'Bearer [token]'],
  // JWT
  [/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/g, '[jwt]'],
  // 常见密码参数
  [/\b(password|passwd|secret|token|api[_-]?key)\s*[:=]\s*\S+/gi, '$1=***'],
  // 文件路径中的用户名
  [/(?:\/Users\/|\/home\/)([^/\s]+)/g, '/Users/[user]'],
]

/**
 * 窗口标题脱敏：替换敏感信息为占位符。
 * 返回脱敏后的标题，不损失结构信息。
 */
export function sanitizeTitle(raw: string): string {
  if (!raw) return ''
  let clean = raw
  for (const [re, replacement] of TITLE_REDACT_PATTERNS) {
    clean = clean.replace(re, replacement)
  }
  // 截断过长标题
  if (clean.length > 200) clean = clean.slice(0, 197) + '...'
  return clean
}

// ── 应用名泛化（用于 LLM 摘要场景） ──

/** 将精确应用名映射为类别名 */
const APP_CATEGORY_MAP: Record<string, string> = {
  'Google Chrome': '浏览器',
  'Safari': '浏览器',
  'Arc': '浏览器',
  'Microsoft Edge': '浏览器',
  'Brave Browser': '浏览器',
  'Firefox': '浏览器',
  'Visual Studio Code': '代码编辑器',
  'Cursor': '代码编辑器',
  'IntelliJ IDEA': '代码编辑器',
  'PyCharm': '代码编辑器',
  'Terminal': '终端',
  'iTerm2': '终端',
  'Warp': '终端',
  'Slack': '即时通讯',
  'WeChat': '即时通讯',
  'DingTalk': '即时通讯',
  'Telegram': '即时通讯',
  'Discord': '即时通讯',
  'Mail': '邮件客户端',
  'Spark': '邮件客户端',
  'Outlook': '邮件客户端',
  'Obsidian': '笔记',
  'Notion': '笔记',
  'Figma': '设计工具',
  'Spotify': '音乐',
  'Apple Music': '音乐',
}

/**
 * 应用名泛化：将精确 app 名映射为类别名。
 * 用于 LLM 摘要场景——「代码编辑器 240min」比「VS Code 240min」少泄露信息。
 * 未在映射表中的返回原名。
 */
export function generalizeApp(app: string): string {
  return APP_CATEGORY_MAP[app] || app
}

// ── 批量脱敏入口 ──

export interface SanitizedData {
  app: string
  appGeneralized: string
  title: string
  url: string
}

export function sanitize(app: string, title: string, url?: string): SanitizedData {
  return {
    app,
    appGeneralized: generalizeApp(app),
    title: sanitizeTitle(title),
    url: url ? sanitizeURL(url) : '',
  }
}
