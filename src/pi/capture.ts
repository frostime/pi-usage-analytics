import type { ExtensionContext, TurnEndEvent } from "@earendil-works/pi-coding-agent";
import type { UsageDatabase } from "../storage/usage-database.ts";
import { createUsageEventKey } from "../usage/identity.ts";
import { localDayFromEpochMs } from "../usage/calendar.ts";
import { isAssistantMessage, isRecord } from "../usage/fact.ts";
import { normalizePersistedAssistantEntry, persistedEntryMatchesAssistantMessage } from "./normalize.ts";

export function captureTurnUsage(event: TurnEndEvent, ctx: ExtensionContext, db: UsageDatabase): boolean {
  if (!isAssistantMessage(event.message)) return false;

  const entries = ctx.sessionManager.getEntries();
  let matched: unknown = null;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const candidate = entries[index] as unknown;
    if (isRecord(candidate) && persistedEntryMatchesAssistantMessage(candidate, event.message)) {
      matched = candidate;
      break;
    }
  }
  if (!matched || !isRecord(matched)) {
    throw new Error("turn_end assistant message was not found in persisted session entries");
  }

  const header = ctx.sessionManager.getHeader();
  const seed = normalizePersistedAssistantEntry(matched, header ?? null);
  if (!seed) throw new Error("persisted assistant entry did not contain attributable usage");

  const eventKey = createUsageEventKey({
    entryTsMs: seed.entryTsMs,
    messageTsMs: seed.eventTsMs,
    api: seed.api,
    provider: seed.provider,
    model: seed.model,
    responseModel: seed.responseModel,
    stopReason: seed.stopReason,
    hasErrorMessage: seed.hasErrorMessage,
    usage: seed.amounts,
  });

  return db.ingest({
    ...seed,
    eventKey,
    localDay: localDayFromEpochMs(seed.eventTsMs, db.reportingTimezone),
  });
}
