---
name: "virtual-lab-forge"
description: "Build AI-driven virtual experiment platforms with pure-function domain engines, data-driven catalogs, auto lessons, and AI tutor/report. Use when creating virtual labs or AI-guided educational simulators for any discipline."
---

# Virtual Lab Forge — AI 驱动的虚拟实验/仿真教学平台构建法

> 从 [ChemAIForge](https://github.com/zhangifonly/ChemAIForge)（AI 驱动的化学虚拟实验平台，102 个实验、四套纯函数化学引擎、立体实验台、分步语音讲解、AI 导师与实验报告）提炼而成的**通用方法论**。适用于把任意学科（化学/物理/生物/电子/工程仿真…）构建为"浏览器里能做实验、AI 能教能评"的交互式教学平台。

---

## 0. 何时调用本 Skill

**触发场景（任一即应调用）：**
- 用户要做"虚拟实验/仿真平台/在线实验室/数字孪生教学系统"
- 用户要做"AI 导师 / AI 实验报告 / AI 批改"类教育产品
- 用户要做"分步讲解 + 语音口播 + 自动演示"的交互式课件
- 用户要把某学科知识做成"可拖拽、可混合、有真实现象反馈"的可交互画布
- 用户提及类似项目（ChemAIForge、mathviz、PhET 交互仿真）并希望复刻其架构

**不要用于：** 纯静态图文课件、无仿真的题库系统、无领域逻辑的通用 CRUD。

---

## 1. 核心理念：让"知识"变成"可计算的引擎"

传统教育产品的致命缺陷：**现象是写死的、实验是脚本播的、AI 是脱离上下文瞎聊的**。

本方法论的立身之本是三层分离：

```
   知识 ──→ 纯函数引擎（可计算、可测试、可复用）
              │ 驱动
              ▼
   画布 ──→ 数据驱动的可视化（一处引擎改动，覆盖全部实验）
              │ 注入上下文
              ▼
    AI  ──→ 结合"当前真实实验台状态"的教学（不胡说，能点评）
```

**只要引擎是真的，102 个实验就能共享一套界面、一套讲解、一套 AI——改一处全覆盖。** 这是本项目把 102 个实验做到可维护的唯一原因。

---

## 2. 七层架构（通用骨架）

任何学科套用此骨架，只需替换"领域层"内容：

| 层 | 职责 | ChemAIForge 对应 | 通用化要点 |
|---|---|---|---|
| ① 领域引擎层 | 纯函数计算"输入→现象/产物" | `lib/chem/{engine,electrolysis,galvanic,conductivity}` | **零副作用、零 IO、可单测** |
| ② 规则/模型层 | 引擎内部的判定规则集 | `lib/chem/rules/*` + `reactions.ts` | 有序规则 + match/build 二元组 |
| ③ 数据目录层 | 全部实验/场景的纯数据定义 | `data/experiments/*.ts` (102 条) | 每条带 `probe` 自验证 |
| ④ 试剂/实体解析层 | 自然语言标签 → 引擎实体 | `reagents.ts` + `reagentRules.ts` | 解析与反应判定**严格分离** |
| ⑤ 模式判定层 | 据器材/实体选唯一操作模式 | `labMode.ts` + `vesselGeom.ts` | 策略模式，优先级固定 |
| ⑥ 画布/状态层 | UI 状态托管，委托引擎计算 | `labStore.ts`(Zustand) + `LabCanvas` | store 不含任何领域规则 |
| ⑦ AI/教学层 | 结合上下文的导师 + 报告 | `server/ai/{tutor,report,config}` | 流式问答 + 结构化报告 |

**记住：①②③④⑤ 都是纯函数/纯数据，只有⑥⑦ 有副作用。** 这保证了 720 个单测能跑、改实验不用改代码。

---

## 3. 六大可复用模式（含落地要点）

### 模式 A：纯函数领域引擎（最重要）

把学科逻辑做成 `f(inputs, conditions) → result` 的纯函数。**引擎不知道 UI、不知道数据库、不知道 AI。**

```ts
// 通用范式：输入实体 + 条件 → 结构化结果
export interface DomainResult {
  occurred: boolean;          // 是否发生
  products: Entity[];        // 产物/后继状态
  observables: {              // 可视化要的现象维度
    gas?: boolean; precipitate?: boolean; colorChange?: boolean;
    thermal?: "exothermic" | "endothermic" | "none";
  };
  equation?: string;          // 可读描述
  description?: string;       // 现象描述
}
export function simulate(inputs: Entity[], conditions = {}): DomainResult { ... }
```

**关键纪律：**
- 引擎**只**接收已解析的结构化实体，绝不接收中文字符串
- 结果用"语义维度"（产气/沉淀/变色/热效应/pH 趋势）描述，**不要直接给像素/动画**——让画布自己把语义映射成视觉
- 多个引擎并存（混合/电解/原电池/导电性），各自纯函数，互不依赖

详见 `references/domain-engine.md`。

### 模式 B：有序规则集 + match/build 二元组

领域判定用"规则数组按序匹配，命中第一条即返回"：

```ts
export interface Rule<E, R> {
  id: string;
  match: (inputs: E[]) => boolean;     // 是否触发
  build: (inputs: E[], cond: Conditions) => Omit<R, "occurred">; // 生成结果
}
export const rules: Rule[] = [
  // 特异性强的排前面，通用兜底排后面
];
```

**扩展只靠加规则文件，不动引擎主入口。** ChemAIForge 的 `rules/` 下按主题分文件（酸碱/沉淀/氧化还原/有机/配位/气体/金属），每个文件导出规则，`rules/index.ts` 聚合。

### 模式 C：数据驱动目录 + 探针自验证（可维护性的核心）

**每个实验是一行纯数据，不是一段代码。** 关键发明是 `probe`（探针）：

```ts
export interface ExperimentSeed {
  slug: string; title: string; description: string;
  category: Category; difficulty: Difficulty;
  reagents: string[];     // 自然语言标签
  apparatus: string[];    // 仪器标签
  objectives: string[]; estimatedMinutes: number;
  probe?: {               // ★ 自验证探针
    reagentKeys: string[];        // 经解析层喂给引擎
    expect: { occurred: boolean; gas?: boolean; precipitate?: boolean; ... };
  };
}
```

`probe` 的意义：**测试里把 `reagentKeys` 解析后送进引擎，断言产出现象与 `expect` 一致**——这从机制上保证"每个实验在系统里真能反应"，不会出现"配了试剂但引擎根本不认"的死实验。ChemAIForge 102 个实验全部过 probe 测试。

详见 `references/data-driven-catalog.md`。

### 模式 D：解析层与判定层严格分离

```
自然语言标签("0.1 mol/L 盐酸标准液")
        │ resolveSubstance()  ← 只描述"物质是什么"
        ▼
结构化实体 { formula:"HCl", category:"acid" }
        │ 喂给引擎            ← 只判定"会发生什么"
        ▼
反应结果
```

- 解析层（`reagents.ts`）：关键字 → 化学式/类别，**顺序敏感**（具体盐要排在通用"酸"之前，否则"硝酸银"被误判为酸）
- 判定层（引擎）：只认结构化实体，**不含任何中文关键字**

这一分离让"加试剂"和"判定反应"各自独立演进、独立测试。

### 模式 E：模式判定（策略）+ 几何即数据

画布要支持多种装置（烧杯/试管/电解槽/原电池…），用**一个纯函数**据器材+实体选唯一模式：

```ts
export type LabMode = "conductivity" | "electrolysis" | "galvanic" | "mixing";
export function resolveLabMode(apparatus: string[], substances: Entity[]): LabMode {
  // 优先级固定：导电性 > 电解 > 原电池 > 混合(默认)
  if (usesConductivity(apparatus)) return "conductivity";
  if (isElectrolysisSetup(apparatus) && substances.some(isElectrolyte)) return "electrolysis";
  if (isGalvanicSetup(apparatus) && substances.some(isGalvanicMetal)) return "galvanic";
  return "mixing";
}
```

装置形状也做成纯数据（`VESSELS: Record<kind, VesselGeom>`），液面/气泡/沉淀位置都按几何自适应计算。**画布渲染只读几何数据，不含判定逻辑。**

### 模式 F：自动派生讲解 + TTS 预生成

**不为每个实验写讲解脚本。** 一个 `buildLesson(seed) → LessonStep[]` 纯函数，从实验数据自动生成"原理→准备→操作→现象→结论"五阶段讲解，每步带一句口播 + 一个驱动画布的动作：

```ts
export interface LessonStep {
  id: string; phase: "原理"|"准备"|"操作"|"现象"|"结论";
  title: string; narration: string;       // 口播文本
  action?: { kind:"reset" } | { kind:"add"; reagent:string } | { kind:"mix" } | { kind:"energize" };
}
```

播放器做**确定性重放**：跳到第 N 步时，从头执行到第 N 步的所有 action，保证画布状态与讲解严格一致（不会"讲到混合却没混合"）。

TTS 用 edge-tts 离线预生成 mp3，文件名 = 文本哈希，播放时 `<audio>` 取用；mp3 缺失回退 `speechSynthesis`；都不可用按字数计时推进。生成脚本带重试 + 空文件清理。

详见 `references/lesson-and-tts.md`。

---

## 4. AI 集成三件套（通用模板）

### 4.1 AI 导师：流式问答 + 上下文注入

- **system prompt 注入当前实验上下文**（标题/目标/试剂/难度），让 AI 不脱离场景
- 可选：注入"当前实验台实时状态"（容器里有什么、最近反应结果、读数），AI 能点评"你刚加的 X 和 Y 会…"
- 用 SSE 流式逐块产出，AbortController 超时控制
- 输出格式约束：Markdown，化学式用行内代码，安全提示用引用块

### 4.2 AI 报告：结构化 JSON + 容错解析

- 非流式调用，system prompt **强制只返回 JSON 对象**（禁止 markdown 代码块）
- 把会话的 steps + measurements 汇总成可读统计喂给模型
- 容错解析：剥离可能的 ```json 标记后 `JSON.parse`，校验关键字段，缺失字段给默认值

### 4.3 配置读取：优先级链 + 严禁硬编码 Key

```
CC Switch 数据库(当前激活 provider) → 环境变量兜底 → 抛可读错误
```

**绝不硬编码 apiKey。** 任一环节异常都回退，最终缺失抛"请配置 X"的可读错误，而非下游空配置崩溃。

详见 `references/ai-integration.md`。

---

## 5. 会话记录：为 AI 报告蓄水

实验过程旁路记录（**不阻塞交互**）：
- `steps`：每次操作（add/mix/reset/energize）+ 详情 + 时间戳
- `measurements`：每次混合后的读数快照（pH/温度）

二者都是 append-only JSON 数组，最终汇总喂给 AI 报告生成器。失败静默忽略（记录是增强，不是主路径）。

---

## 6. 技术栈选型（经实战验证的组合）

| 关注点 | 选型 | 理由 |
|---|---|---|
| 全栈框架 | Next.js 14 (App Router) | 页面+API 同仓，SSR/流式都方便 |
| 语言 | TypeScript (strict) | 引擎纯函数强类型是质量底线 |
| 样式 | Tailwind CSS + typography 插件 | 快速 + Markdown 渲染 |
| 状态 | Zustand | 轻量、store 委托引擎计算 |
| 数据库 | SQLite + Prisma（零配置） | 单文件、零运维；JSON 字段存数组 |
| AI | Claude Messages API（流式+非流式） | 导师流式、报告结构化 |
| 语音 | edge-tts 离线预生成 mp3 | 高音质、零运行时依赖、可回退 |
| 测试 | Vitest | 纯函数引擎/解析/讲解全可测 |

---

## 7. 落地新学科的步骤

1. **建领域引擎**：定义 `Entity` / `Conditions` / `DomainResult`，写 `simulate()` 纯函数 + 规则集
2. **建解析层**：自然语言标签 → `Entity`，注意顺序敏感性
3. **建数据目录**：每条实验带 `probe`（自验证），先写 5-10 条跑通闭环
4. **建模式判定**：若多装置，写 `resolveLabMode`
5. **建画布**：store 委托引擎，几何即数据
6. **建讲解**：`buildLesson` 从数据自动派生
7. **接 AI**：导师流式 + 报告结构化 + 配置优先级链
8. **加 TTS**：预生成脚本 + 播放回退链
9. **补测试**：引擎规律 / 试剂解析 / 讲解生成 / probe 自验证，目标全绿

---

## 8. 参考文档（按需深读）

- [`references/architecture.md`](references/architecture.md) — 七层架构详解 + 模块依赖图
- [`references/domain-engine.md`](references/domain-engine.md) — 纯函数引擎 + 规则系统 + 模式判定完整范式
- [`references/data-driven-catalog.md`](references/data-driven-catalog.md) — 数据目录 + probe 自验证 + 解析层分离
- [`references/ai-integration.md`](references/ai-integration.md) — AI 导师/报告/配置三件套 + 流式 SSE 解析
- [`references/lesson-and-tts.md`](references/lesson-and-tts.md) — 讲解自动派生 + 确定性重放 + TTS 预生成
- [`references/code-templates.ts`](references/code-templates.ts) — 可直接套用的 TypeScript 代码模板

---

## 9. 红线（务必遵守）

1. **引擎必须是纯函数**——任何副作用（DB/网络/随机）都不得进入 ①②③④⑤ 层
2. **解析层与判定层分离**——引擎不认中文字符串，只认结构化实体
3. **实验是数据不是代码**——加实验 = 加一行数据，绝不改引擎/画布
4. **每条实验带 probe 自验证**——防止"配了试剂但引擎不认"的死实验
5. **严禁硬编码 API Key**——用优先级链 + 可读错误
6. **store 不含领域规则**——只托管 UI 状态，计算委托引擎
7. **讲解自动派生**——不为单个实验写讲解脚本
8. **全程可测**——纯函数层 100% 可单测，是质量底线

> 参考实现：[github.com/zhangifonly/ChemAIForge](https://github.com/zhangifonly/ChemAIForge)（MIT, 720 测试用例, 102 实验）
