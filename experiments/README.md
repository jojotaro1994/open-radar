# Experiments — Historical Archive

> ⚠️ **2026-03-22**: This directory contains historical experiment runners. The experiments here predate the Intent/SourceRegistry architecture. They are kept for reference only and are not maintained.

## What this is

Experimental slices that explored signal sources and qualification patterns before the current Intent-driven design. **Not part of the current OpenSpec.**

## Current active runner

```bash
npx tsx src/orchestrator/riplus-ma-runner.ts --intent riplus-ma
```

See `openspec/changes/intent-source-registry-parallel-analysis/` for the current architecture.

## Historical experiments

| Runner | Status | Notes |
|--------|---------|-------|
| `riplus-mock-runner.ts` | Deprecated | Pre-Intent MA-domain mock signals |
| `ma-domain-runner.ts` | Deprecated | GitHub Discussions + mock (GitHub removed) |
| `full-signal-runner.ts` | Deprecated | Multi-source (GitHub removed) |
| `github-runner.ts` | Deprecated | GitHub Issues as primary signal source |
| `reddit-runner.ts` | Deprecated | Reddit as primary signal source |
| `hackernews-runner.ts` | Deprecated | Hacker News as primary signal source |
| `hackernews-smart-runner.ts` | Deprecated | Smarter HN adapter as primary source |
| `github-full-runner.ts` | Deprecated | GitHub Issues + Discussions combined |
| `github-multi-runner.ts` | Deprecated | Multi-repo GitHub Discussions |
| `mixed-source-runner.ts` | Deprecated | Stack Overflow + GitHub + Riplus |
| `demo.ts` | Deprecated | Pre-Intent end-to-end walkthrough |

## qualification-filter.ts

A **legacy pluggable qualification layer** that informed the current design:
- `qualification-filter.ts` is now in `src/filters/` (incorporated into the main pipeline)
- Current qualification is rule-based (placeholder for LLM Commercial Analyst — Section 13)
- The experiment confirmed: with context-only sources (Jira, Confluence), rule-based qualification produces 0 opportunities → need direct_signal sources and Commercial Analyst

## Known limitations (historical)

- qualification-filter was rule-based (confirmed as insufficient — need LLM Commercial Analyst)
- No Jira/Confluence integration at time of experiment (now implemented in riplus-ma-runner)
- qualification is per-signal; does not use cross-signal aggregation

## When this becomes formal

The Intent/SourceRegistry/qualification-filter architecture supersedes all experiments in this directory. No further updates to these files are planned.
