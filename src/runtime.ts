import { existsSync, realpathSync } from "node:fs";
import { normalize, relative, resolve } from "node:path";
import type { ScopedRulesConfig, Rule, RuntimeState, ToolMutationSpec } from "./types.js";
import { matchesAnyGlob } from "./glob.js";

function extractStringValues(value: unknown): string[] {
	if (typeof value === "string") {
		return [value];
	}
	if (Array.isArray(value)) {
		return value.filter((item): item is string => typeof item === "string");
	}
	return [];
}

function isPathInsideCwd(relativePath: string): boolean {
	return relativePath.length > 0 && relativePath !== ".." && !relativePath.startsWith("../") && !relativePath.startsWith("..\\");
}

function normalizePath(filePath: string, cwd: string): string {
	const trimmed = filePath.trim().replace(/^@/, "");
	if (trimmed.length === 0) {
		return "";
	}

	const resolvedPath = resolve(cwd, trimmed);
	const canonicalPath = existsSync(resolvedPath) ? realpathSync(resolvedPath) : normalize(resolvedPath);
	const relativePath = relative(cwd, canonicalPath).replace(/\\/g, "/").replace(/^\.\//, "");
	if (isPathInsideCwd(relativePath)) {
		return relativePath;
	}

	return canonicalPath.replace(/\\/g, "/");
}

function findMutationSpec(toolName: string, config: ScopedRulesConfig): ToolMutationSpec | undefined {
	return config.mutatingTools.find((spec) => spec.toolName === toolName);
}

export function extractMutationPaths(
	toolName: string,
	input: Record<string, unknown>,
	config: ScopedRulesConfig,
	cwd: string,
): string[] {
	const spec = findMutationSpec(toolName, config);
	if (!spec) {
		return [];
	}

	const paths = spec.pathFields.flatMap((field) => extractStringValues(input[field])).map((path) => normalizePath(path, cwd));
	return [...new Set(paths.filter((path) => path.length > 0))].sort();
}

export function getAlwaysOnRules(rules: Rule[]): Rule[] {
	return rules.filter((rule) => rule.trigger === "always_on");
}

export function getGlobRules(rules: Rule[]): Rule[] {
	return rules.filter((rule) => rule.trigger === "glob");
}

export function getModelDecisionRules(rules: Rule[]): Rule[] {
	return rules.filter((rule) => rule.trigger === "model_decision");
}

export function getMatchingScopedRules(filePath: string, rules: Rule[]): Rule[] {
	return rules.filter((rule) => rule.trigger === "glob" && matchesAnyGlob(filePath, rule.globs));
}

export function getArmedScopedRules(state: RuntimeState): Rule[] {
	return state.rules.filter((rule) => rule.trigger === "glob" && state.armedScopes.has(rule.scope));
}

export function getPendingScopedRules(state: RuntimeState): Rule[] {
	return state.rules.filter((rule) => rule.trigger === "glob" && state.pendingScopes.has(rule.scope));
}

export function getMissingScopesForPaths(paths: string[], rules: Rule[], armedScopes: Set<string>): string[] {
	const missing = new Set<string>();
	for (const filePath of paths) {
		for (const rule of getMatchingScopedRules(filePath, rules)) {
			if (!armedScopes.has(rule.scope)) {
				missing.add(rule.scope);
			}
		}
	}
	return [...missing].sort();
}

export function getMatchingScopesForPaths(paths: string[], rules: Rule[]): string[] {
	const scopes = new Set<string>();
	for (const filePath of paths) {
		for (const rule of getMatchingScopedRules(filePath, rules)) {
			scopes.add(rule.scope);
		}
	}
	return [...scopes].sort();
}

function pathExists(filePath: string, cwd: string): boolean {
	const resolvedPath = filePath.startsWith("/") ? filePath : resolve(cwd, filePath);
	return existsSync(resolvedPath);
}

export function getUnreadScopedPaths(
	paths: string[],
	rules: Rule[],
	readPaths: Set<string>,
	cwd: string,
): string[] {
	return paths
		.filter((filePath) => getMatchingScopedRules(filePath, rules).length > 0)
		.filter((filePath) => pathExists(filePath, cwd))
		.filter((filePath) => !readPaths.has(filePath))
		.sort();
}

export function queuePendingScopes(state: RuntimeState, scopes: string[]): void {
	for (const scope of scopes) {
		state.pendingScopes.add(scope);
	}
}

export function armScopes(state: RuntimeState, scopes: string[]): void {
	for (const scope of scopes) {
		state.armedScopes.add(scope);
		state.pendingScopes.add(scope);
	}
}

export function getInactiveMatchingScopesForPaths(paths: string[], rules: Rule[], armedScopes: Set<string>): string[] {
	const matchingScopes = new Set<string>();
	for (const filePath of paths) {
		for (const rule of getMatchingScopedRules(filePath, rules)) {
			matchingScopes.add(rule.scope);
		}
	}
	return [...matchingScopes].filter((scope) => !armedScopes.has(scope)).sort();
}

export function clearPendingScopes(state: RuntimeState): void {
	state.pendingScopes.clear();
}

export function rememberReadPaths(state: RuntimeState, paths: string[]): void {
	for (const path of paths) {
		state.readPaths.add(path);
	}
}

export function clearArmedScopes(state: RuntimeState): void {
	state.armedScopes.clear();
	state.pendingScopes.clear();
	state.readPaths.clear();
	state.lastBlockedPath = undefined;
	state.lastBlockedScopes = undefined;
	state.lastBlockedUnreadPaths = undefined;
	state.lastActivatedPath = undefined;
	state.lastActivatedScopes = undefined;
}
