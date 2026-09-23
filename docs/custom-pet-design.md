# 自定义 Desktop Pet —— 方案设计

> 目标：Settings → Appearance 增加「自定义 Desktop Pet」，用户上传一张照片（猫/狗/任何物体），系统自动识别并抠出主体，转化为带完整行为动画的桌面宠物。
> 参考：`~/web/petdex`（Cloudflare Workers 网站宠物平台）。

---

## 1. petdex 参考分析

| petdex 能力 | 可否借鉴 | 结论 |
|---|---|---|
| 9 态精灵图状态机（idle/run/wave/jump/failed…） | ✅ | deskapp 已有 pose(4)+mood(8) 行为循环，直接沿用其**语义映射**（idle↔呼吸、run↔走路、sleep↔睡觉、failed↔晃动） |
| 精灵图资产概念（每宠一张图，状态=行、帧=列） | ✅ 改造 | 照片无法多帧切图 → 单帧透明 PNG 资产 + **CSS 变换动画**模拟各状态 |
| 切片+编码管道（sharp/gifenc 生成 GIF/WebP） | ❌ | 本地桌面直接 `<img>` 渲染 PNG，无需编码管道 |
| R2 云端存储 / 审核 / 社区 | ❌ | 本地 userData 存储，无社区 |
| 动画时长节奏（idle 1100ms 等） | ✅ | CSS 动画时长参考其节奏（呼吸 ~3.5s、走路 ~0.5s/步） |

**核心洞察**：petdex 是「精灵图 → 状态驱动动画」；deskapp 自定义宠物是「照片 → 抠图资产 → CSS 变换动画」。petdex 借的是**状态语义与节奏**，不是它的云设施。

## 2. 技术选型（核心决策）

### 2.1 主体识别与抠图 —— 零依赖纯算法（主路径）

候选方案对比：

| 方案 | 依赖 | 隐私 | 效果 | 结论 |
|---|---|---|---|---|
| 视觉 LLM（DeepSeek-VL 等） | 需 API key，当前 worker=deepseek-v4-flash 无视觉能力 | 照片出网 | mask 输出不可控 | ❌ 不可靠 |
| ONNX 分割模型（U2-Net/MODNet） | 新增 onnxruntime-web + 下载模型(4-170MB) | ✅ 本地 | 最好 | ⏸ P2 增强，首版不上 |
| **纯算法：边界 flood-fill + 最大连通域** | **零依赖** | ✅ 本地 | 纯色/渐变背景极好；复杂背景靠画笔微调兜底 | ✅ **首版主路径** |

`matting.ts` 算法（核心纯 TS，vitest 可测）：
1. **自动识别**：从图像四边向内 flood-fill，颜色距离 < 容差的像素标记为背景。自动模式按容差序列 [12, 20, 28, 36, 48] 各跑一遍，选「前景占比 ∈ [15%, 70%] 且前景占比最大」的容差 —— 这就是「自动识别出主体」。
2. **主体提取**：剩余未标记像素中取**最大连通域**（4 邻接）为前景，其余置透明 —— 去除照片里的次要杂物。
3. **自动构图**：按前景 bbox 自动居中 + 等比例缩放到画布 80%，宠物落地贴底。
4. **人工微调**（个性化关键）：容差滑块(0–80) + 画笔擦除/恢复 + 笔刷半径。
5. **风格化**：原始 / 像素化(降采样+最近邻放大，petdex 像素风致敬) / 卡通化(posterize 色阶压缩+提饱和)。

复杂度：flood-fill O(n)，单次 <10ms；自动识别 5 次探测 <50ms，无感知。

### 2.2 动画体系 —— 单帧 PNG + CSS 变换

照片是单帧，无法像精灵图切帧。用**分层 CSS 变换**合成全部 pose/mood：

```
<div pet-stage>                      ← pose/mood class 挂这里
  <div pet-flip>                      ← face-left: scaleX(-1)
    <div pet-cust-anim>               ← 呼吸/走路/睡觉 主变换
      <img src=file://…>             ← 透明 PNG，object-fit contain
    </div>
  </div>
  <div pet-zzz>Z z z</div>           ← 睡觉特效（复用 mochi 结构）
</div>
```

| pose/mood | 动画 | 时长 |
|---|---|---|
| idle | 呼吸缩放 1↔1.035 + 轻微浮动 | 3.6s |
| crawl（走路，配合窗口滑动） | 上下弹跳 translateY(±6%) + 前后倾斜 ±4° | 0.5s |
| lie | 压扁 scaleY(0.86) + 慢呼吸 | 4.5s |
| sleep | 压扁 + brightness(0.7) + Zzz 浮动 | — |
| speaking | 呼吸加速 | 2s |
| working/thinking | 快速脉冲 | 0.8s |
| happy | 单次弹跳 | 0.6s |
| confused/error | 左右晃动 ±5° | 0.4s |
| 左右朝向 | scaleX(±1) | — |

所有动画纯 CSS keyframes，零运行时开销，与现有 PetApp 行为循环（walk/lie/sleep 状态机）**零改动兼容** —— 只是把 `PetCharacter` 换成 `CustomPet`，接口相同。

## 3. 数据模型与存储

```ts
// src/shared/ipc-channels.ts
interface PetSettings {
  petStyle?: 'mochi' | 'bobo' | 'strands' | 'rings' | 'custom'
  customPet?: { id: string; name: string; createdAt: number }
}
```

- PNG 文件：`userData/custom-pet/<id>.png`（主进程写盘，renderer 只传 dataURL）
- id：`Date.now().toString(36)`，单宠物（覆盖式），不搞多宠物库（YAGNI，需要时再加）
- 删除：删文件 + 清空 customPet + petStyle 回退 'mochi'

## 4. IPC 契约

```ts
'open-pet-customizer': { req: []; res: void }                       // 打开自定义窗口
'custom-pet:save':     { req: [dataUrl: string, name: string]; res: CustomPetInfo }
'custom-pet:remove':   { req: []; res: void }                       // 删除并回退 mochi
```

保存流程：renderer canvas.toDataURL → main 写文件 → 更新 settings（petStyle='custom', customPet）→ 广播 settings-changed → 全部窗口（pet/设置）即时刷新。

## 5. UI / UX

### 5.1 AppearanceTab 变更
- Desktop Pet 卡片：内置 4 风格按钮 + 第 5 个「📷 我的照片宠物」按钮（有 customPet 时显示缩略图+名称，未创建时显示「未创建」占位；点击即切换 petStyle='custom'）。
- 卡片底部新增按钮 **「🎨 自定义 Desktop Pet」** → 打开自定义窗口。
- customPet 存在时，卡片内显示管理行：缩略图 + 名称 + 「移除」按钮。

### 5.2 自定义窗口（PetCustomizerApp，独立 BrowserWindow 900×720）
单屏工作流（不做多步骤页，减少切换成本）：

```
┌─────────────────────────────────────────────┐
│ 上传区(拖拽/点击)  [自动识别主体]  [重置]      │
│ ┌───────────────────┐ ┌───────────────────┐ │
│ │   Canvas 编辑区     │ │ 容差滑块 0–80      │ │
│ │   (棋盘格透明背景,   │ │ 画笔: 擦除/恢复+半径 │ │
│ │    前景半透明叠加)   │ │ 风格: 原始/像素/卡通  │ │
│ │                    │ │ ┌─────────────┐   │ │
│ │                    │ │ │ 动画预览(呼吸) │   │ │
│ │                    │ │ └─────────────┘   │ │
│ │                    │ │ 名称: [我的猫猫]    │ │
│ └───────────────────┘ │ [保存并设为宠物]     │ │
└───────────────────────┴───────────────────┘
```

交互细节：
- 上传支持点击选择 + 拖拽，最大 8MB，PNG/JPG/WebP。
- 自动识别后直接进入「编辑态」并给出统计（主体尺寸、占比），体现「识别」过程。
- 画布操作：边缘容差滑块实时重算（防抖 150ms）；画笔在 mask 上作画（擦=标背景，恢复=标前景）；Ctrl+Z 撤销一步。
- 动画预览：迷你循环 idle 呼吸动画，即时反馈「动态」效果。
- 保存按钮 loading 态 → 成功后自动切到 petStyle='custom' 并关闭窗口，桌面宠物立即换成新形象。

### 5.3 个性化定制点清单（用户需求「充分满足个性化」）
1. 任意照片（猫/狗/手办/车标/自拍）
2. 自动识别主体 + 手动微调（容差、画笔、笔刷半径）
3. 三种风格（原片/像素/卡通）
4. 名称自定义
5. 尺寸 S/M/L 沿用现有设置
6. 不透明度沿用现有设置
7. 完整行为动画：呼吸/走路/躺/睡/说话/工作/开心/困惑
8. 左右朝向自动翻转

## 6. 边界与降级

| 场景 | 处理 |
|---|---|
| 上传非图片/超限 | 前端校验 + 提示 |
| 复杂背景自动识别差 | 自动选最优容差仍失败 → 提示「建议纯色背景照片，或用手动画笔」，画笔兜底 |
| 前景占比过小(<5%) | 提示重新拍照 |
| petStyle='custom' 但文件缺失 | PetApp 回退 mochi 并自动清理设置（防御性） |
| 保存失败（磁盘） | 窗口内错误提示，不破坏现有宠物 |
| pet 窗口 webSecurity:false | img 直接 file:// 加载，无 CSP 问题 |

## 7. 文件清单

| 文件 | 说明 |
|---|---|
| `docs/custom-pet-design.md` | 本文档 |
| `src/shared/ipc-channels.ts` | 类型 + 3 个新通道 |
| `src/main/custom-pet.ts` | 存储(save/remove) + 窗口(singleton) |
| `src/main/settings-store.ts` | customPet 字段 |
| `src/main/ipc-handlers.ts` / `index.ts` | handler 注册 + ctx.openPetCustomizer |
| `src/preload/index.ts` | 3 个 API |
| `src/renderer/src/pet-customizer/matting.ts` | 抠图引擎（纯 TS） |
| `src/renderer/src/pet-customizer/PetCustomizerApp.tsx` | 自定义窗口 UI |
| `src/renderer/src/pet/CustomPet.tsx` | 动画宠物组件 |
| `src/renderer/src/pet/PetApp.tsx` | custom 分支 |
| `src/renderer/src/settings/AppearanceTab.tsx` | 按钮/预览/移除 |
| `src/renderer/src/main.tsx` | ?page=pet-customizer 路由 |
| `tests/matting.test.ts` | 抠图算法单测 |

## 8. 实施顺序
1. shared 类型 → 2. main（存储+窗口+IPC）→ 3. preload → 4. matting 引擎+单测 → 5. CustomPet → 6. PetCustomizerApp → 7. AppearanceTab → 8. 构建+测试验证

## 9. 二期增强（已实现 2026-08）

| 功能 | 实现 |
|---|---|
| **多宠物库** | `PetSettings.customPets[]` 列表 + 激活项 `customPet`；保存=入库+激活，AppearanceTab「我的宠物库」网格（缩略图/点击切换/✕删除），删除激活项自动回退 mochi |
| **视觉 LLM 类别标签** | 「🤖 AI 识别」按钮 → main `classifySubject`：优先当前配置的视觉 provider，否则探测 OPENAI/GOOGLE/ANTHROPIC key（含 Anthropic messages 格式分支）；DeepSeek 等无视觉时优雅降级提示；识别结果可点击用作宠物名 |
| **图生动画真多帧** | 保存时程序化生成 5 行×8 列 spritesheet（`spritesheet.ts`：idle 呼吸 6 帧 / walk 弹跳 8 帧 / lie 4 帧 / sleep 压暗 4 帧 / jump 5 帧，每帧几何变换 petdex 风格），CustomPet 改为 rAF 帧播放器 |
| **鼠标盯视** | main 进程 350ms 轮询 `screen.getCursorScreenPoint()` vs 宠物窗口中心，340px 内推送 `pet:mouse`；mochi/bobo/custom 全部转头跟随（rotate clamp ±8° + 平移，0.35s 缓动） |
| **活泼动作** | 内置宠物补全动画体系（原 pet-* 类全无 CSS：呼吸/走路弹跳/躺/睡/工作脉冲/开心跳/困惑晃/朝向翻转/Zzz）；照片宠物 idle 随机 wiggle/lookaround 小动作；行为循环：走路频率 45%→55%，走完 25% 回头张望 1.4s |

### 文件（二期新增/修改）
- `src/renderer/src/pet-customizer/spritesheet.ts` + `tests/spritesheet.test.ts`（帧生成器）
- `src/main/custom-pet.ts`：多宠物文件管理 + `classifySubject`（vision 探测/OpenAI 兼容/Anthropic）
- `src/renderer/src/pet/CustomPet.tsx`：spritesheet 播放器 + 盯视 + 小动作
- `src/renderer/src/pet/PetCharacter.tsx`：内置宠物动画体系补全 + 盯视
- `src/renderer/src/pet/PetApp.tsx`：sheet url 加载、鼠标订阅、行为循环增强
- `src/renderer/src/settings/AppearanceTab.tsx`：宠物库网格
- `src/main/index.ts`：`startMouseTracking` 轮询 + quit 清理
- `src/shared/asset-codec.ts` + `tests/asset-codec.test.ts`：dataURL/名称解析（纯函数）
- `tests/e2e/custom-pet.spec.ts` + `test:e2e` script：Playwright Electron 全流程 e2e（隔离 userData，上传 icon.png → 自动识别 → 保存 → 跨窗口广播 → 文件落盘断言）

## 10. 测试矩阵（当前）
- `npm test`：88 用例 —— matting(12) / spritesheet(8) / segnet(6) / asset-codec(6) / 既有回归(56)
- `npm run test:e2e`：3 用例 —— 真实 Electron：开窗口 → 上传 → **U2-Net AI 分割徽章断言** → 保存 → settings 广播 + 磁盘断言
- `npm run build`：tsc(shared/main/preload) + vite 全绿（IPC 契约双向类型检查）
- GUI 视觉行为（转头/走路动画）仍属手动验证范畴：`npm run dev` 后目测

## 11. U2-Net 本地分割（2026-08 集成）
- **模型**：`resources/models/u2netp.onnx`（4.57MB，opset 11，7 个侧输出）——rembg 同源；渲染端 `segnet.ts` 用 onnxruntime-web 独立 wasm 构建推理，7 输出平均后阈值成 mask
- **集成坑（已修）**：① vite-ignore 对 rollup 无效 → 动态 import 变量化；② GitHub 下载截断（2MB 假文件）→ 重下 + python onnx 校验；③ wasmPaths 相对路径被 ort 按模块 base 双重解析 → 绝对 URL
- **降级链**：上传后自动识别 → U2-Net（成功则 AI 徽章 + 容差滑块禁用）→ flood-fill 兜底（模型/推理失败时）
- **分发**：vite copy 插件把模型 + ort wasm/mjs 复制到 dist；customizer 窗口 webSecurity:false（与 pet 窗口一致，仅本地资源）

## 12. 后续增强（P3，未做）
- 云图生视频 API（可灵/即梦）生成真 AI 动画帧替换程序化帧。
- 宠物间互动（多宠物同时出现在桌面）。
