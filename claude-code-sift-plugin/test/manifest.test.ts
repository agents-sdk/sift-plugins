import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function readJson(relative: string): Record<string, unknown> {
	return JSON.parse(readFileSync(join(pkgRoot, relative), "utf8"));
}

describe("claude code plugin manifest", () => {
	it("ships a kebab-case plugin.json with version and description", () => {
		const plugin = readJson(".claude-plugin/plugin.json");
		assert.equal(plugin.name, "claude-code-sift");
		assert.match(String(plugin.name), /^[a-z0-9-]+$/);
		assert.equal(plugin.version, "0.0.1");
		assert.equal(plugin.license, "Apache-2.0");
		assert.ok(typeof plugin.description === "string" && plugin.description);
	});

	it("wires exactly PostToolUse and SessionStart via exec-form node hooks", () => {
		const hooks = readJson("hooks/hooks.json") as {
			hooks: Record<string, Array<{ hooks: Array<Record<string, unknown>> }>>;
		};
		assert.deepEqual(Object.keys(hooks.hooks).sort(), [
			"PostToolUse",
			"SessionStart",
		]);
		for (const [event, groups] of Object.entries(hooks.hooks)) {
			for (const group of groups) {
				for (const hook of group.hooks) {
					assert.equal(hook.type, "command", event);
					assert.equal(hook.command, "node", event);
					const args = hook.args as string[];
					assert.ok(Array.isArray(args) && args.length === 1, event);
					assert.match(
						args[0],
						/^\$\{CLAUDE_PLUGIN_ROOT\}\/dist\/(hooks|mcp)\/[a-z-]+\.js$/,
						event,
					);
					assert.ok(
						existsSync(
							join(pkgRoot, args[0].replace("${CLAUDE_PLUGIN_ROOT}/", "")),
						),
						event,
					);
				}
			}
		}
	});

	it("runs the sift MCP server over stdio from dist", () => {
		const mcp = readJson(".mcp.json") as {
			mcpServers: Record<string, { command: string; args: string[] }>;
		};
		const server = mcp.mcpServers.sift;
		assert.ok(server, "server named 'sift'");
		assert.equal(server.command, "node");
		assert.equal(
			server.args[0],
			"${CLAUDE_PLUGIN_ROOT}/dist/mcp/server.js",
		);
		assert.ok(existsSync(join(pkgRoot, "dist/mcp/server.js")));
	});

	it("publishes as the host-prefixed scoped npm package", () => {
		const pkg = readJson("package.json");
		assert.equal(pkg.name, "@agent-context/claude-code-sift");
		assert.equal(pkg.version, "0.0.1");
		assert.equal(pkg.type, "module");
		assert.deepEqual(pkg.files, [
			".claude-plugin",
			"hooks",
			".mcp.json",
			"dist",
			"README.md",
			"LICENSE",
		]);
		assert.deepEqual(pkg.dependencies, {
			"@agent-context/sift": "0.0.1-alpha.7",
		});
		assert.ok(
			Array.isArray(pkg.keywords) &&
				pkg.keywords.includes("claude-code-plugin"),
		);
	});

	it("commits the compiled dist entry points for git installs", () => {
		for (const entry of [
			"dist/hooks/post-tool-use.js",
			"dist/hooks/session-start.js",
			"dist/mcp/server.js",
		]) {
			assert.ok(
				existsSync(join(pkgRoot, entry)),
				`missing committed artifact: ${entry}`,
			);
		}
	});
});
