// Login for the façade -- currently a placeholder, not real
// authentication. Guards are DID-based identities with no password or
// verified OTP channel built yet (FEATURES.md's guard/supervisor mobile
// app is meant to authenticate guards some other way -- SMS OTP is the
// obvious candidate, not built in Phase 1). This route trusts a bare phone
// number and issues a real access token for whichever guard owns it --
// fine for local development and demoing the live-roster/approve-reject
// flow, genuinely unsafe for anything else. Replace with real OTP/
// passwordless verification before this ships to an actual device.
import type { Router } from "../router.js";
import { readJsonBody, sendError, sendJson } from "../context.js";
import { getGuardByPhone } from "../../domain/guards.js";
import { issueAccessTokenJwt } from "../../identity/accessToken.js";

export function registerAuthRoutes(router: Router): void {
  router.post("/auth/dev-login", async (req, res) => {
    try {
      const body = await readJsonBody<{ phone?: string }>(req);
      if (!body.phone) {
        sendJson(res, 400, { detail: "phone is required" });
        return;
      }
      const guard = await getGuardByPhone(body.phone);
      if (!guard) {
        sendJson(res, 401, { detail: "No guard found for that phone number" });
        return;
      }
      const accessToken = await issueAccessTokenJwt({ userId: guard.id, userDid: guard.did, role: guard.role });
      sendJson(res, 200, { accessToken, guard: { id: guard.id, name: guard.name, role: guard.role } });
    } catch (err) {
      sendError(res, err);
    }
  });
}
