import type { UsageFactSeed } from "../usage/fact.ts";
import { finite, isAssistantMessage, isRecord, normalizeCwd, readUsageAmounts } from "../usage/fact.ts";

export interface SessionHeaderLike {
  id?: unknown;
  cwd?: unknown;
}

export interface SessionMessageEntryLike {
  type?: unknown;
  id?: unknown;
  timestamp?: unknown;
  message?: unknown;
}

export function normalizePersistedAssistantEntry(
  entry: SessionMessageEntryLike,
  header: SessionHeaderLike | null,
): UsageFactSeed | null {
  if (entry.type !== "message" || !isAssistantMessage(entry.message)) return null;
  const message = entry.message;
  const provider = stringOrNull(message.provider);
  const model = stringOrNull(message.model);
  const messageTsMs = finite(message.timestamp);
  const usage = readUsageAmounts(message.usage);
  if (!provider || !model || messageTsMs === null || !usage) return null;

  const parsedEntryTs = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : Number.NaN;
  const entryTsMs = Number.isFinite(parsedEntryTs) ? parsedEntryTs : messageTsMs;

  return {
    eventTsMs: messageTsMs,
    provider,
    model,
    responseModel: stringOrNull(message.responseModel),
    api: stringOrNull(message.api),
    cwd: normalizeCwd(header?.cwd),
    sessionId: stringOrNull(header?.id),
    entryId: stringOrNull(entry.id),
    entryTsMs,
    stopReason: stringOrNull(message.stopReason),
    hasErrorMessage: typeof message.errorMessage === "string" && message.errorMessage.length > 0,
    amounts: usage,
  };
}

export function persistedEntryMatchesAssistantMessage(entry: SessionMessageEntryLike, message: unknown): boolean {
  if (entry.type !== "message" || !isAssistantMessage(entry.message) || !isAssistantMessage(message)) return false;
  const a = entry.message;
  const b = message;
  if (finite(a.timestamp) !== finite(b.timestamp)) return false;
  if (stringOrNull(a.provider) !== stringOrNull(b.provider)) return false;
  if (stringOrNull(a.model) !== stringOrNull(b.model)) return false;
  if (stringOrNull(a.api) !== stringOrNull(b.api)) return false;
  if (stringOrNull(a.responseModel) !== stringOrNull(b.responseModel)) return false;
  if (stringOrNull(a.stopReason) !== stringOrNull(b.stopReason)) return false;
  return usageEqual(readUsageAmounts(a.usage), readUsageAmounts(b.usage));
}

export function asSessionHeader(value: unknown): SessionHeaderLike | null {
  if (!isRecord(value) || value.type !== "session") return null;
  return value;
}

function usageEqual(a: ReturnType<typeof readUsageAmounts>, b: ReturnType<typeof readUsageAmounts>): boolean {
  if (!a || !b) return false;
  return (
    a.input === b.input &&
    a.output === b.output &&
    a.cacheRead === b.cacheRead &&
    a.cacheWrite === b.cacheWrite &&
    a.cacheWrite1h === b.cacheWrite1h &&
    a.reasoning === b.reasoning &&
    a.totalTokens === b.totalTokens &&
    a.cost.input === b.cost.input &&
    a.cost.output === b.cost.output &&
    a.cost.cacheRead === b.cost.cacheRead &&
    a.cost.cacheWrite === b.cost.cacheWrite &&
    a.cost.total === b.cost.total
  );
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
