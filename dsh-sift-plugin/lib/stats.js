export class SavingsStats {
	#sessions = new Map();
	#calls = new Set();
	#total = 0;

	record(sessionId, callId, tokens) {
		if (!Number.isFinite(tokens) || tokens <= 0) return false;
		const identity = `${sessionId}\0${callId}`;
		if (this.#calls.has(identity)) return false;
		this.#calls.add(identity);
		const value = Math.floor(tokens);
		this.#sessions.set(sessionId, (this.#sessions.get(sessionId) ?? 0) + value);
		this.#total += value;
		return true;
	}

	session(sessionId) { return this.#sessions.get(sessionId) ?? 0; }
	get total() { return this.#total; }
}

export function formatTokenCount(tokens) {
	const value = Math.max(0, Math.floor(tokens));
	if (value < 1_000) return String(value);
	if (value < 1_000_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}k`;
	return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 1 : 0)}m`;
}
