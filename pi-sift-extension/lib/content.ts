export type TextBlock = { type: "text"; text: string };
export type ImageBlock = { type: "image"; [key: string]: unknown };
export type ContentBlock = TextBlock | ImageBlock | Record<string, unknown>;

export function extractTextBlocks(
	content: unknown,
): { text: string; count: number } | null {
	if (!Array.isArray(content) || content.length === 0) return null;
	const texts: string[] = [];
	for (const item of content) {
		if (!item || typeof item !== "object") return null;
		if ((item as { type?: unknown }).type !== "text") return null;
		const text = (item as { text?: unknown }).text;
		if (typeof text !== "string") return null;
		texts.push(text);
	}
	if (texts.length === 0) return null;
	return { text: texts.join("\n"), count: texts.length };
}

export function isTruncatedDetails(details: unknown): boolean {
	if (!details || typeof details !== "object") return false;
	const truncation = (details as { truncation?: { truncated?: unknown } })
		.truncation;
	return truncation?.truncated === true;
}
