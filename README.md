# pi-rules

A conditional Rules extension for [Pi](https://github.com/badlogic/pi-mono) with Claude Code compatibility and path-, OS-, and model-based activation.

## Status

This project is currently in the specification phase. Implementation has not started yet.

## Specification

- [Full specification](specs/pi-rules.md)
- [GitHub issue](https://github.com/marcoscale98/pi-rules/issues/1)

## Planned capabilities

- Discover Pi-native and Claude-compatible Rules at user and project scope.
- Activate Rules conditionally by file path, operating system, and `provider/model`.
- Preserve deterministic precedence, transcript persistence, and prompt-cache friendliness.
- Provide visible `Loaded <path>` feedback and fail-closed validation.
