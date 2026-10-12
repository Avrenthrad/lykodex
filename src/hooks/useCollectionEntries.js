import { useEffect, useState } from "react";
import { subscribeCollectionChanged } from "../lib/collectionEvents";

// See lib/collectionEvents.js for why a mounted collection has to
// refetch on notify instead of waiting for the next mount.
export function useCollectionEntries(game, userId, fetchCollection, enrichCollectionEntry) {
  const [entries, setEntries] = useState([]);
  const [status, setStatus] = useState(userId ? "loading" : "idle");

  useEffect(() => {
    if (!userId) return undefined;
    let requestId = 0;
    let cancelled = false;

    async function load(quiet) {
      const id = ++requestId;
      if (!quiet) setStatus("loading");
      try {
        const rows = await fetchCollection(userId);
        const enriched = await Promise.all(rows.map(enrichCollectionEntry));
        if (cancelled || id !== requestId) return;
        setEntries(enriched);
        setStatus("ready");
      } catch (err) {
        console.error(`Failed to load ${game} collection:`, err);
        if (cancelled || id !== requestId) return;
        if (!quiet) setStatus("error");
      }
    }

    load(false);
    const unsubscribe = subscribeCollectionChanged(game, () => {
      load(true);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [game, userId, fetchCollection, enrichCollectionEntry]);

  return { entries, setEntries, status };
}
