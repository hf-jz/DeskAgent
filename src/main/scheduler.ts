/**
 * Scheduler store — 日程/会议/项目/任务（内部库 scheduler.db）。
 *
 * P1: 纯内部库 + 预留与 macOS 日历（CalDAV/EventKit）双向同步接口。
 * 同步契约: events 表含 source ('local'|'caldav'|'eventkit') 与 external_id 列，
 * 未来实现 syncToCalendars() 时按 source 区分远端记录，避免双向覆盖。
 */
import { join } from 'path'

let DB: any = null

export interface SchedulerEvent {
  id: string
  title: string
  date: string            // YYYY-MM-DD
  startHour: number
  endHour: number
  room: string
  priority: '高' | '中' | '低'
  attendees: string[]
  status: '待开始' | '进行中' | '已结束'
  source: string          // local | caldav | eventkit
  externalId: string
}

export function initSchedulerStore(appDataPath: string): void {
  try {
    const Database = require('better-sqlite3')
    DB = new Database(join(appDataPath, 'scheduler.db'))
    DB.exec(`
      CREATE TABLE IF NOT EXISTS scheduler_events (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, date TEXT NOT NULL,
        start_hour REAL NOT NULL, end_hour REAL NOT NULL,
        room TEXT DEFAULT '', priority TEXT DEFAULT '中',
        attendees TEXT DEFAULT '[]', status TEXT DEFAULT '待开始',
        source TEXT DEFAULT 'local', external_id TEXT DEFAULT '', updated_at INTEGER DEFAULT 0,
        recurrence TEXT DEFAULT 'none');
      CREATE TABLE IF NOT EXISTS scheduler_projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, desc TEXT DEFAULT '',
        phase TEXT DEFAULT '', deadline TEXT DEFAULT '', health INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active', updated_at INTEGER DEFAULT 0,
        milestones TEXT DEFAULT '[]');
      CREATE TABLE IF NOT EXISTS scheduler_tasks (
        id TEXT PRIMARY KEY, project_id TEXT DEFAULT '', title TEXT NOT NULL,
        phase TEXT DEFAULT '', status TEXT DEFAULT '待处理', priority TEXT DEFAULT '中',
        start TEXT DEFAULT '', end TEXT DEFAULT '', progress INTEGER DEFAULT 0,
        assignee TEXT DEFAULT '', desc TEXT DEFAULT '', updated_at INTEGER DEFAULT 0,
        depends_on TEXT DEFAULT '');
    `)
    // 幂等迁移: 已存在的库补新列（旧版本建的表没有这些字段）
    const addCol = (table: string, col: string, ddl: string): void => {
      try {
        const cols: string[] = (DB.prepare(`PRAGMA table_info(${table})`).all() as any[]).map(c => c.name)
        if (!cols.includes(col)) DB.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`)
      } catch { /* column already handled */ }
    }
    addCol('scheduler_events', 'recurrence', "recurrence TEXT DEFAULT 'none'")
    addCol('scheduler_projects', 'milestones', "milestones TEXT DEFAULT '[]'")
    addCol('scheduler_tasks', 'depends_on', "depends_on TEXT DEFAULT ''")
  } catch (e) { console.warn('[scheduler] store init failed:', e) }
}

function mapRow(r: any): any {
  if (!r) return null
  // camelCase 映射（renderer 统一用 startHour/endHour 等；snake_case 仅存在于 SQL 层）
  return {
    id: r.id, title: r.title, date: r.date,
    startHour: r.start_hour, endHour: r.end_hour,
    room: r.room, priority: r.priority, status: r.status,
    attendees: normAttendees(safeJson(r.attendees, [])),
    source: r.source, externalId: r.external_id, recurrence: r.recurrence,
    projectId: r.project_id, phase: r.phase, start: r.start, end: r.end,
    progress: r.progress, assignee: r.assignee, desc: r.desc,
    milestones: safeJson(r.milestones, []), dependsOn: r.depends_on || '',
    health: r.health, deadline: r.deadline, name: r.name,
    updatedAt: r.updated_at,
  }
}
/** attendees 统一为字符串数组（兼容 agent 传字符串 'A,B' 或数组） */
function normAttendees(a: any): string[] {
  if (Array.isArray(a)) return a.map(String).filter(Boolean)
  if (typeof a === 'string') return a.split(/[,，]/).map(s => s.trim()).filter(Boolean)
  return []
}
function ymdStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function safeJson(s: string | null, fallback: any): any {
  if (!s) return fallback
  try { return JSON.parse(s) } catch { return fallback }
}

// ── Events ──
export function listEvents(date?: string): SchedulerEvent[] {
  if (!DB) return []
  try {
    const rows = date
      ? DB.prepare('SELECT * FROM scheduler_events WHERE date = ? ORDER BY start_hour').all(date)
      : DB.prepare('SELECT * FROM scheduler_events ORDER BY date, start_hour').all()
    return rows.map(mapRow)
  } catch { return [] }
}

export function createEvent(ev: any): SchedulerEvent | { error: string } {
  if (!DB) return { error: 'store unavailable' }
  if (!ev?.title?.trim() || !ev?.date) return { error: 'title and date required' }
  const id = 'evt-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
  try {
    // NaN 防御: 非法时间回退默认值（历史数据/异常输入不落 NaN）
    const sh = Number.isFinite(Number(ev.startHour)) ? Number(ev.startHour) : 9
    const eh = Number.isFinite(Number(ev.endHour)) ? Number(ev.endHour) : 10
    DB.prepare(`INSERT INTO scheduler_events (id, title, date, start_hour, end_hour, room, priority, attendees, status, source, external_id, updated_at, recurrence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'local', '', ?, ?)`)
      .run(id, ev.title.trim(), ev.date, sh, eh,
        ev.room ?? '', ev.priority ?? '中', JSON.stringify(normAttendees(ev.attendees)), ev.status ?? '待开始', Date.now(), ev.recurrence ?? 'none')
    const created = mapRow(DB.prepare('SELECT * FROM scheduler_events WHERE id = ?').get(id))
    // 重复日程: 按规则展开未来 30 天实例（实记录存储 — ponytail: 展开存储而非规则计算,
    // 简单可靠; 若天数/规模上来再改 recurrence 规则 + 视图时计算）
    if (ev.recurrence && ev.recurrence !== 'none' && ev.recurrence !== 'daily') {
      const base = new Date(ev.date + 'T00:00:00')
      for (let i = 1; i <= 30; i++) {
        const d = new Date(base)
        if (ev.recurrence === 'weekly') d.setDate(d.getDate() + i * 7)
        else if (ev.recurrence === 'monthly') d.setMonth(d.getMonth() + i)
        const ds = ymdStr(d)
        DB.prepare(`INSERT INTO scheduler_events (id, title, date, start_hour, end_hour, room, priority, attendees, status, source, external_id, updated_at, recurrence)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'local', '', ?, 'none')`)
          .run(id + '-' + i, ev.title.trim(), ds, ev.startHour ?? 9, ev.endHour ?? 10,
            ev.room ?? '', ev.priority ?? '中', JSON.stringify(normAttendees(ev.attendees)), ev.status ?? '待开始', Date.now())
      }
    }
    return created
  } catch (e: any) { return { error: String(e?.message || e) } }
}

export function updateEvent(id: string, patch: any): void {
  if (!DB) return
  const cur = DB.prepare('SELECT * FROM scheduler_events WHERE id = ?').get(id)
  if (!cur) return
  const next = { ...cur, ...patch }
  const sh = Number.isFinite(Number(next.startHour)) ? Number(next.startHour) : Number(cur.start_hour)
  const eh = Number.isFinite(Number(next.endHour)) ? Number(next.endHour) : Number(cur.end_hour)
  DB.prepare(`UPDATE scheduler_events SET title=?, date=?, start_hour=?, end_hour=?, room=?, priority=?, attendees=?, status=?, updated_at=?
    WHERE id=?`)
    .run(next.title, next.date, sh, eh, next.room, next.priority,
      JSON.stringify(normAttendees(next.attendees)), next.status, Date.now(), id)
}

export function deleteEvent(id: string): void {
  if (!DB) return
  try { DB.prepare('DELETE FROM scheduler_events WHERE id = ?').run(id) } catch { /* gone */ }
}

// ── Projects ──
export function listProjects(): any[] {
  if (!DB) return []
  try { return DB.prepare('SELECT * FROM scheduler_projects ORDER BY updated_at DESC').all() } catch { return [] }
}

export function createProject(p: any): any {
  if (!DB) return { error: 'store unavailable' }
  if (!p?.name?.trim()) return { error: 'name required' }
  const id = 'prj-' + Date.now().toString(36)
  try {
    DB.prepare(`INSERT INTO scheduler_projects (id, name, desc, phase, deadline, health, status, updated_at, milestones)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, p.name.trim(), p.desc ?? '', p.phase ?? '', p.deadline ?? '', p.health ?? 0, p.status ?? 'active', Date.now(), JSON.stringify(p.milestones ?? []))
    const pr = DB.prepare('SELECT * FROM scheduler_projects WHERE id = ?').get(id)
    return { ...pr, milestones: safeJson(pr.milestones, []) }
  } catch (e: any) { return { error: String(e?.message || e) } }
}

export function updateProject(id: string, patch: any): void {
  if (!DB) return
  const cur = DB.prepare('SELECT * FROM scheduler_projects WHERE id = ?').get(id)
  if (!cur) return
  const next = { ...cur, ...patch }
  DB.prepare(`UPDATE scheduler_projects SET name=?, desc=?, phase=?, deadline=?, health=?, status=?, updated_at=?, milestones=? WHERE id=?`)
    .run(next.name, next.desc, next.phase, next.deadline, next.health, next.status, Date.now(), JSON.stringify(next.milestones || []), id)
}

export function deleteProject(id: string): void {
  if (!DB) return
  try {
    DB.prepare('DELETE FROM scheduler_tasks WHERE project_id = ?').run(id)
    DB.prepare('DELETE FROM scheduler_projects WHERE id = ?').run(id)
  } catch { /* gone */ }
}

// ── Tasks ──
export function listTasks(projectId?: string): any[] {
  if (!DB) return []
  try {
    const rows = projectId
      ? DB.prepare('SELECT * FROM scheduler_tasks WHERE project_id = ? ORDER BY start').all(projectId)
      : DB.prepare('SELECT * FROM scheduler_tasks ORDER BY project_id, start').all()
    return rows
  } catch { return [] }
}

export function createTask(task: any): any {
  if (!DB) return { error: 'store unavailable' }
  if (!task?.title?.trim()) return { error: 'title required' }
  const id = 'tsk-' + Date.now().toString(36)
  try {
    DB.prepare(`INSERT INTO scheduler_tasks (id, project_id, title, phase, status, priority, start, end, progress, assignee, desc, updated_at, depends_on)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, task.projectId ?? '', task.title.trim(), task.phase ?? '', task.status ?? '待处理',
        task.priority ?? '中', task.start ?? '', task.end ?? '', task.progress ?? 0,
        task.assignee ?? '', task.desc ?? '', Date.now(), (task.dependsOn || []).join(','))
    const t = DB.prepare('SELECT * FROM scheduler_tasks WHERE id = ?').get(id)
    return { ...t, dependsOn: t.depends_on || '' }
  } catch (e: any) { return { error: String(e?.message || e) } }
}

export function updateTask(id: string, patch: any): void {
  if (!DB) return
  const cur = DB.prepare('SELECT * FROM scheduler_tasks WHERE id = ?').get(id)
  if (!cur) return
  const next = { ...cur, ...patch }
  DB.prepare(`UPDATE scheduler_tasks SET project_id=?, title=?, phase=?, status=?, priority=?, start=?, end=?, progress=?, assignee=?, desc=?, updated_at=?, depends_on=? WHERE id=?`)
    .run(next.project_id, next.title, next.phase, next.status, next.priority, next.start, next.end,
      next.progress, next.assignee, next.desc, Date.now(), (next.dependsOn || []).join(','), id)
}

export function deleteTask(id: string): void {
  if (!DB) return
  try { DB.prepare('DELETE FROM scheduler_tasks WHERE id = ?').run(id) } catch { /* gone */ }
}

// ── Today 汇总 (早晨问答 / UI 共用) ──
export function todaySummary(): any {
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const events = listEvents(today)
  const projects = listProjects().filter((p: any) => p.status === 'active')
  const tasks = listTasks().filter((t: any) => t.status !== '已完成')
  // 今日要跑的 cron（cron.ts 的 next_run 落在今天 00:00–24:00）
  let crons: any[] = []
  try {
    const { listJobs } = require('./cron')
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const dayEnd = dayStart + 86_400_000
    crons = listJobs().filter((j: any) => j.enabled && j.next_run >= dayStart && j.next_run < dayEnd)
  } catch { /* cron store unavailable */ }
  return { date: today, events, projects, tasks, crons }
}

/**
 * 每日简报 cron 任务：早晨 8:00 生成「今日安排」推送（复用 cron.ts 调度器）。
 * job name 固定 '每日简报'，schedule '0 8 * * *'，task 是给 agent 的简报 prompt。
 */
export function ensureDailyBriefing(enabled: boolean): { ok: boolean } {
  try {
    const cron = require('./cron')
    const jobs = cron.listJobs()
    const job = jobs.find((j: any) => j.name === '每日简报')
    if (enabled && !job) {
      cron.createJob({
        name: '每日简报', schedule: '0 8 * * *',
        task: '生成今日简报：调用 deskapp_scheduler 工具的 today 动作获取今日日程、进行中项目/任务、今日定时任务，'
          + '整理成简洁的中文简报（日程按时间排序，标注优先级；任务列出进行中/阻塞项；提醒今日要跑的定时任务），'
          + '然后发送到用户收件箱（inbox）。',
        catch_up: 0,
      })
    } else if (!enabled && job) {
      cron.deleteJob(job.id)
    }
    return { ok: true }
  } catch { return { ok: false } }
}

export function briefingEnabled(): boolean {
  try {
    const cron = require('./cron')
    return cron.listJobs().some((j: any) => j.name === '每日简报')
  } catch { return false }
}

/**
 * 预留: 与 macOS 日历 (CalDAV/EventKit) 双向同步。
 * 接口约定: 'pull' — 从远端日历拉取新增/更新到本地（source != 'local'）;
 *           'push' — 把本地 source='local' 的记录推送到远端并回填 external_id。
 * 实现时在 src/main/calendar-sync.ts 落地（EventKit via swift bridge 或 CalDAV via fetch）。
 */
export function syncToCalendars(_dir: 'pull' | 'push'): { ok: boolean; synced: number; message?: string } {
  console.warn('[scheduler] calendar sync not implemented yet (CalDAV/EventKit reserved)')
  return { ok: false, synced: 0, message: 'calendar sync not implemented' }
}
