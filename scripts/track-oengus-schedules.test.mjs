import assert from "node:assert/strict";
import test from "node:test";
import { parseOengusLikeRuns } from "./scan-oengus.mjs";
import { findClosestRun } from "./track-oengus-schedules.mjs";

test("parses a scheduled run from Oengus page data", () => {
  const runs = parseOengusLikeRuns(
    '{"game":"Celeste","category":"Any%","date":"2026-10-21T12:00:00.000Z","estimate":"00:35:00"}',
    "test-marathon"
  );

  assert.equal(runs.length, 1);
  assert.equal(runs[0].game, "Celeste");
  assert.equal(runs[0].category, "Any%");
  assert.equal(runs[0].dateIso, "2026-10-21T12:00:00.000Z");
});

test("selects the closest unassigned run with matching game and category", () => {
  const runs = [
    { game: "Celeste", category: "Any%", dateIso: "2026-10-21T12:00:00.000Z" },
    { game: "Celeste", category: "Any%", dateIso: "2026-10-22T12:00:00.000Z" },
    { game: "Celeste", category: "100%", dateIso: "2026-10-21T12:00:00.000Z" }
  ];
  const used = new Set();

  const first = findClosestRun(runs, " celeste ", "Any%", "2026-10-22T11:00:00.000Z", used);
  assert.equal(first.index, 1);
  used.add(first.index);

  const second = findClosestRun(runs, "Celeste", "Any%", "2026-10-22T11:00:00.000Z", used);
  assert.equal(second.index, 0);
  used.add(second.index);

  assert.equal(findClosestRun(runs, "Celeste", "Any%", "2026-10-22T11:00:00.000Z", used), null);
});

test("normalizes matched run times before comparing and storing them", () => {
  const match = findClosestRun(
    [{ game: "Celeste", category: "Any%", dateIso: "2026-10-22T14:00:00+02:00" }],
    "Celeste",
    "Any%",
    "2026-10-22T12:00:00.000Z"
  );

  assert.equal(match.run.dateIso, "2026-10-22T12:00:00.000Z");
});
