import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { STASH_TTL_MS } from "../lib/config.ts";
import {
	assertOutsideWorktree,
	encodeSessionId,
	openCodeStashRoot,
	piStashRoot,
	SessionSiftStore,
} from "../lib/session-store.ts";
import { cleanup, fakeSift, tempDir, writeExpiredStash } from "./helpers.ts";

const dirs: string[] = [];
afterEach(() => {
	while (dirs.length) cleanup(dirs.pop()!);
});

describe("stash paths", () => {
	it("uses PI_CODING_AGENT_DIR rather than a project sessionDir", () => {
		assert.equal(
			piStashRoot({ PI_CODING_AGENT_DIR: "/tmp/custom-pi-agent" }),
			"/tmp/custom-pi-agent/sift",
		);
		assert.match(piStashRoot({}), /\/\.pi\/agent\/sift$/);
	});

	it("aligns OpenCode stash with XDG data home", () => {
		assert.equal(
			openCodeStashRoot({ XDG_DATA_HOME: "/tmp/xdg-data" }),
			"/tmp/xdg-data/opencode/sift",
		);
	});

	it("encodes unsafe session ids and rejects empty ones", () => {
		assert.equal(encodeSessionId("abc"), "abc");
		assert.match(encodeSessionId("a/../b"), /_/);
		assert.throws(() => encodeSessionId(""));
		assert.throws(() => encodeSessionId(".."));
	});

	it("refuses to place stash inside a worktree", () => {
		const worktree = tempDir("sift-worktree-");
		dirs.push(worktree);
		assert.throws(() =>
			assertOutsideWorktree(join(worktree, "sift", "sess"), worktree),
		);
		assert.doesNotThrow(() =>
			assertOutsideWorktree("/tmp/sift-outside", worktree),
		);
	});
});

describe("session store", () => {
	it("get-or-create is per session and survives a cache drop", () => {
		const root = tempDir("sift-store-");
		dirs.push(root);
		const store = new SessionSiftStore(root, undefined, () => fakeSift());
		const a = store.getOrCreate("session-a");
		const again = store.getOrCreate("session-a");
		assert.equal(a, again);
		store.drop("session-a");
		assert.equal(store.has("session-a"), false);
		const recreated = store.getOrCreate("session-a");
		assert.notEqual(recreated, a);
		assert.equal(existsSync(join(root, encodeSessionId("session-a"))), true);
	});

	it("purges expired stash files and leaves live ones", () => {
		const root = tempDir("sift-purge-");
		dirs.push(root);
		const sessionDir = join(root, "sess");
		mkdirSync(sessionDir, { recursive: true });
		writeExpiredStash(
			sessionDir,
			"deadkeydeadkeydeadkeyde",
			STASH_TTL_MS + 1000,
		);
		writeFileSync(join(sessionDir, "livekeylivekeylivekeyli"), "keep");
		const store = new SessionSiftStore(root);
		assert.equal(store.purgeExpired(), 1);
		assert.equal(
			existsSync(join(sessionDir, "deadkeydeadkeydeadkeyde")),
			false,
		);
		assert.equal(existsSync(join(sessionDir, "livekeylivekeylivekeyli")), true);
	});
});
