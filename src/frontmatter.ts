function parseScalar(value: string): unknown {
	const trimmed = value.trim();
	if (trimmed === "true") return true;
	if (trimmed === "false") return false;
	if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

export function parseFrontmatter(raw: string): { hasFrontmatter: boolean; meta: Record<string, unknown>; body: string } {
	if (!raw.startsWith("---\n") && !raw.startsWith("---\r\n")) {
		return { hasFrontmatter: false, meta: {}, body: raw };
	}

	const normalized = raw.replace(/\r\n/g, "\n");
	const endIndex = normalized.indexOf("\n---\n", 4);
	if (endIndex === -1) {
		return { hasFrontmatter: false, meta: {}, body: raw };
	}

	const fm = normalized.slice(4, endIndex);
	const body = normalized.slice(endIndex + 5).trimStart();
	const meta: Record<string, unknown> = {};
	let currentArrayKey: string | undefined;

	for (const line of fm.split("\n")) {
		if (!line.trim() || line.trimStart().startsWith("#")) {
			continue;
		}

		const arrayMatch = line.match(/^\s*[-*]\s+(.*)$/);
		if (arrayMatch && currentArrayKey) {
			const current = meta[currentArrayKey];
			if (Array.isArray(current)) {
				current.push(parseScalar(arrayMatch[1]));
			}
			continue;
		}

		const keyValueMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
		if (!keyValueMatch) {
			currentArrayKey = undefined;
			continue;
		}

		const [, key, value] = keyValueMatch;
		if (value.trim().length === 0) {
			meta[key] = [];
			currentArrayKey = key;
			continue;
		}

		meta[key] = parseScalar(value);
		currentArrayKey = undefined;
	}

	return { hasFrontmatter: true, meta, body };
}

export function parseStringList(value: unknown): string[] | undefined {
	if (typeof value === "string") {
		return value
			.split(",")
			.map((entry) => entry.trim())
			.filter(Boolean);
	}

	if (Array.isArray(value)) {
		return value
			.filter((entry): entry is string => typeof entry === "string")
			.map((entry) => entry.trim())
			.filter(Boolean);
	}

	return undefined;
}
