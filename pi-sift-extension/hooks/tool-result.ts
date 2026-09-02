import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { compressToolText, mergeSiftDetails } from "../lib/compress.ts";
import type { SiftPluginConfig } from "../lib/config.ts";
import { extractTextBlocks, isTruncatedDetails } from "../lib/content.ts";
import type { SessionSiftStore } from "../lib/session-store.ts";

export type PiToolResultEvent = {
	type: "tool_result";
	toolCallId: string;
	toolName: string;
	input: Record<string, unknown>;
	content: unknown[];
	isError: boolean;
	details?: unknown;
};

export type PiToolResultPatch = {
	content?: { type: "text"; text: string }[];
	details?: unknown;
};

function isReadSourcePathEligible(event: PiToolResultEvent): boolean {
	if (event.toolName !== "read") return false;
	if (event.input?.offset !== undefined || event.input?.limit !== undefined)
		return false;
	if (isTruncatedDetails(event.details)) return false;
	return extractTextBlocks(event.content) !== null;
}

export function createToolResultHandler(
	store: SessionSiftStore,
	config: SiftPluginConfig,
) {
	return (
		event: PiToolResultEvent,
		ctx: { sessionManager: { getSessionId(): string } },
	): PiToolResultPatch | undefined => {
		if (!config.enabled) return undefined;
		if (event.isError) return undefined;

		const extracted = extractTextBlocks(event.content);
		if (!extracted) return undefined;

		const sessionId = ctx.sessionManager.getSessionId();
		if (!sessionId) return undefined;

		let sift;
		try {
			sift = store.getOrCreate(sessionId);
		} catch {
			return undefined;
		}

		const outcome = compressToolText(
			sift,
			{
				toolName: event.toolName,
				text: extracted.text,
				input: event.input,
				isError: event.isError,
				truncated: isTruncatedDetails(event.details),
				sourcePathEligible: isReadSourcePathEligible(event),
			},
			config,
		);

		if (!outcome.applied) return undefined;

		return {
			content: [{ type: "text", text: outcome.text }],
			details: mergeSiftDetails(event.details, outcome),
		};
	};
}

export function registerToolResultHook(
	pi: ExtensionAPI,
	store: SessionSiftStore,
	config: SiftPluginConfig,
): void {
	pi.on("tool_result", createToolResultHandler(store, config) as never);
}
