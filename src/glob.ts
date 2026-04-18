function expandBraces(glob: string): string[] {
	const match = glob.match(/^(.*)\{([^}]+)\}(.*)$/);
	if (!match) {
		return [glob];
	}

	const [, prefix, inner, suffix] = match;
	return inner.split(",").flatMap((part) => expandBraces(`${prefix}${part.trim()}${suffix}`));
}

function matchSegment(pattern: string, value: string): boolean {
	const escaped = pattern
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		.replace(/\*/g, ".*")
		.replace(/\?/g, ".");
	return new RegExp(`^${escaped}$`).test(value);
}

function matchSegments(patternSegments: string[], pathSegments: string[]): boolean {
	if (patternSegments.length === 0) {
		return pathSegments.length === 0;
	}

	const [patternHead, ...patternTail] = patternSegments;

	if (patternHead === "**") {
		if (matchSegments(patternTail, pathSegments)) {
			return true;
		}

		for (let index = 0; index < pathSegments.length; index += 1) {
			if (matchSegments(patternTail, pathSegments.slice(index + 1))) {
				return true;
			}
		}

		return false;
	}

	if (pathSegments.length === 0) {
		return false;
	}

	if (!matchSegment(patternHead, pathSegments[0])) {
		return false;
	}

	return matchSegments(patternTail, pathSegments.slice(1));
}

export function matchesGlob(filePath: string, glob: string): boolean {
	const normalizedPath = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
	const pathSegments = normalizedPath.split("/").filter(Boolean);

	return expandBraces(glob).some((pattern) => {
		const patternSegments = pattern.replace(/\\/g, "/").replace(/^\.\//, "").split("/").filter(Boolean);
		return matchSegments(patternSegments, pathSegments);
	});
}

export function matchesAnyGlob(filePath: string, globs: string[] | undefined): boolean {
	if (!globs || globs.length === 0) {
		return false;
	}

	return globs.some((glob) => matchesGlob(filePath, glob));
}
