import { describe, expect, it } from "vitest";
import { buildScopedContextMessage, buildScopedMutationPrimer, buildScopedPreparedReason, buildScopedReadPrimer, buildScopedVisibilityFailureReason, redactBlockedMutationToolCalls, stripScopedContextMessages } from "../src/render.js";
import type { Rule } from "../src/types.js";

const sampleRule: Rule = {
	id: "placement",
	name: "placement",
	scope: "runtime-placement",
	trigger: "glob",
	description: "Placement rules",
	globs: ["Assets/Scripts/Runtime/Placement/**/*.cs"],
	content: [
		"- Keep placement ownership explicit.",
		"- Separate preview from commit.",
		"- Do not leak placement policy into player or presentation.",
		"- Validate required dependencies explicitly.",
		"- Keep repeated evaluation paths allocation-free after warmup.",
		"- Prefer explicit outcomes/results.",
		"- Keep authored assumptions visible.",
		"- Avoid ad hoc helper leakage.",
		"- Extra line to prove condensed mode trims.",
	].join("\n"),
	sourcePath: "/tmp/placement.mdc",
	relativePath: ".agents/rules/placement.mdc",
};

describe("render helpers", () => {
	it("creates a scoped mutation primer for glob rules", () => {
		const prompt = buildScopedMutationPrimer([sampleRule]);
		expect(prompt).toContain("SCOPED_RULES_PREPARED");
		expect(prompt).toContain("Only call edit/write for scoped paths from a model step where the matching scoped rules are visible.");
		expect(prompt).toContain("runtime-placement");
		expect(prompt).toContain("Assets/Scripts/Runtime/Placement/**/*.cs");
	});

	it("creates a scoped read primer without promising read-triggered injection", () => {
		const prompt = buildScopedReadPrimer([sampleRule]);
		expect(prompt).toContain("not injected on every read");
		expect(prompt).toContain("runtime-placement");
	});

	it("creates condensed scoped context messages with a nonce", () => {
		const message = buildScopedContextMessage([sampleRule], "condensed", "nonce-123");
		expect(message.content).toContain("Scoped-Rules-Nonce: nonce-123");
		expect(message.content).toContain("Render mode: condensed");
		expect(message.content).toContain("runtime-placement");
		expect(message.content).toContain("- Keep placement ownership explicit.");
		expect(message.content).toContain("...");
	});

	it("builds a neutral prepared mutation reason", () => {
		const reason = buildScopedPreparedReason(
			"Assets/Scripts/Runtime/Placement/A.cs",
			["runtime-placement"],
		);
		expect(reason).toContain("SCOPED_RULES_PREPARED");
		expect(reason).toContain("This is not an error");
		expect(reason).toContain("Do not apologize");
		expect(reason).toContain("retryable_now: false");
		expect(reason).toContain("requires_next_model_call: true");
		expect(reason).not.toContain("read exact file");
	});

	it("builds a visibility failure reason for loop prevention", () => {
		const reason = buildScopedVisibilityFailureReason(
			"Assets/Scripts/Runtime/Placement/A.cs",
			["runtime-placement"],
		);
		expect(reason).toContain("SCOPED_RULES_VISIBILITY_FAILED");
		expect(reason).toContain("Stopping this turn to avoid a repeated mutation loop");
	});

	it("removes boilerplate prose and keeps concrete guidance in condensed mode", () => {
		const verboseRule: Rule = {
			...sampleRule,
			id: "verbose",
			name: "verbose",
			content: [
				"Apply these rules to placement-layer code only.",
				"Use this rule whenever you edit placement code.",
				"",
				"- Keep placement ownership explicit.",
				"- Separate preview from commit.",
				"- Prefer explicit placement outcomes.",
			].join("\n"),
		};

		const message = buildScopedContextMessage([verboseRule], "condensed", "nonce-123");
		expect(message.content).not.toContain("Apply these rules to placement-layer code only.");
		expect(message.content).not.toContain("Use this rule whenever you edit placement code.");
		expect(message.content).toContain("- Keep placement ownership explicit.");
		expect(message.content).toContain("- Separate preview from commit.");
	});

	it("includes paused mutation transition instructions in scoped context messages", () => {
		const message = buildScopedContextMessage([sampleRule], "full", "nonce-123", {
			kind: "blocked",
			targetPath: "Assets/Scripts/Runtime/Placement/A.cs",
			scopes: ["runtime-placement"],
		});
		expect(message.content).toContain("[SCOPED PROJECT RULES: MUTATION PAUSED]");
		expect(message.content).toContain("Blocked path: Assets/Scripts/Runtime/Placement/A.cs");
		expect(message.content).toContain("Use the scoped rules below on this model step that plans the mutation.");
	});

	it("includes prepared transition instructions in scoped context messages", () => {
		const message = buildScopedContextMessage([sampleRule], "full", "nonce-123", {
			kind: "prepared",
			targetPath: "Assets/Scripts/Runtime/Placement/A.cs",
			scopes: ["runtime-placement"],
		});
		expect(message.content).toContain("[SCOPED PROJECT RULES: MUTATION PREPARED]");
		expect(message.content).toContain("Use them on this model step to plan or apply the upcoming mutation.");
	});

	it("strips previous scoped context messages to avoid history bloat in live context", () => {
		const scopedMessage = buildScopedContextMessage([sampleRule], "full", "nonce-123");
		const filtered = stripScopedContextMessages([
			{ role: "user", content: "hello", timestamp: Date.now() },
			scopedMessage,
		]);

		expect(filtered).toHaveLength(1);
		expect(filtered[0].role).toBe("user");
	});

	it("redacts blocked edit arguments from future context", () => {
		const filtered = redactBlockedMutationToolCalls([
			{
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "call-1",
						name: "edit",
						arguments: {
							path: "Assets/Scripts/Runtime/Placement/A.cs",
							edits: [{ oldText: "large old", newText: "large new" }],
						},
					},
				],
				api: "test",
				provider: "test",
				model: "test",
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
				stopReason: "toolUse",
				timestamp: Date.now(),
			},
		], new Map([["call-1", {
			toolName: "edit",
			paths: ["Assets/Scripts/Runtime/Placement/A.cs"],
			scopes: ["runtime-placement"],
		}]]));

		const assistant = filtered[0] as { role: "assistant"; content: Array<{ type: string; arguments: Record<string, unknown> }> };
		expect(assistant.content[0].arguments.argumentsRedacted).toBe(true);
		expect(assistant.content[0].arguments).not.toHaveProperty("edits");
	});
});
