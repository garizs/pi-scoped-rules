import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { armScopes, clearLastVisibleScopes, clearPendingScopes, evaluateScopedMutationGate, extractMutationPaths, getInactiveMatchingScopesForPaths, getMissingScopesForPaths, getPendingScopedRules, getUnreadScopedPaths, queuePendingScopes, rememberReadPaths } from "../src/runtime.js";
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

function createExistingFile(projectDir: string, filePath: string): void {
	const absolutePath = join(projectDir, filePath);
	mkdirSync(dirname(absolutePath), { recursive: true });
	writeFileSync(absolutePath, "// existing\n");
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
		armedScopes: new Set<string>(),
		pendingScopes: new Set<string>(),
		lastVisibleScopes: new Set<string>(),
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

	it("does not require an exact file read for a new target path", () => {
		const state = createState();
		armScopes(state, ["runtime-placement"]);

		expect(getUnreadScopedPaths([
			"Assets/Scripts/Runtime/Placement/A.cs",
		], state.rules, state.readPaths, "/tmp")).toEqual([]);

		rememberReadPaths(state, ["Assets/Scripts/Runtime/Placement/A.cs"]);
		expect(getUnreadScopedPaths([
			"Assets/Scripts/Runtime/Placement/A.cs",
		], state.rules, state.readPaths, "/tmp")).toEqual([]);
	});

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

	it("blocks mutation when scope is armed and file was read but rules are not visible", () => {
		const projectDir = createTempProject();
		const filePath = "Assets/Scripts/Runtime/Placement/Foo.cs";
		createExistingFile(projectDir, filePath);
		const state = createState();
		armScopes(state, ["runtime-placement"]);
		rememberReadPaths(state, [filePath]);

		const gate = evaluateScopedMutationGate([filePath], state, projectDir);

		expect(gate.allowed).toBe(false);
		expect(gate.missingScopes).toEqual([]);
		expect(gate.unreadScopedPaths).toEqual([]);
		expect(gate.missingVisibleScopes).toEqual(["runtime-placement"]);
	});

	it("allows mutation only when the matching scope is visible", () => {
		const projectDir = createTempProject();
		const filePath = "Assets/Scripts/Runtime/Placement/Foo.cs";
		createExistingFile(projectDir, filePath);
		const state = createState();
		armScopes(state, ["runtime-placement"]);
		rememberReadPaths(state, [filePath]);
		state.lastVisibleScopes.add("runtime-placement");

		const gate = evaluateScopedMutationGate([filePath], state, projectDir);

		expect(gate.allowed).toBe(true);
		expect(gate.missingVisibleScopes).toEqual([]);
	});

	it("requires visible rules for new scoped file creation", () => {
		const projectDir = createTempProject();
		const filePath = "Assets/Scripts/Runtime/Placement/NewFoo.cs";
		const state = createState();
		armScopes(state, ["runtime-placement"]);

		expect(evaluateScopedMutationGate([filePath], state, projectDir).allowed).toBe(false);

		state.lastVisibleScopes.add("runtime-placement");
		const gate = evaluateScopedMutationGate([filePath], state, projectDir);

		expect(gate.allowed).toBe(true);
		expect(gate.unreadScopedPaths).toEqual([]);
		expect(gate.targetPathExists).toBe(false);
	});

	it("blocks when a different scope is visible than the target requires", () => {
		const projectDir = createTempProject();
		const filePath = "Assets/Scripts/Runtime/Presentation/Hud.cs";
		createExistingFile(projectDir, filePath);
		const state = createState();
		armScopes(state, ["runtime-presentation"]);
		rememberReadPaths(state, [filePath]);
		state.lastVisibleScopes.add("runtime-placement");

		const gate = evaluateScopedMutationGate([filePath], state, projectDir);

		expect(gate.allowed).toBe(false);
		expect(gate.missingVisibleScopes).toEqual(["runtime-presentation"]);
	});

	it("clears visible scopes for a provider context with no pending rules", () => {
		const state = createState();
		state.lastVisibleScopes.add("runtime-placement");

		clearLastVisibleScopes(state);

		expect([...state.lastVisibleScopes]).toEqual([]);
	});
});
