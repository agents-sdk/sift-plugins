import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compressToolText } from "../lib/compress.js";
import { SessionSiftStore } from "../lib/session-store.js";

test("loads the native Sift package and compresses a realistic tool result", () => {
	const root = mkdtempSync(join(tmpdir(), "dsh-sift-"));
	try {
		const store = new SessionSiftStore(root);
		const log = Array.from({ length: 200 }, (_, index) => `INFO request completed status=200 route=/items duration=${index % 5}ms`).join("\n");
		const outcome = compressToolText(
			store.getOrCreate("native-smoke"),
			{ toolName: "bash", text: log, input: { command: "run server" } },
			{ minLength: 200, excludedTools: ["sift_retrieve"] },
		);
		assert.equal(outcome.applied, true);
		if (outcome.applied) assert.ok(outcome.tokensSaved > 0);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
