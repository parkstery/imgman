import { useSyncExternalStore } from 'react';

/** Phone breakpoint: same threshold as Tailwind's `md` (48rem / 768px). */
export const MOBILE_MEDIA_QUERY = '(max-width: 767px)';

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }
  const mql = window.matchMedia(MOBILE_MEDIA_QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

function getSnapshot(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(MOBILE_MEDIA_QUERY).matches;
}

function getServerSnapshot(): boolean {
  return false;
}

/**
 * True while the viewport is narrower than the Tailwind `md` breakpoint.
 * Uses matchMedia so it also reacts to rotation / window resizing.
 */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
