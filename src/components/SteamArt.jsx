import { useEffect, useMemo, useRef, useState } from "react";
import {
  clearCachedSteamArt,
  fetchSteamHeaderImage,
  readCachedSteamArt,
  readCachedSteamHeader,
  steamArtCandidates,
  writeCachedSteamArt,
} from "../lib/steamArt";

const MAX_ATTEMPTS = 8;

function preferredKeyFor(appid, variant, headerImage) {
  const cachedWinner = appid ? readCachedSteamArt(appid, variant) : null;
  const knownHeader = headerImage || (appid ? readCachedSteamHeader(appid) : null);
  return [cachedWinner, knownHeader].filter(Boolean).join("|");
}

export default function SteamArt({
  appid,
  variant = "header",
  headerImage = null,
  fallbackImage = null,
  className = "",
  fill = false,
  alt = "",
  loading,
  resolveHeader = true,
  title,
}) {
  const explicitHeader = headerImage || null;
  const [preferredKey, setPreferredKey] = useState(() => preferredKeyFor(appid, variant, explicitHeader));
  const base = useMemo(
    () => steamArtCandidates(appid, {
      variant,
      preferred: preferredKey ? preferredKey.split("|") : [],
    }),
    [appid, variant, preferredKey]
  );

  const [index, setIndex] = useState(0);
  const [extra, setExtra] = useState([]);
  const [useFallback, setUseFallback] = useState(false);
  const [failed, setFailed] = useState(false);
  const [shown, setShown] = useState(false);
  const attempts = useRef(0);
  const lookupStarted = useRef(false);
  const generation = useRef(0);
  const handledSrc = useRef(null);
  const renderGen = generation.current;

  useEffect(() => {
    // Re-read the cache only when the game changes. Writing a winner
    // during onLoad must not change this key, or the frame restarts
    // and the image flashes back to empty.
    setPreferredKey(preferredKeyFor(appid, variant, explicitHeader));
    generation.current += 1;
    setIndex(0);
    setExtra([]);
    setUseFallback(false);
    setFailed(false);
    setShown(false);
    attempts.current = 0;
    lookupStarted.current = false;
    handledSrc.current = null;
  }, [appid, variant, explicitHeader]);

  const urls = useMemo(() => {
    const list = [...base];
    for (const url of extra) {
      if (url && !list.includes(url)) list.push(url);
    }
    if (useFallback && fallbackImage && !list.includes(fallbackImage)) list.push(fallbackImage);
    return list;
  }, [base, extra, useFallback, fallbackImage]);

  const src = !failed && index < urls.length ? urls[index] : null;

  function giveUpOrFallback() {
    if (!useFallback && fallbackImage && !urls.includes(fallbackImage)) {
      setUseFallback(true);
      setIndex(urls.length);
      return;
    }
    setFailed(true);
  }

  function handleError(event) {
    if (generation.current !== renderGen) return;
    if (handledSrc.current === src) return;
    handledSrc.current = src;
    event.currentTarget.style.opacity = "0";
    attempts.current += 1;
    if (attempts.current > MAX_ATTEMPTS) {
      setFailed(true);
      return;
    }

    const current = urls[index];
    if (current && current === readCachedSteamArt(appid, variant)) clearCachedSteamArt(appid, variant);
    setShown(false);

    if (index + 1 < urls.length) {
      setIndex(index + 1);
      return;
    }

    if (resolveHeader && appid && !lookupStarted.current) {
      lookupStarted.current = true;
      const gen = generation.current;
      fetchSteamHeaderImage(appid).then((thumb) => {
        if (generation.current !== gen) return;
        if (thumb && !urls.includes(thumb) && thumb !== fallbackImage) {
          setExtra((prev) => (prev.includes(thumb) ? prev : [...prev, thumb]));
          setIndex(urls.length);
          return;
        }
        giveUpOrFallback();
      });
      return;
    }

    giveUpOrFallback();
  }

  function handleLoad() {
    if (generation.current !== renderGen) return;
    setShown(true);
    const current = urls[index];
    if (current) writeCachedSteamArt(appid, variant, current);
  }

  function takeImg(node) {
    if (!node || !node.complete || generation.current !== renderGen) return;
    // A cached file can finish before React binds onLoad/onError, which
    // left the frame at opacity 0 — an empty dark box over a real image.
    if (node.naturalWidth > 0) {
      handleLoad();
      return;
    }
    handleError({ currentTarget: node });
  }

  const frameClass = [
    "steam-art",
    fill ? "steam-art--fill" : "",
    !src ? "steam-art--empty" : "",
    className,
  ].filter(Boolean).join(" ");

  return (
    <span className={frameClass} title={title}>
      {src && (
        <img
          key={src}
          ref={takeImg}
          src={src}
          alt={alt}
          loading={loading}
          decoding="async"
          style={{ opacity: shown ? 1 : 0 }}
          onLoad={handleLoad}
          onError={handleError}
        />
      )}
    </span>
  );
}
