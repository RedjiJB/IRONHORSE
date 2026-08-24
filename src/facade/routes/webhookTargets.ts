// Restoring the vendored features/admin/WebhookTargetsPage.tsx (394
// lines) -- the only one of the five dead cross-link chips small and
// clean enough to be a straightforward restoration rather than a
// rebuild. Matches the vendored page's own contract exactly (confirmed
// by reading its api calls): bare-array GET, PATCH {active}, DELETE.
// Admin-gated -- this is an integrations/admin surface, not an everyday
// crew tool, and the secret is a real credential.
import type { Router } from "../router.js";
import { readJsonBody, sendError, sendJson } from "../context.js";
import { requireAdminRole } from "../auth.js";
import { registerWebhookTarget, listWebhookTargets, toggleWebhookTarget, deleteWebhookTarget, type WebhookTarget } from "../../domain/webhookTargets.js";

type CreateBody = { name?: string; url?: string; event_filter?: string; secret?: string | null; active?: boolean };
type PatchBody = { active?: boolean };

function toFrontendShape(t: WebhookTarget) {
  const { secret: _secret, ...rest } = t;
  return { ...rest, has_secret: Boolean(_secret) };
}

export function registerWebhookTargetRoutes(router: Router): void {
  router.get("/api/v1/notifications/webhooks/", async (req, res) => {
    try {
      await requireAdminRole(req);
      const targets = await listWebhookTargets();
      sendJson(res, 200, targets.map(toFrontendShape));
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/api/v1/notifications/webhooks/", async (req, res) => {
    try {
      await requireAdminRole(req);
      const body = await readJsonBody<CreateBody>(req);
      if (!body.name || !body.url) {
        sendJson(res, 422, { detail: "name and url are required" });
        return;
      }
      const target = await registerWebhookTarget({
        name: body.name,
        url: body.url,
        eventFilter: body.event_filter,
        secret: body.secret ?? null,
        active: body.active,
      });
      sendJson(res, 200, toFrontendShape(target));
    } catch (err) {
      sendError(res, err);
    }
  });

  router.patch("/api/v1/notifications/webhooks/:id/", async (req, res, { id }) => {
    try {
      await requireAdminRole(req);
      const body = await readJsonBody<PatchBody>(req);
      if (typeof body.active !== "boolean") {
        sendJson(res, 422, { detail: "active must be a boolean" });
        return;
      }
      const target = await toggleWebhookTarget(id, body.active);
      if (!target) {
        sendJson(res, 404, { detail: "Not found" });
        return;
      }
      sendJson(res, 200, toFrontendShape(target));
    } catch (err) {
      sendError(res, err);
    }
  });

  router.delete("/api/v1/notifications/webhooks/:id/", async (req, res, { id }) => {
    try {
      await requireAdminRole(req);
      const deleted = await deleteWebhookTarget(id);
      if (!deleted) {
        sendJson(res, 404, { detail: "Not found" });
        return;
      }
      sendJson(res, 200, { ok: true });
    } catch (err) {
      sendError(res, err);
    }
  });
}
