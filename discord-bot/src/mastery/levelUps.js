// Wraps the daily Mastery refresh so it can report level-ups to the
// activity feed: snapshot levels before, compare after.
import { runDailyMasteryRefresh } from "./masteryRefresh.js";

async function snapshotLevels(supabase) {
  const { data, error } = await supabase.from("profiles").select("id, mastery_level, overall_mastery_level");
  if (error) throw error;
  return new Map((data || []).map((p) => [p.id, p]));
}

// Pure diff — exported for tests.
export function diffLevels(before, after) {
  const ups = [];
  for (const [id, now] of after) {
    const was = before.get(id);
    if (!was) continue;
    if ((now.overall_mastery_level ?? 0) > (was.overall_mastery_level ?? 0)) {
      ups.push({ userId: id, kind: "overall", from: was.overall_mastery_level ?? 0, to: now.overall_mastery_level });
    }
    if ((now.mastery_level ?? 0) > (was.mastery_level ?? 0)) {
      ups.push({ userId: id, kind: "gaming", from: was.mastery_level ?? 0, to: now.mastery_level });
    }
  }
  return ups;
}

export async function runRefreshWithLevelUps(supabase) {
  const before = await snapshotLevels(supabase);
  const summary = await runDailyMasteryRefresh(supabase);
  const after = await snapshotLevels(supabase);
  return { ...summary, levelUps: diffLevels(before, after) };
}
