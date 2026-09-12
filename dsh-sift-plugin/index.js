import { compressToolText } from "./lib/compress.js";
import { parseSiftConfig, PURGE_INTERVAL_MS, RETRIEVE_TOOL_NAME } from "./lib/config.js";
import { extractTextBlocks } from "./lib/content.js";
import { retrieveFromSift } from "./lib/retrieve.js";
import { dshStashRoot, SessionSiftStore } from "./lib/session-store.js";
import { formatTokenCount, SavingsStats } from "./lib/stats.js";

export const name = "sift";
export const inject = ["tools"];

const RETRIEVE_DESCRIPTION =
	"Retrieve the full original tool output from the local Sift stash. Call this when compressed output contains <<stash:KEY>> and details are needed. Pass the 24-character key or the complete marker. If it expired, re-run the original tool.";

function sessionIdOf(exec) {
	const id = exec.agent?.session?.id;
	return typeof id === "string" && id !== "" ? id : undefined;
}

export function isTruncatedResult(exec, result) {
	if (result.meta && typeof result.meta === "object" && result.meta.truncated === true) return true;
	const value = result.value;
	if (!value || typeof value !== "object") return false;
	if (value.truncated === true || value.stdout?.truncated === true || value.stderr?.truncated === true) return true;
	if (exec.name !== "read" || !Array.isArray(value.lines) || typeof value.totalLines !== "number") return false;
	const last = value.lines.at(-1);
	return last && typeof last.number === "number" ? last.number < value.totalLines : value.totalLines > 0;
}

export function createPostExecuteHandler(store, stats, config, logger) {
	return async (exec, result, next) => {
		const decision = await next();
		if (!config.enabled || result.isError || exec.parent !== undefined || decision.kind !== "accept" || Object.hasOwn(decision, "value")) {
			return decision;
		}
		const sessionId = sessionIdOf(exec);
		if (!sessionId) return decision;
		const extracted = extractTextBlocks(decision.content ?? result.content);
		if (!extracted) return decision;
		let sift;
		try { sift = store.getOrCreate(sessionId); } catch { return decision; }
		const truncated = isTruncatedResult(exec, result);
		const outcome = compressToolText(sift, {
			toolName: exec.name,
			text: extracted.text,
			input: exec.arguments && typeof exec.arguments === "object" ? exec.arguments : undefined,
			isError: result.isError,
			truncated,
			sourcePathEligible: !truncated,
		}, config);
		if (!outcome.applied) return decision;
		stats.record(sessionId, String(exec.callId), outcome.tokensSaved);
		if (config.showSavings === "log" || config.showSavings === "both") {
			logger.info(`[sift] ${exec.name}: saved ${formatTokenCount(outcome.tokensSaved)} tokens; session total ${formatTokenCount(stats.session(sessionId))}`);
		}
		return {
			kind: "accept",
			content: [{ type: "text", text: outcome.text }],
			...(decision.additionalContexts ? { additionalContexts: decision.additionalContexts } : {}),
		};
	};
}

function retrieveTool(store) {
	return {
		name: RETRIEVE_TOOL_NAME,
		description: RETRIEVE_DESCRIPTION,
		parameters: {
			type: "object",
			additionalProperties: false,
			required: ["stashKey"],
			properties: { stashKey: { type: "string", description: "Key from a <<stash:KEY>> marker." } },
		},
		output: {
			schema: { type: "string" },
			render: (_args, value) => [{ type: "text", text: value }],
		},
		async execute(args, exec) {
			const sessionId = sessionIdOf(exec);
			if (!sessionId) throw new Error("sift_retrieve requires an agent session");
			return retrieveFromSift(store.getOrCreate(sessionId), args.stashKey);
		},
	};
}

export function apply(ctx, input = {}) {
	const config = parseSiftConfig(input);
	if (!config.enabled) return;
	const store = new SessionSiftStore(dshStashRoot());
	const stats = new SavingsStats();
	store.purgeExpired();
	const timer = setInterval(() => store.purgeExpired(), PURGE_INTERVAL_MS);
	timer.unref?.();
	ctx.effect(() => () => { clearInterval(timer); store.purgeExpired(); store.dispose(); });
	ctx.tools.register(retrieveTool(store));
	ctx.on("tools/post-execute", createPostExecuteHandler(store, stats, config, ctx.logger), { prepend: true });
	if (config.showSavings === "command" || config.showSavings === "both") {
		const commands = ctx.get("commands");
		if (!commands) {
			ctx.logger.warn("[sift] command registry is unavailable; /sift savings display is disabled");
			return;
		}
		commands.register({
			name: "sift",
			description: "Show tokens saved by Sift in this session",
			handler: ({ agent }) => {
				const session = stats.session(String(agent.session.id));
				return { kind: "success", text: `Sift saved ${formatTokenCount(session)} tokens in this session (${formatTokenCount(stats.total)} since this process started).` };
			},
		});
	}
}

export { parseSiftConfig } from "./lib/config.js";
export { parseStashKey } from "./lib/keys.js";
export { dshStashRoot, SessionSiftStore } from "./lib/session-store.js";
export { formatTokenCount, SavingsStats } from "./lib/stats.js";
