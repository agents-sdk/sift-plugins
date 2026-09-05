import { readdirSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { createSift } from "@agent-context/sift";
import { isMainModule } from "../is-main-module.ts";
import { PURGE_INTERVAL_MS, RETRIEVE_TOOL_NAME } from "../lib/config.ts";
import {
	retrieveErrorText,
	retrieveFromSift,
	type RetrieveOutcome,
} from "../lib/retrieve.ts";
import {
	claudeCodeStashRoot,
	SessionSiftStore,
	type SiftLike,
} from "../lib/session-store.ts";

export const SIFT_RETRIEVE_DESCRIPTION =
	"Retrieve the full original tool output from the local sift stash. " +
	"Call this when compressed tool output contains <<stash:KEY>> and you need the original text. " +
	"Pass either the 24-character hex key inside the marker or the complete <<stash:KEY>> marker. " +
	"If retrieval fails because the stash expired, re-run the original tool instead of looping on retrieve.";

const STASH_KEY_PARAMETER_DESCRIPTION =
	'The stash key from the <<stash:KEY>> marker. Bare key (e.g. "0123456789abcdef01234567") or the full marker both work.';

const SERVER_INFO = { name: "sift", version: "0.0.1" };
const DEFAULT_PROTOCOL_VERSION = "2025-06-18";

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

/**
 * A retrieve-only Sift view that scans every session stash directory under
 * the root, newest first. Claude Code does not expose the session id to MCP
 * servers, so retrieval cannot be scoped to the calling session; stash keys
 * are content-derived (BLAKE3), so a cross-session hit is still the exact
 * original text.
 */
export function createScanningSift(root: string): SiftLike {
	return {
		siftText() {
			throw new Error("siftText is not available on the retrieve-only view");
		},
		retrieve(key: string): string | null {
			let dirs: string[] = [];
			try {
				dirs = readdirSync(root, { withFileTypes: true })
					.filter((entry) => entry.isDirectory())
					.map((entry) => join(root, entry.name));
			} catch {
				return null;
			}
			const ranked = dirs
				.map((dir) => {
					try {
						return { dir, mtime: statSync(dir).mtimeMs };
					} catch {
						return { dir, mtime: 0 };
					}
				})
				.sort((a, b) => b.mtime - a.mtime);
			for (const { dir } of ranked) {
				try {
					const text = createSift({ stashDir: dir }).retrieve(key);
					if (text !== null) return text;
				} catch {
					// Unreadable session dir: fall through to the next candidate.
				}
			}
			return null;
		},
	};
}

export type McpReply = Record<string, unknown> | null;

/**
 * Minimal MCP-over-stdio message handler: initialize / notifications /
 * ping / tools/list / tools/call. Pure aside from the injected retrieve
 * callback, so tests can drive it without a subprocess.
 */
export function createMcpCore(
	callRetrieve: (stashKey: unknown) => RetrieveOutcome,
) {
	function siftRetrieveTool() {
		return {
			name: RETRIEVE_TOOL_NAME,
			description: SIFT_RETRIEVE_DESCRIPTION,
			inputSchema: {
				type: "object",
				properties: {
					stashKey: {
						type: "string",
						description: STASH_KEY_PARAMETER_DESCRIPTION,
					},
				},
				required: ["stashKey"],
			},
		};
	}

	async function handleMessage(message: unknown): Promise<McpReply> {
		if (!message || typeof message !== "object") return null;
		const msg = message as {
			id?: unknown;
			method?: unknown;
			params?: unknown;
		};
		const method = typeof msg.method === "string" ? msg.method : "";
		const isRequest = msg.id !== undefined && method !== "";
		const reply = (result: unknown): McpReply => ({
			jsonrpc: "2.0",
			id: msg.id,
			result,
		});
		const replyError = (code: number, text: string): McpReply => ({
			jsonrpc: "2.0",
			id: msg.id,
			error: { code, message: text },
		});

		switch (method) {
			case "initialize": {
				const params = asRecord(msg.params);
				const requested =
					typeof params.protocolVersion === "string"
						? params.protocolVersion
						: DEFAULT_PROTOCOL_VERSION;
				return isRequest
					? reply({
							protocolVersion: requested,
							capabilities: { tools: { listChanged: false } },
							serverInfo: SERVER_INFO,
						})
					: null;
			}
			case "notifications/initialized":
			case "notifications/cancelled":
				return null;
			case "ping":
				return isRequest ? reply({}) : null;
			case "tools/list":
				return isRequest ? reply({ tools: [siftRetrieveTool()] }) : null;
			case "tools/call": {
				if (!isRequest) return null;
				const params = asRecord(msg.params);
				const name = typeof params.name === "string" ? params.name : "";
				if (name !== RETRIEVE_TOOL_NAME) {
					return replyError(-32602, `Unknown tool: ${name}`);
				}
				const args = asRecord(params.arguments);
				const outcome = callRetrieve(args.stashKey);
				const text = outcome.ok ? outcome.text : retrieveErrorText(outcome.json);
				return reply({ content: [{ type: "text", text }] });
			}
			default:
				return isRequest
					? replyError(-32601, `Method not found: ${method}`)
					: null;
		}
	}

	return { handleMessage };
}

function main(): void {
	const root = claudeCodeStashRoot();
	const scanning = createScanningSift(root);
	const core = createMcpCore((stashKey) => retrieveFromSift(scanning, stashKey));

	// Long-lived process: mirror the host adapters' 5-minute TTL sweep.
	const purge = () => {
		try {
			new SessionSiftStore(root).purgeExpired();
		} catch {
			// Best effort.
		}
	};
	purge();
	const timer = setInterval(purge, PURGE_INTERVAL_MS);
	timer.unref?.();

	const rl = createInterface({ input: process.stdin });
	rl.on("line", (line) => {
		const trimmed = line.trim();
		if (!trimmed) return;
		let message: unknown;
		try {
			message = JSON.parse(trimmed);
		} catch {
			return;
		}
		Promise.resolve(core.handleMessage(message))
			.then((reply) => {
				if (reply !== null) {
					process.stdout.write(`${JSON.stringify(reply)}\n`);
				}
			})
			.catch(() => {
				// A malformed message never takes the server down.
			});
	});
}

if (isMainModule(import.meta.url)) main();
