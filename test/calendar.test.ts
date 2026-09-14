import test from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  lastCalendarDaysRange,
  localDayFromEpochMs,
  resolveRangeChoice,
  weekRangeForDay,
} from "../src/usage/calendar.ts";

test("reporting day follows the configured timezone", () => {
  const instant = Date.parse("2026-09-01T00:30:00Z");
  assert.equal(localDayFromEpochMs(instant, "Asia/Shanghai"), "2026-09-01");
  assert.equal(localDayFromEpochMs(instant, "America/Los_Angeles"), "2026-08-31");
});

test("last 7 days means seven calendar labels, not rolling 168 hours", () => {
  const instant = Date.parse("2026-09-01T12:00:00Z");
  assert.deepEqual(lastCalendarDaysRange(7, instant, "UTC"), {
    startDay: "2026-08-26",
    endDay: "2026-09-01",
    label: "Last 7 days",
  });
});

test("a relative range choice is resolved again for the current day", () => {
  const choice = { kind: "last-days", days: 7 } as const;
  assert.deepEqual(resolveRangeChoice(choice, Date.parse("2026-09-01T12:00:00Z"), "UTC"), {
    startDay: "2026-08-26",
    endDay: "2026-09-01",
    label: "Last 7 days",
  });
  assert.deepEqual(resolveRangeChoice(choice, Date.parse("2026-09-02T12:00:00Z"), "UTC"), {
    startDay: "2026-08-27",
    endDay: "2026-09-02",
    label: "Last 7 days",
  });
});

test("custom and all-time choices preserve their explicit data boundaries", () => {
  const now = Date.parse("2026-09-02T12:00:00Z");
  assert.deepEqual(
    resolveRangeChoice({ kind: "custom", startDay: "2026-08-10", endDay: "2026-08-12" }, now, "UTC"),
    { startDay: "2026-08-10", endDay: "2026-08-12", label: "2026-08-10 → 2026-08-12" },
  );
  assert.deepEqual(
    resolveRangeChoice({ kind: "all-time" }, now, "UTC", { startDay: "2026-01-02", endDay: "2026-08-31" }),
    { startDay: "2026-01-02", endDay: "2026-08-31", label: "All time" },
  );
});

test("week starts Monday", () => {
  assert.deepEqual(weekRangeForDay("2026-09-01"), {
    startDay: "2026-08-31",
    endDay: "2026-09-06",
    label: "Week of 2026-08-31",
  });
});

test("calendar date arithmetic crosses month boundaries", () => {
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
});
