import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { parseRuleContent, type Rule, type RuleSource } from "./matching.ts";

export interface DiscoveryOptions {
	cwd: string;
	homeDir?: string;
	trusted: boolean;
	piAgentDir?: string;
}

export interface RuleWarning {
	path: string;
	message: string;
}

export interface DiscoveryResult {
	rules: Rule[];
	discovered: number;
	rejected: RuleWarning[];
}

interface RuleFile {
	absolutePath: string;
	identity: string;
	source: RuleSource;
}

function normalizeRelative(value: string): string {
	return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

function markdownFiles(root: string): string[] {
	if (!existsSync(root)) return [];
	const files: string[] = [];

	function walk(directory: string, basePath: string, ancestors: ReadonlySet<string> = new Set()): void {
		let realDirectory: string;
		try {
			realDirectory = statSync(directory).isDirectory() ? directory : "";
		} catch {
			return;
		}
		if (!realDirectory) return;
		try {
			realDirectory = requireRealPath(directory);
		} catch {
			realDirectory = resolve(directory);
		}
		if (ancestors.has(realDirectory)) return;
		const nextAncestors = new Set(ancestors);
		nextAncestors.add(realDirectory);

		let entries;
		try {
			entries = readdirSync(directory, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const absolutePath = join(directory, entry.name);
			const entryRelative = basePath ? `${basePath}/${entry.name}` : entry.name;
			let stats;
			try {
				stats = statSync(absolutePath);
			} catch {
				continue;
			}
			if (stats.isDirectory()) {
				walk(absolutePath, entryRelative, nextAncestors);
			} else if (stats.isFile() && entry.name.toLowerCase().endsWith(".md")) {
				files.push(absolutePath);
			}
		}
	}

	walk(root, "");
	return files.sort((left, right) => {
		const leftRelative = normalizeRelative(relative(root, left));
		const rightRelative = normalizeRelative(relative(root, right));
		return leftRelative < rightRelative ? -1 : leftRelative > rightRelative ? 1 : 0;
	});
}

function requireRealPath(value: string): string {
	return realpathSync(value);
}

function projectSources(cwd: string, excludedRoots: ReadonlySet<string> = new Set()): RuleSource[] {
	const sources: RuleSource[] = [];
	let current = resolve(cwd);
	while (true) {
		for (const source of [
			{ kind: "project-pi" as const, root: join(current, CONFIG_DIR_NAME, "rules"), baseDir: current },
			{ kind: "project-claude" as const, root: join(current, ".claude", "rules"), baseDir: current },
		]) {
			if (!excludedRoots.has(resolve(source.root))) sources.push(source);
		}
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return sources;
}

function userSources(homeDir: string, piAgentDir?: string): RuleSource[] {
	const configuredAgentDir = piAgentDir?.replace(/^~(?=$|[\\/])/, homeDir);
	const agentDir = resolve(configuredAgentDir ?? join(homeDir, CONFIG_DIR_NAME, "agent"));
	return [
		{ kind: "user-pi", root: join(agentDir, "rules"), baseDir: "" },
		{ kind: "user-claude", root: join(homeDir, ".claude", "rules"), baseDir: "" },
	];
}

function discoverFiles(options: DiscoveryOptions): { files: RuleFile[]; discovered: number } {
	const users = userSources(resolve(options.homeDir ?? homedir()), options.piAgentDir);
	const userRoots = new Set(users.map((source) => resolve(source.root)));
	const sources = [
		...(options.trusted ? projectSources(options.cwd, userRoots) : []),
		...users,
	];
	const files: RuleFile[] = [];
	const claimedIdentities = new Set<string>();
	let discovered = 0;

	for (const source of sources) {
		const sourceFiles = markdownFiles(source.root);
		discovered += sourceFiles.length;
		const sourceRoot = resolve(source.root);
		for (const absolutePath of sourceFiles) {
			const identity = normalizeRelative(relative(sourceRoot, absolutePath));
			if (claimedIdentities.has(identity)) continue;
			claimedIdentities.add(identity);
			files.push({ absolutePath: resolve(absolutePath), identity, source });
		}
	}
	return { files, discovered };
}

export function loadRules(options: DiscoveryOptions): DiscoveryResult {
	const discovered = discoverFiles(options);
	const rules: Rule[] = [];
	const rejected: RuleWarning[] = [];

	for (const file of discovered.files) {
		let source: string;
		try {
			source = readFileSync(file.absolutePath, "utf8");
		} catch (error) {
			rejected.push({ path: file.absolutePath, message: error instanceof Error ? error.message : String(error) });
			continue;
		}
		const parsed = parseRuleContent(source);
		if ("error" in parsed) {
			rejected.push({ path: file.absolutePath, message: parsed.error });
			continue;
		}
		rules.push({
			absolutePath: file.absolutePath,
			identity: file.identity,
			body: parsed.body,
			conditions: parsed.conditions,
			source: file.source,
		});
	}

	return { rules, discovered: discovered.discovered, rejected };
}
