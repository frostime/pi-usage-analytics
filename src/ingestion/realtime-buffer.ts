import type { UsageDatabase, TryBatchIngestResult } from "../storage/usage-database.ts";
import { localDayFromEpochMs } from "../usage/calendar.ts";
import type { IdentifiedUsageFact, UsageFact } from "../usage/fact.ts";

export const DEFAULT_MAX_PENDING_USAGE_EVENTS = 512;

export interface BufferPushResult {
  queued: boolean;
  dropped: number;
  pending: number;
}

export type BufferFlushResult = TryBatchIngestResult & {
  attempted: number;
  pending: number;
};

/**
 * Process-local write-behind buffer for realtime usage facts.
 *
 * It intentionally is not durable. Pi session JSONL remains the recovery source
 * when a process exits before a pending fact reaches SQLite.
 */
export class RealtimeUsageBuffer {
  readonly maxPending: number;
  private readonly pending = new Map<string, IdentifiedUsageFact>();
  private droppedTotal = 0;

  constructor(maxPending = DEFAULT_MAX_PENDING_USAGE_EVENTS) {
    this.maxPending = maxPending;
    if (!Number.isInteger(maxPending) || maxPending < 1) {
      throw new Error("maxPending must be a positive integer");
    }
  }

  get size(): number {
    return this.pending.size;
  }

  get totalDropped(): number {
    return this.droppedTotal;
  }

  push(fact: IdentifiedUsageFact): BufferPushResult {
    if (this.pending.has(fact.eventKey)) {
      return { queued: false, dropped: 0, pending: this.pending.size };
    }

    let dropped = 0;
    if (this.pending.size >= this.maxPending) {
      const oldest = this.pending.keys().next().value as string | undefined;
      if (oldest !== undefined) {
        this.pending.delete(oldest);
        this.droppedTotal += 1;
        dropped = 1;
      }
    }

    this.pending.set(fact.eventKey, fact);
    return { queued: true, dropped, pending: this.pending.size };
  }

  flush(db: UsageDatabase): BufferFlushResult {
    if (this.pending.size === 0) {
      return { status: "ok", inserted: 0, skipped: 0, attempted: 0, pending: 0 };
    }

    const snapshot = [...this.pending.values()];
    const facts: UsageFact[] = snapshot.map((fact) => ({
      ...fact,
      localDay: localDayFromEpochMs(fact.eventTsMs, db.reportingTimezone),
    }));

    const result = db.tryIngestBatch(facts);
    if (result.status === "busy") {
      return { ...result, attempted: facts.length, pending: this.pending.size };
    }

    for (const fact of snapshot) this.pending.delete(fact.eventKey);
    return { ...result, attempted: facts.length, pending: this.pending.size };
  }
}
