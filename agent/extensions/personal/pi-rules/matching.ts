import ignore from "ignore";
import { parse as parseYaml } from "yaml";

export interface RuleConditions {
	paths?: string[];
	os?: string[];
	models?: string[];
}

export interface RuleSource {
	kind: "project-pi" | "project-claude" | "user-pi" | "user-claude";
	root: string;
	baseDir: string;
}

export interface Rule {
	absolutePath: string;
	identity: string;
	body: string;
	conditions: RuleConditions;
	source: RuleSource;
}

export interface RuleMatchContext {
	os: string;
	model?: string;
	targetPath?: string;
}

export interface ParsedRuleContent {
	conditions: RuleConditions;
	body: string;
}

interface IgnoreManager {
	add(patterns: string | readonly string[]): IgnoreManager;
	ignores(path: string): boolean;
}

type IgnoreFactory = (options?: { ignorecase?: boolean }) => IgnoreManager;
type ParseYaml = (source: string) => unknown;

const MAX_BRACE_EXPANSIONS = 100;
const OS_ALIASES: Record<string, string> = {
	win32: "windows",
	windows: "windows",
	darwin: "macos",
	macos: "macos",
	linux: "linux",
	android: "android",
	freebsd: "freebsd",
	openbsd: "openbsd",
	aix: "aix",
	sunos: "sunos",
};

const CANONICAL_OS = new Set(["windows", "macos", "linux", "android", "freebsd", "openbsd", "aix", "sunos"]);

const ignoreFactory: IgnoreFactory = (options) => ignore(options);
function yamlParser(): ParseYaml {
	return parseYaml as ParseYaml;
}

function parseFrontmatter(source: string): { metadata: Record<string, unknown>; body: string } | undefined {
	const normalized = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
	const lines = normalized.split("\n");
	if (lines[0] !== "---") return { metadata: {}, body: normalized };

	const closingIndex = lines.findIndex((line, index) => index > 0 && /^(?:---|\.\.\.)\s*$/.test(line));
	if (closingIndex < 0) return undefined;

	const yamlSource = lines.slice(1, closingIndex).join("\n");
	let parsed: unknown;
	try {
		parsed = yamlSource.trim() ? yamlParser()(yamlSource) : {};
	} catch {
		return undefined;
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
	return { metadata: parsed as Record<string, unknown>, body: lines.slice(closingIndex + 1).join("\n") };
}

function stripBlockComments(body: string): string {
	const lines = body.split("\n");
	const kept: string[] = [];
	let fence: string | undefined;
	let inComment = false;

	for (const line of lines) {
		const trimmed = line.trim();
		if (/^(?:```|~~~)/.test(trimmed)) {
			if (!inComment) {
				if (!fence) fence = trimmed.slice(0, 3);
				else if (trimmed.startsWith(fence)) fence = undefined;
			}
			kept.push(line);
			continue;
		}
		if (fence) {
			kept.push(line);
			continue;
		}
		if (inComment) {
			if (trimmed.includes("-->") && !trimmed.slice(trimmed.indexOf("-->") + 3).trim()) inComment = false;
			continue;
		}
		if (/^(?: {4,}|\t)/.test(line)) {
			kept.push(line);
			continue;
		}
		if (trimmed.startsWith("<!--") && trimmed.endsWith("-->") && trimmed.length >= 7) continue;
		if (trimmed.startsWith("<!--") && !trimmed.includes("-->")) {
			inComment = true;
			continue;
		}
		kept.push(line);
	}
	return kept.join("\n").trim();
}

function conditionValues(metadata: Record<string, unknown>, key: keyof RuleConditions): string[] | undefined {
	if (!Object.hasOwn(metadata, key)) return undefined;
	const value = metadata[key];
	if (typeof value === "string") {
		const trimmed = value.trim();
		return trimmed ? [trimmed] : undefined;
	}
	if (Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item.trim())) {
		return value.map((item) => (item as string).trim());
	}
	return undefined;
}

function hasUnmatchedBracket(pattern: string): boolean {
	let escaped = false;
	let open = false;
	for (const char of pattern) {
		if (escaped) {
			escaped = false;
			continue;
		}
		if (char === "\\") escaped = true;
		else if (char === "[") open = true;
		else if (char === "]") {
			if (!open) return true;
			open = false;
		}
	}
	return escaped || open;
}

function findBrace(pattern: string): { start: number; end: number } | undefined {
	let start = -1;
	let depth = 0;
	for (let index = 0; index < pattern.length; index++) {
		if (pattern[index] === "\\") {
			index++;
			continue;
		}
		if (pattern[index] === "{") {
			if (start < 0) start = index;
			depth++;
		} else if (pattern[index] === "}" && start >= 0) {
			depth--;
			if (depth === 0) return { start, end: index };
		}
	}
	return start < 0 ? undefined : { start, end: -1 };
}

function splitBraceAlternatives(value: string): string[] | undefined {
	const parts: string[] = [];
	let start = 0;
	let depth = 0;
	for (let index = 0; index < value.length; index++) {
		if (value[index] === "\\") {
			index++;
			continue;
		}
		if (value[index] === "{") depth++;
		else if (value[index] === "}") depth--;
		else if (value[index] === "," && depth === 0) {
			parts.push(value.slice(start, index));
			start = index + 1;
		}
	}
	parts.push(value.slice(start));
	return parts.length >= 2 && parts.every(Boolean) ? parts : undefined;
}

export function expandBracePattern(pattern: string): string[] | undefined {
	const result: string[] = [pattern];
	for (let index = 0; index < result.length; index++) {
		const brace = findBrace(result[index]!);
		if (!brace) continue;
		if (brace.end < 0) return undefined;
		const alternatives = splitBraceAlternatives(result[index]!.slice(brace.start + 1, brace.end));
		if (!alternatives) return undefined;
		const expanded = alternatives.map(
			(alternative) => result[index]!.slice(0, brace.start) + alternative + result[index]!.slice(brace.end + 1),
		);
		result.splice(index, 1, ...expanded);
		if (result.length > MAX_BRACE_EXPANSIONS) return undefined;
		index--;
	}
	return result;
}

function normalizePathPattern(pattern: string): string {
	const normalized = pattern.replaceAll("\\", "/");
	if (!normalized.endsWith("/**")) return normalized;
	const base = normalized.slice(0, -3).replace(/\/$/, "");
	if (!base) return "**";
	return base.includes("/") || base.startsWith("/") || base === "**" ? base : `/${base}`;
}

function validGlob(pattern: string): boolean {
	const negative = pattern.startsWith("!");
	const value = normalizePathPattern(negative ? pattern.slice(1) : pattern);
	if (!value || value.includes("\0") || /[\r\n]/.test(value) || value.split("/").some((part) => part === "..")) return false;
	if (hasUnmatchedBracket(value)) return false;
	try {
		ignoreFactory({ ignorecase: true }).add(`${negative ? "!" : ""}${value}`);
		return true;
	} catch {
		return false;
	}
}

function modelPatternRegex(pattern: string): RegExp | undefined {
	let source = "";
	for (let index = 0; index < pattern.length; index++) {
		const char = pattern[index]!;
		if (char === "*" && pattern[index + 1] === "*") {
			if (pattern[index + 2] === "/") {
				source += "(?:.*/)?";
				index += 2;
			} else {
				source += ".*";
				index++;
			}
		} else if (char === "*") source += "[^/]*";
		else if (char === "?") source += "[^/]";
		else if (char === "[") {
			const end = pattern.indexOf("]", index + 1);
			if (end < 0 || end === index + 1) return undefined;
			let classValue = pattern.slice(index + 1, end);
			if (classValue.startsWith("!")) classValue = `^${classValue.slice(1)}`;
			source += `[${classValue}]`;
			index = end;
		} else {
			source += char.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
		}
	}
	try {
		return new RegExp(`^${source}$`);
	} catch {
		return undefined;
	}
}

function canonicalPathTarget(targetPath: string): string | undefined {
	const target = targetPath.replaceAll("\\", "/").replace(/^\.\//, "");
	if (!target || target.startsWith("/") || target.split("/").includes("..")) return undefined;
	return target;
}

function matchPathConditions(patterns: string[], targetPath: string): boolean {
	const target = canonicalPathTarget(targetPath);
	if (!target) return false;
	const normalizedPatterns: string[] = [];
	for (const original of patterns) {
		const negative = original.startsWith("!");
		const expanded = expandBracePattern(negative ? original.slice(1) : original) ?? [];
		for (const pattern of expanded) normalizedPatterns.push(`${negative ? "!" : ""}${normalizePathPattern(pattern)}`);
	}
	try {
		return ignoreFactory({ ignorecase: true }).add(normalizedPatterns).ignores(target);
	} catch {
		return false;
	}
}

export function canonicalOs(platform: string, environment: Record<string, string | undefined> = process.env): string {
	if (environment.WSL_DISTRO_NAME || environment.WSL_INTEROP) return "linux";
	return OS_ALIASES[platform.toLowerCase()] ?? platform.toLowerCase();
}

export function canonicalModel(provider: unknown, id: unknown): string | undefined {
	return typeof provider === "string" && typeof id === "string" && provider && id ? `${provider}/${id}` : undefined;
}

export function matchesRule(rule: Rule, context: RuleMatchContext): boolean {
	const { conditions } = rule;
	if (conditions.os && !conditions.os.some((value) => canonicalOs(value, {}) === context.os)) return false;
	if (conditions.models && (!context.model || !conditions.models.some((pattern) => modelPatternRegex(pattern)?.test(context.model!)))) {
		return false;
	}
	if (conditions.paths && (!context.targetPath || !matchPathConditions(conditions.paths, context.targetPath))) return false;
	return true;
}

export function parseRuleContent(source: string): ParsedRuleContent | { error: string } {
	const parsed = parseFrontmatter(source);
	if (!parsed) return { error: "invalid YAML frontmatter" };

	const conditions: RuleConditions = {};
	for (const key of ["paths", "os", "models"] as const) {
		const values = conditionValues(parsed.metadata, key);
		if (Object.hasOwn(parsed.metadata, key) && !values) return { error: `invalid ${key} condition` };
		if (values) conditions[key] = values;
	}

	if (conditions.paths) {
		for (const pattern of conditions.paths) {
			const expanded = expandBracePattern(pattern);
			if (!expanded || expanded.some((candidate) => !validGlob(candidate))) return { error: `invalid path glob: ${pattern}` };
		}
	}
	if (conditions.models) {
		for (const pattern of conditions.models) {
			if (!pattern || pattern.startsWith("!") || pattern.includes("\0") || hasUnmatchedBracket(pattern) || !modelPatternRegex(pattern)) {
				return { error: `invalid model glob: ${pattern}` };
			}
		}
	}
	if (conditions.os) {
		for (const value of conditions.os) {
			if (!value || value.includes("/") || value.includes("\\") || !CANONICAL_OS.has(canonicalOs(value, {}))) return { error: `invalid os condition: ${value}` };
		}
	}

	const body = stripBlockComments(parsed.body);
	if (!body) return { error: "empty Rule body" };
	return { conditions, body };
}

export function matchesPath(rule: Rule, targetPath: string): boolean {
	return Boolean(rule.conditions.paths && matchPathConditions(rule.conditions.paths, targetPath));
}
