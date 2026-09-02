import { chmodSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createSift, type Sift } from "@agent-context/sift";
import { STASH_TTL_MS } from "./config.ts";

export type SiftLike = {
	siftText(
		text: string,
		query?: string,
		sourcePath?: string,
	): {
		text: string;
		changed: boolean;
		lossy: boolean;
		stashKey: string | null;
		tokensSaved: number;
	};
	retrieve(key: string): string | null;
};

function expandHome(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return join(homedir(), path.slice(2));
	return path;
}

export function encodeSessionId(sessionId: string): string {
	if (typeof sessionId !== "string" || sessionId.trim() === "") {
		throw new Error("invalid session id");
	}
	const trimmed = sessionId.trim();
	if (trimmed === "." || trimmed === "..") {
		throw new Error("invalid session id");
	}
	return trimmed.replace(
		/[^A-Za-z0-9._-]/g,
		(ch) => `_${Buffer.from(ch).toString("hex")}_`,
	);
}

export function piStashRoot(env: NodeJS.ProcessEnv = process.env): string {
	const raw = env.PI_CODING_AGENT_DIR?.trim();
	const root = raw ? expandHome(raw) : join(homedir(), ".pi", "agent");
	return resolve(root, "sift");
}

export function openCodeStashRoot(
	env: NodeJS.ProcessEnv = process.env,
): string {
	const xdg = env.XDG_DATA_HOME?.trim();
	const data = xdg ? expandHome(xdg) : join(homedir(), ".local", "share");
	return resolve(data, "opencode", "sift");
}

export function assertOutsideWorktree(dir: string, worktree?: string): void {
	if (!worktree) return;
	const resolvedDir = resolve(dir);
	const resolvedWorktree = resolve(worktree);
	if (
		resolvedDir === resolvedWorktree ||
		resolvedDir.startsWith(resolvedWorktree + sep)
	) {
		throw new Error(
			`sift stash directory must not be inside the worktree: ${resolvedDir}`,
		);
	}
}

export class SessionSiftStore {
	private readonly cache = new Map<string, SiftLike>();
	private readonly stashRoot: string;
	private readonly worktree?: string;
	private readonly factory: (stashDir: string) => SiftLike;

	constructor(
		stashRoot: string,
		worktree?: string,
		factory?: (stashDir: string) => SiftLike,
	) {
		this.stashRoot = stashRoot;
		this.worktree = worktree;
		this.factory = factory ?? ((stashDir) => createSift({ stashDir }) as Sift);
	}

	stashDirFor(sessionKey: string): string {
		const encoded = encodeSessionId(sessionKey);
		const root = resolve(this.stashRoot);
		const dir = resolve(root, encoded);
		if (dir !== root && !dir.startsWith(root + sep)) {
			throw new Error("stash path escaped root");
		}
		assertOutsideWorktree(dir, this.worktree);
		return dir;
	}

	getOrCreate(sessionKey: string): SiftLike {
		const cached = this.cache.get(sessionKey);
		if (cached) return cached;
		const dir = this.stashDirFor(sessionKey);
		mkdirSync(dir, { recursive: true, mode: 0o700 });
		try {
			chmodSync(dir, 0o700);
		} catch {
			// Best-effort private permissions on platforms that ignore mkdir mode.
		}
		const sift = this.factory(dir);
		this.cache.set(sessionKey, sift);
		return sift;
	}

	drop(sessionKey: string): void {
		this.cache.delete(sessionKey);
	}

	dispose(): void {
		this.cache.clear();
	}

	has(sessionKey: string): boolean {
		return this.cache.has(sessionKey);
	}

	purgeExpired(now = Date.now()): number {
		let removed = 0;
		let sessionDirs: string[] = [];
		try {
			sessionDirs = readdirSync(this.stashRoot, { withFileTypes: true })
				.filter((entry) => entry.isDirectory())
				.map((entry) => join(this.stashRoot, entry.name));
		} catch {
			return 0;
		}

		for (const dir of sessionDirs) {
			let files: string[] = [];
			try {
				files = readdirSync(dir);
			} catch {
				continue;
			}
			for (const name of files) {
				if (name.startsWith(".")) continue;
				const file = join(dir, name);
				try {
					const stat = statSync(file);
					if (!stat.isFile()) continue;
					if (now - stat.mtimeMs > STASH_TTL_MS) {
						rmSync(file, { force: true });
						removed += 1;
					}
				} catch {
					// ignore entries that disappear mid-scan
				}
			}
		}
		return removed;
	}
}
