#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate animated SVG feature demos for the DeskApp README (simulated UI).
Usage: python3 scripts/gen-demos.py   →  writes docs/demos/demo-{chat,workspace,dock}.svg
Palette follows the app: dark glass + emerald. CSS keyframes drive the loops.
"""
import os

BG = "#0b0f14"
PANEL = "rgba(255,255,255,0.05)"
EDGE = "rgba(255,255,255,0.14)"
EMERALD = "#34d399"
MUTED = "rgba(255,255,255,0.45)"
INK = "#e8edf2"
FONT = "-apple-system,'PingFang SC',sans-serif"

CSS = """
@keyframes fadeUp { from { opacity: 0; transform: translateY(14px) } to { opacity: 1; transform: none } }
@keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
@keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.35 } }
@keyframes blink { 0%,100% { opacity: 1 } 50% { opacity: 0 } }
@keyframes ring { 0% { transform: scale(0.6); opacity: 0.8 } 100% { transform: scale(1.6); opacity: 0 } }
@keyframes strandWave { 0%,100% { transform: rotate(-5deg); opacity: 0.45 } 50% { transform: rotate(5deg); opacity: 1 } }
        .st { animation: strandWave 2.2s ease-in-out infinite }
@keyframes slidePill { 0%,18% { transform: translateY(0) } 32%,52% { transform: translateY(44px) } 66%,86% { transform: translateY(88px) } 100% { transform: translateY(88px) } }
@keyframes flow1 { 0% { transform: translate(0,0); opacity: 0 } 8% { opacity: 1 } 35% { transform: translate(-65px,150px) } 60% { transform: translate(-185px,220px) } 90%,100% { transform: translate(-350px,360px); opacity: 0 } }
@keyframes flow2 { 0% { transform: translate(0,0); opacity: 0 } 8% { opacity: 1 } 30% { transform: translate(0px,70px) } 55% { transform: translate(125px,150px) } 80% { transform: translate(145px,310px) } 100% { transform: translate(145px,380px); opacity: 0 } }
.fu { animation: fadeUp 0.7s ease both }
.fi { animation: fadeIn 0.6s ease both }
.pu { animation: pulse 1.6s ease-in-out infinite }
.bl { animation: blink 0.9s step-end infinite }
.dot1 { animation: flow1 5s ease-in-out infinite }
.dot2 { animation: flow2 5s ease-in-out 2.5s infinite }
"""


def head(title: str, h: int = 600) -> str:
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 {h}" font-family="{FONT}" '
            f'style="background:{BG}">\n<style>{CSS}</style>\n'
            f'<title>{title}</title>\n')


def panel(x, y, w, h, rx=16, fill=PANEL, stroke=EDGE, sw=1):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>'


def txt(x, y, s, size=13, fill=MUTED, weight=400, anchor="start"):
    return (f'<text x="{x}" y="{y}" font-size="{size}" fill="{fill}" font-weight="{weight}" '
            f'text-anchor="{anchor}">{s}</text>')


def strands(x, y, r, colors=("#34d399", "#38bdf8", "#a78bfa")):
    """SVG 复刻 Strands WebGL 动画: 12 条放射线, cos 相位错开波动 (真实宠物默认样式)。"""
    import math
    out = []
    for i in range(12):
        a = i * math.pi * 2 / 12
        dx, dy = math.cos(a), math.sin(a)
        x1, y1 = x + dx * r * 0.25, y + dy * r * 0.25
        x2, y2 = x + dx * r * 0.98, y + dy * r * 0.98
        c = colors[i % len(colors)]
        out.append(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="{c}" stroke-width="1.8" stroke-linecap="round" class="st" style="transform-origin:{x}px {y}px;animation-delay:{i * 0.09}s"/>')
    return "".join(out)

def dot(x, y, r, color, cls=""):
    a = f' class="{cls}"' if cls else ""
    return f'<circle cx="{x}" cy="{y}" r="{r}" fill="{color}"{a}/>'


# ── demo 1: 桌面宠物 → 对话 → 思考时间线 → 回答 ──────────────────────────
def chat():
    d = [head("DeskApp 桌面宠物对话演示"), panel(20, 420, 160, 160, 80)]
    d.append(dot(100, 500, 46, "rgba(255,255,255,0.9)"))
    d.append(f'<g>{strands(100, 500, 46)}</g>')
    d.append(f'<g class="fu" style="animation-delay:.4s">{panel(300, 40, 620, 520, 24)}</g>')
    d.append(txt(330, 78, "DeskApp Agent", 15, INK, 700))
    d.append(f'<g class="fu" style="animation-delay:.7s">{dot(470, 72, 5, EMERALD)}</g>')
    d.append(txt(486, 76, "在线", 11))
    d.append(f'<g class="fu" style="animation-delay:1.1s">{panel(460, 100, 430, 44, 14, "rgba(255,255,255,0.10)")}</g>')
    d.append(txt(478, 126, "帮我看看 src/ 目录结构，解释各模块职责", 14, INK))
    d.append(f'<g class="fu" style="animation-delay:1.8s">{panel(330, 164, 200, 40, 14)}</g>')
    for i, dx in enumerate((0, 14, 28)):
        d.append(f'<circle cx="{360+dx}" cy="184" r="4" fill="{EMERALD}" class="pu" style="animation-delay:{2.0+i*0.15}s"/>')
    d.append(f'<g class="fu" style="animation-delay:2.6s">{panel(330, 222, 560, 34, 10)}</g>')
    d.append(txt(350, 244, "▶ 思考中…", 13, EMERALD))
    steps = [("🔍 工具调用", "搜索 src/ 目录"), ("📖 工具调用", "读取 package.json"), ("🧠 推理", "生成模块职责总结")]
    y0 = 284
    for i, (k, v) in enumerate(steps):
        d.append(f'<g class="fu" style="animation-delay:{3.2+i*0.9}s">')
        d.append(f'<rect x="330" y="{y0+i*52}" width="560" height="44" rx="10" fill="{PANEL}" stroke="{EDGE}"/>')
        d.append(txt(350, y0 + i * 52 + 28, k, 12, EMERALD, 600))
        d.append(txt(470, y0 + i * 52 + 28, v, 13, INK))
        d.append('</g>')
    d.append(f'<g class="fu" style="animation-delay:6s">{panel(330, 448, 560, 72, 14, "rgba(255,255,255,0.10)")}</g>')
    d.append(txt(350, 474, "src/ 包含 shared（IPC 通道定义）、main（Electron 主进程）、", 13, INK))
    d.append(txt(350, 494, "preload（桥接 API）与 renderer（React 界面）四层。", 13, INK))
    d.append(f'<g class="fu" style="animation-delay:6.6s">{panel(330, 540, 520, 36, 12)}</g>')
    d.append(txt(346, 563, "再问一个问题…", 12, MUTED))
    d.append(f'<rect x="806" y="544" width="28" height="28" rx="14" fill="{EMERALD}"/>')
    d.append(f'<text x="820" y="563" font-size="14" fill="#0b0f14" class="bl">■</text>')
    d.append(f'<text x="820" y="563" font-size="14" fill="#0b0f14" style="animation:fadeIn .1s 9s both">↑</text>')
    d.append("</svg>")
    return "\n".join(d)


# ── demo 2: Workspace 定时任务中心（模版 → 查看 → 甘特进度）───────────────
def workspace():
    d = [head("DeskApp 任务台 · 定时任务中心")]
    d.append(f'<g class="fi">{panel(16, 16, 200, 568, 20)}</g>')
    d.append(f'<rect x="40" y="40" width="36" height="36" rx="10" fill="{EMERALD}"/><text x="58" y="64" font-size="16" fill="#0b0f14" text-anchor="middle" font-weight="800">DA</text>')
    d.append(txt(88, 60, "DeskApp", 15, INK, 700))
    nav = ["创建任务", "查看任务", "任务进度", "任务模版"]
    for i, n in enumerate(nav):
        y = 130 + i * 44
        d.append(f'<g class="fu" style="animation-delay:{0.2+i*0.15}s">{panel(28, y, 176, 36, 10)}</g>')
        d.append(txt(52, y + 24, n, 13, INK if i == 0 else MUTED))
    d.append(f'<rect x="28" y="130" width="176" height="36" rx="10" fill="rgba(52,211,153,0.18)" stroke="{EMERALD}" '
             f'style="transform-origin:116px 148px;animation:slidePill 10s linear infinite"/>')
    d.append(f'<g class="fu" style="animation-delay:.5s">{panel(240, 16, 704, 64, 18)}</g>')
    d.append(txt(270, 48, "创建任务", 17, INK, 700))
    d.append(txt(270, 66, "一句话描述，或从模板一键创建", 11))
    d.append(f'<g class="fu" style="animation-delay:.8s">{panel(270, 84, 640, 40, 10, "rgba(255,255,255,0.09)")}</g>')
    d.append(txt(290, 109, "每天早晚盯盘并推送飞书…", 13, MUTED))
    tmpl = [("🔍", "定时搜索"), ("📊", "定时汇总"), ("📈", "定时盯盘"), ("🌐", "网页监控")]
    for i, (ic, t) in enumerate(tmpl):
        x = 270 + i * 158
        d.append(f'<g class="fu" style="animation-delay:{1.2+i*0.2}s">{panel(x, 140, 148, 76, 14)}</g>')
        d.append(txt(x + 16, 168, ic, 18))
        d.append(txt(x + 16, 194, t, 13, INK))
    d.append(f'<g class="fu" style="animation-delay:3.2s">{panel(270, 240, 640, 64, 14)}</g>')
    d.append(dot(296, 272, 5, EMERALD, "pu"))
    d.append(txt(316, 277, "AI泡沫动态", 14, INK, 600))
    d.append(txt(316, 293, "⏱ 0 9,17 * * *   ·   运行中   ·   下次 17:00", 11))
    d.append(f'<rect x="838" y="252" width="48" height="40" rx="10" fill="rgba(52,211,153,0.2)" stroke="{EMERALD}"/>')
    d.append(txt(862, 278, "⏸", 14, EMERALD, anchor="middle"))
    d.append(f'<g class="fu" style="animation-delay:5s">{panel(270, 330, 640, 220, 16)}</g>')
    d.append(txt(296, 362, "任务进度 · 近 14 天", 14, INK, 700))
    d.append(f'<line x1="296" y1="386" x2="884" y2="386" stroke="{EDGE}"/>')
    bars = [(400, 68), (470, 46), (560, 80), (640, 54)]
    for i, (x, w) in enumerate(bars):
        d.append(f'<g class="fu" style="animation-delay:{5.4+i*0.5}s">')
        d.append(txt(296, 424 + i * 30, ["搜索", "汇总", "盯盘", "推送"][i], 11))
        d.append(f'<rect x="{x}" y="{410+i*30}" width="{w}" height="12" rx="6" fill="{EMERALD}" opacity="0.85" '
                 f'style="transform-origin:{x}px {416+i*30}px;animation:growX 1s ease-out both;animation-delay:{5.8+i*0.5}s"/>')
        d.append('</g>')
    d.append(f'<line x1="700" y1="380" x2="700" y2="520" stroke="{EMERALD}" stroke-dasharray="4 4" class="pu"/>')
    d.append(txt(706, 378, "今天", 10, EMERALD))
    d.append("</svg>")
    return "\n".join(d)


# ── demo 3: 滚轮切换窗口 卡片运行/停止 ──────────────────────────────────
def dock():
    d = [head("DeskApp 滚轮切换窗口 · 卡片运行 / 停止")]
    cards = [("AI泡沫动态", "0 9,17 * * *", 0), ("每日要闻", "0 8 * * *", 1), ("定时汇总", "0 12 * * *", 2)]
    for title, cron, i in cards:
        x = 140 + i * 300
        active = i == 0
        scale = 1.08 if active else 0.9
        roty = -8 if active else -16
        d.append(f'<g class="fi" style="animation-delay:{i*0.3}s">')
        d.append(f'<g transform="translate({x},300) scale({scale}) rotate({roty})" style="transform-origin:120px 170px">')
        d.append(panel(-100, -170, 240, 340, 20, "rgba(255,255,255,0.07)" if active else "rgba(255,255,255,0.04)"))
        d.append(txt(-80, -130, title, 16 if active else 13, INK, 700))
        d.append(txt(-80, -108, f"⏱ {cron}", 11 if active else 10, MUTED))
        score, scol = ("66 运行中", EMERALD) if active else ("33 休眠", MUTED)
        d.append(txt(-80, -30, score, 26 if active else 18, scol, 800))
        if active:
            d.append(f'<circle cx="86" cy="130" r="22" fill="rgba(52,211,153,0.25)" stroke="{EMERALD}" stroke-width="2"/>')
            d.append(f'<text x="86" y="138" font-size="16" fill="{EMERALD}" text-anchor="middle" class="bl" '
                     f'style="animation-delay:2.5s">⏸</text>')
            d.append(f'<text x="86" y="138" font-size="16" fill="{EMERALD}" text-anchor="middle" '
                     f'style="animation:fadeIn .1s 4.5s both">▶</text>')
        else:
            d.append(f'<circle cx="86" cy="130" r="18" fill="rgba(255,255,255,0.1)" stroke="{EDGE}"/>')
            d.append(f'<text x="86" y="136" font-size="13" fill="{MUTED}" text-anchor="middle">▶</text>')
        d.append("</g></g>")
    d.append(f'<g class="fu" style="animation-delay:6s">')
    d.append(txt(480, 560, "滚轮切换卡片 · 点击活动卡片 = 运行 / 停止 · 关闭 = 彻底停止（无影子任务）", 12, MUTED, anchor="middle"))
    d.append("</g>")
    d.append("</svg>")
    return "\n".join(d)


# ── demo 4: 概述示意图 —— 宠物 → 点击 → 气泡 A/B → 任务树 → 设置条 ─────
def overview():
    d = [head("DeskApp 概述 · 宠物 → 气泡 → 任务树")]
    d.append(panel(20, 20, 920, 560, 24))
    # Pet (top-left, Strands WebGL wave — SVG 复刻: 12 条放射线相位波动)
    d.append(f'<g class="fi">{dot(80, 80, 40, "rgba(255,255,255,0.92)")}</g>')
    d.append(f'<g>{strands(80, 80, 40)}</g>')
    d.append(txt(80, 130, "🐾 桌面宠物", 12, INK, 600, anchor="middle"))
    d.append(txt(80, 147, "120px · WebGL 波浪", 10, MUTED, anchor="middle"))
    # Click arrow
    d.append(f'<g class="fu" style="animation-delay:.4s">{txt(80, 185, "↓ 点击", 12, EMERALD, 600, anchor="middle")}</g>')
    # Bubble A (left)
    d.append(f'<g class="fu" style="animation-delay:.8s">{panel(150, 210, 380, 320, 18)}</g>')
    d.append(txt(178, 242, "💬 气泡 A", 14, INK, 700))
    d.append(f'<g class="fu" style="animation-delay:1.1s">{panel(178, 262, 320, 40, 12, "rgba(255,255,255,0.10)")}</g>')
    d.append(txt(194, 287, "→ 分析项目结构", 13, INK))
    d.append(txt(178, 326, "← [任务树: 4 节点]", 12, EMERALD, 600))
    for i, (t, st) in enumerate([("搜索文件", "✓"), ("读取内容", "✓"), ("生成总结", "▶")]):
        d.append(f'<g class="fu" style="animation-delay:{1.6 + i * 0.9}s">')
        d.append(f'<rect x="178" y="{348 + i * 44}" width="300" height="36" rx="10" fill="{PANEL}" stroke="{EDGE}"/>')
        d.append(txt(196, 372 + i * 44, f"├ {t}", 12.5, INK))
        d.append(txt(456, 372 + i * 44, st, 12.5, EMERALD, 600, anchor="end"))
        d.append('</g>')
    # Bubble B (right)
    d.append(f'<g class="fu" style="animation-delay:1.2s">{panel(560, 210, 340, 320, 18)}</g>')
    d.append(txt(588, 242, "💬 气泡 B", 14, INK, 700))
    d.append(f'<g class="fu" style="animation-delay:1.5s">{panel(588, 262, 280, 40, 12, "rgba(255,255,255,0.10)")}</g>')
    d.append(txt(604, 287, "→ 今天天气", 13, INK))
    d.append(f'<g class="fu" style="animation-delay:1.9s">{txt(588, 330, "← [思考中", 12, EMERALD, 600)}')
    for i, dx in enumerate((56, 70, 84)):
        d.append(f'<circle cx="{588 + dx}" cy="326" r="4" fill="{EMERALD}" class="pu" style="animation-delay:{2.1 + i * 0.15}s"/>')
    d.append(']</g>')
    d.append(f'<g class="fu" style="animation-delay:3s">{panel(588, 430, 280, 60, 14, "rgba(255,255,255,0.10)")}</g>')
    d.append(txt(604, 468, "☀ 晴, 28°C · 湿度 40%", 13, INK))
    # Bottom strip
    d.append(f'<g class="fu" style="animation-delay:3.8s">{panel(40, 548, 880, 24, 12, "rgba(255,255,255,0.04)")}</g>')
    d.append(txt(480, 564, "⚙ 设置   |   托盘菜单   |   全局快捷键 Cmd+Shift+M", 11, MUTED, anchor="middle"))
    d.append("</svg>")
    return "\n".join(d)


# ── demo 5: 架构图 —— 窗口 → TaskRouter → 简单/复杂双路 → 任务树 ───────
def arch():
    d = [head("DeskApp 架构 · 双模型大脑与多气泡桥", 680)]
    d.append(panel(20, 20, 920, 640, 24))
    d.append(txt(480, 48, "DeskApp (Electron 39)", 15, INK, 700, anchor="middle"))
    wins = [("pet-window", "120px 圆 · WebGL 波浪"), ("hit-window", "拖拽 / 点击 · 透明叠加"), ("task-bubble", "380×320 · 毛玻璃"), ("settings-win", "设置面板")]
    for i, (n, desc) in enumerate(wins):
        x = 40 + i * 220
        d.append(f'<g class="fu" style="animation-delay:{0.2 + i * 0.15}s">{panel(x, 66, 190, 74, 12)}</g>')
        d.append(txt(x + 16, 94, n, 12.5, EMERALD, 700))
        d.append(txt(x + 16, 118, desc, 10.5, MUTED))
    # task-bubble → TaskRouter connector
    d.append(f'<g class="fi" style="animation-delay:.9s"><line x1="555" y1="140" x2="555" y2="210" stroke="{EDGE}" stroke-dasharray="4 4"/></g>')
    # TaskRouter
    d.append(f'<g class="fu" style="animation-delay:1s">{panel(480, 210, 220, 82, 14, "rgba(52,211,153,0.08)", EMERALD)}</g>')
    d.append(txt(590, 238, "TaskRouter", 13.5, INK, 700, anchor="middle"))
    d.append(txt(590, 260, "simple / complex 分级路由", 11, MUTED, anchor="middle"))
    # simple path: router → BridgeManager → bridge A / B
    d.append(f'<g class="fi" style="animation-delay:1.2s"><line x1="490" y1="292" x2="370" y2="360" stroke="{EDGE}" stroke-dasharray="4 4"/></g>')
    d.append(f'<g class="fu" style="animation-delay:1.4s">{panel(260, 360, 220, 82, 14)}</g>')
    d.append(txt(370, 388, "BridgeManager", 13, INK, 700, anchor="middle"))
    d.append(txt(370, 408, "Map&lt;id, bridge&gt; · 每气泡一进程", 10.5, MUTED, anchor="middle"))
    d.append(f'<g class="fi" style="animation-delay:1.6s"><line x1="330" y1="442" x2="210" y2="500" stroke="{EDGE}" stroke-dasharray="4 4"/><line x1="400" y1="442" x2="400" y2="500" stroke="{EDGE}" stroke-dasharray="4 4"/></g>')
    for i, (x, label) in enumerate([(130, "bridge.py (气泡 A)"), (320, "bridge.py (气泡 B)")]):
        d.append(f'<g class="fu" style="animation-delay:{1.8 + i * 0.2}s">{panel(x, 500, 180, 62, 12)}</g>')
        d.append(txt(x + 90, 526, label, 11.5, INK, 600, anchor="middle"))
        d.append(txt(x + 90, 546, "hermes-agent 进程", 10, MUTED, anchor="middle"))
    # complex path: router → Orchestrator → TaskTreePanel
    d.append(f'<g class="fi" style="animation-delay:1.3s"><line x1="690" y1="292" x2="690" y2="360" stroke="{EDGE}" stroke-dasharray="4 4"/></g>')
    d.append(f'<g class="fu" style="animation-delay:1.5s">{panel(580, 360, 300, 96, 14)}</g>')
    d.append(txt(730, 388, "Orchestrator", 13, INK, 700, anchor="middle"))
    d.append(txt(662, 414, "planner: kimi-k3", 11, MUTED))
    d.append(txt(662, 434, "worker: deepseek-v4-pro", 11, MUTED))
    d.append(f'<g class="fi" style="animation-delay:1.8s"><line x1="700" y1="456" x2="700" y2="510" stroke="{EDGE}" stroke-dasharray="4 4"/></g>')
    d.append(f'<g class="fu" style="animation-delay:2s">{panel(600, 510, 280, 110, 14)}</g>')
    d.append(txt(740, 538, "TaskTreePanel", 12.5, INK, 700, anchor="middle"))
    d.append(txt(740, 558, "任务树实时推送", 10.5, MUTED, anchor="middle"))
    for i, t in enumerate(["搜索文件 ✓", "读取内容 ✓", "生成总结 ▶"]):
        d.append(f'<g class="fu" style="animation-delay:{2.4 + i * 0.6}s"><rect x="624" y="{574 + i * 20}" width="230" height="16" rx="8" fill="{PANEL}" stroke="{EDGE}"/></g>')
        d.append(txt(634, 587 + i * 20, f"├ {t}", 10.5, INK))
    # flow dots
    d.append('<circle class="dot1" r="6" fill="#34d399" style="transform-origin:555px 160px"/>')
    d.append('<circle class="dot2" r="6" fill="#38bdf8" style="transform-origin:555px 160px"/>')
    d.append(txt(480, 668, "simple 请求走 BridgeManager → 独立 bridge.py；complex 走 Orchestrator → 任务树实时推送", 11, MUTED, anchor="middle"))
    d.append("</svg>")
    return "\n".join(d)


def main():
    out = os.path.join(os.path.dirname(__file__), "..", "docs", "demos")
    os.makedirs(out, exist_ok=True)
    for name, fn in (("demo-chat", chat), ("demo-workspace", workspace), ("demo-dock", dock), ("demo-overview", overview), ("demo-arch", arch)):
        p = os.path.join(out, f"{name}.svg")
        with open(p, "w") as f:
            f.write(fn())
        print("wrote", os.path.abspath(p), f"{os.path.getsize(p) // 1024}KB")


if __name__ == "__main__":
    main()
