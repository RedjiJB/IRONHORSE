// A small hand-rolled path-template router for the REST façade -- no
// Express/Fastify. This project has been deliberate about minimizing
// dependencies (Veramo removed, bcryptjs avoided for native
// crypto.scrypt); matching method + path template and extracting params
// is genuinely simple enough to not need a framework. Trailing slashes
// are accepted either way (the vendored frontend is inconsistent about
// them per-endpoint) -- stricter matching would just be a source of
// silent 404s, not a real correctness property worth enforcing here.
import type { IncomingMessage, ServerResponse } from "node:http";

export type RouteParams = Record<string, string>;
export type FacadeHandler = (req: IncomingMessage, res: ServerResponse, params: RouteParams) => Promise<void> | void;

type CompiledRoute = { method: string; regex: RegExp; paramNames: string[]; handler: FacadeHandler };

function compilePattern(pattern: string): { regex: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  const segments = pattern.split("/").filter((s) => s.length > 0);
  const regexBody = segments
    .map((segment) => {
      if (segment.startsWith(":")) {
        paramNames.push(segment.slice(1));
        return "([^/]+)";
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return { regex: new RegExp(`^/${regexBody}/?$`), paramNames };
}

export class Router {
  private routes: CompiledRoute[] = [];

  private register(method: string, pattern: string, handler: FacadeHandler): void {
    const { regex, paramNames } = compilePattern(pattern);
    this.routes.push({ method, regex, paramNames, handler });
  }

  get(pattern: string, handler: FacadeHandler): void {
    this.register("GET", pattern, handler);
  }
  post(pattern: string, handler: FacadeHandler): void {
    this.register("POST", pattern, handler);
  }
  patch(pattern: string, handler: FacadeHandler): void {
    this.register("PATCH", pattern, handler);
  }
  put(pattern: string, handler: FacadeHandler): void {
    this.register("PUT", pattern, handler);
  }
  delete(pattern: string, handler: FacadeHandler): void {
    this.register("DELETE", pattern, handler);
  }

  // Returns true if a route matched (and was handled), false if the
  // caller should fall through to a 404.
  async dispatch(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? "/", "http://localhost");
    for (const route of this.routes) {
      if (route.method !== req.method) continue;
      const match = route.regex.exec(url.pathname);
      if (!match) continue;
      const params: RouteParams = {};
      route.paramNames.forEach((name, i) => (params[name] = decodeURIComponent(match[i + 1])));
      await route.handler(req, res, params);
      return true;
    }
    return false;
  }
}
