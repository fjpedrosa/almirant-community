import { useEffect, useRef, useState } from "react";

const STALE_THRESHOLD_MS = 30_000; // 30 seconds

interface UseTabVisibilityOptions {
  onReturn?: (timeSinceHidden: number) => void;
  threshold?: number;
}

interface UseTabVisibilityReturn {
  isVisible: boolean;
}

export const useTabVisibility = (options: UseTabVisibilityOptions = {}): UseTabVisibilityReturn => {
  const { onReturn, threshold = STALE_THRESHOLD_MS } = options;
  const hiddenAtRef = useRef<number | null>(null);
  const [isVisible, setIsVisible] = useState(true);
  const onReturnRef = useRef(onReturn);

  useEffect(() => {
    onReturnRef.current = onReturn;
  });

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        hiddenAtRef.current = Date.now();
        setIsVisible(false);
      } else {
        setIsVisible(true);
        if (hiddenAtRef.current !== null) {
          const elapsed = Date.now() - hiddenAtRef.current;
          if (elapsed >= threshold) {
            onReturnRef.current?.(elapsed);
          }
          hiddenAtRef.current = null;
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [threshold]);

  return { isVisible };
};
