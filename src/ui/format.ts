import { homedir } from "node:os";
import { sep } from "node:path";

export function formatTokens(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${trim(value / 1_000_000_000, 2)}B`;
  if (abs >= 1_000_000) return `${trim(value / 1_000_000, 2)}M`;
  if (abs >= 1_000) return `${trim(value / 1_000, 1)}K`;
  return Math.round(value).toString();
}

export function formatCost(value: number): string {
  if (Math.abs(value) >= 1) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(4)}`;
}

export function formatBytes(value: number): string {
  if (value >= 1024 ** 3) return `${trim(value / 1024 ** 3, 2)} GiB`;
  if (value >= 1024 ** 2) return `${trim(value / 1024 ** 2, 2)} MiB`;
  if (value >= 1024) return `${trim(value / 1024, 1)} KiB`;
  return `${value} B`;
}

export function displayDirectory(value: string): string {
  if (!value) return "(unknown)";
  const home = homedir();
  const normalizedHome = home.endsWith(sep) ? home : `${home}${sep}`;
  if (value === home) return "~";
  if (value.startsWith(normalizedHome)) return `~${sep}${value.slice(normalizedHome.length)}`;
  return value;
}

export function plural(value: number, singular: string, pluralForm = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : pluralForm}`;
}

function trim(value: number, decimals: number): string {
  return value.toFixed(decimals).replace(/\.0+$|(?<=\.[0-9]*[1-9])0+$/g, "");
}
