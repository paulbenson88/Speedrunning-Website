/**
 * events.js — Speedrun marathon event data with individual runs.
 *
 * Each marathon stores its start/end in UTC via ISO-8601 strings.
 * Each run stores its scheduled date/time and estimate.
 * The calendar JS converts them to the viewer's local timezone
 * automatically using the Intl API.
 *
 * To add / edit events, just update this array.
 */

// eslint-disable-next-line no-unused-vars
const MARATHON_EVENTS = [
  {
    name: "Gamers Against Cancer 2026",
    start: "2026-03-13T20:00:00Z",
    end: "2026-03-15T23:47:00Z",
    twitch: "GFHMarathon",
    url: "https://oengus.io/marathon/GAC26/schedule/gac26",
    runs: [
      {
        game: "Ollie-Oop",
        category: "All Missions",
        console: "PC",
        estimate: "PT35M",
        date: "2026-03-15T15:25:00Z",
        runId: 51011,
      },
    ],
  },
  {
    name: "InstaSpeedathon 2026",
    start: "2026-03-20T09:00:00Z",
    end: "2026-03-23T13:55:00Z",
    twitch: "InstaSpeedathon",
    url: "https://oengus.io/marathon/ispeed26/schedule/main",
    runs: [
      {
        game: "Ollie-Oop",
        category: "All Missions",
        console: "PC",
        estimate: "PT35M",
        date: "2026-03-22T14:55:00Z",
        runId: 50869,
      },
      {
        game: "Bad Way",
        category: "Any% (No Torch Zip)",
        console: "PC",
        estimate: "PT25M",
        date: "2026-03-22T15:45:00Z",
        runId: 50876,
      },
    ],
  },
  {
    name: "Starlight for the Future 2026",
    start: "2026-03-28T16:00:00Z",
    end: "2026-03-30T03:56:00Z",
    twitch: "supersonic_",
    url: "https://horaro.net/sftf2026/schedule",
    runs: [
      {
        game: "Ollie-Oop",
        category: "All Missions",
        console: "PC",
        estimate: "PT35M",
        date: "2026-03-29T19:20:00Z",
        runId: "sftf2026-ollie-oop",
      },
      {
        game: "Bad Way",
        category: "Any% No Torch Skip",
        console: "PC",
        estimate: "PT25M",
        date: "2026-03-29T20:05:00Z",
        runId: "sftf2026-bad-way",
      },
    ],
  },
  {
    name: "No Fish 2026",
    start: "2026-04-11T12:00:00Z",
    end: "2026-04-12T19:39:00Z",
    twitch: "Channel734",
    url: "https://oengus.io/marathon/nofish2026/schedule/1",
    runs: [
      {
        game: "Ollie-Oop",
        category: "All Missions",
        console: "PC",
        estimate: "PT35M",
        date: "2026-04-12T14:35:00Z",
        runId: 51375,
      },
    ],
  },
  {
    name: "Prevent-A-Thon 7",
    start: "2026-05-01T18:00:00Z",
    end: "2026-05-02T10:00:00Z",
    twitch: "",
    url: "",
    runs: [
      {
        game: "Bad Way",
        category: "Any% (No Torch Zip)",
        console: "PC",
        estimate: "PT35M",
        date: "2026-05-02T04:21:00Z",
        runId: "prevent-a-thon-7-bad-way",
        runner: "pbb8",
      },
    ],
  },
  {
    name: "Mint-A-Thon",
    start: "2026-05-17T12:00:00Z",
    end: "2026-05-17T21:00:00Z",
    twitch: "",
    url: "",
    runs: [
      {
        game: "Bad Way",
        category: "(Any% - No Torch Zip)",
        console: "PC",
        estimate: "PT35M",
        date: "2026-05-17T16:16:00Z",
        runId: "mint-a-thon-bad-way",
        runner: "pbb8",
      },
    ],
  },
  {
    name: "GDQ Hotfix: Express Lane",
    start: "2026-07-15T02:00:00Z",
    end: "2026-07-15T03:00:00Z",
    twitch: "gamesdonequick",
    url: "https://gdq.gg/schedule/hotfix",
    runs: [
      {
        game: "Ollie-Oop",
        category: "Express Lane (9:00 PM CST start tentative)",
        console: "PC",
        estimate: "PT35M",
        date: "2026-07-15T02:00:00Z",
        runId: "gdq-hotfix-express-lane-ollie-oop-tentative",
        runner: "pbb8",
      },
    ],
  },
  {
    name: "InstaTipTopathon 2026",
    start: "2026-07-18T07:50:00Z",
    end: "2026-07-19T20:20:00Z",
    twitch: "InstaSpeedathon",
    url: "https://oengus.io/marathon/istiptop26/schedule/main",
    runs: [
      {
        game: "Bad Way",
        category: "Any% (No Torch Zip)",
        console: "PC",
        estimate: "PT30M",
        date: "2026-07-18T19:40:00Z",
        runId: "istiptop26-bad-way",
        runner: "pbb8",
      },
      {
        game: "Garden Trills",
        category: "Any% (Normal Mode)",
        console: "PC",
        estimate: "PT25M",
        date: "2026-07-18T20:25:00Z",
        runId: "istiptop26-garden-trills",
        runner: "pbb8",
      },
    ],
  },
  {
    name: "Speedy Adventures 2026",
    start: "2026-07-25T13:00:00Z",
    end: "2026-07-26T02:47:00Z",
    twitch: "speedyadventures",
    url: "https://horaro.net/speedadv26/schedule",
    runs: [
      {
        game: "Garden Trills",
        category: "Any% (Normal Mode)",
        console: "PC",
        estimate: "PT25M",
        date: "2026-07-25T17:37:00Z",
        runId: "speedadv26-garden-trills",
        runner: "pbb8",
      },
    ],
  },
  {
    name: "Games on Fast Forward 2026",
    start: "2026-08-01T15:00:00Z",
    end: "2026-08-03T10:48:00Z",
    twitch: "exclamation_markyt",
    url: "https://oengus.io/marathon/goff2026/schedule/goff2026schedule",
    runs: [
      {
        game: "Ollie-Oop",
        category: "All Missions",
        console: "PC",
        estimate: "PT35M",
        date: "2026-08-02T14:07:00Z",
        runId: 53115,
        runner: "pbb8",
      },
      {
        game: "Bad Way",
        category: "Any% (No Torch Zip)",
        console: "PC",
        estimate: "PT30M",
        date: "2026-08-02T14:47:00Z",
        runId: 53116,
        runner: "pbb8",
      },
    ],
  },
  {
    name: "Gamers Against Suicide 2026",
    start: "2026-09-05T19:00:00Z",
    end: "2026-09-07T06:52:00Z",
    twitch: "gfhmarathon",
    url: "https://horaro.net/gfh/gas2026",
    runs: [
      {
        game: "Ollie-Oop",
        category: "All Missions",
        console: "PC",
        estimate: "PT35M",
        date: "2026-09-06T21:02:00Z",
        runId: "gas2026-ollie-oop",
        runner: "Pbb8",
      },
      {
        game: "Garden Trills",
        category: "Any% (Normal Mode)",
        console: "PC",
        estimate: "PT25M",
        date: "2026-09-06T16:27:00Z",
        runId: "gas2026-garden-trills",
        runner: "Pbb8",
      },
    ],
  },
];
