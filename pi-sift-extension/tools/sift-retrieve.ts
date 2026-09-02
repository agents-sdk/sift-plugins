import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { RETRIEVE_TOOL_NAME } from "../lib/config.ts";
import { retrieveErrorText, retrieveFromSift } from "../lib/retrieve.ts";
import type { SessionSiftStore } from "../lib/session-store.ts";

export function createSiftRetrieveTool(store: SessionSiftStore) {
	return {
		name: RETRIEVE_TOOL_NAME,
		label: "Sift Retrieve",
		description:
			"Retrieve the full original tool output from the local sift stash. " +
			"Call this when compressed tool output contains <<stash:KEY>> and you need the original text. " +
			"Pass either the 24-character hex key inside the marker or the complete <<stash:KEY>> marker. " +
			"If retrieval fails because the stash expired, re-run the original tool instead of looping on retrieve.",
		promptSnippet: "Retrieve full original tool output from sift stash by key",
		promptGuidelines: [
			"When a tool result contains <<stash:KEY>> and you need the full original text, call sift_retrieve.",
			"Pass the 24-character hex key or the complete <<stash:KEY>> marker.",
			"If retrieval says the content expired or is missing, re-run the original tool. Do not loop on sift_retrieve.",
		],
		parameters: Type.Object({
			stashKey: Type.String({
				description:
					'The stash key from the <<stash:KEY>> marker. Bare key (e.g. "0123456789abcdef01234567") or the full marker both work.',
			}),
		}),
		async execute(
			_toolCallId: string,
			params: { stashKey: string },
			_signal: AbortSignal,
			_onUpdate: unknown,
			ctx: { sessionManager: { getSessionId(): string } },
		) {
			const sessionId = ctx.sessionManager.getSessionId();
			let sift = null;
			try {
				sift = sessionId ? store.getOrCreate(sessionId) : null;
			} catch {
				sift = null;
			}
			const outcome = retrieveFromSift(sift, params?.stashKey);
			if (!outcome.ok) {
				return {
					content: [
						{ type: "text" as const, text: retrieveErrorText(outcome.json) },
					],
					details: { found: false, stashKey: outcome.json.stashKey },
				};
			}
			return {
				content: [{ type: "text" as const, text: outcome.text }],
				details: {
					found: true,
					stashKey: outcome.stashKey,
					originalLength: outcome.text.length,
				},
			};
		},
	};
}

export function registerSiftRetrieveTool(
	pi: ExtensionAPI,
	store: SessionSiftStore,
): void {
	pi.registerTool(createSiftRetrieveTool(store) as never);
}
