import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import plugin from "../index.ts";
import { cleanup, tempDir } from "./helpers.ts";

const originalXdg = process.env.XDG_DATA_HOME;
const dirs: string[] = [];

afterEach(() => {
	if (originalXdg === undefined) delete process.env.XDG_DATA_HOME;
	else process.env.XDG_DATA_HOME = originalXdg;
	while (dirs.length) cleanup(dirs.pop()!);
});

function ctx(worktree: string) {
	return {
		client: {},
		project: {},
		directory: worktree,
		worktree,
		experimental_workspace: { register() {} },
		serverUrl: new URL("http://127.0.0.1:4096"),
		$: {},
	};
}

describe("opencode factory", () => {
	it("returns an empty hook set when disabled", async () => {
		const hooks = await plugin.server(ctx("/tmp") as never, { enabled: false });
		assert.equal(hooks.tool, undefined);
		assert.equal(hooks["tool.execute.after"], undefined);
	});

	it("registers sift_retrieve and an after hook when enabled", async () => {
		const data = tempDir("sift-oc-data-");
		const worktree = tempDir("sift-oc-wt-");
		dirs.push(data, worktree);
		process.env.XDG_DATA_HOME = data;
		const hooks = await plugin.server(ctx(worktree) as never, {
			minLength: 200,
		});
		assert.ok(hooks.tool?.sift_retrieve);
		assert.equal(typeof hooks["tool.execute.after"], "function");
		assert.match(hooks.tool.sift_retrieve.description, /<<stash:KEY>>/);
		await hooks.dispose?.();
	});
});
