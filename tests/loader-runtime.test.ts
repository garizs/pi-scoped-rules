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
	it("infers triggers from Cursor/Copilot-style frontmatter", () => {
		const projectDir = createTempProject();
		const rulesDir = join(projectDir, ".agents", "rules");
		mkdirSync(rulesDir, { recursive: true });

		writeFileSync(
			join(rulesDir, "always.mdc"),
			`---\nalwaysApply: true\n---\n\nAlways-on rule.\n`,
		);
		writeFileSync(
			join(rulesDir, "python.md"),
			`---\ndescription: Python service rules\napplyTo: \"services/**/*.py\"\n---\n\nUse explicit service boundaries.\n`,
		);

		const rules = loadRules(projectDir, {
			ruleDirs: [".agents/rules"],
			mutatingTools: [],
			includeModelDecisionSummary: false,
			renderMode: "full",
		});

		expect(rules.map((rule) => ({ name: rule.name, trigger: rule.trigger }))).toEqual([
			{ name: "always", trigger: "always_on" },
			{ name: "python", trigger: "glob" },
		]);
	});

	it("dedupes missing scopes by logical scope instead of file path", () => {
		const projectDir = createTempProject();
		const rulesDir = join(projectDir, ".agents", "rules");
		mkdirSync(rulesDir, { recursive: true });
		writeFileSync(
			join(rulesDir, "placement.md"),
			`---\ntrigger: glob\nscope: runtime-placement\nglobs:\n  - \"Assets/Scripts/Runtime/Placement/**/*.cs\"\n---\n\nPlacement rules.\n`,
		);

		const rules = loadRules(projectDir, {
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
			rules,
			new Set(),
		);

		expect(missingScopes).toEqual(["runtime-placement"]);
	});
});
