import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerToolResultHook } from "./hooks/tool-result.ts";
import {
	parseEnabled,
	parseExcludedTools,
	parseMinLengthFromString,
	PURGE_INTERVAL_MS,
	type SiftPluginConfig,
} from "./lib/config.ts";
import { piStashRoot, SessionSiftStore } from "./lib/session-store.ts";
import { registerSiftRetrieveTool } from "./tools/sift-retrieve.ts";

function registerFlags(pi: ExtensionAPI): void {
	pi.registerFlag("sift", {
		description: "Enable sift tool-result compression (default: true)",
		type: "boolean",
		default: true,
	});
	pi.registerFlag("no-sift", {
		description: "Disable sift tool-result compression",
		type: "boolean",
		default: false,
	});
	pi.registerFlag("sift-min-length", {
		description:
			"Minimum UTF-8 byte length before compressing tool output (default: 200)",
		type: "string",
		default: "200",
	});
	pi.registerFlag("sift-exclude", {
		description:
			"Comma-separated tool names to skip (sift_retrieve is always excluded)",
		type: "string",
		default: "",
	});
}

export function readSiftConfig(
	pi: Pick<ExtensionAPI, "getFlag">,
	env: NodeJS.ProcessEnv = process.env,
): SiftPluginConfig {
	const noSift = pi.getFlag("no-sift") === true;
	const enabled = noSift ? false : parseEnabled(env.SIFT_ENABLED, true);
	const minLengthFlag = pi.getFlag("sift-min-length");
	const minLengthFromCli =
		typeof minLengthFlag === "string" &&
		minLengthFlag.trim() !== "" &&
		minLengthFlag !== "200"
			? minLengthFlag
			: undefined;
	const minLength = parseMinLengthFromString(
		minLengthFromCli ?? env.SIFT_MIN_LENGTH ?? minLengthFlag,
	);
	const excludeFlag = pi.getFlag("sift-exclude");
	const excludedTools = parseExcludedTools(
		typeof excludeFlag === "string" && excludeFlag.trim() !== ""
			? excludeFlag
			: env.SIFT_EXCLUDED_TOOLS,
	);
	return { enabled, minLength, excludedTools };
}

export default function (pi: ExtensionAPI) {
	registerFlags(pi);

	if (!parseEnabled(process.env.SIFT_ENABLED, true)) return;

	const store = new SessionSiftStore(piStashRoot());
	const config: SiftPluginConfig = readSiftConfig(pi);
	let wired = false;
	let timer: ReturnType<typeof setInterval> | undefined;

	const wire = () => {
		if (wired || !config.enabled) return;
		wired = true;
		store.purgeExpired();
		timer = setInterval(() => store.purgeExpired(), PURGE_INTERVAL_MS);
		timer.unref?.();
		registerToolResultHook(pi, store, config);
		registerSiftRetrieveTool(pi, store);
		pi.on("session_shutdown", (_event, ctx) => {
			const sessionId = ctx.sessionManager.getSessionId();
			if (sessionId) store.drop(sessionId);
			store.purgeExpired();
		});
	};

	pi.on("session_start", () => {
		Object.assign(config, readSiftConfig(pi));
		wire();
	});
}

export { parseSiftConfig } from "./lib/config.ts";
export { parseStashKey, containsValidStashMarker } from "./lib/keys.ts";
export { buildContextHint } from "./lib/hints.ts";
export { SessionSiftStore, piStashRoot } from "./lib/session-store.ts";
