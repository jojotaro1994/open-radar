# Introduce Intelligence Operating Model Design

## 1. Design Goal

本轮 design 的目标，是把当前系统从：

- search-oriented radar

收敛成：

- **meeting-governed intelligence operating system**

设计优先级固定为：

1. 模型稳定性
2. 治理清晰度
3. lineage 可追溯
4. local-folder 可落地
5. 对未来 graph db 兼容

## 2. Terminology Freeze

### 2.1 Product identity

- Product form: `CLI-first intelligence operating system`
- Runtime controls remain:
  - `Intent`
  - `Scout Brief`
  - `Knowledge Brief`
  - `Meeting Goal`

### 2.2 Core ontology

- `ReferenceFact`
- `Evidence`
- `Finding`
- `DecisionObject`
- `ActionAsset`

### 2.3 Governance + learning

- `HumanReviewFeedback`
- `EvidenceRequest`
- `RetrospectiveCase`
- `LearningMemory`

## 3. Object Model

### 3.1 ReferenceFact

定义：

- 系统用于校验 intelligence 的基准真相

职责：

- 产品事实
- 能力边界
- 已知限制
- 术语
- pricing / packaging constraints

约束：

- 不能直接生成商业机会
- 可被 `Finding` 标记为冲突对象

### 3.2 Evidence

定义：

- 最小可回溯证据单元

最小属性：

- `evidenceId`
- `sourceId`
- `locator`
- `capturedAt`
- `normalizedText`
- `entityRefs`
- `confidence`

### 3.3 Finding

定义：

- 统一判断对象，替代 claim / pattern / hypothesis 三套主对象

必须字段：

- `findingId`
- `findingKind`
  - `observation`
  - `pattern`
  - `interpretation`
  - `contradiction`
- `aggregationLevel`
  - `single_evidence`
  - `multi_evidence`
  - `cross_source`
  - `cross_run`
- `decisionRelevance`
  - `opportunity`
  - `risk`
  - `gap`
  - `execution`
  - `monitoring`
- `supportedByEvidenceIds`
- `metricsContext`
- `conflictsWithReference`
- `freshness`

### 3.4 DecisionObject

定义：

- 需要进入 meeting 治理的判断对象

必须字段：

- `decisionObjectId`
- `kind`
  - `opportunity`
  - `risk`
  - `gap`
  - `watch_item`
  - `decision_needed`
- `statement`
- `supportedByFindingIds`
- `priorityBand`
- `metricsImpact`
- `ownerSuggestion`
- `freshness`

### 3.5 ActionAsset

定义：

- 从已治理的判断对象派生出的行动资产

必须字段：

- `actionAssetId`
- `assetType`
  - `executive_digest`
  - `opportunity_memo`
  - `org_playbook`
  - `prototype_brief`
  - `video_brief`
  - `weekly_brief`
  - `alert`
- `derivedFromDecisionObjectIds`
- `audience`
- `status`

### 3.6 HumanReviewFeedback

定义：

- 人类对当前 DecisionObject 的结构化 review 输入

必须字段：

- `feedbackId`
- `decisionObjectId`
- `resolution`
  - `approve`
  - `reject`
  - `defer`
  - `watch`
  - `escalate`
- `feedbackClass`
  - `not_real_opportunity`
  - `insufficient_evidence`
  - `wrong_timing`
  - `not_strategic_now`
  - `duplicate`
  - `already_known`
  - `cannot_execute_now`
  - `other`
- `humanReason`
- `reviewedBy`
- `reviewedAt`

### 3.7 EvidenceRequest

定义：

- 当前决策仍缺什么资料，以及这些资料是否可得

必须字段：

- `requestId`
- `decisionObjectId`
- `requestedItem`
- `whyItMatters`
- `priority`
- `availabilityStatus`
  - `available_now`
  - `available_later`
  - `not_available`
  - `unknown`
- `humanNote`

### 3.8 RetrospectiveCase

定义：

- 被 reopen 的历史判断复盘对象

必须字段：

- `retrospectiveCaseId`
- `originalDecisionObjectId`
- `originalResolution`
- `reopenReason`
- `whatChanged`
- `misjudgmentType`
  - `interpretation_error`
  - `missing_evidence`
  - `timing_error`
  - `priority_error`
  - `reference_conflict_missed`
- `lessons`
- `recommendedPolicyUpdate`

### 3.9 LearningMemory

定义：

- bounded、可复审、可替代的 policy-level learning

不是：

- archive
- 第二知识库
- case dump

必须字段：

- `memoryId`
- `memoryType`
  - `decision_heuristic`
  - `evidence_policy`
  - `anti_pattern`
  - `blind_spot`
  - `watch_rule`
- `statement`
- `derivedFromRetrospectiveCaseIds`
- `status`
  - `candidate`
  - `active`
  - `superseded`
  - `expired`
- `reviewAfter`
- `supersedesMemoryId?`
- `confidence`
- `freshness`

## 4. Operating Model

### 4.1 Scout

职责：

- 按 `Scout Brief` 搜索、抓取、抽取
- 输出 `Evidence`

原则：

- 弱感知已有 coverage / gaps / avoid rules
- 不看最终 accepted decisions
- 不看完整 retrospective judgments

### 4.2 Modeler

职责：

- evidence 去重
- 实体映射
- reference 校验
- metrics 挂接
- `Finding` / `DecisionObject` 建模

这是 intelligence runtime 的主加工层。

### 4.3 Meeting

职责：

- 治理建模后的对象
- 决定是否进入 activation
- 决定是否需要补证据
- 决定是否进入 retrospective lane

meeting 不直接消费 raw evidence 作为主输入。

## 5. Meeting Architecture

### 5.1 Review Meeting

输入：

- `DecisionObject candidates`
- supporting `Finding bundle`
- `ReferenceFact conflicts`
- metrics context
- `Meeting Goal`

输出：

- resolution
- `HumanReviewFeedback`
- `EvidenceRequest`
- activation targets

### 5.2 Retrospective Meeting

输入：

- `RetrospectiveCase`
- 原始 decision chain
- 后续新增 evidence / metrics / outcomes

输出：

- lessons
- policy update candidates
- `LearningMemory` candidates

### 5.3 Meeting Goal becomes policy input

`Meeting Goal` 不再只是 prompt framing，而是 `Meeting Policy` 的输入之一：

- primary lens
- decision style
- overweight / underweight rules
- metrics emphasis

## 6. Metrics Intelligence

`ARR / NRR / NDR` 在本轮是一等对象上下文。

规则：

- 重要 `Finding` 必须带 `metricsContext`
- 重要 `DecisionObject` 必须能说明：
  - 影响 ARR / NRR / NDR 哪一项
  - 影响方向
  - direct / indirect / speculative
- retrospective 必须允许“当时没有 metrics，所以误判”的情况被记录

## 7. Local-Folder Physical Mapping

本轮 source of record 继续采用 local folder。

### 7.1 Canonical layout

```text
reference/
  product-truth/
  capability-boundaries/
  known-limitations/
  terminology/
  pricing-packaging/

intelligence/
  topics/
    customer-intel/
      sources/
      evidence/
      findings/
      decision-objects/
      runs/
      manifests/
      watchlists/
    sales-intel/
    competitive-intel/
    market-intel/

indexes/
  entities/
  org-mapping/
  feature-mapping/
  terminology-links/

review/
  checkpoints/
  decisions/
  queues/
  retrospective/

published/
  executive-digests/
  opportunity-memos/
  org-playbooks/
  prototype-briefs/
  video-briefs/
  weekly-briefs/
  alerts/

runtime/
  schedules/
  runs/
  logs/
  state/
```

### 7.2 Mapping principles

- JSON/JSONL = object storage
- Markdown = human-facing published assets
- stable IDs = graph-compatible lineage
- legacy paths may remain temporarily, but canonical paths must be explicit

## 8. Hard Constraints

1. `ReferenceFact` 不直接生成商业机会
2. 所有 `Finding` 必须回链 `Evidence`
3. 所有 `DecisionObject` 必须回链 `Finding`
4. 所有 `ActionAsset` 必须回链 `DecisionObject`
5. `conflictsWithReference` 合法且高价值
6. `LearningMemory` 必须 bounded、可 review、可 supersede、可 expire
7. `EvidenceRequest.availabilityStatus` 必须是一等状态
8. 历史 review / meeting decisions 保持不可变；学习通过新对象影响未来 policy

## 9. Migration Strategy

本轮不要求全量迁移，只要求定义迁移骨架。

### 9.1 Canonical path

- 新对象必须写向 canonical layout

### 9.2 Compatibility path

- 旧 `customer-journey-usage`
- 旧 `customer-intel`
- 旧 `review-queue`
- 旧 `meeting-records`

可继续读取，但必须在 design 中定义其 future mapping。

### 9.3 Defer full rewrite

代码和数据的全量迁移留到后续 implementation changes。
