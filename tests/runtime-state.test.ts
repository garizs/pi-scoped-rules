import { describe, expect, it } from "vitest";
import { armScopes, clearPendingScopes, extractMutationPaths, getInactiveMatchingScopesForPaths, getMissingScopesForPaths, getPendingScopedRules, getUnreadScopedPaths, queuePendingScopes, rememberReadPaths } from "../src/runtime.js";
import type { RuntimeState, Rule } from "../src/types.js";

const placementRule: Rule = {
	id: "placement",
	name: "placement",
	scope: "runtime-placement",
	trigger: "glob",
	description: "Placement rules",
	globs: ["Assets/Scripts/Runtime/Placement/**/*.cs"],
	content: "- Keep placement ownership explicit.",
	sourcePath: "/tmp/placement.mdc",
	relativePath: ".agents/rules/placement.mdc",
};

function createState(): RuntimeState {
	return {
		config: {
			ruleDirs: [".agents/rules"],
			mutatingTools: [],
			includeModelDecisionSummary: false,
			renderMode: "full",
		},
		rules: [placementRule],
		diagnostics: [],
		armedScopes: new Set<string>(),
		pendingScopes: new Set<string>(),
		readPaths: new Set<string>(),
	};
}

describe("runtime state", () => {
	it("detects inactive matching scopes for read-first activation", () => {
		const state = createState();
		const scopes = getInactiveMatchingScopesForPaths([
			"Assets/Scripts/Runtime/Placement/A.cs",
		], state.rules, state.armedScopes);

		expect(scopes).toEqual(["runtime-placement"]);

		armScopes(state, scopes);
		expect(getInactiveMatchingScopesForPaths([
			"Assets/Scripts/Runtime/Placement/A.cs",
		], state.rules, state.armedScopes)).toEqual([]);
	});

	it("keeps blocked scopes pending until a matching read arms them", () => {
		const state = createState();
		queuePendingScopes(state, ["runtime-placement"]);

		expect([...state.armedScopes]).toEqual([]);
		expect([...state.pendingScopes]).toEqual(["runtime-placement"]);
		expect(getPendingScopedRules(state).map((rule) => rule.scope)).toEqual(["runtime-placement"]);
		expect(getMissingScopesForPaths([
			"Assets/Scripts/Runtime/Placement/A.cs",
		], state.rules, state.armedScopes)).toEqual(["runtime-placement"]);

		clearPendingScopes(state);
		expect([...state.armedScopes]).toEqual([]);
		expect([...state.pendingScopes]).toEqual([]);
		expect(getMissingScopesForPaths([
			"Assets/Scripts/Runtime/Placement/A.cs",
		], state.rules, state.armedScopes)).toEqual(["runtime-placement"]);

		armScopes(state, ["runtime-placement"]);
		expect([...state.armedScopes]).toEqual(["runtime-placement"]);
		expect([...state.pendingScopes]).toEqual(["runtime-placement"]);
	});

	it("requires reading the exact target file before scoped mutation", () => {
		const state = createState();
		armScopes(state, ["runtime-placement"]);

		expect(getUnreadScopedPaths([
			"Assets/Scripts/Runtime/Placement/A.cs",
		], state.rules, state.readPaths)).toEqual(["Assets/Scripts/Runtime/Placement/A.cs"]);

		rememberReadPaths(state, ["Assets/Scripts/Runtime/Placement/B.cs"]);
		expect(getUnreadScopedPaths([
			"Assets/Scripts/Runtime/Placement/A.cs",
		], state.rules, state.readPaths)).toEqual(["Assets/Scripts/Runtime/Placement/A.cs"]);

		rememberReadPaths(state, ["Assets/Scripts/Runtime/Placement/A.cs"]);
		expect(getUnreadScopedPaths([
			"Assets/Scripts/Runtime/Placement/A.cs",
		], state.rules, state.readPaths)).toEqual([]);
	});

	it("canonicalizes absolute in-project paths back to project-relative globs", () => {
		const config = {
			ruleDirs: [".agents/rules"],
			mutatingTools: [{ toolName: "edit", pathFields: ["path"] }],
			includeModelDecisionSummary: false,
			renderMode: "full" as const,
		};
		const paths = extractMutationPaths(
			"edit",
			{ path: "/repo/Assets/Scripts/Runtime/Placement/A.cs" },
			config,
			"/repo",
		);

		expect(paths).toEqual(["Assets/Scripts/Runtime/Placement/A.cs"]);
	});
});
