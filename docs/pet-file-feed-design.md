# 桌面宠物「喂食」交互 — 文件/文件夹拖拽分析与分析

> 状态：方案设计稿 v1（待评审后实现）
> 范围：桌面宠物图标 ↔ 电脑文件/文件夹的拖拽交互 + 自动深入分析

---

## 1. 需求拆解

用户故事：从 Finder（或任意桌面）拖拽一个文件或文件夹到桌面宠物图标上：

1. **悬停时**（拖入宠物身体区域，未松手）：宠物气泡显示 `嗅嗅～是好吃的嘛？`
2. **松手时**（drop）：宠物气泡显示 `嗷呜～嚼嚼嚼… xxx.md 真香！`（多对象则 `吧唧吧唧… N个文件+M个文件夹 吃光光～`），文件/文件夹传入 deskapp 系统
3. **随后**：系统自动弹出气泡窗口，对传入的文件/文件夹做深入分析，流式给出详尽分析结果

三个阶段的验收标准：

| 阶段 | 触发 | 预期表现 | 可验证点 |
|---|---|---|---|
| S1 悬停 | dragover 进入宠物身体区域 | 气泡 "嗅嗅～是好吃的嘛？" | 文字出现；移出后消失 |
| S2 咀嚼 | drop 松手 | 气泡 "嗷呜～嚼嚼嚼… xxx.md 真香！" 等 | 类型/数量/名称正确 |
| S3 分析 | 提取完成 | 新气泡窗口弹出并自动流式分析 | 分析结果详尽、引用文件正确 |

---

## 2. 现状盘点（已具备的能力，直接复用）

deskapp 现有架构对本次需求极度友好，大部分基础设施已就绪：

| 能力 | 位置 | 说明 |
|---|---|---|
| 文件绝对路径解析 | `src/preload/index.ts:252` `getFilePath(file) => webUtils.getPathForFile(file)` | P1-B1 #11 已落地，拖放 File 对象 → 绝对路径 |
| 宠物气泡机制 | `src/renderer/src/pet/PetApp.tsx` `say(text, ms)` + `SpeechBubble` | 已有气泡条（窗口上部 92px 预留区），`lastSayAt` 防 idle chatter 覆盖 |
| 输入捕获窗口 | `src/main/hit-window.ts` + `src/renderer/hit.html` | 覆盖宠物身体方块、捕获鼠标事件；宠物主窗口 click-through |
| 气泡窗口创建 | `src/main/task-bubble.ts` `createNewBubble(preload, petBounds)` | 创建 → 定位在宠物旁 → show+focus |
| 附件导入工作区 | `BubbleApp.tsx:424-440`（#11 管道） | `vfsImport(path)` → agent 用文件工具读取；PDF 走 `extractPdf` 生成文本孪生 |
| 文件夹拖入模式 | `BubbleApp.tsx:625-640` / `ContentStudio.tsx:146-153` | `webkitGetAsEntry().isDirectory` 判文件夹 + `getFilePath` 取路径 |
| 任务执行管道 | `agents:execute-task` → `buildTurnContext` → bridgeManager | 流式 `task:chunk` 已有，气泡实时渲染 |
| 内容提取 | `src/main/pdf-extract.ts` `pdf:extract` | PDF→文本 |
| 宠物拖动冲突处理 | `src/main/drag-handler.ts` `stopPetWalk()` | 拖拽时停走 |

**结论：本次不引入任何新依赖；新增代码集中在 3 处 —— hit 窗口 DnD 捕获、一个主进程 FeedService、气泡自动分析触发。**

---

## 3. 总体架构

```
Finder 拖文件/文件夹
  │  (HTML5 DnD，系统级，与窗口内 mousedown 拖宠物不冲突)
  ▼
hit 窗口渲染进程 (hit.html)
  │  dragover / drop 事件
  │  webUtils.getPathForFile → 绝对路径数组
  ▼  IPC send 'pet:feed' [paths]
主进程 FeedService (src/main/feed.ts)
  │  fs.stat 分类（文件/文件夹/数量/扩展名）
  │  ① push 'pet:say' "嗅嗅～是好吃的嘛？"/"嗷呜～嚼嚼嚼…"
  │  ② 内容提取（文本/PDF/目录树，限大小限深度）
  │  ③ createNewBubble → 气泡窗口
  ▼  push 'feed:analyze' [payload]
气泡窗口渲染进程 (BubbleApp)
  │  自动 vfsImport 附件 + 拼装分析 prompt
  ▼  executeTask(prompt) —— 走既有 buildTurnContext / bridgeManager
流式分析结果（task:chunk）→ 气泡展示；task:done → 宠物 happy
```

关键设计决策：

- **DnD 挂载在 hit 窗口而非宠物主窗口**。宠物主窗口 `setIgnoreMouseEvents(true)` 完全点击穿透，只有 hit 窗口接收鼠标事件；Finder 拖拽产生的 dragover/drop 同样只落在 hit 窗口上。
- **文件路径在渲染进程解析（webUtils），主进程只收字符串路径**。webUtils 只能在 preload/renderer 侧用，路径解析天然归属 hit 窗口。
- **"咀嚼"文案由主进程算好再 push 给宠物**。类型判定需要 fs.stat（渲染进程无此权限），保持渲染进程无逻辑。
- **分析走既有"附件导入"管道而非自定义注入**。`vfsImport` + agent 文件工具 = 项目已验证模式，零新机制。

---

## 4. 交互状态机

```
        dragenter/dragover(命中宠物身体)         drop(松手)
S0 ────────────────────────────▶ S1 ──────────────────────────▶ S2
IDLE                             嗅嗅～是好吃的嘛？                嗷呜～嚼嚼嚼… xxx.md 真香！
  ▲                               │dragleave                     │
  │                               ▼                              │ 内容提取完成
  │                         S0（气泡消失）                        ▼
  │                                                        S3 气泡窗口打开，自动分析
  │                                                            │ task:done
  │                                                            ▼
  │                                                        S4 分析完成（宠物 happy，可选）
  └────────────────────────────────────────────────────────────┘
     （气泡关闭后回到 S0；任何阶段宠物被拖动→中止回 S0）
```

- S1 悬停态：气泡常驻"嗅嗅～是好吃的嘛？"，**不自动消失**（dragover 持续期间保持），dragleave 时清除。
- S2 咀嚼态：drop 后立即显示，内容提取（≤2s 预算）完成即切 S3。若提取超时/失败，气泡改显示错误文案（见 §8.8）。
- S3 分析态：气泡窗口出现即代表进入，宠物保持 idle（分析进度在气泡内展示，宠物不重复播报）。

---

## 5. 详细设计

### 5.1 IPC 通道（`src/shared/ipc-channels.ts`）

新增 3 个通道，遵循既有三段式契约：

```ts
// IpcSendMap（hit → main，fire-and-forget）
'pet:feed': [paths: string[]]

// IpcPushMap（main → 各窗口，server-push）
'pet:say':      [text: string, ms: number]          // → 宠物窗口
'feed:analyze': [payload: FeedPayload]              // → 新气泡窗口

// IpcInvokeMap 无新增 —— 内容提取后的回执不需要走 invoke，
// 分析结果经既有 task:chunk 流式返回。
```

共享类型（放 `ipc-channels.ts` 顶部 domain types 区）：

```ts
export interface FeedItem {
  path: string
  name: string
  kind: 'file' | 'folder'
  size: number
  ext: string
  modifiedAt: number
  /** 文件：全文/前 N 行文本；文件夹：目录树文本；二进制：'' */
  preview: string
}

export interface FeedPayload {
  items: FeedItem[]
  /** 目录树/预览拼接后的总摘要文本（喂给 agent 的第一手资料） */
  summary: string
  /** 统计文案，如 "1个.md文件"、"2个文件+1个文件夹" */
  statText: string
  /** 触发时宠物窗口 bounds，用于定位新气泡 */
  petBounds: Electron.Rectangle
}
```

### 5.2 hit 窗口 DnD 捕获（`src/renderer/hit.html` + `src/preload/index.ts`）

hit.html 新增（与既有 mousedown 拖宠物逻辑**互不干扰**：Finder 拖拽时鼠标按下发生在 Finder 窗口，hit 窗口收不到 mousedown；窗口内拖宠物时不会有 DnD 事件）：

```js
// ── 文件投喂 ──
var feedHover = false

document.addEventListener('dragover', function (e) {
  e.preventDefault()                      // 必须：否则 drop 不触发
  if (!feedHover) {
    feedHover = true
    window.deskAppAPI.feedHover()         // main → pet:say "嗅嗅～是好吃的嘛？"
  }
})

document.addEventListener('dragleave', function () {
  feedHover = false
  window.deskAppAPI.feedLeave()           // main → pet 清气泡
})

document.addEventListener('drop', function (e) {
  e.preventDefault()
  feedHover = false
  var files = e.dataTransfer.files
  if (!files || files.length === 0) return
  var paths = []
  for (var i = 0; i < files.length; i++) {
    var p = window.deskAppAPI.getFilePath(files[i])
    if (p) paths.push(p)
  }
  if (paths.length > 0) window.deskAppAPI.sendFeed(paths)
})
```

> 注意：macOS Finder 拖拽文件夹时，`dataTransfer.files` 会包含该文件夹（`webkitGetAsEntry().isDirectory` 可判，但 drop 后 `getFilePath` 已能直接给出文件夹路径，无需 entry API；类型判定交给主进程 fs.stat，渲染进程零判断）。

preload 新增：

```ts
// 渲染进程 → 主进程
feedHover: (): void => sendIPC('pet:feed-hover'),
feedLeave: (): void => sendIPC('pet:feed-leave'),
sendFeed:  (paths: string[]): void => sendIPC('pet:feed', paths),
// 主进程 → 渲染进程
onPetSay:   (cb: (text: string, ms: number) => void): (() => void) => onPush('pet:say', cb),
onFeedAnalyze: (cb: (p: FeedPayload) => void): (() => void) => onPush('feed:analyze', cb),
```

（`pet:feed-hover` / `pet:feed-leave` 是 S1 悬停态的两个单向信号，也在 IpcSendMap 注册。）

### 5.3 宠物气泡接收（`src/renderer/src/pet/PetApp.tsx`）

新增一个 useEffect，让主进程能直接驱动宠物说话（复用现有 `say`，天然继承"覆盖旧气泡 + 记录 lastSayAt 防 idle chatter 抢话"）：

```tsx
useEffect(() => {
  return window.deskAppAPI.onPetSay((text, ms) => say(text, ms))
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [])
```

S1/S2 的文案送达路径：hit 窗口 `sendFeed` → 主进程 → `petWindow.webContents.send('pet:say', ...)`。主进程持有 petWindow 引用（`ctx.petWindow`），无需查表。

### 5.4 主进程 FeedService（新文件 `src/main/feed.ts`，~150 行）

职责：收路径 → 分类统计 → 播报文案 → 提取内容 → 开气泡窗口 → 推送分析任务。全部同步快路径（stat/readFile 均为本地 IO，µs~ms 级），不引入异步队列。

```ts
import { statSync, readdirSync, readFileSync } from 'fs'
import { basename, extname, join } from 'path'

const PREVIEW_MAX_BYTES = 256 * 1024   // 单文件预览上限 256KB
const TREE_MAX_DEPTH = 3               // 目录树最大深度
const TREE_MAX_ENTRIES = 100           // 每层最多列 100 项
const TEXT_EXTS = new Set(['.txt', '.md', '.json', '.csv', '.ts', '.tsx', '.js', '.jsx',
  '.py', '.go', '.rs', '.c', '.cpp', '.h', '.hpp', '.java', '.kt', '.swift', '.yml', '.yaml',
  '.toml', '.xml', '.html', '.css', '.sh', '.log', '.ini', '.conf'])
```

核心函数：

```ts
export function feedFiles(
  paths: string[],
  petWin: BrowserWindow | null,
  preloadPath: string,
): void
```

流程（同步）：

1. **stat 分类**：逐路径 `statSync`（失败 → 记入 errorItems，见 §8.8）；`isDirectory()` 分文件/文件夹；收集 `name / size / ext / modifiedAt`。
2. **组装 statText（S2 咀嚼文案）**：
   - 单文件：`嗷呜～嚼嚼嚼… xxx.md 真香！`（名称过长 → `xxx.md 等` 截断）
   - 单文件夹：`嗷呜～嚼嚼嚼… xxx文件夹 真香！`
   - 多个：`吧唧吧唧… 3个文件 吃光光～` / `2个文件+1个文件夹 吃光光～`（只报数量，不列名称）
3. **push pet:say**：`stopPetWalk()` 先停走（drop 瞬间宠物若在散步，先站定再吃），然后推送 S2 文案（ms≈2600，覆盖提取+开窗时间）。
4. **内容提取**（每项）：
   - 文件：`TEXT_EXTS` 命中 → `readFileSync` 截前 256KB 作 preview；`.pdf` → 走 `pdf-extract` 异步补文本（见 §5.6）；其他二进制 → preview=''（仅元数据）。
   - 文件夹：递归 `readdirSync` 生成目录树文本（深度≤3、每层≤100 项、过滤 `.DS_Store` 等隐藏文件；`node_modules/.git 等`目录单独跳过不展开）。
5. **开气泡窗口**：`createNewBubble(preloadPath, petWin.getBounds())`。
6. **推送**：气泡 `webContents.send('feed:analyze', payload)`；payload.summary = 目录树 + 各 preview 拼接（限总长 ~64KB，超出截断并注明）。

### 5.5 气泡自动分析（`src/renderer/src/bubble/BubbleApp.tsx`）

新增一个挂载期监听（与既有 `onEditSpec` 等模式一致）：

```tsx
useEffect(() => window.deskAppAPI.onFeedAnalyze?.((payload) => {
  // 1) 等会话就绪（sid 解析 + 首次 loadSession 完成，避免竞态）
  // 2) 逐项 vfsImport（复用 #11 附件导入管道；文件夹 → 导入其路径文本）
  // 3) 拼装分析 prompt（见下）
  // 4) 自动执行：executeTask(prompt, { modelMode: 'auto' })
}) || (() => {}), [])
```

分析 prompt（主进程只给数据，气泡负责拼装；结构与 #11 附件管道保持一致，agent 天然会用文件工具精读）：

```
请深入分析以下拖入的文件/文件夹，输出详尽的分析结果：

【投喂清单】
- 📄 xxx.md（/Users/.../xxx.md，12.4KB，今天 14:02 修改）
- 📁 docs（文件夹，内含 8 个文件）

【已导入工作区，可用文件工具读取；目录结构与预览如下】
<summary 文本>

请从以下维度分析（按内容类型自适应调整）：
1. 内容概要 —— 这是什么，核心讲了什么
2. 结构拆解 —— 章节/模块/组成
3. 关键要点 —— 值得注意的细节、数据、结论
4. 质量与风险 —— 完整性、准确性、潜在问题
5. 下一步建议 —— 可以怎么用、怎么改、怎么完善
```

执行细节：

- **竞态处理**：`onFeedAnalyze` 可能早于 `useSession` 的首次 `loadSession` 完成。做法：把 payload 暂存 ref，在 `sessionLoaded.current === true` 后再真正发送（或在 handleSend 依赖链上加一个"待发队列"）。实现上建议：`pendingFeedRef = useRef<FeedPayload | null>(null)`，`sessionLoaded` 变 true 的 effect 里消费它。
- **streaming 冲突**：若气泡已有任务在跑，新 feed 任务走既有 `queue` 机制（`bridgeManager.isBusy` → `task:queued`），无需特殊处理。
- **vfsImport 失败**（文件在系统盘只读区等）：降级为在 prompt 中直接给绝对路径 + preview 文本，agent 仍可分析。
- **多开**：用户连续拖两批 → 各开各的气泡窗口（feed 窗口互不共享，与 `sessions:open` 每击开新窗行为一致）。

### 5.6 PDF 处理（走既有 #11 管道，Phase 3）

**决策：PDF 文本提取复用气泡内 #11 管道，主进程 feed.ts 不碰 PDF。**

| 路径 | 说明 | 优 | 劣 |
|---|---|---|---|
| A 主进程 S2 提取 | feed.ts 异步调用 `pdf:extract`，文本并入 summary | 气泡打开即带全文，首 token 快；不依赖 vfsImport | feed.ts 引入异步等待 + PDF 分支，开窗时序变复杂（~15 行新逻辑） |
| B 气泡内 #11 管道（选定） | 气泡 `vfsImport` → `extractPdf` 生成文本孪生 → agent 用 read_file 自行精读 | 零新代码，全走已验证路径；惰性读取不占 prompt 预算 | 首 token 慢 ~1-3s（agent 先工具调用）；vfsImport 失败时 agent 读不到内容 |

B 的取舍依据：vfsImport 失败场景极少（磁盘满/权限），且 #11 已有失败降级（prompt 注明"导入失败"）；首 token 延迟是 agent 正常工具调用节奏，可接受。若日后实测"拖 PDF 等太久"，再把 A 的文本预览补进 feed.ts，二者可共存（B 负责精读，A 负责预览）。

drop 的 .pdf 在 feed.ts 侧 preview=''（仅元数据），不进 summary。

---

## 6. 文案与动效规格

| 状态 | 文案 | 时长 | 备注 |
|---|---|---|---|
| S1 悬停 | 嗅嗅～是好吃的嘛？ | 常驻至 dragleave | 拟声+叠词，与宠物人设一致 |
| S2 咀嚼 单文件 | 嗷呜～嚼嚼嚼… xxx.md 真香！ | ~2.6s | 名称+扩展名，超长截断为 `xxx.md 等` |
| S2 咀嚼 多个 | 吧唧吧唧… 2个文件+1个文件夹 吃光光～ | ~2.6s | 数量统计（§5.4-2） |
| S2 失败 | 呜呜…这个我咬不动啦 | 3s | stat 失败/路径不存在 |
| S3 完成（可选） | 嗝～分析完啦，结果在那边哟！ | 5s | 复用 `task:done` 触发，与现有 TASK_DONE_TEXT 同机制 |

宠物 mood 配合：S1/S2 可设 `happy`（张嘴等食感），S3 恢复 idle。仅对 character 类宠物有意义，strands/rings 不强制。

---

## 7. 实施计划（4 阶段，每阶段可独立验证）

### Phase 1 — DnD 捕获 + 宠物文案反馈
改动：`ipc-channels.ts`（+`pet:feed-hover/leave`、`pet:feed`、`pet:say`）、`preload/index.ts`（+4 方法）、`hit.html`（+DnD 监听）、`PetApp.tsx`（+onPetSay）、`ipc-handlers.ts`（+2 个 hover/leave 透传 + `pet:feed` 最小处理：只统计文案 + push pet:say）。
验证：拖文件到宠物 → "嗅嗅～是好吃的嘛？" → 松手 → "嗷呜～嚼嚼嚼… xxx.md 真香！" → 气泡消失。

### Phase 2 — FeedService + 气泡窗口弹出
改动：新增 `src/main/feed.ts`（stat 分类 + 目录树 + 文本预览 + createNewBubble + feed:analyze push）。
验证：拖入任意文件/文件夹 → 新气泡窗口自动弹出，无内容（或占位"分析准备中"）。

### Phase 3 — 自动深入分析
改动：`BubbleApp.tsx`（+onFeedAnalyze 监听 + 竞态队列 + vfsImport + prompt 拼装 + 自动 executeTask）。
验证：拖入 .md/PDF/文件夹 → 气泡自动流式输出五个维度的详尽分析，文件引用可点击。

### Phase 4 — 边界打磨
- 多文件混拖、大文件（>5MB 只给路径+预览头）、深目录（>3 层截断）、二进制（仅元数据）、只读盘导入失败降级、宠物隐藏/贴边状态（drop 前先 showFromEdge）、连续快速拖两批。
- 全量回归：`npm run test` + `npm run build`。

---

## 8. 边界情况与坑

1. **dragover 必须 preventDefault**，否则 drop 永不触发（HTML5 DnD 铁律）。
2. **dragleave 抖动**：拖拽在窗口内移动会反复触发 dragleave/enter。S1 文案幂等（重复 say 同文本无感知），无需 counter；仅在 drop 后统一清除。
3. **与拖宠物冲突**：Finder 拖拽时 hit 窗口收不到 mousedown（按下发生在 Finder），拖宠物时无 DnD 事件——天然互斥，无需加锁。
4. **宠物走步中 drop**：先 `stopPetWalk()` 再显示文案（复用 drag-handler 导出）。
5. **文件被移动/删除后 drop**：statSync 抛错 → §6 错误文案，不崩。
6. **超大文件**：preview 截 256KB，agent 按需用文件工具精读；绝不整读进 prompt。
7. **目录爆炸**：深度 3 + 每层 100 项 + 跳过 node_modules/.git/dist，summary 总长 64KB 封顶。
8. **`.app`/包文件**：macOS 视作文件夹，按文件夹处理即可（目录树天然只列 Contents 结构，可接受）。
9. **气泡竞态**：onFeedAnalyze 早于 loadSession → pendingFeedRef 队列消费（§5.5）。
10. **重复导入**：vfsImport 同名文件会怎样？现有 #11 管道已处理过该场景（vfs:import 幂等策略沿用），不新增逻辑。
11. **隐私**：文件路径与内容只进本地 agent 上下文，无新外发面（与现有附件管道同级别）。

---

## 9. 不做的事（YAGNI）

- 不做拖拽进宠物后的"文件复制/归档"（需求只要分析，不移动文件）。
- 不做宠物张嘴/咀嚼动画（PetCharacter 无该 pose，Phase 4 看效果再议，不阻塞主线）。
- 不做拖入历史记录/收件箱条目（气泡会话本身已持久化，足够）。
- 不做拖入 ZIP 解压分析（Phase 4 后视使用频率再说）。
