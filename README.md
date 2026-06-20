<div align="center">

# 🧪 Virtual Lab Forge

**AI 驱动的虚拟实验/仿真教学平台构建法 — 通用 Skill**

把任意学科知识构建成「浏览器里能做实验、AI 能教能评」的交互式教学平台。

</div>

---

## 📖 这是什么

**Virtual Lab Forge** 是从 [ChemAIForge](https://github.com/zhangifonly/ChemAIForge)（AI 驱动的化学虚拟实验平台，102 个实验、四套纯函数化学引擎、立体实验台、分步语音讲解、AI 导师与实验报告）提炼而成的**通用方法论 Skill**。

它不绑定化学——替换领域层（引擎/规则/解析/数据），同一骨架可落地**物理电路、生物仿真、电子实验台、工程仿真**等任何学科。

### 核心理念

```
   知识 ──→ 纯函数引擎（可计算、可测试、可复用）
              │ 驱动
              ▼
   画布 ──→ 数据驱动的可视化（一处引擎改动，覆盖全部实验）
              │ 注入上下文
              ▼
    AI  ──→ 结合「当前真实实验台状态」的教学（不胡说，能点评）
```

**只要引擎是真的，N 个实验就能共享一套界面、一套讲解、一套 AI——改一处全覆盖。**

---

## 🏗 七层架构

| 层 | 职责 | 特点 |
|---|---|---|
| ① 领域引擎层 | 纯函数计算「输入→现象/产物」 | 零副作用、零 IO、可单测 |
| ② 规则/模型层 | 引擎内部的判定规则集 | 有序规则 + match/build 二元组 |
| ③ 数据目录层 | 全部实验/场景的纯数据定义 | 每条带 probe 自验证 |
| ④ 实体解析层 | 自然语言标签 → 引擎实体 | 解析与判定严格分离 |
| ⑤ 模式判定层 | 据器材/实体选唯一操作模式 | 策略模式，优先级固定 |
| ⑥ 画布/状态层 | UI 状态托管，委托引擎计算 | store 不含任何领域规则 |
| ⑦ AI/教学层 | 结合上下文的导师 + 报告 | 流式问答 + 结构化报告 |

> ①②③④⑤ 都是纯函数/纯数据，只有 ⑥⑦ 有副作用。这是 720 个单测能跑、改实验不用改代码的前提。

---

## ✨ 六大可复用模式

| 模式 | 说明 |
|---|---|
| **A. 纯函数领域引擎** | `f(inputs, conditions) → result`，引擎不认中文字符串、结果用语义维度描述 |
| **B. 有序规则集** | match/build 二元组，特异性强的排前，扩展只加规则文件 |
| **C. 数据驱动目录 + probe 自验证** | 每条实验带 probe 探针，测试断言引擎产出与预期一致 |
| **D. 解析层与判定层分离** | 标签→实体（解析）与 实体→结果（判定）各自独立演进 |
| **E. 模式判定 + 几何即数据** | 一个纯函数选唯一模式，装置形状做成纯数据 |
| **F. 自动派生讲解 + TTS** | buildLesson 从数据自动生成讲解，确定性重放 + edge-tts 预生成 |

---

## 📁 项目结构

```
virtual-lab-forge/
├── SKILL.md                          # Skill 主入口（核心理念/架构/模式/红线）
├── LICENSE                           # MIT License（含原始项目归属声明）
├── README.md                         # 本文件
└── references/
    ├── architecture.md               # 七层架构详解 + 模块依赖图 + 数据流
    ├── domain-engine.md              # 纯函数引擎 + 规则系统 + 模式判定范式
    ├── data-driven-catalog.md        # 数据目录 + probe 自验证 + 解析层分离
    ├── ai-integration.md             # AI 导师/报告/配置三件套 + SSE 解析
    ├── lesson-and-tts.md             # 讲解自动派生 + 确定性重放 + TTS
    └── code-templates.ts             # 可直接套用的 TypeScript 代码模板
```

---

## 🚀 如何使用

### 作为 AI 编程助手的 Skill

将 `SKILL.md` 放入你的 Skill 目录（如 `.trae/skills/virtual-lab-forge/`），连同 `references/` 一起。当你要构建虚拟实验/仿真教学平台时，助手会自动调用此 Skill 提供架构指导。

### 落地新学科的步骤

1. **建领域引擎**：定义 `Entity` / `Conditions` / `DomainResult`，写 `simulate()` 纯函数 + 规则集
2. **建解析层**：自然语言标签 → `Entity`，注意顺序敏感性
3. **建数据目录**：每条实验带 `probe`（自验证），先写 5-10 条跑通闭环
4. **建模式判定**：若多装置，写 `resolveLabMode`
5. **建画布**：store 委托引擎，几何即数据
6. **建讲解**：`buildLesson` 从数据自动派生
7. **接 AI**：导师流式 + 报告结构化 + 配置优先级链
8. **加 TTS**：预生成脚本 + 播放回退链
9. **补测试**：引擎规律 / 试剂解析 / 讲解生成 / probe 自验证

详见 `SKILL.md` 第 7 节。

---

## ⚖️ 版权与许可

### License

本项目采用 **[MIT License](LICENSE)**，与原始项目保持一致。

### 来源声明（Attribution）

本 Skill 的方法论与架构模式提炼自以下开源项目：

> **ChemAIForge** — AI 驱动的化学虚拟实验平台
> 作者：[zhangifonly](https://github.com/zhangifonly)
> 仓库：https://github.com/zhangifonly/ChemAIForge
> 许可：MIT License (Copyright (c) 2026 zhangifonly)

根据 MIT License 的要求，本衍生作品保留了原始作者的版权声明与许可声明（见 [LICENSE](LICENSE)）。本 Skill 中的方法论提炼、模式归纳、通用化文档与代码模板为原创贡献，依据同一 MIT License 开源。

### 合规说明

- ✅ 原始项目为 MIT 协议，允许修改、分发、商用
- ✅ 本项目保留了原始项目的版权声明（MIT 协议唯一硬性要求）
- ✅ 本项目为方法论提炼（架构思想/模式），非源码直接复制
- ✅ 衍生作品采用与原始项目相同的 MIT 协议

---

## 🔗 相关链接

- **原始项目**：[ChemAIForge](https://github.com/zhangifonly/ChemAIForge)
- **在线体验**：[chem.whaty.org](https://chem.whaty.org)

---

## 📜 技术栈（参考实现选型）

| 关注点 | 选型 |
|---|---|
| 全栈框架 | Next.js 14 (App Router) |
| 语言 | TypeScript (strict) |
| 样式 | Tailwind CSS |
| 状态 | Zustand |
| 数据库 | SQLite + Prisma（零配置） |
| AI | Claude Messages API（流式 + 非流式） |
| 语音 | edge-tts 离线预生成 mp3 |
| 测试 | Vitest |

---

<div align="center">

**License:** [MIT](LICENSE) · **Attribution:** [ChemAIForge](https://github.com/zhangifonly/ChemAIForge)

</div>
