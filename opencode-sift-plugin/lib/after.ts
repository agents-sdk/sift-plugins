import { compressToolText, mergeSiftDetails } from "./compress.ts";
import type { SiftPluginConfig } from "./config.ts";
import type { SessionSiftStore } from "./session-store.ts";

export type OpenCodeAfterInput = {
	tool: string;
	sessionID: string;
	callID: string;
	args: Record<string, unknown>;
};

export type OpenCodeAfterOutput = {
	title: string;
	output: string;
	metadata: Record<string, unknown> | null | undefined;
};

function isErrorMetadata(metadata: OpenCodeAfterOutput["metadata"]): boolean {
	return metadata?.error === true;
}

function isTruncatedMetadata(
	metadata: OpenCodeAfterOutput["metadata"],
): boolean {
	return metadata?.truncated === true;
}

function isReadSourcePathEligible(
	input: OpenCodeAfterInput,
	output: OpenCodeAfterOutput,
): boolean {
	if (input.tool !== "read") return false;
	const args = input.args ?? {};
	if (args.offset !== undefined || args.limit !== undefined) return false;
	if (isTruncatedMetadata(output.metadata)) return false;
	return true;
}

export function createOpenCodeAfterHandler(
	store: SessionSiftStore,
	config: SiftPluginConfig,
	worktree?: string,
) {
	return async (
		input: OpenCodeAfterInput,
		output: OpenCodeAfterOutput,
	): Promise<void> => {
		if (!config.enabled) return;
		if (isErrorMetadata(output.metadata)) return;
		if (typeof output.output !== "string") return;

		let sift;
		try {
			if (worktree) {
				store.stashDirFor(input.sessionID);
			}
			sift = store.getOrCreate(input.sessionID);
		} catch {
			return;
		}

		const outcome = compressToolText(
			sift,
			{
				toolName: input.tool,
				text: output.output,
				input: input.args,
				isError: false,
				truncated: isTruncatedMetadata(output.metadata),
				sourcePathEligible: isReadSourcePathEligible(input, output),
			},
			config,
		);

		if (!outcome.applied) return;

		output.output = outcome.text;
		output.metadata = mergeSiftDetails(output.metadata, outcome);
	};
}
