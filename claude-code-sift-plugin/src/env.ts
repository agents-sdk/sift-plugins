import { parseSiftConfig, type SiftPluginConfig } from "./lib/config.ts";

export function readSiftConfigFromEnv(
	env: NodeJS.ProcessEnv = process.env,
): SiftPluginConfig {
	return parseSiftConfig({
		enabled: env.SIFT_ENABLED,
		minLength: env.SIFT_MIN_LENGTH,
		excludedTools: env.SIFT_EXCLUDED_TOOLS,
	});
}

/**
 * True for our own retrieve tool under any of its possible names: the bare
 * `sift_retrieve` and the plugin-namespaced MCP form
 * `mcp__plugin_claude-code-sift_sift__sift_retrieve`. Retried originals must
 * never be re-compressed.
 */
export function isSelfToolCall(toolName: string): boolean {
	return toolName.includes("sift_retrieve");
}
