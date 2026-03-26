# Introduce Intelligence Operating Model

## Summary

`split-knowledge-base-and-radar-flows` 已经把 CLI-first runtime 的 control surfaces、双 workflow 和 explainability 基础收敛出来。  
但产品主语仍然停留在 “opportunity radar + meeting review”。

本 change 正式把产品重定义为：

- **CLI-first intelligence operating system**
- **meeting-governed, not search-governed**
- **local-folder source of record, graph-compatible object model**

本轮冻结两项不变内核：

1. CLI 是产品第一形态
2. multi-agent meeting 继续存在，且 `Meeting Goal` 可调

本轮正式引入的新主模型为：

- `ReferenceFact`
- `Evidence`
- `Finding`
- `DecisionObject`
- `ActionAsset`

并引入一条新的治理/学习闭环：

- `HumanReviewFeedback`
- `EvidenceRequest`
- `RetrospectiveCase`
- `LearningMemory`

## Why

当前产品和 repo 已经暴露出新的现实：

- 情报员在实战中并不是“自动搜一切”的人格化 agent；大量来源选择、下载、判断仍由人类承担
- 真正缺的不是更多搜索能力，而是一个能够把多种来源统一建模的 intelligence model
- `ARR / NRR / NDR` 在商业语境下是第一等判断因素，但当前产品模型里没有位置承接它们
- `meeting` 仍然更像 signal review，而不是 DecisionObject 的治理层
- `prototype / video / playbook` 等产物应该是 activation plane 的下游，而不是主产品叙事中心

这意味着系统不应再被定义成“机会雷达”，而应被定义成：

> 一个将多源业务现实、竞争情报、客户使用数据、销售推进和商业指标，转化为可追溯判断和决策对象的 intelligence operating system。

## What Changes

### 1. Product Truth becomes Reference Baseline

`Product Truth` 不再与普通 intelligence 混层，而是被正式定义为 `Reference Baseline`：

- `Product Truth`
- `Capability Boundary`
- `Known Limitations`
- `Terminology`
- `Pricing / Packaging Constraints`

`Reference Baseline` 只能：

- 校验
- 解释
- 标记冲突
- 限制 hallucination

它不能直接生成商业机会。

### 2. Intelligence pipeline is unified around Finding

本轮不再把 `claim / pattern / hypothesis` 维持为三套主对象。  
主判断对象统一收敛为 `Finding`，通过字段表达成熟度和聚合层次。

最终主链路收敛为：

`Evidence -> Finding -> DecisionObject -> ActionAsset`

其中：

- `Evidence` 是最小可回溯证据单元
- `Finding` 是统一判断对象
- `DecisionObject` 是 meeting 要治理的对象
- `ActionAsset` 是对外行动化产物

### 3. Meeting is redefined as governance, not commentary

本轮正式把 meeting 重定义为治理层，而不是 signal 摘要器。

引入两种会议：

- `Review Meeting`
  - 消费 `DecisionObject candidates`
  - 产出 resolution、evidence requests、activation decisions
- `Retrospective Meeting`
  - 消费被 reopen 的历史案例
  - 产出 learning candidates、policy corrections、evidence guidance

### 4. Decision learning loop becomes a first-class capability

本轮正式引入：

- `HumanReviewFeedback`
- `EvidenceRequest`
- `RetrospectiveCase`
- `LearningMemory`

目的不是“记录 reject reason”，而是让系统能从：

- 误判
- 信息不足
- 时机错误
- 不可获得的资料

中持续学习。

### 5. Metrics become first-class decision inputs

`ARR / NRR / NDR` 本轮正式进入主判断链。

它们必须参与：

- `Finding`
- `DecisionObject`
- `Meeting resolution`
- `RetrospectiveCase`

系统必须能解释一个重要判断：

- 影响 ARR / NRR / NDR 哪一项
- 影响方向是什么
- 是 direct / indirect / speculative

### 6. Scout / Modeler / Meeting become the operating model

本轮正式把 intelligence runtime 的职责收敛为三层：

- `Scout`
  - 只按 `Scout Brief` 找证据
  - 弱感知已有覆盖与缺口，不直接看高层结论
- `Modeler`
  - 做去重、实体映射、Reference 校验、metrics 挂接、Finding/DecisionObject 建模
- `Meeting`
  - 只消费建模后的对象
  - 做治理与决策

## Product Direction

### Product form

- CLI-first
- OpenClaw / Claude Code / skill 友好
- no web-first dependency
- local-folder source of record
- graph-compatible object lineage, but no graph-db requirement in this change

### Core story

用户不是在操纵一组会说话的人格 agent，  
而是在控制一个 intelligence operating system：

- `Scout Brief` 控制去哪里找资料
- `Modeler` 负责把资料建模
- `Meeting Goal` 控制会议如何判
- `Reference Baseline` 负责校验真相
- `Decision Learning Loop` 负责从错估中进化

## Capabilities

本轮 capability deltas 固定为：

- `reference-baseline`
- `intelligence-object-model`
- `meeting-governance`
- `decision-learning-loop`
- `metrics-intelligence`
- `activation-plane`

## In Scope

- 定义新的 intelligence OS 总模型
- 定义五个主对象与四个学习对象
- 定义 Review / Retrospective 双 meeting
- 定义 Scout / Modeler / Meeting operating model
- 定义弱感知 Scout 上下文原则
- 定义 `ARR / NRR / NDR` 进入主判断链
- 定义 local-folder canonical layout 和 compatibility migration strategy
- 产出可驱动后续多轮实现的 proposal / design / tasks / spec deltas

## Out of Scope

- graph db 接入与迁移
- web UI
- 完整数据仓库建设
- 一次性迁完所有历史目录和数据
- 真正复杂的 agent orchestration
- 自治式目标改写

## Expected Outcome

完成本轮后，项目应拥有：

- 一个新的上位 OpenSpec change，明确产品已从 radar 升级为 intelligence OS
- 一套稳定的主对象模型
- 一套稳定的 meeting / retrospective / learning 闭环
- 一套 graph-compatible 的文件系统落地方案
- 一套能继续指导 OpenClaw / Claude Code 插件形态的 runtime model
