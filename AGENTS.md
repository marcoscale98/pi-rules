# AGENTS.md

## Scope

This file applies to the entire repository. The project implements an installable Pi package that loads conditional Markdown Rules while remaining compatible with Claude Code Rules.

Read [README.md](README.md) before changing installation instructions, user-facing behavior, or development commands. The complete behavioral contract is in [specs/pi-rules.md](specs/pi-rules.md).

## Project structure

- `package.json` — root Pi package manifest, extension declaration, dependencies, and test script.
- `extensions/pi-rules/index.ts` — Pi lifecycle integration, activation, persistence, and TUI rendering.
- `extensions/pi-rules/discovery.ts` — recursive Rule discovery, source precedence, collision handling, and loading.
- `extensions/pi-rules/matching.ts` — frontmatter parsing and path, OS, and model matching.
- `extensions/pi-rules/pi-rules.test.ts` — integration harness and behavioral test suite.
- `specs/pi-rules.md` — full product and testing specification.
- `README.md` — purpose, installation, Rule authoring, features, and verification instructions.
- `.gitignore` — explicit repository allowlist and generated-file exclusions.

Installed dependencies under `node_modules/` and generated lockfiles are not project source and must remain untracked.

## Agent skills

### Issue tracker

Issues and PRDs are tracked in GitHub Issues for `marcoscale98/pi-rules`. Before tracker operations, read `docs/agents/issue-tracker.md`.

### Triage labels

Triage uses the repository label mapping, including `ready-for-planning` for the canonical `ready-for-agent` role. Before triage operations, read `docs/agents/triage-labels.md`.

### Domain docs

This repository uses a single-context layout. Before codebase exploration, read `docs/agents/domain.md`.
