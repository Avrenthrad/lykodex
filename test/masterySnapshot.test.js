import assert from "node:assert/strict";
import test from "node:test";
import { describeMasteryRefresh, scoreChanged, withLiveMasteryPoint } from "../src/lib/masterySnapshot.js";

test("an unchanged score does not need another history row", () => {
  assert.equal(scoreChanged(5059.15, 5059.16), false);
  assert.equal(scoreChanged("311.94", 311.94), false);
  assert.equal(scoreChanged(311.94, 0), false);
  assert.equal(scoreChanged(311.94, null), false);
});

test("a real score change, or a first score, should be recorded", () => {
  assert.equal(scoreChanged(311.94, 842.2), true);
  assert.equal(scoreChanged(null, 842.2), true);
  assert.equal(scoreChanged(undefined, 12), true);
});

test("a same-day live point stays after the morning snapshot", () => {
  const snapshot = Math.floor(Date.parse("2026-10-15T04:00:00Z") / 1000);
  const now = Math.floor(Date.parse("2026-10-15T18:00:00Z") / 1000);
  const points = withLiveMasteryPoint([{ time: snapshot, value: 311.9 }], 842.2, now);
  assert.equal(points.length, 2);
  assert.equal(points[0].value, 311.9);
  assert.equal(points[1].value, 842.2);
  assert.ok(points[1].time > points[0].time);
});

test("a stale daily refresh is called out, a fresh one is not", () => {
  const now = Date.parse("2026-10-15T12:00:00Z");
  const fresh = describeMasteryRefresh({
    job: { status: "ok", finished_at: "2026-10-15T04:02:00Z" },
    now,
  });
  assert.equal(fresh.stale, false);
  assert.match(fresh.text, /Daily refresh/);

  const stale = describeMasteryRefresh({
    job: { status: "ok", finished_at: "2026-09-28T09:19:00Z" },
    now,
  });
  assert.equal(stale.stale, true);

  const hung = describeMasteryRefresh({
    job: { status: "running", started_at: "2026-10-15T04:00:00Z", finished_at: null },
    now,
  });
  assert.equal(hung.stale, true);
  assert.match(hung.text, /didn't finish/);

  const personal = describeMasteryRefresh({
    personalComputedAt: "2026-09-28T09:19:00Z",
    now,
  });
  assert.equal(personal.stale, true);
  assert.match(personal.text, /Your score last updated/);
});
