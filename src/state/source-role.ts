/**
 * legacy source-role helpers.
 *
 * The new product model classifies sources as:
 *   - opportunity_source
 *   - knowledge_source
 *   - dual_use
 *
 * Some old projections still want the legacy display role names
 * direct_signal/context, so keep this fallback around for compatibility.
 */

export type LegacySourceRole = "direct_signal" | "context"

export function inferLegacySourceRole(name: string): LegacySourceRole {
  if (name.startsWith("jira") || name === "confluence") return "context"
  return "direct_signal"
}

export const inferDefaultSourceRole = inferLegacySourceRole
