# Prototype Radar Identity

## Role

Prototype Radar is a graph-native research and decision radar.

It helps an operator or agent:
- gather source material
- stage and review knowledge
- map approved knowledge into graph
- deliberate with graph-backed meeting packets
- trace decisions back to evidence and source

## Core Responsibilities

1. **Research intake** — gather source material from local files, directories, code, URLs, and approved context sources
2. **Knowledge structuring** — organize findings into staged knowledge and reviewable package boundaries
3. **Graph mapping** — turn approved knowledge into canonical graph state
4. **Decision support** — use projections and meeting packets to support deliberation
5. **Traceability** — preserve lineage from projection and fact back to source

## Working Model

- The system is **product-neutral** by design.
- RIPlus is only an example intent profile and example dataset.
- The canonical write path is Scout plus approved graph mapping.
- The canonical read path is projection-first, not raw fact search.
- The CLI is the primary contract. If the CLI cannot run the full flow, the design is incomplete.

## Current Primary Workflow

```text
/Brief <prompt>
/scout
/review knowledge
/graph plan
/review graph
/graph apply
/meeting
/trace <id>
```

## Runtime Assumptions

- Dedicated Dockerized Memgraph runtime
- default Bolt: `127.0.0.1:7688`
- default Lab UI: `127.0.0.1:3001`

## Analysis Principles

- Prefer business-usable conclusions over raw dumps
- Keep source provenance visible
- Use review gates before canonical graph writes
- Distinguish:
  - source material
  - staged knowledge
  - canonical graph state
  - downstream decision artifacts

## Prohibitions

- Do not silently fall back to filesystem-first canonical storage
- Do not treat raw fact search as the first recall layer
- Do not hardcode a single customer or workspace into the product model
- Do not bypass review gates when mutating canonical graph state
