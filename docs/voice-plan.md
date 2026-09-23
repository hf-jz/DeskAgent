# DeskApp 语音交互方案 — STT + TTS（低延迟 / 高准确度）

> 参考实现：~/Agents/BabelLive（Silero VAD + SenseVoiceSmall + Edge TTS/MOSS-TTS，54 条已踩陷阱）
> 目标：桌面宠物 ↔ 使用者的语音双向交互，是提升体验最直接的路径
> 本机已有资产：SenseVoiceSmall 已缓存（~/.cache/modelscope，897MB）、MOSS-TTS-Nano ONNX（728MB）、Silero VAD ONNX（BabelLive/models/silero_vad.onnx，2.2MB）、deskapp 引擎 venv（~/.hermes/hermes-agent/venv）

---

## 1. 交互形态设计（先定 UX，再定技术）

| 档位 | 交互 | 触发方式 | 技术需求 | 定位 |
|---|---|---|---|---|
| V1 按键说话 | 按住/点击 🎤 说话，松开即送 | 气泡输入框麦克风按钮（#41A 已占位） | 无需 VAD——按钮就是 VAD | **本次实施** |
| V2 连续对话 | 宠物常听，说一句回一句，可打断 | 语音模式开关 | Silero VAD 分段 + barge-in | V1 稳定后 |
| V3 唤醒词 | "小桌小桌"免手触发 | 唤醒词 | sherpa-onnx KWS / openWakeWord | 有硬需求再立项 |

V1 选择按键说话是刻意的延迟/准确率双赢：去掉 VAD 误触发（BabelLive 最大痛点来源），短句（1-5s）识别又快又准，且用户心理预期与微信语音一致，零学习成本。

**宠物说话（TTS）全程默认开**：agent 流式输出按句切分，第一句合成完立即播放，其余句子流水线合成——用户感知延迟 = 首句合成时间，而非整段。

---

## 2. 总体架构

```
┌─ Bubble Renderer ─────────────────────────────────────┐
│ 🎤 useVoiceInput: getUserMedia → Int16 PCM 16kHz/40ms │
│    (-38dB RMS 门控，松手发 asr_final)                  │
│ 🔊 useVoicePlayer: 句子队列 → Audio(mp3) 顺序播放      │
└──────── IPC: voice:audio / voice:asr-result / voice:tts-chunk
┌─ Main ────────────────────────────────────────────────┐
│ voice-bridge.ts  — 单 readline dispatcher（陷阱#2）    │
│   ├─ spawn voice.py（引擎 venv，常驻）                 │
│   ├─ TTS 句子调度器：agent 流式 delta 按句切分          │
│   └─ 崩溃自动重启（startPromise 六规则，陷阱#32）      │
└──────── stdin/stdout JSONL（与 bridge.py 同协议模式）
┌─ resources/voice.py ──────────────────────────────────┐
│ ASR: SenseVoiceSmall (FunASR, 本地缓存, inference_mode)│
│ TTS: edge-tts（主，流式 MP3）→ macOS say（离线兜底）   │
└───────────────────────────────────────────────────────┘
```

关键决策：
- **独立 voice.py sidecar，不进 bridge.py**——模型重（加载 3-5s）、生命周期独立、崩溃隔离；协议完全复用 bridge.py 的 JSONL 模式（已验证）
- **MOSS-TTS-Nano 不进 V1**——仅中文男声、CPU 上首包延迟高于 Edge TTS、有 runaway silence 坑（陷阱#12）。Edge TTS 主用 + `say` 兜底已覆盖。全离线神经 TTS 是 V2+ 候选
- **MP3 直播，不转 WAV**——BabelLive 转 WAV 是为 ffmpeg 拼接多段；deskapp 按句顺序播放，Audio 元素原生吃 MP3，省掉 ffmpeg 依赖和转码延迟

---

## 3. STT 详细设计

### 3.1 为什么选 SenseVoiceSmall 而不是其他

| 方案 | 延迟 | 中文准确度 | 离线 | 成本 | 结论 |
|---|---|---|---|---|---|
| Web Speech API（#41A 现状） | 低 | 中 | ✗ 走 Google | 0 | 保留为降级档 |
| **SenseVoiceSmall** | 段末 ~300ms | **高**（中文专优，带情感/事件标签） | ✓ | 已缓存 | **V1 主选** |
| Whisper small/local | 中 | 中（中文弱于 SenseVoice） | ✓ | 需下载 | 不选 |
| FunASR Paraformer 流式 | 更低 | 高 | ✓ | 需下载+流式改造 | V2 候选（连续对话要真流式时） |

### 3.2 音频采集（渲染层，照搬 useMicCapture 已验证模式）

- `getUserMedia({audio})` 在 bubble renderer（**主进程没有 DOM API，陷阱#1**）
- 实际采样率从 `AudioContext.sampleRate` 读，线性重采样到 16kHz（浏览器不保证 honor 16kHz）
- ScriptProcessor buffer 取 2 的幂（陷阱#14：48000×40ms=1920 → 选 1024，21ms 块）
- **-38dB RMS 门控**（陷阱#9：-50 太松会放环境噪声进去）
- 输出 Int16 PCM → `voice:audio` IPC → main 写入 voice.py stdin
- onStateChange 用 useRef 存（陷阱#18：inline 回调导致无限 start/stop 循环）

### 3.3 voice.py ASR 侧

```
stdin:  二进制 PCM 块（按键期间持续）+ JSON 命令行
命令:   {"cmd":"asr_begin"} / {"cmd":"asr_end"} / {"cmd":"tts","text":..,"id":..} / {"cmd":"shutdown"}
stdout: {"type":"ready"} / {"type":"asr_final","text":..} / {"type":"tts_done","id":..,"path":..} / {"type":"error",..}
```

- 加载期 stdout 重定向 os.devnull（陷阱：FunASR 打印版本信息污染 JSONL）
- `language="zh"` 默认（陷阱#53：auto 在单语音频上产生日语假名伪影；用户主要说中文，设置项可切 auto）
- `torch.inference_mode()` + `torch.set_num_threads(8)` + `ncpu=8`（~15% 提速）
- `_clean_text()` 剥 `<|zh|><|NEUTRAL|>` 等标签再输出（陷阱#21）
- 按键说话不需要 partial——一次 `asr_end` 触发整段 `generate()`，1-5s 音频 CPU 上 ~300-600ms
- stdin 用 bytearray 累积对齐 int16（陷阱#33：os.read 不保证整块）

### 3.4 延迟预算（V1 按键说话）

| 阶段 | 耗时 |
|---|---|
| 松手 → PCM 全部到达 voice.py | <50ms |
| SenseVoiceSmall 推理（≤5s 音频，M 系 CPU） | 300-600ms |
| **说话→文字上屏** | **~0.5s** |
| LLM 首句流式到达 | 0.5-1.5s（取决于 provider） |
| Edge TTS 首句合成 | 300-600ms |
| **说话→宠物开口** | **~2-2.5s 感知延迟** |

---

## 4. TTS 详细设计

### 4.1 选型

| 方案 | 首包延迟 | 音质 | 离线 | 结论 |
|---|---|---|---|---|
| **Edge TTS**（edge-tts pip，免费） | ~300ms 流式 | 神经级，中英皆优（晓晓/Yunxi/Ava） | ✗ | **主选** |
| macOS `say`（ Tingting 中文） | <100ms | 机械 | ✓ 原生 | 离线兜底（一行调用，零依赖） |
| MOSS-TTS-Nano（本地 ONNX） | 较高（CPU） | 中文好，仅男声 | ✓ | V2 全离线候选；须带 8s 截断（陷阱#12）+ 音色白名单（陷阱#10） |

### 4.2 句子流水线（低感知延迟的核心）

```
agent ASSISTANT_DELTA 流 ─→ 句子切分器（。！？；\n 边界，缓冲不足一句则等）
   句1 ─→ voice.py tts ─→ tts_done{path:1.mp3} ─→ 立即播放
   句2 ─→ voice.py tts（与句1播放并行）─→ 排队
   句3 ─→ ...
```

- 切分器放 main 进程 voice-bridge.ts：订阅 agent 事件流（desktop-agent 已有 ASSISTANT_DELTA），按标点切句
- 每句一个 edge-tts 调用，输出临时 mp3（userData/voice/<hash>.mp3），播完即删
- **音色按文本内容选语言**（陷阱#11：检测 CJK 字符，中文→zh-CN-XiaoxiaoNeural，英文→en-US-AvaNeural）
- 宠物说话时动画：voice-bridge 推 `voice:speaking` 状态 → bubble 触发宠物嘴部/说话动效 + 气泡文字同步出现
- 播放用渲染层 `new Audio(file://)`（需 sandbox:false，现状已是）→ 或 main 注册自定义协议（V2 加固时）

### 4.3 Barge-in（打断，V1 简化版）

用户点 🎤 时：voice-bridge 停掉播放队列、清空待发 TTS、给 pet 发静音态。V1 不做"宠物讲话中检测到人声自动停"（那要 VAD 常开，归 V2）。

### 4.4 口型同步与肢体语言（交互的关键，v2 增补）

**播放位置调整**：TTS 音频改在**宠物窗口**播放（原计划在气泡窗）——说话的是宠物，口型驱动需要 `Audio` 元素与动画渲染同窗口，省掉 15Hz 的跨窗 IPC。

**口型 = 振幅包络驱动（不是音素 viseme）**：
```
pet 窗口: Audio(mp3) → MediaElementSource → AnalyserNode → getByteTimeDomainData
  → RMS (~15Hz) → mouthOpen ∈ [0,1] → 宠物嘴部缩放/开合
```
- AnalyserNode 是 Web Audio 原生件，10 行代码；与 #41A 麦克风音量条同一模式（coworker input_level 思路），一次实现两处复用
- RMS→mouthOpen 加指数平滑（attack 快 release 慢），嘴就不抖
- 卡通宠物只需要"张嘴程度"，不需要 8 种口型——Live2D 式 viseme 是过度工程，跳过
- 进阶留位：edge-tts 支持 WordBoundary 时间戳流，V2 若觉得"光张嘴不够生动"，用 `audio.currentTime` 对齐词边界做重音点头，成本仅几十行

**肢体语言/表情 = 事件流状态机（不从音频分析）**：
数据源早已存在——agent 事件流（P0-1 的 14 事件契约）+ 语音状态。映射表：

| 状态 | 来源事件 | 宠物表现 |
|---|---|---|
| 倾听 | 🎤 按下（mic active） | 身体前倾/耳朵竖起 + 实时音量条 |
| 思考 | TURN_START → 首个 ASSISTANT_DELTA | 转圈/冒泡思考动画 |
| 说话 | voice:speaking（播放中） | 口型（振幅驱动）+ 轻微身体摇摆 |
| 开心 | TURN_END 正常完成 | 短暂蹦跳（1s 内，不打扰） |
| 困惑 | ERROR / 审批被拒 | 歪头/问号 |
| 空闲 | 无事件 30s+ | 现有 idle 呼吸动画 |

状态推送走宠物窗口已有的状态通道（pet 状态机本来就在收 main 的推送），只加映射不加管线。

**用户情绪感知（白送的）**：SenseVoiceSmall 的 ASR 输出自带情感标签（`<|HAPPY|><|SAD|><|ANGRY|>` 等，剥标签时截获）——用户带着情绪说话，宠物先共情再回答（状态机加一个 empathy 表情槽）。零额外模型零延迟。

**明确跳过**：音素级 viseme 口型、word-boundary 同步、LLM 情感分析（多花一次 LLM 调用只为挑表情，不值）。升级信号 = 实机觉得"嘴型假"再接 WordBoundary。

### 4.5 成本控制

Edge TTS 免费无 key。`say` 零成本。全方案零 API 费用。

---

## 5. 从 BabelLive 继承的必带陷阱清单（实施时逐条核对）

1. 单 readline dispatcher 路由 message type + request id（**禁止** start() 和 synthesize() 各建 readline）
2. 模型加载期 stdout → /dev/null，ready 后再恢复
3. FunASR 输出必须 `_clean_text()` 剥 `<|..|>` 标签
4. language 用配置值，不信 FunASR 返回的 `"auto"` 字段
5. `torch.inference_mode()` 包裹所有 generate
6. TTS 音色按文本 CJK 检测选，不按 ASR language 字段
7. stdin 二进制用 bytearray 累积，int16 对齐（os.read 部分读）
8. subprocess 生命周期六规则（startPromise 设置/清理/wasReady 先捕获/_stopping 防重启/手动 start 清 restartTimer）
9. `before-quit` 必须 await voice-bridge.stop()，防孤儿 Python
10. `??` 不用 `||` 处理可能为 0 的数值字段
11. 主进程无 DOM：getUserMedia/Audio 播放全在渲染层
12. `??=` 语法 → 构建/启动必须 node v24（本机 /usr/local/bin/node 是 v14）

## 6. 权限与打包

- `session.setPermissionRequestHandler` 放行 `media`（main/index.ts 已有权限处理处加一条）
- 打包 Info.plist 补 `NSMicrophoneUsageDescription`（#43 build-dmg.sh 的 entitlements 一并）
- voice.py 依赖装进引擎 venv：`funasr modelscope edge-tts torch`（venv 无 pip，ensurepip 路径已走过一次——见全局记忆）；venv 重建须重装
- DMG 打包时 venv 不进 asar（#43 的 asarUnpack 已含 resources/**；venv 在 userData 外置，需加 voice 依赖安装说明或首启自举脚本）

## 7. 实施排期

| 批次 | 内容 | 工作量 |
|---|---|---|
| V1-a | venv 装依赖 + voice.py（ASR 单命令 + TTS edge/say）+ voice-bridge.ts + IPC | 1d |
| V1-b | useVoiceInput（PCM 采集/门控/IPC）接入 TaskInput 🎤（替换/降级 Web Speech） | 0.5d |
| V1-c | 句子切分 + 宠物窗口播放（AnalyserNode 振幅→口型）+ 表情状态机映射 + barge-in 简化版 | 1d |
| V1-d | 权限/打包/设置页（语音开关、音色、language）+ 实机调优 | 0.5d |
| V2 | Silero VAD 常听（512 帧/64 上下文/0-d sr 三铁律）+ 连续对话 + 自动打断 | 1.5d |
| V3 | 唤醒词（sherpa-onnx KWS） | 按需 |

**V1 合计 ~3d。** 验证：对宠物说"你好"→ 0.5s 上屏 → 2s 内宠物开口回答；断网 → `say` 兜底出声；连按打断无残留播放。
