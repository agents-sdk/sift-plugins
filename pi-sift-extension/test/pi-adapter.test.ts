import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	createToolResultHandler,
	type PiToolResultEvent,
} from "../hooks/tool-result.ts";
import { parseSiftConfig } from "../lib/config.ts";
import { createSiftRetrieveTool } from "../tools/sift-retrieve.ts";
import { fakeSift, storeWithFake } from "./helpers.ts";

function event(
	partial: Partial<PiToolResultEvent> &
		Pick<PiToolResultEvent, "toolName" | "content">,
): PiToolResultEvent {
	return {
		type: "tool_result",
		toolCallId: "call-1",
		input: {},
		isError: false,
		...partial,
	};
}

describe("pi tool_result adapter", () => {
	it("returns a local content/details patch and keeps foreign details", () => {
		const { store } = storeWithFake();
		const handler = createToolResultHandler(store, parseSiftConfig());
		const patch = handler(
			event({
				toolName: "bash",
				input: { command: "find ." },
				content: [{ type: "text", text: "x".repeat(400) }],
				details: { truncation: { truncated: false }, hostField: "keep" },
			}),
			{ sessionManager: { getSessionId: () => "sess-1" } },
		);
		assert.ok(patch);
		assert.equal(patch?.content?.[0]?.type, "text");
		assert.match(patch?.content?.[0]?.text ?? "", /<<stash:/);
		const details = patch?.details as Record<string, unknown>;
		assert.equal(details.hostField, "keep");
		assert.equal(details.siftCompressed, true);
	});

	it("skips errors, mixed image content, and truncated reads", () => {
		const { store } = storeWithFake();
		const handler = createToolResultHandler(store, parseSiftConfig());
		const ctx = { sessionManager: { getSessionId: () => "sess-1" } };
		assert.equal(
			handler(
				event({
					toolName: "bash",
					isError: true,
					content: [{ type: "text", text: "x".repeat(400) }],
				}),
				ctx,
			),
			undefined,
		);
		assert.equal(
			handler(
				event({
					toolName: "read",
					content: [
						{ type: "text", text: "x".repeat(400) },
						{ type: "image", data: "qq" },
					],
				}),
				ctx,
			),
			undefined,
		);
		assert.equal(
			handler(
				event({
					toolName: "read",
					input: { path: "big.ts" },
					content: [{ type: "text", text: "x".repeat(400) }],
					details: { truncation: { truncated: true } },
				}),
				ctx,
			),
			undefined,
		);
	});

	it("does not pass sourcePath for offset/limit reads", () => {
		let seenSource: string | undefined = "unset";
		const sift = fakeSift({
			siftText(text, _hint, sourcePath) {
				seenSource = sourcePath;
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
		const handler = createToolResultHandler(store, parseSiftConfig());
		handler(
			event({
				toolName: "read",
				input: { path: "src/a.ts", offset: 10, limit: 20 },
				content: [{ type: "text", text: "x".repeat(400) }],
			}),
			{ sessionManager: { getSessionId: () => "sess-1" } },
		);
		assert.equal(seenSource, undefined);
	});

	it("joins multiple text blocks instead of dropping later ones", () => {
		let seen = "";
		const sift = fakeSift({
			siftText(text) {
				seen = text;
				return {
					text: "compressed",
					changed: true,
					lossy: false,
					stashKey: null,
					tokensSaved: 4,
				};
			},
		});
		const { store } = storeWithFake(undefined, sift);
		const handler = createToolResultHandler(store, parseSiftConfig());
		handler(
			event({
				toolName: "bash",
				content: [
					{ type: "text", text: "first-block" },
					{ type: "text", text: "x".repeat(200) },
				],
			}),
			{ sessionManager: { getSessionId: () => "sess-1" } },
		);
		assert.match(seen, /first-block/);
		assert.match(seen, /x{200}/);
	});
});

describe("pi retrieve tool", () => {
	it("registers promptSnippet and returns JSON for invalid keys", async () => {
		const { store } = storeWithFake();
		const tool = createSiftRetrieveTool(store);
		assert.ok(tool.promptSnippet);
		assert.ok(tool.promptGuidelines?.length);
		const result = await tool.execute(
			"id",
			{ stashKey: "../etc/passwd" },
			new AbortController().signal,
			() => {},
			{
				sessionManager: { getSessionId: () => "sess-1" },
			},
		);
		const payload = JSON.parse(result.content[0].text);
		assert.equal(payload.error, "Invalid stashKey");
	});

	it("retrieves after cache drop using the current session id", async () => {
		const { store } = storeWithFake();
		store.getOrCreate("sess-1").siftText("y".repeat(200));
		store.drop("sess-1");
		const tool = createSiftRetrieveTool(store);
		const result = await tool.execute(
			"id",
			{ stashKey: "0123456789abcdef01234567" },
			new AbortController().signal,
			() => {},
			{ sessionManager: { getSessionId: () => "sess-1" } },
		);
		assert.equal(result.details.found, true);
		assert.equal(result.content[0].text, "y".repeat(200));
	});
});
