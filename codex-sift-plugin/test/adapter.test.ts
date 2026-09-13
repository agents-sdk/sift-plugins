import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { handlePostToolUse } from "../src/hooks/post-tool-use.ts";
import { pluginDataRoot } from "../src/config.ts";
import { readSavings } from "../src/stats.ts";

const packageRoot = join(import.meta.dirname, "..");

test("Sift uses a stable shared data directory across legacy hook and MCP processes", () => {
  assert.equal(pluginDataRoot({ PLUGIN_DATA: "/host/data", CODEX_SIFT_DATA: "/custom/data" }), "/custom/data");
  assert.match(pluginDataRoot({ PLUGIN_DATA: "/host/data" }), /\.codex\/sift$/);
});

test("portable manifests use Codex-compatible hook and MCP paths", () => {
  const hooks = JSON.parse(readFileSync(join(packageRoot, "hooks/hooks.json"), "utf8"));
  assert.equal(hooks.hooks.PostToolUse[0].matcher, "*");
  const portable = JSON.parse(readFileSync(join(packageRoot, "plugin.json"), "utf8"));
  assert.equal(portable.$schema, "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
  assert.equal(portable.extensions["com.openai"].hooks, "./hooks/hooks.json");
  const portableMcp = JSON.parse(readFileSync(join(packageRoot, "mcp.json"), "utf8"));
  assert.equal(portableMcp.mcpServers.sift.type, "stdio");
  assert.equal(portableMcp.mcpServers.sift.args[0], "${PLUGIN_ROOT}/dist/mcp/server.js");
  assert.equal(portableMcp.mcpServers.sift.cwd, "${PLUGIN_ROOT}");
  const compatibility = JSON.parse(readFileSync(join(packageRoot, ".mcp.json"), "utf8"));
  assert.equal(compatibility.mcpServers.sift.args[0], "dist/mcp/server.js");
  assert.equal(compatibility.mcpServers.sift.cwd, ".");
});

function largeLog(): string {
  return Array.from({ length: 300 }, (_, index) =>
    `2026-09-12T12:00:${String(index % 60).padStart(2, "0")}Z INFO worker request completed status=200 route=/api/items duration_ms=${index % 13}`
  ).join("\n");
}

test("PostToolUse replaces a compressible result and records session savings", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-sift-"));
  try {
    const env = { ...process.env, CODEX_SIFT_DATA: root, SIFT_MIN_LENGTH: "200", SIFT_SHOW_STATUS: "1" };
    const output = handlePostToolUse({
      session_id: "session-1",
      tool_name: "Bash",
      tool_use_id: "call-1",
      tool_input: { command: "run-build" },
      tool_response: { output: largeLog(), exit_code: 0 },
    }, env);
    assert.ok(output);
    assert.equal(output.continue, false);
    assert.match(String(output.stopReason), /^\[sift\] Compressed Bash result/);
    assert.match(String(output.systemMessage), /^Sift saved /);
    const summary = readSavings(root, "session-1");
    assert.equal(summary.calls, 1);
    assert.ok(summary.tokensSaved > 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("PostToolUse fails open for failed and excluded tools", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-sift-"));
  try {
    const base = {
      session_id: "session-2",
      tool_name: "Bash",
      tool_use_id: "call-2",
      tool_input: { command: "failing-test" },
      tool_response: { output: largeLog(), exit_code: 1 },
    };
    assert.equal(handlePostToolUse(base, { ...process.env, CODEX_SIFT_DATA: root }), null);
    assert.equal(handlePostToolUse({ ...base, tool_response: { output: largeLog(), exit_code: 0 } }, {
      ...process.env,
      CODEX_SIFT_DATA: root,
      SIFT_EXCLUDED_TOOLS: "Bash",
    }), null);
    assert.deepEqual(readSavings(root), { tokensSaved: 0, calls: 0 });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
