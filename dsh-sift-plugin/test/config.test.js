import assert from "node:assert/strict";
import test from "node:test";
import { parseSiftConfig } from "../lib/config.js";

test("config defaults match sibling Sift plugins", () => {
	assert.deepEqual(parseSiftConfig(), {
		enabled: true,
		minLength: 200,
		excludedTools: ["sift_retrieve"],
		showSavings: "command",
	});
});

test("config validates dsh patch input loudly", () => {
	assert.throws(() => parseSiftConfig({ minLength: 0 }), /positive integer/);
	assert.throws(() => parseSiftConfig({ excludedTools: "bash" }), /array/);
	assert.throws(() => parseSiftConfig({ showSavings: "status" }), /command/);
});
