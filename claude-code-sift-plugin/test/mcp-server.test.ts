import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMcpCore } from "../src/mcp/server.ts";
import type { RetrieveOutcome } from "../src/lib/retrieve.ts";

function coreWith(outcomeByCount: RetrieveOutcome[]) {
	const calls: unknown[] = [];
	let i = 0;
	const core = createMcpCore((stashKey) => {
		calls.push(stashKey);
		return outcomeByCount[Math.min(i++, outcomeByCount.length - 1)];
	});
	return { core, calls };
}

describe("mcp server core (stdio JSON-RPC)", () => {
	it("negotiates initialize and echoes the client protocol version", async () => {
		const { core } = coreWith([]);
		const reply = await core.handleMessage({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: { protocolVersion: "2025-03-26" },
		});
		assert.ok(reply);
		const result = (reply as { result: Record<string, unknown> }).result;
		assert.equal(result.protocolVersion, "2025-03-26");
		assert.equal(
			(result.serverInfo as { name: string }).name,
			"sift",
		);
		assert.ok((result.capabilities as { tools?: unknown }).tools);
	});

	it("stays silent for notifications and junk", async () => {
		const { core } = coreWith([]);
		assert.equal(
			await core.handleMessage({
				jsonrpc: "2.0",
				method: "notifications/initialized",
			}),
			null,
		);
		assert.equal(await core.handleMessage("junk"), null);
		assert.equal(await core.handleMessage(null), null);
	});

	it("lists sift_retrieve with a stashKey schema", async () => {
		const { core } = coreWith([]);
		const reply = await core.handleMessage({
			jsonrpc: "2.0",
			id: 2,
			method: "tools/list",
		});
		assert.ok(reply);
		const tools = (reply as { result: { tools: unknown[] } }).result.tools;
		assert.equal(tools.length, 1);
		const tool = tools[0] as {
			name: string;
			inputSchema: { required: string[] };
		};
		assert.equal(tool.name, "sift_retrieve");
		assert.deepEqual(tool.inputSchema.required, ["stashKey"]);
	});

	it("returns the original text on a successful tools/call", async () => {
		const { core, calls } = coreWith([
			{ ok: true, text: "the original payload", stashKey: "0123456789abcdef01234567" },
		]);
		const reply = await core.handleMessage({
			jsonrpc: "2.0",
			id: 3,
			method: "tools/call",
			params: {
				name: "sift_retrieve",
				arguments: { stashKey: "<<stash:0123456789abcdef01234567>>" },
			},
		});
		assert.ok(reply);
		assert.deepEqual(calls, ["<<stash:0123456789abcdef01234567>>"]);
		const content = (reply as { result: { content: { type: string; text: string }[] } })
			.result.content;
		assert.equal(content[0].type, "text");
		assert.equal(content[0].text, "the original payload");
	});

	it("returns the sibling-compatible error JSON on misses", async () => {
		const { core } = coreWith([
			{
				ok: false,
				json: {
					error: "Content not found in stash store",
					hint: "re-run the original tool",
					stashKey: "0123456789abcdef01234567",
				},
			},
		]);
		const reply = await core.handleMessage({
			jsonrpc: "2.0",
			id: 4,
			method: "tools/call",
			params: { name: "sift_retrieve", arguments: { stashKey: "0123456789abcdef01234567" } },
		});
		assert.ok(reply);
		const content = (reply as { result: { content: { text: string }[] } }).result
			.content;
		const parsed = JSON.parse(content[0].text) as { error: string; hint: string };
		assert.equal(parsed.error, "Content not found in stash store");
		assert.ok(parsed.hint);
	});

	it("rejects unknown tools and methods with JSON-RPC errors", async () => {
		const { core } = coreWith([]);
		const toolReply = (await core.handleMessage({
			jsonrpc: "2.0",
			id: 5,
			method: "tools/call",
			params: { name: "other_tool", arguments: {} },
		})) as { error: { code: number } };
		assert.equal(toolReply.error.code, -32602);

		const methodReply = (await core.handleMessage({
			jsonrpc: "2.0",
			id: 6,
			method: "resources/list",
		})) as { error: { code: number } };
		assert.equal(methodReply.error.code, -32601);
	});

	it("answers ping", async () => {
		const { core } = coreWith([]);
		const reply = await core.handleMessage({ jsonrpc: "2.0", id: 7, method: "ping" });
		assert.ok(reply);
		assert.deepEqual((reply as { result: unknown }).result, {});
	});
});
