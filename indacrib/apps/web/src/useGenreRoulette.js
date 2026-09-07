import { useEffect, useRef, useState } from 'react';

// Cycles `spinning` through `labels` every ~90ms while `active` is true, so
// the UI can show a quick "landing on a genre" flourish during the fetch
// instead of a static spinner. Purely cosmetic — the actual genre used for
// the round is whatever was already selected in the dropdown.
export function useGenreRoulette(active, labels) {
  const [spinning, setSpinning] = useState(null);
  const indexRef = useRef(0);

  useEffect(() => {
    if (!active || !labels.length) {
      setSpinning(null);
      return;
    }
    const id = setInterval(() => {
      indexRef.current = (indexRef.current + 1) % labels.length;
      setSpinning(labels[indexRef.current]);
    }, 90);
    return () => clearInterval(id);
  }, [active, labels]);

  return spinning;
}
