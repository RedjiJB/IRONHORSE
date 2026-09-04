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

export async function requireStaffRole(req: IncomingMessage): Promise<AuthenticatedUser> {
  const user = await requireBearerToken(req);
  const check = await checkStandingCapability(user.userDid, "dashboard:role:staff", 1);
  if (!check.allowed) throw new FacadeError(403, "Not authorized");
  return user;
}

export async function requireAdminRole(req: IncomingMessage): Promise<AuthenticatedUser> {
  const user = await requireBearerToken(req);
  const check = await checkStandingCapability(user.userDid, "dashboard:role:admin", 1);
  if (!check.allowed) throw new FacadeError(403, "Not authorized");
  return user;
}
