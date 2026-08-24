// Login/refresh/me -- the only façade routes touching pre-authentication
// state. Everything else (user provisioning, password resets) stays an
// MCP/ops-tool operation (src/mcp/tools/users.ts) -- this backend is
// admin-provisioned only, no self-signup, no email-based password reset.
import type { Router } from "../router.js";
import { readJsonBody, sendError, sendJson } from "../context.js";
import { requireBearerToken } from "../auth.js";
import { getUser, getUserByEmail } from "../../domain/users.js";
import { verifyPassword } from "../../identity/passwords.js";
import { createSession, deleteSession, resolveSession } from "../../domain/sessions.js";
import { issueAccessTokenJwt } from "../../identity/accessToken.js";
import { isLoginLocked, recordLoginAttempt } from "../../domain/loginAttempts.js";

const REFRESH_TOKEN_DAYS = 30;

type LoginBody = { email?: string; password?: string };
type RefreshBody = { refresh_token?: string };

export function registerAuthRoutes(router: Router): void {
  router.post("/api/v1/users/auth/login/", async (req, res) => {
    try {
      const body = await readJsonBody<LoginBody>(req);
      if (!body.email || !body.password) {
        sendJson(res, 401, { detail: "Incorrect email or password" });
        return;
      }

      // Same generic 401 whether the email doesn't exist, the account is
      // deactivated, the password is wrong, or the account is locked out
      // from too many recent failures -- no user-enumeration, and locking
      // out doesn't distinguish a real account from a made-up one either.
      if (await isLoginLocked(body.email)) {
        sendJson(res, 401, { detail: "Incorrect email or password" });
        return;
      }

      const user = await getUserByEmail(body.email);
      const passwordOk = user ? await verifyPassword(body.password, user.password_hash) : false;
      await recordLoginAttempt(body.email, passwordOk && !!user?.active);
      if (!user || !user.active || !passwordOk) {
        sendJson(res, 401, { detail: "Incorrect email or password" });
        return;
      }

      const accessToken = await issueAccessTokenJwt({ userId: user.id, userDid: user.did, role: user.role });
      const { token: refreshToken } = await createSession({ userId: user.id }, REFRESH_TOKEN_DAYS);
      sendJson(res, 200, { access_token: accessToken, refresh_token: refreshToken });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/api/v1/users/auth/refresh/", async (req, res) => {
    try {
      const body = await readJsonBody<RefreshBody>(req);
      if (!body.refresh_token) {
        sendJson(res, 401, { detail: "Invalid refresh token" });
        return;
      }

      const identity = await resolveSession(body.refresh_token);
      if (!identity || identity.type !== "user") {
        sendJson(res, 401, { detail: "Invalid refresh token" });
        return;
      }
      const user = await getUser(identity.userId);
      if (!user || !user.active) {
        sendJson(res, 401, { detail: "Invalid refresh token" });
        return;
      }

      // Rotate: create the new session before deleting the old one, so a
      // failure mid-rotation leaves a harmless extra row rather than
      // locking the user out. The frontend treats a response missing
      // either token as failure and force-logs-out, so both must always
      // come back together.
      const { token: newRefreshToken } = await createSession({ userId: user.id }, REFRESH_TOKEN_DAYS);
      await deleteSession(body.refresh_token);
      const accessToken = await issueAccessTokenJwt({ userId: user.id, userDid: user.did, role: user.role });
      sendJson(res, 200, { access_token: accessToken, refresh_token: newRefreshToken });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/api/v1/users/me/", async (req, res) => {
    try {
      const authenticated = await requireBearerToken(req);
      const user = await getUser(authenticated.userId);
      if (!user || !user.active) {
        sendJson(res, 401, { detail: "Not authenticated" });
        return;
      }
      // role is descriptive/display only here, same convention users.ts
      // documents -- real authorization already happened via
      // requireBearerToken -> checkStandingCapability wherever it matters.
      sendJson(res, 200, { role: user.role, email: user.email, full_name: user.name });
    } catch (err) {
      sendError(res, err);
    }
  });
}
