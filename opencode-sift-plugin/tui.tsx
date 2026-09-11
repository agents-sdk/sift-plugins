/** @jsxImportSource @opentui/solid */

import type {
	TuiPlugin,
	TuiPluginApi,
	TuiPluginModule,
	TuiSlotPlugin,
} from "@opencode-ai/plugin/tui";
import { createMemo } from "solid-js";
import {
	formatTokenCount,
	totalSessionTokensSaved,
} from "./lib/tui-stats.ts";

const PLUGIN_ID = "sift";

function SessionSavings(props: { api: TuiPluginApi; sessionID: string }) {
	const saved = createMemo(() =>
		totalSessionTokensSaved(
			props.api.state.session.messages(props.sessionID),
			(messageID) => props.api.state.part(messageID),
		),
	);

	return (
		<text fg={props.api.theme.current.success}>
			Sift saved {formatTokenCount(saved())} tokens
		</text>
	);
}

const tui: TuiPlugin = async (api) => {
	const slots: TuiSlotPlugin = {
		slots: {
			session_prompt_right: (_context, props) => (
				<SessionSavings api={api} sessionID={props.session_id} />
			),
		},
	};

	api.slots.register(slots);
};

const plugin: TuiPluginModule & { id: string } = {
	id: PLUGIN_ID,
	tui,
};

export default plugin;
