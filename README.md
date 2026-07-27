# pi-rules

A conditional Rules extension for [Pi](https://github.com/badlogic/pi-mono) with Claude Code compatibility and path-, OS-, and model-based activation.

## Status

The extension is implemented in `agent/extensions/personal/pi-rules/` and registered through `agent/extensions/personal/index.ts`.

## Specification

- [Full specification](specs/pi-rules.md)
- [GitHub issue](https://github.com/marcoscale98/pi-rules/issues/1)

## Capabilities

- Discover Pi-native and Claude-compatible Rules at user and project scope.
- Activate Rules conditionally by file path, operating system, and `provider/model`.
- Preserve deterministic precedence, transcript persistence, and prompt-cache friendliness.
- Provide visible `Loaded <path>` feedback and fail-closed validation.

## Verification

```sh
npm install --prefix agent/extensions/personal/pi-rules
node --test agent/extensions/personal/pi-rules/*.test.ts
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
    "$repo_root/agent/extensions/personal/index.ts"
  ],
  "include": [
    "$repo_root/agent/extensions/personal/pi-rules/*.ts"
  ]
}
EOF
tsc --noEmit --project "$typecheck_config"
```
