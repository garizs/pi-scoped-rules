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
		+ "Some project mutation rules are path-scoped and are mandatory for matching edit/write calls.\n\n"
		+ "Before calling edit/write for a file matching any scoped mutation rule:\n"
		+ "1. Read the exact existing target file first.\n"
		+ "2. Wait for the scoped rule guidance injected after that read.\n"
		+ "3. Only call edit/write from a model step where the matching scoped rules are visible.\n\n"
		+ "If the target file does not exist, do not create it until the scoped rules for its target path have been injected.\n\n"
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

export function buildScopedBlockedReason(
	targetPath: string,
	scopes: string[],
	unreadPaths: string[],
	options: { targetExists?: boolean; visibilityRequired?: boolean } = {},
): string {
	const requiredReads = unreadPaths;
	const payload = {
		status: "blocked_by_scoped_rules",
		targetPath,
		scopes,
		requiredReads,
		requiresVisibleScopedRules: options.visibilityRequired ?? true,
		targetExists: options.targetExists,
		requiresNextModelCall: true,
		retryableNow: false,
	};
	const readActions = requiredReads.length > 0
		? requiredReads.map((path) => `- read exact file: ${path}`)
		: options.targetExists === false
			? ["- no exact file read is required because the target path does not exist yet"]
			: ["- exact file read is already satisfied or not required for this target"];

	return [
		"SCOPED_RULES_BLOCKED_MUTATION",
		"status: blocked_by_scoped_rules",
		`target: ${targetPath}`,
		`matching_scopes: ${scopes.join(", ")}`,
		"required_next_actions:",
		...readActions,
		"- stop mutating this path in the current tool-calling message",
		"- wait for the next model call where the matching scoped rules are visible",
		"- only then retry the mutation",
		"retryable_now: false",
		"requires_next_model_call: true",
		"payload:",
		JSON.stringify(payload, null, 2),
	].join("\n");
}

function buildScopedTransitionHeader(transition: ScopedTransitionNotice | undefined): string {
	const mandatoryGuidance = [
		"The following scoped project rules are mandatory for any edit/write to matching paths in this model step.",
		"Apply the matching rule body to generated code for files whose paths match the listed globs.",
		"Do not rely on earlier memory of these rules; use the rules visible in this message.",
		"The mutation gate only allows edit/write from a model step where the matching scoped rules are visible.",
	];

	if (!transition) {
		return [
			"[SCOPED PROJECT RULES ACTIVE]",
			...mandatoryGuidance,
		].join("\n");
	}

	if (transition.kind === "blocked") {
		const readActions = transition.unreadPaths.length > 0
			? [
				...transition.unreadPaths.map((path) => `- read exact file: ${path}`),
				"- do not retry the mutation in the same tool-calling message as the read",
			]
			: transition.targetExists === false
				? [
					"- no exact file read is required because the target path does not exist yet",
					"- use the scoped rules below on this model step that plans the file creation",
				]
				: [
					"- exact file read is already satisfied or not required for this target",
					"- use the scoped rules below on this model step that plans the mutation",
				];
		return [
			"[SCOPED PROJECT RULES: MUTATION BLOCKED]",
			...mandatoryGuidance,
			`Blocked path: ${transition.targetPath}`,
			`Scopes: ${transition.scopes.join(", ")}`,
			"Required next actions:",
			...readActions,
		].join("\n");
	}

	return [
		"[SCOPED PROJECT RULES: FILE READ COMPLETE]",
		...mandatoryGuidance,
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
