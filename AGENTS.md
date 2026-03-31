# Project Agent Rules

## CLI-First Completion

Every design and implementation decision in this project must start from one question:

**Can the CLI run the full flow?**

If a capability has no CLI path to:

- create
- inspect
- refresh
- trace

it is not design-complete.

## Runtime Preference

- Prefer runnable operator flows over schema-only work.
- Prefer explicit command surfaces over hidden background behavior.
- Prefer a small number of complete flows over many partial abstractions.

## For Graph-Native Work

When changing the knowledge runtime:

- treat graph as canonical only if the CLI can bootstrap, ingest, inspect, retrieve, and trace it
- do not make raw fact search the first-pass recall layer
- do not leave Scout boundaries vague
- do not preserve old filesystem-first workflows as silent parallel systems

## Product Neutrality

- Do not encode `riplus`, `ri`, or any single customer/workspace name into the product model.
- Treat RIPlus only as an example intent profile or migration fixture.
- Prefer generic concepts such as:
  - `IntentProfile`
  - `ResearchDirection`
  - `ScoutTarget`
  - `KnowledgePackage`
  - `Projection`
- If a name would make the runtime feel product-specific, redesign the name before implementing it.

## Graph Runtime Assumptions

- The canonical graph runtime is a Dockerized Memgraph service, not an embedded npm-provided database.
- This project should use a dedicated Memgraph container/runtime rather than a shared graph instance.
- Node/npm packages may be used only as Bolt-compatible clients, bootstrap helpers, or test harnesses.
- The default runtime assumptions are:
  - host `127.0.0.1`
  - dedicated Bolt port `7688`
  - dedicated inspection UI at `127.0.0.1:3001` when available
- Do not rely on shared-instance database or namespace separation as the primary isolation mechanism.
