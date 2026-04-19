import { describe, expect, it } from "vitest";
import { buildScopedContextMessage, buildScopedMutationPrimer, stripScopedContextMessages } from "../src/render.js";
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
		expect(prompt).toContain("Before mutating a file that matches one of these rules, read that file first");
		expect(prompt).toContain("runtime-placement");
		expect(prompt).toContain("Assets/Scripts/Runtime/Placement/**/*.cs");
	});

	it("creates condensed scoped context messages", () => {
		const message = buildScopedContextMessage([sampleRule], "condensed");
		expect(message.content).toContain("Render mode: condensed");
		expect(message.content).toContain("runtime-placement");
		expect(message.content).toContain("- Keep placement ownership explicit.");
		expect(message.content).toContain("...");
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
