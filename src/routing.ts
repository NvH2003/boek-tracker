import { useLocation } from "react-router-dom";

export type AppShell = "web" | "mobile";

export function getShellFromPathname(pathname: string): AppShell {
  return pathname.startsWith("/mobile") ? "mobile" : "web";
}

export function getBasePathFromPathname(pathname: string): "" | "/mobile" | "/web" {
  if (pathname.startsWith("/mobile")) return "/mobile";
  if (pathname.startsWith("/web")) return "/web";
  return "";
}

export function useBasePath(): "" | "/mobile" | "/web" {
  const location = useLocation();
  return getBasePathFromPathname(location.pathname);
}

export function withBase(basePath: string, path: string): string {
  if (!path.startsWith("/")) return `${basePath}/${path}`;
  return `${basePath}${path}`;
}

