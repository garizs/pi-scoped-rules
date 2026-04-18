import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { parseFrontmatter, parseStringList } from "./frontmatter.js";
import type { Rule, RuleTrigger, ScopedRulesConfig } from "./types.js";

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

		const extension = extname(entry.name).toLowerCase();
		if (extension === ".md" || extension === ".mdc") {
			results.push(relative(rootDir, absolutePath));
		}
	}

	return results;
}

function inferTrigger(meta: Record<string, unknown>): RuleTrigger {
	if (meta.trigger === "always_on" || meta.trigger === "glob" || meta.trigger === "model_decision") {
		return meta.trigger;
	}

	if (meta.alwaysApply === true) {
		return "always_on";
	}

	if (meta.globs !== undefined || meta.applyTo !== undefined) {
		return "glob";
	}

	return "model_decision";
}

export function loadRules(cwd: string, config: ScopedRulesConfig): Rule[] {
	const rules: Rule[] = [];

	for (const rulesDir of config.ruleDirs) {
		const absoluteDir = resolve(cwd, rulesDir);
		for (const relativeFile of discoverRuleFiles(absoluteDir, cwd)) {
			const absoluteFile = resolve(cwd, relativeFile);
			const raw = readFileSync(absoluteFile, "utf8");
			const { meta, body } = parseFrontmatter(raw);
			const trigger = inferTrigger(meta);
			const inferredName = basename(relativeFile).replace(/\.(md|mdc)$/i, "");
			const scope = typeof meta.scope === "string" && meta.scope.trim().length > 0 ? meta.scope.trim() : inferredName;
			const globs = parseStringList(meta.globs ?? meta.applyTo);

			rules.push({
				id: inferredName,
				name: typeof meta.name === "string" && meta.name.trim().length > 0 ? meta.name.trim() : inferredName,
				scope,
				trigger,
				description:
					typeof meta.description === "string" && meta.description.trim().length > 0
						? meta.description.trim()
						: undefined,
				globs,
				content: body.trim(),
				sourcePath: absoluteFile,
				relativePath: relativeFile.replace(/\\/g, "/"),
			});
		}
	}

	return rules.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}
