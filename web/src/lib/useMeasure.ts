import { useEffect, useRef, useState } from 'react';

/**
 * Reports the pixel width of an element, so charts can be drawn at their true
 * size instead of being scaled (and letterboxed) by the SVG viewBox.
 */
export function useMeasure<T extends HTMLElement>(fallback = 640) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const update = () => setWidth(Math.max(240, Math.round(element.clientWidth)));
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
}

export default useMeasure;
