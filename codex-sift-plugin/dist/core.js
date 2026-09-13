import { chmodSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { createSift } from "@agent-context/sift";
import { STASH_TTL_MS } from "./config.js";
const MAX_DEPTH = 8;
const MARKER = /<<stash:[0-9a-fA-F]{24}>>/;
function encodeSessionId(value) {
    if (!value || value === "." || value === "..")
        throw new Error("invalid session id");
    return value.replace(/[^A-Za-z0-9._-]/g, (char) => `_${Buffer.from(char).toString("hex")}_`);
}
export function stashDir(root, sessionId) {
    const base = resolve(root, "stash");
    const dir = resolve(base, encodeSessionId(sessionId));
    if (dir !== base && !dir.startsWith(base + sep))
        throw new Error("stash path escaped root");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
        chmodSync(dir, 0o700);
    }
    catch { /* Best effort. */ }
    return dir;
}
function hint(toolName, input) {
    const command = typeof input.command === "string" ? input.command : "";
    const path = [input.path, input.file_path, input.filePath].find((item) => typeof item === "string") ?? "";
    if (toolName === "Bash")
        return `shell command output: ${command}`;
    if (/read/i.test(toolName))
        return `file content of ${path}`;
    if (/grep|search/i.test(toolName))
        return `search results for ${String(input.pattern ?? "")}`;
    return `Codex ${toolName} tool output`;
}
function sourcePath(toolName, input) {
    if (!/read/i.test(toolName) || input.offset !== undefined || input.limit !== undefined)
        return undefined;
    const value = input.path ?? input.file_path ?? input.filePath;
    return typeof value === "string" && value ? value : undefined;
}
export function hasCandidate(value, minLength, depth = 0) {
    if (depth > MAX_DEPTH)
        return false;
    if (typeof value === "string")
        return Buffer.byteLength(value, "utf8") >= minLength;
    if (Array.isArray(value))
        return value.some((item) => hasCandidate(item, minLength, depth + 1));
    if (value && typeof value === "object") {
        return Object.values(value).some((item) => hasCandidate(item, minLength, depth + 1));
    }
    return false;
}
export function isFailedOrTruncated(value) {
    if (!value || typeof value !== "object")
        return false;
    const record = value;
    const exit = record.exit_code ?? record.exitCode;
    if (typeof exit === "number" && exit !== 0)
        return true;
    if (record.isError === true || record.error === true || record.truncated === true)
        return true;
    return Object.values(record).some((item) => isFailedOrTruncated(item));
}
export function compressResponse(root, sessionId, toolName, toolInput, response, config) {
    const sift = createSift({ stashDir: stashDir(root, sessionId) });
    const context = hint(toolName, toolInput);
    const path = sourcePath(toolName, toolInput);
    const acc = { tokensSaved: 0, lossy: false, fields: 0 };
    const seen = new Set();
    const walk = (value, depth) => {
        if (depth > MAX_DEPTH)
            return value;
        if (typeof value === "string") {
            if (Buffer.byteLength(value, "utf8") < config.minLength || MARKER.test(value))
                return value;
            let result;
            try {
                result = path ? sift.siftText(value, context, path) : sift.siftText(value, context);
            }
            catch {
                return value;
            }
            if (!result.changed || result.tokensSaved <= 0)
                return value;
            acc.tokensSaved += result.tokensSaved;
            acc.lossy ||= result.lossy;
            acc.fields += 1;
            return result.text;
        }
        if (Array.isArray(value))
            return value.map((item) => walk(item, depth + 1));
        if (value && typeof value === "object") {
            if (seen.has(value))
                return value;
            seen.add(value);
            return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item, depth + 1)]));
        }
        return value;
    };
    const value = walk(response, 0);
    return { value, changed: acc.fields > 0, ...acc };
}
export function retrieveFromStashes(root, key) {
    if (!/^[0-9a-fA-F]{24}$/.test(key))
        return null;
    const base = resolve(root, "stash");
    let dirs = [];
    try {
        dirs = readdirSync(base, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => join(base, entry.name));
    }
    catch {
        return null;
    }
    dirs.sort((a, b) => {
        try {
            return statSync(b).mtimeMs - statSync(a).mtimeMs;
        }
        catch {
            return 0;
        }
    });
    for (const dir of dirs) {
        try {
            const text = createSift({ stashDir: dir }).retrieve(key);
            if (text !== null)
                return text;
        }
        catch { /* Continue scanning. */ }
    }
    return null;
}
export function purgeExpired(root, now = Date.now()) {
    const base = resolve(root, "stash");
    let removed = 0;
    let dirs = [];
    try {
        dirs = readdirSync(base, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => join(base, entry.name));
    }
    catch {
        return 0;
    }
    for (const dir of dirs) {
        let names = [];
        try {
            names = readdirSync(dir);
        }
        catch {
            continue;
        }
        for (const name of names) {
            if (name.startsWith("."))
                continue;
            const file = join(dir, name);
            try {
                const stat = statSync(file);
                if (stat.isFile() && now - stat.mtimeMs > STASH_TTL_MS) {
                    rmSync(file, { force: true });
                    removed += 1;
                }
            }
            catch { /* Entry disappeared during the sweep. */ }
        }
    }
    return removed;
}
