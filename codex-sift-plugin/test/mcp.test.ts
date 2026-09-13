import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createMcpCore } from "../src/mcp/server.ts";
import { appendSaving } from "../src/stats.ts";

test("MCP server advertises retrieve and stats tools", async () => {
  const root = mkdtempSync(join(tmpdir(), "codex-sift-mcp-"));
  try {
    const core = createMcpCore(root);
    const reply = await core.handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const result = reply?.result as { tools: Array<{ name: string }> };
    assert.deepEqual(result.tools.map((tool) => tool.name), ["sift_retrieve", "sift_stats"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("sift_stats deduplicates hook retries by tool call", async () => {
  const root = mkdtempSync(join(tmpdir(), "codex-sift-mcp-"));
  try {
    const event = { sessionId: "s1", toolUseId: "c1", toolName: "Bash", tokensSaved: 42, lossy: false, at: new Date().toISOString() };
    appendSaving(root, event);
    appendSaving(root, event);
    const reply = await createMcpCore(root).handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "sift_stats", arguments: { sessionId: "s1" } },
    });
    const structured = (reply?.result as { structuredContent: Record<string, unknown> }).structuredContent;
    assert.equal(structured.tokensSaved, 42);
    assert.equal(structured.calls, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
