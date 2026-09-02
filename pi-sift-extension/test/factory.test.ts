import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import siftExtension, { readSiftConfig } from "../index.ts";
import { cleanup, tempDir } from "./helpers.ts";

type Handler = (...args: unknown[]) => unknown;

function mockPi(flags: Record<string, boolean | string> = {}) {
	const handlers = new Map<string, Handler[]>();
	const tools: unknown[] = [];
	const registeredFlags: string[] = [];
	const pi = {
		registerFlag(name: string) {
			registeredFlags.push(name);
		},
		getFlag(name: string) {
			return flags[name];
		},
		on(event: string, handler: Handler) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},
		registerTool(tool: unknown) {
			tools.push(tool);
		},
	};
	return { pi, handlers, tools, registeredFlags };
}

const originalEnabled = process.env.SIFT_ENABLED;
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const dirs: string[] = [];

afterEach(() => {
	if (originalEnabled === undefined) delete process.env.SIFT_ENABLED;
	else process.env.SIFT_ENABLED = originalEnabled;
	if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
	while (dirs.length) cleanup(dirs.pop()!);
});

describe("pi factory", () => {
	it("registers flags, hook, retrieve tool, and promptSnippet", () => {
		const agentDir = tempDir("sift-pi-agent-");
		dirs.push(agentDir);
		process.env.PI_CODING_AGENT_DIR = agentDir;
		const { pi, handlers, tools, registeredFlags } = mockPi();
		siftExtension(pi as never);
		assert.deepEqual(registeredFlags, [
			"sift",
			"no-sift",
			"sift-min-length",
			"sift-exclude",
		]);
		assert.ok(handlers.has("session_start"));
		for (const handler of handlers.get("session_start") ?? []) handler();
		assert.ok(handlers.has("tool_result"));
		assert.ok(handlers.has("session_shutdown"));
		assert.equal(tools.length, 1);
		assert.equal((tools[0] as { name: string }).name, "sift_retrieve");
		assert.ok((tools[0] as { promptSnippet?: string }).promptSnippet);
	});

	it("does not register tools when SIFT_ENABLED=0", () => {
		process.env.SIFT_ENABLED = "0";
		const { pi, tools, handlers } = mockPi();
		siftExtension(pi as never);
		assert.equal(tools.length, 0);
		assert.equal(handlers.has("tool_result"), false);
	});

	it("does not wire hooks when --no-sift is set after session_start", () => {
		const agentDir = tempDir("sift-pi-agent-");
		dirs.push(agentDir);
		process.env.PI_CODING_AGENT_DIR = agentDir;
		const flags: Record<string, boolean | string> = { "no-sift": true };
		const { pi, handlers, tools } = mockPi(flags);
		siftExtension(pi as never);
		for (const handler of handlers.get("session_start") ?? []) handler();
		assert.equal(tools.length, 0);
		assert.equal(handlers.has("tool_result"), false);
		assert.equal(readSiftConfig(pi as never).enabled, false);
	});
});
