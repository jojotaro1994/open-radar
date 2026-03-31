/**
 * Gets GitHub token from available sources:
 * 1. GITHUB_TOKEN env var
 * 2. gh auth token (if gh CLI is installed and authenticated)
 */

export async function getGitHubToken(): Promise<string | null> {
  // Check env var first
  if (process.env.GITHUB_TOKEN) {
    return process.env.GITHUB_TOKEN
  }

  // Try gh CLI
  try {
    const { execSync } = await import("child_process")
    const token = execSync("gh auth token", { encoding: "utf8", timeout: 10000 }).trim()
    if (token && token.startsWith("gho_")) {
      return token
    }
  } catch {
    // gh not available or not authenticated
  }

  return null
}
