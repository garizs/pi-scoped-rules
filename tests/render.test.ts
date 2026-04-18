import { describe, expect, it } from "vitest";
import { buildScopedContextMessage, stripScopedContextMessages } from "../src/render.js";
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
	it("creates condensed scoped context messages", () => {
		const message = buildScopedContextMessage([sampleRule], "condensed");
		expect(message.content).toContain("Render mode: condensed");
		expect(message.content).toContain("runtime-placement");
		expect(message.content).toContain("...");
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
