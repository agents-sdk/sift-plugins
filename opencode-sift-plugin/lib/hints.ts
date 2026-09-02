function str(input: Record<string, unknown> | undefined, key: string): string {
	const value = input?.[key];
	return typeof value === "string" ? value : "";
}

export function buildContextHint(toolName: string, input?: Record<string, unknown>): string {
	switch (toolName) {
		case "bash":
		case "powershell":
			return `shell command output: ${str(input, "command")}`;
		case "read": {
			const path = str(input, "path") || str(input, "filePath");
			return `file content of ${path}`;
		}
		case "ls":
			return `directory listing of ${str(input, "path")}`;
		case "glob":
			return `glob results for ${str(input, "pattern")}`;
		case "grep":
			return `grep results for ${str(input, "pattern")}`;
		case "find":
			return `find results for ${str(input, "pattern")}`;
		case "webfetch":
		case "websearch":
			return "web fetch/search output";
		default:
			return `tool ${toolName} output`;
	}
}

export function readSourcePath(toolName: string, input?: Record<string, unknown>): string | undefined {
	if (toolName !== "read") return undefined;
	if (input?.offset !== undefined || input?.limit !== undefined) return undefined;
	const path = str(input, "path") || str(input, "filePath");
	return path || undefined;
}
