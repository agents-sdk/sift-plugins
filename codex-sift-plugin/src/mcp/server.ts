import { createInterface } from "node:readline";
import { pluginDataRoot } from "../config.ts";
import { purgeExpired, retrieveFromStashes } from "../core.ts";
import { isMainModule } from "../io.ts";
import { formatTokens, readSavings } from "../stats.ts";

const SERVER = { name: "sift", version: "0.1.1" };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function parseKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const marker = trimmed.match(/^<<stash:([0-9a-fA-F]{24})>>$/);
  if (marker) return marker[1];
  return /^[0-9a-fA-F]{24}$/.test(trimmed) ? trimmed : null;
}

export function createMcpCore(root: string) {
  const tools = [
    {
      name: "sift_retrieve",
      description: "Retrieve exact original text for a <<stash:KEY>> marker emitted by Sift. If missing, rerun the original tool rather than retrying.",
      inputSchema: {
        type: "object",
        properties: { stashKey: { type: "string", description: "A 24-hex key or complete <<stash:KEY>> marker." } },
        required: ["stashKey"],
      },
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    },
    {
      name: "sift_stats",
      description: "Report estimated context tokens saved by the Codex Sift plugin.",
      inputSchema: {
        type: "object",
        properties: { sessionId: { type: "string", description: "Optional Codex session id; omit for all recorded sessions." } },
      },
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    },
  ];

  async function handleMessage(message: unknown): Promise<Record<string, unknown> | null> {
    if (!message || typeof message !== "object") return null;
    const msg = message as { id?: unknown; method?: unknown; params?: unknown };
    const method = typeof msg.method === "string" ? msg.method : "";
    const request = msg.id !== undefined;
    const reply = (result: unknown) => ({ jsonrpc: "2.0", id: msg.id, result });
    const error = (code: number, text: string) => ({ jsonrpc: "2.0", id: msg.id, error: { code, message: text } });
    if (method === "initialize" && request) {
      const params = record(msg.params);
      return reply({
        protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER,
        instructions: "Use sift_retrieve only for details omitted behind <<stash:KEY>>. Use sift_stats for savings totals.",
      });
    }
    if (method === "notifications/initialized" || method === "notifications/cancelled") return null;
    if (method === "ping" && request) return reply({});
    if (method === "tools/list" && request) return reply({ tools });
    if (method === "tools/call" && request) {
      const params = record(msg.params);
      const args = record(params.arguments);
      if (params.name === "sift_retrieve") {
        const key = parseKey(args.stashKey);
        if (!key) return reply({ content: [{ type: "text", text: "Invalid stashKey: pass 24 hex characters or a complete <<stash:KEY>> marker." }], isError: true });
        const text = retrieveFromStashes(root, key);
        return reply(text === null
          ? { content: [{ type: "text", text: "Sift stash entry is missing or expired. Rerun the original tool once." }], isError: true }
          : { content: [{ type: "text", text }] });
      }
      if (params.name === "sift_stats") {
        const sessionId = typeof args.sessionId === "string" && args.sessionId ? args.sessionId : undefined;
        const summary = readSavings(root, sessionId);
        const scope = sessionId ? "this session" : "all recorded sessions";
        return reply({
          structuredContent: { ...summary, scope, estimated: true },
          content: [{ type: "text", text: `Sift saved about ${formatTokens(summary.tokensSaved)} context tokens across ${summary.calls} compressed tool calls (${scope}).` }],
        });
      }
      return error(-32602, `Unknown tool: ${String(params.name ?? "")}`);
    }
    return request ? error(-32601, `Method not found: ${method}`) : null;
  }
  return { handleMessage };
}

function main(): void {
  const root = pluginDataRoot();
  try { purgeExpired(root); } catch { /* Best effort. */ }
  const core = createMcpCore(root);
  const lines = createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    let message: unknown;
    try { message = JSON.parse(line); } catch { return; }
    void core.handleMessage(message).then((reply) => {
      if (reply) process.stdout.write(`${JSON.stringify(reply)}\n`);
    }).catch(() => {});
  });
}

if (isMainModule(import.meta.url)) main();
