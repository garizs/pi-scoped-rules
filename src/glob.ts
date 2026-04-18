function expandBraces(glob: string): string[] {
	const match = glob.match(/^(.*)\{([^}]+)\}(.*)$/);
	if (!match) {
		return [glob];
	}

	const [, prefix, inner, suffix] = match;
	return inner.split(",").flatMap((part) => expandBraces(`${prefix}${part.trim()}${suffix}`));
}

function globToRegex(glob: string): RegExp {
	const escaped = glob
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		.replace(/\*\*/g, "::DOUBLE_STAR::")
		.replace(/\*/g, "[^/]*")
		.replace(/::DOUBLE_STAR::/g, ".*")
		.replace(/\?/g, ".");

	return new RegExp(`^${escaped}$`);
}

export function matchesGlob(filePath: string, glob: string): boolean {
	const normalized = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
	return expandBraces(glob).some((pattern) => globToRegex(pattern).test(normalized));
}

export function matchesAnyGlob(filePath: string, globs: string[] | undefined): boolean {
	if (!globs || globs.length === 0) {
		return false;
	}

	return globs.some((glob) => matchesGlob(filePath, glob));
}
