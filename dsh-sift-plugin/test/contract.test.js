import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildContextHint } from "../lib/hints.js";
import { parseStashKey } from "../lib/keys.js";

const vectors = JSON.parse(await readFile(new URL("../../docs/contract-vectors.json", import.meta.url), "utf8"));

test("matches shared stash-key contract vectors", () => {
	for (const name of ["validBare", "validBareUpper", "validMarker", "validMarkerWrapped"]) {
		assert.equal(parseStashKey(vectors.keys[name]).ok, true, name);
	}
	for (const name of ["invalidEmpty", "invalidWhitespace", "invalidShort", "invalidLong", "invalidNonHex", "invalidPath", "invalidMarkerBadKey", "invalidTraversal"]) {
		assert.equal(parseStashKey(vectors.keys[name]).ok, false, name);
	}
});

test("matches shared context-hint contract vectors", () => {
	for (const vector of Object.values(vectors.hints)) {
		assert.equal(buildContextHint(vector.toolName, vector.input), vector.expected);
	}
	assert.equal(buildContextHint("read", { file_path: "src/dsh.ts" }), "file content of src/dsh.ts");
});
