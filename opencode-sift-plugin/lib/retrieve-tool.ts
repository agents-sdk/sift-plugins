import { retrieveErrorText, retrieveFromSift } from "./retrieve.ts";
import type { SessionSiftStore } from "./session-store.ts";

export const SIFT_RETRIEVE_DESCRIPTION =
	"Retrieve the full original tool output from the local sift stash. " +
	"Call this when compressed tool output contains <<stash:KEY>> and you need the original text. " +
	"Pass either the 24-character hex key inside the marker or the complete <<stash:KEY>> marker. " +
	"If retrieval fails because the stash expired, re-run the original tool instead of looping on retrieve.";

export async function executeOpenCodeRetrieve(
	store: SessionSiftStore,
	args: { stashKey: string },
	sessionID: string | undefined,
): Promise<string> {
	let sift = null;
	try {
		sift = sessionID ? store.getOrCreate(sessionID) : null;
	} catch {
		sift = null;
	}
	const outcome = retrieveFromSift(sift, args?.stashKey);
	if (!outcome.ok) return retrieveErrorText(outcome.json);
	return outcome.text;
}
