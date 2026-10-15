// A daily snapshot already stores an unchanged score. Another row with
// the same number doesn't show a rise on the chart — it just stacks a
// second flat point on top of the 05:00 UTC copy.
const SCORE_EPSILON = 0.05;

export function scoreChanged(previous, next, epsilon = SCORE_EPSILON) {
  const nextN = Number(next);
  if (!Number.isFinite(nextN) || nextN <= 0) return false;
  if (previous == null || previous === "") return true;
  const prevN = Number(previous);
  if (!Number.isFinite(prevN)) return true;
  return Math.abs(nextN - prevN) >= epsilon;
}

// History rows are daily snapshots, so a score recomputed since the
// last snapshot wouldn't show up. Append the live score as a "now"
// point. Skipped for a 0 score — same rule as the history RPCs.
export function withLiveMasteryPoint(points, liveScore, nowSeconds = Math.floor(Date.now() / 1000)) {
  const value = Number(liveScore);
  if (!Number.isFinite(value) || value <= 0) return points;
  const earlier = points.filter((p) => p.time < nowSeconds);
  return [...earlier, { time: nowSeconds, value: Math.round(value * 10) / 10 }];
}

// Hobby cron is once a day. Older than that means the last run didn't
// land — the chart says so instead of drawing a flat line with no hint.
export const REFRESH_STALE_MS = 26 * 60 * 60 * 1000;
const HUNG_RUN_MS = 15 * 60 * 1000;

function formatAge(iso, now) {
  const age = now - new Date(iso).getTime();
  if (!Number.isFinite(age) || age < 0) return "just now";
  const minutes = Math.floor(age / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 36) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function describeMasteryRefresh({ job, personalComputedAt, now = Date.now() } = {}) {
  if (job?.status === "running" && job.started_at) {
    const age = now - new Date(job.started_at).getTime();
    if (age > HUNG_RUN_MS) {
      return { text: "Daily refresh started but didn't finish", stale: true };
    }
    return { text: "Daily refresh is running", stale: false };
  }
  if (job?.status === "error") {
    return { text: "Daily refresh failed", stale: true };
  }
  if (job?.status === "ok" && job.finished_at) {
    const stale = now - new Date(job.finished_at).getTime() > REFRESH_STALE_MS;
    return { text: `Daily refresh ${formatAge(job.finished_at, now)}`, stale };
  }
  if (personalComputedAt) {
    const stale = now - new Date(personalComputedAt).getTime() > REFRESH_STALE_MS;
    return { text: `Your score last updated ${formatAge(personalComputedAt, now)}`, stale };
  }
  return { text: "Daily refresh hasn't run yet", stale: true };
}
