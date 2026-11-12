import assert from "node:assert/strict";
import test from "node:test";
import { parseOengusLikeRuns } from "./scan-oengus.mjs";
import {
  findClosestRun,
  formatDate,
  getBaseOengusRuns,
  mergeTrackedRuns,
  parseOengusScheduleApiResponse
} from "./track-oengus-schedules.mjs";

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

test("tracks upcoming Oengus runs from the base event list", () => {
  const runs = getBaseOengusRuns([
    {
      name: "FAST-ATHON 2026",
      url: "https://oengus.io/marathon/fast-26/schedule/fastathon26",
      runs: [
        {
          game: "Bad Way",
          category: "Any% (No Torch Zip)",
          date: "2026-11-14T21:03:00Z",
          runner: "pbb8"
        }
      ]
    },
    {
      name: "Past Marathon",
      url: "https://oengus.io/marathon/past/schedule/main",
      runs: [{ game: "Game", category: "Any%", date: "2026-10-01T00:00:00Z" }]
    },
    {
      name: "Non-Oengus Event",
      url: "https://horaro.org/event/schedule",
      runs: [{ game: "Game", category: "Any%", date: "2026-11-14T21:03:00Z" }]
    }
  ], Date.parse("2026-11-12T00:00:00Z"));

  assert.equal(runs.length, 1);
  assert.equal(runs[0].scheduleUrl, "https://oengus.io/marathon/fast-26/schedule/fastathon26");
  assert.equal(runs[0].gameName, "Bad Way");
  assert.equal(runs[0].runDateIso, "2026-11-14T21:03:00.000Z");
});

test("prefers submitted-run details when merging duplicate base Oengus runs", () => {
  const baseRun = { identity: "same", runnerName: "pbb8", runDateIso: "2026-11-14T21:03:00.000Z" };
  const submittedRun = { identity: "same", runnerName: "Pbb8", runDateIso: "2026-11-14T21:03:00.000Z" };
  const otherRun = { identity: "other", runnerName: "pbb8", runDateIso: "2026-11-15T00:00:00.000Z" };

  assert.deepEqual(mergeTrackedRuns([baseRun], [submittedRun, otherRun]), [submittedRun, otherRun]);
});

test("parses scheduled runs from the Oengus schedule API response", () => {
  const runs = parseOengusScheduleApiResponse({
    lines: [
      { game: "Event Opening", category: "", date: "2026-11-14T14:00:00Z" },
      {
        game: "Bad Way",
        category: "Any% (No Torch Zip)",
        date: "2026-11-14T21:03:00Z",
        estimate: "PT30M"
      },
      { game: "Closing", category: "Ending%", date: "invalid" }
    ]
  });

  assert.deepEqual(runs, [{
    game: "Bad Way",
    category: "Any% (No Torch Zip)",
    dateIso: "2026-11-14T21:03:00.000Z",
    estimateText: "PT30M"
  }]);
});

test("formats Discord notification timestamps in Central time with seasonal timezone abbreviations", () => {
  const formatted = formatDate("2026-11-14T22:03:00.000Z");
  assert.match(formatted, /Nov 14, 2026/);
  assert.match(formatted, /4:03 PM/);
  assert.match(formatted, /CST/);

  const daylightTime = formatDate("2026-07-14T22:03:00.000Z");
  assert.match(daylightTime, /5:03 PM/);
  assert.match(daylightTime, /CDT/);
});
