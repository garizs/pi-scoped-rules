import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ScopedRulesConfig, ToolMutationSpec } from "./types.js";

const DEFAULT_MUTATING_TOOLS: ToolMutationSpec[] = [
	{ toolName: "edit", pathFields: ["path"] },
	{ toolName: "write", pathFields: ["path"] },
];

const DEFAULT_CONFIG: ScopedRulesConfig = {
	ruleDirs: [".agents/rules", ".pi/rules"],
	mutatingTools: DEFAULT_MUTATING_TOOLS,
	includeModelDecisionSummary: false,
};

interface RawConfig {
	ruleDirs?: unknown;
	mutatingTools?: unknown;
	includeModelDecisionSummary?: unknown;
}

function parseMutatingTools(value: unknown): ToolMutationSpec[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}

	const tools = value
		.map((entry) => {
			if (!entry || typeof entry !== "object") {
				return undefined;
			}

			const object = entry as Record<string, unknown>;
			if (typeof object.toolName !== "string" || !Array.isArray(object.pathFields)) {
				return undefined;
			}

			const pathFields = object.pathFields.filter((field): field is string => typeof field === "string");
			if (pathFields.length === 0) {
				return undefined;
			}

			return {
				toolName: object.toolName,
				pathFields,
			};
		})
		.filter((entry): entry is ToolMutationSpec => entry !== undefined);

	return tools.length > 0 ? tools : undefined;
}

export function loadConfig(cwd: string): ScopedRulesConfig {
	const configPath = resolve(cwd, ".pi/scoped-rules.json");
	if (!existsSync(configPath)) {
		return DEFAULT_CONFIG;
	}

	let raw: RawConfig = {};
	try {
		raw = JSON.parse(readFileSync(configPath, "utf8")) as RawConfig;
	} catch {
		return DEFAULT_CONFIG;
	}

	const ruleDirs = Array.isArray(raw.ruleDirs)
		? raw.ruleDirs.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
		: DEFAULT_CONFIG.ruleDirs;

	return {
		ruleDirs: ruleDirs.length > 0 ? ruleDirs : DEFAULT_CONFIG.ruleDirs,
		mutatingTools: parseMutatingTools(raw.mutatingTools) ?? DEFAULT_CONFIG.mutatingTools,
		includeModelDecisionSummary:
			typeof raw.includeModelDecisionSummary === "boolean"
				? raw.includeModelDecisionSummary
				: DEFAULT_CONFIG.includeModelDecisionSummary,
	};
}
