import { parseStashKey } from "./keys.ts";
import type { SiftLike } from "./session-store.ts";

export type RetrieveJsonError = {
	error: string;
	hint: string;
	stashKey: string;
};

export type RetrieveOutcome =
	| { ok: true; text: string; stashKey: string }
	| { ok: false; json: RetrieveJsonError };

const HINTS = {
	empty:
		"Pass the 24-character hex key from <<stash:KEY>>, or the full marker.",
	invalid:
		"stashKey must be a 24-character hex string or a complete <<stash:KEY>> marker. Do not pass paths or other text.",
	noStore:
		"No active sift stash store found for this session. Re-run the original tool if you still need the output.",
	missing:
		"The original content may have expired (TTL 1800s) or belongs to another session. Re-run the original tool instead of retrying retrieve in a loop.",
} as const;

export function retrieveFromSift(
	sift: SiftLike | null,
	stashKey: unknown,
): RetrieveOutcome {
	const parsed = parseStashKey(stashKey);
	if (!parsed.ok) {
		return {
			ok: false,
			json: {
				error: "Invalid stashKey",
				hint: parsed.reason === "empty" ? HINTS.empty : HINTS.invalid,
				stashKey: typeof stashKey === "string" ? stashKey : "",
			},
		};
	}

	if (!sift) {
		return {
			ok: false,
			json: {
				error: "No active sift stash store found",
				hint: HINTS.noStore,
				stashKey: parsed.key,
			},
		};
	}

	let original: string | null;
	try {
		original = sift.retrieve(parsed.key);
	} catch {
		original = null;
	}

	if (original === null) {
		return {
			ok: false,
			json: {
				error: "Content not found in stash store",
				hint: HINTS.missing,
				stashKey: parsed.key,
			},
		};
	}

	return { ok: true, text: original, stashKey: parsed.key };
}

export function retrieveErrorText(error: RetrieveJsonError): string {
	return JSON.stringify(error);
}
