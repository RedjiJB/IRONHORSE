import { z } from "zod";
import { CapabilityDeniedError } from "../middleware.js";

export const credentialArg = { credentialJwt: z.string().describe("The caller's presented CapabilityGrant JWT") };

export function deniedResult(err: unknown): { content: { type: "text"; text: string }[]; isError: true } {
  if (err instanceof CapabilityDeniedError) {
    return { content: [{ type: "text", text: `Denied: ${err.reason}` }], isError: true };
  }
  throw err;
}
