# Signal Source Strategy

> ⚠️ **Status (2026-03-22)**: This document describes the source strategy. `riplus-insurance-travel` is a **mock direct_signal** validation adapter (10 signals, insurance/travel verticals). Real partner feedback channels are still being identified.

## Source Role Model

Sources are classified by role in the Intent policy (not hard-coded in adapters):

| Role | Description | Pipeline Behavior |
|------|-------------|-----------------|
| `context` | Background knowledge — product understanding | Signals available to Commercial Analyst as context; NOT direct opportunity input |
| `latent_signal` | May be opportunity — needs analysis | Conditional routing via Commercial Analyst |
| `direct_signal` | Clear opportunity indicator | Enters radar pipeline via Commercial Analyst judgment |

## Current Source Status (riplus-ma Intent)

| Source | Role | Status |
|--------|------|--------|
| `riplus-insurance-travel` | direct_signal (mock) | ✅ Registered — **validation only**, 10 insurance/travel signals, not production |
| `jira-ma` | context | ✅ Registered — Bug/NewFeature signals as product knowledge |
| `confluence` | context | ✅ Registered — product documentation |

## True Signal Sources: Production Not Yet Identified

The mock adapter demonstrates the pipeline can produce non-zero opportunities from direct signals. Real partner feedback channels (Slack, email, NPS surveys, regulatory feeds) are still being identified.

**Target signal sources for RIPlus:**

- **Partner feedback channels** — direct input from insurance/travel partners on what they need
- **Market intelligence** — insurance/travel industry news, regulatory changes, competitor moves
- **NPS / survey data** — structured partner satisfaction signals
- **Support ticket patterns** — recurring friction points from partners (treated as latent_signal)

See `openspec/changes/intent-source-registry-parallel-analysis/tasks.md` Section 16 for the discovery plan.

## How to Add a New Source

```bash
# 1. Create adapter implementing SourceAdapter interface
# src/adapters/your-source-adapter.ts

# 2. Register in src/registry/register-all.ts
SourceRegistry.register('your-source', async () => new YourSourceAdapter())

# 3. Add to Intent sourcePriority (or configure via policy.sourceRoles)
# config/intents/riplus-ma.json
```

See `src/adapters/source-adapter.ts` for the interface contract.
