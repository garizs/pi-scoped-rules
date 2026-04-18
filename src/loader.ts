import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { parseFrontmatter, parseStringList } from "./frontmatter.js";
import type { Rule, RuleDiagnostic, RuleLoadResult, RuleTrigger, ScopedRulesConfig } from "./types.js";

const SUPPORTED_FRONTMATTER_KEYS = new Set(["name", "trigger", "scope", "description", "globs"]);

function discoverRuleFiles(dirPath: string, rootDir: string): string[] {
	if (!existsSync(dirPath)) {
		return [];
	}

	const results: string[] = [];
	for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
		const absolutePath = join(dirPath, entry.name);
		if (entry.isDirectory()) {
			results.push(...discoverRuleFiles(absolutePath, rootDir));
			continue;
		}

		if (extname(entry.name).toLowerCase() === ".mdc") {
			results.push(relative(rootDir, absolutePath));
		}
	}

	return results;
}

function createDiagnostic(relativePath: string, message: string): RuleDiagnostic {
	return { relativePath: relativePath.replace(/\\/g, "/"), message };
}

function isRuleTrigger(value: unknown): value is RuleTrigger {
	return value === "always_on" || value === "glob" || value === "model_decision";
}

function validateRule(cwd: string, relativePath: string, raw: string): { rule?: Rule; diagnostics: RuleDiagnostic[] } {
	const diagnostics: RuleDiagnostic[] = [];
	const { hasFrontmatter, meta, body } = parseFrontmatter(raw);

	if (!hasFrontmatter) {
		diagnostics.push(createDiagnostic(relativePath, "Missing required YAML frontmatter block."));
		return { diagnostics };
	}

	const unknownKeys = Object.keys(meta).filter((key) => !SUPPORTED_FRONTMATTER_KEYS.has(key));
	for (const key of unknownKeys) {
		diagnostics.push(createDiagnostic(relativePath, `Unsupported frontmatter key: ${key}.`));
	}

	if (!isRuleTrigger(meta.trigger)) {
		diagnostics.push(createDiagnostic(relativePath, "Frontmatter field 'trigger' is required and must be one of: always_on, glob, model_decision."));
	}

	if (typeof meta.scope !== "string" || meta.scope.trim().length === 0) {
		diagnostics.push(createDiagnostic(relativePath, "Frontmatter field 'scope' is required and must be a non-empty string."));
	}

	const trigger = isRuleTrigger(meta.trigger) ? meta.trigger : undefined;
	const globs = parseStringList(meta.globs);
	const hasDescription = typeof meta.description === "string" && meta.description.trim().length > 0;

	if (trigger === "glob") {
		if (!globs || globs.length === 0) {
			diagnostics.push(createDiagnostic(relativePath, "Frontmatter field 'globs' is required for trigger: glob and must contain at least one pattern."));
		}
	} else if (meta.globs !== undefined) {
		diagnostics.push(createDiagnostic(relativePath, "Frontmatter field 'globs' is only allowed for trigger: glob."));
	}

	if (trigger === "model_decision" && !hasDescription) {
		diagnostics.push(createDiagnostic(relativePath, "Frontmatter field 'description' is required for trigger: model_decision."));
	}

	if (body.trim().length === 0) {
		diagnostics.push(createDiagnostic(relativePath, "Rule body must not be empty."));
	}

	if (diagnostics.length > 0 || !trigger || typeof meta.scope !== "string") {
		return { diagnostics };
	}

	const inferredName = basename(relativePath).replace(/\.mdc$/i, "");
	return {
		diagnostics,
		rule: {
			id: inferredName,
			name: typeof meta.name === "string" && meta.name.trim().length > 0 ? meta.name.trim() : inferredName,
			scope: meta.scope.trim(),
			trigger,
			description: hasDescription ? (meta.description as string).trim() : undefined,
			globs,
			content: body.trim(),
			sourcePath: resolve(cwd, relativePath),
			relativePath: relativePath.replace(/\\/g, "/"),
		},
	};
}

export function loadRules(cwd: string, config: ScopedRulesConfig): RuleLoadResult {
	const rules: Rule[] = [];
	const diagnostics: RuleDiagnostic[] = [];

	for (const rulesDir of config.ruleDirs) {
		const absoluteDir = resolve(cwd, rulesDir);
		for (const relativeFile of discoverRuleFiles(absoluteDir, cwd)) {
			const absoluteFile = resolve(cwd, relativeFile);
			const raw = readFileSync(absoluteFile, "utf8");
			const result = validateRule(cwd, relativeFile, raw);
			diagnostics.push(...result.diagnostics);
			if (result.rule) {
				rules.push(result.rule);
			}
		}
	}

	return {
		rules: rules.sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
		diagnostics: diagnostics.sort((left, right) => left.relativePath.localeCompare(right.relativePath) || left.message.localeCompare(right.message)),
	};
}
