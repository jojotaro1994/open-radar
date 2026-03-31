import type { SearchContext, SearchContextSummary } from "./search-context.js"
import type { KnowledgeBase, KnowledgeBaseSummary } from "./knowledge-base.js"
import type { KnowledgePack, KnowledgePackSummary } from "./knowledge-pack.js"
import type { MeetingCharter, MeetingCharterSummary } from "./meeting-charter.js"
import type { KnowledgeBrief, KnowledgeBriefSummary } from "./knowledge-brief.js"

/**
 * Scout Brief summary for CLI display.
 * Product model name: Scout Brief | Internal type: SearchContext
 */
export function summarizeSearchContext(searchContext?: SearchContext | null): SearchContextSummary {
  if (!searchContext) return {}
  return {
    sourceWeights: Object.fromEntries(searchContext.sourceWeights.map(weight => [weight.sourceId, weight.weight])),
    topicBoosts: searchContext.topicBoosts.map(boost => boost.term),
    topicSuppressions: searchContext.topicSuppressions,
    recallMode: searchContext.recallMode,
  }
}

export function summarizeKnowledgeBase(knowledgeBase?: KnowledgeBase | null): KnowledgeBaseSummary {
  if (!knowledgeBase) return {}
  return {
    sourceIds: knowledgeBase.sourceIds,
    entryCount: knowledgeBase.entries.length,
    summary: knowledgeBase.summary,
  }
}

export function summarizeKnowledgePack(knowledgePack?: KnowledgePack | null): KnowledgePackSummary {
  if (!knowledgePack) return {}
  return {
    productCapabilities: knowledgePack.productCapabilities.map(capability => capability.capability),
    knownLimitations: knowledgePack.knownLimitations,
    verticalContext: knowledgePack.verticalContext,
    status: knowledgePack.status,
  }
}

/**
 * Meeting Goal summary for CLI display.
 * Product model name: Meeting Goal | Internal type: MeetingCharter
 */
export function summarizeMeetingCharter(meetingCharter?: MeetingCharter | null): MeetingCharterSummary {
  if (!meetingCharter) return {}
  return {
    objective: meetingCharter.objective,
    primaryLens: meetingCharter.primaryLens,
    requiredQuestions: meetingCharter.requiredQuestions.map(question => question.question),
  }
}

/**
 * Knowledge Brief summary for CLI display.
 * Product model name: Knowledge Brief | 4th durable control surface
 */
export function summarizeKnowledgeBrief(kb?: KnowledgeBrief | null): KnowledgeBriefSummary {
  if (!kb) return {}
  return {
    explorationFocus: kb.explorationFocus,
    explorationQuestions: kb.explorationQuestions.map(q => q.question),
    knowledgeSourcePriorities: Object.fromEntries(
      kb.knowledgeSourcePriorities.map(p => [p.sourceId, p.priority])
    ),
    suppressions: kb.suppressions,
    distillationMode: kb.distillationMode,
    explorationNotes: kb.explorationNotes,
  }
}
