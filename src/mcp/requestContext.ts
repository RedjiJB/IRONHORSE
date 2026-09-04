// Carries a per-HTTP-request fallback credential across the async chain
// from the transport into whichever tool handler ends up running --
// exists for callers like OpenClaw's MCP client, which only supports a
// static per-server HTTP header, not per-tool-call argument injection.
// stdio has no request/header concept at all, so this context is simply
// never populated there and every tool call falls back to nothing,
// exactly as before this existed.
import { AsyncLocalStorage } from "node:async_hooks";

type RequestContext = { headerCredentialJwt?: string };

const storage = new AsyncLocalStorage<RequestContext>();

export function withRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getHeaderCredentialJwt(): string | undefined {
  return storage.getStore()?.headerCredentialJwt;
}
