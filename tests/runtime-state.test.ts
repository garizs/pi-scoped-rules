import { describe, expect, it } from "vitest";
import { armScopes, clearPendingScopes, getPendingScopedRules } from "../src/runtime.js";
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
	};
}

describe("runtime state", () => {
	it("arms scopes for future tool calls but injects them only once", () => {
		const state = createState();
		armScopes(state, ["runtime-placement"]);

		expect([...state.armedScopes]).toEqual(["runtime-placement"]);
		expect([...state.pendingScopes]).toEqual(["runtime-placement"]);
		expect(getPendingScopedRules(state).map((rule) => rule.scope)).toEqual(["runtime-placement"]);

		clearPendingScopes(state);
		expect([...state.armedScopes]).toEqual(["runtime-placement"]);
		expect([...state.pendingScopes]).toEqual([]);
		expect(getPendingScopedRules(state)).toEqual([]);
	});
});
