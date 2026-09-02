import { utf8ByteLength, type SiftPluginConfig } from "./config.ts";
import { containsValidStashMarker } from "./keys.ts";
import { buildContextHint, readSourcePath } from "./hints.ts";
import type { SiftLike } from "./session-store.ts";

export type CompressInput = {
	toolName: string;
	text: string;
	input?: Record<string, unknown>;
	isError?: boolean;
	truncated?: boolean;
	sourcePathEligible?: boolean;
};

export type CompressOutcome =
	| { applied: false; reason: string }
	| {
			applied: true;
			text: string;
			tokensSaved: number;
			lossy: boolean;
			stashKey: string | null;
	  };

export function shouldSkipCompression(
	input: CompressInput,
	config: Pick<SiftPluginConfig, "minLength" | "excludedTools">,
): string | null {
	if (config.excludedTools.includes(input.toolName)) return "excluded";
	if (input.isError) return "error";
	if (input.truncated) return "truncated";
	if (!input.text) return "empty";
	if (utf8ByteLength(input.text) < config.minLength) return "too-short";
	if (containsValidStashMarker(input.text)) return "already-marked";
	return null;
}

export function compressToolText(
	sift: SiftLike,
	input: CompressInput,
	config: Pick<SiftPluginConfig, "minLength" | "excludedTools">,
): CompressOutcome {
	const skip = shouldSkipCompression(input, config);
	if (skip) return { applied: false, reason: skip };

	const hint = buildContextHint(input.toolName, input.input);
	const sourcePath =
		input.sourcePathEligible === false ? undefined : readSourcePath(input.toolName, input.input);

	let result: ReturnType<SiftLike["siftText"]>;
	try {
		result = sourcePath ? sift.siftText(input.text, hint, sourcePath) : sift.siftText(input.text, hint);
	} catch {
		return { applied: false, reason: "sift-error" };
	}

	if (!result.changed || result.tokensSaved <= 0) {
		return { applied: false, reason: "no-savings" };
	}

	return {
		applied: true,
		text: result.text,
		tokensSaved: result.tokensSaved,
		lossy: result.lossy,
		stashKey: result.stashKey,
	};
}

export function mergeSiftDetails(
	existing: unknown,
	outcome: Extract<CompressOutcome, { applied: true }>,
): Record<string, unknown> {
	const base = existing && typeof existing === "object" ? { ...(existing as Record<string, unknown>) } : {};
	return {
		...base,
		siftCompressed: true,
		siftTokensSaved: outcome.tokensSaved,
		siftLossy: outcome.lossy,
		...(outcome.stashKey ? { siftStashKey: outcome.stashKey } : {}),
	};
}
