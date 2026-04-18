import { describe, expect, it } from "vitest";
import { matchesGlob } from "../src/glob.js";

describe("matchesGlob", () => {
	it("matches direct children with ** globs", () => {
		expect(matchesGlob("Assets/Scripts/Runtime/Placement/A.cs", "Assets/Scripts/Runtime/Placement/**/*.cs")).toBe(true);
	});
});
