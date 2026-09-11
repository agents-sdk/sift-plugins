export type SiftToolPart = {
	type?: unknown;
	state?: {
		status?: unknown;
		metadata?: Record<string, unknown> | null;
	};
};

function savedTokensFromPart(part: SiftToolPart): number {
	if (part.type !== "tool" || part.state?.status !== "completed") return 0;
	const value = part.state.metadata?.siftTokensSaved;
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? value
		: 0;
}

export function totalSessionTokensSaved(
	messages: ReadonlyArray<{ id: string }>,
	partsForMessage: (messageID: string) => ReadonlyArray<SiftToolPart>,
): number {
	let total = 0;
	for (const message of messages) {
		for (const part of partsForMessage(message.id)) {
			total += savedTokensFromPart(part);
		}
	}
	return total;
}

export function formatTokenCount(tokens: number): string {
	const value = Math.max(0, Math.floor(tokens));
	if (value < 1_000) return String(value);
	if (value < 1_000_000) {
		return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}k`;
	}
	return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 1 : 0)}m`;
}
