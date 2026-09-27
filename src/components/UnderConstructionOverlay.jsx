// Reusable "still mock data" marker — a yellow diagonal strike plus a
// small badge, dropped into whichever dashboards still show mock data
// (Prices is the only one fully wired to real data so far). Remove
// this from a panel once it gets real data wired in.

export default function UnderConstructionOverlay() {
  return (
    <div className="wip-overlay">
      <span className="wip-strike" aria-hidden="true" />
      <span className="wip-badge">Under Construction</span>
    </div>
  );
}
