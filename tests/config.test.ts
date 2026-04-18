import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";

function createTempProject(): string {
	return mkdtempSync(join(tmpdir(), "pi-scoped-rules-config-"));
}

describe("loadConfig", () => {
	it("uses defaults when config file is missing", () => {
		const projectDir = createTempProject();
		const config = loadConfig(projectDir);

		expect(config.ruleDirs).toEqual([".agents/rules", ".pi/rules"]);
		expect(config.renderMode).toBe("full");
		expect(config.mutatingTools.map((tool) => tool.toolName)).toEqual(["edit", "write"]);
	});

	it("loads render mode and custom mutating tools", () => {
		const projectDir = createTempProject();
		mkdirSync(join(projectDir, ".pi"), { recursive: true });
		writeFileSync(
			join(projectDir, ".pi", "scoped-rules.json"),
			JSON.stringify({
				renderMode: "condensed",
				mutatingTools: [
					{ toolName: "edit", pathFields: ["path"] },
					{ toolName: "custom_mutator", pathFields: ["filePath", "files"] },
				],
			}),
		);

		const config = loadConfig(projectDir);
		expect(config.renderMode).toBe("condensed");
		expect(config.mutatingTools.map((tool) => tool.toolName)).toEqual(["edit", "custom_mutator"]);
	});
});
