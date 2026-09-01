import test from "node:test";
import assert from "node:assert/strict";
import { addDays, lastCalendarDaysRange, localDayFromEpochMs, weekRangeForDay } from "../src/usage/calendar.ts";

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
