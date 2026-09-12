import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { apply } from "../index.js";

test("bundle manifest points at an installable patch", async () => {
	const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
	const patch = await readFile(new URL("../cordis.patch.yml", import.meta.url), "utf8");
	assert.equal(pkg.dsh.bundle.patch, "./cordis.patch.yml");
	assert.match(patch, /name: '@agent-context\/dsh-sift'/);
});

test("apply registers result middleware, retrieve tool, and savings command", () => {
	const registered = { tools: [], commands: [], events: [] };
	const ctx = {
		logger: { info() {} },
		get(name) { return name === "commands" ? this.commands : undefined; },
		effect(factory) { registered.dispose = factory(); },
		tools: { register(tool) { registered.tools.push(tool); return () => {}; } },
		commands: { register(command) { registered.commands.push(command); return () => {}; } },
		on(name, handler, options) { registered.events.push({ name, handler, options }); return () => {}; },
	};
	apply(ctx, { minLength: 200, showSavings: "command" });
	assert.equal(registered.tools[0].name, "sift_retrieve");
	assert.equal(registered.commands[0].name, "sift");
	assert.deepEqual(registered.events.map((event) => [event.name, event.options]), [["tools/post-execute", { prepend: true }]]);
	registered.dispose();
});
