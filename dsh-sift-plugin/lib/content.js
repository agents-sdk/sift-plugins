export function extractTextBlocks(content) {
	if (!Array.isArray(content) || content.length === 0) return null;
	const texts = [];
	for (const item of content) {
		if (!item || typeof item !== "object" || item.type !== "text" || typeof item.text !== "string") {
			return null;
		}
		texts.push(item.text);
	}
	return texts.length === 0 ? null : { text: texts.join("\n"), count: texts.length };
}
