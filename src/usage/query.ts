import type { DayRange } from "./calendar.ts";

export type GroupBy = "model" | "provider" | "directory";

export interface UsageFilter {
  provider?: string;
  model?: string;
  cwd?: string;
}

export interface QuerySpec {
  range: DayRange;
  groupBy: GroupBy;
  filter?: UsageFilter;
}

export interface UsageTotals {
  turns: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: number;
}

export interface SummaryRow extends UsageTotals {
  key: string;
  provider: string | null;
  model: string | null;
  cwd: string | null;
}

export interface TimelineRow extends UsageTotals {
  day: string;
}

export interface UsageReport {
  range: DayRange;
  groupBy: GroupBy;
  summary: SummaryRow[];
  timeline: TimelineRow[];
  totals: UsageTotals;
}

export const ZERO_TOTALS: UsageTotals = {
  turns: 0,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: 0,
};
