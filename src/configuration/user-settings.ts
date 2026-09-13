import type { UsageDatabase } from "../storage/usage-database.ts";
import { DEFAULT_RANGE_CHOICE, parseRangeChoice, type RangeChoice } from "../usage/calendar.ts";
import type { GroupBy } from "../usage/query.ts";

const DASHBOARD_DEFAULT_VIEW_KEY = "dashboard_default_view";
const DASHBOARD_DEFAULT_VIEW_SCHEMA = 1;

export interface DashboardViewSelection {
  readonly range: RangeChoice;
  readonly groupBy: GroupBy;
}

export const DEFAULT_DASHBOARD_VIEW: DashboardViewSelection = {
  range: DEFAULT_RANGE_CHOICE,
  groupBy: "model",
};

export function loadDashboardDefault(database: UsageDatabase): DashboardViewSelection {
  const serialized = database.readSetting(DASHBOARD_DEFAULT_VIEW_KEY);
  if (serialized === null) return copyDefaultView();

  try {
    const value = JSON.parse(serialized) as unknown;
    if (!value || typeof value !== "object") return copyDefaultView();

    const record = value as Record<string, unknown>;
    if (record.schema !== DASHBOARD_DEFAULT_VIEW_SCHEMA) return copyDefaultView();

    return {
      range: parseRangeChoice(record.range) ?? DEFAULT_RANGE_CHOICE,
      groupBy: parseGroupBy(record.groupBy) ?? DEFAULT_DASHBOARD_VIEW.groupBy,
    };
  } catch {
    return copyDefaultView();
  }
}

export function saveDashboardDefault(database: UsageDatabase, view: DashboardViewSelection): void {
  database.writeSetting(DASHBOARD_DEFAULT_VIEW_KEY, JSON.stringify({
    schema: DASHBOARD_DEFAULT_VIEW_SCHEMA,
    range: view.range,
    groupBy: view.groupBy,
  }));
}

function parseGroupBy(value: unknown): GroupBy | null {
  return value === "model" || value === "provider" || value === "directory" ? value : null;
}

function copyDefaultView(): DashboardViewSelection {
  return { range: DEFAULT_RANGE_CHOICE, groupBy: DEFAULT_DASHBOARD_VIEW.groupBy };
}
