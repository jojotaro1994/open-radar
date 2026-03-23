# Tasks

## Task 1 — Review current implementation and fix drift against current product direction
**Priority: P0**
**Status: PARTIAL — review complete, acceptance baseline not yet green**

目标：

- 审查当前 CLI、state、patch、run pipeline 等实现
- 找出它们与当前产品方向的偏差
- 修复最关键的方向性偏差

重点检查（已完成）：

- [x] 是否仍然以 `ActiveStrategy/session patch` 作为主模型 → CLI header/help/state-printer 已更正
- [x] `/state` 是否仍未体现 Search Context / Knowledge Pack / Meeting Charter → 已添加5段结构
- [x] `/run` 是否仍然只围绕旧模型工作 → run-pipeline header 已更正为 reality-aligned
- [x] 是否存在”用户一句自然语言就直接执行”的路径 → patch-handler comment 已更正，persistent path 有 preview，session path 无（记录在 design.md）
- [x] preview/refine/confirm/apply 语义是否清晰 → persistent path 有 structured preview + y/n，comment 已对齐
- [x] search / knowledge / meeting 是否混成一层 → 三层已分离为独立 interface

交付（review/output 已完成）：

- [x] concise implementation review → Round 1 输出
- [x] drift list → D1-D7 记录，D1/D2/D7 已修复，D3-D6 记录为已知 gap
- [x] file-by-file mapping → Round 1 输出
- [x] minimal first-fix plan → Round 1 输出
- [x] minimal low-risk code corrections only where drift is already obvious → 已开始执行

Acceptance blockers:

- `npm run build` 必须为绿；当前 adapter schema 兼容问题仍是阻塞项
- docs/task status 不能超过真实 wiring 进度

**Remaining open drift (documented, not blocking):**
- D3: Session patches go immediate without structured preview — architectural gap, persistent path already has preview
- D4: `classifyPatch` default = “session” — cannot change until D3 is resolved
- D6: SearchContext/KnowledgePack/MeetingCharter not runtime-wired into pipeline — documented in run-pipeline header, later task

## Task 2 — Introduce top-level persistent object model
**Priority: P1**
**Status: PARTIAL — structure done, only part of runtime wired**

目标：
把新的主模型正式引入设计和配置层：

- Current Intent ✅ 已存在
- Search Context ✅ type + store + config 文件已建立
- Knowledge Pack ✅ type + store + config 文件已建立
- Meeting Charter ✅ type + store + config 文件已建立
- Last Run ✅ 已存在

已交付：

- `src/state/search-context.ts` — SearchContext interface + SearchContextSummary
- `src/state/knowledge-pack.ts` — KnowledgePack interface + KnowledgePackSummary
- `src/state/meeting-charter.ts` — MeetingCharter interface + MeetingCharterSummary
- `src/state/*-store.ts` — 三个 store 类（JSON 文件持久化）
- `config/intents/riplus-ma.*.json` — 三个占位配置（可加载）
- `radar-cli.ts` — /state 现在加载并展示三个新对象

未交付（后续任务）：

- pipeline 运行时完整读取 SearchContext/KnowledgePack/MeetingCharter（Task 5）

## Task 3 — Make persistent preview/refine/confirm/apply the only main change flow
**Priority: P1**
**Status: PARTIAL — preview-first only covers a subset of fields**

已交付：

- `relevanceThreshold` → persistent preview by default (structured preview + y/n) ✅
- `sourceBias` → always session immediate (no persistent equivalent yet) ✅
- `excludeTags` → persistent preview (unchanged) ✅

当前行为：

- `relevanceThreshold` 无 marker → persistent preview + y/n
- `relevanceThreshold` + “这轮”/”先”/etc. → session immediate
- `excludeTags` → persistent preview + y/n
- `sourceBias` → always session immediate
- `focus` → session immediate only (persistent path: use includeTags)

未完全交付：

- `focus` 方向的 persistent path 尚未完全支持（当前 nudges toward includeTags）
- Task 3 要求”make persistent ... the ONLY main long-lived change flow” — session path
  仍然存在用于兼容性（focus、sourceBias 等场景）

## Task 4 — Align CLI `/state` with the new object model
**Priority: P1**
**Status: DONE ✅**

`state-printer.ts` 现在输出5个段落：

- Current Intent ✅
- Search Context ✅ (shows “(not yet configured)” 如果为空)
- Knowledge Pack ✅ (shows “(not yet configured)” 如果为空)
- Meeting Charter ✅ (shows “(not yet configured)” 如果为空)
- Last Run ✅

ActiveStrategy 显示为 `── Active Strategy (session overlay) ──`， subordinate 标注。

## Task 5 — Make `/run` read long-lived context objects
**Priority: P1**
**Status: PARTIAL — SearchContext + KnowledgePack partially wired; MeetingCharter snapshot-only**

已交付：

- `PipelineOptions` 增加 `searchContext?: SearchContext` 和 `knowledgePack?: KnowledgePack` ✅
- `SearchContext.sourceWeights` 在 adapter 选择阶段应用：weight=0 的 source 被 suppress ✅
- `KnowledgePack.opportunityHeuristics` 通过 `buildVerticalContext` 注入 LLM prompt ✅
- `commercial-analyst.ts` `batchAssess` 签名扩展为接受 `knowledgePack` ✅
- `/run` 现在加载 MeetingCharter 并把真实 summary 写入 `LastRunSummary` / `RunContext` ✅

未交付：

- `MeetingCharter` 尚未影响 pipeline 运行语义（仅 snapshot/wiring truth）
- `SearchContext.topicBoosts` / `topicSuppressions` / `recallMode` 尚未影响 scoring/qualification

## Task 6 — `/why` explainability command
**Priority: P2**
**Status: DONE ✅**

已交付：

- `radar-cli.ts` — `/why {signalId}` 命令实现
- 读取 `data/review-queue/{signalId}/meta.json` → 获取 `cycleId`
- 读取 `data/review-queue/{signalId}/status.json` → 当前 triage status
- 读取 `data/review-queue/{signalId}/triage.json` → decision + reason
- 读取 `data/scored-signals/{signalId}.json` → signal title, relevanceScore, qualification
- 读取 `data/run-contexts/{cycleId}.json` → SearchContext/KnowledgePack at time of triage（如果存在）
- 当 run-context 不可用时（较老 cycle），正确降级显示

输出格式示例：
```
── Signal: jira-ma-MA-11146 ──
Title:   email monitor analysize support ck
Score:   0.392  |  Qualification: unknown
Status:  deferred
Triage:  deferred  by riplus-ma-agent  at 2026-03-22T04:13:13.960Z
Reason:  Below threshold
Cycle:   riplus-20260322-1774152785378  enqueued 2026-03-22T04:13:13.836Z
(searchContext recallMode: normal — if run-context available)
─────────────────────────────
```

未交付（后续任务）：

- `/review` 命令本身尚未实现
- `/why` 对较老 cycle（run-context 不存在时）可显示 triage 信息但无上下文

## Task 7 — Deprecate session-first framing in docs and code paths
**Priority: P2**
**Status: DONE ✅**

已完成：

- `radar-cli.ts` header + /help → 五对象模型
- `state-printer.ts` → 五段落结构 + ActiveStrategy subordinate 标注
- `patch-handler.ts` → comment 正确反映当前行为
- `run-pipeline.ts` header → reality-aligned
- Runner files (`*-runner.ts`) checked — 无旧 session-first framing

未完成：

- 未触碰的 runner 文件中的旧 session-first 引用（如有）

## Task 8 — Rebuild OpenSpec later from stabilized proposal/design/tasks
**Priority: Deferred**

说明：

- 现在不要先恢复一整套 spec

## Task 9 — Single-intent safe adapter catalog
**Priority: P1**
**Status: DONE ✅**

目标（来自 adapter-pluggability-proposal.md）：

- 引入 config-driven adapter catalog
- registry bootstrap 只注册 catalog-enabled 的 adapter
- sourcePriority 为空时返回安全空集，不回退到全部 adapter
- Search Context 不得越权激活 intent allow-list 之外的 adapter

已交付：

- `config/adapter-catalog.json` — 所有已知 adapter 的清单，`enabled` 标志控制可用性
  - 当前 enabled=true: hackernews, riplus-insurance-travel
  - 当前 enabled=false: jira-rr, jira-ma, confluence, github-discussions
- `src/registry/adapter-catalog.ts` — catalog 加载模块，`isAdapterEnabled()`, `getEnabledAdapters()`
- `src/registry/register-all.ts` — 改为只注册 catalog 中 enabled=true 的 adapter
- `src/registry/source-registry.ts` — `listForIntent()` 修复：
  - sourcePriority 为空 → 返回安全空集 `[]`（不再回退到全部已注册 adapter）
  - 日志明确说明 intent sourcePriority 为空时返回空集
- `src/registry/catalog-validate.ts` — 手动验证脚本，证明四个安全保证

安全保证验证结果：

- ✓ enabled adapter 可被 intent 使用（riplus-insurance-travel）
- ✓ disabled adapter 不可用（jira-ma, confluence, github-discussions）
- ✓ sourcePriority 为空 → 返回 `[]`（不是全部 adapter）
- ✓ SearchContext 不得激活 intent allow-list 之外的 adapter

验收标准（来自 proposal）：

- ✅ 删除或禁用 adapter 后不再出现在可选列表
- ✅ 新 intent 不会因为历史注册表自动带上旧 adapter
- ✅ `default` intent 不再自动吸纳全部 adapter
- ✅ SearchContext 只能作用于 intent 已允许的 adapter

- 避免把 target state 冒充成 current truth
- 等核心设计和实现稳定后再补 OpenSpec
