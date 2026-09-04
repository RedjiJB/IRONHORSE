import { z } from "zod";
import { CapabilityDeniedError } from "../middleware.js";

// Optional in the schema: a caller may instead rely on a credential
// attached via HTTP header at the transport level (see
// src/mcp/requestContext.ts) -- requireCapability() falls back to that
// when this argument is omitted. stdio callers have no header path, so
// they must always pass this explicitly.
export const credentialArg = { credentialJwt: z.string().optional().describe("The caller's presented CapabilityGrant JWT (optional if supplied via request header instead)") };

export function deniedResult(err: unknown): { content: { type: "text"; text: string }[]; isError: true } {
  if (err instanceof CapabilityDeniedError) {
    return { content: [{ type: "text", text: `Denied: ${err.reason}` }], isError: true };
  }
  throw err;
}
