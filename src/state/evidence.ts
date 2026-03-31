export interface Evidence {
  evidenceId: string
  sourceId: string
  topic: string
  locator: string
  capturedAt: string
  normalizedText: string
  entityRefs: string[]
  confidence: number
  createdAt: string
  updatedAt: string
}
