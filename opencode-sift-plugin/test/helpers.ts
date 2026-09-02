import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SessionSiftStore, type SiftLike } from "../lib/session-store.ts";

export const vectorsPath = fileURLToPath(
	new URL("../../docs/contract-vectors.json", import.meta.url),
);

export function loadVectors() {
	return JSON.parse(readFileSync(vectorsPath, "utf8")) as {
		keys: Record<string, string>;
		minLength: Record<string, unknown>;
		hints: Record<
			string,
			{ toolName: string; input: Record<string, unknown>; expected: string }
		>;
	};
}

export function tempDir(prefix: string): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

export function cleanup(dir: string): void {
	rmSync(dir, { recursive: true, force: true });
}

export function fakeSift(overrides: Partial<SiftLike> = {}): SiftLike {
	const store = new Map<string, string>();
	return {
		siftText(text, _query, _sourcePath) {
			if (overrides.siftText)
				return overrides.siftText(text, _query, _sourcePath);
			if (text.length < 80) {
				return {
					text,
					changed: false,
					lossy: false,
					stashKey: null,
					tokensSaved: 0,
				};
			}
			const key = "0123456789abcdef01234567";
			store.set(key, text);
			return {
				text: `${text.slice(0, 40)}\n<<stash:${key}>>`,
				changed: true,
				lossy: true,
				stashKey: key,
				tokensSaved: 12,
			};
		},
		retrieve(key) {
			if (overrides.retrieve) return overrides.retrieve(key);
			return store.get(key) ?? null;
		},
	};
}

export function storeWithFake(
	root?: string,
	sift?: SiftLike,
): { store: SessionSiftStore; root: string } {
	const dir = root ?? tempDir("sift-oc-");
	mkdirSync(dir, { recursive: true });
	const instance = sift ?? fakeSift();
	return {
		root: dir,
		store: new SessionSiftStore(dir, undefined, () => instance),
	};
}
