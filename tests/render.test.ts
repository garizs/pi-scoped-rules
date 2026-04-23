import { describe, expect, it } from "vitest";
import { buildScopedBlockedReason, buildScopedContextMessage, buildScopedMutationPrimer, buildScopedReadPrimer, stripScopedContextMessages } from "../src/render.js";
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
	sourcePath: "/tmp/placement.md",
	relativePath: ".agents/rules/placement.md",
};

describe("render helpers", () => {
	it("creates a scoped mutation primer for glob rules", () => {
		const prompt = buildScopedMutationPrimer([sampleRule]);
		expect(prompt).toContain("Only call edit/write from a model step where the matching scoped rules are visible.");
		expect(prompt).toContain("runtime-placement");
		expect(prompt).toContain("Assets/Scripts/Runtime/Placement/**/*.cs");
	});

	it("creates a scoped read primer for read-only analysis flows", () => {
		const prompt = buildScopedReadPrimer([sampleRule]);
		expect(prompt).toContain("When you read a matching file for review or analysis");
		expect(prompt).toContain("runtime-placement");
	});

	it("creates condensed scoped context messages", () => {
		const message = buildScopedContextMessage([sampleRule], "condensed");
		expect(message.content).toContain("Render mode: condensed");
		expect(message.content).toContain("runtime-placement");
		expect(message.content).toContain("- Keep placement ownership explicit.");
		expect(message.content).toContain("...");
	});

	it("builds a deterministic blocked mutation reason", () => {
		const reason = buildScopedBlockedReason(
			"Assets/Scripts/Runtime/Placement/A.cs",
			["runtime-placement"],
			["Assets/Scripts/Runtime/Placement/A.cs"],
		);
		expect(reason).toContain("SCOPED_RULES_BLOCKED_MUTATION");
		expect(reason).toContain("retryable_now: false");
		expect(reason).toContain("requires_next_model_call: true");
		expect(reason).toContain("read exact file: Assets/Scripts/Runtime/Placement/A.cs");
	});

	it("does not require an exact file read when the target file does not exist yet", () => {
		const reason = buildScopedBlockedReason(
			"Assets/Scripts/Runtime/Placement/NewFile.cs",
			["runtime-placement"],
			[],
			{ targetExists: false, visibilityRequired: true },
		);
		expect(reason).toContain("no exact file read is required because the target path does not exist yet");
		expect(reason).not.toContain("read exact file: Assets/Scripts/Runtime/Placement/NewFile.cs");
		expect(reason).toContain('"requiredReads": []');
	});

	it("does not describe an already-read existing target as a new file", () => {
		const reason = buildScopedBlockedReason(
			"Assets/Scripts/Runtime/Placement/A.cs",
			["runtime-placement"],
			[],
			{ targetExists: true, visibilityRequired: true },
		);
		expect(reason).toContain("exact file read is already satisfied or not required for this target");
		expect(reason).not.toContain("target path does not exist yet");
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

		const message = buildScopedContextMessage([verboseRule], "condensed");
		expect(message.content).not.toContain("Apply these rules to placement-layer code only.");
		expect(message.content).not.toContain("Use this rule whenever you edit placement code.");
		expect(message.content).toContain("- Keep placement ownership explicit.");
		expect(message.content).toContain("- Separate preview from commit.");
	});

	it("includes blocked transition instructions in scoped context messages", () => {
		const message = buildScopedContextMessage([sampleRule], "full", {
			kind: "blocked",
			targetPath: "Assets/Scripts/Runtime/Placement/A.cs",
			scopes: ["runtime-placement"],
			unreadPaths: ["Assets/Scripts/Runtime/Placement/A.cs"],
		});
		expect(message.content).toContain("[SCOPED PROJECT RULES: MUTATION BLOCKED]");
		expect(message.content).toContain("do not retry the mutation in the same tool-calling message as the read");
	});

	it("describes file-creation blocking without demanding a nonexistent read", () => {
		const message = buildScopedContextMessage([sampleRule], "full", {
			kind: "blocked",
			targetPath: "Assets/Scripts/Runtime/Placement/NewFile.cs",
			scopes: ["runtime-placement"],
			unreadPaths: [],
			targetExists: false,
		});
		expect(message.content).toContain("no exact file read is required because the target path does not exist yet");
		expect(message.content).toContain("plans the file creation");
	});

	it("includes armed transition instructions in scoped context messages", () => {
		const message = buildScopedContextMessage([sampleRule], "full", {
			kind: "armed",
			targetPath: "Assets/Scripts/Runtime/Placement/A.cs",
			scopes: ["runtime-placement"],
		});
		expect(message.content).toContain("[SCOPED PROJECT RULES: FILE READ COMPLETE]");
		expect(message.content).toContain("Use them on this model step to plan or apply the upcoming mutation.");
	});

	it("strips previous scoped context messages to avoid history bloat in live context", () => {
		const scopedMessage = buildScopedContextMessage([sampleRule], "full");
		const filtered = stripScopedContextMessages([
			{ role: "user", content: "hello", timestamp: Date.now() },
			scopedMessage,
		]);

		expect(filtered).toHaveLength(1);
		expect(filtered[0].role).toBe("user");
	});
});
