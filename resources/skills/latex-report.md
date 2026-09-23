# LaTeX 技术方案报告生成 (latex-report)

将技术方案 / 设计方案 / 研究报告内容转化为规范中文 LaTeX 文档并编译为 PDF。
完整参考实现：`~/2026/14-projects/15-热回收焦炉/方案设计/fangan.tex`（949 行，含封面+水印+MPC 公式+JSON 指令块），小文档示例同目录 `note/note.tex`。

## 工作流总览

内容提取 → 结构映射到 LaTeX → 套用模板（ctexrep）→ xelatex 编译 → 验证 PDF

## 1. 内容提取

- 源为 .docx：
  ```bash
  python3 -c "from docx import Document; d=Document('x.docx'); [print(p.style.name, '|', p.text) for p in d.paragraphs]"
  ```
  按 style 名映射层级：Heading 1→`\chapter`，Heading 2→`\section`，Heading 3→`\subsection`，正文段落原样搬运。
- 源为 markdown：`#`→chapter，`##`→section，`###`→subsection。
- 源为纯需求描述/口头需求：先自拟章节骨架（背景→现状→总体架构→详细设计→接口→效益），再逐节填充。

## 2. 结构映射规则

- 章节：`\chapter{...}` / `\section{...}` / `\subsection{...}`；每章开头空一行，正文段落间空一行。
- 公式：单行 `\[ ... \]`，多行 `align*`；变量用 `_{}` 下标；公式下方必须跟"其中：…"逐符号解释段（中文字段用 `\text{}` 或全角）。
- 表格：booktabs 三线表 `\begin{tabular}{...}`，行用 `\toprule / \midrule / \bottomrule`。
- JSON / 代码：`\begin{lstlisting}` 环境原样贴（模板已配样式，自动断行加行号）；正文中出现的下划线密集标识符（如 JSON 字段）用 `\seqsplit{...}` 防溢出。
- 强调术语 `\textbf{}`；URL `\url{}`（hyperref 已配蓝色链接）。

## 3. 模板骨架（ctexrep + xelatex，直接复用）

文档类与前导（从 fangan.tex 提炼，`标题`处替换为实际报告标题）：

```latex
\documentclass[paper=a4,fontsize=12pt]{ctexrep}
\usepackage{geometry}\geometry{a4paper,left=2.5cm,right=2.5cm,top=3cm,bottom=2.5cm}
\usepackage{setspace}\onehalfspacing
\usepackage{fancyhdr}\pagestyle{fancy}\fancyhf{}
\fancyhead[L]{\small\kaishu 报告标题}
\fancyhead[R]{\small\thepage}\renewcommand{\headrulewidth}{0.5pt}
\usepackage[colorlinks=true,linkcolor=blue]{hyperref}
\usepackage{amsmath,amssymb,mathtools}
\usepackage{seqsplit}
\allowdisplaybreaks
\sloppy
\usepackage{tikz}\usetikzlibrary{calc,shadows,fadings,decorations.pathmorphing,patterns,backgrounds}
\usepackage{xcolor,titlesec,enumitem}
\setcounter{tocdepth}{2}
\usepackage{eso-pic}
\AddToShipoutPictureBG{%
  \begin{tikzpicture}[remember picture,overlay]
    \foreach \x in {1,5,...,21} \foreach \y in {2,6,...,30}
      \node[rotate=45,text=gray!35,font=\sffamily\footnotesize] at ([xshift=\x cm,yshift=\y cm]current page.south west) {水印文字};
  \end{tikzpicture}}
\definecolor{fo}{RGB}{255,120,20}\definecolor{fy}{RGB}{255,200,50}
\definecolor{fr}{RGB}{220,40,20}\definecolor{db}{RGB}{10,10,20}
\definecolor{sb}{RGB}{40,80,140}\definecolor{gd}{RGB}{200,160,40}
\definecolor{redColor}{RGB}{227,0,26}
\definecolor{greenColor}{RGB}{0,120,31}
\definecolor{grayColor}{RGB}{32,32,32}
\definecolor{TitleGreen}{RGB}{0,120,55}
\usepackage{graphicx}
\usepackage{array}
\usepackage{listings}
\usepackage{booktabs}
\usepackage{multirow}

% ---- listings 代码块配置 ----
\definecolor{codebg}{RGB}{248,248,252}
\definecolor{codeframe}{RGB}{200,200,220}
\lstset{
  basicstyle=\footnotesize\ttfamily,
  backgroundcolor=\color{codebg},
  frame=single,
  rulecolor=\color{codeframe},
  framerule=0.5pt,
  breaklines=true,
  numbers=left,
  numberstyle=\tiny\color{gray},
  numbersep=5pt,
  tabsize=2,
  showstringspaces=false,
  keywordstyle=\color{sb}\bfseries,
  commentstyle=\color{grayColor}\itshape,
  stringstyle=\color{redColor},
  captionpos=b,
  aboveskip=8pt,
  belowskip=8pt,
}
\titleformat{\chapter}[display]{\normalfont\huge\bfseries\sffamily}{\color{sb}第\thechapter 章}{20pt}{\Huge}
\titleformat{\section}{\normalfont\Large\bfseries\sffamily\color{sb}}{\thesection}{1em}{}
\titleformat{\subsection}{\normalfont\large\bfseries\sffamily\color{sb!80}}{\thesubsection}{1em}{}
```

封面（双 logo + 绿标题 + 目录重起页码，`主标题/副标题/文档类型/单位`处替换）：

```latex
\begin{document}
\newgeometry{left=30mm,right=30mm,top=25mm,bottom=25mm}
\begin{titlepage}
\thispagestyle{empty}
\setlength{\parindent}{0pt}
\begin{flushright}
\includegraphics[height=1.5cm]{logo1.png}
\hspace{0.5cm}
\vrule height 1.4cm width 0.4pt
\hspace{0.5cm}
\includegraphics[height=1.5cm]{logo2.png}
\end{flushright}
\vspace{6cm}
{\color{TitleGreen}\fontsize{32}{38}\selectfont\sffamily 主标题}
\vspace{0.6cm}
{\color{TitleGreen}\Large\sffamily 副标题}
\vspace{2cm}
\large 文档类型（技术方案）
\vspace{1cm}
副描述（基于xxx技术 · 双驱动）
\vspace{0.2cm}
\small 附加说明行
\vspace{3cm}
\large 作者/单位
\vspace{0.2cm}
\today
\vfill
\end{titlepage}
\restoregeometry
\cleardoublepage
\pdfbookmark[0]{目录}{toc}
\tableofcontents
\newpage
\setcounter{page}{1}
% 正文从这里开始: \chapter{...}
\end{document}
```

## 4. 编译

```bash
# 方式A：直接 xelatex（必须编译 2~3 遍，让目录/交叉引用/页码收敛）
xelatex -interaction=nonstopmode -synctex=1 main.tex   # 第1遍 生成 aux
xelatex -interaction=nonstopmode -synctex=1 main.tex   # 第2遍 目录生效
xelatex -interaction=nonstopmode -synctex=1 main.tex   # 第3遍 页码稳定（可选）

# 方式B：latexmk（自动多遍，推荐）
latexmk -xelatex main.tex
```

`.latexmkrc`（放 tex 同目录）：

```latex
$xelatex = 'xelatex -interaction=nonstopmode -synctex=1 %O %S';
$pdf_mode = 1;
```

## 5. 验证（必须，逐项确认）

1. `grep -E "^!|Error" main.log` — 无致命错误（`Overfull` 警告可忽略，模板已 `\sloppy`）
2. PDF 已生成、页数合理：`pdfinfo main.pdf | grep Pages`（或 python fitz）
3. 目录页章节齐全 — 只编 1 遍时目录缺失，必须重编
4. 抽查：封面 logo/标题、页眉标题与页码、公式渲染、表格不溢出、JSON 块无乱码
5. 确认图片文件与 tex 同目录（`\includegraphics` 找不到图只出警告不出错）

## 常见坑

- ctexrep 必须 xelatex 编译；pdflatex 报中文字体错误。
- 特殊字符须转义：`& % # _ { }` → `\& \% \# \_ \{ \}`；`^`/`~` 用 `\textasciicircum`/`\textasciitilde`。
- 下划线密集的标识符放 lstlisting 或 `\seqsplit{}`，直接写正文会溢出/变下标。
- 公式变量解释段：LaTeX 中文与数学混排时，中文用全角标点，变量 `$x$` 行内公式。
- 编译报 `Missing character` = 字体缺字形，改用 ctex 自带字体或 \kaishu/\songti 族。
- 正文从封面后重计页码：`\setcounter{page}{1}` 必须在 `\tableofcontents` 之后。
