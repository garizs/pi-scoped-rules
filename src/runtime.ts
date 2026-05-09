import { existsSync, realpathSync } from "node:fs";
import { normalize, relative, resolve } from "node:path";
import type { ScopedMutationGateResult, ScopedRulesConfig, Rule, RuntimeState, ToolMutationSpec } from "./types.js";
import { matchesAnyGlob } from "./glob.js";

const ACTIVE_INTENT_REINJECTIONS = 1;

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

function normalizeLexicalPath(filePath: string, cwd: string): string {
	const trimmed = filePath.trim().replace(/^@/, "");
	if (trimmed.length === 0) {
		return "";
	}

	const resolvedPath = normalize(resolve(cwd, trimmed));
	const relativePath = relative(cwd, resolvedPath).replace(/\\/g, "/").replace(/^\.\//, "");
	if (isPathInsideCwd(relativePath)) {
		return relativePath;
	}

	return resolvedPath.replace(/\\/g, "/");
}

function normalizeCanonicalPath(filePath: string, cwd: string): string | undefined {
	const trimmed = filePath.trim().replace(/^@/, "");
	if (trimmed.length === 0) {
		return undefined;
	}

	const resolvedPath = resolve(cwd, trimmed);
	if (!existsSync(resolvedPath)) {
		return undefined;
	}

	const canonicalPath = realpathSync(resolvedPath);
	const relativePath = relative(cwd, canonicalPath).replace(/\\/g, "/").replace(/^\.\//, "");
	if (isPathInsideCwd(relativePath)) {
		return relativePath;
	}

	return canonicalPath.replace(/\\/g, "/");
}

function getPathMatchCandidates(filePath: string, cwd?: string): string[] {
	const candidates = new Set<string>();
	const normalized = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
	if (normalized.length > 0) {
		candidates.add(normalized);
	}
	if (cwd) {
		const canonical = normalizeCanonicalPath(filePath, cwd);
		if (canonical) {
			candidates.add(canonical);
		}
	}
	return [...candidates];
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

	const paths = spec.pathFields.flatMap((field) => extractStringValues(input[field])).map((path) => normalizeLexicalPath(path, cwd));
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

export function getMatchingScopedRules(filePath: string, rules: Rule[], cwd?: string): Rule[] {
	const candidates = getPathMatchCandidates(filePath, cwd);
	return rules.filter((rule) => rule.trigger === "glob" && candidates.some((candidate) => matchesAnyGlob(candidate, rule.globs)));
}

export function getPendingScopedRules(state: RuntimeState): Rule[] {
	return state.rules.filter((rule) => rule.trigger === "glob" && state.pendingScopes.has(rule.scope));
}

export function getRulesForScopes(state: RuntimeState, scopes: string[]): Rule[] {
	const scopeSet = new Set(scopes);
	return state.rules.filter((rule) => rule.trigger === "glob" && scopeSet.has(rule.scope));
}

export function getMatchingScopesForPaths(paths: string[], rules: Rule[], cwd?: string): string[] {
	const scopes = new Set<string>();
	for (const filePath of paths) {
		for (const rule of getMatchingScopedRules(filePath, rules, cwd)) {
			scopes.add(rule.scope);
		}
	}
	return [...scopes].sort();
}

export function getMissingVisibleScopesForPaths(paths: string[], rules: Rule[], visibleScopes: Set<string>, cwd?: string): string[] {
	return getMatchingScopesForPaths(paths, rules, cwd)
		.filter((scope) => !visibleScopes.has(scope))
		.sort();
}

export function pathExists(filePath: string, cwd: string): boolean {
	const resolvedPath = filePath.startsWith("/") ? filePath : resolve(cwd, filePath);
	return existsSync(resolvedPath);
}

export function evaluateScopedMutationGate(paths: string[], state: RuntimeState, cwd: string): ScopedMutationGateResult {
	const matchingScopes = getMatchingScopesForPaths(paths, state.rules, cwd);
	if (matchingScopes.length === 0) {
		return {
			allowed: true,
			matchingScopes,
			missingVisibleScopes: [],
			reason: "unscoped",
		};
	}

	const visibility = state.confirmedVisibility;
	const visibleScopes = visibility && visibility.providerCallId === state.currentProviderCallId && visibility.rulesRevision === state.rulesRevision
		? new Set(visibility.scopes)
		: new Set<string>();
	const missingVisibleScopes = matchingScopes.filter((scope) => !visibleScopes.has(scope)).sort();
	if (missingVisibleScopes.length === 0) {
		return {
			allowed: true,
			matchingScopes,
			missingVisibleScopes,
			reason: "visible",
		};
	}

	const attemptedCurrentInjection = state.inflightInjection
		&& state.inflightInjection.providerCallId === state.currentProviderCallId
		&& state.inflightInjection.rulesRevision === state.rulesRevision
		&& matchingScopes.every((scope) => state.inflightInjection?.scopes.includes(scope));
	const reason = attemptedCurrentInjection
		? "visibility_failed"
		: visibility && visibility.providerCallId === state.currentProviderCallId && visibility.rulesRevision !== state.rulesRevision
			? "rules_changed"
			: "not_visible";

	return {
		allowed: false,
		matchingScopes,
		missingVisibleScopes,
		reason,
	};
}

export function queuePendingScopes(state: RuntimeState, scopes: string[]): void {
	for (const scope of scopes) {
		state.pendingScopes.add(scope);
	}
}

export function clearPendingScopes(state: RuntimeState): void {
	state.pendingScopes.clear();
}

export function startProviderCall(state: RuntimeState): number {
	state.providerCallSeq += 1;
	state.currentProviderCallId = state.providerCallSeq;
	state.confirmedVisibility = undefined;
	state.inflightInjection = undefined;
	return state.currentProviderCallId;
}

export function rememberInflightInjection(state: RuntimeState, injection: RuntimeState["inflightInjection"]): void {
	state.inflightInjection = injection;
}

export function confirmInflightInjection(state: RuntimeState, payloadText: string): boolean {
	const injection = state.inflightInjection;
	if (!injection || injection.providerCallId !== state.currentProviderCallId) {
		return false;
	}
	if (!payloadText.includes(injection.nonce)) {
		return false;
	}
	state.confirmedVisibility = {
		providerCallId: injection.providerCallId,
		nonce: injection.nonce,
		scopes: injection.scopes,
		rulesRevision: injection.rulesRevision,
	};
	return true;
}

export function setActiveIntent(state: RuntimeState, paths: string[], scopes: string[]): void {
	state.activeIntent = {
		paths: [...paths].sort(),
		scopes: [...new Set(scopes)].sort(),
		remainingReinjections: ACTIVE_INTENT_REINJECTIONS,
	};
}

export function getReinjectableIntentScopes(state: RuntimeState): string[] {
	if (!state.activeIntent || state.activeIntent.remainingReinjections <= 0) {
		return [];
	}
	state.activeIntent.remainingReinjections -= 1;
	return state.activeIntent.scopes;
}

export function clearActiveIntentForMutation(state: RuntimeState, paths: string[], scopes: string[]): void {
	if (!state.activeIntent) {
		return;
	}
	const pathSet = new Set(paths);
	const scopeSet = new Set(scopes);
	const matchesPath = state.activeIntent.paths.some((path) => pathSet.has(path));
	const matchesScope = state.activeIntent.scopes.some((scope) => scopeSet.has(scope));
	if (matchesPath || matchesScope) {
		state.activeIntent = undefined;
	}
}

export function rememberBlockedToolCall(state: RuntimeState, toolCallId: string, toolName: string, paths: string[], scopes: string[]): void {
	state.blockedToolCalls.set(toolCallId, {
		toolName,
		paths: [...paths],
		scopes: [...scopes],
	});
}

export function createVisibilityFailureKey(paths: string[], scopes: string[]): string {
	return `${paths.slice().sort().join("\u0000")}::${scopes.slice().sort().join("\u0000")}`;
}

export function rememberVisibilityFailure(state: RuntimeState, key: string): number {
	state.visibilityFailureCount = state.lastVisibilityFailureKey === key
		? (state.visibilityFailureCount ?? 0) + 1
		: 1;
	state.lastVisibilityFailureKey = key;
	return state.visibilityFailureCount;
}

export function clearTransientRunState(state: RuntimeState): void {
	state.pendingScopes.clear();
	state.providerCallSeq = 0;
	state.currentProviderCallId = undefined;
	state.inflightInjection = undefined;
	state.confirmedVisibility = undefined;
	state.activeIntent = undefined;
	state.blockedToolCalls.clear();
	state.lastBlockedPath = undefined;
	state.lastBlockedScopes = undefined;
	state.lastVisibilityFailureKey = undefined;
	state.visibilityFailureCount = undefined;
	state.lastPreparedPath = undefined;
	state.lastPreparedScopes = undefined;
}
