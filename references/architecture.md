# 架构详解 — 七层骨架与模块依赖

> 本文档详述 Virtual Lab Forge 的分层架构，附 ChemAIForge 的真实模块映射。新学科套用时，只需替换①②③④的领域内容，⑤⑥⑦基本可复用。

---

## 一、七层总览与依赖方向

```
┌─────────────────────────────────────────────────────────────┐
│ ⑦ AI/教学层    server/ai/{tutor,report,config}             │  ← 有副作用(网络)
│   流式导师 · 结构化报告 · 配置优先级链                        │
├─────────────────────────────────────────────────────────────┤
│ ⑥ 画布/状态层   components/lab/{labStore,LabCanvas,...}     │  ← 有副作用(UI)
│   Zustand store 委托引擎计算 · 几何即数据                     │
├─────────────────────────────────────────────────────────────┤
│ ⑤ 模式判定层    labMode.ts · vesselGeom.ts                  │  纯函数
│   resolveLabMode 策略选择 · VESSELS 几何数据                 │
├─────────────────────────────────────────────────────────────┤
│ ④ 实体解析层    reagents.ts · reagentRules.ts               │  纯函数
│   自然语言标签 → 结构化 Entity                               │
├─────────────────────────────────────────────────────────────┤
│ ③ 数据目录层    data/experiments/*.ts (102 条)               │  纯数据
│   每条带 probe 自验证                                        │
├─────────────────────────────────────────────────────────────┤
│ ② 规则/模型层   lib/chem/rules/* (7 主题文件)              │  纯函数
│   有序规则集 match/build 二元组                              │
├─────────────────────────────────────────────────────────────┤
│ ① 领域引擎层    lib/chem/{engine,electrolysis,galvanic,...} │  纯函数
│   f(inputs, conditions) → result                            │
└─────────────────────────────────────────────────────────────┘
```

**依赖方向严格自上而下**：上层可调下层，下层绝不引用上层。① 不 import 任何其他层；⑥ 只 import ①④⑤；⑦ 只 import ①③的纯数据 + config。

> **关键纪律：①②③④⑤ 全是纯函数/纯数据，可 100% 单测。只有 ⑥⑦ 有副作用。** 这是 720 个测试用例能成立的前提。

---

## 二、各层职责与 ChemAIForge 映射

### ① 领域引擎层 — `src/lib/chem/`

四个互不依赖的纯函数引擎：

| 引擎 | 入口函数 | 输入 | 输出 | 用途 |
|---|---|---|---|---|
| 混合反应 | `react(substances, conditions)` | 物质数组+温度 | `ReactionResult` | 酸碱/沉淀/产气/氧化还原 |
| 电解 | `electrolyze(formula, {inertAnode})` | 电解质化学式 | 两极产物+现象 | 电解水/电解氯化铜 |
| 原电池 | `galvanicCell(metals, electrolyte)` | 金属数组+电解质 | 正负极+电流方向 | 原电池/电化学腐蚀 |
| 导电性 | `conductivity(substance)` | 单一物质 | 灯泡亮度+说明 | 强弱电解质对比 |

**引擎只输出"语义现象"（产气/沉淀/变色/热效应/pH趋势），绝不输出像素/动画。** 把"语义→视觉"的映射留给画布层。

### ② 规则/模型层 — `src/lib/chem/rules/`

```
rules/
├── helpers.ts       # 共享类型 Reaction + 工具函数(hasCategories/hasFormula...)
├── precipitation.ts # 沉淀规则
├── redox.ts         # 氧化还原规则
├── gas.ts           # 产气规则
├── metal.ts         # 金属反应规则
├── organic.ts       # 有机反应规则
├── coordination.ts  # 配位规则
└── index.ts         # 聚合 extendedReactions
```

`reactions.ts` 聚合基础 3 条 + 扩展规则，**按特异性排序**：特异性强的（如氯化银沉淀）排前，通用兜底（酸碱中和）排后。

### ③ 数据目录层 — `src/data/experiments/`

```
data/experiments/
├── types.ts          # ExperimentSeed / ReactionProbe / ReactionExpectation
├── acid-base.ts      # 13 条酸碱实验
├── gas.ts            # 气体实验
├── precipitation.ts  # 沉淀实验
├── redox.ts          # 氧化还原实验
├── metal.ts          # 金属实验
├── coordination.ts   # 配位实验
├── organic.ts        # 有机实验
├── thermo.ts         # 热力学实验
├── analysis.ts       # 分析实验
├── index.ts          # 聚合 allExperiments (102 条)
├── catalog.test.ts   # 目录完整性测试
└── probe.test.ts     # ★ probe 自验证测试（每条实验喂引擎断言现象）
```

**每条实验是一行纯数据。加实验 = 加一行数据，不改任何代码。**

### ④ 实体解析层 — `src/components/lab/reagents.ts` + `reagentRules.ts`

`resolveSubstance(label: string): Substance` 把"0.1 mol/L 盐酸标准液"解析为 `{formula:"HCl", category:"acid"}`。

- 顺序敏感：具体物质（硝酸银→盐）排在通用类别（含"酸"字→acid）之前
- 无法识别归 `other` 类，仍可拖入但不触发反应

### ⑤ 模式判定层 — `labMode.ts` + `vesselGeom.ts`

- `resolveLabMode(apparatus, substances): LabMode` — 策略选择唯一操作模式
- `VESSELS: Record<VesselKind, VesselGeom>` — 烧杯/锥形瓶/试管的立体几何参数（内壁裁剪路径/液面范围/气泡位置/刻度…），**画布渲染只读此数据**

### ⑥ 画布/状态层 — `src/components/lab/`

- `labStore.ts` (Zustand)：托管 contents/result/readings/sessionId，**`mix()` 调用引擎 `react()`，store 本身不含任何反应规则**
- `LabCanvas.tsx`：据 `resolveLabMode` 分支渲染对应装置
- `Glassware.tsx`：读 `VESSELS` 几何渲染立体器皿 + 现象
- `lesson/`：讲解播放器 + 大纲
- `sessionClient.ts`：旁路记录步骤/读数到后端（失败静默）

### ⑦ AI/教学层 — `src/server/ai/`

- `config.ts`：CC Switch 数据库 → 环境变量 → 可读错误
- `tutor.ts`：`buildTutorPrompt` 构造请求体 + `streamTutorReply` 流式 SSE 生成器
- `report.ts`：`buildReportPrompt` + `generateReport` 非流式 + 容错 JSON 解析
- `validation.ts`：输入校验

API 路由：`app/api/ai/tutor/route.ts`（流式）、`app/api/sessions/[id]/report/route.ts`（报告）。

---

## 三、数据流：一次"混合"操作的全链路

```
用户点击"混合"
  │
  ▼
labStore.mix()
  │  contents = [{HCl},{NaOH}]
  ├─→ react(contents)              [①引擎] 纯函数计算
  │     → ReactionResult{reacted:true, thermal:"exothermic", phTrend:"neutral", ...}
  ├─→ deriveReadings(prev, result) [⑥] 语义→具体数值(pH→7, temp+15)
  │
  ├─→ set({result, readings})     [⑥] 更新 UI 状态 → 画布重渲染
  │
  └─→ (旁路) appendStepRemote + appendMeasurementRemote  [⑥→后端]
        │
        ▼
      ExperimentSession.steps/measurements  (append-only JSON)
        │ （实验完成后）
        ▼
      generateReport(experiment, session)  [⑦AI] 汇总 steps+measurements
        → ExperimentReport{conclusion, errorAnalysis, improvements, ...}
```

**关键：引擎调用是同步纯函数，记录是旁路 async（不阻塞 UI）。**

---

## 四、讲解驱动的全链路

```
LessonPlayer 挂载
  │
  ├─→ buildLesson(seed)            [⑥] 从纯数据自动派生 LessonStep[]
  │     每步 {phase, narration, action?}
  │
  ├─→ 跳到第 N 步：确定性重放
  │     reset() → 依次执行 steps[0..N].action (add/mix/energize)
  │     保证画布状态与讲解严格一致
  │
  └─→ 播放口播：audioSrc(text, voice) → <audio> 取预生成 mp3
        失败 → speechSynthesis → 字数计时
```

---

## 五、新学科套用清单

替换以下领域内容，其余骨架基本复用：

| 要替换的 | 学科示例（物理电路） |
|---|---|
| ① 引擎 | `simulateCircuit(components, voltage)` → 电流/功率/断路 |
| ② 规则 | 欧姆定律/串并联/短路判定规则 |
| ③ 目录 | 电路实验数据（带 probe：给定元件断言电流值） |
| ④ 解析 | "10Ω 电阻" → `{kind:"resistor", value:10, unit:"Ω"}` |
| ⑤ 模式 | `resolveMode`：直流/交流/谐振 |
| ⑥ 几何 | 电路板布局几何数据 |
| ⑦ AI | system prompt 改为"资深物理导师"，上下文注入电路状态 |

其余：store 委托引擎、讲解自动派生、AI 流式/结构化、TTS 预生成——**全部通用，无需改**。
