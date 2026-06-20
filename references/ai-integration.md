# AI 集成三件套 — 导师 / 报告 / 配置

> 本文档给出 AI 教学层的通用模板：流式导师、结构化报告、配置优先级链。

---

## 一、AI 导师：流式问答 + 上下文注入

### 核心思想

AI 不脱离场景瞎聊——**system prompt 注入当前实验上下文**（标题/目标/试剂/难度），甚至注入"当前实验台实时状态"（容器里有什么、最近反应结果、读数），让 AI 能点评"你刚加的 X 和 Y 会…"。

### 请求体构造（不含密钥，便于单测）

```ts
export interface TutorMessage { role: "user" | "assistant"; content: string; }
export interface TutorContext { messages: TutorMessage[]; maxTokens?: number; timeoutMs?: number; }

export interface TutorRequestBody {
  model: string; system: string; max_tokens: number; stream: true; messages: TutorMessage[];
}

// 构造 system prompt，注入实验上下文
function buildSystemPrompt(experiment: ExperimentDTO): string {
  const objectives = experiment.objectives.length
    ? experiment.objectives.map((o, i) => `${i + 1}. ${o}`).join("\n")
    : "（暂无明确目标）";
  const reagents = experiment.reagents.join("、") || "（无）";
  return [
    "你是一位资深化学导师，擅长在虚拟实验中循循善诱地引导学生。",
    "请用简体中文回答，语气专业而鼓励，重视实验安全与科学原理。",
    "回答应结合下方实验上下文，必要时提示风险，避免直接给出全部答案，鼓励学生思考。",
    "",
    "【输出格式】请使用 Markdown 组织回答：",
    "- 用 **加粗** 标记关键概念、物质名称与结论；",
    "- 分点说明时用有序/无序列表；步骤多时可用小标题（###）分段；",
    "- 化学式与方程式用行内代码包裹，如 `2H₂ + O₂ → 2H₂O`；",
    "- 安全提示用引用块（>）突出；适当时用表格对比；",
    "- 保持简洁，避免冗长，单次回答聚焦学生当前的问题。",
    "",
    "【当前实验】",
    `标题：${experiment.title}`,
    `分类：${experiment.category}　难度：${experiment.difficulty}`,
    `简介：${experiment.description}`,
    `可用试剂：${reagents}`,
    "实验目标：", objectives,
  ].join("\n");
}

export function buildTutorPrompt(experiment: ExperimentDTO, ctx: TutorContext): TutorRequestBody {
  const { model } = getClaudeApiConfig();
  return { model, system: buildSystemPrompt(experiment), max_tokens: ctx.maxTokens ?? 1024, stream: true, messages: ctx.messages };
}
```

### 流式 SSE 解析（AsyncGenerator）

```ts
// 从 Claude SSE 数据行提取文本增量
function extractDelta(line: string): string | null {
  if (!line.startsWith("data:")) return null;
  const payload = line.slice(5).trim();
  if (!payload || payload === "[DONE]") return null;
  try {
    const event = JSON.parse(payload) as { type?: string; delta?: { type?: string; text?: string } };
    if (event.type === "content_block_delta" && event.delta?.text) return event.delta.text;
  } catch { /* 忽略心跳行 */ }
  return null;
}

// 流式调用，逐块产出导师回复文本增量
export async function* streamTutorReply(
  experiment: ExperimentDTO,
  ctx: TutorContext,
): AsyncGenerator<string, void, unknown> {
  const { baseUrl, apiKey } = getClaudeApiConfig();
  const body = buildTutorPrompt(experiment, ctx);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ctx.timeoutMs ?? 30000);

  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === "AbortError")
      throw new Error("AI 导师响应超时，请稍后重试。");
    throw new Error(`调用 AI 导师服务失败：${err instanceof Error ? err.message : String(err)}`);
  }

  if (!response.ok || !response.body) {
    clearTimeout(timeout);
    const detail = await response.text().catch(() => "");
    throw new Error(`AI 导师服务返回错误（${response.status}）：${detail.slice(0, 200)}`);
  }

  try {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const text = extractDelta(line);
        if (text) yield text;
      }
    }
  } finally {
    clearTimeout(timeout);
  }
}
```

**关键点：**
- 请求体构造与 fetch 调用分离，便于单测 `buildTutorPrompt`
- AbortController 超时控制，所有错误抛可读中文异常
- SSE 按行解析，buffer 处理跨 chunk 的不完整行

### 前端流式消费

```ts
// useTutorStream.ts — 前端 hook 逐块追加到 UI
for await (const delta of streamTutorReply(experiment, { messages })) {
  setAnswer((prev) => prev + delta);  // 流式追加
}
```

---

## 二、AI 报告：结构化 JSON + 容错解析

### 核心思想

实验结束后，把会话的 steps + measurements 汇总喂给 AI，**强制只返回 JSON 对象**（禁止 markdown 代码块），生成结构化报告（结论/误差分析/改进建议/掌握评估）。

### 会话数据汇总

```ts
// 汇总测量读数为可读统计（供模型分析误差波动）
function summarizeMeasurements(session: SessionDTO): string {
  if (session.measurements.length === 0) return "（本次实验未记录任何读数）";
  const phs = session.measurements.map((m) => m.ph);
  const temps = session.measurements.map((m) => m.temperature);
  const range = (xs: number[]) => `最低 ${Math.min(...xs).toFixed(2)} / 最高 ${Math.max(...xs).toFixed(2)}`;
  const lines = session.measurements.map((m, i) =>
    `${i + 1}. [${m.at}] pH=${m.ph.toFixed(2)}　温度=${m.temperature.toFixed(2)}℃`);
  return [
    `共 ${session.measurements.length} 条读数。pH 区间：${range(phs)}；温度区间：${range(temps)}。`,
    "明细：", ...lines,
  ].join("\n");
}

// 汇总操作步骤序列
function summarizeSteps(session: SessionDTO): string {
  if (session.steps.length === 0) return "（本次实验未记录操作步骤）";
  return session.steps.map((s, i) => {
    const detail = s.detail ? `　详情：${JSON.stringify(s.detail)}` : "";
    return `${i + 1}. [${s.at}] ${s.action}${detail}`;
  }).join("\n");
}
```

### 请求体构造

```ts
function buildSystemPrompt(): string {
  return [
    "你是一位资深化学实验导师，负责在虚拟实验结束后为学生生成结构化评估报告。",
    "请用简体中文撰写，语气专业且鼓励，结合实验目标、操作步骤与测量读数客观分析。",
    "你必须只返回一个 JSON 对象，禁止包含 Markdown 代码块标记或任何额外文字。",
    "JSON 结构如下：",
    "{",
    '  "conclusion": "实验结论概述（是否达成目标、关键现象）",',
    '  "errorAnalysis": "误差分析（读数波动、操作偏差及可能成因）",',
    '  "improvements": ["改进建议1", "改进建议2"],',
    '  "knowledgeAssessment": "对学生相关知识点掌握程度的评估"',
    "}",
  ].join("\n");
}

function buildUserContent(experiment: ExperimentDTO, session: SessionDTO): string {
  const objectives = experiment.objectives.length
    ? experiment.objectives.map((o, i) => `${i + 1}. ${o}`).join("\n")
    : "（暂无明确目标）";
  return [
    "【实验信息】", `标题：${experiment.title}`,
    `分类：${experiment.category}　难度：${experiment.difficulty}`,
    `简介：${experiment.description}`, "实验目标：", objectives, "",
    "【操作步骤】", summarizeSteps(session), "",
    "【测量读数】", summarizeMeasurements(session), "",
    "请基于以上信息生成结构化实验报告 JSON。",
  ].join("\n");
}

export function buildReportPrompt(experiment: ExperimentDTO, session: SessionDTO, maxTokens = 1500): ReportRequestBody {
  const { model } = getClaudeApiConfig();
  return { model, system: buildSystemPrompt(), max_tokens: maxTokens,
    messages: [{ role: "user", content: buildUserContent(experiment, session) }] };
}
```

### 非流式调用 + 容错解析

```ts
// 从响应中提取首个文本块
function extractText(data: unknown): string {
  const content = (data as { content?: { type?: string; text?: string }[] })?.content;
  if (!Array.isArray(content)) return "";
  return content.filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string).join("");
}

// 容错解析：剥离可能的代码块标记后 JSON.parse 并校验
function parseReportText(text: string): ExperimentReport {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  let obj: Record<string, unknown>;
  try { obj = JSON.parse(cleaned) as Record<string, unknown>; }
  catch { throw new Error("AI 返回的报告不是合法 JSON，无法解析。"); }
  const improvements = Array.isArray(obj.improvements)
    ? (obj.improvements as unknown[]).map((x) => String(x)) : [];
  return {
    conclusion: typeof obj.conclusion === "string" ? obj.conclusion : "",
    errorAnalysis: typeof obj.errorAnalysis === "string" ? obj.errorAnalysis : "",
    improvements,
    knowledgeAssessment: typeof obj.knowledgeAssessment === "string" ? obj.knowledgeAssessment : "",
    generatedAt: new Date().toISOString(),
  };
}

export async function generateReport(experiment, session, timeoutMs = 60000): Promise<ExperimentReport> {
  const { baseUrl, apiKey } = getClaudeApiConfig();
  const body = buildReportPrompt(experiment, session);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  // ... fetch 非流式调用（同导师，但 await response.json()）
  const data = await response.json().catch(() => null);
  const text = extractText(data);
  if (!text) throw new Error("AI 报告服务返回空内容。");
  return parseReportText(text);
}
```

**容错要点：**
- 剥离可能的 ` ```json ` 标记（模型偶尔不听话）
- `JSON.parse` 失败抛可读错误
- 每个字段单独类型校验，缺失给默认值（空字符串/空数组）
- `improvements` 强制为 `string[]`

---

## 三、配置读取：优先级链 + 严禁硬编码 Key

### 核心纪律

**绝不硬编码 apiKey。** 用优先级链，任一环节异常回退，最终缺失抛可读错误。

```
CC Switch 数据库(当前激活 provider) → 环境变量兜底 → 抛可读错误
```

### 实现

```ts
export const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-6";

export interface ClaudeApiConfig { baseUrl: string; apiKey: string; model: string; }

interface CcSwitchSettings {
  model?: string;
  env?: { ANTHROPIC_BASE_URL?: string; ANTHROPIC_AUTH_TOKEN?: string; };
}

function getDbPath(): string {
  return process.env.CC_SWITCH_DB ?? join(homedir(), ".cc-switch", "cc-switch.db");
}

// 通过 sqlite3 CLI 读取当前激活的 claude provider（任意异常返回 null）
function readActiveSettings(): CcSwitchSettings | null {
  try {
    const raw = execFileSync("sqlite3", [
      getDbPath(),
      "SELECT settings_config FROM providers WHERE app_type='claude' AND is_current=1 LIMIT 1;",
    ], { encoding: "utf8", timeout: 5000 }).trim();
    if (!raw) return null;
    return JSON.parse(raw) as CcSwitchSettings;
  } catch { return null; }
}

export function getClaudeApiConfig(): ClaudeApiConfig {
  const settings = readActiveSettings();
  const baseUrl = settings?.env?.ANTHROPIC_BASE_URL?.trim() || process.env.ANTHROPIC_BASE_URL?.trim() || "";
  const apiKey = settings?.env?.ANTHROPIC_AUTH_TOKEN?.trim() || process.env.ANTHROPIC_AUTH_TOKEN?.trim() || "";
  const model = settings?.model?.trim() || process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_CLAUDE_MODEL;
  if (!baseUrl || !apiKey) {
    const missing = [!baseUrl && "baseUrl", !apiKey && "apiKey"].filter(Boolean).join("、");
    throw new Error(
      `未找到可用的 Claude API 配置（缺少 ${missing}）。` +
      `请在 CC Switch 中激活一个 claude provider，或设置 ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN 环境变量。`);
  }
  return { baseUrl, apiKey, model };
}
```

### 通用化建议

新学科若不用 CC Switch，可替换为其他配置源（.env / vault / 用户设置表），但保持**优先级链 + 可读错误**模式不变。关键是：**配置缺失不要让下游空配置崩溃，要抛"请配置 X"的明确提示。**

---

## 四、API 路由层

### 导师（流式）

```ts
// app/api/ai/tutor/route.ts
export async function POST(req: Request) {
  const { experimentSlug, messages } = await req.json();
  const experiment = await getExperimentBySlug(experimentSlug);
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const delta of streamTutorReply(experiment, { messages })) {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ delta })}\n\n`));
        }
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
      } catch (err) {
        controller.enqueue(new TextEncoder().encode(
          `data: ${JSON.stringify({ error: err instanceof Error ? err.message : String(err) })}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream" } });
}
```

### 报告（非流式）

```ts
// app/api/sessions/[id]/report/route.ts
export async function POST(req: Request, { params }) {
  const session = await getSession(params.id);
  if (!session) return Response.json({ error: "会话不存在" }, { status: 404 });
  const experiment = await getExperimentById(session.experimentId);
  const report = await generateReport(experiment, session);  // 可能抛错
  await saveReport(session.id, report);
  return Response.json({ report });
}
```

---

## 五、AI 上下文增强：注入实时实验台状态

进阶做法——把当前实验台实时状态也注入 AI 上下文，让 AI 能点评用户刚做的操作：

```ts
// labContext.ts — 收集当前实验台状态给 AI
export function buildLabContext(store: LabState): string {
  const { contents, result, readings } = store;
  const reagentList = contents.length
    ? contents.map((c) => c.name).join("、")
    : "（空）";
  const reaction = result?.reacted
    ? `最近反应：${result.equation}（${result.description}）`
    : "（暂未混合或无反应）";
  return [
    "【当前实验台状态】",
    `容器内：${reagentList}`,
    `pH=${readings.ph}　温度=${readings.temperature}℃`,
    reaction,
  ].join("\n");
}
```

在构造导师请求时，把 `labContext` 拼到 system prompt 末尾，AI 就能说"你刚才加的盐酸和氢氧化钠发生了中和反应，放出的热量使温度升到了 40℃…"——**而非脱离上下文瞎聊**。
