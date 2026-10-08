# Issue tracker: GitHub

Issues and PRDs for this repo live in GitHub Issues for `marcoscale98/pi-rules`. Use the `gh` CLI for all operations.

## Conventions

- Infer the repository from the Git remote when working inside the clone.
- Read the issue body, labels, and all comments before acting.
- Create issues for tickets and PRDs; use multiline bodies where needed.
- Use issue operations to list, comment, apply or remove labels, and close tickets.
- Use the label mapping in `docs/agents/triage-labels.md`.

## Pull requests as a triage surface

**PRs as a request surface: no.**

If enabled later, external PRs follow the same labels and states as issues. Include contributors and first-time contributors; exclude owners, members, and collaborators. Read all comments and the diff before acting.

GitHub shares a number space across issues and PRs. Resolve ambiguous references before acting.

## When a skill says “publish to the issue tracker”

Create a GitHub issue.

## When a skill says “fetch the relevant ticket”

Read the GitHub issue and all its comments.

## Wayfinding operations

Used by `/wayfinder`. The map is a single issue labelled `wayfinder:map`, containing Notes, Decisions-so-far, and Fog.

- Create child tickets as GitHub sub-issues. If unavailable, list them in the map and add a “Part of” reference to each child.
- Label children by type: `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, or `wayfinder:task`.
- Record blockers using native GitHub issue dependencies. If unavailable, add a “Blocked by” reference at the top of the child.
- The frontier is the first open child in map order with no open blockers and no assignee.
- Claim a ticket by assigning it to the driving developer before other writes.
- Resolve by commenting with the answer, closing the ticket, and adding a summary and link to the map’s Decisions-so-far.
