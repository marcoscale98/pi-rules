import { homedir } from "node:os";
import { relative, resolve } from "node:path";
import { isReadToolResult, type ExtensionAPI, type ExtensionContext, type MessageRenderOptions, type Theme } from "@earendil-works/pi-coding-agent";
import { loadRules, type DiscoveryResult } from "./discovery.ts";
import { canonicalModel, canonicalOs, matchesRule, type Rule } from "./matching.ts";


export interface PiRulesOptions {
	homeDir?: string;
	platform?: string;
	environment?: Record<string, string | undefined>;
	agentDir?: string;
}

const CUSTOM_MESSAGE_TYPE = "pi-rules";

function modelName(model: ExtensionContext["model"]): string | undefined {
	return canonicalModel(model?.provider, model?.id);
}

function targetPath(cwd: string, value: string, homeDir: string): string {
	const normalized = value.replaceAll("\\", "/");
	const withoutAt = normalized.startsWith("@") ? normalized.slice(1) : normalized;
	if (withoutAt === "~") return resolve(homeDir);
	if (withoutAt.startsWith("~/")) return resolve(homeDir, withoutAt.slice(2));
	return resolve(cwd, withoutAt);
}

function relativeRuleTarget(rule: Rule, target: string, cwd: string): string | undefined {
	const base = rule.source.baseDir || cwd;
	const value = relative(base, target).replaceAll("\\", "/");
	if (value === ".." || value.startsWith("../") || value.startsWith("/")) return undefined;
	return value;
}

function relativeDisplayPath(cwd: string, absolutePath: string): string {
	const displayed = relative(cwd, absolutePath).replaceAll("\\", "/");
	return displayed || absolutePath.replaceAll("\\", "/");
}

function messageContent(rule: Rule): string {
	return `<system-reminder>\nContents of ${rule.absolutePath}:\n\n${rule.body}\n</system-reminder>`;
}

function relativeMessagePath(details: unknown): string {
	if (!details || typeof details !== "object" || !("relativePath" in details)) return "";
	return typeof details.relativePath === "string" ? details.relativePath : "";
}

function rendererFor(
	message: { details?: unknown },
	options: MessageRenderOptions,
	theme: Theme,
): { render(width: number): string[]; invalidate(): void } {
	const relativePath = relativeMessagePath(message.details);
	const text = `Loaded ${relativePath}`;
	return {
		render(width: number): string[] {
			const available = Math.max(0, width - options.outputPad);
			const visible = text.length > available ? text.slice(0, available) : text;
			return [theme.fg("accent", theme.bold(visible))];
		},
		invalidate() {},
	};
}

function summary(result: DiscoveryResult, activated: number): string {
	return `Pi Rules: discovered ${result.discovered}, activated ${activated}, rejected ${result.rejected.length}`;
}

function projectRulesTrusted(ctx: ExtensionContext): boolean {
	return ctx.isProjectTrusted();
}


export default function registerPiRules(pi: ExtensionAPI, options: PiRulesOptions = {}): void {
	let catalog: Rule[] = [];
	let pending = new Map<string, Rule>();
	let lastTrusted: boolean | undefined;
	let pendingMessages = new Set<string>();
	let lastDiscovery: DiscoveryResult | undefined;
	const platform = options.platform ?? process.platform;
	const environment = options.environment ?? process.env;
	pi.registerMessageRenderer(CUSTOM_MESSAGE_TYPE, (message, renderOptions, theme) =>
		rendererFor(message, renderOptions, theme),
	);


	function notify(ctx: ExtensionContext, message: string, type: "info" | "warning" | "error" = "info"): void {
		if (ctx.hasUI) ctx.ui.notify(message, type);
		else if (type === "warning") console.warn(message);
	}

	function activeRuleIdentities(ctx: ExtensionContext): Set<string> {
		const branch = ctx.sessionManager.getBranch();
		let boundary = -1;
		for (let index = branch.length - 1; index >= 0; index--) {
			if (branch[index]?.type === "compaction") {
				boundary = index;
				break;
			}
		}
		const identities = new Set<string>();
		for (const entry of branch.slice(boundary + 1)) {
			if (entry.type !== "custom_message" || entry.customType !== CUSTOM_MESSAGE_TYPE) continue;
			const details = entry.details;
			if (details && typeof details === "object" && "identity" in details && typeof details.identity === "string") {
				identities.add(details.identity);
			}
		}
		for (const identity of pendingMessages) {
			if (identities.has(identity)) pendingMessages.delete(identity);
		}
		return identities;
	}

	function appendRule(rule: Rule, ctx: ExtensionContext, identities: Set<string>): boolean {
		if (identities.has(rule.identity) || pendingMessages.has(rule.identity)) return false;
		pi.sendMessage({
			customType: CUSTOM_MESSAGE_TYPE,
			content: messageContent(rule),
			display: true,
			details: {
				identity: rule.identity,
				absolutePath: rule.absolutePath,
				relativePath: relativeDisplayPath(ctx.cwd, rule.absolutePath),
			},
		}, ctx.isIdle() ? { triggerTurn: false } : { deliverAs: "steer" });
		pendingMessages.add(rule.identity);
		return true;
	}

	function contextFor(ctx: ExtensionContext, model = ctx.model, target?: string) {
		return {
			os: canonicalOs(platform, environment),
			model: modelName(model),
			targetPath: target,
		};
	}

	function activateUnscoped(ctx: ExtensionContext, model = ctx.model): number {
		const identities = activeRuleIdentities(ctx);
		let activated = 0;
		for (const rule of catalog) {
			if (rule.conditions.paths) continue;
			if (matchesRule(rule, contextFor(ctx, model)) && appendRule(rule, ctx, identities)) activated++;
		}
		return activated;
	}

	function flushPending(ctx: ExtensionContext): number {
		const candidates = [...pending.values()];
		pending = new Map();
		const identities = activeRuleIdentities(ctx);
		const order = new Map(catalog.map((rule, index) => [rule.identity, index]));
		candidates.sort((left, right) => {
			const byCatalog = (order.get(left.identity) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.identity) ?? Number.MAX_SAFE_INTEGER);
			if (byCatalog !== 0) return byCatalog;
			return left.identity < right.identity ? -1 : left.identity > right.identity ? 1 : 0;
		});
		let activated = 0;
		for (const rule of candidates) {
			if (appendRule(rule, ctx, identities)) activated++;
		}
		return activated;
	}

	async function discover(ctx: ExtensionContext, showSummary: boolean): Promise<number> {
		const trusted = projectRulesTrusted(ctx);
		lastTrusted = trusted;
		lastDiscovery = loadRules({
			cwd: ctx.cwd,
			homeDir: options.homeDir,
			trusted,
			piAgentDir: options.agentDir ?? (options.homeDir === undefined ? environment.PI_CODING_AGENT_DIR : undefined),
		});
		catalog = lastDiscovery.rules;
		for (const warning of lastDiscovery.rejected) {
			notify(ctx, `Pi Rule skipped (${warning.path}): ${warning.message}`, "warning");
		}
		const activated = activateUnscoped(ctx);
		if (showSummary) notify(ctx, summary(lastDiscovery, activeRuleIdentities(ctx).size));
		return activated;
	}

	async function ensureCatalog(ctx: ExtensionContext): Promise<void> {
		const trusted = projectRulesTrusted(ctx);
		if (!lastDiscovery || lastTrusted !== trusted) await discover(ctx, false);
	}

	pi.on("session_start", async (event, ctx) => {
		pending = new Map();
		pendingMessages.clear();
		await discover(ctx, event.reason === "startup" || event.reason === "reload");
	});

	pi.on("model_select", async (event, ctx) => {
		await ensureCatalog(ctx);
		const identities = activeRuleIdentities(ctx);
		for (const rule of catalog) {
			if (!rule.conditions.paths && matchesRule(rule, contextFor(ctx, event.model)) && appendRule(rule, ctx, identities)) {
				// appendRule performs branch-derived deduplication.
			}
		}
	});

	pi.on("session_compact", async (_event, ctx) => {
		pendingMessages.clear();
		pending = new Map();
		await ensureCatalog(ctx);
		activateUnscoped(ctx);
	});

	pi.on("session_tree", async (_event, ctx) => {
		pendingMessages.clear();
		pending = new Map();
		await ensureCatalog(ctx);
		activateUnscoped(ctx);
	});

	pi.on("tool_result", async (event, ctx) => {
		if (!isReadToolResult(event) || event.isError || typeof event.input.path !== "string") return;
		await ensureCatalog(ctx);
		const homeDir = resolve(options.homeDir ?? homedir());
		const target = targetPath(ctx.cwd, event.input.path, homeDir);
		const identities = activeRuleIdentities(ctx);
		for (const rule of catalog) {
			const relativeTarget = relativeRuleTarget(rule, target, ctx.cwd);
			if (rule.conditions.paths && relativeTarget && matchesRule(rule, contextFor(ctx, ctx.model, relativeTarget)) && !identities.has(rule.identity) && !pendingMessages.has(rule.identity)) {
				pending.set(rule.identity, rule);
			}
		}
	});

	pi.on("turn_end", async (_event, ctx) => {
		flushPending(ctx);
	});
}
