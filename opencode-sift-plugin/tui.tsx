/** @jsxImportSource @opentui/solid */

import type {
	TuiPlugin,
	TuiPluginApi,
	TuiPluginModule,
	TuiSlotPlugin,
} from "@opencode-ai/plugin/tui";
import type { TextRenderable } from "@opentui/core";
import {
	formatTokenCount,
	SessionSavingsCounter,
} from "./lib/tui-stats.ts";

const PLUGIN_ID = "sift";

function SessionSavings(props: { api: TuiPluginApi; sessionID: string }) {
	const counter = new SessionSavingsCounter();
	const family = new Set([props.sessionID]);
	let savedText: TextRenderable | undefined;
	let disposed = false;
	const render = () => {
		if (!savedText || savedText.isDestroyed) return;
		savedText.content = `${formatTokenCount(counter.total)} tokens saved`;
	};

	const update = (part: Parameters<SessionSavingsCounter["update"]>[0]) => {
		if (counter.update(part)) render();
	};

	for (const message of props.api.state.session.messages(props.sessionID)) {
		for (const part of props.api.state.part(message.id)) update(part);
	}

	const stopUpdated = props.api.event.on("message.part.updated", (event) => {
		const part = event.properties.part;
		if (family.has(part.sessionID)) update(part);
	});
	const stopRemoved = props.api.event.on("message.part.removed", (event) => {
		if (
			family.has(event.properties.sessionID) &&
			counter.remove(event.properties.partID)
		) {
			render();
		}
	});
	const loadSession = async (sessionID: string): Promise<void> => {
		const [messages, children] = await Promise.all([
			props.api.client.session.messages({ sessionID }),
			props.api.client.session.children({ sessionID }),
		]);
		for (const message of messages.data ?? []) {
			for (const part of message.parts) update(part);
		}
		await Promise.all(
			(children.data ?? []).map(async (child) => {
				if (family.has(child.id)) return;
				family.add(child.id);
				await loadSession(child.id);
			}),
		);
	};
	const stopCreated = props.api.event.on("session.created", (event) => {
		const session = event.properties.info;
		if (!session.parentID || !family.has(session.parentID)) return;
		family.add(session.id);
		void loadSession(session.id).catch(() => {
			// Live part events still cover the new child if history loading fails.
		});
	});
	const dispose = () => {
		if (disposed) return;
		disposed = true;
		stopUpdated();
		stopRemoved();
		stopCreated();
	};
	const setSavedText = (node: TextRenderable) => {
		savedText = node;
		render();
		node.once("destroyed", dispose);
	};

	void loadSession(props.sessionID).catch(() => {
			// Live part events continue to update the counter if history loading fails.
	});

	return (
		<box>
			<text fg={props.api.theme.current.text}>
				<b>Sift</b>
			</text>
			<text ref={setSavedText} fg={props.api.theme.current.success} />
		</box>
	);
}

const tui: TuiPlugin = async (api) => {
	const slots: TuiSlotPlugin = {
		// OpenCode's built-in Context and MCP sidebar sections use 100 and 200.
		order: 150,
		slots: {
			sidebar_content: (_context, props) => (
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
