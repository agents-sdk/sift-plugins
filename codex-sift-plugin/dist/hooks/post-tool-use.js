import { compressResponse, hasCandidate, isFailedOrTruncated } from "../core.js";
import { pluginDataRoot, readConfig } from "../config.js";
import { isMainModule, readStdin } from "../io.js";
import { appendSaving, formatTokens, readSavings } from "../stats.js";
function record(value) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : {};
}
function modelText(toolName, value, tokensSaved) {
    const body = typeof value === "string" ? value : JSON.stringify(value);
    return `[sift] Compressed ${toolName} result; saved about ${tokensSaved} context tokens.\n${body}`;
}
export function handlePostToolUse(input, env = process.env) {
    if (!input || typeof input !== "object")
        return null;
    const event = input;
    const config = readConfig(env);
    const sessionId = typeof event.session_id === "string" ? event.session_id.trim() : "";
    const toolName = typeof event.tool_name === "string" ? event.tool_name : "";
    const toolUseId = typeof event.tool_use_id === "string" ? event.tool_use_id : "";
    if (!config.enabled || !sessionId || !toolName || !toolUseId)
        return null;
    if (toolName.includes("sift_retrieve") || toolName.includes("sift_stats"))
        return null;
    if (config.excludedTools.includes(toolName))
        return null;
    if (isFailedOrTruncated(event.tool_response))
        return null;
    if (!hasCandidate(event.tool_response, config.minLength))
        return null;
    const root = pluginDataRoot(env);
    const result = compressResponse(root, sessionId, toolName, record(event.tool_input), event.tool_response, config);
    if (!result.changed)
        return null;
    appendSaving(root, {
        sessionId,
        toolUseId,
        toolName,
        tokensSaved: result.tokensSaved,
        lossy: result.lossy,
        at: new Date().toISOString(),
    });
    const total = readSavings(root, sessionId).tokensSaved;
    const output = {
        continue: false,
        stopReason: modelText(toolName, result.value, result.tokensSaved),
    };
    if (config.showStatus) {
        output.systemMessage = `Sift saved ${formatTokens(total)} tokens in this session`;
    }
    return output;
}
async function main() {
    let input;
    try {
        input = JSON.parse(await readStdin());
    }
    catch {
        return;
    }
    try {
        const result = handlePostToolUse(input);
        if (result)
            process.stdout.write(`${JSON.stringify(result)}\n`);
    }
    catch {
        // Fail open: an adapter failure must leave the original tool result untouched.
    }
}
if (isMainModule(import.meta.url))
    void main();
