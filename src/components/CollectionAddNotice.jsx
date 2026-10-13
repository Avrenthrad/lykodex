export default function CollectionAddNotice({ message, onViewCollection }) {
  if (!message) return null;
  if (message.type === "error") {
    return (
      <p className="panel__status panel__status--error" role="alert">
        {message.text}
      </p>
    );
  }
  return (
    <p className="panel__status collection-add-notice" role="status">
      <span>Added {message.name} to your collection.</span>
      {onViewCollection ? (
        <button type="button" className="collection-add-notice__link" onClick={onViewCollection}>
          View collection
        </button>
      ) : null}
    </p>
  );
}
