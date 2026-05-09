import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearActiveIntentForMutation, clearTransientRunState, confirmInflightInjection, evaluateScopedMutationGate, extractMutationPaths, getMatchingScopesForPaths, getPendingScopedRules, getReinjectableIntentScopes, queuePendingScopes, rememberInflightInjection, setActiveIntent, startProviderCall } from "../src/runtime.js";
import type { RuntimeState, Rule } from "../src/types.js";

const csharpBaselineRule: Rule = {
	id: "csharp-baseline",
	name: "csharp-baseline",
	scope: "csharp-baseline",
	trigger: "glob",
	description: "C# baseline rules",
	globs: ["Assets/Scripts/**/*.cs"],
	content: "- Keep C# code consistent.",
	sourcePath: "/tmp/csharp-baseline.mdc",
	relativePath: ".agents/rules/csharp-baseline.mdc",
};

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

const presentationRule: Rule = {
	id: "presentation",
	name: "presentation",
	scope: "runtime-presentation",
	trigger: "glob",
	description: "Presentation rules",
	globs: ["Assets/Scripts/Runtime/Presentation/**/*.cs"],
	content: "- Keep presentation passive.",
	sourcePath: "/tmp/presentation.mdc",
	relativePath: ".agents/rules/presentation.mdc",
};

function createTempProject(): string {
	return mkdtempSync(join(tmpdir(), "pi-scoped-rules-runtime-"));
}

function createState(): RuntimeState {
	return {
		config: {
			ruleDirs: [".agents/rules"],
			mutatingTools: [],
			includeModelDecisionSummary: false,
			renderMode: "full",
			enforcementMode: "visible_in_current_context",
		},
		rules: [placementRule, presentationRule],
		diagnostics: [],
		rulesRevision: "rev1",
		pendingScopes: new Set<string>(),
		providerCallSeq: 0,
		blockedToolCalls: new Map(),
	};
}

function confirmScopesForCurrentCall(state: RuntimeState, scopes: string[]): void {
	const providerCallId = startProviderCall(state);
	rememberInflightInjection(state, {
		providerCallId,
		nonce: "nonce-1",
		scopes,
		rulesRevision: state.rulesRevision,
	});
	expect(confirmInflightInjection(state, "payload nonce-1 payload")).toBe(true);
}

describe("runtime state", () => {
	it("canonicalizes absolute in-project paths back to project-relative globs", () => {
		const config = {
			ruleDirs: [".agents/rules"],
			mutatingTools: [{ toolName: "edit", pathFields: ["path"] }],
			includeModelDecisionSummary: false,
			renderMode: "full" as const,
			enforcementMode: "visible_in_current_context" as const,
		};
		const paths = extractMutationPaths(
			"edit",
			{ path: "/repo/Assets/Scripts/Runtime/Placement/A.cs" },
			config,
			"/repo",
		);

		expect(paths).toEqual(["Assets/Scripts/Runtime/Placement/A.cs"]);
	});

	it("dedupes matching scopes by logical scope", () => {
		const state = createState();
		const scopes = getMatchingScopesForPaths([
			"Assets/Scripts/Runtime/Placement/A.cs",
			"Assets/Scripts/Runtime/Placement/B.cs",
		], state.rules);

		expect(scopes).toEqual(["runtime-placement"]);
	});

	it("blocks scoped mutation when matching scopes were not visible in this provider call", () => {
		const state = createState();
		startProviderCall(state);

		const gate = evaluateScopedMutationGate(["Assets/Scripts/Runtime/Placement/Foo.cs"], state, createTempProject());

		expect(gate.allowed).toBe(false);
		expect(gate.matchingScopes).toEqual(["runtime-placement"]);
		expect(gate.missingVisibleScopes).toEqual(["runtime-placement"]);
		expect(gate.reason).toBe("not_visible");
	});

	it("allows mutation only when matching scopes were confirmed for the current provider call", () => {
		const state = createState();
		confirmScopesForCurrentCall(state, ["runtime-placement"]);

		const gate = evaluateScopedMutationGate(["Assets/Scripts/Runtime/Placement/Foo.cs"], state, createTempProject());

		expect(gate.allowed).toBe(true);
		expect(gate.reason).toBe("visible");
	});

	it("does not allow stale visibility from a previous provider call", () => {
		const state = createState();
		confirmScopesForCurrentCall(state, ["runtime-placement"]);
		startProviderCall(state);

		const gate = evaluateScopedMutationGate(["Assets/Scripts/Runtime/Placement/Foo.cs"], state, createTempProject());

		expect(gate.allowed).toBe(false);
		expect(gate.reason).toBe("not_visible");
	});

	it("queues every matching scope for overlapping scoped rules", () => {
		const state = createState();
		state.rules = [csharpBaselineRule, placementRule];
		confirmScopesForCurrentCall(state, ["runtime-placement"]);

		const gate = evaluateScopedMutationGate(["Assets/Scripts/Runtime/Placement/Foo.cs"], state, createTempProject());

		expect(gate.allowed).toBe(false);
		expect(gate.matchingScopes).toEqual(["csharp-baseline", "runtime-placement"]);
		expect(gate.missingVisibleScopes).toEqual(["csharp-baseline"]);
	});

	it("treats an unconfirmed injection for the current provider call as visibility failure", () => {
		const state = createState();
		const providerCallId = startProviderCall(state);
		rememberInflightInjection(state, {
			providerCallId,
			nonce: "nonce-missing",
			scopes: ["runtime-placement"],
			rulesRevision: state.rulesRevision,
		});

		const gate = evaluateScopedMutationGate(["Assets/Scripts/Runtime/Placement/Foo.cs"], state, createTempProject());

		expect(gate.allowed).toBe(false);
		expect(gate.reason).toBe("visibility_failed");
	});

	it("requires reinjection when rules revision changes after confirmation", () => {
		const state = createState();
		confirmScopesForCurrentCall(state, ["runtime-placement"]);
		state.rulesRevision = "rev2";

		const gate = evaluateScopedMutationGate(["Assets/Scripts/Runtime/Placement/Foo.cs"], state, createTempProject());

		expect(gate.allowed).toBe(false);
		expect(gate.reason).toBe("rules_changed");
	});

	it("keeps pending scopes and bounded active-intent reinjection separate from reads", () => {
		const state = createState();
		queuePendingScopes(state, ["runtime-placement"]);
		expect(getPendingScopedRules(state).map((rule) => rule.scope)).toEqual(["runtime-placement"]);

		setActiveIntent(state, ["Assets/Scripts/Runtime/Placement/Foo.cs"], ["runtime-placement"]);
		expect(getReinjectableIntentScopes(state)).toEqual(["runtime-placement"]);
		expect(getReinjectableIntentScopes(state)).toEqual([]);
	});

	it("clears active intent after a matching successful mutation", () => {
		const state = createState();
		setActiveIntent(state, ["Assets/Scripts/Runtime/Placement/Foo.cs"], ["runtime-placement"]);
		clearActiveIntentForMutation(state, ["Assets/Scripts/Runtime/Placement/Foo.cs"], ["runtime-placement"]);

		expect(state.activeIntent).toBeUndefined();
	});

	it("clears transient state at agent end", () => {
		const state = createState();
		queuePendingScopes(state, ["runtime-placement"]);
		setActiveIntent(state, ["Assets/Scripts/Runtime/Placement/Foo.cs"], ["runtime-placement"]);
		confirmScopesForCurrentCall(state, ["runtime-placement"]);

		clearTransientRunState(state);

		expect([...state.pendingScopes]).toEqual([]);
		expect(state.activeIntent).toBeUndefined();
		expect(state.confirmedVisibility).toBeUndefined();
		expect(state.currentProviderCallId).toBeUndefined();
	});
});
