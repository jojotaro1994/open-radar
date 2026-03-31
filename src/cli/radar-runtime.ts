import * as fs from "fs"
import * as path from "path"
import type { RadarIntent } from "../schemas/intent.js"
import { ActiveStrategyManager } from "../state/active-strategy.js"
import { LastRunStore } from "../state/last-run.js"
import { SearchContextStore } from "../state/search-context-store.js"
import { ScoutBriefStore } from "../state/scout-brief-store.js"
import { ScoutPlanStore } from "../state/scout-plan-store.js"
import { KnowledgeBaseStore } from "../state/knowledge-base-store.js"
import { KnowledgePackStore } from "../state/knowledge-pack-store.js"
import { MeetingGoalStore } from "../state/meeting-goal-store.js"
import { MeetingCharterStore } from "../state/meeting-charter-store.js"
import { KnowledgeBriefStore } from "../state/knowledge-brief-store.js"
import { ModelConfigStore } from "../state/model-config-store.js"
import { RunContextStore } from "../state/run-context-store.js"
import { MeetingRecordStore } from "../state/meeting-record-store.js"
import { DecisionObjectStore } from "../state/decision-object-store.js"
import { FindingStore } from "../state/finding-store.js"
import { EvidenceStore } from "../state/evidence-store.js"
import { DecisionCardStore } from "../state/decision-card-store.js"
import { HumanReviewFeedbackStore } from "../state/human-review-feedback-store.js"
import { EvidenceRequestStore } from "../state/evidence-request-store.js"
import { RetrospectiveCaseStore } from "../state/retrospective-case-store.js"
import { RetrospectiveCandidateStore } from "../state/retrospective-candidate-store.js"
import { ReferenceFactStore } from "../state/reference-fact-store.js"
import { StagedKnowledgeStore } from "../state/staged-knowledge-store.js"
import { GraphMappingPlanStore } from "../state/graph-mapping-plan-store.js"
import { LearningMemoryStore } from "../state/learning-memory-store.js"

export const DATA_DIR = process.env.RADAR_DATA_DIR ?? path.join(process.cwd(), "data")
export const CONFIG_DIR = path.join(process.cwd(), "config")

export interface RadarRuntime {
  intentId: string
  intent: RadarIntent
  strategyManager: ActiveStrategyManager
  lastRunStore: LastRunStore
  searchContextStore: SearchContextStore
  scoutBriefStore: ScoutBriefStore
  scoutPlanStore: ScoutPlanStore
  knowledgeBaseStore: KnowledgeBaseStore
  knowledgePackStore: KnowledgePackStore
  meetingGoalStore: MeetingGoalStore
  meetingCharterStore: MeetingCharterStore
  knowledgeBriefStore: KnowledgeBriefStore
  modelConfigStore: ModelConfigStore
  runContextStore: RunContextStore
  meetingRecordStore: MeetingRecordStore
  decisionObjectStore: DecisionObjectStore
  findingStore: FindingStore
  evidenceStore: EvidenceStore
  stagedKnowledgeStore: StagedKnowledgeStore
  graphMappingPlanStore: GraphMappingPlanStore
  decisionCardStore: DecisionCardStore
  feedbackStore: HumanReviewFeedbackStore
  evidenceRequestStore: EvidenceRequestStore
  retrospectiveStore: RetrospectiveCaseStore
  retrospectiveCandidateStore: RetrospectiveCandidateStore
  referenceFactStore: ReferenceFactStore
  learningMemoryStore: LearningMemoryStore
}

export function loadIntent(intentId: string): RadarIntent {
  const intentPath = path.join(CONFIG_DIR, "intents", `${intentId}.json`)
  if (!fs.existsSync(intentPath)) throw new Error(`Intent not found: ${intentPath}`)
  return JSON.parse(fs.readFileSync(intentPath, "utf-8")) as RadarIntent
}

export function createRadarRuntime(intentId: string): RadarRuntime {
  return {
    intentId,
    intent: loadIntent(intentId),
    strategyManager: new ActiveStrategyManager(),
    lastRunStore: new LastRunStore(DATA_DIR),
    searchContextStore: new SearchContextStore(CONFIG_DIR),
    scoutBriefStore: new ScoutBriefStore(DATA_DIR),
    scoutPlanStore: new ScoutPlanStore(DATA_DIR),
    knowledgeBaseStore: new KnowledgeBaseStore(CONFIG_DIR),
    knowledgePackStore: new KnowledgePackStore(CONFIG_DIR),
    meetingGoalStore: new MeetingGoalStore(DATA_DIR),
    meetingCharterStore: new MeetingCharterStore(CONFIG_DIR),
    knowledgeBriefStore: new KnowledgeBriefStore(CONFIG_DIR),
    modelConfigStore: new ModelConfigStore(CONFIG_DIR),
    runContextStore: new RunContextStore(DATA_DIR),
    meetingRecordStore: new MeetingRecordStore(DATA_DIR),
    decisionObjectStore: new DecisionObjectStore(DATA_DIR),
    findingStore: new FindingStore(DATA_DIR),
    evidenceStore: new EvidenceStore(DATA_DIR),
    stagedKnowledgeStore: new StagedKnowledgeStore(DATA_DIR),
    graphMappingPlanStore: new GraphMappingPlanStore(DATA_DIR),
    decisionCardStore: new DecisionCardStore(DATA_DIR),
    feedbackStore: new HumanReviewFeedbackStore(DATA_DIR),
    evidenceRequestStore: new EvidenceRequestStore(DATA_DIR),
    retrospectiveStore: new RetrospectiveCaseStore(DATA_DIR),
    retrospectiveCandidateStore: new RetrospectiveCandidateStore(DATA_DIR),
    referenceFactStore: new ReferenceFactStore(DATA_DIR),
    learningMemoryStore: new LearningMemoryStore(DATA_DIR),
  }
}
