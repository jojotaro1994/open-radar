/**
 * DiscussionsRepoScanner
 *
 * Discovers which GitHub repos have Discussions enabled by probing their
 * API endpoints in parallel. Returns a ranked list of repos by approximate
 * signal volume (first-page size).
 *
 * Usage: tsx src/adapters/discussions-repo-scanner.ts
 */

import * as fs from "fs"
import * as path from "path"

const GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN

interface RepoProbe {
  owner: string
  repo: string
}

interface ProbeResult {
  owner: string
  repo: string
  enabled: boolean
  httpStatus: number
  firstPageCount: number
  error?: string
}

const REPOS_TO_SCAN: RepoProbe[] = [
  // Previously known working
  { owner: "vercel", repo: "next.js" },
  { owner: "remix-run", repo: "remix" },

  // Newly discovered enabled (from this iteration's probes)
  { owner: "sveltejs", repo: "svelte" },
  { owner: "vuejs", repo: "core" },
  { owner: "golang", repo: "go" },
  { owner: "prisma", repo: "prisma" },
  { owner: "hasura", repo: "graphql-engine" },
  { owner: "strapi", repo: "strapi" },
  { owner: "woocommerce", repo: "woocommerce" },

  // Previously unknown / need retesting
  { owner: "elixir-lang", repo: "elixir" },
  { owner: "crystal-lang", repo: "crystal" },
  { owner: "deno.land", repo: "deno" },
  { owner: "flutter", repo: "flutter" },
  { owner: "rust-lang", repo: "rust" },
  { owner: "open-rpc", repo: "schema-utils" },

  // Additional candidates — different domains
  { owner: "expo", repo: "expo" },
  { owner: "vercel", repo: "next.js" },
  { owner: "redwoodjs", repo: "redwood" },
  { owner: "astro", repo: "astro" },
  { owner: "tanstack", repo: "query" },
]

async function probeRepo(owner: string, repo: string): Promise<ProbeResult> {
  const url = `https://api.github.com/repos/${owner}/${repo}/discussions?per_page=20`

  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "prj-prototype-rader/1.0",
  }
  if (GITHUB_TOKEN) {
    headers["Authorization"] = `token ${GITHUB_TOKEN}`
  }

  try {
    const response = await fetch(url, { headers })
    const status = response.status

    if (status === 200) {
      const data = (await response.json()) as any[]
      return {
        owner,
        repo,
        enabled: true,
        httpStatus: status,
        firstPageCount: Array.isArray(data) ? data.length : 0,
      }
    } else if (status === 410 || status === 404) {
      return { owner, repo, enabled: false, httpStatus: status, firstPageCount: 0 }
    } else {
      return {
        owner,
        repo,
        enabled: false,
        httpStatus: status,
        firstPageCount: 0,
        error: `HTTP ${status}`,
      }
    }
  } catch (err: any) {
    return {
      owner,
      repo,
      enabled: false,
      httpStatus: 0,
      firstPageCount: 0,
      error: err.message,
    }
  }
}

async function main() {
  console.log("=== DiscussionsRepoScanner ===\n")
  console.log(`Repos to scan: ${REPOS_TO_SCAN.length}`)
  console.log(`GitHub token: ${!!GITHUB_TOKEN}\n`)

  console.log("Probing all repos in parallel...\n")

  const results = await Promise.all(
    REPOS_TO_SCAN.map(r => probeRepo(r.owner, r.repo))
  )

  const enabled = results.filter(r => r.enabled)
  const disabled = results.filter(r => !r.enabled)

  console.log("--- DISABLED / 410 / 404 ---")
  for (const r of disabled) {
    const note = r.error ? ` [${r.error}]` : ""
    console.log(`  ${r.owner}/${r.repo}: HTTP ${r.httpStatus}${note}`)
  }

  console.log("\n--- ENABLED ---")
  for (const r of enabled) {
    console.log(
      `  ${r.owner}/${r.repo}: HTTP ${r.httpStatus}, first_page=${r.firstPageCount}`
    )
  }

  // Sort by firstPageCount descending
  const ranked = [...enabled].sort((a, b) => b.firstPageCount - a.firstPageCount)

  console.log("\n--- RANKED BY SIGNAL VOLUME ---")
  for (let i = 0; i < ranked.length; i++) {
    const r = ranked[i]
    console.log(`  ${i + 1}. ${r.owner}/${r.repo} (first_page=${r.firstPageCount})`)
  }

  const top5 = ranked.slice(0, 5)
  console.log("\n--- TOP 5 FOR ADAPTER ---")
  for (const r of top5) {
    console.log(`  - { owner: "${r.owner}", repo: "${r.repo}", perPage: 15 },`)
  }

  // Write result to data dir for reference
  const dataDir = path.join(process.cwd(), "data")
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })
  const outPath = path.join(dataDir, "discussions-scanner-result.json")
  fs.writeFileSync(outPath, JSON.stringify({ timestamp: new Date().toISOString(), results, ranked }, null, 2))
  console.log(`\nResults written to: ${outPath}`)

  return top5
}

main().catch(err => { console.error(err); process.exit(1) })
