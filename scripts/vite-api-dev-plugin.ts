import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { loadEnv } from "vite";

type ApiHandler = (
  req: IncomingMessage & { body?: unknown; query?: Record<string, string | string[]> },
  res: ServerResponse & {
    status: (code: number) => { json: (data: unknown) => void };
  }
) => void | Promise<void>;

const API_ROUTES: Record<string, () => Promise<{ default: ApiHandler }>> = {
  "/api/auth/sign-in": () => import("../api/auth/sign-in"),
  "/api/auth/register": () => import("../api/auth/register"),
  "/api/auth/change-password": () => import("../api/auth/change-password"),
  "/api/auth/delete-account": () => import("../api/auth/delete-account"),
  "/api/genres": () => import("../api/genres"),
};

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function createVercelResponse(res: ServerResponse) {
  const vercelRes = res as ServerResponse & {
    status: (code: number) => { json: (data: unknown) => void };
  };

  vercelRes.status = (code: number) => {
    res.statusCode = code;
    return {
      json: (data: unknown) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(data));
      },
    };
  };

  return vercelRes;
}

function applyEnv(mode: string, root: string) {
  const env = loadEnv(mode, root, "");
  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value;
  }
}

/** Serveert Vercel API-routes lokaal tijdens `vite dev`. */
export function apiDevPlugin(): Plugin {
  return {
    name: "boek-tracker-api-dev",
    enforce: "pre",
    configureServer(server) {
      applyEnv(server.config.mode, server.config.root);

      const handleApi = async (
        req: IncomingMessage,
        res: ServerResponse,
        next: (err?: unknown) => void
      ) => {
        applyEnv(server.config.mode, server.config.root);

        const pathname = req.url?.split("?")[0];
        if (!pathname?.startsWith("/api/")) {
          next();
          return;
        }

        const loadHandler = API_ROUTES[pathname];
        if (!loadHandler) {
          res.statusCode = 404;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Not found" }));
          return;
        }

        try {
          const mod = await loadHandler();
          const body =
            req.method === "POST" || req.method === "PUT" || req.method === "PATCH"
              ? await readJsonBody(req)
              : undefined;

          const vercelReq = Object.assign(req, { body, query: {} });
          const vercelRes = createVercelResponse(res);
          await mod.default(vercelReq, vercelRes);
        } catch (err) {
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
          }
        }
      };

      // Voor SPA-fallback: API-middleware als eerste in de stack.
      type StackLayer = { route: string; handle: typeof handleApi };
      const stack = (server.middlewares as unknown as { stack: StackLayer[] }).stack;
      stack.unshift({ route: "", handle: handleApi });
    },
  };
}
