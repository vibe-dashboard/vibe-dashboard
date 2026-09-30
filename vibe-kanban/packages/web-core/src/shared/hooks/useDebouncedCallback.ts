import { useRef, useEffect } from 'react';

/**
 * Returns a debounced version of the callback that delays invocation
 * until after `delay` milliseconds have elapsed since the last call.
 * Also returns a cancel function to clear any pending invocation.
 */
export function useDebouncedCallback<Args extends unknown[]>(
  callback: (...args: Args) => void,
  delay: number
): {
  debounced: (...args: Args) => void;
  cancel: () => void;
  flush: () => void;
} {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbackRef = useRef(callback);
  const lastArgsRef = useRef<Args | null>(null);

  // Keep callback ref up to date
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  // Return stable function reference
  const debouncedRef = useRef((...args: Args) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    lastArgsRef.current = args;
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      callbackRef.current(...args);
      lastArgsRef.current = null;
    }, delay);
  });

  // Cancel function to clear pending timeout
  const cancelRef = useRef(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    lastArgsRef.current = null;
  });

  const flushRef = useRef(() => {
    if (!timeoutRef.current || !lastArgsRef.current) {
      return;
    }

    clearTimeout(timeoutRef.current);
    timeoutRef.current = null;

    const args = lastArgsRef.current;
    lastArgsRef.current = null;
    callbackRef.current(...args);
  });

  return {
    debounced: debouncedRef.current,
    cancel: cancelRef.current,
    flush: flushRef.current,
  };
}
