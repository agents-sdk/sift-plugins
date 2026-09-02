import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSift } from "@agent-context/sift";
import { retrieveFromSift } from "../lib/retrieve.ts";
import { cleanup, tempDir } from "./helpers.ts";

function compressibleJson(): string {
	const rows = Array.from({ length: 200 }, (_, i) => ({
		id: i,
		title: `Issue #${i}: ${i % 17 === 0 ? "panic in worker pool" : "minor typo in docs"}`,
		state: i % 50 === 0 ? "open" : "closed",
		labels: ["bug", "docs"],
	}));
	return JSON.stringify(rows);
}

describe("native sift instance (opencode)", () => {
	it("round-trips a stashed payload from a new instance on the same dir", () => {
		const root = tempDir("sift-oc-native-");
		try {
			const original = compressibleJson();
			const first = createSift({ stashDir: root });
			const result = first.siftText(
				original,
				"list open issues and worker pool panics",
			);
			assert.equal(result.changed, true);
			assert.ok(result.stashKey);
			const restarted = createSift({ stashDir: root });
			const recovered = retrieveFromSift(restarted, result.stashKey);
			assert.equal(recovered.ok, true);
			if (recovered.ok) assert.equal(recovered.text, original);
		} finally {
			cleanup(root);
		}
	});
});
