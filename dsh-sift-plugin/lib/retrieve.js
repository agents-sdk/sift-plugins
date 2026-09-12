import { parseStashKey } from "./keys.js";

const HINTS = {
	empty: "Pass the 24-character hex key from <<stash:KEY>>, or the full marker.",
	invalid: "stashKey must be a 24-character hex string or a complete <<stash:KEY>> marker.",
	missing: "The original content may have expired (TTL 1800s) or belongs to another session. Re-run the original tool instead of retrying retrieve.",
};

export function retrieveFromSift(sift, stashKey) {
	const parsed = parseStashKey(stashKey);
	if (!parsed.ok) {
		return JSON.stringify({ error: "Invalid stashKey", hint: HINTS[parsed.reason], stashKey: typeof stashKey === "string" ? stashKey : "" });
	}
	let original = null;
	try { original = sift.retrieve(parsed.key); } catch { /* A failed native lookup is a miss. */ }
	return original === null
		? JSON.stringify({ error: "Content not found in stash store", hint: HINTS.missing, stashKey: parsed.key })
		: original;
}
