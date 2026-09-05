import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isSelfToolCall } from "../src/env.ts";
import { parseSiftConfig } from "../src/lib/config.ts";
import { createPostToolUseHandler } from "../src/hooks/post-tool-use.ts";
import { fakeSift, storeWithFake } from "./helpers.ts";

describe("claude code post-tool-use handler", () => {
	it("compresses Bash stdout and preserves the response shape", () => {
		const { store } = storeWithFake();
		const handler = createPostToolUseHandler(store, parseSiftConfig());
		const out = handler({
			session_id: "sess-1",
			hook_event_name: "PostToolUse",
			tool_name: "Bash",
			tool_input: { command: "gh api issues", description: "" },
			tool_response: {
				stdout: "x".repeat(400),
				stderr: "",
				interrupted: false,
				isImage: false,
				noOutputExpected: false,
			},
		});
		assert.ok(out);
		const rewritten = out.updatedToolOutput as Record<string, unknown>;
		assert.match(String(rewritten.stdout), /<<stash:/);
		// Non-compressed fields must keep their original values and types —
		// a schema mismatch would make Claude Code silently drop the rewrite.
		assert.equal(rewritten.stderr, "");
		assert.equal(rewritten.interrupted, false);
		assert.equal(rewritten.isImage, false);
		assert.equal(rewritten.noOutputExpected, false);
		assert.equal(out.lossy, true);
		assert.equal(out.compressedFields, 1);
	});

	it("compresses Read file.content in place (empirical shape)", () => {
		const { store } = storeWithFake();
		const handler = createPostToolUseHandler(store, parseSiftConfig());
		const out = handler({
			session_id: "sess-1",
			tool_name: "Read",
			tool_input: { file_path: "/tmp/a.json" },
			tool_response: {
				type: "text",
				file: {
					filePath: "/tmp/a.json",
					content: "y".repeat(400),
					numLines: 30,
					startLine: 1,
					totalLines: 30,
				},
			},
		});
		assert.ok(out);
		const rewritten = out.updatedToolOutput as {
			type: string;
			file: Record<string, unknown>;
		};
		assert.equal(rewritten.type, "text");
		assert.equal(rewritten.file.filePath, "/tmp/a.json");
		assert.equal(rewritten.file.numLines, 30);
		assert.match(String(rewritten.file.content), /<<stash:/);
	});

	it("compresses Grep content in place (empirical shape)", () => {
		const { store } = storeWithFake();
		const handler = createPostToolUseHandler(store, parseSiftConfig());
		const out = handler({
			session_id: "sess-1",
			tool_name: "Grep",
			tool_input: { pattern: "needle", path: "/tmp" },
			tool_response: {
				mode: "content",
				numFiles: 2,
				filenames: ["/tmp/a.txt", "/tmp/b.txt"],
				content: "z".repeat(400),
				numLines: 12,
			},
		});
		assert.ok(out);
		const rewritten = out.updatedToolOutput as Record<string, unknown>;
		assert.equal(rewritten.mode, "content");
		assert.equal(rewritten.numFiles, 2);
		assert.deepEqual(rewritten.filenames, ["/tmp/a.txt", "/tmp/b.txt"]);
		assert.match(String(rewritten.content), /<<stash:/);
	});

	it("does not pass sourcePath for offset reads", () => {
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
		const handler = createPostToolUseHandler(store, parseSiftConfig());
		handler({
			session_id: "sess-1",
			tool_name: "Read",
			tool_input: { file_path: "/tmp/a.ts", offset: 4 },
			tool_response: {
				type: "text",
				file: {
					filePath: "/tmp/a.ts",
					content: "x".repeat(400),
					numLines: 40,
					startLine: 4,
					totalLines: 100,
				},
			},
		});
		assert.equal(seen, undefined);
	});

	it("skips host-truncated outputs", () => {
		const { store } = storeWithFake();
		const handler = createPostToolUseHandler(store, parseSiftConfig());
		const cases = [
			{ truncated: true, filenames: [], durationMs: 3, numFiles: 500 },
			{ mode: "content", numFiles: 1, filenames: [], content: "x".repeat(400), numLines: 250, appliedLimit: 250 },
			{
				type: "text",
				file: { filePath: "/tmp/a", content: "x".repeat(400), numLines: 100, startLine: 1, totalLines: 3000 },
			},
		];
		for (const tool_response of cases) {
			assert.equal(
				handler({
					session_id: "sess-1",
					tool_name: "Read",
					tool_input: { file_path: "/tmp/a" },
					tool_response,
				}),
				null,
				JSON.stringify(tool_response).slice(0, 80),
			);
		}
	});

	it("never compresses its own retrieve tool under any name", () => {
		const { store } = storeWithFake();
		const handler = createPostToolUseHandler(store, parseSiftConfig());
		for (const tool_name of [
			"sift_retrieve",
			"mcp__plugin_claude-code-sift_sift__sift_retrieve",
		]) {
			assert.equal(
				handler({
					session_id: "sess-1",
					tool_name,
					tool_input: { stashKey: "0123456789abcdef01234567" },
					tool_response: { content: [{ type: "text", text: "x".repeat(400) }] },
				}),
				null,
			);
		}
		assert.equal(isSelfToolCall("sift_retrieve"), true);
		assert.equal(isSelfToolCall("Read"), false);
	});

	it("skips disabled config, excluded tools, short output and junk input", () => {
		const { store } = storeWithFake();
		const disabled = createPostToolUseHandler(
			store,
			parseSiftConfig({ enabled: false }),
		);
		assert.equal(
			disabled({
				session_id: "s",
				tool_name: "Bash",
				tool_response: { stdout: "x".repeat(400) },
			}),
			null,
		);

		const excluded = createPostToolUseHandler(
			store,
			parseSiftConfig({ excludedTools: ["Bash"] }),
		);
		assert.equal(
			excluded({
				session_id: "s",
				tool_name: "Bash",
				tool_response: { stdout: "x".repeat(400) },
			}),
			null,
		);

		const handler = createPostToolUseHandler(store, parseSiftConfig());
		assert.equal(
			handler({
				session_id: "s",
				tool_name: "Bash",
				tool_response: { stdout: "too short" },
			}),
			null,
		);
		assert.equal(handler({}), null);
		assert.equal(handler("junk"), null);
		assert.equal(
			handler({ tool_name: "Bash", tool_response: { stdout: "x".repeat(400) } }),
			null,
		);
	});

	it("honors a huge minLength", () => {
		const { store } = storeWithFake();
		const handler = createPostToolUseHandler(
			store,
			parseSiftConfig({ minLength: 10_000 }),
		);
		assert.equal(
			handler({
				session_id: "s",
				tool_name: "Bash",
				tool_response: { stdout: "x".repeat(400) },
			}),
			null,
		);
	});

	it("retrieves after a process-like cache drop", () => {
		const { store } = storeWithFake();
		const handler = createPostToolUseHandler(store, parseSiftConfig());
		const out = handler({
			session_id: "sess-1",
			tool_name: "Bash",
			tool_input: {},
			tool_response: { stdout: "w".repeat(300) },
		});
		assert.ok(out);
		store.drop("sess-1");
		const sift = store.getOrCreate("sess-1");
		assert.equal(sift.retrieve("0123456789abcdef01234567"), "w".repeat(300));
	});
});
