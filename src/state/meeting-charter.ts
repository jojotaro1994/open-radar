/**
 * Meeting Goal — persistent: how the BA Meeting Room frames judgment.
 *
 * Product model name: Meeting Goal
 * Internal type name: MeetingCharter (for compatibility migration)
 *
 * Meeting Goal is responsible for:
 *   - the primary objective of radar reviews
 *   - which lens/judge angle to apply
 *   - required questions every signal must answer
 *   - what to avoid overweighting
 *   - decision style (conservative, balanced, aggressive)
 *   - meeting notes and framing guidance
 *
 * Meeting Goal is NOT the same as:
 *   - Scout Brief (how the system searches)
 *   - Knowledge Pack (what the system knows)
 *
 * Lifecycle: persistent. Written via the preview-first change flow.
 */

export interface RequiredQuestion {
  question: string
  whyItMatters: string
}

export interface MeetingCharter {
  /** Unique identifier */
  id: string

  /** Intent this Meeting Charter belongs to */
  intentId: string

  /** Primary objective for radar review discussions */
  objective: string

  /** Primary lens/angle for evaluating signals, e.g. "ROI", "user-impact", "strategic-fit" */
  primaryLens: string

  /** Questions every signal must be able to answer in review */
  requiredQuestions: RequiredQuestion[]

  /** Patterns/topics to avoid over-weighting */
  avoidOverweighting: string[]

  /** Decision style for triage */
  decisionStyle: "conservative" | "balanced" | "aggressive"

  /** Human-readable notes about how to run radar reviews */
  meetingNotes: string

  createdAt: string
  updatedAt: string
}

/**
 * Runtime summary of Meeting Charter for /state display.
 */
export interface MeetingCharterSummary {
  objective?: string
  primaryLens?: string
  requiredQuestions?: string[]
}
