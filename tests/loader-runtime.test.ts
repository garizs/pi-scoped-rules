import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRules } from "../src/loader.js";
import { getMissingScopesForPaths } from "../src/runtime.js";

function createTempProject(): string {
	return mkdtempSync(join(tmpdir(), "pi-scoped-rules-loader-"));
}

describe("loadRules + scope resolution", () => {
	it("loads valid strict .mdc rules", () => {
		const projectDir = createTempProject();
		const rulesDir = join(projectDir, ".agents", "rules");
		mkdirSync(rulesDir, { recursive: true });

		writeFileSync(
			join(rulesDir, "placement.mdc"),
			[
				"---",
				"trigger: glob",
				"scope: runtime-placement",
				"globs:",
				"  - \"Assets/Scripts/Runtime/Placement/**/*.cs\"",
				"description: Placement rules",
				"---",
				"",
				"- Keep placement ownership explicit.",
			].join("\n"),
		);

		const result = loadRules(projectDir, {
			ruleDirs: [".agents/rules"],
			mutatingTools: [],
			includeModelDecisionSummary: false,
			renderMode: "full",
		});

		expect(result.diagnostics).toEqual([]);
		expect(result.rules).toHaveLength(1);
		expect(result.rules[0]?.trigger).toBe("glob");
		expect(result.rules[0]?.scope).toBe("runtime-placement");
	});

	it("reports diagnostics for non-canonical or invalid rule files", () => {
		const projectDir = createTempProject();
		const rulesDir = join(projectDir, ".agents", "rules");
		mkdirSync(rulesDir, { recursive: true });

		writeFileSync(
			join(rulesDir, "invalid.mdc"),
			[
				"---",
				"alwaysApply: true",
				"scope: invalid-rule",
				"---",
				"",
				"Some content.",
			].join("\n"),
		);
		writeFileSync(
			join(rulesDir, "ignored.md"),
			"---\ntrigger: always_on\nscope: ignored\n---\n\nShould not load.\n",
		);

		const result = loadRules(projectDir, {
			ruleDirs: [".agents/rules"],
			mutatingTools: [],
			includeModelDecisionSummary: false,
			renderMode: "full",
		});

		expect(result.rules).toEqual([]);
		expect(result.diagnostics.map((entry) => entry.message)).toContain(
			"Unsupported frontmatter key: alwaysApply.",
		);
		expect(result.diagnostics.map((entry) => entry.message)).toContain(
			"Frontmatter field 'trigger' is required and must be one of: always_on, glob, model_decision.",
		);
	});

	it("dedupes missing scopes by logical scope instead of file path", () => {
		const projectDir = createTempProject();
		const rulesDir = join(projectDir, ".agents", "rules");
		mkdirSync(rulesDir, { recursive: true });
		writeFileSync(
			join(rulesDir, "placement.mdc"),
			`---\ntrigger: glob\nscope: runtime-placement\nglobs:\n  - \"Assets/Scripts/Runtime/Placement/**/*.cs\"\n---\n\nPlacement rules.\n`,
		);

		const result = loadRules(projectDir, {
			ruleDirs: [".agents/rules"],
			mutatingTools: [],
			includeModelDecisionSummary: false,
			renderMode: "full",
		});

		const missingScopes = getMissingScopesForPaths(
			[
				"Assets/Scripts/Runtime/Placement/A.cs",
				"Assets/Scripts/Runtime/Placement/B.cs",
			],
			result.rules,
			new Set(),
		);

		expect(missingScopes).toEqual(["runtime-placement"]);
	});
});
