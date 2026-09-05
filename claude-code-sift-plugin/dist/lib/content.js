export function extractTextBlocks(content) {
    if (!Array.isArray(content) || content.length === 0)
        return null;
    const texts = [];
    for (const item of content) {
        if (!item || typeof item !== "object")
            return null;
        if (item.type !== "text")
            return null;
        const text = item.text;
        if (typeof text !== "string")
            return null;
        texts.push(text);
    }
    if (texts.length === 0)
        return null;
    return { text: texts.join("\n"), count: texts.length };
}
export function isTruncatedDetails(details) {
    if (!details || typeof details !== "object")
        return false;
    const truncation = details.truncation;
    return truncation?.truncated === true;
}
