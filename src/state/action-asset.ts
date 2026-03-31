export type ActionAssetType =
  | "executive_digest"
  | "opportunity_memo"
  | "org_playbook"
  | "prototype_brief"
  | "video_brief"
  | "weekly_brief"
  | "alert"

export interface ActionAsset {
  actionAssetId: string
  topic: string
  assetType: ActionAssetType
  derivedFromDecisionObjectIds: string[]
  audience: string[]
  status: "draft" | "published" | "archived"
  createdAt: string
  updatedAt: string
}
