import { utf8ByteLength } from "./config.ts";
import { extractTextBlocks } from "./content.ts";
import type { CompressOutcome } from "./compress.ts";

export type TextCompressor = (text: string) => CompressOutcome;

export type ResponseCompressResult = {
	value: unknown;
	changed: boolean;
	tokensSaved: number;
	lossy: boolean;
	compressedFields: number;
};

const MAX_DEPTH = 8;

/**
 * Cheap pre-scan: is there any string field large enough to be a compression
 * candidate? Lets the hook skip loading the native sift module entirely for
 * the common small-output tool call.
 */
export function hasLargeString(
	value: unknown,
	minLength: number,
	depth = 0,
): boolean {
	if (depth > MAX_DEPTH) return false;
	if (typeof value === "string") {
		return utf8ByteLength(value) >= minLength;
	}
	if (Array.isArray(value)) {
		return value.some((item) => hasLargeString(item, minLength, depth + 1));
	}
	if (value && typeof value === "object") {
		return Object.values(value as Record<string, unknown>).some((item) =>
			hasLargeString(item, minLength, depth + 1),
		);
	}
	return false;
}

/**
 * Detects host-side truncation in the empirical tool_response shapes
 * (verified against Claude Code 2.1.159):
 *
 * - an explicit `truncated: true` flag (Glob, and others when capped)
 * - Grep line-capping: `numLines === appliedLimit`
 * - Read serving a partial view: `file.numLines < file.totalLines`
 *
 * Host-truncated outputs are skipped entirely: the stash would only be able
 * to restore the truncated text, which is misleading. User-requested partial
 * reads (tool_input offset/limit) legitimately serve fewer lines than the
 * file has, so pass readPartialRequested=true to ignore that last signal
 * (the PostToolUse hook then compresses without a sourcePath).
 */
export function isTruncatedToolResponse(
	response: unknown,
	readPartialRequested = false,
): boolean {
	if (!response || typeof response !== "object") return false;
	const record = response as Record<string, unknown>;
	if (record.truncated === true) return true;
	if (
		typeof record.appliedLimit === "number" &&
		record.numLines === record.appliedLimit
	) {
		return true;
	}
	if (readPartialRequested) return false;
	const file = record.file;
	if (file && typeof file === "object") {
		const fileRecord = file as Record<string, unknown>;
		if (
			typeof fileRecord.numLines === "number" &&
			typeof fileRecord.totalLines === "number" &&
			fileRecord.numLines < fileRecord.totalLines
		) {
			return true;
		}
	}
	return false;
}

/**
 * Walks a Claude Code `tool_response` and replaces string contents in place,
 * preserving the exact object shape so `updatedToolOutput` still matches the
 * tool's output schema (built-in tools drop mismatching rewrites silently).
 *
 * Rules:
 * - strings go through `compress` (which applies the shared skip rules)
 * - arrays of pure `{type: "text"}` blocks are joined, compressed once, and
 *   written back as a single text block (mixed content arrays are untouched,
 *   mirroring the Pi adapter)
 * - objects/arrays are rebuilt recursively; other types pass through
 */
export function compressToolResponse(
	response: unknown,
	compress: TextCompressor,
): ResponseCompressResult {
	const acc = { tokensSaved: 0, lossy: false, compressedFields: 0 };
	const value = walk(response, compress, acc, 0, new Set<unknown>());
	return {
		value,
		changed: acc.compressedFields > 0,
		tokensSaved: acc.tokensSaved,
		lossy: acc.lossy,
		compressedFields: acc.compressedFields,
	};
}

function walk(
	value: unknown,
	compress: TextCompressor,
	acc: { tokensSaved: number; lossy: boolean; compressedFields: number },
	depth: number,
	seen: Set<unknown>,
): unknown {
	if (depth > MAX_DEPTH) return value;
	if (typeof value === "string") {
		const compressed = compressString(value, compress, acc);
		return compressed === null ? value : compressed;
	}
	if (Array.isArray(value)) {
		const extracted = extractTextBlocks(value);
		if (extracted) {
			const outcome = compressString(extracted.text, compress, acc);
			if (outcome === null) return value;
			return [{ type: "text", text: outcome }];
		}
		return value.map((item) => walk(item, compress, acc, depth + 1, seen));
	}
	if (value && typeof value === "object") {
		if (seen.has(value)) return value;
		seen.add(value);
		const out: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(
			value as Record<string, unknown>,
		)) {
			out[key] = walk(item, compress, acc, depth + 1, seen);
		}
		return out;
	}
	return value;
}

function compressString(
	text: string,
	compress: TextCompressor,
	acc: { tokensSaved: number; lossy: boolean; compressedFields: number },
): string | null {
	const outcome = compress(text);
	if (!outcome.applied) return null;
	acc.tokensSaved += outcome.tokensSaved;
	acc.lossy = acc.lossy || outcome.lossy;
	acc.compressedFields += 1;
	return outcome.text;
}
