// Façade-side request authorization. Extracts and verifies the bearer
// access token, then re-checks real authorization via a standing
// capability grant -- never the JWT's own role claim. A capability
// revocation takes effect on the caller's very next request, not after
// the 15-minute access token naturally expires.
import type { IncomingMessage } from "node:http";
import { verifyAccessTokenJwt } from "../identity/accessToken.js";
import { checkStandingCapability } from "../identity/capabilities.js";
import { FacadeError } from "./context.js";

export type AuthenticatedUser = { userId: string; userDid: string; role: string };

export async function requireBearerToken(req: IncomingMessage): Promise<AuthenticatedUser> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw new FacadeError(401, "Not authenticated");

  const token = header.slice("Bearer ".length);
  const result = await verifyAccessTokenJwt(token);
  if (!result.ok) throw new FacadeError(401, "Not authenticated");

  return { userId: result.userId, userDid: result.userDid, role: result.role };
}

// Same capability guards.ts's hasSupervisorCapability checks -- kept as a
// separate façade-side check (rather than importing that domain function
// directly) so this file's authorization logic stays readable without
// chasing into src/domain/. Re-checked live every request, never a
// trusted role column or the access token's own role claim.
export async function requireSupervisor(req: IncomingMessage): Promise<AuthenticatedUser> {
  const user = await requireBearerToken(req);
  const check = await checkStandingCapability(user.userDid, "guard:role:management", 1);
  if (!check.allowed) throw new FacadeError(403, "Not authorized");
  return user;
}
