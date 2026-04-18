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

function normalizePath(filePath: string): string {
	return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

function findMutationSpec(toolName: string, config: ScopedRulesConfig): ToolMutationSpec | undefined {
	return config.mutatingTools.find((spec) => spec.toolName === toolName);
}

export function extractMutationPaths(
	toolName: string,
	input: Record<string, unknown>,
	config: ScopedRulesConfig,
): string[] {
	const spec = findMutationSpec(toolName, config);
	if (!spec) {
		return [];
	}

	const paths = spec.pathFields.flatMap((field) => extractStringValues(input[field])).map(normalizePath);
	return [...new Set(paths.filter((path) => path.length > 0))].sort();
}

export function getAlwaysOnRules(rules: Rule[]): Rule[] {
	return rules.filter((rule) => rule.trigger === "always_on");
}

export function getModelDecisionRules(rules: Rule[]): Rule[] {
	return rules.filter((rule) => rule.trigger === "model_decision");
}

export function getMatchingScopedRules(filePath: string, rules: Rule[]): Rule[] {
	return rules.filter((rule) => rule.trigger === "glob" && matchesAnyGlob(filePath, rule.globs));
}

export function getActiveScopedRules(state: RuntimeState): Rule[] {
	return state.rules.filter((rule) => rule.trigger === "glob" && state.activeScopes.has(rule.scope));
}

export function getMissingScopesForPaths(paths: string[], rules: Rule[], activeScopes: Set<string>): string[] {
	const missing = new Set<string>();
	for (const filePath of paths) {
		for (const rule of getMatchingScopedRules(filePath, rules)) {
			if (!activeScopes.has(rule.scope)) {
				missing.add(rule.scope);
			}
		}
	}
	return [...missing].sort();
}

export function activateScopes(state: RuntimeState, scopes: string[]): void {
	for (const scope of scopes) {
		state.activeScopes.add(scope);
	}
}

export function clearActiveScopes(state: RuntimeState): void {
	state.activeScopes.clear();
	state.lastBlockedPath = undefined;
	state.lastBlockedScopes = undefined;
}
