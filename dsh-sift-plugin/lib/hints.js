function stringArg(input, ...keys) {
	for (const key of keys) {
		const value = input?.[key];
		if (typeof value === "string" && value !== "") return value;
	}
	return "";
}

export function buildContextHint(toolName, input) {
	switch (toolName) {
		case "bash":
		case "powershell":
			return `shell command output: ${stringArg(input, "command")}`;
		case "read":
			return `file content of ${stringArg(input, "file_path", "path", "filePath")}`;
		case "ls":
			return `directory listing of ${stringArg(input, "path")}`;
		case "glob":
			return `glob results for ${stringArg(input, "pattern")}`;
		case "grep":
			return `grep results for ${stringArg(input, "pattern")}`;
		case "find":
			return `find results for ${stringArg(input, "pattern")}`;
		case "web_fetch":
			return `web fetch output for ${stringArg(input, "url")}`;
		case "web_search":
			return `web search results for ${stringArg(input, "query")}`;
		default:
			return `tool ${toolName} output`;
	}
}

export function readSourcePath(toolName, input) {
	if (toolName !== "read" || input?.offset !== undefined || input?.limit !== undefined) return undefined;
	return stringArg(input, "file_path", "path", "filePath") || undefined;
}
