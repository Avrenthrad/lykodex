// Lightweight, reusable "are you sure?" confirmation modal — for any
// destructive/hard-to-undo action (removing a friend, leaving a
// guild, etc.) that shouldn't fire from a single accidental click.
// Not tied to any one feature on purpose, so the next place that
// needs a confirm step reuses this instead of a new one-off modal.
import { useEscapeKey } from "../hooks/useEscapeKey";

export default function ConfirmDialog({ open, title, message, confirmLabel = "Confirm", onConfirm, onCancel }) {
  useEscapeKey(onCancel, open);
  if (!open) return null;
  return (
    <div className="confirm-dialog-backdrop" onClick={onCancel}>
      <div
        className="confirm-dialog"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
      >
        <h3 id="confirm-dialog-title" className="confirm-dialog__title">{title}</h3>
        {message && <p className="confirm-dialog__message">{message}</p>}
        <div className="confirm-dialog__actions">
          <button type="button" className="quickdash-reset-btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="confirm-dialog__confirm" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
