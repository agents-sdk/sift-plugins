function str(input, key) {
    const value = input?.[key];
    return typeof value === "string" ? value : "";
}
export function buildContextHint(toolName, input) {
    switch (toolName) {
        case "bash":
        case "powershell":
        case "Bash":
            return `shell command output: ${str(input, "command")}`;
        case "read":
        case "Read": {
            const path = str(input, "path") || str(input, "filePath") || str(input, "file_path");
            return `file content of ${path}`;
        }
        case "ls":
        case "LS":
            return `directory listing of ${str(input, "path")}`;
        case "glob":
        case "Glob":
            return `glob results for ${str(input, "pattern")}`;
        case "grep":
        case "Grep":
            return `grep results for ${str(input, "pattern")}`;
        case "find":
            return `find results for ${str(input, "pattern")}`;
        case "webfetch":
        case "websearch":
        case "WebFetch":
        case "WebSearch":
            return "web fetch/search output";
        case "Task":
        case "Agent":
            return `subagent task output: ${str(input, "description")}`;
        default:
            return `tool ${toolName} output`;
    }
}
export function readSourcePath(toolName, input) {
    if (toolName !== "read" && toolName !== "Read")
        return undefined;
    if (input?.offset !== undefined || input?.limit !== undefined)
        return undefined;
    const path = str(input, "path") || str(input, "filePath") || str(input, "file_path");
    return path || undefined;
}
