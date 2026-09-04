// Shared request/response plumbing for the REST façade. Error bodies use
// FastAPI's own {"detail": "..."} shape -- the vendored frontend's error
// parsing (src/shared/lib/api.ts) specifically expects that shape and
// falls back to a generic message otherwise; matching it means zero
// frontend changes for error display.
import type { IncomingMessage, ServerResponse } from "node:http";

export class FacadeError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function readJsonBody<T = unknown>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {} as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new FacadeError(400, "Malformed JSON body");
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(payload);
}

export function sendError(res: ServerResponse, err: unknown): void {
  if (err instanceof FacadeError) {
    sendJson(res, err.status, { detail: err.message });
    return;
  }
  console.error("[facade] unhandled error", err);
  sendJson(res, 500, { detail: "Internal server error" });
}

export function getQueryParam(req: IncomingMessage, name: string): string | undefined {
  const url = new URL(req.url ?? "/", "http://localhost");
  return url.searchParams.get(name) ?? undefined;
}

export function getQueryInt(
  req: IncomingMessage,
  name: string,
  fallback: number,
  bounds?: { min?: number; max?: number },
): number {
  const raw = getQueryParam(req, name);
  if (raw == null) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (bounds?.min != null && parsed < bounds.min) return bounds.min;
  if (bounds?.max != null && parsed > bounds.max) return bounds.max;
  return parsed;
}
