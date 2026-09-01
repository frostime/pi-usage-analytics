import { createHash } from "node:crypto";
import type { UsageAmounts } from "./fact.ts";

export const IDENTITY_VERSION = 1;

export interface IdentityInput {
  entryTsMs: number;
  messageTsMs: number;
  api: string | null;
  provider: string;
  model: string;
  responseModel: string | null;
  stopReason: string | null;
  hasErrorMessage: boolean;
  usage: UsageAmounts;
}

export function createUsageEventKey(input: IdentityInput): string {
  const u = input.usage;
  const canonical = [
    `v=${IDENTITY_VERSION}`,
    `entryTs=${input.entryTsMs}`,
    `messageTs=${input.messageTsMs}`,
    `api=${encode(input.api)}`,
    `provider=${encode(input.provider)}`,
    `model=${encode(input.model)}`,
    `responseModel=${encode(input.responseModel)}`,
    `stopReason=${encode(input.stopReason)}`,
    `hasError=${input.hasErrorMessage ? 1 : 0}`,
    `input=${number(u.input)}`,
    `output=${number(u.output)}`,
    `cacheRead=${number(u.cacheRead)}`,
    `cacheWrite=${number(u.cacheWrite)}`,
    `cacheWrite1h=${nullableNumber(u.cacheWrite1h)}`,
    `reasoning=${nullableNumber(u.reasoning)}`,
    `totalTokens=${number(u.totalTokens)}`,
    `costInput=${number(u.cost.input)}`,
    `costOutput=${number(u.cost.output)}`,
    `costCacheRead=${number(u.cost.cacheRead)}`,
    `costCacheWrite=${number(u.cost.cacheWrite)}`,
    `costTotal=${number(u.cost.total)}`,
  ].join("\n");

  return `v${IDENTITY_VERSION}:${createHash("sha256").update(canonical).digest("hex")}`;
}

function encode(value: string | null): string {
  return value === null ? "~" : JSON.stringify(value);
}

function number(value: number): string {
  return Object.is(value, -0) ? "0" : value.toString();
}

function nullableNumber(value: number | null): string {
  return value === null ? "~" : number(value);
}
