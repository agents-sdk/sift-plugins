import assert from "node:assert/strict";
import test from "node:test";
import { createPostExecuteHandler, isTruncatedResult } from "../index.js";
import { SavingsStats } from "../lib/stats.js";

function fixture(result = { text: "compressed", changed: true, tokensSaved: 42, lossy: false, stashKey: null }) {
	const sift = { siftText: () => result, retrieve: () => null };
	return {
		store: { getOrCreate: () => sift },
		stats: new SavingsStats(),
		config: { enabled: true, minLength: 1, excludedTools: ["sift_retrieve"], showSavings: "command" },
		logger: { info() {} },
	};
}

test("compresses the downstream accepted text and tracks session savings", async () => {
	const f = fixture();
	const handler = createPostExecuteHandler(f.store, f.stats, f.config, f.logger);
	const decision = await handler(
		{ name: "bash", callId: "call-1", arguments: { command: "build" }, agent: { session: { id: "session-1" } } },
		{ isError: false, content: [{ type: "text", text: "original" }] },
		async () => ({ kind: "accept", content: [{ type: "text", text: "downstream" }], additionalContexts: [{ role: "user" }] }),
	);
	assert.deepEqual(decision, { kind: "accept", content: [{ type: "text", text: "compressed" }], additionalContexts: [{ role: "user" }] });
	assert.equal(f.stats.session("session-1"), 42);
});

test("passes through blocks, failures, nested calls, and value replacements", async () => {
	for (const [execPatch, result, downstream] of [
		[{}, { isError: true, content: [{ type: "text", text: "failure" }] }, { kind: "accept" }],
		[{ parent: Symbol("parent") }, { isError: false, content: [{ type: "text", text: "nested" }] }, { kind: "accept" }],
		[{}, { isError: false, content: [{ type: "image" }] }, { kind: "accept" }],
		[{}, { isError: false, content: [{ type: "text", text: "value" }] }, { kind: "accept", value: { ok: true } }],
	]) {
		const f = fixture();
		const handler = createPostExecuteHandler(f.store, f.stats, f.config, f.logger);
		const actual = await handler(
			{ name: "bash", callId: "call", arguments: {}, agent: { session: { id: "session" } }, ...execPatch },
			result,
			async () => downstream,
		);
		assert.equal(actual, downstream);
	}
});

test("detects dsh truncation metadata and partial read values", () => {
	assert.equal(isTruncatedResult({ name: "bash" }, { value: { stdout: { truncated: true } } }), true);
	assert.equal(isTruncatedResult({ name: "web_fetch" }, { meta: { truncated: true } }), true);
	assert.equal(isTruncatedResult({ name: "read" }, { value: { lines: [{ number: 10 }], totalLines: 20 } }), true);
	assert.equal(isTruncatedResult({ name: "read" }, { value: { lines: [{ number: 20 }], totalLines: 20 } }), false);
});
