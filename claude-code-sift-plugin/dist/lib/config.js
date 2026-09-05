export const DEFAULT_MIN_LENGTH = 200;
export const RETRIEVE_TOOL_NAME = "sift_retrieve";
export const STASH_TTL_MS = 1800 * 1000;
export const PURGE_INTERVAL_MS = 5 * 60 * 1000;
export function parseEnabled(value, fallback = true) {
    if (value === false || value === 0)
        return false;
    if (value === true || value === 1)
        return true;
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (["0", "false", "off", "no"].includes(normalized))
            return false;
        if (["1", "true", "on", "yes"].includes(normalized))
            return true;
    }
    return fallback;
}
export function parseMinLength(value) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        return value;
    }
    return DEFAULT_MIN_LENGTH;
}
export function parseMinLengthFromString(value) {
    if (typeof value === "string" && value.trim() !== "") {
        return parseMinLength(Number(value));
    }
    if (typeof value === "number")
        return parseMinLength(value);
    return DEFAULT_MIN_LENGTH;
}
export function parseExcludedTools(value) {
    const fromUser = Array.isArray(value)
        ? value.filter((item) => typeof item === "string" && item.trim() !== "")
        : typeof value === "string"
            ? value
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean)
            : [];
    const tools = new Set(fromUser);
    tools.add(RETRIEVE_TOOL_NAME);
    return [...tools];
}
export function utf8ByteLength(text) {
    return Buffer.byteLength(text, "utf8");
}
export function parseSiftConfig(input = {}) {
    return {
        enabled: parseEnabled(input.enabled, true),
        minLength: parseMinLengthFromString(input.minLength),
        excludedTools: parseExcludedTools(input.excludedTools),
    };
}
