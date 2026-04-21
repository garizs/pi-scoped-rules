import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { Rule, RuleRenderMode, ScopedTransitionNotice } from "./types.js";

type EphemeralScopedContextMessage = AgentMessage & {
	role: "custom";
	customType: string;
	content: string;
	display: false;
	timestamp: number;
};

const CONTEXT_MESSAGE_TYPE = "pi-scoped-rules";
const DEFAULT_CONDENSED_RULE_LINES = 8;
const BOILERPLATE_PATTERNS = [
	/^apply (?:this|these) rules?\b/i,
	/^use (?:this|these) rules?\b/i,
	/^use this skill\b/i,
	/^apply these rules\b/i,
	/^when (?:working|editing|changing|mutating)\b/i,
	/^this rule\b/i,
	/^the following\b/i,
];

export function buildAlwaysOnPrompt(rules: Rule[]): string {
	if (rules.length === 0) {
		return "";
	}

	const sections = rules.map((rule) => `### ${rule.name}\n\n${rule.content}`).join("\n\n---\n\n");
	return `\n\n## Project Always-On Rules\n\n${sections}`;
}

export function buildScopedMutationPrimer(rules: Rule[]): string {
	if (rules.length === 0) {
		return "";
	}

	const items = rules.map((rule) => {
		const globs = rule.globs?.join(", ") ?? rule.relativePath;
		return `- ${rule.name} [scope: ${rule.scope}] -> ${globs}`;
	}).join("\n");

	return `\n\n## Scoped Mutation Rules\n\n`
		+ "Some project mutation rules are path-scoped. Before mutating a file that matches one of these rules, read that file first so the matching scoped guidance can be injected on the next model step.\n\n"
		+ `${items}`;
}

export function buildScopedReadPrimer(rules: Rule[]): string {
	if (rules.length === 0) {
		return "";
	}

	const items = rules.map((rule) => {
		const globs = rule.globs?.join(", ") ?? rule.relativePath;
		return `- ${rule.name} [scope: ${rule.scope}] -> ${globs}`;
	}).join("\n");

	return `\n\n## Scoped Read Rules\n\n`
		+ "Some project rules are path-scoped. When you read a matching file for review or analysis, the matching scoped guidance may be injected ephemerally on the next model step. Apply that guidance to your reasoning without repeating the full rule blobs in chat history.\n\n"
		+ `${items}`;
}

export function buildModelDecisionPrompt(rules: Rule[]): string {
	if (rules.length === 0) {
		return "";
	}

	const items = rules.map((rule) => `- ${rule.name}: ${rule.description ?? rule.relativePath}`).join("\n");
	return `\n\n## Available Project Rules\n\n${items}`;
}

function normalizeLine(line: string): string {
	return line.replace(/\s+/g, " ").trim();
}

function isBoilerplateLine(line: string): boolean {
	return BOILERPLATE_PATTERNS.some((pattern) => pattern.test(line));
}

function collectBulletLines(lines: string[]): string[] {
	return lines
		.filter((line) => /^[-*+]\s+/.test(line) || /^\d+\.\s+/.test(line))
		.map((line) => line.replace(/^[-*+]\s+/, "").replace(/^\d+\.\s+/, "").trim())
		.filter((line) => line.length > 0)
		.map((line) => `- ${line}`);
}

function collectPlainGuidanceLines(lines: string[]): string[] {
	return lines
		.filter((line) => !line.startsWith("#"))
		.filter((line) => !/^[-*+]\s+/.test(line) && !/^\d+\.\s+/.test(line))
		.filter((line) => !isBoilerplateLine(line));
}

function condenseRuleContent(content: string): string {
	const normalizedLines = content
		.split("\n")
		.map(normalizeLine)
		.filter((line) => line.length > 0);

	const bulletLines = collectBulletLines(normalizedLines);
	const candidateLines = bulletLines.length > 0 ? bulletLines : collectPlainGuidanceLines(normalizedLines);

	const compactLines = [...new Set(candidateLines)].slice(0, DEFAULT_CONDENSED_RULE_LINES);
	if (compactLines.length === 0) {
		return normalizedLines.slice(0, DEFAULT_CONDENSED_RULE_LINES).join("\n");
	}

	const condensed = compactLines.join("\n");
	return candidateLines.length > DEFAULT_CONDENSED_RULE_LINES ? `${condensed}\n...` : condensed;
}

export function buildScopedBlockedReason(targetPath: string, scopes: string[], unreadPaths: string[]): string {
	const requiredReads = unreadPaths;
	const payload = {
		status: "blocked_by_scoped_rules",
		targetPath,
		scopes,
		requiredReads,
		requiresNextModelCall: true,
		retryableNow: false,
	};
	const creationOnly = requiredReads.length === 0;

	return [
		"SCOPED_RULES_BLOCKED_MUTATION",
		"status: blocked_by_scoped_rules",
		`target: ${targetPath}`,
		`matching_scopes: ${scopes.join(", ")}`,
		"required_next_actions:",
		...(creationOnly
			? ["- no exact file read is required because the target path does not exist yet"]
			: requiredReads.map((path) => `- read exact file: ${path}`)),
		"- stop mutating this path in the current tool-calling message",
		...(creationOnly
			? ["- wait for the next model call so the scoped rules can arm for file creation"]
			: ["- wait for the next model call after the exact read succeeds"]),
		"- only then retry the mutation",
		"retryable_now: false",
		"requires_next_model_call: true",
		"payload:",
		JSON.stringify(payload, null, 2),
	].join("\n");
}

function buildScopedTransitionHeader(transition: ScopedTransitionNotice | undefined): string {
	if (!transition) {
		return "[SCOPED PROJECT RULES ACTIVE]\nApply these project rules to any upcoming file mutations in this agent run.";
	}

	if (transition.kind === "blocked") {
		const creationOnly = transition.unreadPaths.length === 0;
		return [
			"[SCOPED PROJECT RULES: MUTATION BLOCKED]",
			`Blocked path: ${transition.targetPath}`,
			`Scopes: ${transition.scopes.join(", ")}`,
			"Required next actions:",
			...(creationOnly
				? ["- no exact file read is required because the target path does not exist yet"]
				: transition.unreadPaths.map((path) => `- read exact file: ${path}`)),
			...(creationOnly
				? ["- use the scoped rules below on the following model step that plans the file creation"]
				: [
					"- do not retry the mutation in the same tool-calling message as the read",
					"- use the scoped rules below on the following model step that plans the mutation",
				]),
		].join("\n");
	}

	return [
		"[SCOPED PROJECT RULES: FILE READ COMPLETE]",
		`Read path: ${transition.targetPath}`,
		`Armed scopes: ${transition.scopes.join(", ")}`,
		"The scoped rules below are now armed for this run.",
		"Use them on this model step to plan or apply the upcoming mutation.",
	].join("\n");
}

export function buildScopedContextMessage(
	rules: Rule[],
	renderMode: RuleRenderMode,
	transition?: ScopedTransitionNotice,
): EphemeralScopedContextMessage {
	const scopeList = [...new Set(rules.map((rule) => rule.scope))].join(", ");
	const renderedRules = rules
		.map((rule) => {
			const meta = rule.globs && rule.globs.length > 0 ? `\nGlobs: ${rule.globs.join(", ")}` : "";
			const body = renderMode === "condensed" ? condenseRuleContent(rule.content) : rule.content;
			return `### ${rule.name} [scope: ${rule.scope}]${meta}\n\n${body}`;
		})
		.join("\n\n---\n\n");

	return {
		role: "custom",
		customType: CONTEXT_MESSAGE_TYPE,
		content:
			`${buildScopedTransitionHeader(transition)}\n`
			+ `Render mode: ${renderMode}\n`
			+ `Active scopes: ${scopeList}\n\n`
			+ renderedRules,
		display: false,
		timestamp: Date.now(),
	};
}

export function stripScopedContextMessages(messages: AgentMessage[]): AgentMessage[] {
	return messages.filter((message) => !(message.role === "custom" && message.customType === CONTEXT_MESSAGE_TYPE));
}
