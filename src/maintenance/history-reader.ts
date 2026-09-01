import { createReadStream } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join } from "node:path";
import type { UsageDatabase } from "../storage/usage-database.ts";
import { localDayFromEpochMs } from "../usage/calendar.ts";
import { createUsageEventKey } from "../usage/identity.ts";
import { asSessionHeader, normalizePersistedAssistantEntry } from "../pi/normalize.ts";
import { isRecord } from "../usage/fact.ts";

export interface HistoryFile {
  path: string;
  size: number;
  mtimeMs: number;
}

export interface HistoryDiscovery {
  files: HistoryFile[];
  bytes: number;
}

export interface ImportOptions {
  sinceDay?: string;
}

export interface ImportProgress {
  filesDone: number;
  filesTotal: number;
  linesRead: number;
  imported: number;
  skipped: number;
  malformed: number;
}

export interface ImportResult extends ImportProgress {
  bytesScanned: number;
}

export async function discoverHistory(
  root: string,
  filter?: { sinceDay?: string; timeZone?: string },
): Promise<HistoryDiscovery> {
  const files: HistoryFile[] = [];
  await walk(root, files, new Set<string>());
  const filtered = filter?.sinceDay && filter.timeZone
    ? files.filter((file) => localDayFromEpochMs(file.mtimeMs, filter.timeZone!) >= filter.sinceDay!)
    : files;
  filtered.sort((a, b) => a.mtimeMs - b.mtimeMs || a.path.localeCompare(b.path));
  return { files: filtered, bytes: filtered.reduce((sum, file) => sum + file.size, 0) };
}

export async function importHistory(
  db: UsageDatabase,
  discovery: HistoryDiscovery,
  options: ImportOptions,
  onProgress?: (progress: ImportProgress) => void,
): Promise<ImportResult> {
  const progress: ImportProgress = {
    filesDone: 0,
    filesTotal: discovery.files.length,
    linesRead: 0,
    imported: 0,
    skipped: 0,
    malformed: 0,
  };
  let bytesScanned = 0;

  for (const file of discovery.files) {
    let header: Record<string, unknown> | null = null;
    const stream = createReadStream(file.path, { encoding: "utf8" });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of lines) {
      progress.linesRead += 1;
      if (!line.trim()) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        progress.malformed += 1;
        continue;
      }
      if (!isRecord(parsed)) continue;
      const maybeHeader = asSessionHeader(parsed);
      if (maybeHeader) {
        header = maybeHeader as Record<string, unknown>;
        continue;
      }

      const seed = normalizePersistedAssistantEntry(parsed, header);
      if (!seed) continue;
      const localDay = localDayFromEpochMs(seed.eventTsMs, db.reportingTimezone);
      if (options.sinceDay && localDay < options.sinceDay) continue;
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

      const inserted = db.ingest({ ...seed, eventKey, localDay });
      if (inserted) progress.imported += 1;
      else progress.skipped += 1;
    }

    bytesScanned += file.size;
    progress.filesDone += 1;
    onProgress?.({ ...progress });
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  return { ...progress, bytesScanned };
}

async function walk(root: string, output: HistoryFile[], visited: Set<string>): Promise<void> {
  let canonicalRoot: string;
  try {
    canonicalRoot = await realpath(root);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT") return;
    throw error;
  }
  if (visited.has(canonicalRoot)) return;
  visited.add(canonicalRoot);

  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      await walk(path, output, visited);
      continue;
    }
    if (entry.isSymbolicLink()) {
      const info = await stat(path);
      if (info.isDirectory()) await walk(path, output, visited);
      else if (info.isFile() && entry.name.endsWith(".jsonl")) output.push({ path, size: info.size, mtimeMs: info.mtimeMs });
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      const info = await stat(path);
      output.push({ path, size: info.size, mtimeMs: info.mtimeMs });
    }
  }
}
