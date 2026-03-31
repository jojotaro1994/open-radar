/**
 * tell-handler.ts — /tell command surface-specific parsing.
 *
 * Handles the parse → preview step for all 4 durable control surfaces.
 * Each handler returns a preview string and the onConfirm/onCancel callbacks.
 * The CLI wires these into the pendingConfirm mechanism.
 */

import * as fs from "fs"
import * as path from "path"
import type { RadarIntent } from "../schemas/intent.js"
import type { SearchContext } from "../state/search-context.js"
import type { KnowledgeBrief } from "../state/knowledge-brief.js"
import type { MeetingCharter } from "../state/meeting-charter.js"

// ── Scout Brief (SearchContext) parser ────────────────────────────────────────

export interface ScoutBriefDelta {
  addedBoosts: Array<{ term: string; boost: number }>
  removedBoosts: string[]
  addedSuppressions: string[]
  removedSuppressions: string[]
  recallMode?: "broad" | "normal" | "narrow"
  notes?: string
}

function parseScoutText(text: string): ScoutBriefDelta {
  const delta: ScoutBriefDelta = {
    addedBoosts: [],
    removedBoosts: [],
    addedSuppressions: [],
    removedSuppressions: [],
  }

  // Boost: "boost X" / "add boost X" / "boost X by 0.3"
  const boostRe = /(?:boost|add boost|新增boost)\s+([^\s,]+)(?:\s+by\s+([\d.]+))?/gi
  let m: RegExpExecArray | null
  while ((m = boostRe.exec(text)) !== null) {
    const term = m[1]!.trim()
    const boost = m[2] ? parseFloat(m[2]) : 0.2
    if (term) delta.addedBoosts.push({ term, boost: isNaN(boost) ? 0.2 : boost })
  }

  // Remove boost: "remove boost X" / "drop boost X"
  const rmBoostRe = /(?:remove boost|drop boost|删除boost)\s+([^\s,]+)/gi
  while ((m = rmBoostRe.exec(text)) !== null) {
    const term = m[1]!.trim()
    if (term) delta.removedBoosts.push(term)
  }

  // Suppress: "suppress X" / "exclude X"
  const suppRe = /(?:suppress|exclude|suppress term|排除)\s+([^\s,]+)/gi
  while ((m = suppRe.exec(text)) !== null) {
    const term = m[1]!.trim()
    if (term) delta.addedSuppressions.push(term)
  }

  // Remove suppression: "remove suppression X"
  const rmSuppRe = /(?:remove suppression|remove suppress|删除suppress)\s+([^\s,]+)/gi
  while ((m = rmSuppRe.exec(text)) !== null) {
    const term = m[1]!.trim()
    if (term) delta.removedSuppressions.push(term)
  }

  // Recall mode: "recall mode broad/normal/narrow"
  const recallRe = /recall\s*mode\s+(broad|normal|narrow)/i
  const recallMatch = text.match(recallRe)
  if (recallMatch) delta.recallMode = recallMatch[1]!.toLowerCase() as "broad" | "normal" | "narrow"

  // Notes: "notes: ..." or "note: ..."
  const notesRe = /(?:notes?|note|备注):\s*(.+?)(?=\n|$)/i
  const notesMatch = text.match(notesRe)
  if (notesMatch) delta.notes = notesMatch[1]!.trim()

  return delta
}

function describeDelta(d: ScoutBriefDelta): string {
  const parts: string[] = []
  if (d.addedBoosts.length) parts.push(`+ Boosts: ${d.addedBoosts.map(b => `${b.term}(+${b.boost})`).join(", ")}`)
  if (d.removedBoosts.length) parts.push(`- Boosts: ${d.removedBoosts.join(", ")}`)
  if (d.addedSuppressions.length) parts.push(`+ Suppressions: ${d.addedSuppressions.join(", ")}`)
  if (d.removedSuppressions.length) parts.push(`- Suppressions: ${d.removedSuppressions.join(", ")}`)
  if (d.recallMode) parts.push(`recallMode: ${d.recallMode}`)
  if (d.notes) parts.push(`notes: "${d.notes}"`)
  return parts.join("\n  ")
}

export function buildScoutBriefConfirm(
  text: string,
  current: SearchContext | null,
  configDir: string,
  intentId: string,
): { preview: string; onConfirm: () => string; onCancel: () => string } {
  const delta = parseScoutText(text)

  if (
    delta.addedBoosts.length === 0 &&
    delta.removedBoosts.length === 0 &&
    delta.addedSuppressions.length === 0 &&
    delta.removedSuppressions.length === 0 &&
    !delta.recallMode &&
    !delta.notes
  ) {
    const preview = `Scout Brief 变更未能识别。支持的格式：\n  boost X\n  suppress X\n  recall mode broad/normal/narrow\n  notes: ...`
    return {
      preview,
      onConfirm: () => "未能识别变更。Scout Brief 未变更。",
      onCancel: () => "已取消。Scout Brief 未变更。",
    }
  }

  // Build new SearchContext
  const next: SearchContext = current ? { ...current } : {
    id: `${intentId}-scout-brief`,
    intentId,
    sourceWeights: [],
    topicBoosts: [],
    topicSuppressions: [],
    recallMode: "normal",
    noiseTolerance: 0.5,
    searchNotes: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  next.updatedAt = new Date().toISOString()

  // Apply delta to topicBoosts
  const existingBoosts = new Map(next.topicBoosts.map(b => [b.term.toLowerCase(), b]))
  for (const b of delta.removedBoosts) existingBoosts.delete(b.toLowerCase())
  for (const b of delta.addedBoosts) existingBoosts.set(b.term.toLowerCase(), { term: b.term, boost: b.boost })
  next.topicBoosts = [...existingBoosts.values()]

  // Apply delta to topicSuppressions
  const existingSupp = new Set(next.topicSuppressions.map(s => s.toLowerCase()))
  for (const s of delta.removedSuppressions) existingSupp.delete(s.toLowerCase())
  for (const s of delta.addedSuppressions) existingSupp.add(s)
  next.topicSuppressions = [...existingSupp]

  if (delta.recallMode) next.recallMode = delta.recallMode
  if (delta.notes) next.searchNotes = delta.notes

  const preview = [
    `Scout Brief 变更预览:`,
    ``,
    describeDelta(delta),
    ``,
    `写入文件: config/intents/${intentId}.scout-brief.json`,
    ``,
    `确认写入？(y/n)`,
  ].join("\n")

  const filePath = path.join(configDir, "intents", `${intentId}.scout-brief.json`)

  const onConfirm = (): string => {
    fs.writeFileSync(filePath, JSON.stringify(next, null, 2) + "\n")
    return `已写入 Scout Brief。\n  Boosts: ${next.topicBoosts.map(b => b.term).join(", ") || "(none)"}\n  Suppressions: ${next.topicSuppressions.join(", ") || "(none)"}\n  recallMode: ${next.recallMode}`
  }

  const onCancel = (): string => "已取消。Scout Brief 未变更。"

  return { preview, onConfirm, onCancel }
}

// ── Knowledge Brief parser ────────────────────────────────────────────────────

export function buildKnowledgeBriefConfirm(
  text: string,
  current: KnowledgeBrief | null,
  configDir: string,
  intentId: string,
): { preview: string; onConfirm: () => string; onCancel: () => string } {
  // Simple: "focus on X" or "focus: X" → update explorationFocus
  // "add question X" → add to explorationQuestions
  // "distillation conservative/balanced/aggressive" → update distillationMode

  const lines: string[] = []
  const changes: string[] = []
  let updatedFocus: string | undefined
  let updatedDistillation: "conservative" | "balanced" | "aggressive" | undefined

  const focusRe = /(?:focus|exploration focus|explorationfocus|关注|探索方向):\s*(.+?)(?:\n|$)/i
  const focusMatch = text.match(focusRe)
  if (focusMatch) {
    updatedFocus = focusMatch[1]!.trim()
    changes.push(`explorationFocus: "${updatedFocus}"`)
  }

  const distRe = /distillation\s+(conservative|balanced|aggressive)/i
  const distMatch = text.match(distRe)
  if (distMatch) {
    updatedDistillation = distMatch[1]!.toLowerCase() as "conservative" | "balanced" | "aggressive"
    changes.push(`distillationMode: ${updatedDistillation}`)
  }

  const notesRe = /(?:notes?|note|备注):\s*(.+?)(?=\n|$)/i
  const notesMatch = text.match(notesRe)
  if (notesMatch) {
    changes.push(`explorationNotes: "${notesMatch[1]!.trim()}"`)
  }

  if (changes.length === 0) {
    const preview = `Knowledge Brief 变更未能识别。支持的格式：\n  focus: X\n  distillation conservative/balanced/aggressive\n  notes: ...`
    return {
      preview,
      onConfirm: () => "未能识别变更。Knowledge Brief 未变更。",
      onCancel: () => "已取消。Knowledge Brief 未变更。",
    }
  }

  let next: KnowledgeBrief
  if (current) {
    next = { ...current }
  } else {
    next = {
      id: `${intentId}-knowledge-brief`,
      intentId,
      explorationFocus: "",
      explorationQuestions: [],
      knowledgeSourcePriorities: [],
      suppressions: [],
      distillationMode: "balanced",
      explorationNotes: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
  }
  next.updatedAt = new Date().toISOString()
  if (updatedFocus) next.explorationFocus = updatedFocus
  if (updatedDistillation) next.distillationMode = updatedDistillation
  if (notesMatch) next.explorationNotes = notesMatch[1]!.trim()

  const preview = [
    `Knowledge Brief 变更预览:`,
    ``,
    changes.map(c => `  ${c}`).join("\n"),
    ``,
    `写入文件: config/intents/${intentId}.knowledge-brief.json`,
    ``,
    `确认写入？(y/n)`,
  ].join("\n")

  const filePath = path.join(configDir, "intents", `${intentId}.knowledge-brief.json`)

  const onConfirm = (): string => {
    fs.writeFileSync(filePath, JSON.stringify(next, null, 2) + "\n")
    return `已写入 Knowledge Brief。\n  explorationFocus: ${next.explorationFocus}\n  distillationMode: ${next.distillationMode}`
  }

  const onCancel = (): string => "已取消。Knowledge Brief 未变更。"

  return { preview, onConfirm, onCancel }
}

// ── Meeting Goal parser ────────────────────────────────────────────────────────

export function buildMeetingGoalConfirm(
  text: string,
  current: MeetingCharter | null,
  configDir: string,
  intentId: string,
): { preview: string; onConfirm: () => string; onCancel: () => string } {
  const changes: string[] = []

  // Objective: "objective: X" or "目标: X"
  const objRe = /(?:objective|goal|目标|目的):\s*(.+?)(?:\n|$)/i
  const objMatch = text.match(objRe)
  let updatedObjective: string | undefined
  if (objMatch) {
    updatedObjective = objMatch[1]!.trim()
    changes.push(`objective: "${updatedObjective}"`)
  }

  // Lens: "lens: X" or "primary lens: X"
  const lensRe = /(?:primary\s+)?lens:\s*(.+?)(?:\n|$)/i
  const lensMatch = text.match(lensRe)
  let updatedLens: string | undefined
  if (lensMatch) {
    updatedLens = lensMatch[1]!.trim()
    changes.push(`primaryLens: "${updatedLens}"`)
  }

  // Decision style: "decision style conservative/balanced/aggressive"
  const styleRe = /decision\s+style\s+(conservative|balanced|aggressive)/i
  const styleMatch = text.match(styleRe)
  let updatedStyle: "conservative" | "balanced" | "aggressive" | undefined
  if (styleMatch) {
    updatedStyle = styleMatch[1]!.toLowerCase() as "conservative" | "balanced" | "aggressive"
    changes.push(`decisionStyle: ${updatedStyle}`)
  }

  if (changes.length === 0) {
    const preview = `Meeting Goal 变更未能识别。支持的格式：\n  objective: X\n  lens: X\n  decision style conservative/balanced/aggressive`
    return {
      preview,
      onConfirm: () => "未能识别变更。Meeting Goal 未变更。",
      onCancel: () => "已取消。Meeting Goal 未变更。",
    }
  }

  let next: MeetingCharter
  if (current) {
    next = { ...current }
  } else {
    next = {
      id: `${intentId}-meeting-goal`,
      intentId,
      objective: "",
      primaryLens: "",
      requiredQuestions: [],
      avoidOverweighting: [],
      decisionStyle: "balanced",
      meetingNotes: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
  }
  next.updatedAt = new Date().toISOString()
  if (updatedObjective) next.objective = updatedObjective
  if (updatedLens) next.primaryLens = updatedLens
  if (updatedStyle) next.decisionStyle = updatedStyle

  const preview = [
    `Meeting Goal 变更预览:`,
    ``,
    changes.map(c => `  ${c}`).join("\n"),
    ``,
    `写入文件: config/intents/${intentId}.meeting-goal.json`,
    ``,
    `确认写入？(y/n)`,
  ].join("\n")

  const filePath = path.join(configDir, "intents", `${intentId}.meeting-goal.json`)

  const onConfirm = (): string => {
    fs.writeFileSync(filePath, JSON.stringify(next, null, 2) + "\n")
    return `已写入 Meeting Goal。\n  objective: ${next.objective}\n  primaryLens: ${next.primaryLens}\n  decisionStyle: ${next.decisionStyle}`
  }

  const onCancel = (): string => "已取消。Meeting Goal 未变更。"

  return { preview, onConfirm, onCancel }
}
