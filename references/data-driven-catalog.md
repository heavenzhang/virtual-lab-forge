# 数据驱动目录 + Probe 自验证 + 解析层分离

> 本文档详述可维护性的核心机制：实验是纯数据、probe 自验证、解析与判定分离。

---

## 一、实验是数据，不是代码

传统做法每个实验写一段脚本/组件 → 100 个实验 = 100 份代码，维护噩梦。

本方法论：**每个实验是一行纯数据**，全部实验共享一套引擎、一套画布、一套讲解。加实验 = 加一行数据。

### 数据结构（通用范式）

```ts
export interface ExperimentSeed {
  slug: string;            // URL 标识
  title: string;           // 标题
  description: string;     // 简介（讲解的"原理"步骤直接用）
  category: Category;      // 分类
  difficulty: Difficulty;  // 难度
  reagents: string[];      // 自然语言试剂标签（用户可见）
  apparatus: string[];     // 仪器标签（驱动模式判定与器皿选择）
  objectives: string[];    // 目标（讲解"结论"步骤 + AI 报告评估依据）
  estimatedMinutes: number;
  probe?: ReactionProbe;   // ★ 自验证探针（纯观察类可省略）
}
```

### ChemAIForge 真实示例（酸碱类一条）

```ts
{
  slug: "hcl-naoh-neutralization",
  title: "盐酸与氢氧化钠中和热测定",
  description: "在保温杯量热计中测定盐酸与氢氧化钠反应的中和热，理解放热反应能量变化。",
  category: C.ACID_BASE,
  difficulty: D.MEDIUM,
  reagents: ["盐酸", "氢氧化钠", "蒸馏水"],
  apparatus: ["量热计", "温度计", "量筒", "环形玻璃搅拌棒"],
  objectives: ["测定中和热", "理解放热反应", "分析实验误差来源"],
  estimatedMinutes: 40,
  probe: {
    reagentKeys: ["盐酸", "氢氧化钠"],
    expect: { reacted: true, thermal: "exothermic", gas: false },
  },
},
```

**注意：`reagents` 是给人看的中文标签，引擎不直接认。** 它们要经解析层才能喂给引擎。

---

## 二、Probe 自验证（本方法论的关键发明）

### 问题

数据目录最容易出的 bug：**配了试剂，但引擎根本不认这个组合**——实验"看起来有"，实际跑不通，用户一混合啥也没发生。102 个实验靠人工检查不可能。

### 解法：probe

每条实验声明"核心反应探针"——用哪些试剂、预期出现什么现象。测试里把 `reagentKeys` 经解析层喂给引擎，断言产出现象与 `expect` 一致。

```ts
/** 探针预期现象（仅声明关心的维度，未声明的不校验） */
export interface ReactionExpectation {
  occurred: boolean;
  gas?: boolean;
  precipitate?: boolean;
  colorChange?: boolean;
  thermal?: "exothermic" | "endothermic" | "none";
}

/** 核心反应探针 */
export interface ReactionProbe {
  reagentKeys: string[];    // 试剂中文名（须能被 resolveSubstance 解析）
  expect: ReactionExpectation;
}
```

### probe 自验证测试（机制级保证）

```ts
// probe.test.ts — 遍历所有带 probe 的实验，断言引擎产出与预期一致
import { allExperiments } from "./index";
import { react } from "@/lib/chem/engine";
import { resolveSubstance } from "@/components/lab/reagents";

for (const exp of allExperiments) {
  if (!exp.probe) continue;  // 纯观察类无 probe 跳过
  test(`probe: ${exp.title}`, () => {
    const substances = exp.probe.reagentKeys.map(resolveSubstance);
    const r = react(substances);
    expect(r.occurred).toBe(exp.probe.expect.occurred);
    if (exp.probe.expect.gas !== undefined)
      expect(r.producesGas).toBe(exp.probe.expect.gas);
    if (exp.probe.expect.precipitate !== undefined)
      expect(r.producesPrecipitate).toBe(exp.probe.expect.precipitate);
    if (exp.probe.expect.colorChange !== undefined)
      expect(r.colorChange).toBe(exp.probe.expect.colorChange);
    if (exp.probe.expect.thermal !== undefined)
      expect(r.thermal).toBe(exp.probe.expect.thermal);
  });
}
```

**意义：这从机制上保证每个实验在系统里"真能反应"。** 配错试剂/引擎漏规则，测试立刻红。

---

## 三、解析层与判定层严格分离

### 数据流

```
自然语言标签("0.1 mol/L 盐酸标准液")
        │ resolveSubstance()   [④解析层] 只描述"物质是什么"
        ▼
结构化实体 { formula:"HCl", category:"acid" }
        │ 喂给引擎            [①判定层] 只判定"会发生什么"
        ▼
反应结果
```

### 解析层实现（顺序敏感！）

```ts
// reagentRules.ts — 关键字 → 物性映射
export interface ReagentRule {
  keywords: string[];
  formula: string;
  category: SubstanceCategory;
}

export const REAGENT_RULES: ReagentRule[] = [
  // ★ 具体物质必须排在通用类别之前，否则"硝酸银"会被"酸"字误判
  { keywords: ["硝酸银"], formula: "AgNO3", category: "salt" },
  { keywords: ["氯化钠", "食盐水"], formula: "NaCl", category: "salt" },
  { keywords: ["碳酸钠", "小苏打", "碳酸氢钠"], formula: "NaHCO3", category: "carbonate" },
  { keywords: ["氢氧化钠", "烧碱"], formula: "NaOH", category: "base" },
  { keywords: ["盐酸"], formula: "HCl", category: "acid" },
  { keywords: ["硫酸"], formula: "H2SO4", category: "acid" },
  // ... 更多
];

// reagents.ts — 解析主入口
export function resolveSubstance(label: string): Substance {
  for (const rule of REAGENT_RULES) {
    if (rule.keywords.some((kw) => label.includes(kw))) {
      return { formula: rule.formula, name: label, category: rule.category };
    }
  }
  return { formula: label, name: label, category: "other" }; // 无法识别仍可拖入但不触发反应
}
```

### 分离的红线

| 层 | 职责 | 禁止 |
|---|---|---|
| 解析层 `reagents.ts` | 关键字 → 化学式/类别 | 禁止含任何反应判定逻辑 |
| 判定层 `engine.ts` | 结构化实体 → 反应结果 | 禁止含任何中文字符串匹配 |

**好处：** "加试剂"和"判定反应"各自独立演进、独立测试。改解析规则不会影响反应判定，反之亦然。

---

## 四、目录组织

按主题分文件，每文件 ~100 行，便于维护：

```
data/experiments/
├── types.ts          # 类型定义
├── acid-base.ts      # 酸碱类
├── gas.ts            # 气体类
├── precipitation.ts  # 沉淀类
├── redox.ts          # 氧化还原类
├── metal.ts          # 金属类
├── coordination.ts   # 配位类
├── organic.ts        # 有机类
├── thermo.ts         # 热力学类
├── analysis.ts       # 分析类
├── index.ts          # 聚合 allExperiments
├── catalog.test.ts   # 目录完整性（slug 唯一/字段完整）
└── probe.test.ts     # ★ probe 自验证
```

`index.ts` 聚合：

```ts
export const allExperiments: ExperimentSeed[] = [
  ...acidBaseExperiments,
  ...gasExperiments,
  // ... 各主题
];
```

---

## 五、目录完整性测试

```ts
// catalog.test.ts
import { allExperiments } from "./index";

test("所有 slug 唯一", () => {
  const slugs = allExperiments.map((e) => e.slug);
  expect(new Set(slugs).size).toBe(slugs.length);
});

test("所有实验字段完整", () => {
  for (const e of allExperiments) {
    expect(e.title).toBeTruthy();
    expect(e.description).toBeTruthy();
    expect(e.reagents.length).toBeGreaterThan(0);
    expect(e.apparatus.length).toBeGreaterThan(0);
    expect(e.objectives.length).toBeGreaterThan(0);
  }
});
```

---

## 六、数据即多用途

同一份 `ExperimentSeed` 数据驱动多处：

| 消费方 | 用到的字段 |
|---|---|
| 数据库 seed | 全部（写入 Experiment 表） |
| 画布默认试剂 | `reagents` |
| 模式判定 | `apparatus` |
| 讲解"原理"步骤 | `description` |
| 讲解"结论"步骤 | `objectives` |
| 讲解试剂取用 | `probe.reagentKeys` ?? `reagents[0..3]` |
| AI 导师上下文 | `title`/`description`/`reagents`/`objectives` |
| AI 报告评估 | `objectives` + 会话 steps/measurements |
| probe 自验证 | `probe` |

**一处数据，七处复用。** 这是数据驱动架构的威力。
