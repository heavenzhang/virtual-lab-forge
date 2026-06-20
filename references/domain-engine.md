# 领域引擎 + 规则系统 + 模式判定 — 完整范式

> 本文档给出纯函数领域引擎的通用范式，附 ChemAIForge 的真实实现作参照。

---

## 一、引擎主入口范式

引擎是 `f(inputs, conditions) → result` 的纯函数：不修改入参、按规则集顺序匹配、命中第一条即返回。

```ts
// ===== 引擎核心类型（通用范式） =====

/** 领域实体：参与计算的最小单元 */
export interface Entity {
  id: string;            // 唯一标识，如化学式 "HCl"
  name: string;          // 可读名，如 "盐酸"
  category: Category;    // 类别，驱动规则匹配
  amount?: number;       // 量，用于过量/不足判断
}

/** 计算条件 */
export interface Conditions {
  temperature?: number;  // 温度
  heated?: boolean;       // 是否加热
  // ... 学科相关条件
}

/** 计算结果：用"语义维度"描述，不直接给视觉 */
export interface DomainResult {
  occurred: boolean;        // 是否发生
  products: Entity[];       // 产物/后继状态
  observables: {            // ★ 可视化要的现象维度
    gas?: boolean;
    precipitate?: boolean;
    colorChange?: boolean;
    thermal?: "exothermic" | "endothermic" | "none";
  };
  trend?: "increase" | "decrease" | "neutral" | "unknown"; // 趋势(如pH)
  equation?: string;        // 可读方程式
  description?: string;     // 现象描述
}

/** 无计算发生时的默认结果 */
function noOccurrence(inputs: Entity[]): DomainResult {
  return {
    occurred: false,
    products: inputs,
    observables: { thermal: "none" },
    trend: "unknown",
    description: "在当前条件下未观察到明显变化。",
  };
}

/**
 * 引擎主入口：给定输入与条件，返回结果。
 * 纯函数，按规则集顺序匹配第一条满足的规则。
 */
export function simulate(
  inputs: Entity[],
  conditions: Conditions = {},
): DomainResult {
  if (inputs.length < 2) return noOccurrence(inputs);
  for (const rule of rules) {
    if (rule.match(inputs)) {
      return { occurred: true, ...rule.build(inputs, conditions) };
    }
  }
  return noOccurrence(inputs);
}
```

### ChemAIForge 真实对应

`src/lib/chem/engine.ts` 的 `react()` 即此范式，`Substance` 即 `Entity`，`ReactionResult` 即 `DomainResult`。`observables` 拆成了平铺字段（`producesGas`/`producesPrecipitate`/`colorChange`/`thermal`/`phTrend`），语义相同。

---

## 二、规则系统：match/build 二元组

把判定逻辑拆成独立规则，每条 = "是否匹配 + 如何生成结果"。规则集有序，特异性强的排前。

```ts
// ===== 规则类型与工具（抽离避免循环依赖） =====

export interface Rule {
  id: string;
  name: string;
  /** 判断输入是否触发 */
  match: (inputs: Entity[]) => boolean;
  /** 生成结果（不含 occurred，由引擎补全） */
  build: (inputs: Entity[], cond: Conditions) => Omit<DomainResult, "occurred">;
}

// 工具函数（纯函数）
export function findByCategory(inputs: Entity[], c: Category): Entity | undefined {
  return inputs.find((s) => s.category === c);
}
export function hasCategories(inputs: Entity[], a: Category, b: Category): boolean {
  return Boolean(findByCategory(inputs, a)) && Boolean(findByCategory(inputs, b));
}
export function hasFormula(inputs: Entity[], id: string): boolean {
  return inputs.some((s) => s.id === id);
}
```

### 规则示例（酸碱中和）

```ts
const acidBaseNeutralization: Rule = {
  id: "acid-base-neutralization",
  name: "酸碱中和反应",
  match: (inputs) => hasCategories(inputs, "acid", "base"),
  build: () => ({
    products: [
      { id: "salt", name: "盐", category: "salt" },
      { id: "H2O", name: "水", category: "water" },
    ],
    observables: { colorChange: true, thermal: "exothermic" },
    trend: "neutral",
    equation: "酸 + 碱 → 盐 + 水",
    description: "酸与碱发生中和反应，放出热量，溶液趋于中性。",
  }),
};
```

### 规则聚合（按特异性排序）

```ts
export const rules: Rule[] = [
  precipitation,      // 特异性强（AgNO3+Cl⁻）排前
  ...extendedRules,  // 扩展规则（氧化还原/有机/配位/气体/金属）
  metalAcid,         // 通用
  acidBaseNeutralization, // 最通用兜底
];
```

**扩展只靠加规则文件，不动引擎主入口。** ChemAIForge 的 `rules/` 按主题分文件，`rules/index.ts` 聚合 `extendedReactions`。

---

## 三、多个引擎并存

复杂学科可有多个互不依赖的纯函数引擎，各自独立测试：

| 引擎 | 函数签名 | 输出特点 |
|---|---|---|
| 混合 | `react(substances, conditions)` | 产物数组 + 现象维度 |
| 电解 | `electrolyze(formula, {inertAnode})` | 阴阳极产物 + 观察描述 |
| 原电池 | `galvanicCell(metals, electrolyte)` | 正负极 + 电子流向 |
| 导电性 | `conductivity(substance)` | 灯泡亮度 + 说明 |

每个引擎配套 `is*` 判定函数（如 `isElectrolyte`/`isGalvanicMetal`），供模式判定层使用。

---

## 四、模式判定（策略模式）

当画布需支持多种装置时，用**一个纯函数**据器材+实体选唯一操作模式。优先级固定，避免渲染中内联判定。

```ts
export type LabMode = "conductivity" | "electrolysis" | "galvanic" | "mixing";

export function resolveLabMode(
  apparatus: string[],
  substances: Entity[],
): LabMode {
  // 优先级固定：导电性 > 电解 > 原电池 > 混合(默认)
  if (usesConductivity(apparatus)) return "conductivity";
  if (isElectrolysisSetup(apparatus) && substances.some(isElectrolyte))
    return "electrolysis";
  if (isGalvanicSetup(apparatus) && substances.some(isGalvanicMetal))
    return "galvanic";
  return "mixing";
}
```

装置判定用正则匹配器材标签（纯函数）：

```ts
export function isElectrolysisSetup(apparatus: string[]): boolean {
  return /直流电源|电解槽/.test(apparatus.join(" "));
}
export function isGalvanicSetup(apparatus: string[]): boolean {
  return /电流计|盐桥|原电池|导线|培养皿/.test(apparatus.join(" "));
}
export function usesConductivity(apparatus: string[]): boolean {
  return /电导率|导电性/.test(apparatus.join(" "));
}
```

---

## 五、几何即数据

装置形状做成纯数据，画布渲染只读数据，不含判定逻辑：

```ts
export interface VesselGeom {
  kind: "beaker" | "flask" | "tube";
  innerClip: string;   // 内壁裁剪路径（液体/沉淀/气泡裁剪其中）
  outline: string;     // 杯身轮廓
  rim: { cx: number; cy: number; rx: number; ry: number }; // 杯口
  heatY: number;       // 火焰焰尖 y
  liquid: { left: number; right: number; topY: number; bottomY: number };
  surfaceRxAt: (y: number) => number; // 液面半径随高度变化（锥形瓶）
  bubbleXs: number[];  // 气泡 x 位置
  precipCx: number[];  // 沉淀堆中心 x
}

export const VESSELS: Record<VesselKind, VesselGeom> = { /* beaker/flask/tube */ };

export function chooseVessel(apparatus: string[]): VesselKind {
  const t = apparatus.join(" ");
  if (/试管/.test(t)) return "tube";
  if (/锥形瓶|烧瓶/.test(t)) return "flask";
  return "beaker";
}
```

**现象（液体色/气泡/沉淀/蒸汽/火焰）按几何自适应位置**——换器皿形状，现象自动跟随。

---

## 六、测试范式

纯函数引擎 100% 可单测，这是质量底线。测试分三类：

```ts
// 1. 引擎规律测试：给定输入断言输出
test("酸碱中和放热趋于中性", () => {
  const r = react([HCl, NaOH]);
  expect(r.occurred).toBe(true);
  expect(r.observables.thermal).toBe("exothermic");
  expect(r.trend).toBe("neutral");
});

// 2. 规则优先级测试：特异性规则先命中
test("AgNO3+NaCl 走沉淀而非酸碱", () => {
  const r = react([AgNO3, NaCl]);
  expect(r.observables.precipitate).toBe(true);
});

// 3. probe 自验证：每条实验喂引擎断言现象（见 data-driven-catalog.md）
```
