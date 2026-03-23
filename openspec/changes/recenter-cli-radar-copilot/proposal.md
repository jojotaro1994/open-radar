# CLI-first Radar Copilot

## Summary

`prj-prototype-rader` 当前要收敛成一个 CLI-first opportunity radar copilot。

它不是 web dashboard 产品，不是 viewer 产品，不是通用 brief generator，也不是 24/7 runtime 系统。
当前产品形态是：用户通过单一 CLI 对话入口，长期塑形系统如何搜、系统懂什么、以及系统如何讨论判断。

当前最重要的能力是三层长期上下文：

1. Search Context — 系统应该如何搜、搜哪些 source、压低哪些噪音、加强哪些方向
2. Knowledge Pack — 系统应该知道哪些业务事实、能力边界、vertical context、opportunity heuristics
3. Meeting Charter — 系统在评估/讨论/解释时，应该围绕什么目标和问题来进行

系统中的所有用户修改默认都不是立即执行，而是：

`draft -> structured preview -> refine/rewrite -> confirm -> apply`

其中：

- `y` = persist
- `n` = 进入 refine mode，不落盘
- `cancel` = 丢弃当前 draft
- 用户重写一句 = 重新生成 preview，不直接执行

## Why

当前 repo 已经有一批实现，尤其是 CLI、状态输出、patch 处理、run pipeline 闭环方向已经开始成形。
但当前实现仍然存在几个典型问题：

- 历史模型里 `ActiveStrategy/session patch` 仍然占了过多中心位置，超过了它作为 session/run-level overlay 应有的边界
- Search / Knowledge / Meeting 这三层长期上下文还没有被正式对象化
- 某些 CLI 行为已经存在，但和新的产品方向不完全一致
- 某些运行路径和状态对象已经初步落地，但还不够统一、可解释、可长期演化

因此本轮不是继续扩大战线，也不是恢复一整套 spec，而是：

1. 先明确产品 proposal
2. 先明确 design
3. 先 review 当前实现
4. 先修正实现和当前产品方向之间的偏差
5. 再安排后续任务

## Product Direction

### Product Form

- CLI-first
- single entry
- no user file editing
- no mandatory web UI
- no session-first model as main product story

### Core Objects

当前主模型应收敛为：

- Current Intent
- Search Context
- Knowledge Pack
- Meeting Charter
- Last Run

### Core Pipeline

主链路保持：

`source ingestion -> normalize -> score/augment -> routing/qualification -> review queue -> human triage -> theme clustering -> opportunity assembly -> downstream consumers`

### Frozen Principles

以下原则继续有效：

1. Human triage 是唯一 mandatory hard gate
2. `ReviewQueueItem.status` 是 triage/review 的唯一 authoritative source
3. `ScoredSignal` 不承载最终 review 决策字段
4. `1 ThemeCandidate -> 1 Opportunity`
5. signal membership exclusive
6. `PrototypeBrief / VideoBrief / JiraDraft / RadarDigest` 是 downstream registered consumers
7. consumers 不是 pipeline 主干

## Capabilities

本轮 change 的标准 OpenSpec capability deltas 收敛为：

- `radar-context-model` — 定义五对象主模型，以及 session/run-level overlay 的过渡定位
- `preview-first-change-flow` — 定义 `draft -> structured preview -> refine/rewrite -> confirm -> apply` 的标准行为
- `cli-state-and-run` — 定义 `/state` 与 `/run` 应围绕长期上下文对象工作
- `triage-authority-and-downstream-boundaries` — 固化 human triage、authoritative review state 与 downstream consumer 边界

## In Scope

本轮 proposal 的 scope：

- CLI-first 产品叙事定型
- Search Context / Knowledge Pack / Meeting Charter 进入主设计
- persistent preview/refine/confirm/apply 流程定型
- review 当前实现与方向偏差
- 以实现 review 为基础重写任务列表
- 以 proposal/design/tasks 驱动下一步，而不是先恢复大而全 spec

## Out of Scope

本轮不做：

- web UI / dashboard
- 24/7 runtime
- dynamic source onboarding framework 的完整实现
- full Analyst Deliberation system
- editable source role
- multi-intent orchestration
- 恢复一整套旧式 specs 作为第一优先级工作

## Current-Reality Notes

以下描述截至 2026-03-23 的实际状态：

- `src/cli/radar-cli.ts` ✅ 现在以五对象（Current Intent / Search Context / Knowledge Pack / Meeting Charter / Last Run）为 CLI 主模型；ActiveStrategy 标注为 session overlay
- `src/cli/patch-handler.ts` ✅ 现在采用字段级路由：relevanceThreshold 和 excludeTags 默认 persistent preview；sourceBias 强制 session；focus 强制 session（已有 nudge toward includeTags）
- `src/state/state-printer.ts` ✅ 现在输出 5 个段落，ActiveStrategy 显示为 subordinate
- `src/orchestrator/run-pipeline.ts` ✅ 现在加载 SearchContext + KnowledgePack 并传入 pipeline；MeetingCharter 快照保存但尚未影响运行时语义
- `src/engine/review-queue.ts`、`src/orchestrator/invariants.test.ts` ✅ 继续体现 hard-gate 和 single-source-of-truth 正确方向

**仍然部分状态：**

- patch-handler 的 `classifyPatch()` 函数仍然返回 "session" 作为默认，但当前路由逻辑是字段级的，不再调用该函数（已记录为 known gap）
- `MeetingCharter` 尚未在 pipeline 运行时产生语义影响（仅 snapshot）
- `/why` 和 `/review` 命令尚未实现（数据层基础已铺设）

**仍待收敛的设计目标：**

- `focus` 方向的 persistent path 尚未完全支持
- `SearchContext.topicBoosts/topicSuppressions/recallMode` 尚未影响 scoring/qualification

## Expected Outcome

完成本轮后，项目应有：

- 清晰的 CLI-first proposal
- 清晰的 design
- 基于当前实现 reality 的 tasks
- task1 明确聚焦：修复实现偏离方向的问题
- 一个新 agent 能据此先 review 实现，再开始修正，而不是继续抽象发散
