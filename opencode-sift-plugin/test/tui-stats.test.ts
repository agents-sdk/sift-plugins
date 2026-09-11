import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	formatTokenCount,
	totalSessionTokensSaved,
} from "../lib/tui-stats.ts";

describe("OpenCode TUI savings", () => {
	it("sums completed Sift tool metadata and ignores invalid values", () => {
		const parts = new Map([
			[
				"m1",
				[
					{
						type: "tool",
						state: {
							status: "completed",
							metadata: { siftTokensSaved: 1_200 },
						},
					},
					{
						type: "tool",
						state: {
							status: "running",
							metadata: { siftTokensSaved: 999 },
						},
					},
				],
			],
			[
				"m2",
				[
					{
						type: "tool",
						state: {
							status: "completed",
							metadata: { siftTokensSaved: 34 },
						},
					},
				],
			],
		]);

		assert.equal(
			totalSessionTokensSaved(
				[{ id: "m1" }, { id: "m2" }],
				(id) => parts.get(id) ?? [],
			),
			1_234,
		);
	});

	it("formats compact token counts for the prompt status area", () => {
		assert.equal(formatTokenCount(999), "999");
		assert.equal(formatTokenCount(1_234), "1.2k");
		assert.equal(formatTokenCount(12_345), "12k");
		assert.equal(formatTokenCount(1_234_567), "1.2m");
	});
});
