import { useCallback, useEffect, useRef, useState } from "react";

/** Fetch with `loader` now and every `intervalMs` (0 = once). */
export function usePoll(loader, intervalMs = 0) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const reload = useCallback(async () => {
    try {
      setData(await loaderRef.current());
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    if (!intervalMs) return undefined;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") reload();
    }, intervalMs);
    return () => clearInterval(t);
  }, [reload, intervalMs]);

  return { data, error, loading, reload, setData };
}
