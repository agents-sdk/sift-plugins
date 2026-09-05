import { isSelfToolCall, readSiftConfigFromEnv } from "../env.ts";
import { isMainModule } from "../is-main-module.ts";
import { compressToolText } from "../lib/compress.ts";
import type { SiftPluginConfig } from "../lib/config.ts";
import {
	compressToolResponse,
	hasLargeString,
	isTruncatedToolResponse,
} from "../lib/response-shape.ts";
import type { SessionSiftStore } from "../lib/session-store.ts";
import { readStdin } from "../stdin.ts";

export type PostToolUseHookInput = {
	session_id?: unknown;
	tool_name?: unknown;
	tool_input?: unknown;
	tool_response?: unknown;
};

export type PostToolUseOutcome = {
	updatedToolOutput: unknown;
	tokensSaved: number;
	lossy: boolean;
	compressedFields: number;
	toolName: string;
} | null;

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

/**
 * Claude Code fires PostToolUse only for successful tool runs (failures go to
 * PostToolUseFailure), so the shared "never compress errors" rule holds here
 * without extra checks. Host truncation is detected from the empirical
 * tool_response shapes (see isTruncatedToolResponse). A user-requested
 * partial read (tool_input offset/limit) is still compressed, just without a
 * sourcePath so the core never maps a partial view back onto the file.
 */
function isReadSourcePathEligible(
	toolName: string,
	toolInput: Record<string, unknown>,
): boolean {
	if (toolName !== "Read") return false;
	return toolInput.offset === undefined && toolInput.limit === undefined;
}

export function createPostToolUseHandler(
	store: SessionSiftStore,
	config: SiftPluginConfig,
): (input: unknown) => PostToolUseOutcome {
	return (input) => {
		if (!config.enabled) return null;
		if (!input || typeof input !== "object") return null;
		const event = input as PostToolUseHookInput;

		const toolName =
			typeof event.tool_name === "string" ? event.tool_name : "";
		if (!toolName) return null;
		if (isSelfToolCall(toolName)) return null;
		if (config.excludedTools.includes(toolName)) return null;

		const sessionId =
			typeof event.session_id === "string" ? event.session_id.trim() : "";
		if (!sessionId) return null;

		const toolInput = asRecord(event.tool_input);
		const readPartialRequested =
			toolName === "Read" &&
			(toolInput.offset !== undefined || toolInput.limit !== undefined);

		// Host-truncated outputs cannot be faithfully restored from the stash.
		// A user-requested partial read legitimately serves fewer lines than
		// the file has, so that signal is ignored for offset/limit reads.
		if (isTruncatedToolResponse(event.tool_response, readPartialRequested)) {
			return null;
		}

		// Cheap pre-scan: skip the whole walk when no string field could pass
		// minLength (mirrors the lazy native-module load in the hook shell).
		if (!hasLargeString(event.tool_response, config.minLength)) return null;

		let sift;
		try {
			sift = store.getOrCreate(sessionId);
		} catch {
			return null;
		}

		const outcome = compressToolResponse(event.tool_response, (text) =>
			compressToolText(
				sift,
				{
					toolName,
					text,
					input: toolInput,
					isError: false,
					truncated: false,
					sourcePathEligible: isReadSourcePathEligible(toolName, toolInput),
				},
				config,
			),
		);

		if (!outcome.changed) return null;
		return {
			updatedToolOutput: outcome.value,
			tokensSaved: outcome.tokensSaved,
			lossy: outcome.lossy,
			compressedFields: outcome.compressedFields,
			toolName,
		};
	};
}

async function main(): Promise<void> {
	const raw = await readStdin();
	let input: unknown;
	try {
		input = JSON.parse(raw) as PostToolUseHookInput;
	} catch {
		return;
	}

	const config = readSiftConfigFromEnv();
	if (!config.enabled) return;

	// Loaded lazily so the native sift module never loads on skip paths:
	// most tool calls (Edit/Write/TodoWrite/...) have small outputs.
	const { SessionSiftStore, claudeCodeStashRoot } = await import(
		"../lib/session-store.ts"
	);
	let store: SessionSiftStore;
	try {
		store = new SessionSiftStore(claudeCodeStashRoot());
	} catch {
		return;
	}

	const outcome = createPostToolUseHandler(store, config)(input);
	if (!outcome) return;

	process.stdout.write(
		`${JSON.stringify({
			hookSpecificOutput: {
				hookEventName: "PostToolUse",
				updatedToolOutput: outcome.updatedToolOutput,
			},
		})}\n`,
	);

	if (process.env.SIFT_DEBUG === "1") {
		process.stderr.write(
			`${JSON.stringify({
				tool_name: outcome.toolName,
				session_id:
					typeof (input as PostToolUseHookInput).session_id === "string"
						? (input as PostToolUseHookInput).session_id
						: null,
				tokensSaved: outcome.tokensSaved,
				lossy: outcome.lossy,
				compressedFields: outcome.compressedFields,
			})}\n`,
		);
	}
}

if (isMainModule(import.meta.url)) {
	main().catch(() => {
		// Any failure leaves the tool output untouched: exit 0, no stdout.
	});
}
