import { appendFileSync, chmodSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type SavingEvent = {
  sessionId: string;
  toolUseId: string;
  toolName: string;
  tokensSaved: number;
  lossy: boolean;
  at: string;
};

function statsPath(root: string): string {
  return join(root, "savings.ndjson");
}

export function appendSaving(root: string, event: SavingEvent): void {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  try { chmodSync(root, 0o700); } catch { /* Best effort on non-POSIX filesystems. */ }
  appendFileSync(statsPath(root), `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
}

export type SavingSummary = { tokensSaved: number; calls: number };

export function readSavings(root: string, sessionId?: string): SavingSummary {
  let raw = "";
  try { raw = readFileSync(statsPath(root), "utf8"); } catch { return { tokensSaved: 0, calls: 0 }; }
  const events = new Map<string, SavingEvent>();
  for (const line of raw.split("\n")) {
    if (!line) continue;
    try {
      const event = JSON.parse(line) as SavingEvent;
      if (!event.sessionId || !event.toolUseId || !(event.tokensSaved > 0)) continue;
      if (sessionId && event.sessionId !== sessionId) continue;
      events.set(`${event.sessionId}:${event.toolUseId}`, event);
    } catch { /* Ignore a partial final line from a concurrent append. */ }
  }
  let tokensSaved = 0;
  for (const event of events.values()) tokensSaved += event.tokensSaved;
  return { tokensSaved, calls: events.size };
}

export function formatTokens(value: number): string {
  const count = Math.max(0, Math.floor(value));
  if (count < 1_000) return String(count);
  if (count < 1_000_000) return `${(count / 1_000).toFixed(count < 10_000 ? 1 : 0)}k`;
  return `${(count / 1_000_000).toFixed(count < 10_000_000 ? 1 : 0)}m`;
}
