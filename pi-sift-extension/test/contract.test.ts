import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	parseExcludedTools,
	parseMinLengthFromString,
	parseSiftConfig,
} from "../lib/config.ts";
import { extractTextBlocks } from "../lib/content.ts";
import { buildContextHint, readSourcePath } from "../lib/hints.ts";
import { containsValidStashMarker, parseStashKey } from "../lib/keys.ts";
import { retrieveFromSift } from "../lib/retrieve.ts";
import {
	compressToolText,
	mergeSiftDetails,
	shouldSkipCompression,
} from "../lib/compress.ts";
import { loadVectors, fakeSift } from "./helpers.ts";

const vectors = loadVectors();

describe("config", () => {
	it("defaults minLength to 200 and always excludes sift_retrieve", () => {
		const config = parseSiftConfig();
		assert.equal(config.enabled, true);
		assert.equal(config.minLength, vectors.minLength.default);
		assert.deepEqual(config.excludedTools, ["sift_retrieve"]);
	});

	it("accepts a finite positive minLength and numeric strings", () => {
		assert.equal(parseMinLengthFromString(vectors.minLength.validNumber), 512);
		assert.equal(
			parseMinLengthFromString(vectors.minLength.numericString),
			350,
		);
	});

	it("falls back to 200 for invalid minLength", () => {
		assert.equal(
			parseMinLengthFromString(vectors.minLength.invalidString),
			200,
		);
		assert.equal(parseMinLengthFromString(vectors.minLength.zero), 200);
		assert.equal(parseMinLengthFromString(vectors.minLength.negative), 200);
		assert.equal(parseMinLengthFromString(vectors.minLength.nan), 200);
		assert.equal(parseMinLengthFromString(Number.NaN), 200);
	});

	it("unions user excluded tools with sift_retrieve", () => {
		assert.deepEqual(parseExcludedTools(["bash", "sift_retrieve"]), [
			"bash",
			"sift_retrieve",
		]);
		assert.deepEqual(parseExcludedTools("read, grep"), [
			"read",
			"grep",
			"sift_retrieve",
		]);
		assert.deepEqual(parseExcludedTools([1, "ok", null] as unknown[]), [
			"ok",
			"sift_retrieve",
		]);
	});
});

describe("stash keys", () => {
	it("accepts 24-hex keys and complete markers", () => {
		assert.deepEqual(parseStashKey(vectors.keys.validBare), {
			ok: true,
			key: vectors.keys.validBare,
		});
		assert.deepEqual(parseStashKey(vectors.keys.validBareUpper), {
			ok: true,
			key: vectors.keys.validBareUpper,
		});
		assert.deepEqual(parseStashKey(vectors.keys.validMarker), {
			ok: true,
			key: vectors.keys.validBare,
		});
		assert.deepEqual(parseStashKey(vectors.keys.validMarkerWrapped), {
			ok: true,
			key: vectors.keys.validBare,
		});
	});

	it("rejects empty, non-hex, wrong length, and path-like keys", () => {
		for (const raw of [
			vectors.keys.invalidEmpty,
			vectors.keys.invalidWhitespace,
			vectors.keys.invalidShort,
			vectors.keys.invalidLong,
			vectors.keys.invalidNonHex,
			vectors.keys.invalidPath,
			vectors.keys.invalidMarkerBadKey,
			vectors.keys.invalidTraversal,
		]) {
			assert.equal(parseStashKey(raw).ok, false, raw);
		}
	});

	it("detects a valid marker already present in text", () => {
		assert.equal(
			containsValidStashMarker(`hello ${vectors.keys.validMarker}`),
			true,
		);
		assert.equal(containsValidStashMarker("<<stash:not-a-valid-key>>"), false);
	});
});

describe("context hints", () => {
	for (const [name, sample] of Object.entries(vectors.hints)) {
		it(`builds ${name} hint`, () => {
			assert.equal(
				buildContextHint(sample.toolName, sample.input),
				sample.expected,
			);
		});
	}

	it("only supplies sourcePath for complete unoffset read", () => {
		assert.equal(readSourcePath("read", { path: "src/a.ts" }), "src/a.ts");
		assert.equal(readSourcePath("read", { filePath: "src/a.ts" }), "src/a.ts");
		assert.equal(
			readSourcePath("read", { path: "src/a.ts", offset: 10 }),
			undefined,
		);
		assert.equal(
			readSourcePath("read", { path: "src/a.ts", limit: 20 }),
			undefined,
		);
		assert.equal(
			readSourcePath("bash", { command: "cat src/a.ts" }),
			undefined,
		);
	});
});

describe("content extraction", () => {
	it("joins multiple text blocks and skips mixed image+text", () => {
		const joined = extractTextBlocks([
			{ type: "text", text: "one" },
			{ type: "text", text: "two" },
		]);
		assert.deepEqual(joined, { text: "one\ntwo", count: 2 });
		assert.equal(
			extractTextBlocks([
				{ type: "text", text: "one" },
				{ type: "image", data: "xx" },
			]),
			null,
		);
	});
});

describe("retrieve", () => {
	it("returns JSON errors without calling native retrieve on invalid keys", () => {
		let called = false;
		const sift = fakeSift({
			retrieve() {
				called = true;
				return "secret";
			},
		});
		const outcome = retrieveFromSift(sift, "../etc/passwd");
		assert.equal(outcome.ok, false);
		if (!outcome.ok) {
			assert.equal(outcome.json.error, "Invalid stashKey");
			assert.equal(outcome.json.stashKey, "../etc/passwd");
		}
		assert.equal(called, false);
	});

	it("retrieves by bare key and full marker", () => {
		const sift = fakeSift();
		sift.siftText("x".repeat(200));
		const bare = retrieveFromSift(sift, vectors.keys.validBare);
		const marker = retrieveFromSift(sift, vectors.keys.validMarker);
		assert.equal(bare.ok, true);
		assert.equal(marker.ok, true);
		if (bare.ok && marker.ok) assert.equal(bare.text, marker.text);
	});

	it("reports missing session and missing content", () => {
		const noStore = retrieveFromSift(null, vectors.keys.validBare);
		assert.equal(noStore.ok, false);
		if (!noStore.ok)
			assert.equal(noStore.json.error, "No active sift stash store found");

		const missing = retrieveFromSift(fakeSift(), vectors.keys.validBare);
		assert.equal(missing.ok, false);
		if (!missing.ok)
			assert.equal(missing.json.error, "Content not found in stash store");
	});
});

describe("compress skip rules", () => {
	const config = parseSiftConfig({ minLength: 200 });

	it("skips excluded, error, truncated, short, and already-marked text", () => {
		assert.equal(
			shouldSkipCompression(
				{ toolName: "sift_retrieve", text: "x".repeat(400) },
				config,
			),
			"excluded",
		);
		assert.equal(
			shouldSkipCompression(
				{ toolName: "bash", text: "x".repeat(400), isError: true },
				config,
			),
			"error",
		);
		assert.equal(
			shouldSkipCompression(
				{ toolName: "bash", text: "x".repeat(400), truncated: true },
				config,
			),
			"truncated",
		);
		assert.equal(
			shouldSkipCompression({ toolName: "bash", text: "short" }, config),
			"too-short",
		);
		assert.equal(
			shouldSkipCompression(
				{
					toolName: "bash",
					text: `${"x".repeat(400)} ${vectors.keys.validMarker}`,
				},
				config,
			),
			"already-marked",
		);
	});

	it("uses UTF-8 byte length for the minLength filter", () => {
		const text = "你".repeat(100);
		assert.equal(Buffer.byteLength(text, "utf8"), 300);
		assert.equal(
			shouldSkipCompression(
				{ toolName: "bash", text },
				parseSiftConfig({ minLength: 301 }),
			),
			"too-short",
		);
		assert.equal(
			shouldSkipCompression(
				{ toolName: "bash", text },
				parseSiftConfig({ minLength: 300 }),
			),
			null,
		);
	});

	it("merges metadata without dropping existing fields", () => {
		const outcome = compressToolText(
			fakeSift(),
			{ toolName: "bash", text: "x".repeat(200), input: { command: "ls" } },
			config,
		);
		assert.equal(outcome.applied, true);
		if (!outcome.applied) return;
		const merged = mergeSiftDetails(
			{ other: 1, nested: { keep: true } },
			outcome,
		);
		assert.equal(merged.other, 1);
		assert.deepEqual(merged.nested, { keep: true });
		assert.equal(merged.siftCompressed, true);
		assert.equal(merged.siftTokensSaved, 12);
	});
});
