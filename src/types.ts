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

export type ScopedRuleEnforcementMode = "armed_scope" | "visible_in_current_context";

export interface ScopedRulesConfig {
	ruleDirs: string[];
	mutatingTools: ToolMutationSpec[];
	includeModelDecisionSummary: boolean;
	renderMode: RuleRenderMode;
	enforcementMode: ScopedRuleEnforcementMode;
}

export type ScopedTransitionNotice = {
	kind: "blocked";
	targetPath: string;
	scopes: string[];
	unreadPaths: string[];
	targetExists?: boolean;
	visibilityRequired?: boolean;
} | {
	kind: "armed";
	targetPath: string;
	scopes: string[];
};

export interface ScopedMutationGateResult {
	allowed: boolean;
	missingScopes: string[];
	unreadScopedPaths: string[];
	missingVisibleScopes: string[];
	queuedScopes: string[];
	targetPathExists: boolean;
}

export interface RuntimeState {
	config: ScopedRulesConfig;
	rules: Rule[];
	diagnostics: RuleDiagnostic[];
	armedScopes: Set<string>;
	pendingScopes: Set<string>;
	lastVisibleScopes: Set<string>;
	lastVisibleRuleMessageId?: number;
	readPaths: Set<string>;
	lastBlockedPath?: string;
	lastBlockedScopes?: string[];
	lastBlockedUnreadPaths?: string[];
	lastBlockedTargetExists?: boolean;
	lastBlockedVisibilityRequired?: boolean;
	lastActivatedPath?: string;
	lastActivatedScopes?: string[];
}
