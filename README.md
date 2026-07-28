# pi-rules

A global conditional Rules extension for [Pi](https://github.com/badlogic/pi-mono). It brings Claude Code-compatible Markdown Rules to Pi and adds operating-system and model conditions, allowing one Rules collection to work across projects, machines, and providers without loading irrelevant instructions.

## Purpose

Pi Rules discovers modular Markdown instruction files at user and project scope. It activates only the Rules whose frontmatter matches the current file, host operating system, and selected `provider/model`, then persists each activation in the session transcript for resume, fork, compaction, and prompt-cache continuity.

The implementation is intentionally advisory: activated Rules become model context, not hard security enforcement.

## Installation

### Requirements

- Pi with Node.js 22.19 or newer.
- Git and npm.

Install the repository directly as a global Git Pi package:

```sh
pi install https://github.com/marcoscale98/pi-rules
```

SSH users can instead run `pi install git:git@github.com:marcoscale98/pi-rules`. Pi clones the repository, installs its runtime dependencies, and loads the extension declared in the root package manifest.

Update the installed package with:

```sh
pi update --extensions
```

Then run `/reload` in an active Pi session or restart Pi.

To try the package for one run without adding it to Pi settings:

```sh
pi -e https://github.com/marcoscale98/pi-rules
```

For development from a local checkout:

```sh
npm install
pi --no-extensions --approve -e "$(pwd)/extensions/pi-rules/index.ts"
```

`--no-extensions` disables auto-discovered extensions but still loads the explicit `-e` entrypoint. `--approve` trusts project-local Rules for that run.

## Rule locations

Rules are discovered recursively from these locations:

| Scope | Pi-native | Claude-compatible |
| --- | --- | --- |
| User | `~/.pi/agent/rules/` | `~/.claude/rules/` |
| Project | `.pi/rules/` in the current directory and its ancestors | `.claude/rules/` in the current directory and its ancestors |

Project Rules are ignored unless Pi trusts the project. At the same scope, Pi-native Rules override Claude-compatible Rules with the same relative path. Nearer project scopes override ancestors, and project Rules override user Rules.

## Writing Rules

A Rule is a Markdown file with optional YAML frontmatter:

```md
---
paths:
  - src/{*.ts,*.tsx}
os: [macos, linux]
models: openai/gpt-5*
---

Use the project's TypeScript conventions when changing these files.
```

Supported conditions:

- `paths`: activates after a successful built-in `read` of a matching file. Other tools do not trigger it.
- `os`: accepts canonical names such as `macos`, `windows`, and `linux`; `darwin` and `win32` are aliases, and WSL is Linux.
- `models`: matches the case-sensitive canonical `provider/id` using glob syntax.

Each field accepts a string or a non-empty list. Values within one field use OR semantics; different fields use AND semantics. Rules without `paths` are evaluated at startup, resume, model selection, reload, and after compaction.

Example OS-specific Rules:

```md
---
os: macos
---

Use Homebrew for package management.
```

```md
---
os: windows
---

Use Scoop for package management.
```

On macOS only the first Rule activates. The TUI reports each activation as `Loaded <relative-path>`. Invalid Rules fail closed and produce warnings instead of becoming unconditional.

## Main features

- Recursive discovery from Pi-native and Claude-compatible user and project locations.
- Deterministic precedence, relative-path collision identity, and activation ordering.
- Path matching with `.gitignore` semantics, case-insensitive matching, and bounded brace expansion.
- OS conditions for macOS, Windows, Linux, Android, BSD variants, AIX, and SunOS.
- Provider-aware model globs against `provider/id`.
- Persistent `system-reminder` messages containing Rule provenance and body.
- Branch- and compaction-aware deduplication without an external state database.
- Trust gating for project Rules and support for symlinked Rule collections.
- Fail-closed parsing with startup summaries and visible warnings.

## Project documentation

- [Full specification](specs/pi-rules.md)
- [GitHub issue](https://github.com/marcoscale98/pi-rules/issues/1)

## Development and verification

Install dependencies and run the Node test suite:

```sh
npm install
npm test
```

Run the mandatory TypeScript check against the globally installed Pi API:

```sh
typecheck_config=$(mktemp)
trap 'rm -f "$typecheck_config"' EXIT
repo_root=$(pwd)
pi_root=$(npm root -g)
cat >"$typecheck_config" <<EOF
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "skipLibCheck": true,
    "paths": {
      "@earendil-works/pi-coding-agent": ["$pi_root/@earendil-works/pi-coding-agent"]
    }
  },
  "files": [
    "$repo_root/extensions/pi-rules/index.ts"
  ],
  "include": [
    "$repo_root/extensions/pi-rules/*.ts"
  ]
}
EOF
tsc --noEmit --project "$typecheck_config"
```
