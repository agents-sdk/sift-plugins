import assert from "node:assert/strict";
import test from "node:test";
import { formatTokenCount, SavingsStats } from "../lib/stats.js";

test("savings are per-session, process-wide, and deduplicated by call", () => {
	const stats = new SavingsStats();
	assert.equal(stats.record("a", "1", 1200), true);
	assert.equal(stats.record("a", "1", 1200), false);
	assert.equal(stats.record("b", "1", 800), true);
	assert.equal(stats.session("a"), 1200);
	assert.equal(stats.total, 2000);
	assert.equal(formatTokenCount(stats.session("a")), "1.2k");
});
