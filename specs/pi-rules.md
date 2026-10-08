# Pi Conditional Rules Extension Specification

## Problem Statement

Pi does not currently provide a Rules system equivalent to Claude Code's `.claude/rules/` behavior. Pi ships an example extension that discovers rule files and lists them in the system prompt, but it does not parse conditional frontmatter, activate rules after matching file reads, reproduce Claude Code's `Loaded <path>` feedback, or support machine- and model-specific instructions.

This makes it difficult to synchronize one set of personal instructions across machines and models without loading irrelevant or contradictory guidance. For example, a Windows machine should tell the agent to use `scoop`, while a macOS machine should tell it to use `brew`. Similarly, instructions intended for one Pi provider/model should not activate while another model is selected.

The user needs a global, cross-platform Pi extension that preserves compatibility with Claude Code Rules while adding OS and Pi model conditions. It must remain simple, cache-friendly, branch-aware, diagnosable, and suitable for versioning in the private `~/.pi` configuration repository.

## Solution

Build a personal Pi extension that discovers Markdown Rules recursively from both Pi-native and Claude-compatible user and project locations. The extension will parse `paths`, `os`, and `models` frontmatter, resolve source precedence and collisions deterministically, and activate only the Rules whose declared conditions match.

Rules without `paths` become provisional when their OS and model conditions match. Path-scoped Rules become provisional only after Pi successfully reads a matching file. Provisional Rules are kept in extension memory and shown in a non-persisted `Loaded <relative-path>` widget; they are not session entries or provider context. Immediately before the next provider call, matching provisional Rules are committed as persistent custom messages, and the model receives each Rule body in a system-reminder wrapper containing the absolute Rule path.

Everything up to and including the last user or assistant message is frozen. Once a Rule is committed, it remains visible even if the model changes. Before commitment, activation conditions are re-evaluated on startup, resume, reload, model selection, compaction, tree navigation, and matching reads. Deduplication is derived from committed messages on the active session branch and limited to messages after the most recent compact boundary. Consequently, committed Rules remain cache-friendly before compaction, while path-scoped Rules can activate again after compaction if a matching file is read. Rules conditioned only by OS or model are reconsidered immediately after compaction.

The first version will deliberately avoid file watching, content revision tracking, tombstones, a `/rules` command, shell detection, and hard enforcement.

## User Stories

1. As a Pi user, I want modular Markdown Rules, so that I can keep focused instructions separate from the main AGENTS.md file.
2. As a Pi user who also uses Claude Code, I want Pi to consume `.claude/rules/`, so that I can reuse shared Rules without duplicating them.
3. As a Pi user, I want a Pi-native `.pi/rules/` namespace, so that I can define behavior that is specific to Pi.
4. As a user with global preferences, I want user-level Rules to apply across projects, so that I do not repeat personal instructions in every repository.
5. As a project contributor, I want project Rules to take precedence over user Rules with the same identity, so that repository-specific behavior wins.
6. As a monorepo user, I want Rules closer to the current working directory to take precedence over ancestor Rules, so that the most specific project context wins.
7. As a Pi user, I want `.pi/rules/` to take precedence over `.claude/rules/` at the same scope, so that Pi-native decisions can override compatibility Rules.
8. As a Rules author, I want Rules discovered recursively, so that I can organize them into topic-specific subdirectories.
9. As a Rules author, I want two files with the same basename in different subdirectories to coexist, so that directory organization does not create accidental collisions.
10. As a Rules author, I want collision identity based on the path relative to the Rules directory, so that overrides are deterministic across sources.
11. As a Rules author, I want collisions resolved before condition evaluation, so that lower-priority sources do not become dynamic fallbacks.
12. As a cross-platform user, I want an `os` condition, so that machine-specific tool instructions activate only on the appropriate operating system.
13. As a Windows user, I want a Rule that advertises `scoop`, so that the agent uses the package manager installed on that machine.
14. As a macOS user, I want a Rule that advertises `brew`, so that the agent uses the package manager installed on that machine.
15. As a WSL user, I want the environment classified as Linux, so that Linux Rules apply consistently with Node's platform behavior.
16. As a user of multiple Pi providers, I want Rules matched against `provider/id`, so that model identifiers do not collide across providers.
17. As a Rules author, I want glob patterns in `models`, so that one Rule can target a model family rather than a single exact model ID.
18. As a Rules author, I want multiple values within one condition to use OR semantics, so that a Rule can target several paths, systems, or models.
19. As a Rules author, I want different condition fields to use AND semantics, so that a Rule activates only when all declared dimensions match.
20. As a Rules author, I want scalar and list forms accepted for conditional fields, so that simple Rules remain concise and complex Rules remain readable.
21. As a Rules author, I want documented brace expansion for path patterns, so that related file extensions can be expressed compactly.
22. As a Pi user, I want path-scoped Rules activated only after a successful `read`, so that failed or blocked reads do not inject irrelevant instructions.
23. As a Pi user, I want edits, writes, searches, and shell commands not to trigger path Rules, so that activation matches Claude Code's documented read-based behavior.
24. As a Pi user, I want path conditions evaluated using the OS and model selected at read time, so that activation is deterministic and requires no history of unmatched reads.
25. As a Pi user, I want a model change not to retroactively activate path Rules, so that the implementation remains simple and stateless with respect to prior unmatched reads.
26. As a Pi user, I want unconditional OS/model Rules reconsidered after a model change, so that instructions for the newly selected model can activate.
27. As a Pi user, I want committed Rules to remain historically visible after a model change, so that appending new context preserves the prompt-cache prefix while uncommitted matches can be withdrawn.
28. As a Pi user, I want simultaneous activations ordered deterministically, so that parallel reads do not create nondeterministic transcripts or cache keys.
29. As a Pi user, I want each activated Rule displayed as `Loaded <path>`, so that activation feedback matches Claude Code.
30. As a Pi user, I want displayed Rule paths relative to the current working directory, so that feedback is concise and familiar.
31. As a model, I need the absolute Rule path and body in a system-reminder wrapper, so that provenance is explicit and behavior matches Claude Code's message shape.
32. As a Pi user, I want committed activation messages persisted in the transcript, so that resume, fork, and prompt caching behave predictably without recording provisional matches.
33. As a Pi user, I want deduplication derived from the active branch, so that forks and tree navigation respect where a Rule was activated.
34. As a Pi user, I want deduplication limited to the current post-compaction epoch, so that a Rule omitted by compaction can activate again.
35. As a Pi user, I want path Rules to reactivate only after another matching read following compaction, so that no history of previously read paths is required.
36. As a Pi user, I want applicable OS/model-only Rules restored after compaction, so that machine and model guidance does not require a file read.
37. As a Pi user, I want project Rules ignored until the project is trusted, so that untrusted repositories cannot inject instructions automatically.
38. As a user who intentionally shares Rules through symlinks, I want symlinks followed without an extension-specific containment guardrail, so that linked rule collections continue to work.
39. As a Rules author, I want invalid frontmatter, invalid globs, empty condition lists, and empty bodies to fail closed, so that malformed Rules never become unconditional accidentally.
40. As a Rules author, I want unknown frontmatter keys ignored, so that the same Markdown can coexist with other tools and future metadata.
41. As a Pi user, I want invalid Rules reported as warnings, so that configuration mistakes are visible without crashing Pi.
42. As a Pi user, I want a concise startup summary, so that I can see how many Rules were discovered, pending, or rejected.
43. As a Pi user, I want the path shown whenever any Rule becomes pending or committed, including startup OS/model Rules, so that I know which instructions are awaiting or entering the context.
44. As a Pi user, I want `/reload` to refresh discovery without diffing previously activated content, so that the first version stays simple.
45. As a Pi user, I accept that an already activated Rule is not updated or revoked within the same compaction epoch, so that revision and tombstone machinery is unnecessary.
46. As a Pi user, I want tests that use Node's built-in runner without a third-party test framework, so that the repository remains lightweight while also serving as an installable Pi package.
47. As a maintainer, I want the test fake checked against Pi's real `ExtensionAPI` type, so that API drift cannot silently leave tests green.
48. As a repository owner, I want every source, test, and specification file explicitly allowlisted, so that the repository's deny-by-default security policy remains intact.

## Implementation Decisions

- The feature will be implemented as an installable Git Pi package using the conventional root `extensions/` directory and a package manifest that declares its entrypoint and runtime dependencies.
- The extension will be separated into an entrypoint, rule discovery/loading logic, condition matching logic, and tests. This separation exists to keep filesystem concerns distinct from pure matching behavior without introducing speculative abstractions.
- User-level discovery will include the Pi user Rules directory and Claude's user Rules directory.
- Project discovery will walk from the current working directory toward the filesystem root and inspect both Pi-native and Claude-compatible Rules directories at every level.
- Source precedence will be: nearest project scope first, then progressively more distant ancestors, then user scope. Within one scope, Pi-native Rules precede Claude-compatible Rules.
- Markdown files will be discovered recursively. Symlinks will be followed using normal filesystem resolution, with no additional containment restriction beyond Pi's project trust boundary.
- A Rule's collision identity will be its path relative to its containing Rules directory. The first Rule in precedence order wins. Collision resolution happens before frontmatter conditions are evaluated.
- Files within one source will be ordered deterministically by normalized relative path rather than relying on filesystem enumeration order.
- Project and ancestor Rules will be considered only when the current project is trusted. User Rules remain available globally.
- Frontmatter will support `paths`, `os`, and `models`. Each field accepts either a non-empty string or a non-empty list of strings.
- Conditions use AND semantics across fields and OR semantics within a field. A missing field imposes no restriction. A Rule with no conditional fields is unconditional.
- Path matching will mirror Claude Code's scope rules: project patterns are relative to the directory that contains the corresponding project configuration directory; user patterns are relative to Pi's current working directory. Targets outside the matching base cannot match.
- Path matching will normalize separators to `/` and use the `ignore` package with `.gitignore` semantics, matching Claude Code. A pattern without a slash, such as `*.ts`, matches a basename at any depth; `src/*.ts` matches direct children of `src` only. A terminal `/**` suffix is removed before matching so the resulting directory pattern covers that directory and its descendants. Bounded brace expansion is a separate preprocessing step before `ignore` matching. Claude Code invokes `ignore()` without options, whose `ignorecase` default is `true`, so path matching is case-insensitive on every operating system.
- Model matching uses the canonical `provider/id` string and glob syntax. It is case-sensitive. A single `*` does not cross the provider/model separator; `**` may cross separators.
- OS matching uses canonical lowercase names including `windows`, `macos`, `linux`, `android`, `freebsd`, `openbsd`, `aix`, and `sunos`. Node platform names such as `win32` and `darwin` are accepted as aliases. WSL resolves to `linux`.
- OS represents the host platform and available machine tools; it does not assert which shell Pi is using. Shell-specific conditions are not part of the first version.
- Unknown frontmatter keys are ignored. Invalid YAML, invalid condition types, empty lists, invalid globs, or an empty effective body cause the Rule to be skipped with a warning.
- YAML frontmatter and block-level HTML comments will not be included in the body sent to the model. Comments inside code blocks remain content.
- Rules without `paths` become provisional when all OS/model conditions match. This evaluation occurs at session startup, resume, reload, model selection, matching reads, and after compaction as needed. A new evaluation replaces the provisional set, dropping Rules that no longer match.
- Rules with `paths` become provisional only after a successful built-in `read` result for a matching target. Failed or blocked reads, and other tools such as edit, write, grep, find, and bash, do not trigger activation.
- Unmatched read paths will not be retained for later model changes. A provisional path Rule whose OS/model conditions stop matching is dropped and requires another matching read to become provisional.
- Provisional Rules are held in extension memory and shown in a widget above the editor as `Loaded <relative-path>` lines. The widget is cleared when the current provisional set is committed or becomes empty; it is never persisted or sent to the model.
- Provisional Rules are committed only immediately before a provider call. A user prompt uses the `before_agent_start` injection point, which persists the Rule messages after the user message. During an agent run, queued steering messages remain the mid-run commit path before the next LLM call.
- Newly committed Rules from the same provider call are sorted by resolved catalog order and relative identity, and each Rule produces one persistent custom message. Its model-visible content uses the same system-reminder structure as Claude Code: the absolute source path followed by the effective Rule body.
- A custom TUI renderer will show `Loaded ` followed by the path relative to the current working directory for committed messages, with the path emphasized in the same spirit as Claude Code.
- The session region up to and including the last user or assistant message is frozen. Once committed within an epoch, a Rule remains visible even if the model changes; only provisional matches may be withdrawn.
- Deduplication will inspect committed activation messages on the active branch only after the most recent compact boundary. No external database, read-history file, or independent persistent set will be introduced.
- Following compaction, path Rules become eligible for provisional activation on a new successful matching read. Applicable Rules without `paths` become provisional again because they have no read trigger. If compaction will retry an agent run, the provisional Rules are committed to the queued next call.
- Resume, fork, and tree navigation derive committed activation state from the selected branch and re-evaluate provisional Rules. Navigating before a committed activation makes the Rule eligible again.
- Reload refreshes discovery and re-evaluates provisional Rules that have not yet committed in the current epoch. It does not compare hashes, update already committed bodies, append revisions, or append tombstones.
- No `/rules` diagnostic command will be included in the first version. Startup summaries, the pending widget, committed activation lines, and warnings provide the initial observability surface.
- The extension will not enforce behavior. Rules remain model context; hard security policy belongs in hooks, tool interception, or other enforcement mechanisms.
- Repository allowlisting will be updated explicitly for every added source, test, and specification file. Installed dependencies, generated files, and symlinks will remain untracked according to repository policy.

## Testing Decisions

- Tests will assert externally visible extension behavior rather than private helper implementation. The preferred seam is one integration harness around the extension factory.
- The harness will provide a temporary real filesystem and a fake Pi API/context capable of dispatching lifecycle, model, tool-result, turn-end, compaction, and `before_agent_start` events, plus the provisional Rules widget calls.
- The fake API will be declared with TypeScript's `satisfies ExtensionAPI`, not cast from an untyped object, so changes to Pi's extension contract fail typechecking.
- Automated tests will use Node 26's built-in `node:test` runner and native TypeScript type stripping. The root package manifest will declare Pi package metadata, runtime dependencies, and the test script; no root TypeScript configuration or third-party test framework will be added.
- The automated test command will be `node --test extensions/pi-rules/*.test.ts`.
- Because native type stripping does not typecheck, a separate TypeScript check is mandatory in the current supported setup. It will resolve the globally installed Pi package through `npm root -g`, use bundler-style module resolution, and skip dependency declaration checking while still checking extension and test code.
- The typecheck command will use `tsc --noEmit`, target modern ECMAScript, set `--baseUrl "$(npm root -g)"`, and include `--skipLibCheck`. The checked fake must continue to satisfy the real installed `ExtensionAPI`.
- The TypeScript code must stay within syntax that Node's native type stripping can execute directly.
- Discovery tests will cover user and project sources, ancestor traversal, recursive Markdown discovery, symlinks, deterministic ordering, trust gating, and relative-path collision identity.
- Precedence tests will cover nearest-project dominance, Pi-native dominance at equal scope, project-over-user behavior, and collision resolution before condition evaluation.
- Parsing tests through the integration seam will cover scalar/list forms, unknown keys, frontmatter stripping, block HTML comment stripping, empty bodies, malformed YAML, invalid types, empty lists, invalid globs, and brace expansion boundaries.
- OS tests will inject platform values for Windows, macOS, Linux, and WSL classification without requiring those hosts.
- Model tests will cover exact `provider/id` values, family globs, provider separation, case sensitivity, and nonmatching model changes.
- Path activation tests will verify successful reads, failed reads, non-read tools, paths outside the matching base, normalized Windows separators, case-insensitive matching on every operating system, basename-at-any-depth patterns, direct-child patterns, terminal `/**` normalization, and parallel activation ordering.
- Message tests will verify the absolute path and effective body in the model-visible wrapper and the relative path in `Loaded <path>` rendering.
- Lifecycle tests will verify provisional startup activation, prompt-time commitment, model selection withdrawal and restoration, frozen visibility after committed messages, deduplication, resume, fork/tree branch behavior, compact-boundary epochs, immediate restoration of non-path Rules, and read-triggered restoration of path Rules.
- Reload tests will verify catalog refresh for new Rules while confirming that active Rules are neither diffed nor revised.
- Invalid configuration tests will verify fail-closed behavior and warning emission without crashing the session.
- Prior art includes Pi's bundled Claude Rules example for extension lifecycle integration and the inspected Claude Code implementation for successful-read triggers, nested-memory message shape, and `Loaded <path>` rendering.

## Out of Scope

- Hard enforcement of Rule instructions.
- A `shell` condition or shell detection.
- Retrospective activation of path Rules after a model change without another read.
- Triggers from edit, write, grep, find, bash, or arbitrary custom tools.
- File watching or automatic hot reload.
- Rule content hashing, revision tracking, update messages, invalidation messages, or tombstones.
- Dynamic fallback to a lower-priority colliding Rule when the winning Rule's conditions do not match.
- A `/rules` inspection command or complex Rules management UI.
- An expression language for arbitrary boolean conditions.
- Negated model patterns in the first version.
- External symlink containment restrictions beyond project trust.
- Manual or automated end-to-end and smoke testing with a real Pi process or Herdr. The user may perform such smoke tests separately after this scoped work.
- Automated calls to real remote models.
- Publishing the extension to the npm registry.
- Publishing this specification to a GitHub issue.

## Further Notes

- Claude Code 2.1.206 was empirically verified to load a `.claude/rules/` file containing unknown `os` and `models` frontmatter keys. This demonstrates current interoperability but is not a documented compatibility guarantee. Regression checks against future Claude Code versions may be performed manually.
- Claude Code's inspected implementation activates path-scoped Rules after successful reads, renders `Loaded <relative-path>`, and sends the absolute path and Rule contents in a system-reminder wrapper. Its external-user attachment persistence differs from this design: this extension commits provisional activation messages at the next provider call for cache continuity and resume behavior.
- The extension's frozen/provisional model preserves the simplicity of transcript-derived state while avoiding irrelevant model-gated Rules entering a new provider context. Its compaction epoch design also avoids permanent silent loss when a compact summary omits a committed Rule.
- Behavioral instructions may still be ignored by a model. Requirements that must be enforced should use Pi tool interception, hooks, sandboxing, or other deterministic controls.
