// ============================================================
// Virtual Lab Forge — 可直接套用的 TypeScript 代码模板
// 新学科套用：替换领域类型/规则/解析，其余骨架基本复用
// ============================================================

// ===== ① 领域引擎层 =====

export type Category = "acid" | "base" | "salt" | "metal" | "gas" | "other";
// 学科自定义类别...

export interface Entity {
  id: string;          // 唯一标识（如化学式 HCl / 元件号 R1）
  name: string;        // 可读名
  category: Category;
  amount?: number;
}

export interface Conditions {
  temperature?: number;
  heated?: boolean;
}

export interface DomainResult {
  occurred: boolean;
  products: Entity[];
  observables: {
    gas?: boolean;
    precipitate?: boolean;
    colorChange?: boolean;
    thermal?: "exothermic" | "endothermic" | "none";
  };
  trend?: "increase" | "decrease" | "neutral" | "unknown";
  equation?: string;
  description?: string;
}

function noOccurrence(inputs: Entity[]): DomainResult {
  return {
    occurred: false, products: inputs, observables: { thermal: "none" },
    trend: "unknown", description: "在当前条件下未观察到明显变化。",
  };
}

export function simulate(inputs: Entity[], conditions: Conditions = {}): DomainResult {
  if (inputs.length < 2) return noOccurrence(inputs);
  for (const rule of rules) {
    if (rule.match(inputs)) return { occurred: true, ...rule.build(inputs, conditions) };
  }
  return noOccurrence(inputs);
}

// ===== ② 规则层 =====

export interface Rule {
  id: string;
  name: string;
  match: (inputs: Entity[]) => boolean;
  build: (inputs: Entity[], cond: Conditions) => Omit<DomainResult, "occurred">;
}

export function findByCategory(inputs: Entity[], c: Category) { return inputs.find((s) => s.category === c); }
export function hasCategories(inputs: Entity[], a: Category, b: Category) {
  return Boolean(findByCategory(inputs, a)) && Boolean(findByCategory(inputs, b));
}
export function hasId(inputs: Entity[], id: string) { return inputs.some((s) => s.id === id); }

// 示例规则
const exampleRule: Rule = {
  id: "example",
  name: "示例反应",
  match: (inputs) => hasCategories(inputs, "acid", "base"),
  build: () => ({
    products: [{ id: "salt", name: "盐", category: "salt" }, { id: "H2O", name: "水", category: "other" }],
    observables: { colorChange: true, thermal: "exothermic" },
    trend: "neutral",
    equation: "酸 + 碱 → 盐 + 水",
    description: "发生中和反应，放出热量。",
  }),
};

export const rules: Rule[] = [
  // 特异性强的排前面，通用兜底排后面
  exampleRule,
];

// ===== ③ 数据目录层 =====

export interface ExperimentSeed {
  slug: string;
  title: string;
  description: string;
  category: string;
  difficulty: "EASY" | "MEDIUM" | "HARD";
  reagents: string[];
  apparatus: string[];
  objectives: string[];
  estimatedMinutes: number;
  probe?: {
    reagentKeys: string[];
    expect: { occurred: boolean; gas?: boolean; precipitate?: boolean; colorChange?: boolean; thermal?: "exothermic" | "endothermic" | "none" };
  };
}

export const allExperiments: ExperimentSeed[] = [
  {
    slug: "example-experiment",
    title: "示例实验",
    description: "这是一个示例实验的简介。",
    category: "EXAMPLE",
    difficulty: "EASY",
    reagents: ["试剂A", "试剂B"],
    apparatus: ["烧杯"],
    objectives: ["理解原理", "观察现象"],
    estimatedMinutes: 30,
    probe: { reagentKeys: ["试剂A", "试剂B"], expect: { occurred: true, thermal: "exothermic" } },
  },
];

// ===== ④ 解析层 =====

export interface ReagentRule { keywords: string[]; id: string; category: Category; }

export const REAGENT_RULES: ReagentRule[] = [
  // ★ 具体物质排在通用类别之前（顺序敏感）
  { keywords: ["试剂A"], id: "A", category: "acid" },
  { keywords: ["试剂B"], id: "B", category: "base" },
];

export function resolveSubstance(label: string): Entity {
  for (const rule of REAGENT_RULES) {
    if (rule.keywords.some((kw) => label.includes(kw))) {
      return { id: rule.id, name: label, category: rule.category };
    }
  }
  return { id: label, name: label, category: "other" };
}

// ===== ⑤ 模式判定层 =====

export type LabMode = "mixing" | "electrolysis" | "galvanic" | "conductivity";

export function resolveLabMode(apparatus: string[], substances: Entity[]): LabMode {
  // 优先级固定，学科自定义
  return "mixing";
}

// ===== ⑥ 状态层（Zustand） =====

import { create } from "zustand";

interface LabState {
  contents: (Entity & { key: string })[];
  result: DomainResult | null;
  readings: { ph: number; temperature: number };
  sessionId: string | null;
  energized: boolean;
  addReagent: (s: Entity) => void;
  removeReagent: (id: string) => void;
  setTemperature: (t: number) => void;
  setEnergized: (on: boolean) => void;
  mix: () => void;
  reset: () => void;
}

const INITIAL_READINGS = { ph: 7, temperature: 25 };

function deriveReadings(prev: typeof INITIAL_READINGS, r: DomainResult) {
  let ph = prev.ph;
  if (r.trend === "increase") ph = Math.min(14, prev.ph + 3);
  else if (r.trend === "decrease") ph = Math.max(0, prev.ph - 3);
  else if (r.trend === "neutral") ph = 7;
  let temperature = prev.temperature;
  if (r.observables.thermal === "exothermic") temperature += 15;
  else if (r.observables.thermal === "endothermic") temperature -= 8;
  return { ph: Math.round(ph * 10) / 10, temperature };
}

export const useLabStore = create<LabState>((set, get) => ({
  contents: [],
  result: null,
  readings: INITIAL_READINGS,
  sessionId: null,
  energized: false,

  addReagent: (s) =>
    set((state) => {
      if (state.contents.some((c) => c.id === s.id)) return state;
      return { contents: [...state.contents, { ...s, key: `${s.id}-${Date.now()}` }], result: null };
    }),
  removeReagent: (id) =>
    set((state) => ({ contents: state.contents.filter((c) => c.id !== id), result: null })),
  setTemperature: (t) =>
    set((state) => ({ readings: { ...state.readings, temperature: Math.max(0, Math.min(100, Math.round(t))) } })),
  setEnergized: (on) => set({ energized: on }),
  mix: () => {
    const { contents, readings } = get();
    const result = simulate(contents);
    const nextReadings = result.occurred ? deriveReadings(readings, result) : readings;
    set({ result, readings: nextReadings });
  },
  reset: () => set({ contents: [], result: null, readings: INITIAL_READINGS, energized: false }),
}));

// ===== 讲解生成 =====

export type LessonPhase = "原理" | "准备" | "操作" | "现象" | "结论";
export type LessonAction = { kind: "reset" } | { kind: "add"; reagent: string } | { kind: "mix" } | { kind: "energize" };
export interface LessonStep { id: string; phase: LessonPhase; title: string; narration: string; action?: LessonAction; }

export function buildLesson(exp: ExperimentSeed): LessonStep[] {
  const steps: LessonStep[] = [];
  const reagents = exp.probe?.reagentKeys?.length ? exp.probe.reagentKeys : exp.reagents.slice(0, 3);

  steps.push({ id: "intro", phase: "原理", title: "实验原理", narration: exp.description, action: { kind: "reset" } });
  reagents.forEach((r, i) => {
    steps.push({ id: `add-${i}`, phase: "准备", title: `取用${r}`, narration: `取用${r}，加入容器中。`, action: { kind: "add", reagent: r } });
  });
  steps.push({ id: "mix", phase: "操作", title: "混合", narration: "将试剂充分混合，反应随即开始。", action: { kind: "mix" } });
  steps.push({ id: "observe", phase: "现象", title: "观察现象", narration: describePhenomena(exp.probe?.expect) });
  if (exp.objectives.length) {
    steps.push({ id: "summary", phase: "结论", title: "实验小结", narration: `通过本实验，你将${exp.objectives.join("；")}。` });
  }
  return steps;
}

function describePhenomena(e?: ExperimentSeed["probe"] extends infer P ? P extends { expect: infer E } ? E : never : never): string {
  if (!e || !e.occurred) return "仔细观察体系变化。";
  const parts: string[] = [];
  if (e.gas) parts.push("有气泡逸出");
  if (e.precipitate) parts.push("生成沉淀");
  if (e.colorChange) parts.push("颜色变化");
  if (e.thermal === "exothermic") parts.push("温度升高");
  return parts.length ? `可以看到${parts.join("，")}。` : "注意观察读数变化。";
}

// ===== probe 自验证测试 =====

import { test, expect } from "vitest";

for (const exp of allExperiments) {
  if (!exp.probe) continue;
  test(`probe: ${exp.title}`, () => {
    const entities = exp.probe.reagentKeys.map(resolveSubstance);
    const r = simulate(entities);
    expect(r.occurred).toBe(exp.probe.expect.occurred);
    if (exp.probe.expect.gas !== undefined) expect(r.observables.gas).toBe(exp.probe.expect.gas);
    if (exp.probe.expect.precipitate !== undefined) expect(r.observables.precipitate).toBe(exp.probe.expect.precipitate);
    if (exp.probe.expect.thermal !== undefined) expect(r.observables.thermal).toBe(exp.probe.expect.thermal);
  });
}
