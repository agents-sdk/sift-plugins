import { readSiftConfigFromEnv } from "../env.js";
import { isMainModule } from "../is-main-module.js";
import { readStdin } from "../stdin.js";
export const SIFT_SESSION_CONTEXT = "[sift] Very large tool outputs are compressed to a summary plus a " +
    "<<stash:KEY>> marker (24-hex key). When you need the omitted detail, call " +
    "the sift_retrieve tool (MCP server \"sift\") with the key — the bare key " +
    "or the complete <<stash:KEY>> marker both work. If retrieval reports the " +
    "content expired or missing, re-run the original tool instead of retrying " +
    "sift_retrieve in a loop.";
async function main() {
    await readStdin();
    const config = readSiftConfigFromEnv();
    if (!config.enabled)
        return;
    const { SessionSiftStore, claudeCodeStashRoot } = await import("../lib/session-store.js");
    try {
        new SessionSiftStore(claudeCodeStashRoot()).purgeExpired();
    }
    catch {
        // Purge is best-effort; expired files are cleaned up on a later start.
    }
    process.stdout.write(`${JSON.stringify({
        hookSpecificOutput: {
            hookEventName: "SessionStart",
            additionalContext: SIFT_SESSION_CONTEXT,
        },
    })}\n`);
}
if (isMainModule(import.meta.url)) {
    main().catch(() => {
        // SessionStart context is optional; never fail the session over it.
    });
}
