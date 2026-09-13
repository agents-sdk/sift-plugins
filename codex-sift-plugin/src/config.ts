import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const DEFAULT_MIN_LENGTH = 200;
export const STASH_TTL_MS = 30 * 60 * 1000;

export type SiftConfig = {
  enabled: boolean;
  minLength: number;
  excludedTools: string[];
  showStatus: boolean;
};

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return !["0", "false", "off", "no"].includes(value.trim().toLowerCase());
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): SiftConfig {
  const parsed = Number(env.SIFT_MIN_LENGTH);
  return {
    enabled: bool(env.SIFT_ENABLED, true),
    minLength: Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MIN_LENGTH,
    excludedTools: (env.SIFT_EXCLUDED_TOOLS ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    showStatus: bool(env.SIFT_SHOW_STATUS, true),
  };
}

export function pluginDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  // Codex <=0.145 does not inject PLUGIN_DATA into legacy bundled MCP servers.
  // A stable shared root keeps hooks and MCP retrieval/stats consistent on both
  // legacy and portable hosts.
  const configured = env.CODEX_SIFT_DATA?.trim();
  return resolve(configured || join(homedir(), ".codex", "sift"));
}
