import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	compressToolResponse,
	hasLargeString,
	isTruncatedToolResponse,
} from "../src/lib/response-shape.ts";

const compressIfLong = (min: number) => (text: string) =>
	text.length >= min
		? {
				applied: true as const,
				text: `${text.slice(0, 10)}…[compressed]`,
				tokensSaved: 5,
				lossy: true,
				stashKey: "0123456789abcdef01234567",
			}
		: ({ applied: false as const, reason: "too-short" });

describe("response-shape deep walk", () => {
	it("keeps uncompressed strings as strings (schema preservation)", () => {
		const result = compressToolResponse(
			{
				type: "text",
				filePath: "/tmp/a.json",
				stderr: "",
				interrupted: false,
				nested: { note: "keep me", payload: "x".repeat(300) },
			},
			compressIfLong(200),
		);
		assert.equal(result.changed, true);
		const value = result.value as Record<string, unknown>;
		assert.equal(value.type, "text");
		assert.equal(value.filePath, "/tmp/a.json");
		assert.equal(value.stderr, "");
		assert.equal(value.interrupted, false);
		const nested = value.nested as Record<string, unknown>;
		assert.equal(nested.note, "keep me");
		assert.equal(nested.payload, "x".repeat(10) + "…[compressed]");
		assert.equal(result.compressedFields, 1);
	});

	it("returns the value untouched when nothing compresses", () => {
		const response = { a: "short", b: 1, c: null, d: ["also short"] };
		const result = compressToolResponse(response, compressIfLong(200));
		assert.equal(result.changed, false);
		assert.deepEqual(result.value, response);
	});

	it("joins pure text-block arrays into one compressed block", () => {
		const result = compressToolResponse(
			[
				{ type: "text", text: "a".repeat(150) },
				{ type: "text", text: "b".repeat(150) },
			],
			compressIfLong(200),
		);
		assert.equal(result.changed, true);
		const blocks = result.value as { type: string; text: string }[];
		assert.equal(blocks.length, 1);
		assert.equal(blocks[0].type, "text");
		assert.match(blocks[0].text, /\[compressed\]/);
	});

	it("leaves mixed image+text arrays to the element walk", () => {
		const result = compressToolResponse(
			[
				{ type: "text", text: "x".repeat(300) },
				{ type: "image", data: "zzz", source: { id: 7 } },
			],
			compressIfLong(200),
		);
		assert.equal(result.changed, true);
		const blocks = result.value as Record<string, unknown>[];
		assert.match(String(blocks[0].text), /\[compressed\]/);
		assert.deepEqual(blocks[1], { type: "image", data: "zzz", source: { id: 7 } });
	});

	it("compresses a top-level string response", () => {
		const result = compressToolResponse("y".repeat(400), compressIfLong(200));
		assert.equal(result.changed, true);
		assert.match(String(result.value), /\[compressed\]/);
	});

	it("stops at the depth guard without throwing", () => {
		let deep: unknown = "x".repeat(300);
		for (let i = 0; i < 30; i++) deep = { level: deep };
		const result = compressToolResponse(deep, compressIfLong(200));
		assert.equal(result.changed, false);
		assert.ok(result.value);
	});

	it("pre-scans for large strings cheaply", () => {
		assert.equal(hasLargeString({ a: { b: ["short"] } }, 200), false);
		assert.equal(
			hasLargeString({ a: { b: [{ c: "x".repeat(300) }] } }, 200),
			true,
		);
		assert.equal(hasLargeString("x".repeat(300), 200), true);
		assert.equal(hasLargeString({ n: 5, flag: true }, 200), false);
	});

	it("detects the empirical truncation signals", () => {
		assert.equal(isTruncatedToolResponse({ truncated: true }), true);
		assert.equal(isTruncatedToolResponse({ truncated: false }), false);
		assert.equal(
			isTruncatedToolResponse({ numLines: 250, appliedLimit: 250, content: "" }),
			true,
		);
		assert.equal(
			isTruncatedToolResponse({ numLines: 58, appliedLimit: 250, content: "" }),
			false,
		);
		assert.equal(
			isTruncatedToolResponse({
				file: { numLines: 100, totalLines: 3000, content: "" },
			}),
			true,
		);
		assert.equal(
			isTruncatedToolResponse(
				{ file: { numLines: 100, totalLines: 3000, content: "" } },
				true,
			),
			false,
		);
		assert.equal(
			isTruncatedToolResponse(
				{ truncated: true, file: { numLines: 100, totalLines: 3000, content: "" } },
				true,
			),
			true,
		);
		assert.equal(
			isTruncatedToolResponse({
				file: { numLines: 3000, totalLines: 3000, content: "" },
			}),
			false,
		);
		assert.equal(isTruncatedToolResponse(null), false);
		assert.equal(isTruncatedToolResponse("string"), false);
	});
});
