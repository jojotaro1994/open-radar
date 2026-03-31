# Prototype Radar

Graph-native research and decision radar with a CLI-first workflow.

Current canonical runtime:
- Scout stages knowledge from files, directories, code, and URLs
- approved knowledge is mapped into Memgraph
- projections are the primary recall surface
- meeting consumes graph-backed `MeetingPacket`
- trace resolves lineage back to source artifacts and facts

## Current Workflow

### Product flow

Use this flow when you want the system to research, review, map, and deliberate:

```text
/Brief <prompt>
/scout
/review knowledge [bundle_id]
/graph plan [bundle_id]
/review graph [plan_id]
/graph apply [plan_id]
/meeting [packet_id|topic]
/trace <projection_id|fact_id|decision_id>
```

What each step does:
- `/Brief` drafts and confirms `Scout Brief + Meeting Goal`
- `/scout` produces a staged knowledge bundle
- `/review knowledge` approves or rejects the staged knowledge structure
- `/graph plan` drafts the graph mapping plan
- `/review graph` approves or rejects the mapping
- `/graph apply` writes the approved mapping into canonical graph state
- `/meeting` consumes a graph-backed `MeetingPacket`
- `/trace` shows lineage through projection, fact, evidence, and source

### Operator flow

Use this flow when you want to maintain or inspect the graph runtime directly:

```text
/graph health
/graph bootstrap
/graph stats
/scout ingest <path|url>
/scout refresh <package_id>
/scout status [package_id]
/package show <package_id>
/projection show <projection_id|key>
/projection refresh <projection_id|key>
/trace <projection_id|fact_id|decision_id>
```

## Quick Start

### 1. Start the CLI

```bash
npm run cli -- --intent=default
```

The CLI will show the active command surface. `/help` is the source of truth for interactive usage.

### 2. Run the product workflow

Example:

```text
/Brief 调研 RIPlus SMS 能力，对比 Braze 和 Omnichat，并准备 meeting
/scout
/review knowledge
/graph plan
/review graph
/graph apply
/meeting
/trace <id>
```

### 3. Run the operator workflow

Example:

```text
/graph health
/graph bootstrap
/scout ingest riplus-knowledge-base/05-channel-domain/sms
/graph stats
/package show 05-channel-domain/sms
/projection show 05-channel-domain/sms:CapabilitySlice
```

## Memgraph Runtime

The project assumes a dedicated Dockerized Memgraph runtime.

Defaults:
- host: `127.0.0.1`
- Bolt: `7688`
- Lab UI: `127.0.0.1:3001`

The graph runtime is only considered canonical if the CLI can:
- bootstrap
- ingest
- inspect
- retrieve
- trace

## Main Commands

### Product commands
- `/Brief <prompt>`
- `/scout`
- `/review knowledge [bundle_id]`
- `/graph plan [bundle_id]`
- `/review graph [plan_id]`
- `/graph apply [plan_id]`
- `/meeting [packet_id|topic]`
- `/inbox`
- `/pick <card_id> [reason]`
- `/reject <card_id> <reason_class> <reason>`
- `/defer <card_id> <reason_class> <reason>`
- `/watch <card_id> <reason_class> <reason>`
- `/submit card <card_id>`
- `/trace <projection_id|fact_id|decision_id>`

### Operator commands
- `/graph bootstrap`
- `/graph health`
- `/graph stats`
- `/scout ingest <path|url>`
- `/scout refresh <package_id>`
- `/scout status [package_id]`
- `/package show <package_id>`
- `/projection show <projection_id|key>`
- `/projection refresh <projection_id|key>`

## Build And Test

```bash
npm run build
npm test
```

## Repo Guide

- `src/cli/radar-cli.ts`
  interactive CLI entrypoint and current command surface
- `src/orchestrator/scout-graph-ingestion.ts`
  graph-native Scout ingestion and projection refresh
- `src/orchestrator/scout-knowledge-staging.ts`
  staged knowledge creation before graph mapping
- `src/orchestrator/graph-mapping-plan.ts`
  graph mapping draft and apply flow
- `openspec/changes/introduce-graph-knowledge-runtime/`
  graph-native runtime design and validation handoffs

## Legacy And Outdated Material

These are no longer the primary workflow:
- `src/orchestrator/riplus-ma-runner.ts`
- old async opportunity radar wording
- viewer/export-first dashboard workflow
- filesystem-first knowledge workflow

If documentation conflicts:
1. trust the current CLI help in `src/cli/radar-cli.ts`
2. trust the active OpenSpec changes under `openspec/changes/`
3. treat old runner/viewer-oriented docs as legacy unless explicitly updated
