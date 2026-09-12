export const DEFAULT_MIN_LENGTH = 200;
export const RETRIEVE_TOOL_NAME = "sift_retrieve";
export const STASH_TTL_MS = 1800 * 1000;
export const PURGE_INTERVAL_MS = 5 * 60 * 1000;

const SAVINGS_MODES = new Set(["command", "log", "both", "off"]);

function invalid(field, expected) {
	throw new TypeError(`sift config ${field} must be ${expected}`);
}

export function parseSiftConfig(input = {}) {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		invalid("value", "an object");
	}
	const enabled = input.enabled ?? true;
	if (typeof enabled !== "boolean") invalid("enabled", "a boolean");
	const minLength = input.minLength ?? DEFAULT_MIN_LENGTH;
	if (!Number.isSafeInteger(minLength) || minLength <= 0) {
		invalid("minLength", "a positive integer");
	}
	const excluded = input.excludedTools ?? [];
	if (!Array.isArray(excluded) || excluded.some((item) => typeof item !== "string" || item.trim() === "")) {
		invalid("excludedTools", "an array of non-empty strings");
	}
	const showSavings = input.showSavings ?? "command";
	if (typeof showSavings !== "string" || !SAVINGS_MODES.has(showSavings)) {
		invalid("showSavings", 'one of "command", "log", "both", or "off"');
	}
	return {
		enabled,
		minLength,
		excludedTools: [...new Set([...excluded.map((item) => item.trim()), RETRIEVE_TOOL_NAME])],
		showSavings,
	};
}
