# Contributing to Pi Rules

Thanks for contributing. Keep changes small, focused, and consistent with the [specification](specs/pi-rules.md).

## Before you open a pull request

1. Discuss a non-trivial change in an issue before implementing it.
2. Read [README.md](README.md) and the relevant parts of [specs/pi-rules.md](specs/pi-rules.md).
3. Preserve the repository's lightweight approach: Node's built-in test runner and no unnecessary dependencies or abstractions.
4. Update the specification and README when the user-visible behavior or documented workflow changes.
5. If a new source, test, or specification file is under an ignored directory, add the required exception to `.gitignore`.

## Development and validation

Use Node.js 22.19 or newer. Install dependencies and run the focused test coverage for your change, then the full suite when practical:

```sh
npm install
npm test
```

For TypeScript changes, also run the typecheck command documented in the README.

## Pull requests

GitHub automatically loads [the pull request template](.github/pull_request_template.md). Use it and complete every relevant section. Explain the outcome and validation in behavioral terms, not as a file-by-file implementation log.

Classify **impact** and **risk** independently as `Low`, `Medium`, or `High`, each with a short rationale. Do not mark risk as `Low` without sufficient relevant evidence. When expected evidence cannot be produced, state what you attempted, the blocker, the missing evidence, and the strongest validation completed instead.

For user-visible changes, include representative before/after screenshots or a short recording when interaction or timing matters. Remove credentials, personal information, and unrelated machine details from all PR artifacts.

## Scope

By submitting a contribution, you agree that your contribution may be distributed under the repository's [MIT License](LICENSE).
