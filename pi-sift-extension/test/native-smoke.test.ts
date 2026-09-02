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

describe("native sift instance", () => {
	it("compresses, retrieves by marker, and isolates sessions", () => {
		const rootA = tempDir("sift-native-a-");
		const rootB = tempDir("sift-native-b-");
		try {
			const a = createSift({ stashDir: rootA });
			const b = createSift({ stashDir: rootB });
			const original = compressibleJson();
			const result = a.siftText(
				original,
				"list open issues and worker pool panics",
			);
			assert.equal(result.changed, true);
			assert.ok(result.stashKey);
			assert.match(result.text, /<<stash:[0-9a-fA-F]{24}>>/);
			assert.ok(result.text.length < original.length);

			const viaMarker = retrieveFromSift(a, `<<stash:${result.stashKey}>>`);
			assert.equal(viaMarker.ok, true);
			if (viaMarker.ok) assert.equal(viaMarker.text, original);

			const viaBare = retrieveFromSift(a, result.stashKey);
			assert.equal(viaBare.ok, true);

			const other = retrieveFromSift(b, result.stashKey);
			assert.equal(other.ok, false);
			if (!other.ok)
				assert.equal(other.json.error, "Content not found in stash store");
		} finally {
			cleanup(rootA);
			cleanup(rootB);
		}
	});
});
