import { Buffer } from "node:buffer";
import { chmodSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createSift } from "@agent-context/sift";
import { STASH_TTL_MS } from "./config.js";

function expandHome(path) {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return join(homedir(), path.slice(2));
	return path;
}

export function dshStashRoot(env = process.env) {
	const root = env.DSH_HOME?.trim() ? expandHome(env.DSH_HOME.trim()) : join(homedir(), ".dsh");
	return resolve(root, "sift");
}

export function encodeSessionId(sessionId) {
	if (typeof sessionId !== "string" || sessionId.trim() === "" || [".", ".."].includes(sessionId.trim())) {
		throw new Error("invalid session id");
	}
	return sessionId.trim().replace(/[^A-Za-z0-9._-]/g, (ch) => `_${Buffer.from(ch).toString("hex")}_`);
}

export class SessionSiftStore {
	#cache = new Map();
	constructor(stashRoot, factory = (stashDir) => createSift({ stashDir })) {
		this.stashRoot = resolve(stashRoot);
		this.factory = factory;
	}

	stashDirFor(sessionId) {
		const dir = resolve(this.stashRoot, encodeSessionId(sessionId));
		if (dir === this.stashRoot || !dir.startsWith(this.stashRoot + sep)) throw new Error("stash path escaped root");
		return dir;
	}

	getOrCreate(sessionId) {
		const cached = this.#cache.get(sessionId);
		if (cached) return cached;
		const dir = this.stashDirFor(sessionId);
		mkdirSync(dir, { recursive: true, mode: 0o700 });
		try { chmodSync(dir, 0o700); } catch { /* Filesystems may ignore POSIX modes. */ }
		const sift = this.factory(dir);
		this.#cache.set(sessionId, sift);
		return sift;
	}

	dispose() { this.#cache.clear(); }

	purgeExpired(now = Date.now()) {
		let dirs;
		try {
			dirs = readdirSync(this.stashRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
		} catch {
			return 0;
		}
		let removed = 0;
		for (const entry of dirs) {
			const dir = join(this.stashRoot, entry.name);
			let files;
			try { files = readdirSync(dir); } catch { continue; }
			for (const name of files) {
				if (name.startsWith(".")) continue;
				const file = join(dir, name);
				try {
					const stat = statSync(file);
					if (stat.isFile() && now - stat.mtimeMs > STASH_TTL_MS) {
						rmSync(file, { force: true });
						removed += 1;
					}
				} catch { /* Entries can disappear during cleanup. */ }
			}
		}
		return removed;
	}
}
