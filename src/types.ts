export type RuleTrigger = "always_on" | "glob" | "model_decision";

export interface Rule {
	id: string;
	name: string;
	scope: string;
	trigger: RuleTrigger;
	description?: string;
	globs?: string[];
	content: string;
	sourcePath: string;
	relativePath: string;
}

export interface ToolMutationSpec {
	toolName: string;
	pathFields: string[];
}

export interface RuleDiagnostic {
	relativePath: string;
	message: string;
}

export interface RuleLoadResult {
	rules: Rule[];
	diagnostics: RuleDiagnostic[];
}

export type RuleRenderMode = "full" | "condensed";

export interface ScopedRulesConfig {
	ruleDirs: string[];
	mutatingTools: ToolMutationSpec[];
	includeModelDecisionSummary: boolean;
	renderMode: RuleRenderMode;
}

export type ScopedTransitionNotice = {
	kind: "blocked";
	targetPath: string;
	scopes: string[];
	unreadPaths: string[];
} | {
	kind: "armed";
	targetPath: string;
	scopes: string[];
};

export interface RuntimeState {
	config: ScopedRulesConfig;
	rules: Rule[];
	diagnostics: RuleDiagnostic[];
	armedScopes: Set<string>;
	pendingScopes: Set<string>;
	readPaths: Set<string>;
	lastBlockedPath?: string;
	lastBlockedScopes?: string[];
	lastBlockedUnreadPaths?: string[];
	lastActivatedPath?: string;
	lastActivatedScopes?: string[];
}
