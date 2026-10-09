import { test } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerPiRules from "./index.ts";

interface HandlerMap {
	[event: string]: Array<(event: any, ctx: any) => unknown>;
}

function createHarness(cwd: string, options: { trusted?: boolean; model?: any; confirmTrust?: boolean } = {}) {
	const handlers: HandlerMap = {};
	const messages: any[] = [];
	const notifications: Array<{ message: string; type?: string }> = [];
	const widgets = new Map<string, string[] | undefined>();
	const renderers = new Map<string, unknown>();
	const entries: any[] = [];
	const sendOptions: any[] = [];
	const steeringMessages: any[] = [];
	const nextTurnMessages: any[] = [];
	const triggeredTurns: any[] = [];
	let streaming = false;
	let pendingMessages = false;
	let confirmations = 0;

	const sessionManager = {
		getBranch: () => entries,
	};
	const ctx = {
		cwd,
		mode: "tui",
		hasUI: true,
		model: options.model ?? { provider: "openai", id: "gpt-5" },
		ui: {
			notify(message: string, type?: string) {
				notifications.push({ message, type });
			},
			setWidget(key: string, content: string[] | undefined) {
				widgets.set(key, content);
			},
			setStatus() {},
			confirm: async () => {
				confirmations++;
				return options.confirmTrust ?? true;
			},
		},
		isProjectTrusted: () => options.trusted ?? false,
		isIdle: () => !streaming,
		hasPendingMessages: () => pendingMessages,
		sessionManager,
	};

	function deliverMessage(message: any) {
		messages.push(message);
		entries.push({ type: "custom_message", customType: message.customType, content: message.content, display: message.display, details: message.details, id: `entry-${entries.length}`, parentId: entries.at(-1)?.id ?? null, timestamp: new Date().toISOString() });
	}

	const api = {
		on(event: string, handler: (event: any, ctx: any) => unknown) {
			(handlers[event] ??= []).push(handler);
		},
		registerMessageRenderer(type: string, renderer: unknown) {
			renderers.set(type, renderer);
		},
		registerEntryRenderer() {},
		sendMessage(message: any, options?: any) {
			sendOptions.push(options);
			if (!streaming && options?.triggerTurn !== false) triggeredTurns.push(message);
			if (options?.deliverAs === "nextTurn") {
				nextTurnMessages.push(message);
			} else if (streaming) {
				steeringMessages.push(message);
			} else {
				deliverMessage(message);
			}
		},
		appendEntry(type: string, data: unknown) {
			entries.push({ type: "custom", customType: type, data });
		},
		registerCommand() {},
		registerShortcut() {},
		registerFlag() {},
		getFlag() {},
		registerTool() {},
		sendUserMessage() {},
		setSessionName() {},
		getSessionName() {},
		setLabel() {},
		exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
		getActiveTools: () => [],
		getAllTools: () => [],
		getCommands: () => [],
		setActiveTools() {},
		setModel: async () => true,
		getThinkingLevel: () => "off",
		setThinkingLevel() {},
		registerProvider() {},
		unregisterProvider() {},
		events: { on() { return () => {}; }, emit() {} },
	} satisfies ExtensionAPI;

	return {
		api,
		ctx,
		messages,
		notifications,
		renderers,
		entries,
		widgets,
		sendOptions,
		nextTurnMessages,
		steeringMessages,
		triggeredTurns,
		confirmations,
		handlers,
		setStreaming(value: boolean) { streaming = value; },
		setPendingMessages(value: boolean) { pendingMessages = value; },
		deliverSteering() {
			if (steeringMessages.length > 0) deliverMessage(steeringMessages.shift());
		},
	};
}

async function dispatch(harness: ReturnType<typeof createHarness>, event: string, payload: any) {
	if (event === "agent_start" || event === "tool_result" || event === "turn_end") harness.setStreaming(true);
	if (event === "model_select") harness.ctx.model = payload.model;
	for (const handler of harness.handlers[event] ?? []) {
		const result = await handler(payload, harness.ctx);
		const message = (result as { message?: any } | undefined)?.message;
		if (event === "before_agent_start" && message) deliverHarnessMessage(harness, message);
	}
	if (event === "turn_end") {
		harness.deliverSteering();
		harness.setStreaming(false);
	}
}

function deliverHarnessMessage(harness: ReturnType<typeof createHarness>, message: any): void {
	harness.messages.push(message);
	harness.entries.push({ type: "custom_message", customType: message.customType, content: message.content, display: message.display, details: message.details, id: `entry-${harness.entries.length}`, parentId: harness.entries.at(-1)?.id ?? null, timestamp: new Date().toISOString() });
}

test("loads and activates an unconditional user Rule at session startup", async () => {
	const homeDir = mkdtempSync(join(tmpdir(), "pi-rules-home-"));
	const rulesDir = join(homeDir, ".pi", "agent", "rules");
	mkdirSync(rulesDir, { recursive: true });
	writeFileSync(join(rulesDir, "editor.md"), "Prefer the editor tool.");

	const harness = createHarness(homeDir);
	registerPiRules(harness.api, { homeDir, platform: "darwin" });
	await dispatch(harness, "session_start", { type: "session_start", reason: "startup" });

	assert.equal(harness.messages.length, 0);
	assert.deepEqual(harness.widgets.get("pi-rules"), ["Loaded .pi/agent/rules/editor.md"]);
	assert.ok(harness.renderers.has("pi-rules"));
	assert.equal(harness.notifications.at(-1)?.type, "info");
	assert.equal(harness.triggeredTurns.length, 0);

	await dispatch(harness, "before_agent_start", { type: "before_agent_start", prompt: "hello" });
	assert.equal(harness.messages.length, 1);
	assert.match(harness.messages[0].content, /<system-reminder>/);
	assert.match(harness.messages[0].content, new RegExp(`Contents of ${join(rulesDir, "editor.md")}:`));
	assert.match(harness.messages[0].content, /Prefer the editor tool\./);
	assert.equal(harness.messages[0].display, true);
	assert.equal(harness.widgets.get("pi-rules"), undefined);
});

test("commits all pending Rules before the first provider call of an extension-started turn", async () => {
	const homeDir = mkdtempSync(join(tmpdir(), "pi-rules-home-"));
	const rulesDir = join(homeDir, ".pi", "agent", "rules");
	mkdirSync(rulesDir, { recursive: true });
	writeFileSync(join(rulesDir, "always.md"), "Always use the project conventions.");
	writeFileSync(join(rulesDir, "model.md"), "---\nmodels: openai/gpt-*\n---\nUse model guidance.");

	const harness = createHarness(homeDir, { model: { provider: "openai", id: "gpt-5" } });
	registerPiRules(harness.api, { homeDir, platform: "darwin" });
	await dispatch(harness, "session_start", { type: "session_start", reason: "startup" });
	assert.deepEqual(harness.widgets.get("pi-rules"), ["Loaded .pi/agent/rules/always.md", "Loaded .pi/agent/rules/model.md"]);

	await dispatch(harness, "agent_start", { type: "agent_start" });
	assert.equal(harness.messages.length, 0);
	harness.deliverSteering();

	assert.match(harness.messages.map((message) => message.content).join("\n"), /Always use the project conventions\.[\s\S]*Use model guidance\./);
	assert.equal(harness.steeringMessages.length, 0, "Rules must not remain queued for an extra model turn");
	assert.equal(harness.triggeredTurns.length, 0);
	assert.equal(harness.widgets.get("pi-rules"), undefined);
	const renderer = harness.renderers.get("pi-rules") as any;
	assert.deepEqual(renderer(harness.messages[0], { outputPad: 0 }, {
		fg: (_color: string, value: string) => value, bold: (value: string) => value,
	}).render(80), ["Loaded .pi/agent/rules/always.md", "Loaded .pi/agent/rules/model.md"]);

	harness.setStreaming(false);
	await dispatch(harness, "session_start", { type: "session_start", reason: "resume" });
	await dispatch(harness, "before_agent_start", { type: "before_agent_start", prompt: "continue" });
	assert.equal(harness.messages.length, 1, "Resumed batches deduplicate every committed Rule");
});

test("real Pi delivers all pending Rules in one provider call for an extension-started turn", { timeout: 15_000 }, async () => {
	// Resolve Pi's own installed AI dependency rather than adding a second copy.
	const searchPaths = createRequire(import.meta.resolve("@earendil-works/pi-coding-agent")).resolve.paths("@earendil-works/pi-ai") ?? [];
	const fauxPath = searchPaths.map((path) => join(path, "@earendil-works/pi-ai/dist/providers/faux.js")).find(existsSync);
	assert.ok(fauxPath, "Pi's AI dependency must be installed");
	const { fauxProvider, fauxAssistantMessage } = await import(pathToFileURL(fauxPath).href);
	const homeDir = mkdtempSync(join(tmpdir(), "pi-rules-sdk-"));
	const agentDir = join(homeDir, ".pi", "agent");
	const rulesDir = join(agentDir, "rules");
	mkdirSync(rulesDir, { recursive: true });
	writeFileSync(join(rulesDir, "always.md"), "Always use the project conventions.");
	writeFileSync(join(rulesDir, "faux.md"), "---\nmodels: faux/model-a\n---\nUse model guidance.");
	const faux = fauxProvider({ models: [{ id: "model-a" }], tokensPerSecond: Infinity });
	const contexts: string[] = [];
	faux.setResponses([(context: any) => {
		contexts.push(JSON.stringify(context.messages));
		return fauxAssistantMessage("Done.");
	}, fauxAssistantMessage("Unexpected extra turn.")]);
	const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null });
	modelRuntime.registerNativeProvider(faux.provider);
	const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
	const errors: unknown[] = [];
	const resourceLoader = new DefaultResourceLoader({
		cwd: homeDir, agentDir, settingsManager,
		noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
		agentsFilesOverride: () => ({ agentsFiles: [] }),
		extensionFactories: [
			(pi) => registerPiRules(pi, { homeDir }),
			(pi) => pi.registerCommand("kickoff", {
				description: "Start a turn without user prompt submission",
				handler: async () => { pi.sendMessage({ customType: "kickoff", content: "Begin.", display: true }, { triggerTurn: true }); },
			}),
		],
	});
	await resourceLoader.reload();
	const { session } = await createAgentSession({
		cwd: homeDir, agentDir, modelRuntime, model: faux.getModel(),
		resourceLoader, settingsManager, sessionManager: SessionManager.inMemory(homeDir), tools: [],
	});
	try {
		await session.bindExtensions({ onError: (error) => errors.push(error) });
		assert.equal(session.messages.filter((message) => message.role === "custom").length, 0);
		await session.prompt("/kickoff");
		await session.agent.waitForIdle();
		assert.deepEqual(errors, []);
		assert.equal(faux.state.callCount, 1, "Pending Rules must not cause an extra provider call");
		assert.match(contexts[0], /Always use the project conventions\.[\s\S]*Use model guidance\./);
		const committed = session.sessionManager.getBranch().filter((entry) => entry.type === "custom_message" && entry.customType === "pi-rules");
		assert.equal(committed.length, 1);
		assert.ok(committed[0].type === "custom_message");
		assert.match(String(committed[0].content), /Always use the project conventions\.[\s\S]*Use model guidance\./);
	} finally {
		session.dispose();
	}
});

test("commits restored Rules before a queued continuation after threshold compaction", async () => {
	const homeDir = mkdtempSync(join(tmpdir(), "pi-rules-home-"));
	const rulesDir = join(homeDir, ".pi", "agent", "rules");
	mkdirSync(rulesDir, { recursive: true });
	writeFileSync(join(rulesDir, "always.md"), "Always use the project conventions.");
	writeFileSync(join(rulesDir, "model.md"), "---\nmodels: openai/gpt-*\n---\nUse model guidance.");

	const harness = createHarness(homeDir);
	registerPiRules(harness.api, { homeDir, platform: "darwin" });
	await dispatch(harness, "session_start", { type: "session_start", reason: "startup" });
	harness.setStreaming(true);
	harness.setPendingMessages(true);
	await dispatch(harness, "session_compact", { type: "session_compact", willRetry: false });

	assert.equal(harness.messages.length, 0);
	harness.deliverSteering();
	assert.match(harness.messages[0].content, /Always use the project conventions\.[\s\S]*Use model guidance\./);
	assert.equal(harness.steeringMessages.length, 0);
	assert.deepEqual(harness.sendOptions, [{ deliverAs: "steer" }]);
});

test("keeps model-gated Rules provisional until the submitted prompt", async () => {
	const homeDir = mkdtempSync(join(tmpdir(), "pi-rules-home-"));
	const rulesDir = join(homeDir, ".pi", "agent", "rules");
	mkdirSync(rulesDir, { recursive: true });
	writeFileSync(join(rulesDir, "codex.md"), "---\nmodels: openai-codex/**\n---\nUse Codex guidance.");

	const harness = createHarness(homeDir, { model: { provider: "openai-codex", id: "gpt-5" } });
	registerPiRules(harness.api, { homeDir, platform: "darwin" });
	await dispatch(harness, "session_start", { type: "session_start", reason: "startup" });

	assert.equal(harness.messages.length, 0);
	assert.deepEqual(harness.widgets.get("pi-rules"), ["Loaded .pi/agent/rules/codex.md"]);

	await dispatch(harness, "model_select", { model: { provider: "anthropic", id: "claude-opus" } });
	assert.equal(harness.messages.length, 0);
	assert.equal(harness.entries.length, 0);
	assert.equal(harness.widgets.get("pi-rules"), undefined);

	await dispatch(harness, "before_agent_start", { type: "before_agent_start", prompt: "hello" });
	assert.equal(harness.messages.length, 0);
	assert.equal(harness.entries.length, 0);
});

test("commits only the currently matching provisional Rules once at prompt submission", async () => {
	const homeDir = mkdtempSync(join(tmpdir(), "pi-rules-home-"));
	const rulesDir = join(homeDir, ".pi", "agent", "rules");
	mkdirSync(rulesDir, { recursive: true });
	writeFileSync(join(rulesDir, "codex.md"), "---\nmodels: openai-codex/**\n---\nUse Codex guidance.");

	const harness = createHarness(homeDir, { model: { provider: "openai-codex", id: "gpt-5" } });
	registerPiRules(harness.api, { homeDir, platform: "darwin" });
	await dispatch(harness, "session_start", { type: "session_start", reason: "startup" });
	await dispatch(harness, "model_select", { model: { provider: "anthropic", id: "claude-opus" } });
	await dispatch(harness, "model_select", { model: { provider: "openai-codex", id: "gpt-5" } });

	assert.equal(harness.messages.length, 0);
	await dispatch(harness, "before_agent_start", { type: "before_agent_start", prompt: "hello" });
	assert.equal(harness.messages.length, 1);
	assert.equal(harness.entries.length, 1);
	assert.deepEqual(harness.messages.map((message) => message.details.identity), ["codex.md"]);
	assert.equal(harness.widgets.get("pi-rules"), undefined);

	await dispatch(harness, "before_agent_start", { type: "before_agent_start", prompt: "again" });
	assert.equal(harness.messages.length, 1);
});

test("does not withdraw Rules committed before the last assistant message", async () => {
	const homeDir = mkdtempSync(join(tmpdir(), "pi-rules-home-"));
	const rulesDir = join(homeDir, ".pi", "agent", "rules");
	mkdirSync(rulesDir, { recursive: true });
	writeFileSync(join(rulesDir, "always.md"), "Always keep this guidance.");
	writeFileSync(join(rulesDir, "codex.md"), "---\nmodels: openai-codex/**\n---\nUse Codex guidance.");

	const harness = createHarness(homeDir, { model: { provider: "anthropic", id: "claude-opus" } });
	registerPiRules(harness.api, { homeDir, platform: "darwin" });
	await dispatch(harness, "session_start", { type: "session_start", reason: "startup" });
	await dispatch(harness, "before_agent_start", { type: "before_agent_start", prompt: "hello" });
	harness.entries.push({ type: "message", message: { role: "assistant" } });

	await dispatch(harness, "model_select", { model: { provider: "openai-codex", id: "gpt-5" } });
	assert.deepEqual(harness.widgets.get("pi-rules"), ["Loaded .pi/agent/rules/codex.md"]);
	await dispatch(harness, "model_select", { model: { provider: "anthropic", id: "claude-opus" } });
	assert.equal(harness.widgets.get("pi-rules"), undefined);
	await dispatch(harness, "before_agent_start", { type: "before_agent_start", prompt: "continue" });

	assert.deepEqual(harness.messages.map((message) => message.details.identity), ["always.md"]);
});

test("discovers trusted project Rules recursively with deterministic precedence and collision-before-condition resolution", async () => {
	const homeDir = mkdtempSync(join(tmpdir(), "pi-rules-home-"));
	const cwd = join(homeDir, "project", "packages", "app");
	const projectRules = join(homeDir, "project", ".pi", "rules");
	const ancestorRules = join(homeDir, "project", "packages", ".claude", "rules");
	const userRules = join(homeDir, ".pi", "agent", "rules");
	mkdirSync(cwd, { recursive: true });
	mkdirSync(projectRules, { recursive: true });
	mkdirSync(join(ancestorRules, "nested"), { recursive: true });
	mkdirSync(userRules, { recursive: true });
	writeFileSync(join(projectRules, "same.md"), "project wins");
	writeFileSync(join(userRules, "same.md"), "user loses");
	writeFileSync(join(projectRules, "conditional.md"), "---\nos: windows\n---\nproject condition does not match");
	writeFileSync(join(userRules, "conditional.md"), "user fallback must not activate");
	writeFileSync(join(ancestorRules, "nested/ancestor.md"), "ancestor rule");
	const harness = createHarness(cwd, { trusted: true });
	registerPiRules(harness.api, { homeDir, platform: "darwin" });
	await dispatch(harness, "session_start", { type: "session_start", reason: "startup" });

	assert.equal(harness.messages.length, 0);
	assert.deepEqual(harness.widgets.get("pi-rules"), ["Loaded ../.claude/rules/nested/ancestor.md", "Loaded ../../.pi/rules/same.md"]);
	await dispatch(harness, "before_agent_start", { type: "before_agent_start", prompt: "hello" });
	assert.deepEqual(harness.messages.map((message) => message.details.identity), ["nested/ancestor.md", "same.md"]);
	assert.match(harness.messages.find((message) => message.details.identity === "same.md").content, /project wins/);
	assert.ok(!harness.messages.some((message) => message.content.includes("fallback")));
});

test("parses scalar and list conditions, canonicalizes OS/model matches, and strips non-code metadata", async () => {
	const homeDir = mkdtempSync(join(tmpdir(), "pi-rules-home-"));
	const rulesDir = join(homeDir, ".pi", "agent", "rules");
	mkdirSync(rulesDir, { recursive: true });
	writeFileSync(
		join(rulesDir, "selected.md"),
		"---\nos: macos\nmodels:\n- openai/gpt-5*\ndescription: >\n  shared metadata\nunknown: [true, 42]\n---\n<!-- remove this -->\nKeep this instruction.\n\n```ts\n<!-- preserve this code comment -->\n```",
	);
	writeFileSync(join(rulesDir, "wrong-os.md"), "---\nos: windows\n---\nwrong OS");
	writeFileSync(join(rulesDir, "wrong-model.md"), "---\nmodels: anthropic/**\n---\nwrong model");
	writeFileSync(join(rulesDir, "invalid.md"), "---\npaths: []\n---\ninvalid");
	writeFileSync(join(rulesDir, "empty.md"), "<!-- only a comment -->");
	writeFileSync(join(rulesDir, "malformed.md"), "---\npaths: [\n---\nmalformed");
	writeFileSync(join(rulesDir, "invalid-type.md"), "---\npaths: 42\n---\ninvalid type");
	writeFileSync(join(rulesDir, "invalid-os.md"), "---\nos: mac\n---\ninvalid OS");
	writeFileSync(join(rulesDir, "empty-os.md"), "---\nos: []\n---\nempty list");
	writeFileSync(join(rulesDir, "invalid-glob.md"), "---\npaths: '['\n---\ninvalid glob");
	writeFileSync(join(rulesDir, "invalid-brace.md"), "---\npaths: 'src/{*.ts,}'\n---\ninvalid brace");

	const harness = createHarness(homeDir, { model: { provider: "openai", id: "gpt-5-mini" } });
	registerPiRules(harness.api, { homeDir, platform: "darwin" });
	await dispatch(harness, "session_start", { type: "session_start", reason: "startup" });

	assert.equal(harness.messages.length, 0);
	await dispatch(harness, "before_agent_start", { type: "before_agent_start", prompt: "hello" });
	assert.equal(harness.messages.length, 1);
	assert.match(harness.messages[0].content, /Keep this instruction/);
	assert.match(harness.messages[0].content, /preserve this code comment/);
	assert.doesNotMatch(harness.messages[0].content, /remove this/);
	assert.equal(harness.notifications.filter((notification) => notification.type === "warning").length, 8);
});

test("activates path Rules only after successful matching reads", async () => {
	const homeDir = mkdtempSync(join(tmpdir(), "pi-rules-home-"));
	const cwd = join(homeDir, "project");
	const rulesDir = join(cwd, ".pi", "rules");
	mkdirSync(rulesDir, { recursive: true });
	writeFileSync(join(rulesDir, "source.md"), "---\npaths:\n  - src/{*.ts,*.tsx}\n---\nUse TypeScript conventions.");

	const harness = createHarness(cwd, { trusted: true });
	registerPiRules(harness.api, { homeDir, platform: "darwin" });
	await dispatch(harness, "session_start", { type: "session_start", reason: "startup" });
	assert.equal(harness.messages.length, 0);

	await dispatch(harness, "tool_result", { type: "tool_result", toolName: "read", input: { path: "src/FILE.TS" }, isError: false });
	await dispatch(harness, "turn_end", { type: "turn_end" });
	assert.equal(harness.messages.length, 1);
	assert.equal(harness.widgets.get("pi-rules"), undefined);
	assert.deepEqual(harness.sendOptions, [{ deliverAs: "steer" }]);
	await dispatch(harness, "tool_result", { type: "tool_result", toolName: "read", input: { path: "src/deep/file.ts" }, isError: false });
	await dispatch(harness, "tool_result", { type: "tool_result", toolName: "read", input: { path: "src/failed.ts" }, isError: true });
	await dispatch(harness, "tool_result", { type: "tool_result", toolName: "bash", input: { command: "cat src/other.ts" }, isError: false });
	await dispatch(harness, "turn_end", { type: "turn_end" });
	assert.equal(harness.messages.length, 1);
});

test("drops a provisional path Rule when its model stops matching before commit", async () => {
	const homeDir = mkdtempSync(join(tmpdir(), "pi-rules-home-"));
	const cwd = join(homeDir, "project");
	const rulesDir = join(cwd, ".pi", "rules");
	mkdirSync(rulesDir, { recursive: true });
	writeFileSync(join(rulesDir, "codex.md"), "---\npaths: '*.ts'\nmodels: openai-codex/**\n---\nUse Codex TypeScript guidance.");

	const harness = createHarness(cwd, { trusted: true, model: { provider: "openai-codex", id: "gpt-5" } });
	registerPiRules(harness.api, { homeDir, platform: "darwin" });
	await dispatch(harness, "session_start", { type: "session_start", reason: "startup" });
	await dispatch(harness, "tool_result", { type: "tool_result", toolName: "read", input: { path: "file.ts" }, isError: false });
	assert.deepEqual(harness.widgets.get("pi-rules"), ["Loaded .pi/rules/codex.md"]);

	await dispatch(harness, "model_select", { model: { provider: "anthropic", id: "claude-opus" } });
	assert.equal(harness.widgets.get("pi-rules"), undefined);
	await dispatch(harness, "turn_end", { type: "turn_end" });
	assert.equal(harness.messages.length, 0);
});

test("matches ignore path semantics across separators, depth, terminal directories, and bases", async () => {
	const homeDir = mkdtempSync(join(tmpdir(), "pi-rules-home-"));
	const project = join(homeDir, "project");
	const cwd = join(project, "packages", "app");
	const rulesDir = join(cwd, ".pi", "rules");
	const outside = join(project, "src", "outside.ts");
	mkdirSync(rulesDir, { recursive: true });
	mkdirSync(join(project, "src"), { recursive: true });
	writeFileSync(outside, "outside");
	writeFileSync(join(rulesDir, "a-basename.md"), "---\npaths: '*.ts'\n---\nbasename");
	writeFileSync(join(rulesDir, "b-direct.md"), "---\npaths: 'src/*.ts'\n---\ndirect child");
	writeFileSync(join(rulesDir, "c-terminal.md"), "---\npaths: 'docs/**'\n---\ndocs tree");
	writeFileSync(join(rulesDir, "d-windows.md"), "---\nos: windows\npaths: 'win/*.ps1'\n---\nWindows");

	const harness = createHarness(cwd, { trusted: true });
	registerPiRules(harness.api, { homeDir, platform: "win32" });
	await dispatch(harness, "session_start", { type: "session_start", reason: "startup" });

	await dispatch(harness, "tool_result", { type: "tool_result", toolName: "read", input: { path: "src\\deep\\file.ts" }, isError: false });
	await dispatch(harness, "turn_end", { type: "turn_end" });
	assert.deepEqual(harness.messages.map((message) => message.details.identity), ["a-basename.md"]);
	await dispatch(harness, "tool_result", { type: "tool_result", toolName: "read", input: { path: "other\\docs\\guide.md" }, isError: false });
	await dispatch(harness, "turn_end", { type: "turn_end" });
	assert.deepEqual(harness.messages.map((message) => message.details.identity), ["a-basename.md"]);

	await dispatch(harness, "tool_result", { type: "tool_result", toolName: "read", input: { path: "src\\file.TS" }, isError: false });
	await dispatch(harness, "tool_result", { type: "tool_result", toolName: "read", input: { path: "docs\\nested\\guide.md" }, isError: false });
	await dispatch(harness, "tool_result", { type: "tool_result", toolName: "read", input: { path: outside }, isError: false });
	await dispatch(harness, "turn_end", { type: "turn_end" });
	assert.deepEqual(harness.messages.flatMap((message) => (message.details.rules ?? [message.details]).map((rule: any) => rule.identity)), ["a-basename.md", "b-direct.md", "c-terminal.md"]);

	const windowsHarness = createHarness(cwd, { trusted: true });
	registerPiRules(windowsHarness.api, { homeDir, platform: "darwin" });
	await dispatch(windowsHarness, "session_start", { type: "session_start", reason: "startup" });
	await dispatch(windowsHarness, "tool_result", { type: "tool_result", toolName: "read", input: { path: "win\\SETUP.PS1" }, isError: false });
	await dispatch(windowsHarness, "turn_end", { type: "turn_end" });
	assert.equal(windowsHarness.messages.length, 0);

	const injectedWindowsHarness = createHarness(cwd, { trusted: true });
	registerPiRules(injectedWindowsHarness.api, { homeDir, platform: "win32" });
	await dispatch(injectedWindowsHarness, "session_start", { type: "session_start", reason: "startup" });
	await dispatch(injectedWindowsHarness, "tool_result", { type: "tool_result", toolName: "read", input: { path: "win\\SETUP.PS1" }, isError: false });
	await dispatch(injectedWindowsHarness, "turn_end", { type: "turn_end" });
	assert.deepEqual(injectedWindowsHarness.messages.map((message) => message.details.identity), ["d-windows.md"]);
	assert.match(injectedWindowsHarness.messages[0].content, /Contents of .*d-windows\.md:/);
});

test("gates project discovery by trust, follows symlinks, and gives Pi-native sources equal-scope precedence", async () => {
	const homeDir = mkdtempSync(join(tmpdir(), "pi-rules-home-"));
	const cwd = join(homeDir, "project");
	const piRules = join(cwd, ".pi", "rules");
	const claudeRules = join(cwd, ".claude", "rules");
	const externalRules = join(homeDir, "shared-rules");
	const userPiRules = join(homeDir, ".pi", "agent", "rules");
	const userClaudeRules = join(homeDir, ".claude", "rules");
	mkdirSync(piRules, { recursive: true });
	mkdirSync(claudeRules, { recursive: true });
	mkdirSync(externalRules, { recursive: true });
	mkdirSync(userPiRules, { recursive: true });
	mkdirSync(userClaudeRules, { recursive: true });
	mkdirSync(join(claudeRules, "shared"), { recursive: true });
	writeFileSync(join(externalRules, "shared.md"), "symlinked Pi rule");
	symlinkSync(externalRules, join(piRules, "shared"), "dir");
	writeFileSync(join(claudeRules, "shared/shared.md"), "Claude collision loses");
	writeFileSync(join(userPiRules, "user.md"), "user rule");
	writeFileSync(join(userClaudeRules, "user.md"), "Claude user collision loses");

	const trust = { trusted: false };
	const harness = createHarness(cwd, trust);
	registerPiRules(harness.api, { homeDir, platform: "darwin" });
	await dispatch(harness, "session_start", { type: "session_start", reason: "startup" });
	assert.equal(harness.messages.length, 0);
	assert.deepEqual(harness.widgets.get("pi-rules"), ["Loaded ../.pi/agent/rules/user.md"]);

	trust.trusted = true;
	await dispatch(harness, "session_start", { type: "session_start", reason: "reload" });
	assert.equal(harness.messages.length, 0);
	await dispatch(harness, "before_agent_start", { type: "before_agent_start", prompt: "hello" });
	assert.deepEqual(harness.messages.map((message) => message.details.identity), ["shared/shared.md", "user.md"]);
	assert.match(harness.messages.find((message) => message.details.identity === "shared/shared.md").content, /symlinked Pi rule/);
});

test("derives deduplication from the active branch and compaction epoch", async () => {
	const homeDir = mkdtempSync(join(tmpdir(), "pi-rules-home-"));
	const cwd = join(homeDir, "project");
	const rulesDir = join(cwd, ".pi", "rules");
	mkdirSync(rulesDir, { recursive: true });
	writeFileSync(join(rulesDir, "always.md"), "Always keep this guidance.");
	writeFileSync(join(rulesDir, "source.md"), "---\npaths: '*.ts'\n---\nUse TypeScript guidance.");

	const harness = createHarness(cwd, { trusted: true });
	registerPiRules(harness.api, { homeDir, platform: "darwin" });
	await dispatch(harness, "session_start", { type: "session_start", reason: "startup" });
	assert.equal(harness.messages.length, 0);
	await dispatch(harness, "before_agent_start", { type: "before_agent_start", prompt: "hello" });
	assert.deepEqual(harness.messages.map((message) => message.details.identity), ["always.md"]);
	assert.equal(harness.entries[0]?.type, "custom_message");
	await dispatch(harness, "session_start", { type: "session_start", reason: "resume" });
	assert.equal(harness.messages.length, 1);

	await dispatch(harness, "model_select", { model: { provider: "openai", id: "gpt-5" } });
	assert.equal(harness.messages.length, 1);
	await dispatch(harness, "tool_result", { type: "tool_result", toolName: "read", input: { path: "src/file.ts" }, isError: false });
	await dispatch(harness, "turn_end", { type: "turn_end" });
	assert.deepEqual(harness.messages.map((message) => message.details.identity), ["always.md", "source.md"]);

	harness.entries.push({ type: "compaction", id: `compaction-${harness.entries.length}`, parentId: harness.entries.at(-1)?.id ?? null, timestamp: new Date().toISOString(), summary: "summary", firstKeptEntryId: "first", tokensBefore: 1 });
	await dispatch(harness, "session_compact", { type: "session_compact", willRetry: true });
	assert.deepEqual(harness.messages.map((message) => message.details.identity), ["always.md", "source.md", "always.md"]);

	await dispatch(harness, "tool_result", { type: "tool_result", toolName: "read", input: { path: "src/file.ts" }, isError: false });
	await dispatch(harness, "turn_end", { type: "turn_end" });
	assert.deepEqual(harness.messages.map((message) => message.details.identity), ["always.md", "source.md", "always.md", "source.md"]);

	harness.entries.splice(0, harness.entries.length);
	await dispatch(harness, "session_tree", { type: "session_tree", newLeafId: "branch", oldLeafId: "old" });
	assert.equal(harness.messages.length, 4);
	await dispatch(harness, "model_select", { model: { provider: "openai", id: "gpt-5" } });
	assert.equal(harness.messages.length, 4);
	await dispatch(harness, "before_agent_start", { type: "before_agent_start", prompt: "continue" });
	assert.equal(harness.messages.length, 5);
});

test("uses the selected model at read time and restores model-only Rules on model changes", async () => {
	const homeDir = mkdtempSync(join(tmpdir(), "pi-rules-home-"));
	const cwd = join(homeDir, "project");
	const rulesDir = join(cwd, ".pi", "rules");
	mkdirSync(rulesDir, { recursive: true });
	writeFileSync(join(rulesDir, "model-only.md"), "---\nmodels: openai/gpt-*\n---\nUse OpenAI guidance.");
	writeFileSync(join(rulesDir, "model-path.md"), "---\npaths: '*.ts'\nmodels: openai/gpt-*\n---\nUse OpenAI TypeScript guidance.");

	const harness = createHarness(cwd, { trusted: true, model: { provider: "anthropic", id: "claude" } });
	registerPiRules(harness.api, { homeDir, platform: "linux" });
	await dispatch(harness, "session_start", { type: "session_start", reason: "startup" });
	assert.equal(harness.messages.length, 0);

	await dispatch(harness, "tool_result", { type: "tool_result", toolName: "read", input: { path: "src/file.ts" }, isError: false });
	await dispatch(harness, "turn_end", { type: "turn_end" });
	assert.equal(harness.messages.length, 0);

	await dispatch(harness, "model_select", { model: { provider: "openai", id: "gpt-5-mini" } });
	assert.equal(harness.messages.length, 0);
	await dispatch(harness, "before_agent_start", { type: "before_agent_start", prompt: "hello" });
	assert.deepEqual(harness.messages.map((message) => message.details.identity), ["model-only.md"]);

	await dispatch(harness, "tool_result", { type: "tool_result", toolName: "read", input: { path: "src/file.ts" }, isError: false });
	await dispatch(harness, "turn_end", { type: "turn_end" });
	assert.deepEqual(harness.messages.map((message) => message.details.identity), ["model-only.md", "model-path.md"]);
});

test("classifies WSL as Linux and orders parallel path activations deterministically", async () => {
	const homeDir = mkdtempSync(join(tmpdir(), "pi-rules-home-"));
	const cwd = join(homeDir, "project");
	const rulesDir = join(cwd, ".pi", "rules");
	mkdirSync(rulesDir, { recursive: true });
	writeFileSync(join(rulesDir, "a.md"), "---\npaths: '*.ts'\nos: linux\n---\nA");
	writeFileSync(join(rulesDir, "b.md"), "---\npaths: '*.ts'\nos: linux\n---\nB");
	const harness = createHarness(cwd, { trusted: true });
	registerPiRules(harness.api, { homeDir, platform: "linux", environment: { WSL_DISTRO_NAME: "Ubuntu" } });
	await dispatch(harness, "session_start", { type: "session_start", reason: "startup" });

	await dispatch(harness, "tool_result", { type: "tool_result", toolName: "read", input: { path: "src/file.ts" }, isError: false });
	await dispatch(harness, "tool_result", { type: "tool_result", toolName: "read", input: { path: "other.ts" }, isError: false });
	await dispatch(harness, "turn_end", { type: "turn_end" });
	assert.deepEqual(harness.messages.flatMap((message) => (message.details.rules ?? [message.details]).map((rule: any) => rule.identity)), ["a.md", "b.md"]);
	assert.equal(harness.steeringMessages.length, 0);
});

test("reload discovers new Rules without revising already activated messages", async () => {
	const homeDir = mkdtempSync(join(tmpdir(), "pi-rules-home-"));
	const rulesDir = join(homeDir, ".pi", "agent", "rules");
	mkdirSync(rulesDir, { recursive: true });
	const existingPath = join(rulesDir, "existing.md");
	writeFileSync(existingPath, "old body");
	const harness = createHarness(homeDir);
	registerPiRules(harness.api, { homeDir, platform: "darwin" });
	await dispatch(harness, "session_start", { type: "session_start", reason: "startup" });
	await dispatch(harness, "before_agent_start", { type: "before_agent_start", prompt: "hello" });
	writeFileSync(existingPath, "new body");
	writeFileSync(join(rulesDir, "new.md"), "new Rule");
	await dispatch(harness, "session_start", { type: "session_start", reason: "reload" });

	assert.equal(harness.messages.length, 1);
	assert.match(harness.messages[0].content, /old body/);
	assert.doesNotMatch(harness.messages[0].content, /new body/);
	assert.deepEqual(harness.widgets.get("pi-rules"), ["Loaded .pi/agent/rules/new.md"]);
	assert.match(harness.notifications.at(-1)?.message ?? "", /discovered 2, pending 1, rejected 0/);

	await dispatch(harness, "before_agent_start", { type: "before_agent_start", prompt: "continue" });
	assert.equal(harness.messages.length, 2);
	assert.match(harness.messages[1].content, /new Rule/);

	const renderer = harness.renderers.get("pi-rules") as any;
	const component = renderer(harness.messages[1], { outputPad: 0 }, { fg: (_color: string, value: string) => value, bold: (value: string) => value });
	assert.deepEqual(component.render(80), ["Loaded .pi/agent/rules/new.md"]);
});

test("keeps user Rule paths relative to the current working directory under the home directory", async () => {
	const homeDir = mkdtempSync(join(tmpdir(), "pi-rules-home-"));
	const cwd = join(homeDir, "project");
	const rulesDir = join(homeDir, ".claude", "rules");
	mkdirSync(cwd, { recursive: true });
	mkdirSync(rulesDir, { recursive: true });
	writeFileSync(join(rulesDir, "typescript.md"), "---\npaths: src/*.ts\n---\nUse TypeScript guidance.");

	const harness = createHarness(cwd, { trusted: true });
	registerPiRules(harness.api, { homeDir, platform: "darwin" });
	await dispatch(harness, "session_start", { type: "session_start", reason: "startup" });
	await dispatch(harness, "tool_result", { type: "tool_result", toolName: "read", input: { path: "src/file.ts" }, isError: false });
	await dispatch(harness, "turn_end", { type: "turn_end" });

	assert.deepEqual(harness.messages.map((message) => message.details.identity), ["typescript.md"]);
	assert.match(harness.notifications.at(-1)?.message ?? "", /discovered 1/);
});

test("expands tilde read paths using the configured home directory", async () => {
	const homeDir = mkdtempSync(join(tmpdir(), "pi-rules-home-"));
	const rulesDir = join(homeDir, ".pi", "agent", "rules");
	mkdirSync(rulesDir, { recursive: true });
	writeFileSync(join(rulesDir, "notes.md"), "---\npaths: notes/*.md\n---\nKeep notes private.");

	const harness = createHarness(homeDir);
	registerPiRules(harness.api, { homeDir, platform: "darwin" });
	await dispatch(harness, "session_start", { type: "session_start", reason: "startup" });
	await dispatch(harness, "tool_result", { type: "tool_result", toolName: "read", input: { path: "~/notes/today.md" }, isError: false });
	await dispatch(harness, "turn_end", { type: "turn_end" });

	assert.deepEqual(harness.messages.map((message) => message.details.identity), ["notes.md"]);
});

test("uses Pi project trust state without a second Rules prompt", async () => {
	const homeDir = mkdtempSync(join(tmpdir(), "pi-rules-home-"));
	const cwd = join(homeDir, "project");
	const rulesDir = join(cwd, ".pi", "rules");
	mkdirSync(rulesDir, { recursive: true });
	writeFileSync(join(rulesDir, "project.md"), "Project instructions.");

	const harness = createHarness(cwd, { trusted: false, confirmTrust: false });
	registerPiRules(harness.api, { homeDir, platform: "darwin" });
	await dispatch(harness, "session_start", { type: "session_start", reason: "startup" });

	assert.equal(harness.messages.length, 0);
	assert.equal(harness.confirmations, 0);
});

test("refreshes project Rules when trust is granted without a reload", async () => {
	const homeDir = mkdtempSync(join(tmpdir(), "pi-rules-home-"));
	const cwd = join(homeDir, "project");
	const rulesDir = join(cwd, ".pi", "rules");
	mkdirSync(rulesDir, { recursive: true });
	writeFileSync(join(rulesDir, "source.md"), "---\npaths: src/*.ts\n---\nProject source guidance.");

	const trust = { trusted: false };
	const harness = createHarness(cwd, trust);
	registerPiRules(harness.api, { homeDir, platform: "darwin" });
	await dispatch(harness, "session_start", { type: "session_start", reason: "startup" });
	trust.trusted = true;
	await dispatch(harness, "tool_result", { type: "tool_result", toolName: "read", input: { path: "src/file.ts" }, isError: false });
	await dispatch(harness, "turn_end", { type: "turn_end" });

	assert.deepEqual(harness.messages.map((message) => message.details.identity), ["source.md"]);
});

test("keeps model globs provider-aware and case-sensitive", async () => {
	const homeDir = mkdtempSync(join(tmpdir(), "pi-rules-home-"));
	const rulesDir = join(homeDir, ".pi", "agent", "rules");
	mkdirSync(rulesDir, { recursive: true });
	writeFileSync(join(rulesDir, "single.md"), "---\nmodels: openai/*\n---\nSingle separator.");
	writeFileSync(join(rulesDir, "double.md"), "---\nmodels: openai/**\n---\nProvider family.");
	writeFileSync(join(rulesDir, "case.md"), "---\nmodels: openai/GPT-*\n---\nCase-sensitive.");

	const harness = createHarness(homeDir, { model: { provider: "openai", id: "gpt/5" } });
	registerPiRules(harness.api, { homeDir, platform: "darwin" });
	await dispatch(harness, "session_start", { type: "session_start", reason: "startup" });
	assert.equal(harness.messages.length, 0);
	await dispatch(harness, "before_agent_start", { type: "before_agent_start", prompt: "hello" });
	assert.deepEqual(harness.messages.map((message) => message.details.identity), ["double.md"]);

	await dispatch(harness, "model_select", { model: { provider: "openai", id: "gpt-5" } });
	assert.deepEqual(harness.messages.map((message) => message.details.identity), ["double.md"]);
	await dispatch(harness, "before_agent_start", { type: "before_agent_start", prompt: "continue" });
	assert.deepEqual(harness.messages.map((message) => message.details.identity), ["double.md", "single.md"]);
});

test("persists path activation during the current streaming turn", async () => {
	const homeDir = mkdtempSync(join(tmpdir(), "pi-rules-home-"));
	const cwd = join(homeDir, "project");
	const rulesDir = join(cwd, ".pi", "rules");
	mkdirSync(rulesDir, { recursive: true });
	writeFileSync(join(rulesDir, "source.md"), "---\npaths: '*.ts'\n---\nStreaming-safe guidance.");

	const harness = createHarness(cwd, { trusted: true });
	registerPiRules(harness.api, { homeDir, platform: "darwin" });
	await dispatch(harness, "session_start", { type: "session_start", reason: "startup" });
	await dispatch(harness, "tool_result", { type: "tool_result", toolName: "read", input: { path: "file.ts" }, isError: false });
	assert.equal(harness.messages.length, 0);
	assert.equal(harness.entries.length, 0);
	await dispatch(harness, "turn_end", { type: "turn_end" });

	assert.equal(harness.messages.length, 1);
	assert.equal(harness.entries.at(-1)?.type, "custom_message");
	assert.deepEqual(harness.sendOptions, [{ deliverAs: "steer" }]);
});

test("reconsiders unconditional Rules for a fork session start", async () => {
	const homeDir = mkdtempSync(join(tmpdir(), "pi-rules-home-"));
	const rulesDir = join(homeDir, ".pi", "agent", "rules");
	mkdirSync(rulesDir, { recursive: true });
	writeFileSync(join(rulesDir, "always.md"), "Always load this Rule.");

	const harness = createHarness(homeDir);
	registerPiRules(harness.api, { homeDir, platform: "darwin" });
	await dispatch(harness, "session_start", { type: "session_start", reason: "startup" });
	harness.entries.splice(0, harness.entries.length);
	await dispatch(harness, "session_start", { type: "session_start", reason: "fork" });

	assert.equal(harness.messages.length, 0);
	await dispatch(harness, "before_agent_start", { type: "before_agent_start", prompt: "hello" });
	assert.equal(harness.messages.length, 1);
});
