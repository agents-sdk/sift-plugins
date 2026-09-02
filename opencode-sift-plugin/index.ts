import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import { createOpenCodeAfterHandler } from "./lib/after.ts";
import {
	parseSiftConfig,
	PURGE_INTERVAL_MS,
	RETRIEVE_TOOL_NAME,
} from "./lib/config.ts";
import {
	executeOpenCodeRetrieve,
	SIFT_RETRIEVE_DESCRIPTION,
} from "./lib/retrieve-tool.ts";
import { openCodeStashRoot, SessionSiftStore } from "./lib/session-store.ts";

const SiftPlugin: Plugin = async (ctx, options) => {
	const config = parseSiftConfig(options ?? {});
	if (!config.enabled) return {};

	const store = new SessionSiftStore(openCodeStashRoot(), ctx.worktree);
	store.purgeExpired();
	const timer = setInterval(() => store.purgeExpired(), PURGE_INTERVAL_MS);
	timer.unref?.();

	const after = createOpenCodeAfterHandler(store, config, ctx.worktree);

	return {
		tool: {
			[RETRIEVE_TOOL_NAME]: tool({
				description: SIFT_RETRIEVE_DESCRIPTION,
				args: {
					stashKey: tool.schema
						.string()
						.describe(
							'The stash key from the <<stash:KEY>> marker. Bare key (e.g. "0123456789abcdef01234567") or the full marker both work.',
						),
				},
				async execute(args, context) {
					return executeOpenCodeRetrieve(store, args, context.sessionID);
				},
			}),
		},
		"tool.execute.after": async (input, output) => {
			await after(
				{
					tool: input.tool,
					sessionID: input.sessionID,
					callID: input.callID,
					args: (input.args ?? {}) as Record<string, unknown>,
				},
				output,
			);
		},
		event: async ({ event }) => {
			if (event.type === "session.deleted") {
				const sessionID = (
					event.properties as { info?: { id?: string } } | undefined
				)?.info?.id;
				if (sessionID) store.drop(sessionID);
				store.purgeExpired();
			}
		},
		async dispose() {
			clearInterval(timer);
			store.purgeExpired();
			store.dispose();
		},
	};
};

export default {
	id: "sift",
	server: SiftPlugin,
};
