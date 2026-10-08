# Domain Docs

## Before exploring

Read `CONTEXT.md` at the repository root and the ADRs in `docs/adr/` relevant to the area being explored.

If these documents do not exist, proceed silently. `/domain-modeling` creates them lazily when terms or decisions are resolved.

## Layout

Single-context repository: one root `CONTEXT.md` and one root `docs/adr/` directory.

## Vocabulary

Use domain terms as defined in `CONTEXT.md`. Avoid synonyms the glossary explicitly excludes. If a needed concept is missing, reconsider whether it belongs or note the gap for `/domain-modeling`.

## ADR conflicts

If a proposal contradicts an existing ADR, identify the conflict explicitly and explain why the decision merits reconsideration.
