import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";

function updateViewportZoom(enabled: boolean): void {
  if (typeof document === "undefined") return;
  const tag = document.querySelector('meta[name="viewport"]');
  if (!tag) return;
  tag.setAttribute(
    "content",
    enabled
      ? "width=device-width, initial-scale=1.0, viewport-fit=cover"
      : "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover"
  );
}

type ZoomContextValue = {
  zoomEnabled: boolean;
  setZoomEnabled: (enabled: boolean) => void;
};

const ZoomContext = createContext<ZoomContextValue | null>(null);

export function ZoomProvider({ children }: { children: ReactNode }) {
  const [zoomEnabled, setZoomState] = useState(false);

  const setZoomEnabled = useCallback((enabled: boolean) => {
    updateViewportZoom(enabled);
    setZoomState(enabled);
  }, []);

  useEffect(() => {
    updateViewportZoom(false);
  }, []);

  return (
    <ZoomContext.Provider value={{ zoomEnabled, setZoomEnabled }}>
      {children}
    </ZoomContext.Provider>
  );
}

export function useZoom(): ZoomContextValue {
  const ctx = useContext(ZoomContext);
  if (!ctx) throw new Error("useZoom must be used within ZoomProvider");
  return ctx;
}
