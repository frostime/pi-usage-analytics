import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const APP_DIR_NAME = "usage-ledger";
export const DB_FILE_NAME = "usage.db";

export function getAgentDir(): string {
  const override = process.env.PI_CODING_AGENT_DIR?.trim();
  return override ? resolve(expandHome(override)) : join(homedir(), ".pi", "agent");
}

export function getDataDir(): string {
  return join(getAgentDir(), APP_DIR_NAME);
}

export function getDatabasePath(): string {
  return join(getDataDir(), DB_FILE_NAME);
}

export function getDefaultSessionRoot(): string {
  const override = process.env.PI_CODING_AGENT_SESSION_DIR?.trim();
  return override ? resolve(expandHome(override)) : join(getAgentDir(), "sessions");
}

function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return join(homedir(), value.slice(2));
  }
  return value;
}
