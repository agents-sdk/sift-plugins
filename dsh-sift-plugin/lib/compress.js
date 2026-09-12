import { Buffer } from "node:buffer";
import { containsValidStashMarker } from "./keys.js";
import { buildContextHint, readSourcePath } from "./hints.js";

export function shouldSkipCompression(input, config) {
	if (config.excludedTools.includes(input.toolName)) return "excluded";
	if (input.isError) return "error";
	if (input.truncated) return "truncated";
	if (!input.text) return "empty";
	if (Buffer.byteLength(input.text, "utf8") < config.minLength) return "too-short";
	if (containsValidStashMarker(input.text)) return "already-marked";
	return null;
}

export function compressToolText(sift, input, config) {
	const skip = shouldSkipCompression(input, config);
	if (skip) return { applied: false, reason: skip };
	const hint = buildContextHint(input.toolName, input.input);
	const sourcePath = input.sourcePathEligible === false ? undefined : readSourcePath(input.toolName, input.input);
	let result;
	try {
		result = sourcePath ? sift.siftText(input.text, hint, sourcePath) : sift.siftText(input.text, hint);
	} catch {
		return { applied: false, reason: "sift-error" };
	}
	if (!result.changed || result.tokensSaved <= 0) return { applied: false, reason: "no-savings" };
	return {
		applied: true,
		text: result.text,
		tokensSaved: result.tokensSaved,
		lossy: result.lossy,
		stashKey: result.stashKey,
	};
}
