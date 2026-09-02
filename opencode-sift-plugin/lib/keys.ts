const BARE_KEY = /^[0-9a-fA-F]{24}$/;
const FULL_MARKER = /^<<stash:([0-9a-fA-F]{24})>>$/;
const MARKER_IN_TEXT = /<<stash:[0-9a-fA-F]{24}>>/;

export type ParsedStashKey = { ok: true; key: string } | { ok: false; reason: "empty" | "invalid" };

export function parseStashKey(raw: unknown): ParsedStashKey {
	if (typeof raw !== "string") return { ok: false, reason: "invalid" };
	const trimmed = raw.trim();
	if (!trimmed) return { ok: false, reason: "empty" };

	const marker = trimmed.match(FULL_MARKER);
	if (marker) return { ok: true, key: marker[1] };
	if (BARE_KEY.test(trimmed)) return { ok: true, key: trimmed };
	return { ok: false, reason: "invalid" };
}

export function containsValidStashMarker(text: string): boolean {
	return MARKER_IN_TEXT.test(text);
}

export function isBareStashKey(value: string): boolean {
	return BARE_KEY.test(value);
}
