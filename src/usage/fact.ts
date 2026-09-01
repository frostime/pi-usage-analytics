import { resolve } from "node:path";

export interface UsageCost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

export interface UsageAmounts {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWrite1h: number | null;
  reasoning: number | null;
  totalTokens: number;
  cost: UsageCost;
}

export interface UsageFact {
  eventKey: string;
  eventTsMs: number;
  localDay: string;
  provider: string;
  model: string;
  responseModel: string | null;
  api: string | null;
  cwd: string;
  sessionId: string | null;
  entryId: string | null;
  entryTsMs: number;
  stopReason: string | null;
  hasErrorMessage: boolean;
  amounts: UsageAmounts;
}

export interface UsageFactSeed extends Omit<UsageFact, "eventKey" | "localDay"> {}

export interface IdentifiedUsageFact extends UsageFactSeed {
  eventKey: string;
}

export function normalizeCwd(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") return "";
  return resolve(value);
}

export function readUsageAmounts(value: unknown): UsageAmounts | null {
  if (!isRecord(value)) return null;
  const cost = isRecord(value.cost) ? value.cost : null;
  if (!cost) return null;

  const input = finite(value.input);
  const output = finite(value.output);
  const cacheRead = finite(value.cacheRead);
  const cacheWrite = finite(value.cacheWrite);
  const totalTokens = finite(value.totalTokens);
  const costInput = finite(cost.input);
  const costOutput = finite(cost.output);
  const costCacheRead = finite(cost.cacheRead);
  const costCacheWrite = finite(cost.cacheWrite);
  const costTotal = finite(cost.total);

  if (
    input === null ||
    output === null ||
    cacheRead === null ||
    cacheWrite === null ||
    totalTokens === null ||
    costInput === null ||
    costOutput === null ||
    costCacheRead === null ||
    costCacheWrite === null ||
    costTotal === null
  ) {
    return null;
  }

  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    cacheWrite1h: finiteOptional(value.cacheWrite1h),
    reasoning: finiteOptional(value.reasoning),
    totalTokens,
    cost: {
      input: costInput,
      output: costOutput,
      cacheRead: costCacheRead,
      cacheWrite: costCacheWrite,
      total: costTotal,
    },
  };
}

export function isAssistantMessage(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value.role === "assistant";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function finiteOptional(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  return finite(value);
}
