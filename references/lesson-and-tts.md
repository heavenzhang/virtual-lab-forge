# 讲解自动派生 + 确定性重放 + TTS 预生成

> 本文档详述"不为每个实验写讲解脚本"的机制：buildLesson 自动派生、确定性重放、TTS 离线预生成。

---

## 一、讲解自动派生（buildLesson）

### 核心思想

**不为每个实验写讲解脚本。** 一个 `buildLesson(seed) → LessonStep[]` 纯函数，从实验数据自动生成"原理→准备→操作→现象→结论"五阶段讲解。102 个实验共享一个生成器。

### 类型定义

```ts
// 步骤所属阶段
export type LessonPhase = "原理" | "准备" | "操作" | "现象" | "结论";

// 驱动画布的动作
export type LessonAction =
  | { kind: "reset" }                      // 清空容器
  | { kind: "add"; reagent: string }       // 取用试剂（中文名，经 resolveSubstance 解析）
  | { kind: "mix" }                        // 混合
  | { kind: "energize" };                  // 电化学：接通电源/电路

// 一步讲解
export interface LessonStep {
  id: string;
  phase: LessonPhase;
  title: string;        // 步骤短标题
  narration: string;    // 口播/字幕文字
  action?: LessonAction;
}
```

### 混合实验讲解生成

```ts
export function buildLesson(exp: ExperimentSeed): LessonStep[] {
  // 1. 电化学实验优先走专门生成器（见下）
  const electro = electrolysisLesson(exp) ?? galvanicLesson(exp) ?? conductivityLesson(exp);
  if (electro) return electro;

  const steps: LessonStep[] = [];
  const reagents = pickReagents(exp);  // 优先用 probe 试剂，否则取前 3 种

  // 原理：实验描述
  steps.push({
    id: "intro", phase: "原理", title: "实验原理",
    narration: exp.description,
    action: { kind: "reset" },
  });

  // 准备：逐一取用试剂
  reagents.forEach((r, i) => {
    steps.push({
      id: `add-${i}`, phase: "准备", title: `取用${r}`,
      narration: `取用${r}，加入烧杯中。`,
      action: { kind: "add", reagent: r },
    });
  });

  // 操作：混合
  steps.push({
    id: "mix", phase: "操作", title: "混合反应",
    narration: "将烧杯中的试剂充分混合，反应随即开始。",
    action: { kind: "mix" },
  });

  // 现象：由探针描述
  steps.push({
    id: "observe", phase: "现象", title: "观察现象",
    narration: describePhenomena(exp.probe?.expect),
  });

  // 结论：实验目标
  if (exp.objectives.length) {
    steps.push({
      id: "summary", phase: "结论", title: "实验小结",
      narration: `通过本实验，你将${exp.objectives.join("；")}。`,
    });
  }

  return steps;
}
```

### 现象描述自动生成

```ts
// 由探针预期现象生成"现象"步骤的口播
function describePhenomena(e?: ReactionExpectation): string {
  if (!e || !e.occurred)
    return "仔细观察体系，留意是否出现颜色、气泡或温度的变化。";
  const parts: string[] = [];
  if (e.gas) parts.push("有气泡不断逸出");
  if (e.precipitate) parts.push("溶液变浑浊并生成沉淀");
  if (e.colorChange) parts.push("溶液颜色发生明显变化");
  if (e.thermal === "exothermic") parts.push("同时放出热量、温度升高");
  else if (e.thermal === "endothermic") parts.push("同时吸收热量、温度下降");
  if (parts.length === 0)
    return "反应正在发生，注意观察 pH 与温度读数的变化。";
  return `可以看到${parts.join("，")}。`;
}

// 选定演示试剂：优先用探针试剂（保证能反应），否则取前若干种
function pickReagents(exp: ExperimentSeed): string[] {
  if (exp.probe?.reagentKeys?.length) return exp.probe.reagentKeys;
  return exp.reagents.slice(0, Math.min(3, exp.reagents.length));
}
```

### 电化学实验讲解（专门生成器）

电化学实验有专门装置，讲解需据引擎真实产出描述两极现象：

```ts
// 电解实验讲解：依放电顺序描述两极
function electrolysisLesson(exp: ExperimentSeed): LessonStep[] | null {
  if (!isElectrolysisSetup(exp.apparatus)) return null;
  const electrolyte = exp.reagents.map((r) => resolveSubstance(r).formula).find(isElectrolyte);
  if (!electrolyte) return null;
  const er = electrolyze(electrolyte, { inertAnode: isInertAnode(exp.apparatus) });
  if (!er) return null;
  const steps: LessonStep[] = [
    { id: "intro", phase: "原理", title: "实验原理", narration: exp.description, action: { kind: "reset" } },
    { id: "setup", phase: "准备", title: "连接装置", narration: "将电极插入电解液，分别与直流电源的正、负极相连。" },
    { id: "power", phase: "操作", title: "接通电源", narration: "接通直流电源，开始电解，注意观察两极变化。", action: { kind: "energize" } },
    { id: "observe", phase: "现象", title: "两极现象",
      narration: `${er.cathode.observation}；${er.anode.observation}${er.colorFades ? "；溶液蓝色逐渐变浅" : ""}。` },
  ];
  const s = summaryStep(exp);
  if (s) steps.push(s);
  return steps;
}
```

**关键：现象步骤的口播来自引擎真实产出**（`er.cathode.observation`），不是写死的。引擎改了，讲解自动跟着变。

---

## 二、确定性重放

### 问题

讲解跳到第 N 步时，画布状态必须与讲解严格一致——不能"讲到混合却没混合""讲到通电却没通电"。

### 解法：从头执行到当前步

```tsx
// LessonPlayer.tsx — 确定性重放
useEffect(() => {
  if (!engaged || steps.length === 0) return;
  reset();  // 先清空
  // 依次执行 0..index 的所有 action
  for (let i = 0; i <= index; i++) {
    const a = steps[i].action;
    if (!a) continue;
    if (a.kind === "add") addReagent(resolveSubstance(a.reagent));
    else if (a.kind === "mix") mix();
    else if (a.kind === "energize") setEnergized(true);
  }
}, [index, engaged, steps, reset, addReagent, mix, setEnergized]);
```

**意义：无论用户怎么跳转，画布状态始终与讲解对齐。** 不依赖"增量 diff"（容易出错），而是"从零重放到目标步"（确定性）。

### 不介入时不干预

```tsx
const [engaged, setEngaged] = useState(false);  // 是否已介入实验台
// 只有用户主动操作讲解（点击步/播放）才 engaged=true，此后才重放动作
// 未介入时讲解只显示字幕，不干扰用户自由操作实验台
```

---

## 三、TTS 预生成

### 核心思想

讲解语音用 edge-tts **离线预生成**为 mp3（高音质、零运行时依赖），前端 `<audio>` 播放。缺失时回退浏览器 `speechSynthesis`，都不可用按字数计时推进。

### 文件名 = 文本哈希

```ts
// audioKey.ts — 文本 → 稳定短哈希，作文件名
export function audioKey(text: string): string {
  // 简单哈希（生产用更稳的）
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(h).toString(16).padStart(8, "0");
}

export const VOICE_EDGE = {
  xiaoxiao: "zh-CN-XiaoxiaoNeural",  // 晓晓♀
  yunxi: "zh-CN-YunxiNeural",        // 云希♂
};

export function audioSrc(text: string, voice: VoiceRole): string {
  return `/audio/lesson/${voice}/${audioKey(text)}.mp3`;
}
```

**同一句文本 → 同一文件名 → 多实验复用，不重复生成。**

### 预生成脚本

```js
// scripts/generate-tts.mjs
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, statSync, rmSync } from "node:fs";
import { allExperiments } from "../src/data/experiments/index.ts";
import { buildLesson } from "../src/components/lab/lesson/buildLesson.ts";
import { audioKey, VOICE_EDGE } from "../src/components/lab/lesson/audioKey.ts";

const run = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 收集全部唯一口播文本（多实验去重）
function collectTexts() {
  const set = new Set();
  for (const exp of allExperiments)
    for (const step of buildLesson(exp)) set.add(step.narration);
  return [...set];
}

// 有效的非空 mp3 才算已生成
function isValidMp3(p) { return existsSync(p) && statSync(p).size > 0; }

// 为单句 + 单音色生成 mp3（已存在且非 --force 则跳过；失败重试 + 清理空文件）
async function genOne(text, voice) {
  const out = join(BASE_DIR, voice, `${audioKey(text)}.mp3`);
  if (isValidMp3(out) && !FORCE) return "skip";
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      await run("edge-tts", ["--voice", VOICE_EDGE[voice], "--text", text, "--write-media", out]);
      if (isValidMp3(out)) return "ok";
      throw new Error("生成了空文件");
    } catch (e) {
      rmSync(out, { force: true });  // 清理空/损坏文件，避免下次误跳过
      if (attempt === 4) throw e;
      await sleep(800 * attempt);    // 退避后重试（Edge 偶发限频）
    }
  }
  return "ok";
}

// 用法：node scripts/generate-tts.mjs [--voice xiaoxiao|yunxi] [--force]
```

**关键点：**
- 收集全部实验的唯一口播文本（去重），一次生成
- 已存在有效 mp3 跳过（增量生成）
- 失败重试 4 次 + 退避（Edge 偶发限频）
- 空文件清理（避免 NoAudioReceived 留下的空文件被误判成功）

### 前端播放回退链

```tsx
useEffect(() => {
  if (!playing) return;
  const advance = () => setIndex((i) => i >= steps.length - 1 ? (setPlaying(false), i) : i + 1);
  const text = steps[index]?.narration ?? "";

  if (muted || !text) {
    const t = setTimeout(advance, 4200);  // 静音按固定时长推进
    return () => clearTimeout(t);
  }

  // 1. 优先：预生成 mp3
  const audio = new Audio(audioSrc(text, voice));
  audio.playbackRate = rate;
  audio.onended = advance;
  audio.onerror = () => speakFallback();  // 失败回退

  // 2. 回退：浏览器语音合成
  const speakFallback = () => {
    const synth = window.speechSynthesis;
    if (!synth) {
      const t = setTimeout(advance, Math.max(4000, text.length * 240));  // 3. 按字数计时
      return () => clearTimeout(t);
    }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "zh-CN"; u.rate = rate; u.onend = advance;
    synth.speak(u);
  };

  audio.play().catch(() => speakFallback());
  return () => { audio.pause(); window.speechSynthesis?.cancel(); };
}, [playing, index, muted, rate, voice, steps]);
```

**三级回退：mp3 → speechSynthesis → 字数计时。** 保证任何环境都能播放讲解。

---

## 四、讲解与 AI 导师联动

讲解每步可一键唤起 AI 导师讲解该步原理：

```tsx
<button onClick={() =>
  useTutorBus.getState().ask(
    `讲解到「${step.title}」这一步：${step.narration} ` +
    `请结合此刻烧杯里的现象与读数，简明讲解其中的化学原理与方程式。`
  )
}>
  🤖 让导师讲讲这一步
</button>
```

**讲解（确定性脚本）与 AI 导师（自由问答）互补**：讲解保证流程完整，导师处理个性化疑问。
