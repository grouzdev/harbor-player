import { useEffect, useRef, useState } from "react";

export function useAppShellLayout() {
  const appShellRef = useRef<HTMLDivElement>(null);
  const [isPortraitLayout, setIsPortraitLayout] = useState(false);
  const [appShellWidth, setAppShellWidth] = useState(0);
  useEffect(() => {
    const shell = appShellRef.current;
    if (!shell) return;
    const observer = new ResizeObserver(([entry]) => {
      setAppShellWidth(entry.contentRect.width);
      setIsPortraitLayout(entry.contentRect.height > entry.contentRect.width);
    });
    observer.observe(shell);
    return () => observer.disconnect();
  }, []);
  return { appShellRef, appShellWidth, isPortraitLayout };
}
