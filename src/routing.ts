import { useLocation } from "react-router-dom";

export type AppShell = "web" | "mobile";

export function getShellFromPathname(pathname: string): AppShell {
  return pathname.startsWith("/web") ? "web" : "mobile";
}

/** Lege string = hoofdpaden (/, /profiel, …) = mobiele shell. Alleen /web/* = desktop. */
export function getBasePathFromPathname(pathname: string): "" | "/web" {
  if (pathname.startsWith("/web")) return "/web";
  return "";
}

export function useBasePath(): "" | "/web" {
  const location = useLocation();
  return getBasePathFromPathname(location.pathname);
}

export function withBase(basePath: string, path: string): string {
  if (!path.startsWith("/")) return `${basePath}/${path}`;
  return `${basePath}${path}`;
}

