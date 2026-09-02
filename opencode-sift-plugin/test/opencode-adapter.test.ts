import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createOpenCodeAfterHandler } from "../lib/after.ts";
import { parseSiftConfig } from "../lib/config.ts";
import { executeOpenCodeRetrieve } from "../lib/retrieve-tool.ts";
import { fakeSift, storeWithFake } from "./helpers.ts";

describe("opencode after hook", () => {
	it("mutates output.output in place and merges metadata", async () => {
		const { store } = storeWithFake();
		const after = createOpenCodeAfterHandler(store, parseSiftConfig());
		const output: {
			title: string;
			output: string;
			metadata: Record<string, unknown>;
		} = {
			title: "bash",
			output: "x".repeat(400),
			metadata: { hostField: true },
		};
		await after(
			{
				tool: "bash",
				sessionID: "sess-1",
				callID: "c1",
				args: { command: "find ." },
			},
			output,
		);
		assert.match(output.output, /<<stash:/);
		assert.equal(output.metadata.hostField, true);
		assert.equal(output.metadata.siftCompressed, true);
	});

	it("skips metadata.error and metadata.truncated", async () => {
		const { store } = storeWithFake();
		const after = createOpenCodeAfterHandler(store, parseSiftConfig());
		const errorOut = {
			title: "bash",
			output: "x".repeat(400),
			metadata: { error: true },
		};
		await after(
			{ tool: "bash", sessionID: "sess-1", callID: "c1", args: {} },
			errorOut,
		);
		assert.equal(errorOut.output, "x".repeat(400));

		const truncated = {
			title: "bash",
			output: "x".repeat(400),
			metadata: { truncated: true },
		};
		await after(
			{ tool: "bash", sessionID: "sess-1", callID: "c1", args: {} },
			truncated,
		);
		assert.equal(truncated.output, "x".repeat(400));
	});

	it("does not pass sourcePath for offset reads", async () => {
		let seen: string | undefined = "unset";
		const sift = fakeSift({
			siftText(text, _hint, sourcePath) {
				seen = sourcePath;
				return {
					text,
					changed: false,
					lossy: false,
					stashKey: null,
					tokensSaved: 0,
				};
			},
		});
		const { store } = storeWithFake(undefined, sift);
		const after = createOpenCodeAfterHandler(store, parseSiftConfig());
		await after(
			{
				tool: "read",
				sessionID: "sess-1",
				callID: "c1",
				args: { filePath: "src/a.ts", offset: 4 },
			},
			{ title: "read", output: "x".repeat(400), metadata: {} },
		);
		assert.equal(seen, undefined);
	});

	it("honors a huge minLength from tuple options", async () => {
		const { store } = storeWithFake();
		const after = createOpenCodeAfterHandler(
			store,
			parseSiftConfig({ minLength: 10_000 }),
		);
		const output = { title: "bash", output: "x".repeat(400), metadata: {} };
		await after(
			{ tool: "bash", sessionID: "sess-1", callID: "c1", args: {} },
			output,
		);
		assert.equal(output.output, "x".repeat(400));
	});
});

describe("opencode retrieve", () => {
	it("uses context.sessionID get-or-create after a process-like cache drop", async () => {
		const { store } = storeWithFake();
		store.getOrCreate("sess-1").siftText("z".repeat(200));
		store.drop("sess-1");
		const text = await executeOpenCodeRetrieve(
			store,
			{ stashKey: "<<stash:0123456789abcdef01234567>>" },
			"sess-1",
		);
		assert.equal(text, "z".repeat(200));
	});

	it("returns JSON for illegal keys", async () => {
		const { store } = storeWithFake();
		const text = await executeOpenCodeRetrieve(
			store,
			{ stashKey: "../etc/passwd" },
			"sess-1",
		);
		assert.match(text, /Invalid stashKey/);
	});
});
