import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readSiftConfigFromEnv } from "../src/env.ts";
import { buildContextHint, readSourcePath } from "../src/lib/hints.ts";
import { parseStashKey } from "../src/lib/keys.ts";
import { retrieveFromSift } from "../src/lib/retrieve.ts";
import { fakeSift, loadVectors } from "./helpers.ts";

const vectors = loadVectors();

describe("claude code contract parity", () => {
	it("parses env config including invalid minLength", () => {
		assert.equal(readSiftConfigFromEnv({}).minLength, 200);
		assert.equal(
			readSiftConfigFromEnv({ SIFT_MIN_LENGTH: "350" }).minLength,
			350,
		);
		assert.equal(
			readSiftConfigFromEnv({ SIFT_MIN_LENGTH: "nope" }).minLength,
			200,
		);
		assert.equal(
			readSiftConfigFromEnv({ SIFT_MIN_LENGTH: String(vectors.minLength.validNumber) })
				.minLength,
			vectors.minLength.validNumber,
		);
		assert.equal(readSiftConfigFromEnv({ SIFT_ENABLED: "0" }).enabled, false);
		assert.equal(readSiftConfigFromEnv({ SIFT_ENABLED: "off" }).enabled, false);
		assert.equal(readSiftConfigFromEnv({ SIFT_ENABLED: "1" }).enabled, true);
		assert.equal(readSiftConfigFromEnv({}).enabled, true);

		const excluded = readSiftConfigFromEnv({
			SIFT_EXCLUDED_TOOLS: "Read,Grep",
		}).excludedTools;
		assert.ok(excluded.includes("sift_retrieve"));
		assert.ok(excluded.includes("Read"));
		assert.ok(excluded.includes("Grep"));
	});

	it("accepts markers and rejects illegal keys without retrieve", () => {
		assert.equal(parseStashKey(vectors.keys.validMarker).ok, true);
		assert.equal(parseStashKey(vectors.keys.validBare).ok, true);
		assert.equal(parseStashKey(vectors.keys.invalidPath).ok, false);
		let called = false;
		retrieveFromSift(
			fakeSift({
				retrieve() {
					called = true;
					return "nope";
				},
			}),
			vectors.keys.invalidPath,
		);
		assert.equal(called, false);
	});

	it("keeps lowercase-host hint parity (vectors)", () => {
		for (const vector of Object.values(vectors.hints)) {
			if (["readPi", "readOpenCode"].includes(vector.toolName)) continue;
			assert.equal(
				buildContextHint(vector.toolName, vector.input),
				vector.expected,
			);
		}
	});

	it("builds Claude Code PascalCase hints", () => {
		assert.equal(
			buildContextHint("Bash", { command: "pnpm build" }),
			"shell command output: pnpm build",
		);
		assert.equal(
			buildContextHint("Read", { file_path: "src/index.ts" }),
			"file content of src/index.ts",
		);
		assert.equal(
			buildContextHint("Grep", { pattern: "TODO" }),
			"grep results for TODO",
		);
		assert.equal(
			buildContextHint("Glob", { pattern: "**/*.ts" }),
			"glob results for **/*.ts",
		);
		assert.equal(
			buildContextHint("LS", { path: "/tmp" }),
			"directory listing of /tmp",
		);
		assert.equal(buildContextHint("WebFetch", { url: "https://x.dev" }), "web fetch/search output");
		assert.equal(
			buildContextHint("Task", { description: "explore the repo" }),
			"subagent task output: explore the repo",
		);
	});

	it("derives sourcePath from file_path and withholds it for partial reads", () => {
		assert.equal(
			readSourcePath("Read", { file_path: "src/a.ts" }),
			"src/a.ts",
		);
		assert.equal(
			readSourcePath("Read", { file_path: "src/a.ts", offset: 4 }),
			undefined,
		);
		assert.equal(
			readSourcePath("Read", { file_path: "src/a.ts", limit: 50 }),
			undefined,
		);
		assert.equal(readSourcePath("Grep", { pattern: "x" }), undefined);
	});
});
