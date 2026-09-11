import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

describe("opencode package entry", () => {
	it("exposes ./server and main for the loader", () => {
		const pkgPath = join(
			dirname(fileURLToPath(import.meta.url)),
			"..",
			"package.json",
		);
		const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
			main?: string;
			exports?: Record<string, string>;
		};
		assert.equal(pkg.main, "./index.ts");
		assert.equal(pkg.exports?.["./server"], "./index.ts");
		assert.equal(pkg.exports?.["./tui"], "./tui.tsx");
	});

	it("exposes a separate target-only TUI module", () => {
		const tuiPath = join(
			dirname(fileURLToPath(import.meta.url)),
			"..",
			"tui.tsx",
		);
		const source = readFileSync(tuiPath, "utf8");
		assert.match(source, /id: PLUGIN_ID/);
		assert.match(source, /\btui,/);
		assert.doesNotMatch(source, /\bserver\s*[:,]/);
	});

	it("keeps UI runtime peers optional so OpenCode supplies one renderer", () => {
		const pkgPath = join(
			dirname(fileURLToPath(import.meta.url)),
			"..",
			"package.json",
		);
		const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
			dependencies?: Record<string, string>;
			peerDependenciesMeta?: Record<string, { optional?: boolean }>;
		};
		for (const name of ["@opentui/core", "@opentui/solid", "solid-js"]) {
			assert.equal(pkg.dependencies?.[name], undefined);
			assert.equal(pkg.peerDependenciesMeta?.[name]?.optional, true);
		}
	});

	it("default-exports { id, server } and no extra plugin functions", async () => {
		const mod = await import("../index.ts");
		assert.equal(mod.default.id, "sift");
		assert.equal(typeof mod.default.server, "function");
		const functionExports = Object.entries(mod).filter(
			([name, value]) => name !== "default" && typeof value === "function",
		);
		assert.deepEqual(functionExports, []);
	});

	it("resolves the OpenCode loader entry from exports['./server'] or main", () => {
		const pkgPath = join(
			dirname(fileURLToPath(import.meta.url)),
			"..",
			"package.json",
		);
		const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
			main?: string;
			exports?: Record<string, string>;
		};
		const server = pkg.exports?.["./server"] ?? pkg.main;
		assert.equal(server, "./index.ts");
	});
});
