import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSiftConfig } from "../lib/config.ts";
import { buildContextHint } from "../lib/hints.ts";
import { parseStashKey } from "../lib/keys.ts";
import { retrieveFromSift } from "../lib/retrieve.ts";
import { fakeSift, loadVectors } from "./helpers.ts";

const vectors = loadVectors();

describe("opencode contract parity", () => {
	it("parses tuple options including invalid minLength", () => {
		const config = parseSiftConfig({
			minLength: 99999,
			excludedTools: ["bash"],
		});
		assert.equal(config.minLength, 99999);
		assert.ok(config.excludedTools.includes("sift_retrieve"));
		assert.ok(config.excludedTools.includes("bash"));
		assert.equal(parseSiftConfig({ minLength: "nope" }).minLength, 200);
		assert.equal(parseSiftConfig({ enabled: false }).enabled, false);
	});

	it("accepts markers and rejects illegal keys without retrieve", () => {
		assert.equal(parseStashKey(vectors.keys.validMarker).ok, true);
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

	it("builds OpenCode read/glob hints", () => {
		assert.equal(
			buildContextHint("read", { filePath: "src/index.ts" }),
			"file content of src/index.ts",
		);
		assert.equal(
			buildContextHint("glob", { pattern: "**/*.ts" }),
			"glob results for **/*.ts",
		);
	});
});
