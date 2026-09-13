import { pluginDataRoot, readConfig } from "../config.js";
import { purgeExpired } from "../core.js";
import { isMainModule, readStdin } from "../io.js";
export const SESSION_CONTEXT = "[sift] Large local tool outputs may be compressed. Lossy summaries contain a <<stash:KEY>> marker. " +
    "Call the sift_retrieve MCP tool only when omitted detail is needed. Call sift_stats when the user asks for savings. " +
    "If a stash entry expired, rerun the original tool once instead of retrying retrieval.";
async function main() {
    await readStdin();
    if (!readConfig().enabled)
        return;
    try {
        purgeExpired(pluginDataRoot());
    }
    catch { /* Best effort. */ }
    process.stdout.write(`${JSON.stringify({
        hookSpecificOutput: {
            hookEventName: "SessionStart",
            additionalContext: SESSION_CONTEXT,
        },
    })}\n`);
}
if (isMainModule(import.meta.url))
    void main().catch(() => { });
