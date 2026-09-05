import { chmodSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createSift } from "@agent-context/sift";
import { STASH_TTL_MS } from "./config.js";
function expandHome(path) {
    if (path === "~")
        return homedir();
    if (path.startsWith("~/"))
        return join(homedir(), path.slice(2));
    return path;
}
export function encodeSessionId(sessionId) {
    if (typeof sessionId !== "string" || sessionId.trim() === "") {
        throw new Error("invalid session id");
    }
    const trimmed = sessionId.trim();
    if (trimmed === "." || trimmed === "..") {
        throw new Error("invalid session id");
    }
    return trimmed.replace(/[^A-Za-z0-9._-]/g, (ch) => `_${Buffer.from(ch).toString("hex")}_`);
}
export function piStashRoot(env = process.env) {
    const raw = env.PI_CODING_AGENT_DIR?.trim();
    const root = raw ? expandHome(raw) : join(homedir(), ".pi", "agent");
    return resolve(root, "sift");
}
export function openCodeStashRoot(env = process.env) {
    const xdg = env.XDG_DATA_HOME?.trim();
    const data = xdg ? expandHome(xdg) : join(homedir(), ".local", "share");
    return resolve(data, "opencode", "sift");
}
export function claudeCodeStashRoot(env = process.env) {
    const data = env.CLAUDE_PLUGIN_DATA?.trim();
    if (data)
        return resolve(expandHome(data), "stash");
    return resolve(homedir(), ".claude", "sift");
}
export function assertOutsideWorktree(dir, worktree) {
    if (!worktree)
        return;
    const resolvedDir = resolve(dir);
    const resolvedWorktree = resolve(worktree);
    if (resolvedDir === resolvedWorktree ||
        resolvedDir.startsWith(resolvedWorktree + sep)) {
        throw new Error(`sift stash directory must not be inside the worktree: ${resolvedDir}`);
    }
}
export class SessionSiftStore {
    cache = new Map();
    stashRoot;
    worktree;
    factory;
    constructor(stashRoot, worktree, factory) {
        this.stashRoot = stashRoot;
        this.worktree = worktree;
        this.factory = factory ?? ((stashDir) => createSift({ stashDir }));
    }
    stashDirFor(sessionKey) {
        const encoded = encodeSessionId(sessionKey);
        const root = resolve(this.stashRoot);
        const dir = resolve(root, encoded);
        if (dir !== root && !dir.startsWith(root + sep)) {
            throw new Error("stash path escaped root");
        }
        assertOutsideWorktree(dir, this.worktree);
        return dir;
    }
    getOrCreate(sessionKey) {
        const cached = this.cache.get(sessionKey);
        if (cached)
            return cached;
        const dir = this.stashDirFor(sessionKey);
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        try {
            chmodSync(dir, 0o700);
        }
        catch {
            // Best-effort private permissions on platforms that ignore mkdir mode.
        }
        const sift = this.factory(dir);
        this.cache.set(sessionKey, sift);
        return sift;
    }
    drop(sessionKey) {
        this.cache.delete(sessionKey);
    }
    dispose() {
        this.cache.clear();
    }
    has(sessionKey) {
        return this.cache.has(sessionKey);
    }
    purgeExpired(now = Date.now()) {
        let removed = 0;
        let sessionDirs = [];
        try {
            sessionDirs = readdirSync(this.stashRoot, { withFileTypes: true })
                .filter((entry) => entry.isDirectory())
                .map((entry) => join(this.stashRoot, entry.name));
        }
        catch {
            return 0;
        }
        for (const dir of sessionDirs) {
            let files = [];
            try {
                files = readdirSync(dir);
            }
            catch {
                continue;
            }
            for (const name of files) {
                if (name.startsWith("."))
                    continue;
                const file = join(dir, name);
                try {
                    const stat = statSync(file);
                    if (!stat.isFile())
                        continue;
                    if (now - stat.mtimeMs > STASH_TTL_MS) {
                        rmSync(file, { force: true });
                        removed += 1;
                    }
                }
                catch {
                    // ignore entries that disappear mid-scan
                }
            }
        }
        return removed;
    }
}
